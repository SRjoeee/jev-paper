// The band layer (spec §5.3): one container on <body>, behind the page (z-index -1), never inside the article.
// Every layout reads all geometry first, then writes the bands in one replaceChildren.
import type { Tone } from '@/shared/levels'
import { clipOf } from './clip'
import { type Band, type Box, layoutBands, linesOf } from './geometry'
import { bandCss, type Theme } from './palette'
import { themeOf } from './theme'

export interface PaintMark {
  tone: Tone
  ranges: Range[]
}

/** Paint order: later tones cover earlier ones where two marks share a sentence */
const ORDER: Record<Tone, number> = { claim: 0, caveat: 1, candidate: 2, evidence: 3 }
const BLOCK = '.ltx_p, figcaption, .ltx_caption, .ltx_note_content, li, td'

export class BandLayer {
  onTheme?: (theme: Theme) => void
  private host: HTMLDivElement
  private style: HTMLStyleElement
  private marks: PaintMark[] = []
  private bands: Band[] = []
  private els = new Map<number, HTMLElement[]>()
  private hot: number | null = null
  private frame = 0
  private cleanup: (() => void)[] = []

  constructor(private doc: Document) {
    const view = doc.defaultView!
    this.style = doc.createElement('style')
    this.style.dataset.jevpaper = 'bands'
    this.style.textContent = bandCss()
    doc.head.append(this.style)
    this.host = doc.createElement('div')
    this.host.className = 'jevpaper-bands'
    this.host.setAttribute('aria-hidden', 'true')
    this.host.dataset.theme = themeOf(doc)
    doc.body.append(this.host)

    const schedule = () => this.schedule()
    view.addEventListener('resize', schedule)
    this.cleanup.push(() => view.removeEventListener('resize', schedule))
    if (typeof view.ResizeObserver === 'function') {
      const sizes = new view.ResizeObserver(schedule)
      sizes.observe(doc.body)
      this.cleanup.push(() => sizes.disconnect())
    }
    void doc.fonts?.ready.then(schedule)
    // arXiv's theme switch, reading mode and table-of-contents toggles are attributes on <html>
    const attributes = new view.MutationObserver(() => {
      const theme = themeOf(doc)
      if (theme !== this.host.dataset.theme) {
        this.host.dataset.theme = theme
        this.onTheme?.(theme)
      }
      schedule()
    })
    attributes.observe(doc.documentElement, { attributes: true })
    this.cleanup.push(() => attributes.disconnect())
  }

  get theme(): Theme {
    return this.host.dataset.theme as Theme
  }

  paint(marks: PaintMark[]): void {
    this.marks = marks
    this.layout()
  }

  bandsOf(index: number): Band[] {
    return this.bands.filter(b => b.mark === index)
  }

  setHot(index: number | null): void {
    if (this.hot !== null) for (const el of this.els.get(this.hot) ?? []) el.classList.remove('hot')
    this.hot = index
    if (index !== null) for (const el of this.els.get(index) ?? []) el.classList.add('hot')
  }

  /** One-shot feedback after a jump: a keyframe sequence that runs once (opacity only under reduced motion) */
  pulse(index: number): void {
    const reduce = this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frames: Keyframe[] = reduce
      ? [{ opacity: 0.55 }, { opacity: 0.55, offset: 0.25 }, { opacity: 1 }]
      : [{ filter: 'saturate(2.4) brightness(0.9)' }, { filter: 'saturate(2.4) brightness(0.9)', offset: 0.25 }, { filter: 'none' }]
    for (const el of this.els.get(index) ?? []) el.animate?.(frames, { duration: 1500, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' })
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    for (const undo of this.cleanup) undo()
    this.host.remove()
    this.style.remove()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.layout()
    })
  }

  private layout(): void {
    const view = this.doc.defaultView!
    // ---- read ----
    const origin = this.host.getBoundingClientRect()
    const clips = new Map<Element, ReturnType<typeof clipOf>>()
    const heights = new Map<Element, number | null>()
    const geometry = this.marks.map((mark, index) => {
      const rects: Box[] = []
      let lineHeight: number | null = null
      for (const range of mark.ranges) {
        const container = range.commonAncestorContainer
        const anchor = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement) as Element
        let clip = clips.get(anchor)
        if (!clip) {
          clip = clipOf(anchor, view)
          clips.set(anchor, clip)
        }
        const block = anchor.closest(BLOCK) ?? anchor
        if (!heights.has(block)) {
          const v = Number.parseFloat(view.getComputedStyle(block).lineHeight)
          heights.set(block, Number.isFinite(v) ? v : null)
        }
        lineHeight ??= heights.get(block) ?? null
        for (const r of Array.from(range.getClientRects())) {
          const b = { left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) }
          if (b.right > b.left && b.bottom > b.top) rects.push(b)
        }
      }
      const { lines, glyph } = linesOf(rects)
      return { mark: index, tone: mark.tone, lines, glyph, lineHeight }
    })
    this.bands = layoutBands(geometry, origin, view.devicePixelRatio || 1)
    // ---- write ----
    const fragment = this.doc.createDocumentFragment()
    this.els = new Map()
    for (const b of [...this.bands].sort((x, y) => ORDER[x.tone] - ORDER[y.tone])) {
      const el = this.doc.createElement('i')
      el.dataset.tone = b.tone
      el.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;border-radius:${b.radius.map(r => `${r}px`).join(' ')}`
      if (b.mark === this.hot) el.classList.add('hot')
      fragment.append(el)
      const list = this.els.get(b.mark) ?? []
      list.push(el)
      this.els.set(b.mark, list)
    }
    this.host.replaceChildren(fragment)
  }
}
