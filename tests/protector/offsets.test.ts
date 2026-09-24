// Copied from Read arXiv tests/protector/offsets.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, rangesOf, serialize, spanAt, type WireSpan } from '@/core/protector'
import { el } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/**
 * Do not assert on `Range` here. happy-dom returns an empty string from `Range.toString()` for any
 * range, and a range built with setStart(node, 4) then setEnd(node, 10) reports startOffset 10 —
 * the same class of hazard as its CSS.supports being unconditionally true. These tests cover the
 * offset arithmetic and the span resolution, which are pure data; `Range` behaviour is verified in
 * the browser by `pnpm e2e`, which is where the highlight lives anyway.
 *
 * `textOf` slices the node data directly, which is what `rangesOf(...)`'s ranges should produce in
 * a real browser for an interval that stays within text spans.
 */
function textOf(spans: readonly WireSpan[], from: number, to: number): string {
  let out = ''
  for (const span of spans) {
    if (span.to <= from || span.from >= to || span.kind !== 'text') continue
    const start = nodeOffsetAt(span, Math.max(span.from, from))
    const end = nodeOffsetAt(span, Math.min(span.to, to))
    out += span.node.data.slice(start, end)
  }
  return out
}

const textSpans = (spans: readonly WireSpan[]) => spans.filter(s => s.kind === 'text')

/**
 * Records which boundary calls `rangesOf` makes, so the decision can be asserted without relying on
 * happy-dom's Range. Stubs `createRange` on the nodes' own document, which is where `rangesOf` gets
 * it from.
 */
function boundaryCalls(root: Element, spans: readonly WireSpan[], from: number, to: number): string[] {
  const calls: string[] = []
  const name = (n: Node) => (n.nodeType === 3 ? `text(${JSON.stringify((n as Text).data.slice(0, 6))})` : (n as Element).tagName.toLowerCase())
  const recorder = {
    setStart: (n: Node, o: number) => calls.push(`start@${name(n)}:${o}`),
    setEnd: (n: Node, o: number) => calls.push(`end@${name(n)}:${o}`),
    setStartBefore: (n: Node) => calls.push(`startBefore:${name(n)}`),
    setStartAfter: (n: Node) => calls.push(`startAfter:${name(n)}`),
    setEndBefore: (n: Node) => calls.push(`endBefore:${name(n)}`),
    setEndAfter: (n: Node) => calls.push(`endAfter:${name(n)}`),
  }
  const doc = root.ownerDocument
  const spy = vi.spyOn(doc, 'createRange').mockReturnValue(recorder as unknown as Range)
  rangesOf(spans, from, to)
  spy.mockRestore()
  return calls
}


describe('wire offsets to DOM (#105)', () => {
  // As above: the whole fixture set × two formats, CPU-bound, racing the global 30 s margin
  it('emits byte-identical wire text on both paths across every fixture and format', { timeout: 120_000 }, () => {
    // The two paths are deliberately separate: the default one escapes the whole string at once and
    // collapses once, touching not one extra character; only the tracked one walks per character so
    // it can record anchors. This is the single guard against them drifting apart.
    let blocks = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html'))) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        for (const fmt of ['tags', 'markers'] as const) {
          const plain = serialize(b.el, fmt)
          const tracked = serialize(b.el, fmt)
          expect([f, b.id, fmt, tracked.text]).toEqual([f, b.id, fmt, plain.text])
          blocks++
        }
      }
    }
    expect(blocks).toBeGreaterThan(2000)
  })

  it('tiles the whole wire text with no gap and no overlap', () => {
    // Placeholders are spans too. Leaving gaps for them is what dropped formulas at range
    // boundaries before (Codex on #123), so full coverage is the invariant that prevents it.
    const block = serialize(el('<p class="ltx_p">one <math><mi>x</mi></math> two <em>three</em> four</p>'), 'tags')
    const spans = block.offsets
    let at = 0
    for (const span of spans) {
      expect([span.from, span.to > span.from]).toEqual([at, true])
      at = span.to
    }
    expect(at).toBe(block.text.length)
  })

  it('resolves a boundary inside a placeholder to that node, not to the neighbouring text', () => {
    // `<math>x</math> is positive` — the interval starts inside the placeholder. Resolving it to the
    // following text span would highlight " is positive" and drop the formula.
    const block = serialize(el('<p class="ltx_p"><math><mi>x</mi></math> is positive</p>'), 'tags')
    const first = spanAt(block.offsets, 0)
    expect([first?.kind, first && (first.node as Element).tagName.toLowerCase()]).toEqual(['slot', 'math'])

    const trailing = serialize(el('<p class="ltx_p">positive is <math><mi>x</mi></math></p>'), 'tags')
    const last = spanAt(trailing.offsets, trailing.text.length - 1)
    expect([last?.kind, last && (last.node as Element).tagName.toLowerCase()]).toEqual(['slot', 'math'])
  })

  it('labels each placeholder run with what it stands for', () => {
    // A void run stands for the whole node, so an interval ending on it ends after the node; the
    // two halves of a pair bracket the element's content instead. Getting this wrong collapsed
    // formula-only intervals and dropped trailing formulas (Codex on #123).
    const paired = serialize(el('<p class="ltx_p">a <em>b</em> c</p>'), 'tags')
    expect(paired.offsets.filter(s => s.kind === 'slot').map(s => (s.kind === 'slot' ? s.role : null))).toEqual(['open', 'close'])
    const voids = serialize(el('<p class="ltx_p">a <math><mi>x</mi></math> b</p>'), 'tags')
    expect(voids.offsets.filter(s => s.kind === 'slot').map(s => (s.kind === 'slot' ? s.role : null))).toEqual(['void'])
  })

  it('keeps the node offset monotone through an expanded escape', () => {
    // `&` is one node character but five wire characters. Interpolating through them walked the
    // node offset past the end of the escape, so a boundary at wire 4 mapped further into the node
    // than one at wire 5 — which collapsed the range and dropped what followed (Codex on #123).
    const block = serialize(el('<p class="ltx_p">&amp;Z</p>'), 'tags')
    expect(block.text).toBe('&amp;Z')
    const span = block.offsets[0]!
    expect(span.kind).toBe('text')
    if (span.kind !== 'text') return
    const mapped = [0, 1, 2, 3, 4, 5, 6].map(w => nodeOffsetAt(span, w))
    expect(mapped).toEqual([...mapped].sort((a, b) => a - b))
    // Everything inside the escape snaps to just after the character it encodes
    expect(mapped).toEqual([0, 1, 1, 1, 1, 1, 2])
    expect(textOf(block.offsets, 4, 6)).toBe('Z')
  })

  it('an interval covering only a placeholder brackets that node instead of collapsing', () => {
    // Ending *before* a void run puts both boundaries in the same place, so the formula-only
    // interval selects nothing and a trailing formula falls outside (Codex on #123).
    const root = el('<p class="ltx_p"><math><mi>x</mi></math></p>')
    const block = serialize(root, 'tags')
    expect(textSpans(block.offsets)).toEqual([])
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual(['startBefore:math', 'endAfter:math'])
  })

  it('ends after a trailing formula, and before the content of a paired element', () => {
    const withFormula = el('<p class="ltx_p">value is <math><mi>x</mi></math></p>')
    const a = serialize(withFormula, 'tags')
    expect(boundaryCalls(withFormula, a.offsets, 0, a.text.length).at(-1)).toBe('endAfter:math')

    // The open half of a pair is the opposite: an interval ending there stops before the content
    const paired = el('<p class="ltx_p">a <em>b</em> c</p>')
    const b = serialize(paired, 'tags')
    const openEnd = b.offsets.find(s => s.kind === 'slot' && s.role === 'open')!
    expect(boundaryCalls(paired, b.offsets, 0, openEnd.to).at(-1)).toBe('endBefore:em')
  })

  it('starts after the element when the boundary lands in a closing tag', () => {
    // A sentence beginning exactly where a paired element ends: `<em>Foo.</em>Bar.`
    const root = el('<p class="ltx_p"><em>Foo.</em>Bar.</p>')
    const block = serialize(root, 'tags')
    const close = block.offsets.find(s => s.kind === 'slot' && s.role === 'close')!
    expect(boundaryCalls(root, block.offsets, close.from, block.text.length)[0]).toBe('startAfter:em')
  })

  it('keeps offsets aligned past an entity, where one character becomes five', () => {
    const block = serialize(el('<p class="ltx_p">A &amp; B ends here</p>'), 'tags')
    expect(block.text).toBe('A &amp; B ends here')
    const at = block.text.indexOf('B ends')
    expect(textOf(block.offsets, at, at + 6)).toBe('B ends')
  })

  it('keeps offsets aligned past a doubled @, which markers uses for a literal one', () => {
    const block = serialize(el('<p class="ltx_p">mail a@b.com then more text</p>'), 'markers')
    expect(block.text).toBe('mail a@@b.com then more text')
    const at = block.text.indexOf('then more')
    expect(textOf(block.offsets, at, at + 9)).toBe('then more')
  })

  it('keeps offsets aligned past collapsed whitespace (#119)', () => {
    const block = serialize(el('<p class="ltx_p">first line\n   second line\n\n  third line</p>'), 'tags')
    expect(block.text).toBe('first line second line third line')
    const at = block.text.indexOf('third')
    expect(textOf(block.offsets, at, at + 5)).toBe('third')
  })

  it('leaves NBSP alone, so it neither collapses nor shifts the offsets', () => {
    const block = serialize(el('<p class="ltx_p">see Section 1.1 and then some</p>'), 'tags')
    expect(block.text).toContain(' ')
    const at = block.text.indexOf('and then')
    expect(textOf(block.offsets, at, at + 8)).toBe('and then')
  })

  it('cuts the interval where an injected node sits between two runs', () => {
    // An inner block that finished translating first leaves its translation in the DOM between two
    // runs that are adjacent in wire coordinates. One range across that gap would highlight the
    // inner translation as if it were source text (Codex on #123).
    const root = el('<p class="ltx_p">before <span class="axt-t" data-axt-for="x">translated</span> after</p>')
    const block = serialize(root, 'tags')
    expect(block.text).toBe('before after')
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual([
      'start@text("before"):0',
      'end@text("before"):7',
      'start@text(" after"):1',
      'end@text(" after"):6',
    ])
  })

  it('sees a node injected after serialisation, which a recorded flag could not', () => {
    // planBatches serialises every block before processBatch inserts the pending node and later the
    // translation, so a flag written during serialisation is already stale by the time a nested
    // block finishes (Codex on #123). The check has to run when the range is built.
    const root = el('<p class="ltx_p">before after</p>')
    const block = serialize(root, 'tags')
    expect(block.text).toBe('before after')
    // One run, one range — nothing injected yet
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual(['start@text("before"):0', 'end@text("before"):12'])

    // Now split the text node and insert a translation between the halves, as the renderer would
    const original = block.offsets[0]!
    if (original.kind !== 'text') return
    const tail = original.node.splitText(7)
    const injected = root.ownerDocument.createElement('span')
    injected.className = 'axt-t'
    injected.textContent = 'translated'
    tail.parentNode!.insertBefore(injected, tail)
    // Re-serialise to get spans over the new node layout, then the gap must be detected
    const after = serialize(root, 'tags')
    expect(after.text).toBe('before after')
    expect(boundaryCalls(root, after.offsets, 0, after.text.length)).toEqual([
      'start@text("before"):0',
      'end@text("before"):7',
      'start@text("after"):0',
      'end@text("after"):5',
    ])
  })

  it('does not split at an ordinary closing tag, even once the block has a translation', () => {
    // The closing slot's node is the element itself, which is an *ancestor* of the text run before
    // it. A preorder walk never returns to an ancestor, so an unbounded one ran off the end of the
    // block, met the block's own .axt-t sibling and reported a discontinuity at every closing tag
    // (Codex on #123). Bounding the walk by the common ancestor is what stops that.
    const doc = new DOMParser().parseFromString('<!doctype html><html><body><div></div></body></html>', 'text/html')
    const host = doc.querySelector('div')!
    host.innerHTML = '<p class="ltx_p">start <em>inner</em> tail</p><p class="axt-t" data-axt-for="x">translated</p>'
    const root = host.querySelector('p.ltx_p')!
    const block = serialize(root, 'tags')
    const close = block.offsets.find(s => s.kind === 'slot' && s.role === 'close')!
    const before = block.offsets[block.offsets.indexOf(close) - 1]!
    // The pair really is ancestor/descendant, which is the shape that broke the walk
    expect(close.node.contains(before.node)).toBe(true)
    // One range across the whole block: the sibling translation is outside it, not a reason to cut
    const calls = boundaryCalls(root, block.offsets, 0, block.text.length)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe('start@text("start "):0')
  })

  it('still splits when an injected node really does sit inside a paired element', () => {
    // Bounding the walk must not blind it: an inner translation inside the <em> is a real gap.
    const root = el('<p class="ltx_p">a <em>one <span class="axt-t" data-axt-for="y">t</span> two</em> b</p>')
    const block = serialize(root, 'tags')
    const calls = boundaryCalls(root, block.offsets, 0, block.text.length)
    expect(calls.length).toBeGreaterThan(2)
  })

  it('carves our own translation out of a slot that holds one', () => {
    // A footnote is a single void slot and its translation renders *inside* it — renderText puts
    // the .axt-t next to .ltx_note_content, a descendant of the protected note. Ending after that
    // slot encloses the translation, and injectedBetween cannot see it because it only looks
    // between spans (Codex on #123).
    const root = el('<p class="ltx_p">The claim holds<span class="ltx_note"><span class="ltx_note_content">note</span><span class="axt-t" data-axt-for="n">translated</span></span></p>')
    const block = serialize(root, 'tags')
    const slot = block.offsets.find(s => s.kind === 'slot')!
    expect((slot.node as Element).querySelectorAll('.axt-t')).toHaveLength(1)
    // Text up to the note, then the note carved around its translation: never one range over the note
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual([
      'start@text("The cl"):0',
      'end@text("The cl"):15',
      'startBefore:span',
      'endBefore:span',
      'startAfter:span',
      'endAfter:span',
    ])
  })

  it('carves a footnote\'s floated box out of its slot, keeping the mark on the line', () => {
    // ar5iv floats `.ltx_note_outer` to the page's edge. A range over the whole note covers it, and
    // Chrome reports every text box inside a range, so hovering the sentence tinted the entire note
    // in the margin (user, 2026-09-10). The mark is on the line and stays in the sentence.
    const root = el('<p class="ltx_p">The claim holds<span class="ltx_note"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content">note</span><span class="axt-t" data-axt-for="n">译</span></span></span></p>')
    const block = serialize(root, 'tags')
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual([
      'start@text("The cl"):0',
      'end@text("The cl"):15',
      'startBefore:span', // the note, mark included …
      'endBefore:span', // … up to its floated box
      'startAfter:span', // after the box (the translation inside it is inside what was stepped over)
      'endAfter:span',
    ])
  })

  it('leaves a slot without injected content as a single range', () => {
    const root = el('<p class="ltx_p">The claim holds<span class="ltx_note"><span class="ltx_note_content">note</span></span></p>')
    const block = serialize(root, 'tags')
    expect(boundaryCalls(root, block.offsets, 0, block.text.length)).toEqual([
      'start@text("The cl"):0',
      'endAfter:span',
    ])
  })

  it('carves only void slots, never the halves of a pair', () => {
    // A paired element is its open run, its text spans and its close run. Carving on either half
    // covers the whole element however little of it the interval asked for, and both halves carve
    // it again — the same element twice (Codex on #123). Injected content inside a pair sits
    // between the text spans, where injectedBetween finds it.
    const root = el('<p class="ltx_p">a <em>First. <span class="axt-t" data-axt-for="x">t</span>Second.</em> b</p>')
    const block = serialize(root, 'tags')
    const calls = boundaryCalls(root, block.offsets, 0, block.text.length)
    // Carving always opens with startBefore on the carved node, so its absence is the assertion.
    // `endAfter:em` on its own is the ordinary close-slot boundary and is expected.
    expect(calls.filter(c => c === 'startBefore:em')).toHaveLength(0)
    // The gap inside the pair is still found by injectedBetween, so the interval is still split
    expect(calls.filter(c => c.startsWith('start')).length).toBeGreaterThan(1)
  })

  it('does not re-walk a closing slot\'s own subtree', () => {
    // A closing slot stands for the boundary after its element, so descending into it walks that
    // element twice — quadratic on nested markup — and finds the injected node inside it again, as
    // if it came after the close. The interval then splits once more than it should (Codex on #123).
    const root = el('<p class="ltx_p">a <em>x <span class="axt-t" data-axt-for="i">t</span> y</em> tail</p>')
    const block = serialize(root, 'tags')
    const calls = boundaryCalls(root, block.offsets, 0, block.text.length)
    // Two ranges: around the injected span inside <em>, and nothing extra after the close
    expect(calls).toHaveLength(4)
    expect(calls.filter(c => c.startsWith('start'))).toHaveLength(2)
  })

  it('returns nothing for an interval reaching past the tiled wire text', () => {
    // The loop used to push the earlier segments before the final oneRange failed, so a malformed
    // request came back as a truncated prefix instead of nothing (Codex on #123).
    const root = el('<p class="ltx_p">before <span class="axt-t" data-axt-for="x">t</span> after</p>')
    const block = serialize(root, 'tags')
    expect(boundaryCalls(root, block.offsets, 0, block.text.length + 1)).toEqual([])
    expect(boundaryCalls(root, block.offsets, -1, block.text.length)).toEqual([])
  })

  it('holds on real fixture blocks: every span is well formed and its wire length matches', () => {
    const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, '2609.04056.html'), 'utf8'), 'text/html')
    let checked = 0
    for (const b of extract(d)) {
      if (b.kind !== 'text') continue
      const block = serialize(b.el, 'tags')
      for (const span of block.offsets) {
        expect(block.text.slice(span.from, span.to).length).toBe(span.to - span.from)
        if (span.kind === 'text') {
          expect([nodeOffsetAt(span, span.from) <= nodeOffsetAt(span, span.to), nodeOffsetAt(span, span.to) <= span.node.data.length])
            .toEqual([true, true])
        }
        checked++
      }
      if (checked > 400) break
    }
    expect(checked).toBeGreaterThan(100)
  })
})
