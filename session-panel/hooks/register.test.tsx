import type { TurnUsage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-panel',
  component: 'Pane',
  requestId: 'session',
  props: {
    title: 'Session',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const PLAN = 'mcp__ccd_turn__update_plan'

type Found = { findAll: (q: object) => Promise<{ text?: string; props: Record<string, unknown> }[]> }

const BLUE = '#4A8FE0'
const TEAL = '#3BA596'
const GRAY = '#8F8D88'
// The chat's critter first, then one per subagent: the body color of each, on Desktop (its Svg) and on the terminal (its ▐ cell).
const avatars = async (ui: Found, surface: 'terminal' | 'desktop') =>
  surface === 'desktop'
    ? (await ui.findAll({ type: 'Svg' }))
        .filter(one => one.props.alt !== 'on' && one.props.alt !== 'off') // the Mods switches are Svgs too
        .map(one => String(one.props.source).match(/fill="(#[0-9A-Fa-f]{6})"/)?.[1])
    : (await ui.findAll({ type: 'Text', text: '▐' })).map(one => one.props.color)

test('the three cards follow the session', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Agent' }, (_, e) =>
    e.description === 'Background scan'
      ? { result: { agentId: 'bg1', content: [] } }
      : e.description === 'Odd model'
        ? { result: { agentId: 'a2', resolvedModel: 'claude-mystery-9', totalTokens: 2000, totalDurationMs: 3000, totalToolUseCount: 1, content: [] } }
        : e.description === 'Quiet run'
          ? { result: { agentId: 'a3', resolvedModel: 'claude-haiku-5-5', totalTokens: 500, totalDurationMs: 4000, totalToolUseCount: 0, content: [] } }
        : { result: { agentId: 'a1', resolvedModel: 'claude-haiku-5-5', totalTokens: 12345, totalDurationMs: 65000, totalToolUseCount: 3, content: [] } },
  )
  on('tool.call', { tool: 'Write' }, (_, e) => ({ result: { type: e.content === 'x' ? 'create' : 'update' } }))
  // One model call per step: the stand-in answers each with the usage the test gives it.
  const usages: Record<string, TurnUsage> = {}
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: usages[e.turnId] ?? null }
  })
  const step = async (turnId: string, usage: TurnUsage, agentId?: string) => {
    usages[turnId] = usage
    const stream = $.turn.step({ turnId, index: 0, model: usage.model, messageCount: 1, agentId })
    for await (const _ of stream);
    return stream.result
  }
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer, reason: 'answer' as const }))
  const ran: string[] = []
  const live = new Set(['close-gate'])
  on('command.list', () => ({ value: [...live].map(plugin => ({ name: plugin, description: '', source: 'plugin' as const, plugin })) }))
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))
    if (e.argv[2] === 'enable') {
      enabled[String(e.argv[3])] = true
      live.add(String(e.argv[3]).split('@')[0] ?? '')
    }
    // A session that cannot reload plugins: the setting changes, the loaded mod stays.
    if (e.argv[2] === 'disable') enabled[String(e.argv[3])] = false
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', { command: 'reload-plugins' }, () => {
    ran.push('/reload-plugins')
    return { text: 'Reloaded.' }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  // The chat color: Cache Keeper's file for this session says blue (3); the id's own color would be orange (0).
  const colorReads: string[] = []
  on('session.id', () => ({ value: 'sess-1' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', (_, e) => {
    colorReads.push(e.path)
    return { value: e.path.includes('/chat-colors/') ? '{"color":3}' : '' }
  })
  const enabled: Record<string, boolean> = { 'close-gate@claude-mods': true, 'goal-meter@nateherk-mods': false, 'session-panel@claude-mods': true, 'other@elsewhere': true }
  // settings.read hooks answer the whole settings object; the engine picks the key (2.1.311).
  on('settings.read', () => ({ value: { enabledPlugins: { ...enabled } } }))
  on('clock.sleep', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: PLAN,
    items: [
      { content: 'Plan it', status: 'in_progress' },
      { content: 'Build it', status: 'pending' },
      { content: 'Check it', status: 'pending' },
    ],
    scope: 'first_task',
  })
  await $.tool.call({ tool: PLAN, advance: true })
  await $.tool.call({ tool: 'Write', file_path: '/work/a/notes.md', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/claude-1000/s/scratchpad/tmp.txt', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/a/notes.md', content: 'y' })
  await $.tool.call({ tool: 'Skill', skill: 'ask-me' })
  await $.tool.call({ tool: 'WebSearch', query: 'x', mode: 'standard' })
  await $.tool.call({ tool: 'mcp__gmail__search', q: 'x' })
  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'diff' })
  // A foreground agent's model calls come before its tool.call result names it.
  // 61K prompt: 1000×0.10 + 10000×0.125 + 50000×0.01 + 2000×0.50 = $0.00285.
  await step('s1', { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 10000 }, 'a1')
  // 150K prompt, the 5x rate: 150000×0.05 + 4000×2.50 = $0.0175. Total $0.02035 (at the base rate: $0.00635).
  await step('s2', { model: 'claude-haiku-5-5', input_tokens: 0, output_tokens: 4000, cache_read_input_tokens: 150000, cache_creation_input_tokens: 0 }, 'a1')
  // The main loop's calls are no subagent's.
  await step('m1', { model: 'claude-opus-5-5', input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await $.tool.call({ tool: 'Agent', description: 'Scan the vault', subagent_type: 'Explore', prompt: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Odd model', prompt: 'x' })
  // An agent whose model calls the mod did not see: no tokens or price, only its time.
  await $.tool.call({ tool: 'Agent', description: 'Quiet run', prompt: 'x' })
  await step('o1', { model: 'claude-mystery-9', input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'a2')

  const marks = async (ui: { findAll: (q: object) => Promise<{ text?: string }[]> }) =>
    (await ui.findAll({ type: 'Text', text: /^[✓●○]$/ })).map(one => one.text).slice(0, 3) // the Progress card is first; Mods knobs use ● too

  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await marks(first)).toEqual(['✓', '●', '○'])
  // The header above Progress: this chat's critter in the color of its file, the state and the steps done.
  expect(colorReads).toContain('/home/me/.claude/mods-data/chat-colors/sess-1.json')
  expect(await avatars(first, 'desktop')).toEqual([BLUE, TEAL, GRAY, TEAL, '#F08A5D', '#7FC8A9'])
  expect((await first.find({ type: 'Text', text: 'Blue chat · working' }))?.text).toBe('Blue chat · working')
  expect((await first.find({ type: 'Text', text: '1 of 3 steps' }))?.text).toBe('1 of 3 steps')
  const files = (await first.findAll({ type: 'Text', text: /\.(md|txt)$/ })).map(one => one.text)
  expect(files).toEqual(['notes.md'])
  const chips = (await first.findAll({ type: 'Text', text: /^(ask-me|Web search|gmail|ccd_view)$/ })).map(one => one.text)
  expect(chips).toEqual(['ask-me', 'Web search', 'gmail'])
  expect((await first.find({ type: 'Text', text: /Scan the vault/ }))?.text).toBe('Scan the vault')
  expect((await first.find({ type: 'Text', text: /haiku/ }))?.text).toBe('haiku-5-5')
  // Tokens are the sum of all model calls (63000 + 154000), not the result's totalTokens (12345: the last call).
  expect((await first.find({ type: 'Text', text: /^217\.0k tokens/ }))?.text).toBe('217.0k tokens · 1m 5s · $0.02')
  expect(await first.find({ type: 'Text', text: /12\.3k/ })).toBeUndefined()
  // A model without a price shows no price.
  expect((await first.find({ type: 'Text', text: /^2\.0k tokens/ }))?.text).toBe('2.0k tokens · 3s')
  expect((await first.find({ type: 'Text', text: /^4s$/ }))?.text).toBe('4s')
  await first.unmount()

  // A background agent: the launch has no totals, its turn.complete brings them.
  await $.tool.call({ tool: 'Agent', description: 'Background scan', prompt: 'x' })
  const running = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await running.find({ type: 'Text', text: /^running$/ }))?.text).toBe('running')
  await running.unmount()
  // 2000×2 + 100000×2.50 + 1000000×0.20 + 20000×10 = $0.654.
  await step('b1', { model: 'claude-sonnet-5-5', input_tokens: 2000, output_tokens: 20000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 100000 }, 'bg1')
  await $.turn.complete({ answer: 'ok', durationMs: 2000, isAborted: false, turnId: 't1', agentId: 'bg1', reason: 'answer', usage: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const second = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await second.find({ type: 'Text', text: /^running$/ })).toBeUndefined()
  // 2000 + 20000 + 1000000 + 100000 tokens; the turn.complete usage adds nothing more.
  expect((await second.find({ type: 'Text', text: /^1\.1M tokens/ }))?.text).toMatch(/^1\.1M tokens · \d+s · \$0\.65$/)

  const modRows = (await second.findAll({ type: 'Text', text: /^(close-gate|goal-meter|session-panel|other)$/ })).map(one => one.text)
  expect(modRows).toEqual(['close-gate', 'goal-meter'])
  expect((await second.find({ type: 'Text', text: /^live$/ }))?.text).toBe('live')
  expect((await second.find({ type: 'Text', text: /^off$/ }))?.text).toBe('off')
  await second.press({ key: 'mod-goal-meter@nateherk-mods' })
  expect(ran).toEqual(['claude plugin enable goal-meter@nateherk-mods', '/reload-plugins'])
  expect((await second.findAll({ type: 'Text', text: /^live$/ })).length).toBe(2)
  const lines = async () =>
    (await second.findAll({ type: 'Svg' }))
      .filter(one => one.props.alt === 'on' || one.props.alt === 'off') // the avatars are Svgs too
      .map(one => String(one.props.source).match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/)?.[1]) // the track
  expect(await lines()).toEqual(['#4EBA65', '#4EBA65'])
  await second.press({ key: 'mod-goal-meter@nateherk-mods' })
  expect((await second.find({ type: 'Text', text: /^still loaded here$/ }))?.text).toBe('still loaded here')
  expect(await lines()).toEqual(['#4EBA65', '#3A3A3C'])
  await second.unmount()

  await $.tool.call({ tool: PLAN, done: [2], start: 3 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await marks(ui)).toEqual(['✓', '✓', '●'])
    expect((await ui.find({ type: 'Text', text: 'Blue chat · working' }))?.text).toBe('Blue chat · working')
    expect((await ui.find({ type: 'Text', text: '2 of 3 steps' }))?.text).toBe('2 of 3 steps')
    // The chat's critter, the subagents' (haiku teal, an unknown model gray), then one per mod in list order.
    expect(await avatars(ui, surface)).toEqual([BLUE, TEAL, GRAY, TEAL, TEAL, '#F08A5D', '#7FC8A9'])
    // The own cards' titles take the chat color; the borders and the ✓ ● ○ marks keep theirs.
    for (const title of ['Progress', 'Outputs', 'Used', 'Subagents', 'Mods']) {
      expect((await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) }))?.props.color).toBe(BLUE)
    }
    // Each mod's critter has a color of its own, by list order, so no two mods share one.
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).filter(one => one.props.alt === 'close-gate').length).toBe(1)
    expect((await ui.find({ type: 'Text', text: /notes\.md/ }))?.text).toBe('notes.md')
    expect((await ui.find({ type: 'Text', text: /gmail/ }))?.text).toBe('gmail')

    await ui.press({ key: 'toggle-used' })
    expect(await ui.find({ type: 'Text', text: /gmail/ })).toBeUndefined()
    await ui.press({ key: 'toggle-used' })
    await ui.unmount()
  }
})

test('Outputs lists the files made for the person, not edits or the agent own files', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let id = 'abc123-session'
  on('session.id', () => ({ value: id }))
  on('env.get', () => ({ value: '/home/me' }))
  on('command.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('tool.call', { tool: 'Write' }, (_, e) => ({ result: { type: e.content === 'old' ? 'update' : 'create' } }))
  on('tool.call', { tool: 'SendUserFile' }, (_, e) => ({ result: { attachments: e.files.map(path => ({ path, size: 1, isImage: true })) } }))
  on('tool.call', () => ({ result: {} }))
  // On disk: old.pdf is older than the command, the other documents are new, the rest is missing.
  on('fs.stat', (_, e) => {
    if (!/\.(pdf|docx)$/.test(e.path)) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 1, mtimeMs: e.path.endsWith('old.pdf') ? 0 : Date.now(), isLink: false } }
  })

  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/report.md', content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/proj/README.md', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/CHANGELOG.md', content: 'old' })
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/logs/abc123-session.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/home/me/.claude/projects/p/memory/note.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/.gitignore', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/tmp/claude-1000/p/abc123-session/scratchpad/draft.md', content: 'x' })
  await $.tool.call({ tool: 'SendUserFile', files: ['/tmp/claude-1000/p/abc123-session/scratchpad/chart.png'], status: 'normal' })
  await $.tool.call({ tool: 'Artifact', file_path: 'site/index.html' })
  await $.tool.call({ tool: 'Bash', command: 'python render.py --out=out/report.pdf old.pdf' })
  await $.tool.call({ tool: 'Bash', command: 'pandoc report.md -o ~/Downloads/brief.docx' })
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/research.md', content: 'x', agentId: 'a1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/proj/report.md', old_string: 'a', new_string: 'b' })
  id = 'def456-after-clear' // a /clear: a new id, no session.start
  await $.tool.call({ tool: 'Write', file_path: '/work/proj/logs/def456-after-clear.md', content: 'x' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const names = (await ui.findAll({ type: 'Text', text: /\.(md|pdf|docx|html|png|gitignore)$/ })).map(one => one.text)
    expect(names).toEqual(['report.md', 'research.md', 'brief.docx', 'report.pdf', 'index.html', 'chart.png'])
    // No color file here: the chat has the color of its id, read again at each draw (the id changed at the /clear).
    expect((await ui.find({ type: 'Text', text: 'Yellow chat · idle' }))?.text).toBe('Yellow chat · idle')
    expect((await avatars(ui, surface))[0]).toBe('#E2B33A')
    expect((await ui.find({ type: 'Text', text: 'chart.png' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: 'report.pdf' }))?.props.dimColor).toBe(false)
    expect((await ui.find({ type: 'Text', text: 'proj/site' }))?.text).toBe('proj/site')
    expect((await ui.find({ type: 'Text', text: 'me/Downloads' }))?.text).toBe('me/Downloads')
    await ui.unmount()
  }
})

// A worktree session runs inside a hidden folder: only the part below the working folder is tested for hidden names.
test('Outputs lists new files in a worktree session', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create' } }))
  on('tool.call', () => ({ result: {} }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: Date.now(), isLink: false } }))

  await $.session.start({ cwd: '/r/.claude/worktrees/w1', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/r/.claude/worktrees/w1/report.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/r/.claude/worktrees/w1/.git/info.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/r/.claude/notes.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/r/docs/guide.md', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'make out/deck.pdf' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const names = (await ui.findAll({ type: 'Text', text: /\.(md|pdf)$/ })).map(one => one.text)
  expect(names).toEqual(['deck.pdf', 'guide.md', 'report.md'])
  await ui.unmount()
})

// Claude Code 2.1.316 ships /session and refuses a mod that registers a built-in's name.
test('the pane opens at session start when /session is a built-in', async ($, on) => {
  on('command.register', (_, e) => {
    if (e.name === 'session') throw new Error('a built-in name')
    return { value: { command: e.name } }
  })
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))

  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual(['session'])
})

// In the Desktop app a pane opened at session start can be placed but out of sight: the command must show it, not close it.
test('/session-panel shows a placed pane again and closes only on request', async ($, on) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  const calls: string[] = []
  on('ui.open', (_, e) => { calls.push(`open ${e.id}`); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { calls.push(`close ${e.id}`); return { value: undefined } })
  on('ui.panes', () => ({ value: [{ id: 'session', title: 'Session', isShown: true, isFocused: false, isPlaced: true }] }))
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  calls.length = 0
  const request = { origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 80 } }
  expect((await $.command.run({ command: 'session-panel', args: '', ...request })).text).toBe('Session pane opened.')
  expect(calls).toEqual(['close session', 'open session'])
  calls.length = 0
  expect((await $.command.run({ command: 'session-panel', args: 'close', ...request })).text).toBe('Session pane closed.')
  expect(calls).toEqual(['close session'])
})

// The chat's critter takes its pose from the task list; each subagent's avatar takes its color from the model family
// (never a chat color) and its pose from running or done.
test('the header pose follows the steps and the subagent avatars follow the model family', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-a' })) // the id's own color would be orange (0)
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.read', (_, e) => {
    if (e.path !== '/home/me/.claude/mods-data/chat-colors/sess-a.json') throw new Error('ENOENT')
    return { value: '{"color":4}' } // purple
  })
  on('command.list', () => ({ value: [] }))
  on('store.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  const models: Record<string, string> = { Haiku: 'claude-haiku-5-5', Sonnet: 'claude-sonnet-5-5', Opus: 'claude-opus-5-5', Fable: 'claude-fable-5-1', Mystery: 'claude-mystery-9' }
  on('tool.call', { tool: 'Agent' }, (_, e) =>
    e.description === 'Running'
      ? { result: { agentId: 'r1', content: [] } } // no totals yet: the row is running, its model the one asked for
      : { result: { agentId: `a-${e.description}`, resolvedModel: models[String(e.description)], totalTokens: 10, totalDurationMs: 1000, totalToolUseCount: 0, content: [] } },
  )
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  const PURPLE = '#A070D8'
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: 'Purple chat · idle' }))?.text).toBe('Purple chat · idle')
    expect(await ui.find({ type: 'Text', text: /steps$/ })).toBeUndefined()
    expect(await avatars(ui, surface)).toEqual([PURPLE])
    if (surface === 'terminal') expect((await ui.findAll({ type: 'Text', text: '- -' })).length).toBe(1) // closed eyes: idle
    await ui.unmount()
  }

  for (const name of Object.keys(models)) await $.tool.call({ tool: 'Agent', description: name, prompt: 'x' })
  await $.tool.call({ tool: 'Agent', description: 'Running', model: 'opus', prompt: 'x' })
  await $.tool.call({
    tool: PLAN,
    items: [{ content: 'Plan it', status: 'completed' }, { content: 'Build it', status: 'completed' }],
    scope: 'first_task',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: 'Purple chat · done' }))?.text).toBe('Purple chat · done')
    expect((await ui.find({ type: 'Text', text: '2 of 2 steps' }))?.text).toBe('2 of 2 steps')
    // haiku teal, sonnet ice, opus rose, fable amber, anything else gray; the running opus row has its color too.
    expect(await avatars(ui, surface)).toEqual([PURPLE, TEAL, '#5E9BD6', '#D9677C', '#E3A33B', GRAY, '#D9677C'])
    if (surface === 'terminal') {
      // Happy eyes for the header and the five done rows; open eyes for the one that runs.
      expect((await ui.findAll({ type: 'Text', text: '^ ^' })).length).toBe(6)
      expect((await ui.findAll({ type: 'Text', text: '• •' })).length).toBe(1)
    }
    await ui.unmount()
  }
})
