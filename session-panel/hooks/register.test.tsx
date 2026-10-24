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
  on('tool.call', () => ({ result: {} }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))

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
  await $.tool.call({ tool: 'WebSearch', query: 'x' })
  await $.tool.call({ tool: 'mcp__gmail__search', q: 'x' })
  await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'diff' })

  const marks = async (ui: { findAll: (q: object) => Promise<{ text?: string }[]> }) =>
    (await ui.findAll({ type: 'Text', text: /^[✓●○]$/ })).map(one => one.text)

  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await marks(first)).toEqual(['✓', '●', '○'])
  const files = (await first.findAll({ type: 'Text', text: /\.(md|txt)$/ })).map(one => one.text)
  expect(files).toEqual(['notes.md', 'tmp.txt'])
  const chips = (await first.findAll({ type: 'Text', text: /^(ask-me|Web search|gmail|ccd_view)$/ })).map(one => one.text)
  expect(chips).toEqual(['ask-me', 'Web search', 'gmail'])
  await first.unmount()

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
