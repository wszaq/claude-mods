import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CheckView } from '../types'

const changed = atom({ plugin: 'verify-gate', key: 'changed' } as const, [] as string[])
const enabled = atom({ plugin: 'verify-gate', key: 'enabled' } as const, true)
const view = atom({ plugin: 'verify-gate', key: 'view' } as const, null as CheckView | null)
const lastFailure = atom({ plugin: 'verify-gate', key: 'lastFailure' } as const, null as string | null)
const logPane = 'verify-gate-log'

type Check = { argv: string[]; cwd: string; name: string; timeoutMs: number }

const directory = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
const absolute = (path: string, cwd: string) => path.startsWith('/') ? path : `${cwd}/${path}`
const relative = (path: string, root: string) => path.slice(root.length + 1)

function matches(path: string, glob: string): boolean {
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*').replace(/\u0001/g, '(?:.*/)?')
  return new RegExp(`^${pattern}$`).test(path)
}

async function rootOf($: EngineInterface, path: string): Promise<string | null> {
  const result = await $.process.run(['git', '-C', directory(path), 'rev-parse', '--show-toplevel'])
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function record($: EngineInterface, path: string, cwd: string): Promise<void> {
  try { await update($, changed, old => [...new Set([...old, absolute(path, cwd)])]) } catch { /* Observation must not block the edit. */ }
}

async function choose($: EngineInterface, root: string, files: string[], manual = false): Promise<Check | null> {
  const configPath = `${root}/.claude/verify.json`
  if (await $.fs.exists(configPath)) {
    const config = JSON.parse(await $.fs.read(configPath)) as { command?: unknown; timeoutSec?: unknown; match?: unknown }
    if (!Array.isArray(config.command) || !config.command.length || !config.command.every(value => typeof value === 'string')) return null
    const globs = Array.isArray(config.match) && config.match.every(value => typeof value === 'string') ? config.match as string[] : ['**']
    if (!manual && !files.some(file => globs.some(glob => matches(relative(file, root), glob)))) return null
    const seconds = typeof config.timeoutSec === 'number' && config.timeoutSec > 0 ? config.timeoutSec : 120
    return { argv: config.command as string[], cwd: root, name: (config.command as string[]).join(' '), timeoutMs: Math.min(seconds * 1000, 600000) }
  }

  for (const file of files) {
    const name = file.slice(file.lastIndexOf('/') + 1)
    if (!name.endsWith('.py')) continue
    const test = name.startsWith('test_') ? file : `${directory(file)}/test_${name}`
    if (await $.fs.exists(test)) return { argv: ['python3', '-I', test], cwd: directory(test), name: test.slice(test.lastIndexOf('/') + 1), timeoutMs: 120000 }
  }

  const packagePath = `${root}/package.json`
  if (await $.fs.exists(packagePath)) {
    const pkg = JSON.parse(await $.fs.read(packagePath)) as { scripts?: { test?: string } }
    const test = pkg.scripts?.test
    if (test && !test.includes('Error: no test specified')) return { argv: ['npm', 'test', '--silent'], cwd: root, name: 'npm test', timeoutMs: 120000 }
  }

  if (await $.fs.exists(`${root}/pytest.ini`) || await $.fs.exists(`${root}/pyproject.toml`) && (await $.fs.read(`${root}/pyproject.toml`)).includes('[tool.pytest')) {
    return { argv: ['python3', '-m', 'pytest', '-q', '-x'], cwd: root, name: 'pytest', timeoutMs: 120000 }
  }
  return null
}

let cwd = ''
let home = ''
let platform = ''
const active = new Map<string, { cancel: () => void }>()

async function run($: EngineInterface, root: string, files: string[], manual = false, advisoryOnly = false): Promise<void> {
  const prior = active.get(root)
  prior?.cancel()
  let cancelled = false
  const current = { cancel: () => { cancelled = true } }
  active.set(root, current)
  if (!(await read($, enabled))) { active.delete(root); return }

  let check: Check | null
  try { check = advisoryOnly ? null : await choose($, root, files, manual) } catch { active.delete(root); return }
  if (cancelled) return
  const markdown = files.filter(file => file.endsWith('.md'))
  if (!check && (!markdown.length || !home)) { active.delete(root); return }

  if (check) {
    await update($, view, () => ({ kind: 'running', name: check!.name, exitCode: 0, output: '', at: 0 }))
    const stream = $.process.spawn({ argv: check.argv, cwd: check.cwd })
    let stopped = false
    let timedOut = false
    const cancel = () => { stopped = true; void stream.return({ code: null, signal: null }).catch(() => {}) }
    current.cancel = cancel
    const timer = $.clock.after(check.timeoutMs, () => { timedOut = true; cancel() })
    let output = ''
    let exitCode = 1
    try {
      for await (const chunk of stream) output = (output + chunk.text).slice(-65536)
      exitCode = (await stream.result).code ?? 1
    } catch { output += timedOut ? '\nTimed out.' : '\nCould not run the check.' }
    timer.cancel()
    if (stopped && !timedOut) return
    if (active.get(root) !== current) return
    active.delete(root)
    const result: CheckView = { kind: exitCode === 0 ? 'pass' : 'fail', name: check.name, exitCode, output, at: await $.clock.now() }
    await update($, view, () => result)
    if (exitCode === 0) await update($, lastFailure, () => null)
    else {
      const lines = output.trimEnd().split('\n').slice(-15).join('\n')
      const signature = JSON.stringify([check.argv.join(' '), exitCode, lines])
      if (signature !== await read($, lastFailure)) {
        try {
          const note = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: `verify-gate: ${check.argv.join(' ')} failed (exit ${exitCode}) after the last edits. Last lines:\n${lines}` }] } })
          if (note.deny === undefined) await update($, lastFailure, () => signature)
        } catch { /* Engines before 2.1.293 have no session.append: the band still shows the failure. */ }
      }
    }
  }

  if (markdown.length && home && platform) {
    const script = `${home}/.claude/skills/plain-language/plain-check.py`
    if (await $.fs.exists(script)) {
      try {
        const report = await $.process.run(['python3', script, ...markdown], { cwd: root, timeoutMs: 120000 })
        const flags = report.stdout.split('\n').filter(line => line.trim() && !line.startsWith('-- ')).length
        const label = `${flags} ${flags === 1 ? 'flag' : 'flags'}`
        if (check) await update($, view, old => old?.name === check!.name ? { ...old, flags } : old)
        else {
          const at = await $.clock.now()
          await update($, view, () => ({ kind: 'pass', name: `plain language ${label}`, exitCode: 0, output: label, at }))
        }
      } catch { /* The advisory never fails the check. */ }
    }
  }
  if (active.get(root) === current) active.delete(root)
}

async function schedule($: EngineInterface, files: string[]): Promise<void> {
  const groups = new Map<string, string[]>()
  const advisories = new Map<string, string[]>()
  for (const file of files) {
    let root: string | null = null
    try {
      root = await rootOf($, file)
    } catch { /* A path outside git can still get a Markdown advisory. */ }
    if (root) groups.set(root, [...(groups.get(root) ?? []), file])
    else if (file.endsWith('.md')) {
      const dir = directory(file)
      advisories.set(dir, [...(advisories.get(dir) ?? []), file])
    }
  }
  for (const [root, paths] of groups) void run($, root, paths)
  for (const [dir, paths] of advisories) void run($, dir, paths, false, true)
}

async function runManual($: EngineInterface): Promise<string> {
  if (!(await read($, enabled))) return 'verify-gate: off'
  $.clock.after(0, () => { void (async () => {
    const root = await rootOf($, `${cwd}/.`)
    if (root) await run($, root, [cwd], true)
  })() })
  return 'verify-gate: scheduled'
}

export const register: Register = on => {
  let interactive = true
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive !== false
    cwd = e.cwd
    try {
      home = await $.env.get('HOME') ?? ''
      platform = (await $.process.run(['uname', '-s'])).stdout.trim()
      await $.command.register({ name: 'verify', description: 'Run or control the repo check.' })
    } catch { /* Verification must not stop the session. */ }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await record($, e.file_path, cwd)
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await record($, e.file_path, cwd)
    return result
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined && result.isError !== true) await record($, e.notebook_path, cwd)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      if (interactive && !e.agentId) {
        const files = await read($, changed)
        if (files.length) {
          await update($, changed, () => [])
          if (await read($, enabled)) $.clock.after(0, () => { void schedule($, files) })
        }
      }
    } catch { /* Observation must not block the turn. */ }
    return next(e)
  })

  on('command.run', { command: 'verify' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      await update($, enabled, () => false)
      for (const run of active.values()) run.cancel()
      active.clear()
      return { text: 'verify-gate: off' }
    }
    if (arg === 'on') { await update($, enabled, () => true); return { text: 'verify-gate: on' } }
    if (arg === 'log') {
      const last = await read($, view)
      return { text: last?.output.split('\n').slice(-60).join('\n') || 'verify-gate: no output' }
    }
    if (arg) return { text: 'Usage: /verify [on|off|log]' }
    return { text: await runManual($) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const last = await read($, view)
      if (e.props.hasSurvey || !last) return next(e)
      const { Box, Text, Button } = $.ui.resolve(e)
      const age = last.kind === 'pass' ? ` ${Math.floor(((await $.clock.now()) - last.at) / 1000)}s ago` : ''
      const flags = last.flags === undefined ? '' : ` — ${last.flags} ${last.flags === 1 ? 'flag' : 'flags'}`
      const label = last.kind === 'running' ? `verify-gate: running… ${last.name}` : last.kind === 'pass' ? `verify-gate: ✓ ${last.name}${age}${flags}` : `verify-gate: ✗ ${last.name} exit ${last.exitCode}${flags}`
      const below = await next(e)
      const mine = <Box columnGap={2}><Text dimColor={last.kind === 'pass'}>{label}</Text>{last.kind === 'fail' && <><Button key="log" label="log" hotkey="l" plain onPress={() => $.ui.open({ id: logPane, title: 'verify-gate log' })} /><Button key="rerun" label="rerun" hotkey="r" plain onPress={() => runManual($)} /></>}</Box>
      return <Box flexDirection="column">{mine}{below}</Box>
    } catch { return next(e) }
  })

  on('ui.render', { component: 'Pane', requestId: logPane }, async ($, e, next) => {
    try {
      const { Text } = $.ui.resolve(e)
      const last = await read($, view)
      return <Text>{last?.output.split('\n').slice(-60).join('\n') || 'verify-gate: no output'}</Text>
    } catch { return next(e) }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      const last = await read($, view)
      if (last?.kind !== 'fail') return next(e)
      const modes = Array.isArray(e.props.modes) ? e.props.modes : []
      return next({ ...e, props: { ...e.props, modes: [...modes, `verify ✗ ${last.name} · /verify log`] } })
    } catch { return next(e) }
  })
}
