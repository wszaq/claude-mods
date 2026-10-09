import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/repo'
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 'one', reason: 'answer' as const }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 80, scroll: { top: 0, bodyRows: 4 }, view: {} } as any

function fixture(on: On, files: Record<string, string>, exitCode = 0, delay = false, gitRoot: string | null = ROOT) {
  const clock = mock.clock(on, { now: 100000 })
  // A test-side hook instead of mock.session, which the 2.1.292 kit lacks.
  const rows: any[] = []
  on('session.append', ($, e, next) => { rows.push(e); return next(e) })
  const session = { appended: () => rows }
  const spawned: string[][] = []
  const runs: { argv: string[]; cwd?: string }[] = []
  let code = exitCode
  let output: string | undefined
  let release: (() => void) | undefined
  mock.env(on, { HOME: '/home/test' })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  on('process.run', ($, e) => {
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd })
    return { value: {
      exitCode: e.argv[0] === 'git' && gitRoot === null ? 1 : 0,
      stdout: e.argv[0] === 'git' ? gitRoot ?? '' : e.argv[1]?.endsWith('plain-check.py') ? 'note.md:1: one flag\n-- summary\n-- 0 over limit\n' : 'Darwin',
      stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
    } }
  })
  on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv])
    if (delay) await new Promise<void>(resolve => { release = resolve })
    yield { stream: 'stdout' as const, text: output ?? (code ? 'failure\n' : 'success\n') }
    return { value: { code, signal: null } }
  })
  on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { filePath: e.file_path } } as any))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', { command: 'verify' }, () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'MARKER' }))
  return { clock, session, spawned, runs, setExitCode: (value: number) => { code = value }, setOutput: (value: string | undefined) => { output = value }, releaseProcess: () => release?.() }
}

async function editAndFinish($: any, clock: { advance(ms: number): Promise<void> }, file: string) {
  await $.tool.call({ tool: 'Write', file_path: file, content: 'x' })
  await $.turn.complete(TURN)
  await clock.advance(0)
}

test('verify.json wins over a sibling Python test', async ($, on) => {
  const kit = fixture(on, {
    '/repo/.claude/verify.json': JSON.stringify({ command: ['make', 'check'], match: ['*.py'] }),
    '/repo/test_a.py': '',
  })
  await editAndFinish($, kit.clock, '/repo/a.py')
  expect(kit.spawned).toEqual([['make', 'check']])
})

test('a recursive match includes a file at the top of its directory', async ($, on) => {
  const kit = fixture(on, { '/repo/.claude/verify.json': JSON.stringify({ command: ['make', 'check'], match: ['src/**/*.py'] }) })
  await editAndFinish($, kit.clock, '/repo/src/a.py')
  expect(kit.spawned).toEqual([['make', 'check']])
})

test('selects the sibling test and changed test files', async ($, on) => {
  const kit = fixture(on, { '/repo/test_a.py': '' })
  await editAndFinish($, kit.clock, '/repo/a.py')
  expect(kit.spawned).toEqual([['python3', '-I', '/repo/test_a.py']])
})

test('runs a changed test file', async ($, on) => {
  const kit = fixture(on, { '/repo/test_a.py': '' })
  await editAndFinish($, kit.clock, '/repo/test_a.py')
  expect(kit.spawned).toEqual([['python3', '-I', '/repo/test_a.py']])
})

test('selects npm test when its script is real', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) })
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toEqual([['npm', 'test', '--silent']])
  expect(kit.session.appended()).toHaveLength(0)
})

test('selects pytest.ini', async ($, on) => {
  const kit = fixture(on, { '/repo/pytest.ini': '' })
  await editAndFinish($, kit.clock, '/repo/a.py')
  expect(kit.spawned).toEqual([['python3', '-m', 'pytest', '-q', '-x']])
})

test('ignores the npm placeholder and finds pytest', async ($, on) => {
  const kit = fixture(on, {
    '/repo/package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    '/repo/pyproject.toml': '[tool.pytest.ini_options]\n',
  })
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toEqual([['python3', '-m', 'pytest', '-q', '-x']])
})

test('does not run without a check or without an edit', async ($, on) => {
  const kit = fixture(on, {})
  await $.turn.complete(TURN)
  await kit.clock.advance(0)
  expect(kit.spawned).toHaveLength(0)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toHaveLength(0)
})

test('a pass adds no note and a failure adds one note', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) }, 1)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.session.appended()).toHaveLength(1)
  expect(kit.session.appended()[0]?.message.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('failed (exit 1)') })
  await kit.clock.advance(0)
  expect(kit.session.appended()).toHaveLength(1)
})

test('the same failure is noted once until its signature changes or a check passes', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) }, 1)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.session.appended()).toHaveLength(1)
  kit.setOutput('different failure\n')
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.session.appended()).toHaveLength(2)
  kit.setExitCode(0)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.session.appended()).toHaveLength(2)
  kit.setExitCode(1)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.session.appended()).toHaveLength(3)
})

test('off stops automatic runs', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) })
  await $.command.run({ command: 'verify', args: 'off' } as any)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toHaveLength(0)
  await $.command.run({ command: 'verify', args: 'on' } as any)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toHaveLength(1)
})

test('Markdown advisory shows only the flag count', async ($, on) => {
  const kit = fixture(on, { '/home/test/.claude/skills/plain-language/plain-check.py': '' })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await editAndFinish($, kit.clock, '/repo/note.md')
  expect(kit.spawned).toHaveLength(0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'verify-gate', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ type: 'Text' }))?.text).toContain('1 flag')
    await ui.unmount()
  }
})

test('Markdown outside git gets an advisory in its own directory and no test check', async ($, on) => {
  const kit = fixture(on, {
    '/home/test/.claude/skills/plain-language/plain-check.py': '',
    '/vault/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }),
  }, 0, false, null)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
  await editAndFinish($, kit.clock, '/vault/note.md')
  expect(kit.spawned).toHaveLength(0)
  expect(kit.runs.some(run => run.argv[1]?.endsWith('plain-check.py') && run.cwd === '/vault' && run.argv[2] === '/vault/note.md')).toBe(true)
})

test('manual verify runs despite a config match filter', async ($, on) => {
  const kit = fixture(on, { '/repo/.claude/verify.json': JSON.stringify({ command: ['make', 'check'], match: ['*.py'] }) })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await $.command.run({ command: 'verify', args: '' } as any)
  await kit.clock.advance(0)
  expect(kit.spawned).toEqual([['make', 'check']])
})

test('band shows running, pass, and fail on terminal and desktop', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) }, 0, true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'verify-gate', surface, component: 'AbovePrompt', props: BAND })
    kit.setExitCode(0)
    await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    await $.turn.complete(TURN)
    await kit.clock.advance(0)
    expect((await ui.find({ type: 'Text' }))?.text).toContain('running')
    expect(await ui.find({ type: 'Text', text: 'MARKER' })).toBeDefined()
    kit.releaseProcess()
    await kit.clock.advance(0)
    expect((await ui.find({ type: 'Text' }))?.text).toContain('✓ npm test')
    kit.setExitCode(1)
    await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'y' })
    await $.turn.complete(TURN)
    await kit.clock.advance(0)
    kit.releaseProcess()
    await kit.clock.advance(0)
    expect((await ui.find({ type: 'Text' }))?.text).toContain('✗ npm test exit 1')
    await ui.unmount()
  }
})

test('empty band leaves only MARKER on terminal and desktop', async ($, on) => {
  fixture(on, {})
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'verify-gate', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.drawn()).type).toBe('Text')
    expect(await ui.find({ type: 'Text', text: 'MARKER' })).toBeDefined()
    await ui.unmount()
  }
})

test('headless session does not run an automatic check', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(kit.spawned).toHaveLength(0)
  expect(kit.runs.some(run => run.argv[0] === 'git')).toBe(false)
})

test('failed check offers log and rerun, keeps MARKER, and adds a footer mode', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) }, 1)
  const opened: string[] = []
  let modes: string[] = []
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.render', { component: 'SessionMode' }, ($, e) => { modes = e.props.modes; return $.ui.resolve(e).Text({ children: 'base' }) })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await editAndFinish($, kit.clock, '/repo/a.ts')
  const band = await $.ui.mount({ plugin: 'verify-gate', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: 'MARKER' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'log' })).toBeDefined()
  expect(await band.find({ type: 'Button', text: 'rerun' })).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('"hotkey":"l"')
  expect(JSON.stringify(await band.drawn())).toContain('"hotkey":"r"')
  await band.press({ key: 'log' })
  expect(opened).toEqual(['verify-gate-log'])
  const pane = await $.ui.mount({ plugin: 'verify-gate', surface: 'terminal', component: 'Pane', requestId: 'verify-gate-log', props: { title: 'verify-gate log', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  expect(await pane.find({ type: 'Text', text: 'failure' })).toBeDefined()
  await band.press({ key: 'rerun' })
  await kit.clock.advance(0)
  expect(kit.spawned).toHaveLength(2)
  await $.ui.mount({ plugin: 'verify-gate', surface: 'desktop', component: 'SessionMode', props: { modes: ['earlier'] } as any })
  expect(modes).toEqual(['earlier', 'verify ✗ npm test · /verify log'])
  kit.setExitCode(0)
  await editAndFinish($, kit.clock, '/repo/a.ts')
  expect(await band.find({ type: 'Button', text: 'log' })).toBeUndefined()
  expect(await band.find({ type: 'Button', text: 'rerun' })).toBeUndefined()
  await $.ui.mount({ plugin: 'verify-gate', surface: 'desktop', component: 'SessionMode', props: { modes: ['earlier'] } as any })
  expect(modes).toEqual(['earlier'])
})

test('log pane shows the same last 60 lines as /verify log', async ($, on) => {
  const kit = fixture(on, { '/repo/package.json': JSON.stringify({ scripts: { test: 'node test.js' } }) }, 1)
  kit.setOutput(Array.from({ length: 65 }, (_, index) => `line ${index + 1}`).join('\n'))
  await editAndFinish($, kit.clock, '/repo/a.ts')
  const command = await $.command.run({ command: 'verify', args: 'log' } as any)
  const pane = await $.ui.mount({ plugin: 'verify-gate', surface: 'terminal', component: 'Pane', requestId: 'verify-gate-log', props: { title: 'verify-gate log', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
  const output = command.text ?? ''
  expect(output.split('\n')).toHaveLength(60)
  expect(output.startsWith('line 6\n')).toBe(true)
  expect((await pane.find({ type: 'Text' }))?.text).toBe(output)
})
