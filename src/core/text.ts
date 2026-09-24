// Copied from Read arXiv src/core/text.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// The text of a subtree, and the whitespace rule most of `core` applies to it. Seven walkers used to do this, each
// with its own barrier; what differs between them is only which elements a caller refuses to enter,
// so that is the parameter. No `ltx_*` knowledge here — a caller builds its barrier where `classify` lives.

/**
 * The text nodes of `el`'s subtree in document order, minus the subtrees `barrier` refuses. Text nodes only:
 * a comment is not text. Whitespace is kept as it is — `visibleText` needs the thin spaces around a formula
 * (§6.2); a caller that wants it collapsed says so with `squash`
 */
export function collectText(el: Element, barrier: (el: Element) => boolean): string {
  const parts: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) parts.push((child as Text).data)
      else if (child.nodeType === ELEMENT_NODE && !barrier(child as Element)) walk(child as Element)
    }
  }
  walk(el)
  return parts.join('')
}

/** Whitespace runs to one space, the ends trimmed: the form two texts are compared in, and titles are cut in */
export function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

export const ELEMENT_NODE = 1
export const TEXT_NODE = 3
/** One Unicode letter: what makes a text translatable, wherever that question is asked */
export const LETTER = /\p{L}/u
