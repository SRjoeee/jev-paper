import type { Theme } from './palette'

/** arXiv writes `data-theme` on <html> (from localStorage `ar5iv_theme` or the OS preference); otherwise the page's
 *  own background decides */
export function themeOf(doc: Document): Theme {
  const attr = doc.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  const background = doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? ''
  const parts = background.match(/[\d.]+/g)?.map(Number)
  if (!parts || parts.length < 3 || parts[3] === 0) return 'light'
  const [r, g, b] = parts as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90 ? 'dark' : 'light'
}
