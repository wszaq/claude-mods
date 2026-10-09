import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Tip } from '../types'

const tips = atom({ plugin: 'waste-alarm', key: 'tips' } as const, [] as Tip[])
const builtInIgnore = ['git status', 'git diff', 'git log', 'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'cd', 'sed -n', 'grep', 'find', 'python3 -c']
const pane = 'waste-alarm'

export function normalize(command: string): string {
  const head = command.trim().split(/\||2?>|&&|;/, 1)[0]?.trim() ?? ''
  const program = head.match(/^("[^"]+"|'[^']+'|\S+)/)?.[0] ?? ''
  const name = program.replace(/["']/g, '').split('/').pop() ?? ''
  return (name + head.slice(program.length).replace(/["']/g, '')).replace(/\s+/g, ' ').trim()
}

export function parseTips(output: string): Tip[] {
  if (output.includes('Token Dashboard: no suggestions')) return []
  const found: Tip[] = []
  for (const line of output.split(/\r?\n/)) {
    const heading = line.match(/^\[([^\]]+)\]\s+(.+)$/)
    if (heading) {
      found.push({ category: heading[1] ?? '', title: heading[2] ?? '', body: '' })
    } else if (/^\s+\S/.test(line) && found.length > 0) {
      found[found.length - 1]!.body += (found[found.length - 1]!.body ? '\n' : '') + line.trim()
    }
  }
  return found
}

function day(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dismissalKey(title: string): string {
  return title.replace(/[0-9][0-9,.]*/g, '#')
}

async function dismiss($: EngineInterface): Promise<void> {
  const current = await read($, tips)
  const dismissed = (await $.store.get('dismissed') as string[] | undefined) ?? []
  await $.store.set('dismissed', [...new Set([...dismissed.map(dismissalKey), ...current.map(tip => dismissalKey(tip.title))])])
  await update($, tips, () => [])
}

export const register: Register = (on, options) => {
  const threshold = Number(options.threshold ?? 10)
  const configuredRepo = String(options.tokenDashboard ?? '')
  let scanRunning = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'waste', description: 'Show repeated commands and token tips', argumentHint: '[ignore <command>|dismiss]' })
      const cutoff = new Date(await $.clock.now())
      cutoff.setDate(cutoff.getDate() - 7)
      const oldest = day(cutoff.getTime())
      for (const oldKey of await $.store.keys()) {
        if ((oldKey.startsWith('counts:') || oldKey.startsWith('shown:')) && oldKey.slice(oldKey.indexOf(':') + 1) < oldest) await $.store.delete(oldKey)
      }
      const platform = (await $.process.run(['uname', '-s'])).stdout.trim()
      const home = await $.env.get('HOME')
      if ((platform === 'Darwin' || platform === 'Linux') && home) {
        const configured = configuredRepo.replace(/^~/, home)
        const candidates = configuredRepo ? [configured] : [`${home}/_WAJBKODING/repos/token-dashboard`, `${home}/Work/_WAJBKODING/repos/token-dashboard`]
        let repo = ''
        for (const candidate of candidates) {
          if (await $.fs.exists(`${candidate}/cli.py`)) { repo = candidate; break }
        }
        if (repo) {
          const db = `${home}/.claude/mods-data/waste-alarm/token-dashboard.db`
          const scan = async () => {
            if (scanRunning) return
            scanRunning = true
            try {
              await $.process.run(['mkdir', '-p', `${home}/.claude/mods-data/waste-alarm`])
              const now = await $.clock.now()
              const lastScan = Number((await $.store.get('lastScan')) ?? 0)
              if (now < lastScan || now - lastScan >= 6000000) {
                await $.store.set('lastScan', now)
                const result = await $.process.run(['python3', `${repo}/cli.py`, 'scan', '--db', db], { timeoutMs: 600000 })
                if (result.exitCode !== 0) return
              }
              const tipResult = await $.process.run(['python3', `${repo}/cli.py`, 'tips', '--db', db], { timeoutMs: 600000 })
              if (tipResult.exitCode !== 0) return
              const dismissed = (await $.store.get('dismissed') as string[] | undefined) ?? []
              const keys = dismissed.map(dismissalKey)
              await update($, tips, () => parseTips(tipResult.stdout).filter(tip => !keys.includes(dismissalKey(tip.title))))
            } catch { /* A failed scan leaves the current tips in place. */ }
            finally { scanRunning = false }
          }
          $.clock.after(30000, () => { void scan() })
          $.clock.every(7200000, () => { void scan() })
        }
      }
    } catch { /* This observer must not stop session start. */ }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try {
      const command = normalize(e.command)
      const ignored = (await $.store.get('ignore') as string[] | undefined) ?? []
      if (command && ![...builtInIgnore, ...ignored].some(prefix => command.startsWith(prefix))) {
        const today = day(await $.clock.now())
        const key = `counts:${today}`
        const counts = (await $.store.get(key) as Record<string, number> | undefined) ?? {}
        const count = (counts[command] ?? 0) + 1
        counts[command] = count
        await $.store.set(key, counts)
        if (count >= threshold) {
          const shownKey = `shown:${today}`
          const shown = (await $.store.get(shownKey) as string[] | undefined) ?? []
          if (!shown.includes(command)) {
            await $.store.set(shownKey, [...shown, command])
            $.ui.toast(`waste-alarm: "${command}" ran ${count} times today`)
          }
        }
      }
    } catch { /* Counting must not change the tool call. */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'waste' }, async ($, e) => {
    try {
      const args = e.args.trim()
      if (args === 'dismiss') {
        await dismiss($)
        return { text: 'waste-alarm: tips dismissed.' }
      }
      if (args.startsWith('ignore ')) {
        const prefix = args.slice(7).trim()
        if (!prefix) return { text: 'Usage: /waste ignore <command>' }
        const ignored = (await $.store.get('ignore') as string[] | undefined) ?? []
        await $.store.set('ignore', [...new Set([...ignored, prefix])])
        return { text: `waste-alarm: ignoring "${prefix}".` }
      }
      if (args) return { text: 'Usage: /waste [ignore <command>|dismiss]' }
      await $.ui.open({ id: pane, title: 'waste-alarm' })
      return { text: 'waste-alarm pane opened.' }
    } catch { return { text: 'waste-alarm: command failed.' } }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, tips)
    if (e.props.hasSurvey || current.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return <Box><Text dimColor>waste-alarm: {current.length} new tips — /waste </Text><Button key="dismiss" label="Dismiss" onPress={() => dismiss($)} /></Box>
  })

  on('ui.render', { component: 'Pane', requestId: pane }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, tips)
    const today = day(await $.clock.now())
    const counts = (await $.store.get(`counts:${today}`) as Record<string, number> | undefined) ?? {}
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    return <Box flexDirection="column">
      <Text>Tips</Text>
      {current.length === 0 && <Text dimColor>No new tips.</Text>}
      {current.map(tip => <Text key={tip.title}>[{tip.category}] {tip.title}: {tip.body}</Text>)}
      <Text>Today's repeated commands</Text>
      {top.length === 0 && <Text dimColor>No commands counted.</Text>}
      {top.map(([command, count]) => <Text key={command}>{count} {command}</Text>)}
    </Box>
  })
}
