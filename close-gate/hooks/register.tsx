import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Facts } from '../types'
import { card, mark } from './look'
import { COLOR_DIR, POSE, card as critterCard, cardsOn, chatColor, critter, hashColor, parseColor, stack } from './critter.mjs'

const facts = atom({ plugin: 'close-gate', key: 'facts' } as const, null)
const dismissed = atom({ plugin: 'close-gate', key: 'dismissed' } as const, [] as string[])
const collapsed = atom({ plugin: 'close-gate', key: 'collapsed' } as const, {} as Record<string, boolean>)
const pane = 'close-gate'
const CLOSE = /\b(are we done|what('?s| is) left|anything left|good to close|can we close|ready to close|we('re| are| r)? done|wrap up|handoff)\b/i
const DEV = /^(node|python|python3|bun|deno|vite|next|ruby|php)$/
const HINT = 'Call the `mcp__close-gate__running_state` tool for git, worktree, port, claim and open-item facts instead of running git, ps or lsof by hand.'

export function parseGit(text: string) {
  const lines = text.trimEnd().split('\n')
  const branch = lines[0] ?? ''
  return {
    changed: lines.slice(1).filter(line => /^[ MARCUD?!]{2} /.test(line)).length,
    ahead: Number(branch.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(branch.match(/behind (\d+)/)?.[1] ?? 0),
  }
}

export function parseLsof(text: string) {
  const found = new Set<string>()
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    const name = fields[0]?.toLowerCase()
    const port = line.match(/:(\d+)\s*\(LISTEN\)/)?.[1]
    if (name && DEV.test(name) && port) found.add(`${name}:${port}`)
  }
  return [...found].slice(0, 5)
}

export function parseSs(text: string) {
  const found = new Set<string>()
  for (const line of text.split('\n')) {
    const name = line.match(/users:\(\("([^"]+)"/)?.[1]?.toLowerCase()
    const port = line.match(/\s(?:\[.*?\]|\S+):(\d+)\s/)?.[1]
    if (name && DEV.test(name) && port) found.add(`${name}:${port}`)
  }
  return [...found].slice(0, 5)
}

export function countOpenItems(text: string) {
  return text.split('\n').filter(line => /^- \[ \] /.test(line)).length
}

function age(now: number, at: number) {
  return `${Math.max(0, Math.floor((now - at) / 1000))}s ago`
}

type Item = { kind: string; text: string; tip: string }

// One band item per kind of fact. Dismiss stores the kinds, so a changed count keeps its item hidden.
export function items(f: Facts): Item[] {
  return [
    ...(f.changed ? [{ kind: 'changed', text: `${f.changed} changed`, tip: 'Commit or stash the changes.' }] : []),
    ...(f.ahead ? [{ kind: 'unpushed', text: `${f.ahead} unpushed`, tip: 'Push the commits, or open a PR in a deploy repo.' }] : []),
    ...(f.behind ? [{ kind: 'behind', text: `${f.behind} behind`, tip: 'Pull the upstream commits before you push.' }] : []),
    ...(f.worktrees ? [{ kind: 'worktrees', text: `${f.worktrees} worktree${f.worktrees === 1 ? '' : 's'}`, tip: 'Merge or remove the extra worktrees (git worktree list).' }] : []),
    ...f.ports.map(port => ({ kind: `port:${port}`, text: `port ${port}`, tip: `Stop the dev server on ${port} if nothing needs it.` })),
    ...(f.openItems ? [{ kind: 'open-items', text: `open items ${f.openItems}`, tip: 'Finish each open item, or tag it DECISION, BLOCKED, SCOPE or PARKED.' }] : []),
  ]
}

async function shown($: EngineInterface, f: Facts): Promise<Item[]> {
  const hide = await read($, dismissed)
  return items(f).filter(item => !hide.includes(item.kind))
}

async function dismiss($: EngineInterface): Promise<void> {
  const f = await read($, facts)
  if (f) await update($, dismissed, all => [...new Set([...all, ...items(f).map(item => item.kind)])])
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: pane, title: 'close-gate' })
}

function factText(f: Facts | null, now: number) {
  if (!f) return 'close-gate: no facts yet'
  const clear = !f.changed && !f.ahead && !f.behind && !f.worktrees && !f.ports.length && !f.openItems
  return [
    ...(clear ? ['close-gate: ready to close'] : []),
    `Git: ${f.git ? `${f.changed} changed, ${f.ahead} unpushed, ${f.behind} behind, ${f.worktrees} extra worktrees` : 'not a git repo'}`,
    `Dev ports: ${f.ports.join(', ') || 'none'}`,
    `Claim: ${f.claim || 'none'}`,
    `Open items: ${f.openItems}`,
    `Age: ${age(now, f.at)}`,
  ].join('\n')
}

// This chat's color: Cache Keeper's file for it, else the id's own color, as Nate's mods do.
async function chatHex($: EngineInterface): Promise<string> {
  const id = await $.session.id()
  try {
    const path = `${(await $.env.get('HOME')) ?? ''}${COLOR_DIR}/${id}.json`
    const picked = parseColor(await $.fs.read(path))
    if (picked !== null) return chatColor(picked).hex
  } catch { /* No file: the id's own color. */ }
  return chatColor(hashColor(id)).hex
}

type Collector = { linux: boolean | null }

async function collect($: EngineInterface, state: Collector) {
  try {
    const root = await $.session.root()
    const sessionId = await $.session.id()
    const home = await $.env.get('HOME')
    if (state.linux === null) {
      const platform = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
      state.linux = platform.stdout.trim() === 'Linux'
    }
    const gitStatus = await $.process.run(['git', '-C', root, 'status', '--porcelain=v1', '--branch'], { timeoutMs: 3000 }).catch(() => null)
    const git = gitStatus?.exitCode === 0
    const parsed = git ? parseGit(gitStatus.stdout) : { changed: 0, ahead: 0, behind: 0 }
    const trees = git
      ? await $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain'], { timeoutMs: 3000 }).catch(() => null)
      : null
    const worktrees = trees?.exitCode === 0
      ? Math.max(0, trees.stdout.split('\n').filter(line => line.startsWith('worktree ')).length - 1)
      : 0
    const lsof = await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN'], { timeoutMs: 3000 }).catch(() => null)
    const ss = state.linux && !lsof
      ? await $.process.run(['ss', '-ltnp'], { timeoutMs: 3000 }).catch(() => null)
      : null
    const ports = lsof?.exitCode === 0 ? parseLsof(lsof.stdout) : ss?.exitCode === 0 ? parseSs(ss.stdout) : []
    let claim = ''
    let openItems = 0
    if (home) {
      const base = `${home}/.claude/session-claims/${sessionId}`
      try {
        const data = JSON.parse(await $.fs.read(`${base}.json`)) as { claim?: unknown }
        if (typeof data.claim === 'string') claim = data.claim
      } catch {}
      try {
        openItems = countOpenItems(await $.fs.read(`${base}.md`))
      } catch {}
    }
    const at = await $.clock.now()
    const next: Facts = { at, ...parsed, worktrees, ports, claim, openItems, git }
    await update($, facts, () => next)
    // A dismissed kind that cleared shows again when it comes back.
    const kinds = items(next).map(item => item.kind)
    const hide = await read($, dismissed)
    if (hide.some(kind => !kinds.includes(kind))) await update($, dismissed, all => all.filter(kind => kinds.includes(kind)))
  } catch {}
}

// Restore the folds, then collect the facts at once and every minute. Session start and a surface that attaches later both call it.
async function startCollecting($: EngineInterface, state: Collector) {
  try {
    const saved = await $.store.get('collapsed') as Record<string, boolean> | undefined
    if (saved) await update($, collapsed, () => saved)
  } catch {}
  $.clock.after(0, () => { void collect($, state) })
  $.clock.every(60000, () => { void collect($, state) })
}

export const register: Register = on => {
  let interactive = true
  const state: Collector = { linux: null }
  on('session.start', async ($, e, next) => {
    // The desktop app drives the engine through the SDK: isInteractive is false there, so a surface also counts.
    const live = e.isInteractive !== false || (await $.session.surfaces().catch(() => [])).some(surface => surface !== 'terminal')
    interactive = live
    await $.tool.register({
      name: 'running_state',
      description: 'Running state of this session for a handoff or a close check: uncommitted and unpushed git changes, worktrees, listening dev ports, the session claim and open items. Call this instead of running git, ps or lsof by hand.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    })
    await $.command.register({ name: 'closeok', description: 'Show the cached close check, its tips pane, or dismiss the band.', argumentHint: '[tips|dismiss]' })
    if (!live) return next(e)

    await startCollecting($, state)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (e.surface !== 'terminal' && !interactive) {
      interactive = true
      await startCollecting($, state)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const f = await read($, facts)
      if (!f || e.props.hasSurvey) return next(e)
      const left = await shown($, f)
      if (left.length === 0) return next(e)
      const el = $.ui.resolve(e)
      const { Box, Text, Button } = el
      const below = await next(e)
      const hex = await chatHex($)
      const text = `close-gate: ${left.map(item => item.text).join(' · ')} · ${age(await $.clock.now(), f.at)}`
      const mine = critterCard(el, hex, [<Box key="close-gate" columnGap={2}>{critter(el, e.surface, hex, POSE.waiting, 20, 'close-gate')}<Text>{text}{' '}</Text><Box flexShrink={0} columnGap={2}><Button key="tips" label="tips" hotkey="c" plain onPress={() => openPane($)} /><Button key="dismiss" label="Dismiss" hotkey="x" plain onPress={() => dismiss($)} /></Box></Box>], 1)
      return stack(el, mine, below, cardsOn(e, el))
    } catch { return next(e) }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      const f = await read($, facts)
      const left = f ? await shown($, f) : []
      if (left.length === 0) return next(e)
      const modes = Array.isArray(e.props.modes) ? e.props.modes : []
      return next({ ...e, props: { ...e.props, modes: [...modes, `${left.length} to close · /closeok tips`] } })
    } catch { return next(e) }
  })

  on('ui.render', { component: 'Pane', requestId: pane }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit
    const f = await read($, facts)
    const shut = await read($, collapsed)
    const all = f ? items(f) : []
    const fold = (id: string) => ({
      isShut: shut[id] === true,
      onToggle: async () => {
        const value = await update($, collapsed, folds => ({ ...folds, [id]: !folds[id] }))
        await $.store.set('collapsed', value)
      },
    })
    const factRows = !f ? <Text dimColor>No facts yet.</Text> : [
      <Text key="git">{mark(kit, f.git && !f.changed && !f.ahead && !f.behind && !f.worktrees ? 'done' : f.git ? 'warn' : 'idle')} Git: {f.git ? `${f.changed} changed, ${f.ahead} unpushed, ${f.behind} behind, ${f.worktrees} extra worktrees` : 'not a git repo'}</Text>,
      <Text key="ports">{mark(kit, f.ports.length ? 'warn' : 'done')} Dev ports: {f.ports.join(', ') || 'none'}</Text>,
      <Text key="claim">{mark(kit, f.claim ? 'active' : 'idle')} Claim: {f.claim || 'none'}</Text>,
      <Text key="open">{mark(kit, f.openItems ? 'warn' : 'done')} Open items: {f.openItems}</Text>,
      <Text key="age" dimColor>Age: {age(await $.clock.now(), f.at)}</Text>,
    ]
    const tips = !f ? <Text dimColor>No tips yet.</Text> : all.length === 0 ? <Text>{mark(kit, 'done')} Ready to close.</Text> : all.map(item => (
      <Box key={`tip-${item.kind}`} flexDirection="column" marginBottom={1}>
        <Text>{mark(kit, 'warn')} {item.text}</Text>
        <Text dimColor>{item.tip}</Text>
      </Box>
    ))
    return <Box flexDirection="column">
      {card(kit, 'tips', 'Tips', tips, fold('tips'))}
      {card(kit, 'facts', 'Close facts', factRows, fold('facts'))}
    </Box>
  })

  on('tool.call', { tool: 'mcp__close-gate__running_state' }, async ($, e, next) => {
    try { return { result: factText(await read($, facts), await $.clock.now()) } }
    catch { return next(e) }
  })

  on('skill.prompt', { skill: 'session-handoff' }, async ($, e, next) => {
    if (!interactive) return next(e)
    try {
      const result = await next(e)
      return { text: `${result.text}\n${HINT}` }
    } catch { return next(e) }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!interactive) return next(e)
    try {
      if (!CLOSE.test(e.text)) return next(e)
      const f = await read($, facts)
      if (!f) return next(e)
      const now = await $.clock.now()
      let block = `[close-gate facts, ${Math.max(0, Math.floor((now - f.at) / 1000))}s old]\n${factText(f, now)}`
      while (block.length > 1200) block = block.slice(0, block.lastIndexOf('\n'))
      return next({ ...e, text: `${e.text}\n\n${block}` })
    } catch { return next(e) }
  })

  on('command.run', { command: 'closeok' }, async ($, e, next) => {
    try {
      const args = e.args.trim()
      if (args === 'tips') {
        await openPane($)
        return { text: 'close-gate pane opened.' }
      }
      if (args === 'dismiss') {
        await dismiss($)
        return { text: 'close-gate: band dismissed until a new kind of fact shows.' }
      }
      if (args) return { text: 'Usage: /closeok [tips|dismiss]' }
      return { text: factText(await read($, facts), await $.clock.now()) }
    } catch { return next(e) }
  })
}
