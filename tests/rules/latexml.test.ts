// Copied from Read arXiv tests/rules/latexml.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import {
  PROTECT_RULES, RULES_VERSION, SKIP_RULES, TABLE_RULES, UNIT_RULES,
  classify, documentRoot, isNamedTag, isNumericCell, visibleText,
} from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/** Parse a minimal snippet hand-written after a fixture's real structure; returns the target element (the body's first child by default) */
function el(html: string, selector?: string): Element {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  const target = selector ? doc.querySelector(selector) : doc.body.firstElementChild
  if (!target) throw new Error(`${selector ?? 'the first element'} not found in the snippet`)
  return target
}

describe('the rule table\'s integrity', () => {
  const all = [...UNIT_RULES, ...SKIP_RULES, ...PROTECT_RULES]

  it('ids are unique across tables', () => {
    const ids = all.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every selector is accepted by matches', () => {
    const probe = document.createElement('div')
    for (const r of all) expect(() => probe.matches(r.selector), r.id).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.root)).not.toThrow()
    expect(() => probe.matches(TABLE_RULES.cell)).not.toThrow()
  })

  it('the version number was bumped for this change of rules', () => {
    expect(RULES_VERSION).toBe('0.11.0')
  })
})

describe('classify: rule by rule', () => {
  type Expected = { kind: string; rule: string; descend: boolean } | null
  const cases: [string, string, string | undefined, Expected][] = [
    ['body paragraph', '<div class="ltx_para"><p class="ltx_p">Text.</p></div>', 'p', { kind: 'unit', rule: 'p', descend: true }],
    ['heading (with section number)', '<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Intro</h2>', 'h2', { kind: 'unit', rule: 'title', descend: true }],
    ['subtitle', '<div class="ltx_subtitle">(Extended)</div>', undefined, { kind: 'unit', rule: 'title', descend: true }],
    ['caption', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table"><span class="ltx_text">Table 1</span>: </span>Results.</figcaption>', undefined, { kind: 'unit', rule: 'caption', descend: true }],
    ['footnote body', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note.</span></span></span>', '.ltx_note_content', { kind: 'unit', rule: 'footnote', descend: true }],
    // A segmented entry: the container itself is no block; each .ltx_bibblock is the unit (§5.4)
    ['reference entry (segmented)', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span><span class="ltx_bibblock">A. Title.</span></li>', 'li', null],
    ['reference segment', '<li class="ltx_bibitem"><span class="ltx_bibblock">A. Title.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    // The first segment of a multi-segment entry is the author list, judged by position (only some templates have .ltx_bib_author)
    ['the author segment of a reference (translated too since 2026-09-06, §5.4)', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al.</span><span class="ltx_bibblock">Title.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    ['a single-segment entry is not taken for an author segment', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span><span class="ltx_bibblock">B. P. Abbott et al. Title. 2024.</span></li>', '.ltx_bibblock', { kind: 'unit', rule: 'bibblock', descend: true }],
    ['an unsegmented reference entry', '<li class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span>A. Title, 2024.</li>', 'li', { kind: 'unit', rule: 'bibitem', descend: true }],
    ['acknowledgements', '<div class="ltx_acknowledgements">Thanks.</div>', undefined, { kind: 'unit', rule: 'ack', descend: true }],
    // The run-in heading of acknowledgements / keywords is translated with its block, not as a block of its own (or the enclosing block would clone an English heading)
    ['the run-in heading of acknowledgements', '<div class="ltx_acknowledgements"><h6 class="ltx_title ltx_title_acknowledgements">Acknowledgements.</h6>Text.</div>', 'h6', null],
    ['the run-in heading of keywords', '<div class="ltx_keywords"><h6 class="ltx_title ltx_title_keywords">Keywords.</h6>a, b</div>', 'h6', null],
    ['keywords', '<div class="ltx_keywords">data races</div>', undefined, { kind: 'unit', rule: 'keywords', descend: true }],
    ['table root', '<table class="ltx_tabular"><tbody><tr><th class="ltx_td ltx_th">h</th><td class="ltx_td">1</td></tr></tbody></table>', undefined, { kind: 'table', rule: 'table', descend: false }],
    ['display formula', '<table class="ltx_equation"><tbody><tr><td class="ltx_td ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr></tbody></table>', undefined, { kind: 'skip', rule: 'equation', descend: false }],
    ['code line', '<div class="ltx_listing"><div class="ltx_listingline"><span class="ltx_text ltx_font_typewriter">x = 1</span></div></div>', '.ltx_listingline', { kind: 'skip', rule: 'listing', descend: false }],
    ['author names are translated too (§5.2, 2026-09-06)', '<div class="ltx_authors"><span class="ltx_creator"><span class="ltx_personname">A. B.</span></span></div>', '.ltx_personname', { kind: 'unit', rule: 'personname', descend: true }],
    ['the conjunction between names is still skipped: as a block of its own it would break the name list', '<div class="ltx_authors"><span class="ltx_author_before"> and </span></div>', '.ltx_author_before', { kind: 'skip', rule: 'author-glue', descend: false }],
    ['the contact label is a void: template-generated and display:none on the site (§5.2)', '<div class="ltx_authors"><span class="ltx_contact ltx_role_email"><span class="ltx_contact_name">Email: </span></span></div>', '.ltx_contact_name', { kind: 'protect', rule: 'contact-label', descend: false }],
    ['an author\'s affiliation and contact', '<span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation: </span>Radboud University</span>', '.ltx_contact', { kind: 'unit', rule: 'authorinfo', descend: true }],
    // The ACM template's \Description{}: display:none on the site; the translation node lacks that class, and translated it would show
    ['the invisible accessibility description is a void (§5.2, 2026-09-11)', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 5. </span>Caption.<span class="ltx_nodisplay ltx_acm_description">A table describing roles. \\parUX designers use AI.</span></figcaption>', '.ltx_nodisplay', { kind: 'protect', rule: 'nodisplay', descend: false }],
    ['email address', '<span class="ltx_contact ltx_role_email"><a href="mailto:a@b.c">a@b.c</a></span>', 'a', { kind: 'protect', rule: 'mailto', descend: false }],
    ['the conjunction between authors', '<span class="ltx_author_before"> and </span>', undefined, { kind: 'skip', rule: 'author-glue', descend: false }],
    ['dates', '<div class="ltx_dates">2018</div>', undefined, { kind: 'unit', rule: 'authorinfo', descend: true }],
    ['classification', '<div class="ltx_classification">Primary: 11L07</div>', undefined, { kind: 'skip', rule: 'classification', descend: false }],
    ['publication metadata', '<span class="ltx_pubnotes ltx_pubnotes_meta"><span class="ltx_pubnote ltx_role_doi">DOI</span></span>', undefined, { kind: 'skip', rule: 'pubnotes', descend: false }],
    // A container since 2026-09-21 (§15.6): a void to an outer unit, entered for its labels, which are units
    ['TikZ picture', '<svg class="ltx_picture"><foreignObject><span class="ltx_foreignobject_content">t</span></foreignObject></svg>', undefined, { kind: 'protect', rule: 'picture', descend: true }],
    ['the label of a TikZ node', '<svg class="ltx_picture"><foreignObject><span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">Shared Expert</span></span></foreignObject></svg>', '.ltx_foreignobject_content', { kind: 'unit', rule: 'picturelabel', descend: true }],
    ['conversion error', '<p class="ltx_p"><span class="ltx_ERROR undefined">\\foo</span></p>', '.ltx_ERROR', { kind: 'skip', rule: 'error', descend: false }],
    ['navigation bar', '<nav class="ltx_page_navbar"><nav class="ltx_TOC">toc</nav></nav>', undefined, { kind: 'skip', rule: 'nav', descend: false }],
    ['inline formula', '<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math></p>', 'math', { kind: 'protect', rule: 'math', descend: false }],
    ['cross-reference', '<p class="ltx_p"><a class="ltx_ref"><span class="ltx_text ltx_ref_tag">2</span></a></p>', 'a', { kind: 'protect', rule: 'ref', descend: false }],
    ['citation', '<p class="ltx_p"><cite class="ltx_cite ltx_citemacro_cite">[3]</cite></p>', 'cite', { kind: 'protect', rule: 'cite', descend: false }],
    ['number tag', '<span class="ltx_tag ltx_tag_item">•</span>', undefined, { kind: 'protect', rule: 'tag', descend: false }],
    ['monospace text', '<span class="ltx_text ltx_font_typewriter">foo</span>', undefined, { kind: 'protect', rule: 'tt', descend: false }],
    // `\lstinline` carries no typewriter class: the listing class on a `ltx:text` is what says code (0.10.2)
    ['an inline listing', '<p class="ltx_p"><span class="ltx_text ltx_lst_language_Python ltx_lstlisting"><span class="ltx_text ltx_lst_identifier">y</span><span class="ltx_text ltx_lst_space"> </span>==<span class="ltx_text ltx_lst_space"> </span>40</span></p>', '.ltx_lstlisting', { kind: 'protect', rule: 'lstinline', descend: false }],
    ['an inline listing of one identifier', '<p class="ltx_p"><span class="ltx_text ltx_lst_identifier ltx_lst_language_Python ltx_lstlisting">x</span></p>', '.ltx_lstlisting', { kind: 'protect', rule: 'lstinline', descend: false }],
    ['a block listing is skipped as before, by its own rule', '<div class="ltx_listing ltx_lst_language_C ltx_lstlisting ltx_listing"><div class="ltx_listingline">int x;</div></div>', undefined, { kind: 'skip', rule: 'listing', descend: false }],
    ['footnote container: protect-but-descend', '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup></span>', undefined, { kind: 'protect', rule: 'note', descend: true }],
    ['footnote mark', '<sup class="ltx_note_mark">1</sup>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['footnote type', '<span class="ltx_note_type">footnotemark: </span>', undefined, { kind: 'protect', rule: 'note-mark', descend: false }],
    ['image', '<img class="ltx_graphics" alt="">', undefined, { kind: 'protect', rule: 'img', descend: false }],
    ['line break', '<br class="ltx_break">', undefined, { kind: 'protect', rule: 'br', descend: false }],
  ]
  for (const [name, html, selector, expected] of cases) {
    it(name, () => {
      expect(classify(el(html, selector))).toEqual(expected)
    })
  }

  it('the listing class on anything but a `ltx:text` is not the inline rule\'s: a float keeps its caption open', () => {
    // `figure.ltx_float.ltx_lstlisting` wraps a block listing **and its caption**; protected whole, the caption would never be translated
    expect(classify(el('<figure class="ltx_float ltx_lstlisting"><figcaption class="ltx_caption">Listing 1: a loop</figcaption></figure>'))).toBeNull()
    expect(classify(el('<figure class="ltx_figure ltx_figure_panel ltx_lstlisting ltx_align_center"></figure>'))).toBeNull()
  })

  it('ordinary containers and style spans match nothing', () => {
    expect(classify(el('<div class="ltx_para"><p class="ltx_p">x</p></div>'))).toBeNull()
    expect(classify(el('<span class="ltx_text ltx_font_italic">x</span>'))).toBeNull()
    expect(classify(el('<section class="ltx_section"></section>'))).toBeNull()
  })
})

describe('a tag with an environment name is translated, a bare number is not (§5.2, the owner\'s report that Definition 1.1 was not translated)', () => {
    // LaTeXML puts the names of theorem environments, figures, algorithms and appendices into .ltx_tag too: protected whole as a number,
    // the Chinese reader still sees “Definition 1.1.”. Based on the measured distribution of the 1241 tags in the 12 fixtures
    const tagOf = (html: string) => classify(el(html, '.ltx_tag'))
    const named: [string, string][] = [
      ['theorem', '<h6 class="ltx_title ltx_title_theorem"><span class="ltx_tag ltx_tag_theorem">Definition 1.1</span>.</h6>'],
      ['figure', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1.</span> Cap.</figcaption>'],
      ['table', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1:</span> Cap.</figcaption>'],
      ['algorithm', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_float">Algorithm 1</span> Cap.</figcaption>'],
      ['appendix', '<h2 class="ltx_title ltx_title_appendix"><span class="ltx_tag ltx_tag_appendix">Appendix A</span> More</h2>'],
      ['part', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_part">Part 1</span> X</h1>'],
      ['chapter', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_chapter">Chapter 1</span> X</h1>'],
    ]
    for (const [name, html] of named) {
      it(`the ${name} tag is no longer a void: it holds an environment name`, () => {
        expect(tagOf(html)).toBeNull()
      })
    }

    // Roman-numbered ones stay voids: measured, machine translation renders IV as 「四」, which no longer matches the protected .ltx_ref
    const roman: [string, string][] = [
      ['a Roman-numbered table', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table IV:</span> Cap.</figcaption>'],
      ['a Roman-numbered part', '<h1 class="ltx_title"><span class="ltx_tag ltx_tag_part">Part I</span> X</h1>'],
    ]
    for (const [name, html] of roman) {
      it(`${name} is still a void`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    const numbered: [string, string][] = [
      ['section number', '<h2 class="ltx_title"><span class="ltx_tag ltx_tag_section">II</span> Intro</h2>'],
      ['subsection number', '<h3 class="ltx_title"><span class="ltx_tag ltx_tag_subsection">II.1</span> Sub</h3>'],
      ['equation number', '<td class="ltx_eqn_cell"><span class="ltx_tag ltx_tag_equation">(1.1)</span></td>'],
      ['list bullet', '<li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">x</p></div></li>'],
      ['footnote mark', '<span class="ltx_note"><span class="ltx_tag ltx_tag_note">1</span></span>'],
      ['a tag with no subtype', '<li class="ltx_bibitem"><span class="ltx_tag">[1]</span></li>'],
    ]
    for (const [name, html] of numbered) {
      it(`${name} is still a void: translating a bare number only does harm`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    // The class name alone is not enough: a subfigure panel's label is .ltx_tag_figure too, its content a bare identifier (Codex on #53)
    const panels: [string, string][] = [
      ['subfigure panel (a)', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">(a)</span></figcaption>'],
      ['subfigure panel (b)', '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">(b)</span></figcaption>'],
      ['a bare-number theorem tag', '<h6 class="ltx_title"><span class="ltx_tag ltx_tag_theorem">1.1</span></h6>'],
    ]
    for (const [name, html] of panels) {
      it(`${name} is still a void: translated, the correspondence with the panel breaks`, () => {
        expect(tagOf(html)).toMatchObject({ kind: 'protect', rule: 'tag' })
      })
    }

    it('an identifier inside parentheses as a whole is no word: a panel label may be a multi-letter Roman numeral (Codex on #53)', () => {
      for (const label of ['(a)', '(ii)', '(iii)', '(iv)', '（乙）', '(A.1)']) {
        expect([label, isNamedTag(el(`<span class="ltx_tag ltx_tag_figure">${label}</span>`))]).toEqual([label, false])
      }
      // An environment name never comes in parentheses: with the parentheses removed, whatever still has a word is translated as usual
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_theorem">Definition 1.2 (Hall set)</span>'))).toBe(true)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">Figure 3 (a)</span>'))).toBe(true)
    })

    it('a Roman-numbered tag is not translated: machine translation localises it, and it no longer matches the protected .ltx_ref', () => {
      // Measured with google-gtx on 2026-09-05: Table IV: → 表四：, Table X: → 表十：, Part I → 第一部分
      for (const text of ['Table I:', 'Table IV:', 'Table X:', 'Table XIII:', 'Part I', 'Appendix V', 'Table IV.1:', 'Theorem IV-A', 'Lemma II.3.', 'Table iv:', 'Theorem ii.3', 'Part i', 'Table IV :', 'Theorem II .', '(Table IV)']) {
        expect([text, isNamedTag(el(`<span class="ltx_tag ltx_tag_table">${text}</span>`))]).toEqual([text, false])
      }
      // Arabic numerals and letter numbering are measured to stay as they are, and are translated as usual
      for (const text of ['Table 4:', 'Appendix A', 'Appendix C', 'Appendix D', 'Definition 1.1.', 'Corollary A.3.', 'Appendix A.1', 'Lemma D.2', '(Figure 1)', '(Theorem 2)', 'Definition 1 (Hall set)']) {
        expect([text, isNamedTag(el(`<span class="ltx_tag ltx_tag_table">${text}</span>`))]).toEqual([text, true])
      }
    })

    it('the check needs two consecutive letters: a single-letter identifier is no word', () => {
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">Figure 1.</span>'))).toBe(true)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">(a)</span>'))).toBe(false)
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_figure">(1)</span>'))).toBe(false)
      // A class name not on the list is not translated even with a word in it
      expect(isNamedTag(el('<span class="ltx_tag ltx_tag_section">Appendix</span>'))).toBe(false)
    })
  })

describe('classify: precedence skip > table > unit > protect', () => {
  it('skip beats unit', () => {
    expect(classify(el('<p class="ltx_p ltx_ERROR">x</p>'))?.kind).toBe('skip')
  })
  it('table beats unit', () => {
    expect(classify(el('<table class="ltx_tabular ltx_p"></table>'))?.kind).toBe('table')
  })
  it('unit beats protect', () => {
    expect(classify(el('<span class="ltx_p ltx_ref">x</span>'))?.kind).toBe('unit')
  })
  it('skip beats protect', () => {
    expect(classify(el('<span class="ltx_ERROR ltx_ref">x</span>'))?.kind).toBe('skip')
  })
})

describe('visibleText', () => {
  const para = () => el(
    '<p class="ltx_p">Let <math class="ltx_Math" alttext="\\alpha"><semantics><mi>α</mi>'
    + '<annotation encoding="application/x-tex">\\alpha</annotation></semantics></math> be a graph; see '
    + '<a class="ltx_ref"><span class="ltx_text ltx_ref_tag">Section 2</span></a>.'
    + '<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer">'
    + '<span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Footnote body.</span></span></span> Done.</p>',
  )

  it('cuts protect / skip subtrees, the descend footnote container included', () => {
    const t = visibleText(para())
    expect(t).toContain('Let ')
    expect(t).toContain(' be a graph; see ')
    expect(t).toContain(' Done.')
    expect(t).not.toContain('α')
    expect(t).not.toContain('alpha')
    expect(t).not.toContain('Section 2')
    expect(t).not.toContain('Footnote body')
  })

  it('keeps the thin spaces on both sides of a formula and does not trim inner whitespace', () => {
    expect(visibleText(el('<p class="ltx_p">a\u2009<math class="ltx_Math"><mi>x</mi></math>\u2009b</p>'))).toBe('a\u2009\u2009b')
  })

})

describe('isNumericCell (the calibration boundary cases of Phase 0)', () => {
  const numeric = ['7.7 GeV', '±0.3', '12,345', '1e-5', '3 × 10^4', '0.92 ± 0.01', '(3)', '✓', '—', 'N/A', '']
  const prose = ['ERROR', 'Esp', 'TRUE', 'Total', '(kpc)', 'Au+Au', 'Disk crossing', 'e']
  for (const t of numeric) it(`numeric cell: ${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(true))
  for (const t of prose) it(`prose cell: ${JSON.stringify(t)}`, () => expect(isNumericCell(t)).toBe(false))
})

describe('fixture invariants', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  /** The synthetic-structures fixture: covers template structures no real paper showed (DESIGN §5.7) */
  const SYNTHETIC = 'synthetic-structures.html'

  it('there are 12 real papers + 1 synthetic structure', () => {
    expect(files.filter(f => f !== SYNTHETIC)).toHaveLength(12)
    expect(files).toContain(SYNTHETIC)
  })

  for (const f of files) {
    it(`${f}: the translation root exists, unit rules are mutually exclusive, classify does not throw`, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const root = documentRoot(doc)
      expect(root).not.toBeNull()
      let multi = 0
      for (const e of Array.from(root!.querySelectorAll('*'))) {
        classify(e)
        if (UNIT_RULES.filter(r => e.matches(r.selector)).length > 1) multi++
      }
      expect(multi).toBe(0)
    })
  }

  it('returns null without a translation root', () => {
    expect(documentRoot(new DOMParser().parseFromString('<html><body></body></html>', 'text/html'))).toBeNull()
  })

  it('returns the element itself when it is the translation root (Codex on #2 / #3: querySelector searches descendants only)', () => {
    const doc = new DOMParser().parseFromString('<html><body><article class="ltx_document"><p class="ltx_p">x</p></article></body></html>', 'text/html')
    const article = doc.querySelector('article')!
    expect(documentRoot(article)).toBe(article)
    expect(documentRoot(doc.querySelector('p')!)).toBeNull()
  })
})

describe('the terms of a description list (Codex on #18)', () => {
  const doc = (html: string) => new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${html}</article></body></html>`, 'text/html')
  const item = (tagText: string) =>
    `<dl class="ltx_description"><dt class="ltx_item"><span class="ltx_tag ltx_tag_item">${tagText}</span></dt></dl>`

  it('a term with a word is translated: unrelaxed, the whole .ltx_item has no own text and is no block at all', () => {
    const d = doc(item('Compactness.'))
    const blocks = extract(d)
    expect(blocks.map(b => b.unit)).toEqual(['item'])
    expect(classify(d.querySelector('.ltx_tag_item')!)).toBeNull()
  })

  it('a bare mark is still a void: bullets and numbers must not be translated', () => {
    for (const marker of ['•', '(1)', '2.', '(ii)']) {
      const d = doc(item(marker))
      expect([marker, extract(d).length]).toEqual([marker, 0])
      expect([marker, classify(d.querySelector('.ltx_tag_item')!)?.rule]).toEqual([marker, 'tag'])
    }
  })
})

describe('every segment of a reference entry is translated, the author segment no exception (§5.4, 2026-09-06)', () => {
  const entry = (inner: string) => new DOMParser()
    .parseFromString(`<!doctype html><html><body><article class="ltx_document"><ul class="ltx_biblist"><li class="ltx_bibitem">${inner}</li></ul></article></body></html>`, 'text/html')

  it('an author segment marked .ltx_bib_author is a translation unit', () => {
    const d = entry('<span class="ltx_bibblock"><span class="ltx_bib_author">Doe, J.</span></span><span class="ltx_bibblock">A Title.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('the first segment recognised by position alone, without the mark, is a translation unit too', () => {
    const d = entry('<span class="ltx_bibblock">Doe, J., and Roe, R.</span><span class="ltx_bibblock">A Title.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('the citation year is kept as a void and does not enter the translation text (Codex on #74)', () => {
    const d = entry('<span class="ltx_bibblock"><span class="ltx_bib_author">Doe, J.</span><span class="ltx_text ltx_bib_year"> (2024)</span></span>')
    const year = d.querySelector('.ltx_bib_year')!
    expect(classify(year)).toEqual({ kind: 'protect', rule: 'bib-year', descend: false })
    // The segment is still a translation unit: the author names are translated, the year inside is a placeholder
    expect(classify(d.querySelector('.ltx_bibblock')!)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('the template with the whole citation in the first segment and the doi in the second: both translated (measured on 2609.03896, the owner\'s report)', () => {
    // The old position-based rule failed worst here: it skipped the first segment as the author list,
    // so not a word of the reference was translated, and on the page only the doi line turned into Chinese punctuation
    const d = entry('<span class="ltx_bibblock">T. M. Apostol, <em class="ltx_emph">Introduction to Analytic Number Theory</em>, Undergraduate Texts in Mathematics, Springer, New York, 1976.</span>'
      + '<span class="ltx_bibblock">doi: <a class="ltx_ref ltx_href" href="https://doi.org/10.1007/978-1-4757-5579-4">10.1007/978-1-4757-5579-4</a>.</span>')
    for (const el of d.querySelectorAll('.ltx_bibblock')) expect(classify(el)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })

  it('a single-segment entry is still one unit whole, the behaviour unchanged', () => {
    const d = entry('<span class="ltx_bibblock">Doe, J. A Title. Journal, 2020.</span>')
    expect(classify(d.querySelector('.ltx_bibblock')!)).toEqual({ kind: 'unit', rule: 'bibblock', descend: true })
  })
})
