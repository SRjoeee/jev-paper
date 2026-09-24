// Copied from Read arXiv tests/extractor/extract.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { statsOf } from './stats'
import { classify } from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
type TableBlock = Extract<Block, { kind: 'table' }>

/** Parse a fragment inside the translation root */
function docOf(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`,
    'text/html',
  )
}

describe('extract: text blocks', () => {
  it('a single paragraph is one block, the id taken from the element\'s own id', () => {
    const blocks = extract(docOf('<div class="ltx_para" id="S1.p1"><p class="ltx_p" id="S1.p1.1">Hello world.</p></div>'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'S1.p1.1', kind: 'text', unit: 'p' })
  })

  it('a paragraph of formulas, digits or numbering only is no block', () => {
    expect(extract(docOf('<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math> = 1</p>'))).toHaveLength(0)
    expect(extract(docOf('<p class="ltx_p">(12)</p>'))).toHaveLength(0)
    expect(extract(docOf('<p class="ltx_p">12.5 (3)</p>'))).toHaveLength(0)
    expect(extract(docOf('<p class="ltx_p">   </p>'))).toHaveLength(0)
  })

  it('any Unicode letter makes a block: the rule is a letter, not a Latin one', () => {
    expect(extract(docOf('<p class="ltx_p">证明。</p>'))).toHaveLength(1)
    expect(extract(docOf('<p class="ltx_p">λ</p>'))).toHaveLength(1)
  })

  it('a footnote inside a paragraph: the paragraph first, the footnote body after; a footnote without id is numbered by block order', () => {
    const blocks = extract(docOf(
      '<p class="ltx_p" id="p1">Text<span class="ltx_note ltx_role_footnote" id="footnote1"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note body.</span></span></span> more.</p>',
    ))
    expect(blocks.map(b => [b.id, b.unit])).toEqual([['p1', 'p'], ['axt-b2', 'footnote']])
  })

  it('a heading inside an acknowledgements block is a nested unit: two blocks, each on its own', () => {
    const blocks = extract(docOf('<div class="ltx_acknowledgements" id="ack"><h6 class="ltx_title">Acknowledgements</h6>We thank everyone.</div>'))
    expect(blocks.map(b => b.unit)).toEqual(['ack', 'title'])
  })

  it('with the outer unit having no own text only the inner one is a block', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="outer"><span class="ltx_inline-block"><span class="ltx_p" id="inner">Inner text.</span></span></p>'))
    expect(blocks.map(b => b.id)).toEqual(['inner'])
  })

  it('a paragraph inside a code block is no block', () => {
    expect(extract(docOf('<div class="ltx_listing"><p class="ltx_p">not a block</p></div>'))).toHaveLength(0)
  })

  it('a conversion error inside a paragraph does not stop the paragraph being a block', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="p1">Some <span class="ltx_ERROR undefined">\\foo</span> text.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['p1'])
  })

  it('returns an empty array without a translation root', () => {
    const doc = new DOMParser().parseFromString('<html><body><p class="ltx_p">x</p></body></html>', 'text/html')
    expect(extract(doc)).toEqual([])
  })
})

describe('extract: a picture\'s labels (§15.6)', () => {
  const node = (inner: string) => `<foreignObject><span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">${inner}</span></span></foreignObject>`
  const math = (tex: string) => `<math class="ltx_Math"><semantics><mi>${tex}</mi><annotation encoding="application/x-tex">\\${tex}</annotation></semantics></math>`
  const picture = (...nodes: string[]) => `<figure class="ltx_figure"><svg class="ltx_picture"><g>${nodes.map(node).join('')}</g></svg></figure>`
  const texts = (blocks: Block[]) => blocks.map(block => [block.unit, block.el.textContent])

  it('each label with words is a block of its own; the picture is entered, not skipped', () => {
    expect(texts(extract(docOf(picture('Shared Expert', 'Router'))))).toEqual([['picturelabel', 'Shared Expert'], ['picturelabel', 'Router']])
  })

  it('a label is sent on its own, and on its own a single letter, a number and a formula are symbols: two letters running make a label', () => {
    expect(extract(docOf(picture('N', '2', 'L2', math('alpha'), '3 ×')))).toHaveLength(0)
    // In a sentence one letter is enough, as ever
    expect(extract(docOf('<p class="ltx_p">a</p>'))).toHaveLength(1)
  })

  it('an identifier set as text in math mode is a symbol too: `initMT`, the corpus\'s one (2609.00246; Codex on #163) — alone it is no block, beside words it goes with them', () => {
    const marked = '<span class="ltx_text ltx_markedasmath">initMT</span>'
    expect(extract(docOf(picture(marked)))).toHaveLength(0)
    expect(texts(extract(docOf(picture(`call ${marked}`))))).toEqual([['picturelabel', 'call initMT']])
  })

  it('words beside a formula are one block, the formula going with them (`Block n−1`)', () => {
    const blocks = extract(docOf(picture(`Block ${math('n')}`)))
    expect(blocks.map(block => block.unit)).toEqual(['picturelabel'])
    expect(blocks[0]!.el.querySelector('math')).not.toBeNull()
  })

  it('a wrapped label holds a paragraph of its own, and that is the block: the finding boxes of 2608.29808 are five such', () => {
    const wrapped = '<span class="ltx_inline-block" style="width:300pt"><span class="ltx_p">PolyFlow is effective end to end.</span></span>'
    expect(texts(extract(docOf(picture(wrapped))))).toEqual([['p', 'PolyFlow is effective end to end.']])
  })

  it('the bar is the picture\'s, not the rule\'s: a wrapped label\'s paragraph is sent on its own just the same, and a single letter or a maths-marked identifier in one is a symbol (Devin on #277)', () => {
    const wrap = (inner: string) => `<span class="ltx_inline-block"><span class="ltx_p">${inner}</span></span>`
    expect(extract(docOf(picture(wrap('N'), wrap('<span class="ltx_text ltx_markedasmath">initMT</span>'))))).toHaveLength(0)
    expect(texts(extract(docOf(picture(wrap('Routed Expert')))))).toEqual([['p', 'Routed Expert']])
  })

  it('a picture inside a paragraph that is a block is that block\'s, labels and all: the paragraph cloned it whole, and a label found inside would be translated twice', () => {
    const inline = `<svg class="ltx_picture">${node('Shared Expert')}${node('<span class="ltx_inline-block"><span class="ltx_p">A wrapped label.</span></span>')}</svg>`
    expect(texts(extract(docOf(`<p class="ltx_p" id="p">See ${inline} here.</p>`))).map(([unit]) => unit)).toEqual(['p'])
    // A paragraph with no text of its own is no block and has cloned nothing: the picture is entered
    expect(texts(extract(docOf(`<p class="ltx_p">${inline}</p>`))).map(([unit]) => unit)).toEqual(['picturelabel', 'p'])
  })
})

describe('extract: table blocks', () => {
  const table =
    '<table class="ltx_tabular" id="T1"><thead><tr><th class="ltx_td ltx_th">Model</th><th class="ltx_td ltx_th">Acc (%)</th></tr></thead>'
    + '<tbody><tr><td class="ltx_td">Baseline</td><td class="ltx_td">91.2 ± 0.3</td></tr>'
    + '<tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">✓</td></tr>'
    + '<tr><td class="ltx_td"><p class="ltx_p" id="cellp">A sentence in a cell.</p></td><td class="ltx_td"></td></tr></tbody></table>'

  it('the whole table is one block, cells carry the numeric mark, paragraphs inside the table are no blocks', () => {
    const blocks = extract(docOf(table))
    expect(blocks).toHaveLength(1)
    const t = blocks[0] as TableBlock
    expect(t).toMatchObject({ id: 'T1', kind: 'table', unit: 'table' })
    expect(t.cells.map(c => c.numeric)).toEqual([false, false, false, true, true, true, false, true])
  })

  it('a table with no cell holding letters (an empty layout table, a formula-only table) is no block', () => {
    expect(extract(docOf('<div class="ltx_para"><table class="ltx_tabular"><tbody><tr><td class="ltx_td"></td></tr></tbody></table></div>'))).toHaveLength(0)
    expect(extract(docOf(
      '<table class="ltx_tabular"><tbody><tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">1.5</td></tr></tbody></table>',
    ))).toHaveLength(0)
    expect(extract(docOf('<table class="ltx_tabular"><tbody><tr><td class="ltx_td">?</td><td class="ltx_td">1</td></tr></tbody></table>'))).toHaveLength(0)
  })

  it('a nested tabular yields the outermost block only, the inner cells being cells of the outer block too (§5.3)', () => {
    const nested =
      '<table class="ltx_tabular" id="outer"><tbody><tr><td class="ltx_td">Outer cell'
      + '<table class="ltx_tabular" id="inner"><tbody><tr><td class="ltx_td">Alpha</td><td class="ltx_td">2</td></tr></tbody></table>'
      + '</td></tr></tbody></table>'
    const blocks = extract(docOf(nested))
    expect(blocks.map(b => b.id)).toEqual(['outer'])
    const cells = (blocks[0] as TableBlock).cells
    expect(cells.map(c => c.el.className)).toEqual(['ltx_td', 'ltx_td', 'ltx_td'])
    expect(cells.map(c => c.numeric)).toEqual([false, false, true])
  })

  it('an outer cell holding only a nested table has no own text and is copied as a numeric cell; the inner cells\' text is what gets translated (measured on Table 3 of 2410.00260)', () => {
    const nested =
      '<table class="ltx_tabular" id="outer"><tbody><tr><td class="ltx_td">'
      + '<table class="ltx_tabular" id="inner"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table>'
      + '</td></tr></tbody></table>'
    const cells = (extract(docOf(nested))[0] as TableBlock).cells
    expect(cells.map(c => c.numeric)).toEqual([true, false])
  })

  it('on a second extraction translations / mirrors already in the original block are no source (Codex on #8)', () => {
    const blocks = extract(docOf('<li class="ltx_item"><span class="ltx_tag">1.</span><span class="axt-t axt-mirror">mirror text</span><p class="ltx_p">Inner.</p><p class="ltx_p axt-t">译文</p></li>'))
    // The list item's own text is only the words inside the mirror; with it removed there are no letters, so no block; the paragraph is a block as usual
    expect(blocks.map(b => b.unit)).toEqual(['p'])
  })
})

describe('extract: ids', () => {
  it('blocks without id are numbered by block order', () => {
    const blocks = extract(docOf('<h2 class="ltx_title">Intro</h2><p class="ltx_p" id="p1">Text.</p><figcaption class="ltx_caption">Figure caption</figcaption>'))
    expect(blocks.map(b => b.id)).toEqual(['axt-b1', 'p1', 'axt-b3'])
  })

  it('a duplicate id gets a suffix', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="dup">A.</p><p class="ltx_p" id="dup">B.</p><p class="ltx_p" id="dup">C.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['dup', 'dup-2', 'dup-3'])
  })
})

describe('the DOM invariant', () => {
  const html =
    '<p class="ltx_p" id="p1">Text <a class="ltx_ref" href="#x">1</a>.</p>'
    + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

  it('extract does not modify the DOM', () => {
    const doc = docOf(html)
    const before = doc.documentElement.outerHTML
    extract(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('inside a picture nothing is a pairing container: the marks go from the picture outwards. A label\'s node is laid out by ar5iv — a flex box, the label at its foot — and marked, side\'s stack rule made it a block and the label dropped 23 px (measured on 2607.24653v2)', () => {
    const doc = docOf(`<section class="ltx_section"><figure class="ltx_figure"><span class="ltx_inline-block"><svg class="ltx_picture"><g><foreignObject>
      <span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">Shared Expert</span></span></foreignObject></g></svg></span></figure></section>`)
    markBlocks(extract(doc))
    expect(doc.querySelector('.ltx_foreignobject_content')!.hasAttribute('data-axt-id')).toBe(true)
    expect(doc.querySelectorAll('svg[data-axt-pairs], svg [data-axt-pairs]')).toHaveLength(0)
    // From the picture outwards the figure and the section hold a pair, as they would for a caption
    expect(Array.from(doc.querySelectorAll('[data-axt-pairs]'), el => el.className)).toEqual(['ltx_section', 'ltx_figure', 'ltx_inline-block'])
  })

  it('markBlocks appends data-axt-id only', () => {
    const doc = docOf(html)
    const before = doc.documentElement.outerHTML
    markBlocks(extract(doc))
    expect(doc.querySelector('#p1')?.getAttribute('data-axt-id')).toBe('p1')
    expect(doc.querySelector('#T')?.getAttribute('data-axt-id')).toBe('T')
    expect(doc.documentElement.outerHTML.replace(/ data-axt-id="[^"]*"/g, '')).toBe(before)
  })
})

describe('fixture', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  for (const f of files) {
    it(f, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const t0 = performance.now()
      const blocks = extract(doc)
      const ms = Math.round(performance.now() - t0)
      console.info(`[extract] ${f}: ${blocks.length} blocks, ${ms} ms`)
      expect(ms).toBeLessThan(5000)
      expect(blocks.length).toBeGreaterThan(0)

      const ids = blocks.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length)

      const tables = new Set(blocks.filter(b => b.kind === 'table').map(b => b.el))
      for (const b of blocks) {
        for (let el = b.el.parentElement; el; el = el.parentElement) {
          expect(classify(el)?.kind, `${b.id} sits inside a skip subtree`).not.toBe('skip')
          expect(tables.has(el), `${b.id} sits inside a table block`).toBe(false)
        }
      }

      expect({ ...statsOf(blocks), firstIds: ids.slice(0, 3), lastIds: ids.slice(-3) }).toMatchSnapshot()
    })
  }
})
