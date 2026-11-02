import { test, expect, mock } from 'claude-code/testing'
import type { Radar } from '../types'
import { parseBoard, parseCounts, quote, relayTarget, statusText } from './helpers'

const table = [
  'STATE    ID      KIND    WORKSPACE                  AGE    MAIL   NAME      CLAIM',
  'active   a1b2    codex   /work/one                  2m     0      Alice     build the long item then verify the result',
  'idle     c3d4    claude  /work/two                  8m     1      Bob       waiting for review',
].join('\n')

function sample(): Radar {
  return {
    local: parseBoard(table, 1000),
    peer: parseBoard(table.replace('a1b2', 'e5f6').replace('c3d4', 'g7h8'), 1000),
    repos: [{ name: '_WAJBKODING', behind: 0, ahead: 0, dirty: 0, fetchedAt: 1000, at: 1000 }],
    platform: 'Darwin', host: '/Users/test', at: 1000,
  }
}

test('board parser keeps two sessions and the long claim', () => {
  const board = parseBoard(table, 1000)
  expect(board.sessions.length).toBe(2)
  expect(board.sessions[0]?.id).toBe('a1b2')
  expect(board.sessions[0]?.claim).toBe('build the long item then verify the result')
  expect(parseBoard('garbage\nother text', 1000).raw).toEqual(['garbage', 'other text'])
})

test('count parser and shell quoting', () => {
  expect(parseCounts('3\t1')).toEqual({ behind: 3, ahead: 1 })
  expect(quote(`it's "fine"; rm -rf /`)).toBe(`'it'\\''s "fine"; rm -rf /'`)
})

test('relay target selects cached boards and unknown ids', () => {
  const radar = sample()
  expect(relayTarget('a1b2', radar)).toBe('local')
  expect(relayTarget('e5f6', radar)).toBe('peer')
  expect(relayTarget('missing', radar)).toBeUndefined()
})

test('status covers healthy, offline, behind, and vault blocked', () => {
  const radar = sample()
  expect(statusText(radar)).toBe('radar: macOS 2 · peer 2 · sync ok')
  radar.peer.error = 'offline'
  expect(statusText(radar)).toMatch('peer offline')
  radar.repos[0]!.behind = 2
  expect(statusText(radar)).toMatch('sync: _WAJBKODING behind 2')
  radar.vault = { result: 'success', active: 'today', blocked: true, at: 1000 }
  expect(statusText(radar)).toMatch('vault BLOCKED')
})

test('pane renders on terminal and desktop', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'peer-radar', surface, component: 'Pane', requestId: 'peer-radar', props: { title: 'Peer radar', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20, offset: 0 }, view: {} } })
    expect(await ui.find({ key: 'refresh' }), 'refresh button').toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Waiting for the first collection.' }), 'waiting text').toBeDefined()
    await ui.unmount()
  }
})

test('relay command sends to local or peer and lists unknown ids', { options: { peerHost: 'peer.example' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    const command = e.argv.join(' ')
    const stdout = command === 'uname -s' ? 'Darwin\n'
      : command.includes('--list') ? (command.startsWith('ssh') ? table.replace('a1b2', 'e5f6').replace('c3d4', 'g7h8') : table)
      : 'delivered\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  const request = { origin: { kind: 'composer' } as const, presentation: { isFullscreen: false, columns: 80 } }
  expect((await $.command.run({ command: 'relay', args: 'a1b2 hello', ...request })).text).toBe('delivered')
  expect(calls.at(-1)?.[0]).toBe('python3')
  expect((await $.command.run({ command: 'relay', args: `e5f6 it's "fine"; rm -rf /`, ...request })).text).toBe('delivered')
  expect(calls.at(-1)?.[0]).toBe('ssh')
  expect(calls.at(-1)?.at(-1)).toBe(`python3 ~/.claude/hooks/session-register.py --announce 'e5f6' --text 'it'\\''s "fine"; rm -rf /'`)
  expect((await $.command.run({ command: 'relay', args: 'missing hello', ...request })).text).toMatch('a1b2, c3d4, e5f6, g7h8')
})

test('stored time throttles collections across sessions', { options: { repos: '~/_WAJBKODING', peerHost: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on, { lastFetch: 10000 })
  mock.env(on, { HOME: '/Users/test' })
  let fetches = 0
  on('process.run', ($, e) => {
    const argv = e.argv
    if (argv.includes('fetch')) {
      fetches += 1
    }
    const stdout = argv[0] === 'uname' ? 'Darwin\n'
      : argv.includes('--list') ? table
      : argv.includes('rev-list') ? '0\t0\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  expect(fetches).toBe(0)
  await clock.advance(120000)
  expect(fetches).toBe(1)
  await clock.advance(120000)
  expect(fetches).toBe(1)
})

test('headless session schedules no collector or remote work', async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  let runs = 0
  on('process.run', () => { runs++; throw new Error('unexpected process') })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await clock.advance(120000)
  expect(runs).toBe(0)
})


test('desktop attach after a headless start begins collection', { options: { peerHost: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  let lists = 0
  on('process.run', ($, e) => {
    if (e.argv.includes('--list')) lists++
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : e.argv.includes('--list') ? table : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.attach', ($, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await clock.advance(120000)
  expect(lists).toBe(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.advance(5000)
  expect(lists).toBe(1)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:two' })
  await clock.advance(120000)
  expect(lists).toBe(2)
})

test('a headless start with the desktop already attached begins collection', { options: { peerHost: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  let lists = 0
  on('process.run', ($, e) => {
    if (e.argv.includes('--list')) lists++
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : e.argv.includes('--list') ? table : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await clock.advance(5000)
  expect(lists).toBe(1)
})

test('default configuration does not contact a peer or fetch personal repositories', async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  const calls: string[][] = []
  on('process.run', ($, e) => {
    calls.push([...e.argv])
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : e.argv.includes('--list') ? table : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  expect(calls.some(argv => argv[0] === 'ssh')).toBe(false)
  expect(calls.some(argv => argv.includes('fetch'))).toBe(false)
})

// Three local rows: a1b2 has a full id and a color file, c3d4 has no full id, f1e2 has a full id and a bad file.
const claimed = [
  'a1b2c3d4-0000-4000-8000-000000000001', 'f1e2a3b4-0000-4000-8000-000000000003',
].flatMap(id => [`${id}.json`, `${id}.md`]).concat('c3d4e5f6-stub.md', 'a1b2c3d4-0000-4000-8000-000000000001.plan.md')
const three = [table, 'blocked  f1e2    claude  /work/three                9m     0      Carol     asks a question'].join('\n')
const entry = (name: string) => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })

test('collected pane draws cards with critters in chat colors and folds a card', { options: { peerHost: 'off' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => { store.set(e.key, e.value); return { value: undefined } })
  mock.env(on, { HOME: '/Users/test' })
  on('process.run', ($, e) => {
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n' : e.argv.includes('--list') ? three : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', ($, e) => {
    if (e.path !== '/Users/test/.claude/session-claims') throw new Error('ENOENT')
    return { value: claimed.map(entry) }
  })
  on('fs.read', ($, e) => {
    if (e.path === '/Users/test/.claude/mods-data/chat-colors/a1b2c3d4-0000-4000-8000-000000000001.json') return { value: '{"color":5}' }
    if (e.path === '/Users/test/.claude/mods-data/chat-colors/f1e2a3b4-0000-4000-8000-000000000003.json') return { value: 'not json' }
    throw new Error('ENOENT')
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  const props = { title: 'Peer radar', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20, offset: 0 }, view: {} } as const
  // a1b2: the file says brown (5). c3d4: no full id, so the hash of the short id (green). f1e2: a bad file, so the hash of the full id (blue).
  const hexes = ['#A06A47', '#5DAE5B', '#4A8FE0']
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'peer-radar', surface, component: 'Pane', requestId: 'peer-radar', props })
    expect(await ui.find({ type: 'Text', text: 'This machine (macOS)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Peer is disabled.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No repositories configured.' })).toBeDefined()
    // The session rows have no status glyph now: only the disabled-peer mark is left.
    expect((await ui.findAll({ type: 'Text', text: /^[●○✓✗]$/ })).map(one => one.props.color)).toEqual(['inactive'])
    if (surface === 'desktop') {
      const drawn = await ui.findAll({ type: 'Svg' })
      expect(drawn.map(one => one.props.alt)).toEqual(['a1b2', 'c3d4', 'f1e2'])
      drawn.forEach((one, i) => expect(String(one.props.source)).toContain(hexes[i]!))
      // Poses: a1b2 works (running legs), c3d4 sleeps (z), f1e2 waits (?).
      expect(String(drawn[0]!.props.source)).toContain('calcMode="discrete"')
      expect(String(drawn[1]!.props.source)).toContain('>z<')
      expect(String(drawn[2]!.props.source)).toContain('>?<')
    } else {
      expect((await ui.findAll({ type: 'Text', text: '▐' })).map(one => one.props.color)).toEqual(hexes)
      expect((await ui.findAll({ type: 'Text', text: /^(• •|- -)$/ })).map(one => one.text)).toEqual(['• •', '- -', '• •'])
    }
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'peer-radar', surface: 'desktop', component: 'Pane', requestId: 'peer-radar', props })
  await ui.press({ key: 'toggle-local' })
  expect(await ui.find({ type: 'Text', text: /a1b2/ })).toBeUndefined()
  expect(store.get('collapsed')).toEqual({ local: true })
  await ui.press({ key: 'toggle-local' })
  expect(await ui.find({ type: 'Text', text: /a1b2/ })).toBeDefined()
})

test('peer rows and a failed claims listing use the hash color of the short id', { options: { peerHost: 'peer.example' } }, async ($, on) => {
  const clock = mock.clock(on, { now: 600000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    const stdout = e.argv[0] === 'uname' ? 'Darwin\n'
      : command.includes('--list') ? (command.startsWith('ssh') ? table.replace('a1b2', 'e5f6').replace('c3d4', 'g7h8') : table)
      : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => { throw new Error('EACCES') })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.advance(5000)
  const props = { title: 'Peer radar', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20, offset: 0 }, view: {} } as const
  // Local a1b2, c3d4, then peer e5f6, g7h8: orange, green, purple, orange.
  const hexes = ['#E8853D', '#5DAE5B', '#A070D8', '#E8853D']
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'peer-radar', surface, component: 'Pane', requestId: 'peer-radar', props })
    if (surface === 'desktop') {
      const drawn = await ui.findAll({ type: 'Svg' })
      expect(drawn.map(one => one.props.alt)).toEqual(['a1b2', 'c3d4', 'e5f6', 'g7h8'])
      drawn.forEach((one, i) => expect(String(one.props.source)).toContain(hexes[i]!))
    } else {
      expect((await ui.findAll({ type: 'Text', text: '▐' })).map(one => one.props.color)).toEqual(hexes)
    }
    await ui.unmount()
  }
})
