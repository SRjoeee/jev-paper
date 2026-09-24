import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hashUnits, isList, pageUnits, pageUnitsChunked, squash } from '@/content/units'

const load = (path: string) => new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures', path), 'utf8'), 'text/html')

/**
 * Do not assert on `Range` here: happy-dom returns an empty string from `Range.toString()` for any
 * range, and the last boundary call overwrites both ends (tests/protector/offsets.test.ts:11-17).
 * Real Ranges are checked in the browser by the e2e suite (Task 14); here the boundary calls
 * `rangesOf` makes are recorded instead, one recorder per `createRange` call, and the covered text
 * is rebuilt from the recorded node/offset pairs directly.
 */
type Boundary = { node?: Node; offset?: number; mode?: 'offset' | 'before' | 'after' }

function rangeRecorder() {
  const start: Boundary = {}
  const end: Boundary = {}
  return {
    start,
    end,
    setStart: (n: Node, o: number) => {
      start.node = n
      start.offset = o
      start.mode = 'offset'
    },
    setEnd: (n: Node, o: number) => {
      end.node = n
      end.offset = o
      end.mode = 'offset'
    },
    setStartBefore: (n: Node) => {
      start.node = n
      start.mode = 'before'
    },
    setStartAfter: (n: Node) => {
      start.node = n
      start.mode = 'after'
    },
    setEndBefore: (n: Node) => {
      end.node = n
      end.mode = 'before'
    },
    setEndAfter: (n: Node) => {
      end.node = n
      end.mode = 'after'
    },
  }
}

type RangeRecorder = ReturnType<typeof rangeRecorder>

/** The next node after `node`'s own subtree, in document order (siblings, then an ancestor's siblings). */
function afterSubtree(node: Node): Node | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nextSibling) return cur.nextSibling
    cur = cur.parentNode
  }
  return null
}

/** The next node in document order: into children first, else the next node after this subtree. */
function nextInOrder(node: Node): Node | null {
  return node.firstChild ?? afterSubtree(node)
}

/**
 * What the `lead` this test compares against never contains: a MathML `<annotation>`/`<annotation-xml>`
 * (the raw TeX source, hidden from a reader — `@/core/sentences`'s `visibleTextOf` excludes it the same
 * way, and a render-aware `Range.toString()` would too), and `<math>` itself, since `u.text` represents
 * a formula as `$tex$`/`[equation]`/`[math]` and the test's own `lead` strips that out to a blank before
 * comparing (`u.text.replace(/\$[^$]*\$|\[equation\]|\[math\]/g, ' ')`) — so the DOM text this walk
 * rebuilds has to blank the same content, or a sentence like "Given 𝐳, the decoder…" would compare its
 * rendered symbol against a blank and never match.
 */
const SKIP = 'annotation, annotation-xml, math'

/** `node`'s own text as a reader would see it: every descendant text node, minus a `SKIP` subtree. */
function textOfSubtree(node: Node): string {
  if (node.nodeType === 3) return (node as Text).data
  if (node.nodeType === 1 && (node as Element).matches(SKIP)) return ''
  let out = ''
  for (const child of Array.from(node.childNodes)) out += textOfSubtree(child)
  return out
}

/**
 * Same text node on both ends: the exact slice, directly. Otherwise, a document-order walk between the two
 * recorded boundaries, collecting every rendered text node's data along the way — the same content a working
 * `Range.toString()` would give, built from plain DOM traversal instead of the broken `Range` object. A
 * paired element's "before"/"after" boundary means the walk starts inside it (before) or skips its whole
 * subtree (after), matching what `setStartBefore`/`setStartAfter` mean for a real Range.
 */
function coveredText(r: RangeRecorder): string {
  const { start, end } = r
  if (!start.node || !end.node) return ''
  if (start.mode === 'offset' && end.mode === 'offset' && start.node === end.node && start.node.nodeType === 3) {
    return (start.node as Text).data.slice(start.offset!, end.offset!)
  }

  let out = ''
  let cursor: Node | null
  if (start.mode === 'offset' && start.node.nodeType === 3) {
    out += (start.node as Text).data.slice(start.offset!)
    cursor = afterSubtree(start.node)
  } else if (start.mode === 'after') {
    cursor = afterSubtree(start.node)
  } else {
    // 'before' (or an element passed to setStart/setEnd): the walk starts at this node, subtree included
    cursor = start.node
  }

  while (cursor) {
    if (cursor === end.node) {
      if (end.mode === 'offset' && end.node.nodeType === 3) out += (end.node as Text).data.slice(0, end.offset!)
      else if (end.mode === 'after') out += textOfSubtree(end.node)
      // 'before': end.node's own subtree is excluded, nothing more to add
      break
    }
    if (cursor.nodeType === 3) {
      out += (cursor as Text).data
      cursor = nextInOrder(cursor)
    } else if (cursor.nodeType === 1 && (cursor as Element).matches(SKIP)) {
      cursor = afterSubtree(cursor)
    } else {
      cursor = nextInOrder(cursor)
    }
  }
  return out
}

describe('pageUnits on Attention Is All You Need (1706.03762v7)', () => {
  const page = pageUnits(load('jev/1706.03762v7.html'))!

  it('finds the title and the abstract first', () => {
    expect(page.title).toBe('Attention Is All You Need')
    const abs = page.units.filter(u => u.kind === 'abstract')
    expect(abs.length).toBeGreaterThanOrEqual(5)
    expect(abs[0]!.text.startsWith('The dominant sequence transduction models')).toBe(true)
    expect(abs[0]!.sid).toBe('s001')
    expect(abs.every(u => u.sec === 'abstract' && u.secTitle === 'Abstract')).toBe(true)
  })

  it('numbers sentences in document order', () => {
    page.units.forEach((u, i) => {
      expect(u.sid).toBe(`s${String(i + 1).padStart(3, '0')}`)
    })
  })

  it('writes inline maths as short TeX and never leaks a placeholder', () => {
    expect(page.units.some(u => u.text.includes('$d_{k}$'))).toBe(true)
    expect(page.units.some(u => /<t id=|<x id=|<\/t>/.test(u.text))).toBe(false)
  })

  it('keeps sections, captions and footnotes, and drops the bibliography', () => {
    expect(page.units.some(u => u.kind === 'body' && /Introduction/.test(u.secTitle))).toBe(true)
    expect(page.units.some(u => u.kind === 'caption')).toBe(true)
    expect(page.units.some(u => /arXiv preprint/.test(u.text))).toBe(false)
  })

  it('gives every unit ranges that cover its words', () => {
    // Stub before pageUnits runs: rangesOf gets its Range objects from the node's own document, and
    // every one of them needs to come back as a recorder rather than a real (unusable) happy-dom Range.
    const doc = load('jev/1706.03762v7.html')
    const spy = vi.spyOn(doc, 'createRange').mockImplementation(() => rangeRecorder() as unknown as Range)
    const recorded = pageUnits(doc)!
    spy.mockRestore()

    for (const u of recorded.units.slice(0, 60)) {
      const ranges = recorded.ranges.get(u.sid)!
      expect(ranges.length).toBeGreaterThan(0)
      const covered = squash(ranges.map(r => coveredText(r as unknown as RangeRecorder)).join(''))
      // squash() itself, both here and in the unit's own text, closes the gap before punctuation
      // (`Given $tex$, the decoder` -> `Given, the decoder`); stripping the maths without squashing the
      // join back down would leave an artificial "Given ," that squashed real text never contains.
      const words = u.text.replace(/\$[^$]*\$|\[equation\]|\[math\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2)
      const lead = squash(words.join(' '))
      expect(covered.replace(/\s+/g, ' ')).toContain(lead)
    }
  })
})

describe('pageUnits elsewhere', () => {
  it('flags the Kimi K3 author list, and only it, as a list', () => {
    const page = pageUnits(load('jev/2607.24653v2.html'))!
    const lists = page.units.filter(u => u.list)
    expect(lists).toHaveLength(1)
    expect(lists[0]!.secTitle).toMatch(/Contributions/)
    expect(lists[0]!.text.length).toBeGreaterThan(4000)
  })

  it('returns null for a page that is not a LaTeXML paper', () => {
    expect(pageUnits(new DOMParser().parseFromString('<html><body><p>Hello.</p></body></html>', 'text/html'))).toBeNull()
  })

  it('handles the heaviest fixture', () => {
    const page = pageUnits(load('arxiv/2312.17141.html'))!
    expect(page.units.length).toBeGreaterThan(300)
    expect(page.units.filter(u => u.list)).toHaveLength(0)
  })

  it('the chunked cut gives the same units and reports its busy time', async () => {
    const doc = load('jev/1706.03762v7.html')
    const chunked = (await pageUnitsChunked(doc, 1))!
    expect(chunked.units).toEqual(pageUnits(doc)!.units)
    expect(chunked.busyMs).toBeGreaterThan(0)
  })
})

describe('isList', () => {
  it('is true for forty-odd capitalised names and false for prose', () => {
    const names = Array.from({ length: 45 }, (_, i) => `Name${i} Surname${i}`).join(' ')
    expect(isList(names)).toBe(true)
    expect(isList('We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.')).toBe(false)
  })
})

describe('hashUnits', () => {
  it('depends on kind and text only', async () => {
    const a = await hashUnits([{ sid: 's001', kind: 'abstract', sec: 'abstract', secTitle: 'Abstract', pid: 'p', text: 'One.' }])
    const b = await hashUnits([{ sid: 's009', kind: 'abstract', sec: 'x', secTitle: 'y', pid: 'q', text: 'One.' }])
    const c = await hashUnits([{ sid: 's001', kind: 'body', sec: 'abstract', secTitle: 'Abstract', pid: 'p', text: 'One.' }])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
