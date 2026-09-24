// Copied from Read arXiv src/core/sentences/index.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// Sentence splitting for engines that do not report their own boundaries (issue #105).
//
// Microsoft returns `sentLen` and an LLM can report boundaries through its schema, so neither needs
// this. Google has nothing of the kind: aligning sentences there means choosing the boundaries
// ourselves and injecting markers at them, which is the only reason this module exists.
//
// It runs on **wire text**, after `serialize`. That is what makes it viable: formulas are already
// placeholders, so `f(x) = 0.5` cannot be mistaken for a sentence end, and the only remaining
// hazard is abbreviations.
//
// Measured against Microsoft's `srcSentLen` over 60 real blocks (see the `experiment/
// sentence-alignment` branch): 98.4% precision and 91.7% recall overall, and **100% precision** once
// bibliography blocks are excluded — both spurious cuts there were journal abbreviations such as
// `Sci. Rep. 14 (2024)`. What remains is under-splitting, 13 of 146, which makes a highlight span
// two sentences instead of one. Over-splitting, which would put a highlight on half a sentence,
// does not occur. Callers must not run this on reference blocks (§5.4 excludes them anyway).
//
// `Sci` and `Rep` were added after that measurement, which is why it saw those two cuts. Extending
// this list can only *remove* cut points, so precision cannot fall: removing a wrong cut raises it,
// removing a right one lowers recall instead. Checked offline over all 3210 fixture blocks — the
// larger list removes 5 cuts and adds none, and all 5 are journal abbreviations in bibliographies
// (`Theor. Comput. Sci.`, `J. Fac. Sci. Univ. Tokyo`, `Sci. Rep. 14`).

import { fromAlpha, type WireFormat } from '@/core/protector'

/**
 * A period after one of these does not end a sentence. Single capitals cover initials (`A. Turing`)
 * and the journal-volume style that produced the only failures measured; the rest are the
 * abbreviations that actually appear in arXiv prose and bibliographies.
 */
export const ABBR =
  /\b(?:[A-Z]|Fig|Figs|Eq|Eqs|Sec|Secs|Ref|Refs|Thm|Def|Lem|Prop|Cor|Rev|Phys|Lett|Nucl|Astron|Astrophys|Mon|Not|Proc|Conf|Int|J|vs|etc|cf|al|approx|resp|Dr|Prof|St|No|Vol|pp|Ed|Eds|Sci|Rep|e\.g|i\.e)\.$/

/**
 * Sentence lengths, in order, summing exactly to `text.length`.
 *
 * The exact partition is the contract: `verifyAlignment` rejects anything that does not reconstruct
 * the text it describes, so a splitter that lost or duplicated a character would simply produce no
 * highlight. Returns a single length for text with no interior boundary.
 */
/**
 * Placeholder syntax as it appears in wire text. `tags` wraps inline markup in `<t id="N">` … `</t>`
 * pairs and formulas in `<x id="N"/>`; `markers` uses `@abc#`.
 *
 * `@@` comes first, as in the protector's own tokenizer: that is how serialisation escapes a literal
 * `@`, and matching markers first reads the second `@` of `@@a#` as a placeholder and cuts a
 * sentence in the middle of ordinary text (Codex on #126).
 */
const TAGS_PLACEHOLDER = /<x\s+id="\d+"\/>|<\/?t(?:\s+id="\d+")?>/g
const MARKERS_PLACEHOLDER = /@@|@[a-z]+#/g

/**
 * The two formats use disjoint syntax, and reading one as the other invents boundaries in ordinary
 * text: `escapeText` leaves a literal `@` alone on the `tags` path, so `Done. @a# is a literal.`
 * would be projected as a placeholder there (Codex on #126). The caller knows which format it
 * serialised with, so it says.
 */
const placeholderRe = (format: WireFormat) => (format === 'markers' ? MARKERS_PLACEHOLDER : TAGS_PLACEHOLDER)

/** The slot id a placeholder run refers to, so its semantics can be looked up. */
function idOf(run: string): number | undefined {
  const tag = /id="(\d+)"/.exec(run)
  if (tag) return Number(tag[1])
  const marker = /^@([a-z]+)#$/.exec(run)
  return marker ? fromAlpha(marker[1]!) : undefined
}

/** A `<t>` or `</t>` run: structural wrapping around inline markup, standing for no content itself */
const STRUCTURAL = /^<\/?t(?:\s+id="\d+")?>$/
const OPENING = /^<t(?:\s+id="\d+")?>$/

/** Abbreviations that genuinely end sentences, so the text after them decides whether to merge */
export const TERMINAL_ABBR = /\b(?:etc|al)\.$/
/**
 * A continuation rather than a new sentence. Lowercase, a number, or an opening bracket: an
 * abbreviation after `etc.` or `al.` opens the next sentence rather than proving the first was
 * internal — "by Smith et al. Fig. 2 shows …" is two sentences (Codex on #126) — but a bracket is
 * how a citation is written, and `by Gopalan et al. [GHSY12], which reduces …` is one sentence
 * (`tests/fixtures/arxiv/2401.00418.html`, Codex on #137). Measured over the whole fixture corpus:
 * the bracket removes that one cut and adds none.
 */
const CONTINUES = /^\s*[a-z0-9([]/

const VOID_TOKEN = 'Xx'

/**
 * What a placeholder projects to, in visible coordinates. A boundary the segmenter finds strictly
 * inside one of these is not a boundary of the block — see `sentenceCuts`.
 */
interface Token { from: number; to: number }

/**
 * Whether the placeholder with this id annotates the text before it — a footnote or a citation —
 * rather than being content of its own.
 *
 * **This cannot be decided from the wire text.** Three rounds of review found counterexamples to
 * guessing it from the following word's case: `… method@a#. @b# We require …` is a footnote, while
 * `… relation@a#. @b# Let @c# …` is a formula opening a sentence, and both read as "punctuation,
 * placeholder, capitalised word" (Codex on #126). The caller has `classify()` for every slot, so it
 * answers rather than the splitter guessing.
 *
 * Without one, every placeholder counts as content: a sentence opening on a formula keeps its
 * boundary, and a trailing footnote lands one placeholder late.
 */
export type IsAnnotation = (id: number) => boolean

/**
 * The text a placeholder stands for, so the projection can show it instead of a stand-in.
 *
 * The stand-in throws away exactly what the segmenter needs. A sentence-final period can live
 * *inside* the math node — `tests/fixtures/arxiv/2609.00246.html` has one — and then the wire text
 * holds no terminal punctuation at all, so no projection of a generic token can recover the
 * boundary. A `\citet` placeholder is the grammatical subject of its sentence, and its own text
 * ("Smith et al.") reads as one where a token does not (Codex on #126).
 *
 * The caller has `slots`, so it can answer with `node.textContent`.
 */
export type TextOfSlot = (id: number) => string | undefined

/**
 * The text of a node as a reader sees it, for use as `textOf`.
 *
 * **Not `node.textContent`.** A MathML node carries its TeX source in a hidden `<annotation>`, so
 * textContent hands back things like `F\mathbin{\sqcup\!\sqcup}G`, whose backslashes and braces
 * the segmenter reads as punctuation and cuts on — a half-sentence highlight from markup nobody can
 * see (Codex on #126). A `<br>` reports nothing at all, though it separates what is around it.
 *
 * Element names only, no `ltx_*` selectors, so this stays out of the rules module's territory.
 */
export function visibleTextOf(node: Node): string {
  // HTML renders a formatting newline as a space, so keeping it would look like a `<br>` to the
  // segmenter: an indented cross-reference reads `let. ∗` but its markup says `let.\n ∗`, and the
  // cut landed before the reference (Codex on #126). Same five characters `serialize` collapses.
  if (node.nodeType === 3) return (node as Text).data.replace(/[\t\n\f\r ]+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const name = el.tagName.toLowerCase()
  if (name === 'br') return '\n'
  // The TeX source and any alternate encodings are for machines, not readers
  if (name === 'annotation' || name === 'annotation-xml') return ''
  let out = ''
  for (const child of Array.from(el.childNodes)) out += visibleTextOf(child)
  return out
}

export interface SplitContext {
  /** Placeholders that annotate the text before them — footnotes, trailing citations */
  isAnnotation?: IsAnnotation
  /** What each placeholder actually says */
  textOf?: TextOfSlot
}

/**
 * Segmenting the wire text directly hides sentence ends that sit against a placeholder. A run-in
 * heading serialises as `<t id="1">Motivation.</t> Concurrent programs …`, and `Intl.Segmenter` sees
 * `.` followed by `<` rather than by whitespace, so it reports no boundary at all — measured, and
 * `tests/fixtures/arxiv/2312.17527.html` alone has 18 run-in headings.
 *
 * So segment a projection where each placeholder becomes whitespace, except a void that opens a
 * sentence, which becomes a word so the boundary stays visible.
 */
function project(text: string, format: WireFormat, context: SplitContext): { visible: string; toWire: number[]; openEnds: Map<number, number>; tokens: Token[] } {
  let visible = ''
  // toWire[i] is the wire offset that visible offset i starts at
  const toWire: number[] = []
  // wire offset just past an opening tag -> where that tag starts
  const openEnds = new Map<number, number>()
  const tokens: Token[] = []
  let at = 0
  const re = placeholderRe(format)
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0
    for (let i = at; i < index; i++) {
      toWire.push(i)
      visible += text[i]
    }
    const run = m[0]
    const after = index + run.length
    let token: string
    if (run === '@@') {
      // An escaped literal `@`: ordinary text, not a placeholder, so it projects as itself
      token = '@'
    } else if (STRUCTURAL.test(run)) {
      // Nothing, not a space: a tag wraps, it does not separate. `<em>Dr</em>.` serialises to
      // `<t id="1">Dr</t>.` and projecting the tags as spaces gave ` Dr . `, where the abbreviation
      // guard sees `Dr .` and cannot suppress the cut — styling would change where sentences end
      // (Codex on #126). The source's own spaces still separate what it separates.
      token = ''
      if (OPENING.test(run)) openEnds.set(after, index)
    } else {
      // An annotation belongs to the text before it and must not open a sentence. Content shows its
      // own text when the caller can supply it — that is what carries punctuation living inside a
      // math node, and what makes a citation read as the subject it is. Otherwise a stand-in word.
      const id = idOf(run)
      if (id !== undefined && context.isAnnotation?.(id)) token = ' '
      else {
        const own = id !== undefined ? context.textOf?.(id) : undefined
        if (own === undefined) token = VOID_TOKEN
        // A `<br>` says nothing but separates: Intl.Segmenter treats a newline as a boundary even
        // without terminal punctuation, and routing whitespace-only slots to the stand-in threw
        // that away (Codex on #126). Collapse spaces and tabs, keep newlines.
        else if (!own.trim()) token = /\n/.test(own) ? '\n' : ' '
        else token = own.replace(/[\t\f\r ]+/g, ' ')
      }
    }
    for (let i = 0; i < token.length; i++) toWire.push(index)
    if (token.length > 0) tokens.push({ from: visible.length, to: visible.length + token.length })
    visible += token
    at = after
  }
  for (let i = at; i < text.length; i++) {
    toWire.push(i)
    visible += text[i]
  }
  toWire.push(text.length)
  return { visible, toWire, openEnds, tokens }
}

/** Cut points inside the text, i.e. the boundaries between sentences, excluding 0 and `length`. */
export function sentenceCuts(text: string, format: WireFormat = 'tags', context: SplitContext = {}): number[] {
  if (text.length === 0) return []
  const { visible, toWire, openEnds, tokens } = project(text, format, context)
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const pieces: string[] = []
  for (const { segment } of segmenter.segment(visible)) {
    const prev = pieces[pieces.length - 1]
    const tail = prev?.trimEnd() ?? ''
    // The previous piece ended on an abbreviation, so the boundary between them is usually
    // spurious — except for the few that really can end a sentence, where what follows decides.
    // Measured over 2330 fixture blocks: restricted this way it adds exactly one cut, the
    // `… Lie algebras, etc. We refer to …` that prompted it, and no wrong ones (Codex on #126).
    const merge = prev !== undefined && ABBR.test(tail) && (!TERMINAL_ABBR.test(tail) || CONTINUES.test(segment))
    if (merge) pieces[pieces.length - 1] = prev + segment
    else pieces.push(segment)
  }
  const cuts: number[] = []
  let at = 0
  for (let i = 0; i < pieces.length - 1; i++) {
    at += pieces[i]!.length
    // **A boundary inside a placeholder's own text is not a boundary of the block.** A citation
    // carries periods that end nothing — `[11, Ex. 2.6 & §8.1]`, `(Fol95, Section 7.B)` — and the
    // segmenter cuts at them. Every character of a token maps back to the same wire offset, so such
    // a break surfaces as a cut in *front* of the whole placeholder and splits a sentence in half
    // (Codex on #137 reported the symptom on citations). Measured over the fixture corpus: dropping
    // them removes 38 cuts, adds none, and every one of the 38 is mid-sentence.
    //
    // A sentence that genuinely ends inside a slot — a period living in a math node, which
    // `tests/fixtures/arxiv/2609.00246.html` has — is not this case: its boundary falls at the end
    // of the token, not inside it, and already maps to the offset past the placeholder.
    if (tokens.some(t => at > t.from && at < t.to)) continue
    let wire = toWire[at] ?? text.length
    // A cut can land just past an opening tag, which leaves `<t id="N">` at the end of one sentence
    // and its content plus `</t>` in the next — the pair split across two. Walk back over any
    // opening tag ending here, and over whitespace that the segmenter took as the tag's trailing
    // space when the wrapped content itself starts with a space (Codex on #126).
    for (;;) {
      if (openEnds.has(wire)) {
        wire = openEnds.get(wire)!
        continue
      }
      const back = wire - 1
      if (back > 0 && /[\t\n\f\r ]/.test(text[back] ?? '') && openEnds.has(back)) {
        wire = back
        continue
      }
      break
    }
    // A cut landing where a placeholder starts is fine; one that would not advance is dropped
    if (wire > (cuts[cuts.length - 1] ?? 0) && wire < text.length) cuts.push(wire)
  }
  return cuts
}
