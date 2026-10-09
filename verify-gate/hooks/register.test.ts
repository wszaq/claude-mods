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
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['base'] } as any))
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
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
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
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
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
