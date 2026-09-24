// Sentence units cut from the live page: Read arXiv's extractor finds the blocks, its serialiser turns each into
// wire text with a DOM map, its splitter cuts sentences, and rangesOf maps every sentence back to exact Ranges.
import { extract, type Block } from '@/core/extractor'
import { nodeOffsetAt, rangesOf, serialize, type WireSpan } from '@/core/protector'
import { ANNOTATION_SELECTOR, DOCUMENT_TITLE, NOTE, documentRoot } from '@/core/rules/latexml'
import { sentenceCuts, visibleTextOf } from '@/core/sentences'
import { ELEMENT_NODE } from '@/core/text'
import type { Unit, UnitKind } from '@/shared/units'

export interface PageUnits {
  title: string
  units: Unit[]
  ranges: Map<string, Range[]>
}

/** Block rules whose text is prose a reader reads: paragraphs, captions, footnotes, list items, \intertext rows */
const KEEP = new Set(['p', 'caption', 'footnote', 'item', 'intertext'])
/** Never evidence, never a caveat; a frontmatter note (author thanks, funding) is not a body footnote (§7.2) */
const OUTSIDE = `.ltx_bibliography, .ltx_acknowledgements, ${NOTE.frontmatter}`
const SECTION = 'section.ltx_section, section.ltx_appendix'
const EQUATION = 'table.ltx_equation, table.ltx_eqn_table, .ltx_equationgroup'
/** Inline TeX longer than this reads as noise to the engine; the experiment's units used the same cut */
const MATH_LIMIT = 60

export const squash = (s: string): string => s.replace(/[\s ]+/g, ' ').replace(/ ([,.;:)\]])/g, '$1').replace(/([([]) /g, '$1').trim()

function kindOf(block: Block): UnitKind {
  if (block.el.closest('.ltx_abstract')) return 'abstract'
  if (block.unit === 'caption') return 'caption'
  if (block.unit === 'footnote') return 'footnote'
  return 'body'
}

function sectionOf(el: Element): [string, string] {
  const section = el.closest(SECTION)
  if (!section) return ['front', '']
  const heading = section.querySelector(':scope > .ltx_title')
  return [section.id, heading ? squash(heading.textContent ?? '') : '']
}

/** What a placeholder says in a sentence sent to the engine: maths as short TeX, display maths as a stand-in, notes as nothing */
function slotText(node: Node): string {
  if (node.nodeType !== ELEMENT_NODE) return visibleTextOf(node)
  const el = node as Element
  if (el.matches(ANNOTATION_SELECTOR)) return ''
  if (el.matches(EQUATION)) return ' [equation] '
  const math = el.localName === 'math' ? el : el.querySelector('math')
  if (math && (math === el || squash(visibleTextOf(el)) === squash(visibleTextOf(math)))) {
    if (math.getAttribute('display') === 'block') return ' [equation] '
    const alt = (math.getAttribute('alttext') ?? '').trim()
    return alt.length > MATH_LIMIT ? ' [math] ' : ` $${alt}$ `
  }
  return visibleTextOf(el)
}

function textBetween(spans: readonly WireSpan[], from: number, to: number): string {
  let out = ''
  for (const span of spans) {
    if (span.to <= from || span.from >= to) continue
    if (span.kind === 'text') {
      const a = nodeOffsetAt(span, Math.max(from, span.from))
      const b = nodeOffsetAt(span, Math.min(to, span.to))
      out += span.node.data.slice(a, b)
    } else if (span.role === 'void') {
      out += slotText(span.node)
    }
    // The open and close halves of a paired element add nothing: its text arrives through its own text spans
  }
  return squash(out)
}

/** [from, to) without the whitespace at either end, so a range never starts or ends on a space */
function trimmed(text: string, from: number, to: number): [number, number] {
  let a = from
  let b = to
  while (a < b && /\s/.test(text[a]!)) a++
  while (b > a && /\s/.test(text[b - 1]!)) b--
  return [a, b]
}

/** Forty words or more, under a fifth of them lower-case: a list of names or terms, not prose (spec §5.1) */
export function isList(text: string): boolean {
  const words = text.replace(/\$[^$]*\$|\[equation\]|\[math\]/g, ' ').match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (words.length < 40) return false
  return words.filter(w => /^[a-z]/.test(w)).length / words.length < 0.2
}

/** The blocks worth cutting, in document order, or null when the page is not a LaTeXML paper with an abstract */
function proseBlocks(doc: Document): Block[] | null {
  const root = documentRoot(doc)
  if (!root?.querySelector('.ltx_abstract')) return null
  // A watermark or licence notice sometimes sits ahead of the title itself (e.g. 1706.03762v7's red permission
  // line): outside the paper's own front matter, so nothing before the title counts as prose
  const title = doc.querySelector(DOCUMENT_TITLE)
  return extract(doc).filter(block => {
    if (block.kind !== 'text' || !KEEP.has(block.unit)) return false
    const el = block.el
    if (el.closest(OUTSIDE)) return false
    if (title && title.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) return false
    // Inside a figure only its caption is prose; a sub-figure's caption repeats the figure's
    if (block.unit !== 'caption' && el.closest('figure')) return false
    if (block.unit === 'caption' && el.closest('figure')?.parentElement?.closest('figure')) return false
    return true
  })
}

/** Cut one block into sentences, appending to `units` and `ranges` */
function cutBlock(block: Block, units: Unit[], ranges: Map<string, Range[]>): void {
  const el = block.el
  const kind = kindOf(block)
  const [sec, secTitle] = kind === 'abstract' ? ['abstract', 'Abstract'] : sectionOf(el)
  const pid = el.closest('.ltx_para')?.id || el.id || block.id
  const wire = serialize(el, 'tags')
  const slot = (id: number) => wire.slots.get(id)
  // A list of names has no terminal punctuation, only line breaks between entries, and Intl.Segmenter's sentence
  // granularity breaks after every one of them (UAX #29 SB4): cut normally, a 1000-name author list becomes 1000
  // two-word "sentences", none long enough for isList to ever see. Checked whole first, before it is shredded.
  const cuts = isList(textBetween(wire.offsets, 0, wire.text.length))
    ? [0, wire.text.length]
    : [
        0,
        ...sentenceCuts(wire.text, 'tags', {
          textOf: id => {
            const node = slot(id)
            return node ? visibleTextOf(node) : undefined
          },
          isAnnotation: id => {
            const node = slot(id)
            return !!node && node.nodeType === ELEMENT_NODE && (node as Element).matches(ANNOTATION_SELECTOR)
          },
        }),
        wire.text.length,
      ]
  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = trimmed(wire.text, cuts[i]!, cuts[i + 1]!)
    if (to <= from) continue
    const text = textBetween(wire.offsets, from, to)
    if (!/[A-Za-z]{2}/.test(text)) continue
    const sid = `s${String(units.length + 1).padStart(3, '0')}`
    const unit: Unit = { sid, kind, sec, secTitle, pid, text }
    if (isList(text)) unit.list = true
    units.push(unit)
    ranges.set(sid, rangesOf(wire.offsets, from, to))
  }
}

const titleOf = (doc: Document) => squash(doc.querySelector(DOCUMENT_TITLE)?.textContent ?? '')

export function pageUnits(doc: Document): PageUnits | null {
  const blocks = proseBlocks(doc)
  if (!blocks) return null
  const units: Unit[] = []
  const ranges = new Map<string, Range[]>()
  for (const block of blocks) cutBlock(block, units, ranges)
  return { title: titleOf(doc), units, ranges }
}

/**
 * The same cut, yielding to the page whenever a slice of work passes `slice` ms, so the heaviest paper never makes
 * a long task (spec §10). `busyMs` is the main-thread time spent, for the performance budget.
 */
export async function pageUnitsChunked(doc: Document, slice = 25): Promise<(PageUnits & { busyMs: number }) | null> {
  let busyMs = 0
  let start = performance.now()
  const blocks = proseBlocks(doc)
  if (!blocks) return null
  const units: Unit[] = []
  const ranges = new Map<string, Range[]>()
  for (const block of blocks) {
    cutBlock(block, units, ranges)
    if (performance.now() - start > slice) {
      busyMs += performance.now() - start
      await new Promise(resolve => setTimeout(resolve, 0))
      start = performance.now()
    }
  }
  const title = titleOf(doc)
  busyMs += performance.now() - start
  return { title, units, ranges, busyMs }
}

export async function hashUnits(units: readonly Unit[]): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(units.map(u => [u.kind, u.text])))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
