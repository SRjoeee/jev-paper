import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BandLayer } from '@/content/bands/layer'

/** happy-dom does not lay out, so a mark's ranges are stand-ins that report fixed rectangles */
const fakeRange = (el: Element, rects: [number, number, number, number][]) =>
  ({ commonAncestorContainer: el, getClientRects: () => rects.map(([top, bottom, left, right]) => ({ top, bottom, left, right, width: right - left, height: bottom - top })) }) as unknown as Range

/** happy-dom has no FontFaceSet; a stub with the two members the layer touches */
class FontsStub extends EventTarget {
  ready: Promise<void> = Promise.resolve()
}

/** happy-dom's matchMedia never actually reflects the OS scheme; a stub the test dispatches 'change' on directly */
class MediaStub extends EventTarget {
  matches = false
}

const tick = () => new Promise(r => setTimeout(r, 0))

describe('BandLayer', () => {
  // A layer an assertion never reached destroy() for (a failed `expect` mid-test) must not keep observing and
  // scheduling into later tests — destroy() is idempotent, so destroying it again in a passing test is harmless
  let active: BandLayer[] = []
  const makeLayer = () => {
    const layer = new BandLayer(document)
    active.push(layer)
    return layer
  }

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.backgroundColor = ''
    document.body.innerHTML = '<p class="ltx_p" id="p">Text.</p>'
    document.body.style.backgroundColor = ''
  })

  afterEach(() => {
    for (const layer of active) layer.destroy()
    active = []
  })

  it('paints one <i> per band behind the page, evidence above claims', () => {
    const layer = makeLayer()
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
    const layer = makeLayer()
    const p = document.getElementById('p')!
    layer.paint([{ tone: 'caveat', ranges: [fakeRange(p, [[100, 116, 10, 60]])] }])
    layer.setHot(0)
    expect(document.querySelector('.jevpaper-bands > i.hot')).not.toBeNull()
    layer.setHot(null)
    expect(document.querySelector('.jevpaper-bands > i.hot')).toBeNull()
    layer.destroy()
  })

  it('a data-theme change repaints with the dark palette', async () => {
    const layer = makeLayer()
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

  it('a class toggled on a paper element under <body> schedules one relayout', async () => {
    const layer = makeLayer()
    const p = document.getElementById('p')!
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    p.classList.add('ltx_active')
    await tick()
    expect(raf).toHaveBeenCalledTimes(1)
    layer.destroy()
    raf.mockRestore()
  })

  it('paint() and setHot() do not schedule a further relayout', async () => {
    const layer = makeLayer()
    const p = document.getElementById('p')!
    layer.paint([{ tone: 'caveat', ranges: [fakeRange(p, [[100, 116, 10, 60]])] }])
    layer.setHot(0)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    layer.paint([{ tone: 'claim', ranges: [fakeRange(p, [[200, 216, 10, 60]])] }])
    layer.setHot(null)
    await tick()
    expect(raf).not.toHaveBeenCalled()
    layer.destroy()
    raf.mockRestore()
  })

  it('a loadingdone font event schedules a relayout, but not after destroy', async () => {
    const fonts = new FontsStub()
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
    const layer = makeLayer()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    fonts.dispatchEvent(new Event('loadingdone'))
    await tick()
    expect(raf).toHaveBeenCalledTimes(1)
    raf.mockClear()
    layer.destroy()
    fonts.dispatchEvent(new Event('loadingdone'))
    await tick()
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('after destroy(), a pending fonts.ready resolving schedules nothing', async () => {
    let resolveReady!: () => void
    const fonts = new FontsStub()
    fonts.ready = new Promise<void>(r => {
      resolveReady = r
    })
    Object.defineProperty(document, 'fonts', { value: fonts, configurable: true })
    const layer = makeLayer()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    layer.destroy()
    resolveReady()
    await tick()
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
    Reflect.deleteProperty(document, 'fonts')
  })

  it('a prefers-color-scheme change that flips the page background updates theme and calls onTheme', async () => {
    const media = new MediaStub()
    const original = window.matchMedia.bind(window)
    window.matchMedia = ((q: string) => (q === '(prefers-color-scheme: dark)' ? (media as unknown as MediaQueryList) : original(q))) as typeof window.matchMedia
    const layer = makeLayer()
    const seen: string[] = []
    layer.onTheme = t => seen.push(t)
    expect(layer.theme).toBe('light')
    document.body.style.backgroundColor = 'rgb(10, 10, 10)'
    media.dispatchEvent(new Event('change'))
    await tick()
    expect(layer.theme).toBe('dark')
    expect(seen).toEqual(['dark'])
    layer.destroy()
    window.matchMedia = original
  })
})
