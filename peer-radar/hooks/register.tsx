import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'
import type { Board, Radar, Repo } from '../types'
import { parseBoard, parseCounts, quote, relayTarget, statusText } from './helpers'

const PANE = 'peer-radar'
const radarState = atom({ plugin: 'peer-radar', key: 'radar' } as const, null as Radar | null)
const LIST = 'python3 ~/.claude/hooks/session-register.py --list'
const VAULT = 'systemctl --user show sh-vault-stable-sync.service -p Result -p ActiveEnterTimestamp --value'
const JOURNAL = 'journalctl --user -u sh-vault-stable-sync -n 40 --no-pager'

async function run($: EngineInterface, argv: string[], timeoutMs = 15000) {
  return $.process.run(argv, { timeoutMs })
}

type Runtime = { running: boolean; platform: string; host: string; peerHost: string; repos: string[] }

async function collect($: EngineInterface, runtime: Runtime) {
  if (runtime.running) return
  runtime.running = true
  try {
    const at = await $.clock.now()
    const previous = await read($, radarState)
    let local: Board
    try {
      const result = await run($, ['python3', `${runtime.host}/.claude/hooks/session-register.py`, '--list'])
      local = result.exitCode === 0
        ? parseBoard(result.stdout, at)
        : { sessions: [], raw: [], at, error: result.stderr.split('\n')[0] || 'local board failed' }
    } catch (error) {
      local = { sessions: [], raw: [], at, error: String(error).split('\n')[0] }
    }
    let peer: Board = { sessions: [], raw: [], at, error: 'disabled' }
    if (runtime.peerHost) {
      try {
        const result = await run($, ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', runtime.peerHost, LIST])
        peer = result.exitCode === 0
          ? parseBoard(result.stdout, at)
          : { sessions: [], raw: [], at, error: result.stderr.split('\n')[0] || 'peer board failed' }
      } catch (error) {
        peer = { sessions: [], raw: [], at, error: String(error).split('\n')[0] }
      }
    }
    const sync: Repo[] = []
    const fetchDue = at - Number((await $.store.get('lastFetch')) ?? 0) >= 600000
    if (fetchDue) await $.store.set('lastFetch', at)
    for (const path of runtime.repos) {
      const full = path === '~' ? runtime.host : path.startsWith('~/') ? runtime.host + path.slice(1) : path
      if (!(await $.fs.exists(full))) continue
      const name = full.split('/').filter(Boolean).pop() || full
      let fetchedAt = previous?.repos.find(repo => repo.name === name)?.fetchedAt
      if (fetchDue) {
        try {
          const fetched = await run($, ['git', '-C', full, 'fetch', '-q'], 20000)
          if (fetched.exitCode === 0) fetchedAt = at
        } catch { /* Keep the last successful fetch time. */ }
      }
      try {
        const counts = await run($, ['git', '-C', full, 'rev-list', '--left-right', '--count', '@{u}...HEAD'])
        const dirty = await run($, ['git', '-C', full, 'status', '--porcelain'])
        const parsed = counts.exitCode === 0 ? parseCounts(counts.stdout.trim()) : undefined
        if (parsed && dirty.exitCode === 0) sync.push({ name, ...parsed, dirty: dirty.stdout.split('\n').filter(Boolean).length, fetchedAt, at })
      } catch { /* A missing upstream omits this row. */ }
    }
    let vault: Radar['vault']
    try {
      const cmd = runtime.platform === 'Linux' ? (command: string) => ['sh', '-c', command]
        : (command: string) => ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', runtime.peerHost, command]
      if (runtime.platform === 'Linux' || runtime.peerHost) {
        const result = await run($, cmd(VAULT))
        if (result.exitCode === 0 && result.stdout.trim()) {
          const [value = '', active = ''] = result.stdout.trim().split(/\r?\n/)
          const journal = await run($, cmd(JOURNAL))
          vault = { result: value, active, blocked: journal.exitCode === 0 && journal.stdout.split('\n').filter(line => line.includes('BLOCKED')).length > 0, at }
        }
      }
    } catch { /* The vault row is optional. */ }
    const radar: Radar = { local, peer, repos: sync, vault, platform: runtime.platform, host: runtime.host, at }
    await update($, radarState, () => radar)
    await $.ui.status(statusText(radar))
  } catch {
    // A collector failure must not block a session event.
  } finally {
    runtime.running = false
  }
}
export const register: Register = (on, options) => {
  const runtime: Runtime = { running: false, platform: '', host: '', peerHost: '', repos: [] }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'radar', description: 'Show peer sessions and sync health' })
    await $.command.register({ name: 'relay', description: 'Relay text to a local or peer session', argumentHint: '<short-id> <text>' })
    if (e.isInteractive === false) return next(e)
    try {
      const os = await run($, ['uname', '-s'])
      runtime.platform = os.stdout.trim()
      const home = await $.env.get('HOME')
      runtime.host = home || ''
      runtime.peerHost = String(options.peerHost || '')
      if (runtime.peerHost === 'off' || runtime.peerHost.startsWith('-')) runtime.peerHost = ''
      runtime.repos = String(options.repos || '').split(',').map(path => path.trim()).filter(Boolean)
      $.clock.after(5000, () => { void collect($, runtime) })
      $.clock.every(120000, () => { void collect($, runtime) })
    } catch { /* Keep session start available. */ }
    return next(e)
  })

  on('command.run', { command: 'radar' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Peer radar' })
    return { text: 'Peer radar opened.' }
  })

  on('command.run', { command: 'relay' }, async ($, e) => {
    const match = /^(\S+)\s+([\s\S]+)$/.exec(e.args.trim())
    if (!match) return { text: 'Use /relay <short-id> <text>.' }
    const radar = await read($, radarState)
    if (!radar) return { text: 'No board yet. Use /radar and Refresh.' }
    const target = relayTarget(match[1]!, radar)
    if (!target) return { text: `Unknown id. Known ids: ${[...radar.local.sessions, ...radar.peer.sessions].map(s => s.id).join(', ') || 'none'}.` }
    if (target === 'peer' && !runtime.peerHost) return { text: 'Peer is disabled.' }
    const argv = target === 'local'
      ? ['python3', `${runtime.host}/.claude/hooks/session-register.py`, '--announce', match[1]!, '--text', match[2]!]
      : ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', runtime.peerHost, `python3 ~/.claude/hooks/session-register.py --announce ${quote(match[1]!)} --text ${quote(match[2]!)}`]
    try {
      const result = await run($, argv)
      return { text: (result.exitCode === 0 ? result.stdout : result.stderr).trim().split('\n')[0] || `Relay exited ${result.exitCode}.` }
    } catch (error) {
      return { text: String(error).split('\n')[0] }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const radar = await read($, radarState)
    const now = await $.clock.now()
    const rows = [<Button key="refresh" label="Refresh" onPress={() => collect($, runtime)} />]
    if (!radar) rows.push(<Text>Waiting for the first collection.</Text>)
    else {
      rows.push(<Text>This machine ({radar.platform === 'Darwin' ? 'macOS' : 'Linux'})</Text>)
      rows.push(...radar.local.sessions.map(s => <Text>{s.state} {s.id} {s.workspace} {s.age} {s.claim}</Text>))
      rows.push(...radar.local.raw.map(line => <Text>{line}</Text>))
      rows.push(<Text>Peer</Text>)
      if (radar.peer.error) rows.push(<Text>{radar.peer.error}</Text>)
      rows.push(...radar.peer.sessions.map(s => <Text>{s.state} {s.id} {s.workspace} {s.age} {s.claim}</Text>))
      rows.push(...radar.peer.raw.map(line => <Text>{line}</Text>))
      rows.push(<Text>Sync</Text>)
      rows.push(...radar.repos.map(repo => <Text>{repo.name}: ahead {repo.ahead}, behind {repo.behind}, dirty {repo.dirty}, fetched {repo.fetchedAt === undefined ? 'never' : `${Math.floor((now - repo.fetchedAt) / 60000)}m ago`}</Text>))
      if (radar.vault) rows.push(<Text>Vault: {radar.vault.blocked ? 'BLOCKED' : radar.vault.result} {radar.vault.active}</Text>)
    }
    return h(Box, { flexDirection: 'column' }, ...rows) as RenderElement
  })
}
