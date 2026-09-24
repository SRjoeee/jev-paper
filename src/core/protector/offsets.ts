// Copied from Read arXiv src/core/protector/offsets.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// Wire-text offsets mapped onto DOM ranges (companion to DESIGN §6.2).
//
// Sentence alignment is expressed in wire-text coordinates — Microsoft's `sentLen` is measured on
// the exact string we send (issue #105). Turning an interval of that string into a highlightable
// `Range` needs a mapping from wire offset to DOM position.
//
// Wire text and node content are not character-for-character: `escapeText` turns `&` into `&amp;`
// and, for markers, `@` into `@@`, and `serialize` collapses HTML whitespace on the way out (#119).
// Both transforms are per-character and context-free, so rather than storing a table per character
// a text span records an anchor only where one input character did not produce exactly one output
// character; between anchors the mapping is addition.

import { INJECTED_SELECTOR, isInjected } from '@/core/marks'
import { NOTE } from '@/core/rules/latexml'
import { decodeText, ENTITY_PATTERN } from './escape'
import { MARKER_RE, TAG_RE, fromAlpha, type WireFormat } from './tokens'

/** One run of wire text and where it came from. Text and slot spans together tile the whole string. */
export type WireSpan =
  | {
      kind: 'text'
      node: Text
      /** Interval `[from, to)` in the wire text */
      from: number
      to: number
      /**
       * Divergence points as `[wireOffset, nodeOffset]`. The mapping is strictly 1:1 between
       * consecutive anchors, so a lookup is a search plus an addition.
       */
      anchors: readonly (readonly [number, number])[]
    }
  | {
      /**
       * A placeholder: `<x id="N"/>`, `@abc#`, or one of the `<t id="N">` / `</t>` pair.
       * Its wire run has no character-level correspondence to anything in the DOM, so a range
       * boundary landing inside it resolves to the node's own boundary rather than an offset.
       */
      kind: 'slot'
      node: Node
      from: number
      to: number
      /**
       * Which part of the node this run stands for. A `void` run stands for the whole node, so an
       * interval ending on it must end *after* the node; `open` and `close` are the two halves of a
       * `<t id="N">` pair and bracket the element's content instead.
       */
      role: 'void' | 'open' | 'close'
    }

/**
 * Wire offset to offset within the node. Anchors are 1:1 in between, so take the last one at or
 * before the offset and add the difference.
 *
 * The result is clamped to the next anchor because an expanded escape is indivisible: `&` occupies
 * five wire characters but one node character, and interpolating through them walks the node
 * offset past where the escape ends. Without the clamp the mapping is not monotone — for `&Z`,
 * wire 4 gave node 2 while wire 5 gave node 1, which collapsed `rangesOf(4, 6)` and dropped the `Z`
 * (Codex pointed this out on #123). Clamping snaps any offset inside an escape to the position just
 * after the character it encodes.
 */
export function nodeOffsetAt(span: Extract<WireSpan, { kind: 'text' }>, wireOffset: number): number {
  const clamped = Math.max(span.from, Math.min(wireOffset, span.to))
  let lo = 0
  let hi = span.anchors.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (span.anchors[mid]![0] <= clamped) lo = mid
    else hi = mid - 1
  }
  const [wire, node] = span.anchors[lo]!
  const ceiling = span.anchors[lo + 1]?.[1] ?? span.node.data.length
  return Math.min(node + (clamped - wire), ceiling)
}

/**
 * Node → the span it belongs to. Built once per block, used on every pointer move.
 *
 * The lookup used to be a linear scan of the spans, with a `contains()` call per span when the
 * position was inside a placeholder's subtree. That is a hit test running on every frame over a
 * block that can hold hundreds of runs, so on a formula-dense paragraph it meant hundreds of DOM
 * calls per frame. A map costs one pass at registration and turns the scan into a lookup.
 *
 * **The first span for a node wins, and that matters.** A paired element is recorded twice, as its
 * `open` and `close` runs, and both name the same element. A pointer landing on the element itself
 * is inside it, so it has to resolve to where it opens; keeping the closing run instead would put
 * the hit in whatever sentence comes after it.
 */
export type SpanIndex = ReadonlyMap<Node, WireSpan>

export function indexSpans(spans: readonly WireSpan[]): SpanIndex {
  const index = new Map<Node, WireSpan>()
  for (const span of spans) if (!index.has(span.node)) index.set(span.node, span)
  return index
}

/**
 * A DOM position back to a wire offset — the inverse of `nodeOffsetAt`, which #123 did not need
 * because it only ever went from an interval to a `Range`. Hit testing goes the other way.
 *
 * **The answer is the last wire offset that maps back to this node offset, not the first.** A caret
 * at node offset k sits after character k-1, so everything encoding characters 0..k-1 is behind it,
 * including all five characters of an `&amp;`. With `A & B`, node 2 is before the ampersand at wire
 * 2 and node 3 is after it at wire 7 — not wire 3, where the escape begins. Both choices satisfy
 * "wireOffsetAt then nodeOffsetAt returns k", which is why that property alone does not pin this
 * down and `tests/protector/scan.test.ts` asserts maximality instead.
 *
 * A position inside a placeholder resolves to where that placeholder's wire run starts: the caret
 * is somewhere inside a formula, and the formula is one indivisible run. Positions deeper inside it
 * are found by walking up to the node the slot was recorded for, which is bounded by the depth of
 * the markup rather than by the number of runs in the block.
 */
export function wireOffsetAt(index: SpanIndex, node: Node, nodeOffset: number): number | undefined {
  let span = index.get(node)
  // Inside a placeholder's subtree — a caret landing within a formula
  for (let up: Node | null = node.parentNode; !span && up; up = up.parentNode) span = index.get(up)
  if (!span) return undefined
  if (span.kind !== 'text') return span.from
  const clamped = Math.max(0, Math.min(nodeOffset, span.node.data.length))
  let lo = 0
  let hi = span.anchors.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (span.anchors[mid]![1] <= clamped) lo = mid
    else hi = mid - 1
  }
  const [wire, nodeAt] = span.anchors[lo]!
  // No ceiling from the next anchor is needed here, unlike `nodeOffsetAt`. The search picked the
  // last anchor at or before `clamped`, so `clamped` is strictly below the next anchor's node
  // offset, and a wire run is never shorter than the node run it encodes — the sum therefore
  // cannot reach the next anchor. Only the span's own end is a real bound, and only if the node's
  // data has grown since rehydration.
  return Math.min(wire + (clamped - nodeAt), span.to)
}

/** The span covering this wire offset. Spans tile the wire text, so this only misses past the end. */
export function spanAt(spans: readonly WireSpan[], wireOffset: number): WireSpan | undefined {
  let lo = 0
  let hi = spans.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const span = spans[mid]!
    if (wireOffset < span.from) hi = mid - 1
    else if (wireOffset >= span.to) lo = mid + 1
    else return span
  }
  return undefined
}

function oneRange(spans: readonly WireSpan[], from: number, to: number): Range | undefined {
  const start = spanAt(spans, from)
  const end = spanAt(spans, to - 1)
  if (!start || !end) return undefined
  // The range must come from the nodes' own document; building it from another one silently
  // yields an empty toString().
  const range = (start.node.ownerDocument ?? end.node.ownerDocument)?.createRange()
  if (!range) return undefined
  if (start.kind === 'text') range.setStart(start.node, nodeOffsetAt(start, from))
  else if (start.role === 'close') range.setStartAfter(start.node)
  else range.setStartBefore(start.node)
  // A void run stands for the whole node, so ending on it has to end *after* it — ending before
  // would collapse a formula-only interval and drop a trailing formula (Codex on #123). The `open`
  // half of a pair is the opposite: an interval ending there stops before the element's content.
  if (end.kind === 'text') range.setEnd(end.node, nodeOffsetAt(end, to))
  else if (end.role === 'open') range.setEndBefore(end.node)
  else range.setEndAfter(end.node)
  return range
}

/**
 * What a sentence's ranges must not reach into, inside a placeholder: our own nodes, and a
 * footnote's box.
 *
 * The box is out of the sentence's line — ar5iv floats it to the page's edge — but a range over
 * the placeholder covers it, and Chrome reports every text box inside a range, so hovering the
 * sentence tinted the whole note in the margin (user, 2026-09-10, on 2609.09360v1). The note's
 * mark stays: it is on the line, and part of the sentence.
 */
const CARVED = `${INJECTED_SELECTOR}, ${NOTE.outer}`

/**
 * The node, minus the carved subtrees inside it, as one range per surviving stretch. Keeps the
 * parts a reader should see on the line — a footnote marker — while leaving our own translation
 * and the note's floated box outside the highlight.
 */
function carveOut(node: Element): Range[] {
  const doc = node.ownerDocument
  const injected = Array.from(node.querySelectorAll(CARVED))
  if (!doc || injected.length === 0) return []
  const out: Range[] = []
  let anchorNode: Node = node
  let anchorAfter = false
  for (const stale of injected) {
    // Skip one nested inside another we have already stepped over
    if (out.length > 0 && anchorAfter && (anchorNode as Element).contains(stale)) continue
    const range = doc.createRange()
    if (anchorAfter) range.setStartAfter(anchorNode)
    else range.setStartBefore(anchorNode)
    range.setEndBefore(stale)
    out.push(range)
    anchorNode = stale
    anchorAfter = true
  }
  const tail = doc.createRange()
  if (anchorAfter) tail.setStartAfter(anchorNode)
  else tail.setStartBefore(anchorNode)
  tail.setEndAfter(node)
  out.push(tail)
  return out
}

/** The next node in document order after this whole subtree, never leaving `scope`. */
function afterSubtree(node: Node, scope: Node): Node | undefined {
  let current: Node | null = node
  while (current && current !== scope) {
    if (current.nextSibling) return current.nextSibling
    current = current.parentNode
  }
  return undefined
}

/** The next node in document order, never leaving `scope`'s subtree. */
function nextInOrder(node: Node, scope: Node): Node | undefined {
  return node.firstChild ?? afterSubtree(node, scope)
}

/** Nearest node containing both, so a walk between them cannot escape into the rest of the page. */
function commonAncestor(a: Node, b: Node): Node {
  const chain = new Set<Node>()
  for (let node: Node | null = a; node; node = node.parentNode) chain.add(node)
  for (let node: Node | null = b; node; node = node.parentNode) if (chain.has(node)) return node
  return a.ownerDocument?.documentElement ?? a
}

/**
 * Whether a node we injected lies between these two runs right now.
 *
 * **Asked at range time, not recorded at serialize time.** `planBatches` serialises every selected
 * block before `processBatch` inserts the pending node and later the translation, so a flag written
 * during serialisation cannot know about a nested block that finished afterwards — and that is
 * exactly the flow this guards (Codex pointed this out on #123).
 *
 * The walk is bounded by the common ancestor. `b` is frequently an *ancestor* of `a` — the last text
 * inside a paired element and that element's own closing slot — and a preorder walk never returns to
 * an ancestor, so an unbounded one runs off the end of the block, meets the block's own translation
 * sibling, and reports a discontinuity at every ordinary closing tag. Scanning the rest of the page
 * once per closing tag also makes building a highlight quadratic in the document (Codex on #123).
 */
function injectedBetween(from: WireSpan, to: WireSpan): boolean {
  const a = from.node
  const b = to.node
  if (a === b) return false
  const scope = commonAncestor(a, b)
  // A closing slot stands for the boundary *after* its element, so that subtree is already behind
  // us. Descending into it walks the element a second time — quadratic on nested markup — and
  // rediscovers any injected descendant as if it came after the close (Codex on #123).
  let node = from.kind === 'slot' && from.role === 'close' ? afterSubtree(a, scope) : nextInOrder(a, scope)
  while (node) {
    if (node === b) return false
    if (node.nodeType === 1 && isInjected(node as Element)) return true
    node = nextInOrder(node, scope)
  }
  return false
}

/**
 * Wire interval `[from, to)` as ranges.
 *
 * **Usually one range, but not always.** `serialize` skips nodes we injected ourselves, and more
 * arrive after serialisation, so two runs that are adjacent in wire coordinates can have a
 * translation sitting between them in the DOM. One range spanning that gap would contain the inner
 * translation and highlight it as if it were source text, so the interval is cut at every such
 * discontinuity. `Highlight` takes any number of ranges, so the caller just spreads them.
 *
 * A boundary inside a placeholder resolves to that node's own boundary, so a sentence that opens or
 * closes on a formula still contains it.
 *
 * Returns an empty array when there is nothing to select: no spans, an empty interval, or an
 * interval reaching outside the tiled wire text. Out-of-bounds is checked **before** any range is
 * built, so a malformed request yields nothing rather than a truncated prefix.
 */
export function rangesOf(spans: readonly WireSpan[], from: number, to: number): Range[] {
  if (spans.length === 0 || to <= from) return []
  const first = spans[0]!
  const last = spans[spans.length - 1]!
  if (from < first.from || to > last.to) return []

  const out: Range[] = []
  let segmentStart = from
  let previous = spanAt(spans, from)
  const flush = (end: number) => {
    if (end <= segmentStart) return
    const range = oneRange(spans, segmentStart, end)
    if (range) out.push(range)
  }
  for (const span of spans) {
    if (span.to <= from || span.from >= to) continue
    // A *void* slot holding our own translation — a footnote whose content was translated in place
    // — is covered by carved pieces instead of one range enclosing the whole node (Codex on #123).
    //
    // Only void. A paired element is represented by its open and close runs with text spans in
    // between, so carving on either half would cover the whole element however little of it the
    // interval asked for, and both halves would carve it again. Injected content inside a pair sits
    // between those text spans, where injectedBetween already finds it.
    const holds = span.kind === 'slot' && span.role === 'void' && span.node.nodeType === 1 && (span.node as Element).querySelector(CARVED)
    if (holds) {
      flush(span.from)
      out.push(...carveOut(span.node as Element))
      segmentStart = span.to
      previous = span
      continue
    }
    if (span.from > from && previous && injectedBetween(previous, span)) {
      flush(span.from)
      segmentStart = span.from
    }
    previous = span
  }
  flush(to)
  return out
}

/** Matches one HTML entity at the start of the string, the same shape `decodeText` decodes. */
const ENTITY_AT_START = new RegExp(`^(?:${ENTITY_PATTERN})`, 'i')

/**
 * A token with the wire interval it came from, plus anchors for a text token.
 *
 * `tokenize` reports no positions and cannot cheaply: it is the hottest path in the protector
 * (#107 measured an 11% regression from restructuring it), and its markers branch has already
 * turned `@@` back into `@` by the time a caller sees a token. So this mirrors it instead of
 * changing it, sharing its two regexes, and a test pins the two against each other over every
 * fixture in both formats.
 */
export type PositionedToken =
  | { kind: 'text'; text: string; from: number; to: number; anchors: readonly (readonly [number, number])[] }
  | { kind: 'void'; id: number; from: number; to: number }
  | { kind: 'open'; id: number; from: number; to: number }
  | { kind: 'close'; from: number; to: number }

/** Decodes a text run the way `tokenize` and `decodeText` do, recording where the two diverge. */
function decodeRun(wire: string, wireStart: number, format: WireFormat): { text: string; anchors: [number, number][] } {
  const anchors: [number, number][] = [[wireStart, 0]]
  let text = ''
  let i = 0
  while (i < wire.length) {
    // `@@` first, as MARKER_RE has it: that is how a literal `@` is escaped
    if (format === 'markers' && wire.startsWith('@@', i)) {
      text += '@'
      i += 2
      anchors.push([wireStart + i, text.length])
      continue
    }
    const entity = ENTITY_AT_START.exec(wire.slice(i))
    if (entity) {
      text += decodeText(entity[0])
      i += entity[0].length
      anchors.push([wireStart + i, text.length])
      continue
    }
    text += wire[i]
    i += 1
  }
  return { text, anchors }
}

/**
 * The token sequence `tokenize` produces, with wire positions.
 *
 * An escaped `@` is skipped without closing the text run, so a literal `@` never splits one token
 * into two the way it would if `@@` were treated as a placeholder — which is what makes the two
 * sequences correspond one to one.
 */
export function scanTokens(s: string, format: WireFormat): PositionedToken[] {
  const out: PositionedToken[] = []
  const pushText = (from: number, to: number) => {
    if (to <= from) return
    const { text, anchors } = decodeRun(s.slice(from, to), from, format)
    out.push({ kind: 'text', text, from, to, anchors })
  }
  let last = 0
  for (const m of s.matchAll(format === 'markers' ? MARKER_RE : TAG_RE)) {
    const index = m.index ?? 0
    const end = index + m[0].length
    // An escaped `@` is text, not a placeholder; decodeRun turns it back into one character
    if (m[0] === '@@') continue
    pushText(last, index)
    if (format === 'markers') out.push({ kind: 'void', id: fromAlpha(m[1]!), from: index, to: end })
    else if (m[0].startsWith('</')) out.push({ kind: 'close', from: index, to: end })
    else if (m[0].startsWith('<x')) out.push({ kind: 'void', id: Number(m[1] ?? m[2] ?? m[3]), from: index, to: end })
    else out.push({ kind: 'open', id: Number(m[4] ?? m[5] ?? m[6]), from: index, to: end })
    last = end
  }
  pushText(last, s.length)
  return out
}

/**
 * An element's own content as ranges, cut at every node we injected inside it — a nested block's
 * translation, a skeleton, a footnote copy — and at a footnote's margin box, so that none of them
 * is painted as if it were the element's text. What the hover highlight paints for a block that has no sentence map (§7.7): a
 * translation and its original pair by construction, so the whole block is a safe unit wherever
 * the engine reported no sentence boundaries. One range per stretch of own content, in order.
 */
export function wholeRanges(el: Element): Range[] {
  const doc = el.ownerDocument
  const out: Range[] = []
  let open: Range | null = null
  const close = () => {
    if (open) out.push(open)
    open = null
  }
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      // Our own nodes, and a footnote's box (`.ltx_note_outer`, floated into the margin, a unit of its own): cut
      // around, as `rangesOf` carves them out — the note's mark stays inline in the text (Devin on #226)
      if (child.nodeType === 1 && (isInjected(child as Element) || (child as Element).matches(NOTE.outer))) {
        close()
        continue
      }
      if (child.nodeType === 3) {
        if (!open) {
          open = doc.createRange()
          open.setStart(child, 0)
        }
        open.setEnd(child, (child as Text).data.length)
        continue
      }
      if (child.nodeType === 1) walk(child)
    }
  }
  walk(el)
  close()
  return out
}
