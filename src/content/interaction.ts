// Interaction A (spec §5.4): hover a mark for its tip, click a claim to jump to its evidence and back.
import type { Tone } from '@/shared/levels'

export interface Hit {
  index: number
  rect: DOMRect
}

/** Paint order of the band layer: where two marks overlap, the one painted on top is the one under the pointer */
const ORDER: Record<Tone, number> = { claim: 0, caveat: 1, candidate: 2, evidence: 3 }

/** Real containment first, then a few pixels of slack (the order Read arXiv's hit test uses) */
export function hitTest(x: number, y: number, marks: readonly { tone: Tone; ranges: Range[] }[], slack = 3): Hit | null {
  for (const pad of [0, slack]) {
    let best: Hit | null = null
    let bestOrder = -1
    for (let index = 0; index < marks.length; index++) {
      const mark = marks[index]!
      if (ORDER[mark.tone] <= bestOrder) continue
      for (const range of mark.ranges) {
        for (const rect of Array.from(range.getClientRects())) {
          if (x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad) {
            best = { index, rect }
            bestOrder = ORDER[mark.tone]
          }
        }
      }
    }
    if (best) return best
  }
  return null
}

export interface InteractionDeps {
  doc: Document
  marks: () => readonly { tone: Tone; ranges: Range[] }[]
  onHover: (hit: Hit | null, x: number) => void
  onActivate: (index: number) => void
}

export class Interaction {
  private frame = 0
  private cleanup: (() => void)[] = []

  constructor(private deps: InteractionDeps) {
    const { doc } = deps
    const view = doc.defaultView!
    const ours = (e: Event) => e.composedPath().some(n => n instanceof Element && n.localName.startsWith('jevpaper-'))
    const move = (e: MouseEvent) => {
      if (this.frame || ours(e)) return
      this.frame = view.requestAnimationFrame(() => {
        this.frame = 0
        deps.onHover(hitTest(e.clientX, e.clientY, deps.marks()), e.clientX)
      })
    }
    const click = (e: MouseEvent) => {
      if (ours(e)) return
      this.handleClick(e.clientX, e.clientY, e.target as Element | null, doc.getSelection()?.isCollapsed ?? true)
    }
    const scroll = () => deps.onHover(null, 0)
    doc.addEventListener('mousemove', move, { passive: true })
    doc.addEventListener('click', click)
    view.addEventListener('scroll', scroll, { passive: true })
    this.cleanup.push(
      () => doc.removeEventListener('mousemove', move),
      () => doc.removeEventListener('click', click),
      () => view.removeEventListener('scroll', scroll),
    )
  }

  /** Returns whether the click activated a mark */
  handleClick(x: number, y: number, target: Element | null, selectionCollapsed: boolean): boolean {
    if (!selectionCollapsed) return false
    if (target?.closest?.('a[href]')) return false
    const hit = hitTest(x, y, this.deps.marks())
    if (!hit) return false
    this.deps.onActivate(hit.index)
    return true
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    for (const undo of this.cleanup) undo()
  }
}

/** Bring a sentence to a third of the viewport; `then` runs when the scroll has landed (spec §5.4) */
export function scrollToRanges(ranges: Range[], then: () => void, view: Window = window): void {
  const rect = ranges[0]?.getBoundingClientRect()
  if (!rect) return
  const delta = rect.top - view.innerHeight / 3
  if (Math.abs(delta) < 40) {
    then()
    return
  }
  if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    view.scrollBy({ top: delta, behavior: 'instant' })
    then()
    return
  }
  let done = false
  const land = () => {
    if (done) return
    done = true
    then()
  }
  view.addEventListener('scrollend', land, { once: true })
  view.setTimeout(land, 1200)
  view.scrollBy({ top: delta, behavior: 'smooth' })
}
