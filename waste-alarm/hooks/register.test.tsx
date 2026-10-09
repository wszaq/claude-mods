import { expect, mock, test } from 'claude-code/testing'
import { normalize, parseTips } from './register'

const shellResult = { result: { stdout: '', stderr: '', interrupted: false } }
const processResult = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const sample = '[repeat] Cut repeated calls\n  Use one check per session.\n[cache] Cache the lookup\n  Save the result.'

test('normalizes a quoted path and parses tips', () => {
  expect(normalize('"$HOME/.local/bin/shared-context" save --help 2>&1 | head -40')).toBe('shared-context save --help')
  expect(normalize('shared-context save --help')).toBe('shared-context save --help')
  expect(parseTips(sample)).toEqual([
    { category: 'repeat', title: 'Cut repeated calls', body: 'Use one check per session.' },
    { category: 'cache', title: 'Cache the lookup', body: 'Save the result.' },
  ])
  expect(parseTips('Token Dashboard: no suggestions')).toEqual([])
})

test('counts calls, ignores prefixes, and toasts once per day', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 12).getTime() })
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('tool.call', { tool: 'Bash' }, () => shellResult)
  on('command.run', { command: 'waste' }, () => ({ text: '' }))

  for (let i = 0; i < 11; i++) await $.tool.call({ tool: 'Bash', command: '"$HOME/.local/bin/shared-context" save --help 2>&1 | head -40' })
  expect(toasts).toEqual(['waste-alarm: "shared-context save --help" ran 10 times today'])
  await $.tool.call({ tool: 'Bash', command: 'git status --short' })
  await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  expect(toasts).toHaveLength(1)

  await clock.advance(86400000)
  for (let i = 0; i < 9; i++) await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  expect(toasts).toHaveLength(1)
  await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  expect(toasts).toHaveLength(2)

  await $.command.run({ command: 'waste', args: 'ignore shared-context', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  for (let i = 0; i < 10; i++) await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  expect(toasts).toHaveLength(2)
})

test('shows tips in the band and a pane on terminal and desktop', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 12).getTime() })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', ($, e) => ({ value: processResult(e.argv[0] === 'uname' ? 'Linux\n' : e.argv.includes('tips') ? sample : '') }))
  on('tool.call', { tool: 'Bash' }, () => shellResult)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/home/test', surface: 'terminal', isInteractive: true })
  await clock.advance(30000)
  await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  await $.command.run({ command: 'waste', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'waste-alarm', surface, component: 'AbovePrompt', props: {
      hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80,
      scroll: { bodyRows: 3, offset: 0 }, view: {},
    } })
    if (!await band.find({ type: 'Text', text: '2 new tips' })) throw new Error(`band tips missing on ${surface}`)
    const pane = await $.ui.mount({ plugin: 'waste-alarm', surface, component: 'Pane', requestId: 'waste-alarm', props: {
      title: 'waste-alarm', isFocused: true, bodyColumns: 80, placement: 'inline',
      scroll: { bodyRows: 20, offset: 0 }, view: {},
    } })
    if (!await pane.find({ type: 'Text', text: 'Cut repeated calls' })) throw new Error(`pane tips missing on ${surface}`)
    if (!await pane.find({ type: 'Text', text: '2 shared-context save --help' })) throw new Error(`pane counts missing on ${surface}`)
    if (surface === 'desktop') {
      await band.press({ key: 'dismiss' })
      expect(await band.find({ type: 'Text', text: 'new tips' })).toBeUndefined()
    }
    await band.unmount()
    await pane.unmount()
  }
})

test('dismissal survives a changed count in the tip title', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 12).getTime() })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  let tipRuns = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', ($, e) => ({ value: processResult(e.argv[0] === 'uname' ? 'Linux\n' : e.argv.includes('tips') ? `[repeat] shared-context ran ${++tipRuns === 1 ? '324' : '1,325.6'} times\n  Check the hook.` : '') }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>base</Text>
  })

  await $.session.start({ cwd: '/home/test', surface: 'terminal', isInteractive: true })
  await clock.advance(30000)
  const band = await $.ui.mount({ plugin: 'waste-alarm', surface: 'terminal', component: 'AbovePrompt', props: {
    hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80,
    scroll: { bodyRows: 3, offset: 0 }, view: {},
  } })
  expect(await band.find({ type: 'Text', text: '1 new tips' })).toBeDefined()
  await band.press({ key: 'dismiss' })
  await clock.advance(7200000)
  expect(tipRuns).toBe(2)
  expect(await band.find({ type: 'Text', text: 'new tips' })).toBeUndefined()
  await band.unmount()
})

test('a second session reuses a recent scan but reads tips', async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 9, 9, 12).getTime() })
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  let scans = 0
  let tipRuns = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', ($, e) => {
    if (e.argv.includes('scan')) scans++
    if (e.argv.includes('tips')) tipRuns++
    return { value: processResult(e.argv[0] === 'uname' ? 'Linux\n' : 'Token Dashboard: no suggestions') }
  })

  await $.session.start({ cwd: '/home/test', surface: 'terminal', isInteractive: true })
  await clock.advance(30000)
  expect(scans).toBe(1)
  expect(tipRuns).toBe(1)
  await $.session.start({ cwd: '/home/test', surface: 'terminal', isInteractive: true })
  await clock.advance(30000)
  expect(scans).toBe(1)
  expect(tipRuns).toBe(2)
})

test('removes old count keys at session start', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 9, 12).getTime() })
  const stored = new Map<string, unknown>([
    ['counts:2026-10-01', { old: 1 }],
    ['shown:2026-10-01', ['old']],
    ['counts:2026-10-02', { recent: 1 }],
  ])
  mock.env(on, {})
  const deleted: string[] = []
  on('store.get', ($, e) => ({ value: stored.get(e.key) }))
  on('store.set', ($, e) => { stored.set(e.key, e.value); return { value: undefined } })
  on('store.keys', () => ({ value: [...stored.keys()] }))
  on('store.delete', ($, e) => { deleted.push(e.key); stored.delete(e.key); return { value: undefined } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: processResult('Linux\n') }))
  on('tool.call', { tool: 'Bash' }, () => shellResult)

  await $.session.start({ cwd: '/home/test', surface: 'terminal', isInteractive: true })
  expect(deleted.sort()).toEqual(['counts:2026-10-01', 'shown:2026-10-01'])
  await $.tool.call({ tool: 'Bash', command: 'shared-context save --help' })
  expect(deleted).toHaveLength(2)
})
