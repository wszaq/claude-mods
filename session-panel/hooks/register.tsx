import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Card, Collapsed, Output, Step } from '../types'

const PANE = 'session'
const TITLE = 'Session'
const steps = atom({ plugin: 'session-panel', key: 'steps' } as const, [] as Step[])
const outputs = atom({ plugin: 'session-panel', key: 'outputs' } as const, [] as Output[])
const used = atom({ plugin: 'session-panel', key: 'used' } as const, [] as string[])
const collapsed = atom({ plugin: 'session-panel', key: 'collapsed' } as const, {
  progress: false,
  outputs: false,
  used: false,
} as Collapsed)

const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const FILE_TOOLS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' }
const WEB_TOOLS: Record<string, string> = { WebSearch: 'Web search', WebFetch: 'Web fetch' }

// Applies one update_plan call to the list, as the app's own task list does.
const applyPlan = (list: Step[], e: Record<string, unknown>): Step[] => {
  if (Array.isArray(e.items)) {
    return e.items.map(item => ({ content: String(item?.content ?? ''), status: item?.status ?? 'pending' }))
  }
  const set = (list: Step[], at: number, status: Step['status']) =>
    list.map((step, i) => (i === at ? { ...step, status } : step))
  let next = list
  if (e.advance === true) {
    next = set(next, next.findIndex(step => step.status === 'in_progress'), 'completed')
    next = set(next, next.findIndex(step => step.status === 'pending'), 'in_progress')
  }
  if (Array.isArray(e.done)) {
    for (const n of e.done) next = set(next, Number(n) - 1, 'completed')
  }
  if (typeof e.start === 'number') {
    next = next.map(step => (step.status === 'in_progress' ? { ...step, status: 'pending' as const } : step))
    next = set(next, e.start - 1, 'in_progress')
  }
  return next
}

// The chip a tool call adds to the Used card, or none.
const chipOf = (e: Record<string, unknown>): string | undefined => {
  const tool = String(e.tool)
  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? ''
    // App plumbing (ccd_*) and id-named servers are no connector the person picked.
    return server.startsWith('ccd_') || /^[0-9a-f]{8}-/.test(server) ? undefined : server
  }
  if (tool === 'Skill' && typeof e.skill === 'string') return e.skill
  return WEB_TOOLS[tool]
}

const isScratch = (path: string) => path.includes('/scratchpad/') || path.startsWith('/tmp/')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'session', description: 'Show or hide the Session pane' })
    const saved = (await $.store.get('collapsed').catch(() => undefined)) as Collapsed | undefined
    if (saved) await update($, collapsed, () => saved)
    void $.ui.open({ id: PANE, title: TITLE }).then(opened => {
      if (!opened.isPlaced) $.ui.log(`session-panel: pane not placed: ${opened.reason}`)
    })

    return next(e)
  })

  on('command.run', { command: 'session' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Session pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Session pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    // The panel is a view: a failed update must never change the tool's result.
    try {
      const args = e as unknown as Record<string, unknown>
      if (e.tool === PLAN_TOOL && !e.agentId) {
        await update($, steps, list => applyPlan(list, args))
      } else if (e.tool === WRAP_TOOL && !e.agentId) {
        await update($, steps, list => list.map(step => ({ ...step, status: 'completed' as const })))
      }
      const key = FILE_TOOLS[String(e.tool)]
      const path = key ? args[key] : undefined
      if (typeof path === 'string') {
        await update($, outputs, list => [{ path, isScratch: isScratch(path) }, ...list.filter(one => one.path !== path)].slice(0, 100))
      }
      const chip = chipOf(args)
      if (chip) await update($, used, list => (list.includes(chip) ? list : [...list, chip]))
    } catch (error) {
      $.ui.log(`session-panel: ${String(error)}`)
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shut = await read($, collapsed)

    const toggle = (card: Card) => async () => {
      const value = await update($, collapsed, now => ({ ...now, [card]: !now[card] }))
      await $.store.set('collapsed', value)
    }
    const open = (path: string) => async () => {
      // show_pane opens only files inside the working directory, the scratchpad or a granted folder.
      const shown = await $.mcp.call('ccd_view', 'show_pane', { pane: 'file', path }).catch(error => ({
        isError: true,
        content: [{ type: 'text', text: String(error) }],
      }))
      if (shown.isError) {
        const why = shown.content.map(block => ('text' in block ? block.text : '')).join(' ')
        $.ui.toast(`Cannot open ${path}: ${why}`)
      }
    }
    const card = (id: Card, title: string, body: RenderChildren) => (
      <Box key={`card-${id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
        <Button key={`toggle-${id}`} plain onPress={toggle(id)}>
          <Text bold>{title}</Text> <Text dimColor>{shut[id] ? '›' : '⌄'}</Text>
        </Button>
        {!shut[id] && <Box flexDirection="column" marginTop={1}>{body}</Box>}
      </Box>
    )

    const stepList = await read($, steps)
    const fileList = await read($, outputs)
    const chipList = await read($, used)

    return (
      <Box flexDirection="column">
        {card(
          'progress',
          'Progress',
          stepList.length === 0 ? (
            <Text dimColor>No task list yet.</Text>
          ) : (
            stepList.map((step, i) => (
              <Box key={`step-${i}`} flexDirection="row" gap={1}>
                <Text color={step.status === 'completed' ? 'suggestion' : step.status === 'in_progress' ? 'claude' : 'inactive'}>
                  {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '●' : '○'}
                </Text>
                <Text dimColor={step.status === 'completed'} strikethrough={step.status === 'completed'}>
                  {step.content}
                </Text>
              </Box>
            ))
          ),
        )}
        {card(
          'outputs',
          'Outputs',
          fileList.length === 0 ? (
            <Text dimColor>No files written yet.</Text>
          ) : (
            fileList.map(file => (
              <Button key={`file-${file.path}`} plain onPress={open(file.path)}>
                <Text dimColor={file.isScratch}>{file.path.split('/').pop()}</Text>{' '}
                <Text dimColor>
                  {file.path.split('/').slice(-3, -1).join('/')}
                </Text>
              </Button>
            ))
          ),
        )}
        {card(
          'used',
          'Used',
          chipList.length === 0 ? (
            <Text dimColor>No connectors or skills used yet.</Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {chipList.map(chip => (
                <Box key={`chip-${chip}`} borderStyle="round" borderDimColor paddingX={1}>
                  <Text>{chip}</Text>
                </Box>
              ))}
            </Box>
          ),
        )}
      </Box>
    )
  })
}
