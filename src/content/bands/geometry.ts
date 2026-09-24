// H1 bands (spec §5.3): one band per line, the full line height, consecutive lines meeting, neighbours of one colour
// joined across the space between sentences, outer corners round, edges on device pixels. Pure: rectangles in,
// bands out; the DOM reads and writes live in layer.ts.
import type { Tone } from '@/shared/levels'

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

export interface MarkGeometry {
  mark: number
  tone: Tone
  lines: Box[]
  glyph: number
  lineHeight: number | null
}

export interface Band {
  mark: number
  tone: Tone
  left: number
  top: number
  width: number
  height: number
  /** top-left, top-right, bottom-right, bottom-left */
  radius: [number, number, number, number]
}

const PAD_X = 2
const JOIN_GAP = 16
const RADIUS = 4
const SEAM = 0.5
/** A rectangle this many times taller than the median is a display equation's box, not a line of text */
const TALL = 2.2

/** One line = one band: rectangles merged by vertical overlap (Read arXiv highlight.ts bandsOf) */
export function linesOf(rects: readonly Box[]): { lines: Box[]; glyph: number } {
  const usable = rects.filter(r => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
  const heights = usable.map(r => r.bottom - r.top).sort((a, b) => a - b)
  const glyph = heights[heights.length >> 1] ?? 16
  const lines: Box[] = []
  for (const r of [...usable].sort((a, b) => a.top - b.top || a.left - b.left)) {
    if (r.bottom - r.top > glyph * TALL) continue
    const line = lines.find(l => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > Math.min(l.bottom - l.top, r.bottom - r.top) / 2)
    if (line) {
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
    } else lines.push({ ...r })
  }
  return { lines: lines.sort((a, b) => a.top - b.top), glyph }
}

interface Work {
  mark: number
  tone: Tone
  cy: number
  top: number
  bottom: number
  left: number
  right: number
  first: boolean
  last: boolean
  joinL: boolean
  joinR: boolean
}

export function layoutBands(marks: readonly MarkGeometry[], origin: { left: number; top: number }, dpr: number): Band[] {
  const work: Work[] = []
  for (const m of marks) {
    const lh = m.lineHeight ?? m.glyph * 1.45
    m.lines.forEach((l, k) => {
      const cy = (l.top + l.bottom) / 2
      const prev = m.lines[k - 1]
      const next = m.lines[k + 1]
      work.push({
        mark: m.mark,
        tone: m.tone,
        cy,
        top: prev ? (prev.bottom + l.top) / 2 : cy - lh / 2,
        bottom: next ? (l.bottom + next.top) / 2 : cy + lh / 2,
        left: l.left - PAD_X,
        right: l.right + PAD_X,
        first: k === 0,
        last: k === m.lines.length - 1,
        joinL: false,
        joinR: false,
      })
    })
  }
  const sorted = [...work].sort((a, b) => a.cy - b.cy || a.left - b.left)
  const reach = Math.max(6, ...work.map(w => (w.bottom - w.top) / 2), 0)
  for (let i = 0; i < sorted.length; i++) {
    for (let k = i + 1; k < sorted.length && sorted[k]!.cy - sorted[i]!.cy < reach; k++) {
      const a = sorted[i]!
      const b = sorted[k]!
      if (a.tone !== b.tone || a.mark === b.mark) continue
      if (Math.abs(a.cy - b.cy) >= Math.max(6, (a.bottom - a.top) / 2)) continue
      const [x, y] = a.left <= b.left ? [a, b] : [b, a]
      const gap = y.left - x.right
      // gap > -3 * PAD_X admits the small overlap two adjacent 2 px pads can produce
      if (gap > -3 * PAD_X && gap < JOIN_GAP) {
        const mid = (x.right + y.left) / 2
        x.right = mid
        y.left = mid
        x.joinR = true
        y.joinL = true
        x.top = y.top = Math.min(x.top, y.top)
        x.bottom = y.bottom = Math.max(x.bottom, y.bottom)
      }
    }
  }
  const px = (v: number) => Math.round(v * dpr) / dpr
  const r = (round: boolean) => (round ? RADIUS : 0)
  return work.map(w => {
    const top = px(w.top - origin.top)
    const bottom = px(w.bottom - origin.top + (w.last ? 0 : SEAM))
    const left = px(w.left - origin.left)
    const right = px(w.right - origin.left)
    return {
      mark: w.mark,
      tone: w.tone,
      left,
      top,
      width: right - left,
      height: bottom - top,
      radius: [r(w.first && !w.joinL), r(w.first && !w.joinR), r(w.last && !w.joinR), r(w.last && !w.joinL)],
    }
  })
}
