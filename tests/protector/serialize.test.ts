// Copied from Read arXiv tests/protector/serialize.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { describe, expect, it } from 'vitest'
import { VOID_DENSE_THRESHOLD, serialize } from '@/core/protector'
import { el } from './helpers'

describe('serialize', () => {
  it('a paragraph mixing void / paired / text', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph ltx_font_italic">bold</em> per <a class="ltx_ref" href="#S2">Section 2</a>.</p>')
    const b = serialize(p)
    expect(b.text).toBe('Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.')
    expect([...b.paired]).toEqual([2])
    expect(b.voidCount).toBe(2)
    expect(b.slots.get(1)).toBe(p.querySelector('math'))
    expect(b.slots.get(2)).toBe(p.querySelector('em'))
    expect(b.slots.get(3)).toBe(p.querySelector('a'))
  })

  it('paired can nest', () => {
    const p = el('<p class="ltx_p"><span class="ltx_text ltx_font_bold">A <span class="ltx_text ltx_font_italic">B</span> C</span></p>')
    expect(serialize(p).text).toBe('<t id="1">A <t id="2">B</t> C</t>')
  })

  it('& < > escaped, thin spaces and nbsp kept as they are', () => {
    const p = el('<p class="ltx_p">a &lt; b &amp; c <math class="ltx_Math"><mi>x</mi></math> d e &gt; f</p>')
    expect(serialize(p).text).toBe('a &lt; b &amp; c <x id="1"/> d e &gt; f')
  })

  it('nested units and footnote containers are voids, even inside a paired', () => {
    const p = el(
      '<p class="ltx_p">Text<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content">Note.</span></span></span>'
      + ' and <span class="ltx_inline-block"><span class="ltx_p">inner</span></span>.</p>',
    )
    const b = serialize(p)
    expect(b.text).toBe('Text<x id="1"/> and <t id="2"><x id="3"/></t>.')
    expect(b.voidCount).toBe(2)
    expect([...b.paired]).toEqual([2])
  })

  it('the invisible accessibility description in a figure caption is a void: not one word is sent for translation (§5.2, 2026-09-11)', () => {
    // The ACM template's \Description{}, display:none on the site. The translation node lacks that class,
    // and translated it would show a few hundred words under the caption (the owner's report on Table 5 of 2509.10652v3)
    const caption = el(
      '<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 5. </span>'
      + 'Role-specific differences in the use of vibe coding tools.'
      + '<span id="acmlabel6" class="ltx_nodisplay ltx_acm_description">A table describing role-specific differences. \\parUX or UI designers use AI for user interface generation.</span></figcaption>',
    )
    const b = serialize(caption)
    // “Table 5.” is a tag with the environment name, paired and translatable by the 0.6.2 decision; the description is a void
    expect(b.text).toBe('<t id="1">Table 5. </t>Role-specific differences in the use of vibe coding tools.<x id="2"/>')
    expect(b.text).not.toContain('\\par')
    expect(b.slots.get(2)).toBe(caption.querySelector('.ltx_nodisplay'))
  })

  it('an element without text is a void', () => {
    const p = el('<p class="ltx_p">a<span class="ltx_rule"></span>b<img class="ltx_graphics" alt="">c<br>d</p>')
    expect(serialize(p).text).toBe('a<x id="1"/>b<x id="2"/>c<x id="3"/>d')
  })

  it('cite, tag, monospace text and conversion errors are all voids', () => {
    const p = el('<p class="ltx_p"><cite class="ltx_cite">[1]</cite> <span class="ltx_tag">(a)</span> <span class="ltx_text ltx_font_typewriter">x</span> <span class="ltx_ERROR">\\foo</span></p>')
    expect(serialize(p).text).toBe('<x id="1"/> <x id="2"/> <x id="3"/> <x id="4"/>')
  })

  it('does not modify the DOM', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em>b</em>.</p>')
    const before = p.outerHTML
    serialize(p)
    expect(p.outerHTML).toBe(before)
  })

  it('the formula-density threshold', () => {
    expect(VOID_DENSE_THRESHOLD).toBe(40)
  })

  it('table cells are runs inside the block: the .ltx_p in a cell is entered as paired, not a void (measured on Table 1 of 2410.00260; Codex on #5)', () => {
    const td = el('<table><tbody><tr><td class="ltx_td"><span class="ltx_inline-block"><span class="ltx_p">Choices <math class="ltx_Math"><mi>x</mi></math></span></span></td></tr></tbody></table>').querySelector('.ltx_td')!
    const b = serialize(td)
    expect(b.text).toBe('<t id="1"><t id="2">Choices <x id="3"/></t></t>')
    expect([...b.paired]).toEqual([1, 2])
  })

  it('a nested table inside a cell is still a void (the inner cells are cells of their own), and an empty .ltx_p is a void too', () => {
    const td = el('<table><tbody><tr><td class="ltx_td">Outer<table class="ltx_tabular"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table><span class="ltx_p"></span></td></tr></tbody></table>').querySelector('td')!
    expect(serialize(td).text).toBe('Outer<x id="1"/><x id="2"/>')
  })

  it('translations / mirrors already in the original block are no source: skipped, taking no slot (Codex on #8)', () => {
    const li = el('<li class="ltx_item">Lead <p class="ltx_p">inner</p><p class="ltx_p axt-t">译文</p><span class="axt-t axt-mirror">mirror text</span></li>')
    const b = serialize(li)
    expect(b.text).toBe('Lead <x id="1"/>')
    expect(b.slots.size).toBe(1)
  })
})

describe('whitespace collapsing (#119)', () => {
  it('a hard line break collapses to one space — Microsoft takes every line break for a full stop', () => {
    // LaTeXML's HTML has hard line breaks; 2373 (62%) of the 3847 body blocks of the 12 fixtures have them.
    // Measured on one paragraph: with the breaks srcSentLen cut it into 5 sentences and state explosion became 「州级爆炸性质」;
    // collapsed, 2 sentences and 「状态爆炸」
    const block = serialize(el('<p class="ltx_p">Automatic verification faces state\nexplosion due to\nthe interleavings.</p>'))
    expect(block.text).toBe('Automatic verification faces state explosion due to the interleavings.')
  })

  it('tabs and runs of spaces collapse together', () => {
    expect(serialize(el('<p class="ltx_p">a \t\n  b</p>')).text).toBe('a b')
  })

  it('&nbsp; is never touched — in LaTeXML it is typesetting that forbids a break, and HTML does not collapse it either', () => {
    // JS's \s includes U+00A0; collapsing with \s turns `W.&nbsp;Arendt` into `W. Arendt` (everywhere in reference blocks)
    const block = serialize(el('<p class="ltx_p">W.\u00a0Arendt,\n  no.\u00a01, see Section\u00a01.1</p>'))
    expect(block.text).toBe('W.\u00a0Arendt, no.\u00a01, see Section\u00a01.1')
    expect(block.text).toContain('\u00a0')
  })

  it('leading and trailing whitespace kept, no trim — adjacent inline blocks are separated by it', () => {
    // `<span>A</span><span>B</span>` renders as AB; `<span>A </span>` is what gives A B.
    // Author names and contact labels are such adjacent inline blocks (§5.2), and trim would glue adjacent translations together
    expect(serialize(el('<p class="ltx_p"> a b </p>')).text).toBe(' a b ')
    // But leading and trailing **line breaks** still collapse to a space rather than staying as they are
    expect(serialize(el('<p class="ltx_p">\n  a b\n</p>')).text).toBe(' a b ')
  })

  it('collapsing does not touch the inside of a placeholder', () => {
    const block = serialize(el('<p class="ltx_p">see\n<math><mi>x</mi></math>\nand\n<math><mi>y</mi></math></p>'))
    // Not the id numbering (that is the allocator's business); pinned is that collapsing did not eat the space inside `<x id="N"/>`
    // and did not collapse away the word-boundary spaces on both sides of the formula
    expect(block.text).toMatch(/^see <x id="\d+"\/> and <x id="\d+"\/>$/)
    expect(block.slots.size).toBe(2)
  })
})
