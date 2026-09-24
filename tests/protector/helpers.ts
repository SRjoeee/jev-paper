// Copied from Read arXiv tests/protector/helpers.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
/** Parse a snippet hand-written after a fixture's real structure; returns the body's first child element */
export function el(html: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = doc.body.firstElementChild
  if (!target) throw new Error('empty snippet')
  return target
}

/** The rehydrated clone strips ids; strip the original's ids too before comparing */
export function stripIds(html: string): string {
  return html.replace(/ id="[^"]*"/g, '')
}

/** Hang the fragment in a div and take its innerHTML, for comparison with the original */
export function htmlOf(fragment: DocumentFragment): string {
  const div = document.createElement('div')
  div.append(fragment)
  return div.innerHTML
}

/**
 * The comparison rule for identity round trips: both sides collapse runs of whitespace to one space before comparing.
 *
 * `serialize` collapses whitespace at its exit since #119 (LaTeXML's hard line breaks were taken for full stops by Microsoft), so the rehydrated
 * HTML is no longer byte-identical to the original in **whitespace count**. That is no defect: rehydration produces the translation node — a new sibling
 * node — and HTML rendering collapses that whitespace anyway; DESIGN §7.1's “equal node for node after restore” is guarded by the
 * `outerHTML` assertion at the end of the case, and `serialize` is read-only, never touching the original node.
 *
 * Relaxed is **the whitespace count only**; an inter-word space **vanishing** is still caught: the original collapses to `a b`,
 * and rehydrated as `ab` the sides still differ. `</em> and` dropping to `</em>and` likewise.
 */
export function sameModuloWhitespace(actual: string, expected: string): [string, string] {
  // Collapse only the five characters `serialize` collapses, **neither `\s` nor trim**: `\s` includes U+00A0 and the narrow spaces,
  // and trim would eat the ends — then “an NBSP wrongly collapsed to an ordinary space” would become the same ordinary space on both sides,
  // the comparison would pass, and the case could never catch it again (Codex on #122).
  // Under this rule the only strictness relaxed is “the count of HTML whitespace”; semantic whitespace and the end boundaries are still compared character for character
  const collapse = (s: string) => s.replace(/[\t\n\f\r ]+/g, ' ')
  return [collapse(actual), collapse(expected)]
}
