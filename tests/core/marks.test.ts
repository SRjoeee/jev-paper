// Copied from Read arXiv tests/core/marks.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { describe, expect, it } from 'vitest'
import { IMG_CLASS, INJECTED_SELECTOR, T_CLASS, isInjected, stripAttributes, stripInjected } from '@/core/marks'
import { serialize } from '@/core/protector'

// Injection marks (DESIGN §7.1 / §15.2): the image overlay is the third kind of injected node, without axt-t, yet extraction, serialisation and clone cleanup all have to recognise it

describe('isInjected / stripInjected', () => {
  it('translations and image overlays both count as injected nodes, ordinary elements do not', () => {
    const doc = new DOMParser().parseFromString(`<div><p class="${T_CLASS}">译</p><div class="${IMG_CLASS}"><span>标签</span></div><p class="ltx_p">原文</p></div>`, 'text/html')
    const [t, img, p] = Array.from(doc.body.firstElementChild!.children)
    expect(isInjected(t!)).toBe(true)
    expect(isInjected(img!)).toBe(true)
    expect(isInjected(p!)).toBe(false)
    expect(doc.querySelectorAll(INJECTED_SELECTOR)).toHaveLength(2)
  })

  it('clone cleanup deletes overlays too: a mirror / translated table cloned whole must not carry somebody else\'s overlay in', () => {
    const doc = new DOMParser().parseFromString(`<div id="root"><img class="ltx_graphics" src="a.png" id="g"><div class="${IMG_CLASS}" data-axt-for="g"><span>标签</span></div><p class="${T_CLASS}">译</p></div>`, 'text/html')
    const root = doc.getElementById('root')!
    stripInjected(root)
    expect(root.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(root.querySelector(`.${T_CLASS}`)).toBeNull()
    expect(root.querySelector('img')).not.toBeNull()
    expect(root.querySelector('img')!.id).toBe('')
  })

  it('a clone carries no behaviour: event attributes and script-running URLs are both stripped (independent audit B17)', () => {
    // Measured in the audit: the rehydrated clone carried the original node's onclick, and clicking really ran it. The copy inside the translation is for reading,
    // not a second triggerable control. arXiv produces no event attributes today; this writes the invariant down
    const doc = new DOMParser().parseFromString(
      '<div id="root"><a href="#dest" onclick="window.__x=1" onmouseover="void 0">链接</a>'
      + '<a id="js" href="javascript:alert(1)">坏链接</a>'
      + '<img src="data:image/png;base64,iVBORw0KGgo=" alt="内联图">'
      + '<svg><animate onbegin="void 0"/></svg></div>', 'text/html')
    const root = doc.getElementById('root')!
    stripInjected(root)
    const link = root.querySelector('a')!
    expect(link.hasAttribute('onclick')).toBe(false)
    expect(link.hasAttribute('onmouseover')).toBe(false)
    // The link itself stays clickable and points where it did — what is lost is the behaviour attributes, not the content
    expect(link.getAttribute('href')).toBe('#dest')
    expect(root.querySelector('animate')!.hasAttribute('onbegin')).toBe(false)
    // javascript: removed; the data:image that really occurs in papers kept
    expect(root.querySelector('#js, a[href^="javascript"]')).toBeNull()
    expect(root.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/png/)
  })

  it('the attribute half alone, for a copy that keeps some of our nodes on purpose — the figure viewer\'s keeps the translation that showed: ids, marks, behaviour and script URLs go, every node stays (Devin on #279)', () => {
    const root = document.createElement('div')
    root.innerHTML = `<span id="L1" data-axt-id="L1" data-axt-state="translated" onclick="x()">Shared Expert</span><span class="${T_CLASS}" data-axt-for="L1"><a href="javascript:void(0)" data-keep="1">expert partage</a></span>`
    root.id = 'outer'
    stripAttributes(root)
    expect(root.querySelector(`.${T_CLASS}`)?.textContent).toBe('expert partage')
    expect(root.querySelectorAll('[id], [onclick], [href]')).toHaveLength(0)
    expect(root.hasAttribute('id')).toBe(false)
    expect(Array.from(root.querySelectorAll('*')).flatMap(el => el.getAttributeNames()).filter(name => name.startsWith('data-axt-'))).toEqual([])
    // What is neither ours nor a behaviour stays
    expect(root.querySelector('a')?.getAttribute('data-keep')).toBe('1')
  })

  it('a URL with control characters inside the scheme counts as script-running too (Codex on #163)', () => {
    // The HTML parser decodes `&#10;` to a real newline, and `getAttribute` gets `java\nscript:` (the first case below, measured),
    // while the browser, parsing the URL, deletes tabs and newlines anywhere and then strips C0 controls from the start, so the result is still a javascript: URL.
    // The others are written in with setAttribute directly: tested is stripInjected, not whether the parser decodes some character reference
    const doc = new DOMParser().parseFromString('<div id="root"><a href="java&#10;script:alert(1)">换行</a></div>', 'text/html')
    const root = doc.getElementById('root')!
    expect(root.querySelector('a')!.getAttribute('href')).toBe('java\nscript:alert(1)')
    const bad = ['java\tscript:alert(1)', '\u0001javascript:alert(1)', ' \u0000javascript:alert(1)', 'data:text/\nhtml,<script>1</script>']
    for (const href of bad) {
      const a = doc.createElement('a')
      a.setAttribute('href', href)
      root.append(a)
    }
    const ok = ['https://arxiv.org/abs/2509.10652', '#S1.p2', 'data:image/png;base64,iVBORw0KGgo=']
    for (const href of ok) {
      const a = doc.createElement('a')
      a.setAttribute('href', href)
      root.append(a)
    }
    const links = Array.from(root.querySelectorAll('a'))
    stripInjected(root)
    // The first 1 + bad.length all have their href stripped, and not one normal link after them may be hit by mistake
    expect(links.slice(0, 1 + bad.length).map(a => a.hasAttribute('href'))).toEqual(Array(1 + bad.length).fill(false))
    expect(links.slice(1 + bad.length).map(a => a.getAttribute('href'))).toEqual(ok)
  })

  it('serialisation skips the overlay: with translated labels laid over an image inside a block, retranslating the block must not put the label text into the prompt', () => {
    // The overlay is really a div, a span here: HTML parsing would let a <div> cut the <p> short; tested is skipping by class, not by tag
    const doc = new DOMParser().parseFromString(`<p class="ltx_p">See <img class="ltx_graphics" src="a.png"><span class="${IMG_CLASS}"><span>静态电荷</span></span> here.</p>`, 'text/html')
    const block = serialize(doc.querySelector('p')!)
    expect(block.text).not.toContain('静态电荷')
    expect(block.text).toMatch(/See <x id="\d+"\/> here\./)
  })
})
