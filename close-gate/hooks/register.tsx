import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Facts } from '../types'

const facts = atom({ plugin: 'close-gate', key: 'facts' } as const, null)
const hidden = atom({ plugin: 'close-gate', key: 'hidden' } as const, false)
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

function bandText(f: Facts, now: number) {
  const parts = [
    f.changed ? `${f.changed} changed` : '',
    f.ahead ? `${f.ahead} unpushed` : '',
    f.behind ? `${f.behind} behind` : '',
    f.worktrees ? `${f.worktrees} worktree${f.worktrees === 1 ? '' : 's'}` : '',
    f.ports.length ? `ports ${f.ports.join(', ')}` : '',
    f.openItems ? `open items ${f.openItems}` : '',
  ].filter(Boolean)
  return `close-gate: ${parts.length ? parts.join(' · ') : 'ready to close'} · ${age(now, f.at)}`
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

export const register: Register = on => {
  let interactive = true
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive !== false
    await $.tool.register({
      name: 'running_state',
      description: 'Running state of this session for a handoff or a close check: uncommitted and unpushed git changes, worktrees, listening dev ports, the session claim and open items. Call this instead of running git, ps or lsof by hand.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    })
    await $.command.register({ name: 'closeok', description: 'Show the cached close check.' })
    if (!interactive) return next(e)

    let linux: boolean | null = null
    const collect = async () => {
      try {
        const root = await $.session.root()
        const sessionId = await $.session.id()
        const home = await $.env.get('HOME')
        if (linux === null) {
          const platform = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
          linux = platform.stdout.trim() === 'Linux'
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
        const ss = linux && !lsof
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
        await update($, facts, () => ({ at, ...parsed, worktrees, ports, claim, openItems, git }))
      } catch {}
    }
    $.clock.after(0, () => { void collect() })
    $.clock.every(60000, () => { void collect() })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const f = await read($, facts)
      if (!f || e.props.hasSurvey || await read($, hidden)) return next(e)
      const { Box, Text, Button } = $.ui.resolve(e)
      const clear = !f.changed && !f.ahead && !f.behind && !f.worktrees && !f.ports.length && !f.openItems
      const below = await next(e)
      if (clear) return below
      const mine = <Box columnGap={2}><Text>{bandText(f, await $.clock.now())}{' '}</Text><Box flexShrink={0}><Button key="hide" label="Hide" hotkey="x" plain onPress={() => update($, hidden, () => true)} /></Box></Box>
      return <Box flexDirection="column">{mine}{below}</Box>
    } catch { return next(e) }
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
    try { return { text: factText(await read($, facts), await $.clock.now()) } }
    catch { return next(e) }
  })
}
