import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Agent, Card, Collapsed, Mod, Output, Step } from '../types'

const PANE = 'session'
const TITLE = 'Session'
const steps = atom({ plugin: 'session-panel', key: 'steps' } as const, [] as Step[])
const outputs = atom({ plugin: 'session-panel', key: 'outputs' } as const, [] as Output[])
const used = atom({ plugin: 'session-panel', key: 'used' } as const, [] as string[])
const agents = atom({ plugin: 'session-panel', key: 'agents' } as const, [] as Agent[])
const mods = atom({ plugin: 'session-panel', key: 'mods' } as const, [] as Mod[])
const OPEN: Collapsed = { progress: false, outputs: false, used: false, subagents: false, mods: false }
const collapsed = atom({ plugin: 'session-panel', key: 'collapsed' } as const, OPEN)

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

const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const duration = (ms: number) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`)

const MARKETS = ['@claude-mods', '@nateherk-mods']

// The mods of the two local marketplaces, as user settings enable them; this mod is left out.
const loadMods = async ($: EngineInterface) => {
  const map = ((await $.settings.read({ key: 'enabledPlugins' }).catch(() => undefined)) ?? {}) as Record<string, unknown>
  const list = Object.entries(map)
    .filter(([id]) => MARKETS.some(market => id.endsWith(market)) && !id.startsWith('session-panel@'))
    .map(([id, isOn]) => ({ id, isOn: isOn === true }))
    .sort((a, b) => a.id.localeCompare(b.id))
  await update($, mods, () => list)
}

const isScratch = (path: string) => path.includes('/scratchpad/') || path.startsWith('/tmp/')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'session', description: 'Show or hide the Session pane' })
    const saved = (await $.store.get('collapsed').catch(() => undefined)) as Collapsed | undefined
    if (saved) await update($, collapsed, () => ({ ...OPEN, ...saved }))
    await loadMods($).catch(() => undefined)
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
    const isAgent = e.tool === 'Agent'
    if (isAgent) {
      const args = e as unknown as Record<string, unknown>
      const row: Agent = {
        id: e.tool_use_id,
        name: String(args.description || args.subagent_type || 'agent'),
        model: String(args.model ?? ''),
        tokens: 0,
        ms: 0,
        startedAt: Date.now(),
        isDone: false,
      }
      await update($, agents, list => [...list, row].slice(-50)).catch(() => undefined)
    }
    const ran = await next(e)
    if (isAgent) {
      // A background agent answers at once without totals; turn.complete fills them in later.
      const result = (ran.result ?? {}) as { agentId?: string; resolvedModel?: string; totalTokens?: number; totalDurationMs?: number }
      await update($, agents, list =>
        list.map(one =>
          one.id !== e.tool_use_id
            ? one
            : typeof result.totalTokens === 'number'
              ? { ...one, agentId: result.agentId, model: result.resolvedModel ?? one.model, tokens: result.totalTokens, ms: result.totalDurationMs ?? 0, isDone: true }
              : { ...one, agentId: result.agentId, model: result.resolvedModel ?? one.model },
        ),
      ).catch(() => undefined)
    }
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

  // A background agent's turns end here: add their tokens and time to its row.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const agentId = e.agentId
    const usage = e.usage
    if (agentId) {
      const tokens = usage ? usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      await update($, agents, list =>
        list.map(one =>
          one.agentId !== agentId || one.isDone
            ? one
            : { ...one, model: usage?.model ?? one.model, tokens: one.tokens + tokens, ms: Date.now() - one.startedAt, isDone: true },
        ),
      ).catch(() => undefined)
    }

    return done
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
    const flip = (mod: Mod) => async () => {
      const verb = mod.isOn ? 'disable' : 'enable'
      const ran = await $.process.run(['claude', 'plugin', verb, mod.id], { timeoutMs: 60000 }).catch(error => ({
        exitCode: 1,
        stdout: '',
        stderr: String(error),
      }))
      if (ran.exitCode !== 0) {
        $.ui.toast(`Cannot ${verb} ${mod.id}: ${ran.stderr.trim() || ran.stdout.trim()}`)
        return
      }
      await loadMods($)
      // /reload-plugins loads or unloads the mod in this session; it runs once the session is idle.
      const reloaded = await $.command.run({ command: 'reload-plugins' }).then(
        () => true,
        () => false,
      )
      $.ui.toast(reloaded ? `${mod.id} ${verb}d in this session.` : `${mod.id} ${verb}d. Run /reload-plugins to apply it here.`)
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
    const agentList = await read($, agents)
    const modList = await read($, mods)
    const most = Math.max(1, ...agentList.map(one => one.tokens))

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
        {card(
          'subagents',
          'Subagents',
          agentList.length === 0 ? (
            <Text dimColor>No subagents yet.</Text>
          ) : (
            agentList.map(one => (
              <Box key={`agent-${one.id}`} flexDirection="column" marginBottom={1}>
                <Box flexDirection="row" justifyContent="space-between" gap={1}>
                  <Text wrap="truncate-end">{one.name}</Text>
                  <Text dimColor>{one.model ? shortModel(one.model) : '…'}</Text>
                </Box>
                <Text dimColor>
                  {one.isDone ? `${kTokens(one.tokens)} tokens · ${duration(one.ms)}` : 'running'}
                </Text>
                <Box flexDirection="row" height={1}>
                  <Box width={`${Math.max(2, Math.round((one.tokens / most) * 100))}%`} backgroundColor={one.isDone ? 'suggestion' : 'inactive'} />
                </Box>
              </Box>
            ))
          ),
        )}
        {card(
          'mods',
          'Mods',
          modList.length === 0 ? (
            <Text dimColor>No mods from claude-mods or nateherk-mods.</Text>
          ) : (
            modList.map(mod => (
              <Button key={`mod-${mod.id}`} plain onPress={flip(mod)}>
                <Text dimColor={!mod.isOn}>{mod.id.split('@')[0]}</Text>{' '}
                <Text color={mod.isOn ? 'suggestion' : 'inactive'}>{mod.isOn ? 'on' : 'off'}</Text>
              </Button>
            ))
          ),
        )}
      </Box>
    )
  })
}
