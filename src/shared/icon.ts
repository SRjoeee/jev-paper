// Lucide "highlighter" (ISC licence, public/licenses/lucide.txt): the two paths of its 24 × 24 icon node.
export const HIGHLIGHTER_PATHS = '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'

export function highlighterSvg(size: number, stroke = 2): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${HIGHLIGHTER_PATHS}</svg>`
}
