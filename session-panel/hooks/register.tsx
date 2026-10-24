import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, TurnUsage } from 'claude-code'

import type { Agent, Card, Collapsed, Mod, Output, Step } from '../types'

const PANE = 'session'
const TITLE = 'Session'
const steps = atom({ plugin: 'session-panel', key: 'steps' } as const, [] as Step[])
const outputs = atom({ plugin: 'session-panel', key: 'outputs' } as const, [] as Output[])
const used = atom({ plugin: 'session-panel', key: 'used' } as const, [] as string[])
const agents = atom({ plugin: 'session-panel', key: 'agents' } as const, [] as Agent[])
const spend = atom({ plugin: 'session-panel', key: 'spend' } as const, {} as Record<string, number | null>)
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

// API list prices, USD per million tokens: input, output, cache read (the claude-api skill, 2026-10-06).
// A cache write costs 1.25x input: subagents write the 5-minute cache, not the 1-hour one.
const PRICES: Record<string, [number, number, number]> = {
  'fable-5-1': [10, 50, 0.25],
  'opus-5-5': [4, 20, 0.2],
  'opus-5': [5, 25, 0.5],
  'sonnet-5-5': [2, 10, 0.2],
  'sonnet-5': [2, 10, 0.2],
  'haiku-5-5': [0.1, 0.5, 0.01],
  'haiku-4-5': [1, 5, 0.1],
}

// What one model call cost in USD; undefined for a model without a price.
const priceOf = (usage: TurnUsage) => {
  const model = shortModel(usage.model)
  const rates = PRICES[model]
  if (!rates) return undefined
  // Haiku 5.5 costs 5x for a prompt over 100K tokens.
  const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const scale = model === 'haiku-5-5' && prompt > 100000 ? 5 : 1
  const [input, output, read] = rates
  const cost = usage.input_tokens * input + usage.cache_creation_input_tokens * input * 1.25 + usage.cache_read_input_tokens * read + usage.output_tokens * output
  return (cost * scale) / 1e6
}
// The price at the end of a Subagents line; none while it is unknown.
const priceText = (usd?: number | null) => (typeof usd !== 'number' ? '' : usd < 0.01 ? ' · <$0.01' : ` · $${usd.toFixed(2)}`)

const MARKETS = ['@claude-mods', '@nateherk-mods']

// The mods of the two local marketplaces: on or off in user settings, and whether this
// session has them loaded now (a loaded mod's commands carry its name). This mod is left out.
const loadMods = async ($: EngineInterface, busy?: string) => {
  const map = ((await $.settings.read({ key: 'enabledPlugins' }).catch(() => undefined)) ?? {}) as Record<string, unknown>
  const commands = await $.command.list().catch(() => [])
  const loaded = new Set(commands.map(one => (one.plugin ?? '').split('@')[0]))
  const list = Object.entries(map)
    .filter(([id]) => MARKETS.some(market => id.endsWith(market)) && !id.startsWith('session-panel@'))
    .map(([id, isOn]) => ({ id, isOn: isOn === true, isLoaded: loaded.has(id.split('@')[0] ?? ''), isBusy: id === busy }))
    .sort((a, b) => a.id.localeCompare(b.id))
  await update($, mods, () => list)
  return list
}

// The Mods switch as one drawing: a thick line that touches its knob, green on, red off.
const switchSvg = (isOn: boolean) => {
  const line = isOn
    ? '<line x1="2" y1="8" x2="22" y2="8" stroke="#22c55e" stroke-width="4" stroke-linecap="round"/>'
    : '<line x1="14" y1="8" x2="34" y2="8" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>'
  const knob = `<circle cx="${isOn ? 28 : 8}" cy="8" r="7" fill="${isOn ? '#ececec' : '#8a8a8a'}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="16" viewBox="0 0 36 16">${line}${knob}</svg>`
}

const isScratch = (path: string) => path.includes('/scratchpad/') || path.startsWith('/tmp/')

// Files a command makes count when they have one of these extensions (deliverable-dock's default list).
const DOCS = new Set(['.pdf', '.pptx', '.docx', '.xlsx', '.html', '.png', '.jpg', '.mp4', '.mov', '.zip'])
const extOf = (path: string) => {
  const name = path.split('/').pop() ?? ''
  return name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
}
// The words of a command that name a document: `out.pdf`, `--out=out.pdf`, `>out.html`.
const commandPaths = (command: string) =>
  (command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) ?? [])
    .map(word => word.replace(/^["']|["']$/g, '').replace(/[;,)]$/, '').replace(/^-[^=]*=|^[<>]+/, ''))
    .filter(word => DOCS.has(extOf(word)))
const absolute = (path: string, cwd: string, home: string) => {
  const full = path.startsWith('~/') ? home + path.slice(1) : path.startsWith('/') ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return '/' + parts.join('/')
}

export const register: Register = on => {
  let sessionId = ''
  let cwd = '/'
  let home = ''
  // The agent's own working files: scratch and temp files, hidden files and folders (.claude memory,
  // .git), and files named after this session (its activity log). Outputs leaves them out.
  const isOwn = (path: string) => isScratch(path) || /\/\.[^/.]/.test(path) || (sessionId !== '' && path.includes(sessionId))

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    sessionId = await $.session.id().catch(() => '')
    home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
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
    const startedAt = Date.now()
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
      // Outputs lists the files made for the person: handed over, created by Write, or made by a command.
      // An edit only moves a listed file to the top.
      const record = (path: string, mayAdd: boolean) =>
        update($, outputs, list =>
          !mayAdd && !list.some(one => one.path === path)
            ? list
            : [{ path, isScratch: isScratch(path) }, ...list.filter(one => one.path !== path)].slice(0, 100),
        )
      const result = (ran.result ?? {}) as { type?: string; attachments?: { path?: string }[]; backgroundTaskId?: string }
      const key = FILE_TOOLS[String(e.tool)]
      const path = key ? args[key] : undefined
      if (typeof path === 'string') {
        await record(path, e.tool === 'Write' && result.type === 'create' && !isOwn(path))
      }
      if (e.tool === 'SendUserFile') {
        const sent = result.attachments?.map(one => one.path) ?? []
        for (const one of sent.length > 0 ? sent : Array.isArray(args.files) ? args.files : []) {
          if (typeof one === 'string') await record(absolute(one, cwd, home), true)
        }
      }
      if (e.tool === 'Artifact' && typeof args.file_path === 'string' && (args.action ?? 'publish') === 'publish' && args.asset !== true) {
        await record(absolute(args.file_path, cwd, home), true)
      }
      if (e.tool === 'Bash' && !result.backgroundTaskId) {
        for (const word of commandPaths(String(args.command ?? ''))) {
          const one = absolute(word, cwd, home)
          if (isOwn(one)) continue
          const stat = await $.fs.stat(one).catch(() => undefined)
          if (stat?.kind === 'file' && stat.mtimeMs >= startedAt) await record(one, true)
        }
      }
      const chip = chipOf(args)
      if (chip) await update($, used, list => (list.includes(chip) ? list : [...list, chip]))
    } catch (error) {
      $.ui.log(`session-panel: ${String(error)}`)
    }

    return ran
  })

  // Each model call of a subagent adds its price. A foreground agent's calls come before its
  // tool.call learns the agent's id, so the price is kept by id and joined when the pane draws.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const agentId = e.agentId
    if (agentId && step.usage) {
      const cost = priceOf(step.usage)
      await update($, spend, all => {
        const sum = all[agentId]
        return { ...all, [agentId]: sum === null || cost === undefined ? null : (sum ?? 0) + cost }
      }).catch(() => undefined)
    }

    return step
  })

  // A background agent's turns end here: add their tokens and time to its row.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId) await loadMods($).catch(() => undefined)
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
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
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
      await loadMods($, mod.id)
      const ran = await $.process.run(['claude', 'plugin', verb, mod.id], { timeoutMs: 60000 }).catch(error => ({
        exitCode: 1,
        stdout: '',
        stderr: String(error),
      }))
      if (ran.exitCode !== 0) {
        await loadMods($)
        $.ui.toast(`Cannot ${verb} ${mod.id}: ${ran.stderr.trim() || ran.stdout.trim()}`)
        return
      }
      // /reload-plugins loads or unloads the mod here once the session is idle; some
      // sessions refuse it (a remote connection). Do not wait for it: while a turn runs it
      // stays queued. Watch the live state instead, then stop "applying" either way.
      void $.command.run({ command: 'reload-plugins' }).catch(() => undefined)
      const want = !mod.isOn
      let now: Mod | undefined
      for (let i = 0; i < 10; i++) {
        await $.clock.sleep(600)
        now = (await loadMods($, mod.id)).find(one => one.id === mod.id)
        if (now?.isLoaded === want) break
      }
      await loadMods($)
      $.ui.toast(
        now?.isLoaded === want
          ? `${mod.id} ${verb}d in this session.`
          : `${mod.id} ${verb}d for new sessions. Not applied here yet: this session cannot reload plugins now.`,
      )
    }
    const refresh = async () => {
      await loadMods($)
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
    const spent = await read($, spend)
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
            <Text dimColor>No files made for you yet.</Text>
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
                  {one.isDone ? `${kTokens(one.tokens)} tokens · ${duration(one.ms)}${priceText(spent[one.agentId ?? ''])}` : 'running'}
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
            [
              ...modList.map(mod => (
                <Box key={`row-${mod.id}`} flexDirection="row" justifyContent="space-between" gap={1}>
                  <Text dimColor={!mod.isOn} wrap="truncate-end">{mod.id.split('@')[0]}</Text>
                  <Box flexDirection="row" alignItems="center" flexShrink={0}>
                    <Box marginRight={1}>
                      <Text dimColor>
                        {mod.isBusy ? 'applying' : mod.isOn === mod.isLoaded ? (mod.isLoaded ? 'live' : 'off') : mod.isOn ? 'not loaded here' : 'still loaded here'}
                      </Text>
                    </Box>
                    {Svg ? (
                      // A Button holds only text, so the drawing sits under a blank Button laid over it.
                      <Box position="relative" width={5}>
                        <Svg source={switchSvg(mod.isOn)} alt={mod.isOn ? 'on' : 'off'} width={36} height={16} />
                        <Box position="absolute" top={0} left={0}>
                          <Button key={`mod-${mod.id}`} plain onPress={flip(mod)} label="     " />
                        </Box>
                      </Box>
                    ) : (
                      // Where no SVG is drawn (the terminal): the line beside a knob button.
                      [
                        mod.isOn && <Text key="on-line" color="#22c55e">━━</Text>,
                        <Button key={`mod-${mod.id}`} plain onPress={flip(mod)}>
                          <Text dimColor={!mod.isOn}>●</Text>
                        </Button>,
                        !mod.isOn && <Text key="off-line" color="#ef4444">━━</Text>,
                      ]
                    )}
                  </Box>
                </Box>
              )),
              <Button key="mods-refresh" plain onPress={refresh}>
                <Text dimColor>↻ Refresh</Text>
              </Button>,
            ]
          ),
        )}
      </Box>
    )
  })
}
