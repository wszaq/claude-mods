import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'
import type { Board, Radar, Repo, Session } from '../types'
import { COLOR_DIR, POSE, chatColor, critter, hashColor, parseColor } from './critter.mjs'
import { parseBoard, parseCounts, quote, relayTarget, statusText } from './helpers'
import { card, mark } from './look'

const PANE = 'peer-radar'
const radarState = atom({ plugin: 'peer-radar', key: 'radar' } as const, null as Radar | null)
const collapsed = atom({ plugin: 'peer-radar', key: 'collapsed' } as const, {} as Record<string, boolean>)
const FULL_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:json|md)$/
const LIST = 'python3 ~/.claude/hooks/session-register.py --list'
const VAULT = 'systemctl --user show sh-vault-stable-sync.service -p Result -p ActiveEnterTimestamp --value'
const JOURNAL = 'journalctl --user -u sh-vault-stable-sync -n 40 --no-pager'

async function run($: EngineInterface, argv: string[], timeoutMs = 15000) {
  return $.process.run(argv, { timeoutMs })
}

// The pose of a row's critter, from the board state.
function poseOf(state: string) {
  const key = state.toUpperCase()
  return key === 'BUSY' || key === 'ACTIVE' ? POSE.working : key === 'IDLE' ? POSE.idle : POSE.waiting
}

// The chat color index of each local row, by short id. The short id starts the full session id, which
// the claims folder names. Cache Keeper's file for the full id wins, else the hash of the full id,
// as the session's own mods draw it. With no full id, the hash of the short id.
async function localColors($: EngineInterface, home: string, sessions: Session[]): Promise<Record<string, number>> {
  const colors: Record<string, number> = {}
  let names: string[] = []
  try {
    names = (await $.fs.list(`${home}/.claude/session-claims`)).map(entry => entry.name)
  } catch { /* No claims folder: hash the short ids. */ }
  const uuids = names.flatMap(name => { const match = FULL_ID.exec(name); return match ? [match[1]!] : [] })
  for (const { id } of sessions) {
    const full = uuids.find(uuid => uuid.startsWith(id))
    colors[id] = hashColor(full ?? id)
    if (!full) continue
    try {
      const picked = parseColor(await $.fs.read(`${home}${COLOR_DIR}/${full}.json`))
      if (picked !== null) colors[id] = picked
    } catch { /* No file: the id's own color. */ }
  }
  return colors
}

type Runtime = { running: boolean; started: boolean; platform: string; host: string; peerHost: string; repos: string[] }

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
    const colors = await localColors($, runtime.host, local.sessions)
    const radar: Radar = { local, peer, repos: sync, vault, colors, platform: runtime.platform, host: runtime.host, at }
    await update($, radarState, () => radar)
    await $.ui.status(statusText(radar))
  } catch {
    // A collector failure must not block a session event.
  } finally {
    runtime.running = false
  }
}

// The start-up work of a session that has a surface: the saved folds, the platform, the options and the
// collect timers. Session start and a surface that attaches later both call it; it runs once.
async function startUp($: EngineInterface, runtime: Runtime, options: PluginOptions) {
  if (runtime.started) return
  runtime.started = true
  try {
    const saved = await $.store.get('collapsed') as Record<string, boolean> | undefined
    if (saved) await update($, collapsed, () => saved)
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
}

export const register: Register = (on, options) => {
  const runtime: Runtime = { running: false, started: false, platform: '', host: '', peerHost: '', repos: [] }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'radar', description: 'Show peer sessions and sync health' })
    await $.command.register({ name: 'relay', description: 'Relay text to a local or peer session', argumentHint: '<short-id> <text>' })
    // The desktop app drives the engine through the SDK: isInteractive is false there, so a surface also counts.
    if (e.isInteractive !== false || (await $.session.surfaces().catch(() => [])).some(surface => surface !== 'terminal')) await startUp($, runtime, options)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface !== 'terminal') await startUp($, runtime, options)
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
    const kit = $.ui.resolve(e)
    const { Box, Text, Button } = kit
    const radar = await read($, radarState)
    const shut = await read($, collapsed)
    const now = await $.clock.now()
    const fold = (id: string) => ({
      isShut: shut[id] === true,
      onToggle: async () => {
        const value = await update($, collapsed, all => ({ ...all, [id]: !all[id] }))
        await $.store.set('collapsed', value)
      },
    })
    const refresh = <Button key="refresh" plain onPress={() => collect($, runtime)}><Text dimColor>↻ Refresh</Text></Button>
    if (!radar) return <Box flexDirection="column"><Text dimColor>Waiting for the first collection.</Text>{refresh}</Box>
    const board = (id: string, title: string, b: Board, colors?: Record<string, number>) => card(kit, id, title, [
      b.error === 'disabled' && <Text key="error" dimColor>{mark(kit, 'idle')} Peer is disabled.</Text>,
      b.error && b.error !== 'disabled' && <Text key="error">{mark(kit, 'fail')} {b.error}</Text>,
      ...b.sessions.map(s => (
        <Box key={`session-${s.id}`} flexDirection="row" gap={1} alignItems="center">
          {critter(kit, e.surface, chatColor(colors?.[s.id] ?? hashColor(s.id)).hex, poseOf(s.state), 16, s.id)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" gap={1}>
              <Text bold>{s.id}</Text>
              <Text dimColor>{`${s.state} · ${s.age}`}</Text>
              <Text dimColor wrap="truncate-end">{s.workspace}</Text>
            </Box>
            <Text wrap="truncate-end">{s.claim}</Text>
          </Box>
        </Box>
      )),
      ...b.raw.map((line, i) => <Text key={`raw-${i}`} dimColor>{line}</Text>),
      !b.error && b.sessions.length === 0 && b.raw.length === 0 && <Text key="none" dimColor>No sessions.</Text>,
    ], fold(id))
    const clean = (repo: Repo) => repo.ahead === 0 && repo.behind === 0 && repo.dirty === 0
    return (
      <Box flexDirection="column">
        {board('local', `This machine (${radar.platform === 'Darwin' ? 'macOS' : 'Linux'})`, radar.local, radar.colors)}
        {board('peer', 'Peer', radar.peer)}
        {card(kit, 'sync', 'Sync', radar.repos.length === 0 ? <Text dimColor>No repositories configured.</Text> : radar.repos.map(repo => (
          <Box key={`repo-${repo.name}`} flexDirection="row" gap={1}>
            <Text>{mark(kit, clean(repo) ? 'done' : 'warn')} {repo.name}: ahead {repo.ahead}, behind {repo.behind}, dirty {repo.dirty}</Text>
            <Text dimColor>fetched {repo.fetchedAt === undefined ? 'never' : `${Math.floor((now - repo.fetchedAt) / 60000)}m ago`}</Text>
          </Box>
        )), fold('sync'))}
        {radar.vault && card(kit, 'vault', 'Vault', (
          <Text>{mark(kit, radar.vault.blocked ? 'fail' : 'done')} {radar.vault.blocked ? 'BLOCKED' : radar.vault.result} <Text dimColor>{radar.vault.active}</Text></Text>
        ), fold('vault'))}
        {refresh}
      </Box>
    )
  })
}
