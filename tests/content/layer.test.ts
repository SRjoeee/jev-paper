import { beforeEach, describe, expect, it } from 'vitest'
import { BandLayer } from '@/content/bands/layer'

/** happy-dom does not lay out, so a mark's ranges are stand-ins that report fixed rectangles */
const fakeRange = (el: Element, rects: [number, number, number, number][]) =>
  ({ commonAncestorContainer: el, getClientRects: () => rects.map(([top, bottom, left, right]) => ({ top, bottom, left, right, width: right - left, height: bottom - top })) }) as unknown as Range

describe('BandLayer', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.body.innerHTML = '<p class="ltx_p" id="p">Text.</p>'
  })

  it('paints one <i> per band behind the page, evidence above claims', () => {
    const layer = new BandLayer(document)
    const p = document.getElementById('p')!
    layer.paint([
      { tone: 'evidence', ranges: [fakeRange(p, [[100, 116, 10, 60]])] },
      { tone: 'claim', ranges: [fakeRange(p, [[200, 216, 10, 60], [224, 240, 10, 40]])] },
    ])
    const host = document.querySelector('.jevpaper-bands')!
    expect(host.getAttribute('aria-hidden')).toBe('true')
    expect([...host.children].map(el => (el as HTMLElement).dataset.tone)).toEqual(['claim', 'claim', 'evidence'])
    expect(layer.bandsOf(1)).toHaveLength(2)
    layer.destroy()
    expect(document.querySelector('.jevpaper-bands')).toBeNull()
  })

  it('marks the hovered mark and clears it', () => {
    const layer = new BandLayer(document)
    const p = document.getElementById('p')!
    layer.paint([{ tone: 'caveat', ranges: [fakeRange(p, [[100, 116, 10, 60]])] }])
    layer.setHot(0)
    expect(document.querySelector('.jevpaper-bands > i.hot')).not.toBeNull()
    layer.setHot(null)
    expect(document.querySelector('.jevpaper-bands > i.hot')).toBeNull()
    layer.destroy()
  })

  it('a data-theme change repaints with the dark palette', async () => {
    const layer = new BandLayer(document)
    const seen: string[] = []
    layer.onTheme = t => seen.push(t)
    expect(layer.theme).toBe('light')
    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise(r => setTimeout(r, 0))
    expect(layer.theme).toBe('dark')
    expect((document.querySelector('.jevpaper-bands') as HTMLElement).dataset.theme).toBe('dark')
    expect(seen).toEqual(['dark'])
    layer.destroy()
  })
})
