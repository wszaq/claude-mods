import { test, expect, mock } from 'claude-code/testing'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const stat = (mtimeMs: number) => ({ kind: 'file' as const, size: 1, mtimeMs, isLink: false })
const PANE = { title: 'Deliverables', isFocused: true, bodyColumns: 80, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const command = (args = '') => ({ command: 'ship', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } })

test('Bash records only recent existing deliverables and ignores txt', async ($, on) => {
  const clock = mock.clock(on, { now: 200000 })
  mock.env(on, { HOME: '/home/user' })
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('fs.stat', ($, e) => {
    if (e.path === '/work/out/My Deck.pptx') return { value: stat(199000) }
    if (e.path === '/work/out/old.pdf') return { value: stat(1000) }
    if (e.path === '/work/out/note.md') return { value: stat(199000) }
    throw new Error('ENOENT')
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'python3 build.py --out "out/My Deck.pptx" out/old.pdf out/missing.pdf out/note.txt out/note.md' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'deliverable-dock', surface: 'terminal', component: 'Pane', requestId: 'deliverable-dock', props: PANE })
  expect(await ui.find({ text: 'My Deck.pptx' })).toBeDefined()
  expect(await ui.find({ text: 'old.pdf' })).toBeUndefined()
  expect(await ui.find({ text: 'note.txt' })).toBeUndefined()
  expect(await ui.find({ text: 'note.md' })).toBeUndefined()
})

test('Bash flushes queued paths once and does no idle scans', async ($, on) => {
  const checked: string[] = []
  const clock = mock.clock(on, { now: 200000 })
  mock.env(on, { HOME: '/home/user' })
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('fs.stat', ($, e) => { checked.push(e.path); return { value: stat(199000) } })
  await $.session.start(START)
  await clock.advance(1000)
  expect(checked).toHaveLength(0)
  await $.tool.call({ tool: 'Bash', command: 'echo note.txt' })
  await clock.settle()
  expect(checked).toHaveLength(0)
  await $.tool.call({ tool: 'Bash', command: 'build out/a.pdf' })
  await $.tool.call({ tool: 'Bash', command: 'build out/b.pdf' })
  await clock.settle()
  expect(checked).toEqual(['/work/out/a.pdf', '/work/out/b.pdf'])
  await clock.advance(1000)
  expect(checked).toHaveLength(2)
})

test('/ship reports no files', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/user' })
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start(START)
  expect((await $.command.run(command())).text).toBe('No deliverables recorded in this session yet.')
})

test('/ship selects newest and second newest with collision names on macOS', async ($, on) => {
  mock.clock(on, { now: 200000 })
  mock.env(on, { HOME: '/home/user' })
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => ({ value: e.path === '/home/user/Downloads' || e.path === '/home/user/Downloads/a.pdf' || e.path === '/home/user/Downloads/a (2).pdf' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/work/b.pdf', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/work/a.pdf', content: '' })
  await $.tool.call({ tool: 'Write', file_path: '/work/note.md', content: '' })
  expect((await $.command.run(command())).text).toBe('Shipped a (3).pdf to Downloads')
  expect((await $.command.run(command('2'))).text).toBe('Shipped b.pdf to Downloads')
  expect(calls).toContainEqual(['cp', '-n', '/work/a.pdf', '/home/user/Downloads/a (3).pdf'])
  expect(calls).toContainEqual(['open', '/home/user/Downloads/a (3).pdf'])
  expect(calls).toContainEqual(['cp', '-n', '/work/b.pdf', '/home/user/Downloads/b.pdf'])
})

test('Linux opens shipped files with xdg-open', async ($, on) => {
  mock.clock(on)
  mock.env(on, { HOME: '/home/user' })
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Linux\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => ({ value: e.path === '/home/user/Downloads' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/work/a.pdf', content: '' })
  expect((await $.command.run(command())).text).toBe('Shipped a.pdf to Downloads')
  expect(calls).toContainEqual(['xdg-open', '/home/user/Downloads/a.pdf'])
})

test('pane shows rows and actions on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 200000 })
  mock.env(on, { HOME: '/home/user' })
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/work/a.pdf', content: '' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'deliverable-dock', surface, component: 'Pane', requestId: 'deliverable-dock', props: PANE })
    expect(await ui.find({ text: 'a.pdf' })).toBeDefined()
    for (const label of ['Open', 'Reveal', 'Copy path', 'Ship']) expect(await ui.find({ type: 'Button', text: label })).toBeDefined()
    await ui.unmount()
  }
})

test('headless session does not record Write or Bash deliverables', async ($, on) => {
  const clock = mock.clock(on, { now: 200000 })
  let runs = 0
  let stats = 0
  on('process.run', () => { runs++; throw new Error('unexpected process') })
  on('fs.stat', () => { stats++; throw new Error('unexpected stat') })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Write' }, ($, e) => ({ result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await $.tool.call({ tool: 'Write', file_path: '/work/a.pdf', content: '' })
  await $.tool.call({ tool: 'Bash', command: 'build /work/b.pdf' })
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'deliverable-dock', surface: 'terminal', component: 'Pane', requestId: 'deliverable-dock', props: PANE })
  expect(await ui.find({ text: 'No deliverables recorded in this session yet.' })).toBeDefined()
  expect(runs).toBe(0)
  expect(stats).toBe(0)
})
