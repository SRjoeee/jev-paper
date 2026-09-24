// Adapted from Read arXiv src/core/renderer/highlight.ts@3f3c91f8 (GPL-3.0), 2026-09-24: clipOf and CLIPS.
export interface Clip {
  left: number
  top: number
  right: number
  bottom: number
}

/** The `overflow` values that clip. Anything else — `visible`, or nothing at all — does not */
const CLIPS = /^(?:hidden|clip|scroll|auto)$/

/**
 * Where a mark's bands may paint: the intersection of every clipping ancestor's box. The layer hangs off <body>,
 * outside whatever clipped the text; Range.getClientRects() reports the text's full box, including the part a
 * scrolling container hides, so an unclipped band would paint over what sits beside it.
 */
export function clipOf(root: Element, view: Window): Clip {
  const clip: Clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
  for (let node: Element | null = root; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    const x = CLIPS.test(style.overflowX)
    const y = CLIPS.test(style.overflowY)
    if (!x && !y) continue
    const box = node.getBoundingClientRect()
    if (x) {
      clip.left = Math.max(clip.left, box.left)
      clip.right = Math.min(clip.right, box.right)
    }
    if (y) {
      clip.top = Math.max(clip.top, box.top)
      clip.bottom = Math.min(clip.bottom, box.bottom)
    }
  }
  return clip
}
