import { test, expect, mock } from 'claude-code/testing'
import { countOpenItems, parseGit, parseLsof, parseSs } from './register'

const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 2 }, view: {},
}

function base(on: Parameters<typeof mock.clock>[0]) {
  on('tool.register', ($, e) => ({ value: { tool: `mcp__close-gate__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
}

function world(on: Parameters<typeof mock.clock>[0], status: string, items = '', claim = 'working') {
  base(on)
  const clock = mock.clock(on, { now: 40000 })
  mock.env(on, { HOME: '/home/test' })
  on('session.root', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('process.run', ($, e) => {
    const command = e.argv[0]
    const stdout = command === 'uname' ? 'Linux\n'
      : command === 'git' && e.argv.includes('status') ? status
      : command === 'git' ? 'worktree /repo\n\n'
      : command === 'lsof' ? 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n'
      : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('.md') ? items : JSON.stringify({ claim }) }))
  return clock
}

test('all-clear band appears on terminal and desktop', async ($, on) => {
  const clock = world(on, '## main\n')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'close-gate', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /close-gate: ready to close · 0s ago/ })).toBeDefined()
    await ui.redraw({ ...BAND, hasSurvey: true })
    expect(await ui.find({ type: 'Text', text: /close-gate/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('band shows changed, unpushed and open items', async ($, on) => {
  const clock = world(on, '## main...origin/main [ahead 2]\n M a\n?? b\n', '- [ ] one\n- [ ] two\n')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'close-gate', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /2 changed · 2 unpushed · open items 2/ })).toBeDefined()
    await ui.unmount()
  }
})

test('band falls through before collection', async ($, on) => {
  base(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'close-gate', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: /close-gate/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('running_state tool returns cached facts', async ($, on) => {
  const clock = world(on, '## main...origin/main [ahead 2]\n M a\n', '- [ ] one\n')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await clock.settle()
  const answer = await $.tool.call({ tool: 'mcp__close-gate__running_state' })
  expect(answer.result).toContain('1 changed, 2 unpushed')
  expect(answer.result).toContain('Open items: 1')
})

test('close prompt gets facts and unrelated prompt stays unchanged', async ($, on) => {
  const clock = world(on, '## main\n')
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await clock.settle()
  const close = await $.prompt.submit({ text: 'are we done?', wait: false, origin: { kind: 'composer' } })
  expect(close.text).toContain('\n\n[close-gate facts, 0s old]')
  const other = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: { kind: 'composer' } })
  expect(other.context).toBeUndefined()
  expect(other.text).toBe('fix the bug')
})

test('close prompt keeps all five fact lines', async ($, on) => {
  const claim = 'Working on the close check. '.repeat(9)
  const clock = world(on, '## main...origin/main [ahead 2, behind 1]\n M a\n', '- [ ] finish review\n', claim)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await clock.settle()
  const close = await $.prompt.submit({ text: 'are we done?', wait: false, origin: { kind: 'composer' } })
  const output = close.text ?? ''
  const block = output.slice(output.indexOf('[close-gate facts, '))
  expect(block).toContain('Git: 1 changed, 2 unpushed, 1 behind, 0 extra worktrees')
  expect(block).toContain('Dev ports: none')
  expect(block).toContain(`Claim: ${claim}`)
  expect(block).toContain('Open items: 1')
  expect(block).toContain('Age: 0s ago')
  expect(block.length <= 1200).toBe(true)
})

test('close prompt caps long facts at a line boundary', async ($, on) => {
  const clock = world(on, '## main\n', '', 'C'.repeat(1300))
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await clock.settle()
  const close = await $.prompt.submit({ text: 'are we done?', wait: false, origin: { kind: 'composer' } })
  const output = close.text ?? ''
  const block = output.slice(output.indexOf('[close-gate facts, '))
  expect(block.length <= 1200).toBe(true)
  expect(block.endsWith('Dev ports: none')).toBe(true)
  expect(block.includes('Claim:')).toBe(false)
})

test('parsers count git files, ports and open items', () => {
  expect(parseGit('## main...origin/main [ahead 2, behind 1]\n M a\nA  b\n?? c\n')).toEqual({ changed: 3, ahead: 2, behind: 1 })
  expect(parseLsof('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 100 me 20u IPv4 1 0t0 TCP *:3000 (LISTEN)\npython3 2 me 3u IPv6 2 0t0 TCP [::1]:8000 (LISTEN)\nChrome 3 me 4u IPv4 3 0t0 TCP *:9000 (LISTEN)\n')).toEqual(['node:3000', 'python3:8000'])
  expect(parseSs('LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1,fd=9))\n')).toEqual(['node:3000'])
  expect(countOpenItems('- [ ] one\n- [x] done\n - [ ] nested\n- [ ] two\n')).toBe(2)
})
