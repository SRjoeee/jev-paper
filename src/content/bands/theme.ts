import type { Theme } from './palette'

/** A computed colour that paints nothing (Read arXiv highlight.ts's NO_PAINT) */
const NO_PAINT = /^(?:transparent|rgba\(0, 0, 0, 0\)|)$/

/** arXiv writes `data-theme` on <html> (from localStorage `ar5iv_theme` or the OS preference); otherwise the first
 *  of <body>, then <html>, whose computed background actually paints decides; if neither paints, 'light' */
export function themeOf(doc: Document): Theme {
  const attr = doc.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  const view = doc.defaultView
  for (const el of [doc.body, doc.documentElement]) {
    const background = el && view ? view.getComputedStyle(el).backgroundColor : ''
    if (NO_PAINT.test(background)) continue
    const parts = background.match(/[\d.]+/g)?.map(Number)
    if (!parts || parts.length < 3) continue
    const [r, g, b] = parts as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90 ? 'dark' : 'light'
  }
  return 'light'
}
