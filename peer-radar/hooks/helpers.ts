import type { Board, Radar, Session } from '../types'

export function parseBoard(text: string, at: number): Board {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const header = lines.findIndex(line => /^STATE\s+ID\s+KIND\s+WORKSPACE\s+AGE\s+MAIL\s+NAME\s+CLAIM\s*$/.test(line.trim()))
  if (header < 0) return { sessions: [], raw: lines, at }
  const names = ['STATE', 'ID', 'KIND', 'WORKSPACE', 'AGE', 'MAIL', 'NAME', 'CLAIM']
  const starts = names.map(name => lines[header]!.indexOf(name))
  const sessions: Session[] = []
  const raw: string[] = []
  for (const line of lines.slice(header + 1)) {
    if (!line.trim() || /^[-\s]+$/.test(line)) continue
    const cells = names.map((_, i) => line.slice(starts[i]!, starts[i + 1]).trim())
    if (!cells[0] || !cells[1]) { raw.push(line); continue }
    sessions.push({ state: cells[0]!, id: cells[1]!, workspace: cells[3]!, age: cells[4]!, claim: cells[7]! })
  }
  return { sessions, raw, at }
}

export function parseCounts(text: string): { behind: number; ahead: number } | undefined {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(text)
  return match ? { behind: Number(match[1]), ahead: Number(match[2]) } : undefined
}

export function quote(text: string): string {
  return "'" + text.replaceAll("'", "'\\''") + "'"
}

export function statusText(radar: Radar): string {
  const local = radar.platform === 'Darwin' ? 'mac' : 'thinkpad'
  const peer = radar.platform === 'Darwin' ? 'thinkpad' : 'mac'
  const prefix = `radar: ${local} ${radar.local.sessions.length} · ${peer} ${radar.peer.error ? 'offline' : radar.peer.sessions.length}`
  if (radar.vault?.blocked) return `${prefix} · vault BLOCKED`
  const behind = radar.repos.find(repo => repo.behind > 0)
  if (behind) return `${prefix} · sync: ${behind.name} behind ${behind.behind}`
  return `${prefix} · sync ok`
}

export function relayTarget(id: string, radar: Radar): 'local' | 'peer' | undefined {
  if (radar.local.sessions.some(session => session.id === id)) return 'local'
  if (radar.peer.sessions.some(session => session.id === id)) return 'peer'
  return undefined
}
