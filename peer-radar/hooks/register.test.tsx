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
  expect(statusText(radar)).toBe('radar: mac 2 · thinkpad 2 · sync ok')
  radar.peer.error = 'offline'
  expect(statusText(radar)).toMatch('thinkpad offline')
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

test('relay command sends to local or peer and lists unknown ids', async ($, on) => {
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
