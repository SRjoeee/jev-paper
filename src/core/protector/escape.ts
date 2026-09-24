// Copied from Read arXiv src/core/protector/escape.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// Escaping / unescaping of text nodes, dispatched by wire format. No whitespace is collapsed (§6.2 keeps the thin
// spaces around formulas).
//
// **Unforgeability**: validation and fill-back are correct only if “every placeholder in the request text was
// written by us”.
// - `tags`: & < > are escaped, so a literal `<` in the original never reaches the wire, and `<x>` / `<t>` are
//   placeholders by necessity.
// - `markers`: every `@` is doubled **unconditionally**. After escaping, every stretch of literal text holds an even
//   number of `@`; the decoder consumes `@@` pairs first, left to right, and a single `@` left over is by necessity the
//   start of a marker — no ambiguity.
//
//   **The escaping must be context-free**; that is the crux. The first version doubled only where `@` was followed by
//   `[a-z]*[#@]`, which looked thriftier, but serialisation escapes text node by text node and concatenates, and the
//   ambiguity arises **at the seams**: in `<p>@<math/></p>` the text node `@` has nothing after it on its own, is not
//   escaped, and concatenated with the placeholder becomes `@@a#`, which the tokeniser reads as a literal `@` — the
//   placeholder vanishes (Codex on #107). `tags` has no such problem precisely because its escaping (`& < >`) is
//   unconditional too. The cost, measured: across the 5992 blocks of the 12 fixtures and 779160 wire characters in
//   markers there are only 5 `@` (e-mail addresses and `@app.route`), 5 extra characters in all.
//
//   `markers` **escapes `& < >` too**. It did not, once, on the grounds that “this wire is plain text” — an
//   assumption about the engine, not a fact: `google-web` goes through `translateHtml`, which parses the request body
//   as HTML. Measured in the markers wire text of the 12 fixtures: 102 `&`, 1 `<`, 3 `>`, spread over 80 of the 5992
//   blocks, all real content (`Springer science & business media`, `Very long (>1k words) … (<500 words)`) —
//   unescaped, `<500` is taken for the start of a tag, and `&` comes back as `&amp;` which the fill-back does not
//   decode, so the reader sees the entity itself (Codex on #107). Escaped, this wire holds for HTML and plain-text
//   transport alike, and no provider needs a codec layer of its own.
//   Unforgeability is unaffected: entities are decoded **after tokenising**, so an `&#64;abc#` from the engine is
//   never read as a marker.
import type { WireFormat } from './tokens'

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function escapeText(s: string, format: WireFormat = 'tags'): string {
  // The two steps commute: `@@` holds no `& < >`, and an entity holds no `@`
  return format === 'markers' ? escapeHtml(s.replace(/@/g, '@@')) : escapeHtml(s)
}

// nbsp written as an escape sequence: a literal U+00A0 gets quietly normalised to an ordinary space by text tools (met while editing this file)
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Decode entities. One rule for both formats — the `@@` of markers is restored in tokenize / unescapeText already and is not touched here */
/**
 * The entities `decodeText` resolves, as a source string so the offsets scan can build an anchored
 * copy of it (`src/core/protector/offsets.ts`). One definition, because a scan that recognised a
 * different set would put its anchors in the wrong places without changing any decoded text.
 */
export const ENTITY_PATTERN = '&(#x[0-9a-f]+|#\\d+|[a-z]+);'

export function decodeText(s: string): string {
  return s.replace(new RegExp(ENTITY_PATTERN, 'gi'), (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1]?.toLowerCase() === 'x'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED[body.toLowerCase()] ?? match
  })
}

/**
 * The unescape **for plain-text round trips only**: titles (§10) and OCR lines go “escapeText → translate → here”
 * with no tokeniser in between, so `@@` has to be restored at this step. Not for the placeholder path — that wire's
 * `@@` was restored in `tokenize` already, and doing it again would eat a literal `@@` down to `@` (Codex on #107
 * pointed out the asymmetry). `replace` matches left to right without overlap, like the tokeniser, so `@@@@` → `@@`
 * and `@@@@@` → `@@@`, consistent on both sides
 */
export function unescapeText(s: string, format: WireFormat = 'tags'): string {
  // Entities first, then `@@`: an engine that encoded `@@` as `&#64;&#64;` would be missed the other way round
  return format === 'markers' ? decodeText(s).replace(/@@/g, '@') : decodeText(s)
}
