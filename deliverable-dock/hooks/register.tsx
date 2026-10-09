import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Deliverable } from '../types'

const PANE = 'deliverable-dock'
const files = atom({ plugin: 'deliverable-dock', key: 'files' } as const, [] as Deliverable[])
const band = atom({ plugin: 'deliverable-dock', key: 'band' } as const, null as string | null)

function pathParts(path: string) {
  const end = path.lastIndexOf('/')
  return { folder: end === 0 ? '/' : path.slice(0, end), name: path.slice(end + 1) }
}

function absolute(path: string, cwd: string, home: string) {
  const full = path === '~' ? home : path.startsWith('~/') ? home + path.slice(1) : path.startsWith('/') ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return '/' + parts.join('/')
}

function commandPaths(command: string, extensions: Set<string>) {
  const words = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) ?? []
  return words.map(word => word.replace(/^["']|["']$/g, '').replace(/[;,)]$/, ''))
    .filter(word => extensions.has(word.slice(word.lastIndexOf('.')).toLowerCase()))
}

async function record($: EngineInterface, path: string) {
  const recordedAt = await $.clock.now()
  await update($, files, list => [{ path, recordedAt }, ...list.filter(one => one.path !== path)].slice(0, 30))
  await update($, band, () => path)
}

async function open($: EngineInterface, opener: string, path: string) {
  const result = await $.process.run([opener, path])
  if (result.exitCode !== 0) throw new Error('Could not open deliverable')
}

async function ship($: EngineInterface, home: string, opener: string, item: Deliverable) {
  const downloads = `${home}/Downloads`
  const { name } = pathParts(item.path)
  const dot = name.lastIndexOf('.')
  const stem = name.slice(0, dot)
  const extension = name.slice(dot)
  if (!(await $.fs.exists(downloads))) {
    const made = await $.process.run(['mkdir', '-p', downloads])
    if (made.exitCode !== 0) throw new Error('Could not create Downloads')
  }
  let target = `${downloads}/${name}`
  for (let number = 2; await $.fs.exists(target); number++) target = `${downloads}/${stem} (${number})${extension}`
  const copied = await $.process.run(['cp', '-n', item.path, target])
  if (copied.exitCode !== 0) throw new Error('Could not copy deliverable')
  await open($, opener, target)
  await update($, band, current => current === item.path ? null : current)
  const message = `Shipped ${pathParts(target).name} to Downloads`
  $.ui.toast(message)
  return message
}

export const register: Register = (on, options) => {
  const extensions = new Set(String(options.extensions).split(',').map(value => value.trim().toLowerCase()))
  let cwd = ''
  let home = ''
  let opener = 'open'
  let pending: string[] = []
  let flushScheduled = false
  let interactive = true

  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive !== false
    cwd = e.cwd
    await $.command.register({ name: 'ship', description: 'Copy a deliverable to Downloads and open it' })
    if (!interactive) return next(e)
    home = (await $.env.get('HOME')) ?? ''
    const platform = await $.process.run(['uname', '-s'])
    opener = platform.stdout.trim() === 'Linux' ? 'xdg-open' : 'open'
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const result = await next(e)
    try {
      if (interactive && result.deny === undefined && result.isError !== true) {
        const path = absolute(e.file_path, cwd, home)
        if (extensions.has(path.slice(path.lastIndexOf('.')).toLowerCase())) await record($, path)
      }
    } catch { /* Recording must not block the tool. */ }
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (interactive && result.deny === undefined && result.isError !== true && !result.result.interrupted && !result.result.backgroundTaskId) {
      pending.push(...commandPaths(e.command, extensions).map(path => absolute(path, cwd, home)))
      if (pending.length > 0 && !flushScheduled) {
        flushScheduled = true
        const flush = async () => {
          try {
            while (pending.length > 0) {
              const paths = pending
              pending = []
              const now = await $.clock.now()
              for (const path of paths) {
                try {
                  const stat = await $.fs.stat(path)
                  if (stat.kind === 'file' && stat.mtimeMs <= now && now - stat.mtimeMs <= 120000) await record($, path)
                } catch { /* A command token need not be a file. */ }
              }
            }
          } finally {
            flushScheduled = false
          }
        }
        $.clock.after(0, flush)
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'ship' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'list') {
      await $.ui.open({ id: PANE, title: 'Deliverables' })
      return { text: 'Deliverables pane opened.' }
    }
    const list = await read($, files)
    if (list.length === 0) return { text: 'No deliverables recorded in this session yet.' }
    const index = args === '' ? 0 : Number(args) - 1
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return { text: 'No deliverable at that number.' }
    try { return { text: await ship($, home, opener, list[index]!) } }
    catch { return { text: 'Could not ship the deliverable.' } }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const path = await read($, band)
      if (!path || e.props.hasSurvey) return next(e)
      const { Box, Text, Button } = $.ui.resolve(e)
      const below = await next(e)
      const item = (await read($, files)).find(one => one.path === path)
      if (!item) return below
      const mine = <Box><Text>📦 {pathParts(path).name} </Text><Button key="ship" label="ship" hotkey="s" plain onPress={() => ship($, home, opener, item)} /><Button key="open" label="open" hotkey="o" plain onPress={() => open($, opener, path)} /><Button key="dismiss" label="dismiss" hotkey="n" plain onPress={() => update($, band, current => current === path ? null : current)} /></Box>
      return <Box flexDirection="column">{mine}{below}</Box>
    } catch { return next(e) }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      const path = await read($, band)
      if (!path) return next(e)
      const modes = Array.isArray(e.props.modes) ? e.props.modes : []
      return next({ ...e, props: { ...e.props, modes: [...modes, `deliverable ${pathParts(path).name} · /ship`] } })
    } catch { return next(e) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const now = await $.clock.now()
    return <Box flexDirection="column">
      {list.length === 0 && <Text>No deliverables recorded in this session yet.</Text>}
      {list.map((item, index) => {
        const { folder, name } = pathParts(item.path)
        const age = Math.max(0, Math.floor((now - item.recordedAt) / 1000))
        return <Box key={item.path} flexDirection="column">
          <Text>{name}  {folder}  {age}s ago</Text>
          <Box>
            <Button key={`open-${index}`} label="Open" onPress={() => open($, opener, item.path)} />
            <Button key={`reveal-${index}`} label="Reveal" onPress={() => $.process.run(opener === 'open' ? ['open', '-R', item.path] : ['xdg-open', folder])} />
            <Button key={`copy-${index}`} label="Copy path" onPress={() => $.ui.copy({ text: item.path, surface: e.surface })} />
            <Button key={`ship-${index}`} label="Ship" onPress={() => ship($, home, opener, item)} />
          </Box>
        </Box>
      })}
    </Box>
  })
}
