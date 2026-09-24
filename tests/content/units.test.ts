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

/** LaTeXML's display equation between two paragraphs of one `.ltx_para` (1806.07572, S5.p2) */
const EQ = (id: string) =>
  `<table id="${id}" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_eqn_center_padleft"></td><td class="ltx_eqn_cell ltx_align_center"><math id="${id}.m1" class="ltx_Math" alttext="C(f)=\\frac{1}{2N}\\sum_{i}(f(x_{i})-y_{i})^{2}." display="block"><semantics><mi>C</mi><annotation encoding="application/x-tex">C(f)=\\frac{1}{2N}\\sum_{i}(f(x_{i})-y_{i})^{2}.</annotation></semantics></math></td><td class="ltx_eqn_cell ltx_eqn_center_padright"></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(${id})</span></td></tr></tbody></table>`

/** A LaTeXML paper whose first section holds `body` */
const paper = (body: string) =>
  new DOMParser().parseFromString(
    `<html><body><article class="ltx_document"><h1 class="ltx_title ltx_title_document">A Paper</h1><div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6><p class="ltx_p">We study the cost.</p></div><section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Setting</h2>${body}</section></article></body></html>`,
    'text/html',
  )

const body = (doc: Document) => pageUnits(doc)!.units.filter(u => u.kind !== 'abstract')
const texts = (doc: Document) => body(doc).map(u => u.text)

describe('sentences through display equations', () => {
  // A as a reader sees it (with a formula) and as the unit writes it
  const A_HTML = 'For a dataset of size <math alttext="N" display="inline"><semantics><mi>N</mi><annotation encoding="application/x-tex">N</annotation></semantics></math>, the least-squares regression cost is'
  const A = 'For a dataset of size $N$, the least-squares regression cost is'
  const B = 'Theorems 1 and 2 apply to an ANN trained on such a cost.'

  it('runs a paragraph on through the equation after it as one unit', () => {
    const doc = paper(`<div id="S1.p1" class="ltx_para"><p class="ltx_p">We fix a dataset. ${A_HTML}</p>\n${EQ('1')}\n<p class="ltx_p">${B} A last sentence.</p></div>`)
    const units = body(doc)
    expect(units.map(u => u.text)).toEqual(['We fix a dataset.', `${A} [equation] ${B}`, 'A last sentence.'])
    expect(units.map(u => u.sid)).toEqual(['s002', 's003', 's004'])
    expect(units.every(u => u.pid === 'S1.p1' && u.sec === 'S1' && u.kind === 'body')).toBe(true)
  })

  it("gives the merged unit the first paragraph's ranges, then the second's", () => {
    const doc = paper(`<div id="S1.p1" class="ltx_para"><p id="S1.p1.1" class="ltx_p">We fix a dataset. ${A_HTML}</p>${EQ('1')}<p id="S1.p1.2" class="ltx_p">${B} A last sentence.</p></div>`)
    const spy = vi.spyOn(doc, 'createRange').mockImplementation(() => rangeRecorder() as unknown as Range)
    const page = pageUnits(doc)!
    spy.mockRestore()
    const merged = page.units.find(u => u.text.includes('[equation]'))!
    const ranges = page.ranges.get(merged.sid)! as unknown as RangeRecorder[]
    const inside = (r: RangeRecorder) => (r.start.node!.nodeType === 1 ? (r.start.node as Element) : r.start.node!.parentElement!).closest('.ltx_p')!.id
    // The first paragraph's ranges first, then the second's
    expect(ranges.map(inside)).toEqual([...ranges.map(inside)].sort())
    expect(new Set(ranges.map(inside))).toEqual(new Set(['S1.p1.1', 'S1.p1.2']))
    expect(squash(ranges.filter(r => inside(r) === 'S1.p1.1').map(coveredText).join(''))).toBe(squash(A.replace('$N$', '')))
    expect(squash(ranges.filter(r => inside(r) === 'S1.p1.2').map(coveredText).join(''))).toBe(B)
  })

  it('keeps the cut when the first paragraph ends its sentence', () => {
    const doc = paper(`<div class="ltx_para"><p class="ltx_p">The cost is defined below.</p>${EQ('1')}<p class="ltx_p">${B}</p></div>`)
    expect(texts(doc)).toEqual(['The cost is defined below.', B])
  })

  it('chains through two equations, and writes one [equation] per equation', () => {
    const doc = paper(
      `<div class="ltx_para"><p class="ltx_p">${A_HTML}</p>${EQ('1')}<p class="ltx_p">where <math alttext="x_{i}" display="inline"><mi>x</mi></math> are the inputs, and the gradient is</p>${EQ('2')}${EQ('3')}<p class="ltx_p">${B}</p></div>`,
    )
    expect(texts(doc)).toEqual([`${A} [equation] where $x_{i}$ are the inputs, and the gradient is [equation] [equation] ${B}`])
  })

  it('never runs on into another .ltx_para', () => {
    const doc = paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}</p></div>${EQ('1')}<div class="ltx_para"><p class="ltx_p">${B}</p></div>`)
    expect(texts(doc)).toEqual([A, B])
  })

  it('never runs a caption on into a paragraph', () => {
    const inFigure = paper(`<div class="ltx_para"><figure class="ltx_figure"><figcaption class="ltx_caption">Figure 1: The cost of the network</figcaption></figure>${EQ('1')}<p class="ltx_p">${B}</p></div>`)
    expect(texts(inFigure)).toEqual(['Figure 1: The cost of the network', B])
    const beside = paper(`<div class="ltx_para"><span class="ltx_caption">Figure 1: The cost of the network</span>${EQ('1')}<p class="ltx_p">${B}</p></div>`)
    expect(texts(beside)).toEqual(['Figure 1: The cost of the network', B])
  })

  it('ends a sentence on the equations that close its .ltx_para, and not one that already ended', () => {
    expect(texts(paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}</p>${EQ('1')}</div>`))).toEqual([`${A} [equation]`])
    expect(texts(paper(`<div class="ltx_para"><p class="ltx_p">The cost is below.</p>${EQ('1')}</div>`))).toEqual(['The cost is below.'])
    // The `∎` closing a proof is no paragraph of its own (no letter), and does not stop the sentence either
    expect(texts(paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}</p>${EQ('1')}<p class="ltx_p">∎</p></div>`))).toEqual([`${A} [equation]`])
  })

  it('takes a lone full stop after the equation as the end of the sentence', () => {
    const doc = paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}</p>${EQ('1')}<p class="ltx_p">. Next we train the network.</p>${EQ('2')}<p class="ltx_p">${B}</p></div>`)
    expect(texts(doc)).toEqual([`${A} [equation].`, 'Next we train the network.', B])
  })

  it("numbers a footnote in the first paragraph after the sentence it runs on into", () => {
    const note = '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>The cost is also called the empirical risk.</span></span></span>'
    const doc = paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}${note}</p>${EQ('1')}<p class="ltx_p">${B} A last sentence.</p></div>`)
    expect(body(doc).map(u => [u.kind, u.text])).toEqual([
      ['body', `${A} [equation] ${B}`],
      ['footnote', 'The cost is also called the empirical risk.'],
      ['body', 'A last sentence.'],
    ])
  })

  it('the chunked cut runs on through equations the same way', async () => {
    const doc = paper(`<div class="ltx_para"><p class="ltx_p">${A_HTML}</p>${EQ('1')}<p class="ltx_p">${B}</p></div>`)
    expect((await pageUnitsChunked(doc, 0))!.units).toEqual(pageUnits(doc)!.units)
  })

  it('on 2312.17141, no sentence stops short of an equation in its .ltx_para without ending', () => {
    const doc = load('arxiv/2312.17141.html')
    const spy = vi.spyOn(doc, 'createRange').mockImplementation(() => rangeRecorder() as unknown as Range)
    const page = pageUnits(doc)!
    spy.mockRestore()
    const DISPLAY = '.ltx_equation, .ltx_eqn_table, .ltx_equationgroup, math[display="block"]'
    const equationNext = (p: Element) => {
      let n = p.nextSibling
      while (n && n.nodeType === 3 && !/\S/.test((n as Text).data)) n = n.nextSibling
      return !!n && n.nodeType === 1 && (n as Element).matches(DISPLAY) && !!p.parentElement?.closest('.ltx_para')
    }
    // The unit whose last range ends in a paragraph that an equation follows: it stops there
    const stops = new Map<Element, (typeof page.units)[number]>()
    // A footnote's ranges end inside the paragraph that holds its mark, and the footnote is numbered after it
    for (const u of page.units.filter(u => u.kind !== 'footnote')) {
      const last = (page.ranges.get(u.sid) as unknown as RangeRecorder[]).at(-1)!.end.node!
      const p = (last.nodeType === 1 ? (last as Element) : last.parentElement!).closest('.ltx_p')
      if (p) stops.set(p, u)
    }
    const short = [...stops].filter(([p]) => equationNext(p)).map(([, u]) => u)
    expect(short.length).toBeGreaterThan(50)
    expect(short.filter(u => !/[.?!]['"’”)\]]*$|\[equation\]$/.test(u.text)).map(u => u.text)).toEqual([])
    expect(page.units.filter(u => /\[equation\] \S/.test(u.text)).length).toBeGreaterThan(50)
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
