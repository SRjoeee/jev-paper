// Copied from Read arXiv src/core/protector/tokens.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// The DOM-free tokeniser: a string with placeholders cut into four kinds of token, shared by validate / rehydrate /
// splitRuns and runnable in a service worker. After the idea of Read Frog's html-attribute-markers.ts (string-level
// validation with no DOM); the protocol differs and no code was ported.
//
// The two wire formats (DESIGN §6.1):
// - `tags`: `<x id="1"/>` / `<t id="1">…</t>`. Fully expressive; LLMs and Google both keep inline styling.
// - `markers`: `@a#`, plain text, voids only. For the free engines that tear tags apart — the Microsoft Edge endpoint
//   measured 0% on tags (all 400 placeholders lost) and 98% of blocks / 99.3% of markers on markers; Google ~99% on
//   both. Paired markers measured only 70.6%, unusable, so on this format every paired placeholder is flattened
//   (inline styling lost, content kept).

export type WireFormat = 'tags' | 'markers'

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'void'; id: number }
  | { kind: 'open'; id: number }
  | { kind: 'close' }

// The model's common spellings are tolerated: <x id="1"/>, <x id="1" />, single or no quotes, <x id="1"></x>; anything else is text
export const TAG_RE = /<x\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*(?:\/>|>\s*<\/x\s*>)|<t\s+id\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))\s*>|<\/t\s*>/g

// `@@` is the escape of a literal `@` (see escapeText in text.ts) and must be matched before a marker, or `@@a#` is read as a marker
export const MARKER_RE = /@@|@([a-z]+)#/g

/** id → bijective base-26 letters (1→a, 26→z, 27→aa). Letters, not digits: MT engines reorder, merge and thousands-separate digits */
export function toAlpha(id: number): string {
  let n = id
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(97 + r) + out
    n = (n - 1 - r) / 26
  }
  return out
}

export function fromAlpha(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 96)
  return n
}

export function tokenize(s: string, format: WireFormat = 'tags'): Token[] {
  return format === 'markers' ? tokenizeMarkers(s) : tokenizeTags(s)
}

/**
 * tags and markers are two explicit loops, not one generic loop with callbacks.
 *
 * This is the hottest stretch: `validate` / `rehydrate` / `splitRuns` run it for every block. The first version
 * merged the two formats into one loop with a push closure that handled “merge adjacent text”, and the whole-paper
 * round trip on the heaviest fixture (2609.04056) measured 1645 → 1833 ms (+11%), against a 10 s budget assertion
 * on that round trip — straight into the limit on CI. Adjacent text arises only in markers (the unescape of `@@`);
 * tags pushes at most one text token before each match and never has adjacent ones.
 */
function tokenizeTags(s: string): Token[] {
  const out: Token[] = []
  let last = 0
  TAG_RE.lastIndex = 0
  for (const m of s.matchAll(TAG_RE)) {
    const index = m.index ?? 0
    if (index > last) out.push({ kind: 'text', text: s.slice(last, index) })
    if (m[0].startsWith('</')) out.push({ kind: 'close' })
    else if (m[0].startsWith('<x')) out.push({ kind: 'void', id: Number(m[1] ?? m[2] ?? m[3]) })
    else out.push({ kind: 'open', id: Number(m[4] ?? m[5] ?? m[6]) })
    last = index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) })
  return out
}

function tokenizeMarkers(s: string): Token[] {
  const out: Token[] = []
  let last = 0
  // The unescape of `@@` cuts fragments in the middle of real text; merged, so a node-by-node comparison downstream sees no difference
  const text = (t: string) => {
    const prev = out[out.length - 1]
    if (prev?.kind === 'text') prev.text += t
    else out.push({ kind: 'text', text: t })
  }
  MARKER_RE.lastIndex = 0
  for (const m of s.matchAll(MARKER_RE)) {
    const index = m.index ?? 0
    if (index > last) text(s.slice(last, index))
    if (m[0] === '@@') text('@')
    else out.push({ kind: 'void', id: fromAlpha(m[1]!) })
    last = index + m[0].length
  }
  if (last < s.length) text(s.slice(last))
  return out
}

/** Write out a void placeholder */
export function writeVoid(id: number, format: WireFormat): string {
  return format === 'markers' ? `@${toAlpha(id)}#` : `<x id="${id}"/>`
}
