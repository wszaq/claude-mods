// Critters: the small pixel avatar the mods draw, and each open chat's color.
// A copy sits in every mod (a hooks module imports only its own plugin's files),
// so a change here goes into all four copies, kept identical.
// - Desktop draws a critter as an Svg image, 11 x 8 pixels; SMIL runs in an image.
// - The terminal has no Svg: one row of cells, half-block edges and glyph eyes
//   on the body color (▐• •▌).
// - The body is the chat's color, the pose is the state. Recording Mode alone
//   draws red: it covers every chat.
// - Cards: on Desktop, and on a terminal 120+ columns wide, each mod draws a
//   bordered card and stack() puts the mods' cards side by side in one row.

// Fixed hex: an image does not follow the theme, so these read on light and dark
export const PAL = {
  red: '#E5484D',
  green: '#4EBA65',
  amber: '#E3A33B',
  teal: '#3BA596',
  scarf: '#3FA9C9',
  eye: '#1F1E1D',
  frost: '#EAF6FF',
  ice: '#5E9BD6',
  sweat: '#8CC8FF',
  gray: '#8F8D88',
  track: '#80808047',
}

// Six chat colors, matched to the emoji circles so text-only places (the footer,
// the collision question) name the same color. Red stays for REC and errors.
export const CHAT_COLORS = [
  { name: 'orange', hex: '#E8853D', emoji: '🟠' },
  { name: 'yellow', hex: '#E2B33A', emoji: '🟡' },
  { name: 'green', hex: '#5DAE5B', emoji: '🟢' },
  { name: 'blue', hex: '#4A8FE0', emoji: '🔵' },
  { name: 'purple', hex: '#A070D8', emoji: '🟣' },
  { name: 'brown', hex: '#A06A47', emoji: '🟤' },
]

// Cache Keeper picks each chat's color and rewrites <dir>/<session>.json every
// 30 s; the other mods only read it. A file older than COLOR_LIVE_MS is a closed chat.
export const COLOR_DIR = '/.claude/mods-data/chat-colors'
export const COLOR_LIVE_MS = 3 * 60000

export function chatColor(i) {
  return CHAT_COLORS[i] || CHAT_COLORS[0]
}

// The color of a chat with no file: stable for its id, the same in every mod
export function hashColor(id) {
  let h = 0
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % CHAT_COLORS.length
}

// The first color no live chat holds; with all six taken, the id's own
export function pickColor(taken, id) {
  for (let i = 0; i < CHAT_COLORS.length; i++) if (!taken.has(i)) return i
  return hashColor(id)
}

export function parseColor(text) {
  try {
    const c = JSON.parse(text).color
    return Number.isInteger(c) && c >= 0 && c < CHAT_COLORS.length ? c : null
  } catch {
    return null
  }
}

// ---------- poses ----------

export const POSE = {
  warm: { acc: ['steam'] },
  cooling: { acc: ['sweat'] },
  cold: { eyes: 'closed', acc: ['frost'], motion: 'shiver' },
  kept: { acc: ['scarf'] },
  working: { legs: 'run', motion: 'bob' },
  waiting: { acc: ['ask'] },
  idle: { eyes: 'closed', acc: ['zzz'] },
  done: { eyes: 'happy', acc: ['flag', 'sparkle'], motion: 'bounce' },
  rec: { eyes: 'shades', acc: ['rec'] },
}

// ---------- the Desktop drawing ----------

const BODY = ['..XXXXXXX..', '.XXXXXXXXX.', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '.XXXXXXXXX.']
const LEGS = ['..X.X.X.X..', '.X.X...X.X.']
const EYES = {
  open: [[3, 2], [3, 3], [7, 2], [7, 3]],
  happy: [[2, 3], [3, 2], [4, 3], [6, 3], [7, 2], [8, 3]],
  closed: [[2, 3], [3, 3], [4, 3], [6, 3], [7, 3], [8, 3]],
  shades: [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [2, 3], [3, 3], [4, 3], [6, 3], [7, 3], [8, 3]],
}
const VB = { x: -2.5, y: -5, w: 17.5, h: 13.5 }
const FONT = 'font-family="-apple-system,\'Segoe UI\',system-ui,sans-serif"'

function runs(row) {
  const out = []
  let s = -1
  for (let i = 0; i <= row.length; i++) {
    const on = row[i] === 'X'
    if (on && s < 0) s = i
    if (!on && s >= 0) {
      out.push([s, i - s])
      s = -1
    }
  }
  return out
}

// A row of pixels; the 0.03 overlap hides the seams between rects
function px(x, y, w, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w + 0.03}" height="1.03" fill="${fill}"${extra}/>`
}

const rowPx = (row, y, fill) => runs(row).map(([x, w]) => px(x, y, w, fill)).join('')
const loop = 'repeatCount="indefinite"'

function bubble(ch, fill) {
  return `<rect x="10.8" y="-5" width="3.8" height="3.6" rx=".9" fill="${fill}"/><path d="M11.6 -1.5 l.5 1.1 l.7 -1.1z" fill="${fill}"/>` +
    `<text x="12.7" y="-2.25" font-size="3" font-weight="800" text-anchor="middle" fill="${PAL.eye}" ${FONT}>${ch}</text>`
}

function accessory(name, body) {
  if (name === 'steam') {
    return [[3.5, 0], [7.5, 0.8]].map(([x, b]) =>
      `<path d="M${x} -0.8 q0.9 -0.8 0 -1.6 q-0.9 -0.8 0 -1.6" fill="none" stroke="${body}" stroke-width="0.55" stroke-linecap="round" opacity="0">` +
      `<animate attributeName="opacity" values="0;0.95;0" dur="1.6s" begin="${b}s" ${loop}/>` +
      `<animateTransform attributeName="transform" type="translate" values="0 0.6;0 -0.4" dur="1.6s" begin="${b}s" ${loop}/></path>`).join('')
  }
  if (name === 'sweat') return `<path d="M11 -1.4 q1 1.3 0 2 q-1 -0.7 0 -2z" fill="${PAL.sweat}"><animateTransform attributeName="transform" type="translate" values="0 0;0 1.4" dur="1.5s" ${loop}/><animate attributeName="opacity" values="1;1;0" keyTimes="0;.7;1" dur="1.5s" ${loop}/></path>`
  if (name === 'frost') return `<path d="M12.6 -4.3 v2.8 M11.4 -3.6 l2.4 1.4 M11.4 -2.2 l2.4 -1.4" stroke="${PAL.ice}" stroke-width=".42" stroke-linecap="round" fill="none"/>`
  if (name === 'rec') return `<circle cx="5.5" cy="-2.2" r="1.15" fill="${PAL.red}"><animate attributeName="opacity" values="1;0.3;1" dur="1.6s" ${loop}/></circle>`
  if (name === 'flag') return `<path d="M11.4 8 V-4.4" stroke="${PAL.gray}" stroke-width=".45"/><path d="M11.6 -4.4 L14.8 -3.4 L11.6 -2.4Z" fill="${PAL.green}"/>`
  if (name === 'ask') return bubble('?', '#B1B9F9')
  if (name === 'bang') return bubble('!', '#FFC107')
  if (name === 'zzz') {
    return `<text x="11.2" y="-1.4" font-size="2.6" font-weight="700" fill="${PAL.gray}" ${FONT}>z<animate attributeName="opacity" values=".25;1;.25" dur="2.4s" ${loop}/></text>` +
      `<text x="12.9" y="-3.3" font-size="2" font-weight="700" fill="${PAL.gray}" ${FONT}>z<animate attributeName="opacity" values="1;.25;1" dur="2.4s" ${loop}/></text>`
  }
  if (name === 'sparkle') return `<path d="M-1.2 -3.4 v1.6 M-2 -2.6 h1.6 M1.2 -4.6 v1.2 M.6 -4 h1.2" stroke="#FFC107" stroke-width=".4" stroke-linecap="round"><animate attributeName="opacity" values="1;.2;1" dur="1s" ${loop}/></path>`
  return ''
}

const MOTION = {
  shiver: `<animateTransform attributeName="transform" type="translate" values="0 0;.3 0;-.3 0;.3 0;0 0;0 0" keyTimes="0;.04;.08;.12;.16;1" dur="2.2s" ${loop}/>`,
  bounce: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.3;0 0;0 0" keyTimes="0;.15;.3;1" dur="1.4s" ${loop}/>`,
  bob: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -.35;0 0" dur=".4s" ${loop}/>`,
}

// One critter as a whole SVG document: { source, width, height }. The same pose
// and size give the same text, so a redraw hands the surface an unchanged image.
export function critterSvg(pose, height = 20) {
  const { body, eyes = 'open', acc = [], legs = 'still', motion = '' } = pose
  const p = []
  BODY.forEach((row, y) => p.push(rowPx(row, y, body)))
  if (legs === 'run') {
    p.push(`<g>${rowPx(LEGS[0], 7, body)}<animate attributeName="opacity" values="1;0" dur="0.4s" calcMode="discrete" ${loop}/></g>`)
    p.push(`<g opacity="0">${rowPx(LEGS[1], 7, body)}<animate attributeName="opacity" values="0;1" dur="0.4s" calcMode="discrete" ${loop}/></g>`)
  } else p.push(rowPx(LEGS[0], 7, body))
  if (acc.includes('frost')) p.push(px(2, 0, 7, PAL.frost), px(1, 1, 1, PAL.frost), px(4, 1, 1, PAL.frost), px(9, 1, 1, PAL.frost))
  if (acc.includes('scarf')) p.push(px(1, 4, 9, PAL.scarf), px(7, 5, 2, PAL.scarf), px(8, 6, 1, PAL.scarf))
  for (const [x, y] of EYES[eyes] || EYES.open) p.push(px(x, y, 1, PAL.eye))
  if (eyes === 'shades') p.push(px(2, 2, 1, '#FFFFFF', ' opacity=".55"'))
  // a blink: the upper eye pixels close for a moment
  if (eyes === 'open') p.push(`<g opacity="0">${px(3, 2, 1, body)}${px(7, 2, 1, body)}<animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.9;0.95;1" dur="4.2s" ${loop}/></g>`)
  const width = Math.round((height * VB.w) / VB.h)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}">` +
    `<g><g shape-rendering="crispEdges">${p.join('')}</g>${acc.map((a) => accessory(a, body)).join('')}${MOTION[motion] || ''}</g></svg>`
  return { source, width, height }
}

// ---------- elements ----------

const TEYES = { open: '• •', closed: '- -', happy: '^ ^', shades: '▀▀▀', alarm: 'o o' }

export function isGraphic(e, el) {
  return e.surface !== 'terminal' && !!el.Svg
}

// Cards where there is room for them side by side
export function cardsOn(e, el) {
  return isGraphic(e, el) || ((e.props && e.props.bodyColumns) || 0) >= 120
}

// The terminal critter as three inline Texts, to sit inside a one-line Text
export function critterCells(el, body, pose) {
  const { Text } = el
  const eyes = pose.acc && pose.acc.includes('bang') ? 'alarm' : pose.eyes || 'open'
  return [
    Text({ color: body, children: ['▐'] }),
    Text({ color: PAL.eye, backgroundColor: body, children: [TEYES[eyes] || TEYES.open] }),
    Text({ color: body, children: ['▌'] }),
  ]
}

// The critter for this surface: an Svg image, or one row of terminal cells
export function critter(el, surface, body, pose, height, alt) {
  if (surface !== 'terminal' && el.Svg) {
    const s = critterSvg({ ...pose, body }, height)
    return el.Svg({ source: s.source, alt, width: s.width, height: s.height })
  }
  return el.Box({ flexDirection: 'row', flexShrink: 0, children: critterCells(el, body, pose) })
}

export function card(el, color, children, grow) {
  return el.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1, flexGrow: grow, flexShrink: 1, minWidth: 22, children })
}

// A bar of weighted segments: { weight, hex, color, pulse } each, `color` a theme
// key for the terminal, `hex` for the Desktop image, `pulse` for the running one.
// No `color` and no `hex`: an empty part of the track.
export function bar(el, surface, segs, cells, gap) {
  const total = segs.reduce((a, s) => a + s.weight, 0) || 1
  if (surface !== 'terminal' && el.Svg) {
    const width = 240
    const height = 6
    const room = width - gap * 3 * (segs.length - 1)
    let x = 0
    const rects = segs.map((s) => {
      const w = (room * s.weight) / total
      const at = x
      x += w + gap * 3
      if (!s.hex || w <= 0) return ''
      const pulse = s.pulse ? `<animate attributeName="opacity" values="1;.45;1" dur="1.4s" ${loop}/>` : ''
      return `<rect x="${at.toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${height}" rx="3" fill="${s.hex}">${pulse}</rect>`
    })
    const track = gap ? '' : `<rect width="${width}" height="${height}" rx="3" fill="${PAL.track}"/>`
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${track}${rects.join('')}</svg>`
    return el.Svg({ source, alt: 'progress', width, height })
  }
  const { Box, Text } = el
  const room = Math.max(segs.length, cells - gap * (segs.length - 1))
  const kids = []
  let sum = 0 // cumulative rounding, so the cells add up to the room
  segs.forEach((s, i) => {
    const from = Math.round((room * sum) / total)
    sum += s.weight
    if (s.weight <= 0) return
    if (gap && i) kids.push(Text({ children: [' '] }))
    const n = Math.max(1, Math.round((room * sum) / total) - from)
    kids.push(s.color ? Text({ color: s.color, bold: !!s.pulse, children: ['█'.repeat(n)] }) : Text({ dimColor: true, children: ['░'.repeat(n)] }))
  })
  return Box({ flexDirection: 'row', flexShrink: 0, children: kids })
}

// The mods' cards share one wrapping row; anything else stacks under it.
// Each band hook passes its own card and what the plugins beneath it drew.
const CARDS = 'nateherk-cards'

export function stack(el, mine, below, cards) {
  const { Box } = el
  if (!cards) return Box({ flexDirection: 'column', children: below ? [mine, below] : [mine] })
  const row = (kids) => Box({ key: CARDS, flexDirection: 'row', flexWrap: 'wrap', gap: 1, children: kids })
  const isRow = (t) => !!t && t.type === 'Box' && !!t.props && t.props.key === CARDS
  const kids = (t) => [].concat(t.children || [])
  if (!below) return row([mine])
  if (isRow(below)) return row([mine, ...kids(below)])
  const [first, ...rest] = below.type === 'Box' ? kids(below) : []
  if (isRow(first)) return Box({ flexDirection: 'column', children: [row([mine, ...kids(first)]), ...rest] })
  return Box({ flexDirection: 'column', children: [row([mine]), below] })
}
