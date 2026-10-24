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

test('the three cards follow the session', async ($, on) => {
  on('command.register', () => ({ value: { command: 'session' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Agent' }, (_, e) =>
    e.description === 'Background scan'
      ? { result: { agentId: 'bg1', content: [] } }
      : { result: { agentId: 'a1', resolvedModel: 'claude-haiku-5-5', totalTokens: 12345, totalDurationMs: 65000, totalToolUseCount: 3, content: [] } },
  )
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer, reason: 'answer' as const }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('settings.read', () => ({
    value: { 'close-gate@claude-mods': true, 'goal-meter@nateherk-mods': false, 'session-panel@claude-mods': true, 'other@elsewhere': true },
  }))

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
  await $.tool.call({ tool: 'Agent', description: 'Scan the vault', subagent_type: 'Explore', prompt: 'x' })

  const marks = async (ui: { findAll: (q: object) => Promise<{ text?: string }[]> }) =>
    (await ui.findAll({ type: 'Text', text: /^[✓●○]$/ })).map(one => one.text)

  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await marks(first)).toEqual(['✓', '●', '○'])
  const files = (await first.findAll({ type: 'Text', text: /\.(md|txt)$/ })).map(one => one.text)
  expect(files).toEqual(['notes.md', 'tmp.txt'])
  const chips = (await first.findAll({ type: 'Text', text: /^(ask-me|Web search|gmail|ccd_view)$/ })).map(one => one.text)
  expect(chips).toEqual(['ask-me', 'Web search', 'gmail'])
  expect((await first.find({ type: 'Text', text: /Scan the vault/ }))?.text).toBe('Scan the vault')
  expect((await first.find({ type: 'Text', text: /haiku/ }))?.text).toBe('haiku-5-5')
  expect((await first.find({ type: 'Text', text: /tokens/ }))?.text).toBe('12.3k tokens · 1m 5s')
  await first.unmount()

  // A background agent: the launch has no totals, its turn.complete brings them.
  await $.tool.call({ tool: 'Agent', description: 'Background scan', prompt: 'x' })
  const running = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await running.find({ type: 'Text', text: /^running$/ }))?.text).toBe('running')
  await running.unmount()
  await $.turn.complete({ answer: 'ok', durationMs: 2000, isAborted: false, turnId: 't1', agentId: 'bg1', reason: 'answer', usage: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  const second = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await second.find({ type: 'Text', text: /^running$/ })).toBeUndefined()
  expect((await second.find({ type: 'Text', text: /^1\.5k tokens/ }))?.text).toMatch(/^1\.5k tokens · \d+s$/)

  const modRows = (await second.findAll({ type: 'Text', text: /^(close-gate|goal-meter|session-panel|other)$/ })).map(one => one.text)
  expect(modRows).toEqual(['close-gate', 'goal-meter'])
  await second.unmount()

  await $.tool.call({ tool: PLAN, done: [2], start: 3 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await marks(ui)).toEqual(['✓', '✓', '●'])
    expect((await ui.find({ type: 'Text', text: /notes\.md/ }))?.text).toBe('notes.md')
    expect((await ui.find({ type: 'Text', text: /gmail/ }))?.text).toBe('gmail')

    await ui.press({ key: 'toggle-used' })
    expect(await ui.find({ type: 'Text', text: /gmail/ })).toBeUndefined()
    await ui.press({ key: 'toggle-used' })
    await ui.unmount()
  }
})
