// The page's own UI (spec §5.4–5.5, §13): a floating menu button, menu 1a as a radio group, the hover tip, the
// first-run bubble, a polite status region, and focusable anchors over the marks for the keyboard path.
import type { Theme } from '@/content/bands/palette'
import { COPY, LANG } from '@/shared/copy'
import type { ErrorCode } from '@/shared/errors'
import { highlighterSvg } from '@/shared/icon'
import { LANG_TAG } from '@/shared/lang'
import { LAYERS, type Level } from '@/shared/levels'
import layersCss from '@/shared/layers.css?inline'
import tokensCss from '@/shared/tokens.css?inline'
import pageCss from './page-ui.css?inline'

export type ButtonState = { kind: 'idle' } | { kind: 'computing' } | { kind: 'done' } | { kind: 'attention'; error: ErrorCode } | { kind: 'error'; error: ErrorCode }

export interface Anchor {
  index: number
  label: string
  left: number
  top: number
  width: number
  height: number
}

export interface PageUiEvents {
  level(level: Level): void
  /** The button was pressed while it shows a key problem or an error */
  action(): void
  /** A link tip was clicked */
  tip(): void
  anchor(index: number): void
  anchorFocus(index: number | null): void
}

const ANCHOR_CSS = ':host{all:initial}.anchor{position:absolute;padding:0;border:0;border-radius:4px;background:transparent;pointer-events:none}.anchor:focus-visible{outline-offset:2px}'

export class PageUi {
  private host: HTMLElement
  private shell: HTMLDivElement
  private fab: HTMLButtonElement
  private menu: HTMLDivElement
  private rows: HTMLButtonElement[] = []
  private status: HTMLDivElement
  private desc: HTMLDivElement
  private bubble: HTMLDivElement
  private tipEl: HTMLElement | null = null
  private overTip = false
  private cursorStyle: HTMLStyleElement | null = null
  private anchorsHost: HTMLElement
  private anchorsRoot: ShadowRoot
  private anchors = new Map<number, HTMLButtonElement>()
  private level: Level = 1
  private state: ButtonState = { kind: 'idle' }
  private cleanup: (() => void)[] = []

  constructor(private doc: Document, private events: PageUiEvents) {
    this.host = doc.createElement('jevpaper-ui')
    // The paper's own `lang` is not the interface's: screen readers and font fallback follow this one
    this.host.lang = LANG_TAG[LANG]
    const root = this.host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = `${tokensCss}\n${layersCss}\n${pageCss}`
    this.shell = doc.createElement('div')
    this.shell.className = 'jp-theme root'
    this.shell.dataset.theme = 'light'
    this.shell.innerHTML = `
      <div class="sr" role="status" aria-live="polite"></div>
      <div class="sr" id="jp-desc"></div>
      <div class="menu" id="jp-menu" role="radiogroup" aria-label="${COPY.layersLabel}"></div>
      <div class="bubble" hidden></div>
      <button class="fab" type="button" aria-label="${COPY.button}" aria-expanded="false" aria-controls="jp-menu" aria-describedby="jp-desc">
        ${highlighterSvg(22)}<span class="ring" hidden></span><span class="dot" hidden></span>
      </button>`
    root.append(style, this.shell)
    const q = <T extends Element>(s: string) => this.shell.querySelector(s) as T
    this.status = q('[role="status"]')
    this.desc = q('#jp-desc')
    this.menu = q('#jp-menu')
    this.bubble = q('.bubble')
    this.fab = q('.fab')
    for (const layer of LAYERS) {
      const row = doc.createElement('button')
      row.type = 'button'
      row.className = 'row'
      row.setAttribute('role', 'radio')
      row.dataset.level = String(layer.level)
      row.innerHTML = `<span class="stroke" aria-hidden="true">${layer.tones.map(t => `<i style="background:var(--jp-${t})"></i>`).join('')}</span><span>${layer.name}</span>`
      row.addEventListener('click', () => this.choose(layer.level, false))
      this.rows.push(row)
      this.menu.append(row)
    }
    this.menu.addEventListener('keydown', e => this.onMenuKey(e))
    this.menu.addEventListener('transitionend', () => this.menu.removeAttribute('data-closing'))
    this.fab.addEventListener('click', () => this.onFab())
    // In a key or error state the reason shows beside the button on hover and keyboard focus (spec §5.5)
    const reason = () => {
      if (this.state.kind !== 'attention' && this.state.kind !== 'error') return
      const box = this.fab.getBoundingClientRect()
      this.showTip(COPY.pageError[this.state.error], { x: box.left + box.width / 2, top: box.top, bottom: box.bottom }, false)
    }
    this.fab.addEventListener('mouseenter', reason)
    this.fab.addEventListener('focus', reason)
    this.fab.addEventListener('mouseleave', () => this.hideTip())
    this.fab.addEventListener('blur', () => this.hideTip())
    doc.body.append(this.host)

    this.anchorsHost = doc.createElement('jevpaper-anchors')
    this.anchorsHost.lang = LANG_TAG[LANG]
    this.anchorsHost.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0'
    this.anchorsRoot = this.anchorsHost.attachShadow({ mode: 'open' })
    const anchorStyle = doc.createElement('style')
    anchorStyle.textContent = ANCHOR_CSS
    this.anchorsRoot.append(anchorStyle)
    doc.body.append(this.anchorsHost)

    const outside = (e: Event) => {
      if (this.isOpen() && !e.composedPath().includes(this.host)) this.close(false)
    }
    doc.addEventListener('click', outside, true)
    this.cleanup.push(() => doc.removeEventListener('click', outside, true))
    this.setLevel(1)
  }

  setState(state: ButtonState): void {
    this.state = state
    this.fab.dataset.state = state.kind
    ;(this.fab.querySelector('.ring') as HTMLElement).hidden = state.kind !== 'computing'
    ;(this.fab.querySelector('.dot') as HTMLElement).hidden = state.kind !== 'attention' && state.kind !== 'error'
    this.desc.textContent = state.kind === 'attention' || state.kind === 'error' ? COPY.pageError[state.error] : state.kind === 'computing' ? COPY.status.computing : ''
    if (state.kind === 'attention' || state.kind === 'error') this.close(false)
  }

  setLevel(level: Level): void {
    this.level = level
    for (const row of this.rows) {
      const n = Number(row.dataset.level)
      row.setAttribute('aria-checked', String(n === level))
      row.tabIndex = n === level ? 0 : -1
      row.toggleAttribute('data-lit', n <= level)
    }
  }

  setTheme(theme: Theme): void {
    this.shell.dataset.theme = theme
  }

  /** A stable region, emptied then filled on the next frame, so repeated messages are announced */
  announce(text: string): void {
    this.status.textContent = ''
    requestAnimationFrame(() => {
      this.status.textContent = text
    })
  }

  showBubble(onDismiss: () => void): void {
    this.bubble.textContent = COPY.bubble
    this.bubble.hidden = false
    const dismiss = () => {
      this.bubble.hidden = true
      this.doc.removeEventListener('click', dismiss, true)
      onDismiss()
    }
    this.doc.addEventListener('click', dismiss, true)
    this.cleanup.push(() => this.doc.removeEventListener('click', dismiss, true))
  }

  showTip(text: string, at: { x: number; top: number; bottom: number }, link: boolean): void {
    this.hideTip()
    const tip = this.doc.createElement(link ? 'button' : 'div')
    tip.className = 'tip'
    tip.textContent = text
    if (link) {
      ;(tip as HTMLButtonElement).type = 'button'
      tip.addEventListener('click', () => this.events.tip())
    } else tip.setAttribute('role', 'tooltip')
    tip.addEventListener('mouseenter', () => {
      this.overTip = true
    })
    tip.addEventListener('mouseleave', () => {
      this.overTip = false
    })
    this.shell.append(tip)
    // read once, write once
    const view = this.doc.defaultView!
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const left = Math.round(Math.min(Math.max(8, at.x - w / 2), view.innerWidth - w - 8))
    const top = Math.round(at.top - h - 8 < 8 ? at.bottom + 8 : at.top - h - 8)
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
    this.tipEl = tip
  }

  hideTip(): void {
    this.tipEl?.remove()
    this.tipEl = null
    this.overTip = false
  }

  isOverTip(): boolean {
    return this.overTip
  }

  /**
   * The pointer cursor for a hovered mark, kept off the paper's own `<html>` (spec §5.3: the paper's DOM is
   * never modified) — a document-level style sheet in `<head>` instead, alongside the band layer's own
   * `style[data-jevpaper="bands"]`. `<head>` is never watched by the band layer's mutation observer.
   */
  setPointer(on: boolean): void {
    if (!this.cursorStyle) {
      this.cursorStyle = this.doc.createElement('style')
      this.cursorStyle.dataset.jevpaper = 'cursor'
      this.doc.head.append(this.cursorStyle)
    }
    this.cursorStyle.textContent = on ? ':root { cursor: pointer; }' : ''
  }

  /**
   * Ruling 18: updates buttons in place, keyed by `index`, instead of replacing them — a relayout (resize, font
   * load, a mutation the band layer watches) calls this again with fresh geometry, and a focused anchor must keep
   * focus through it (no blur, so no spurious `anchorFocus(null)`).
   */
  setAnchors(anchors: Anchor[]): void {
    const next = new Set(anchors.map(a => a.index))
    for (const old of [...this.anchors.keys()]) {
      if (!next.has(old)) {
        this.anchors.get(old)!.remove()
        this.anchors.delete(old)
      }
    }
    for (const a of anchors) {
      let button = this.anchors.get(a.index)
      if (!button) {
        button = this.doc.createElement('button')
        button.type = 'button'
        button.className = 'anchor'
        button.dataset.index = String(a.index)
        button.addEventListener('click', () => this.events.anchor(a.index))
        button.addEventListener('focus', () => this.events.anchorFocus(a.index))
        button.addEventListener('blur', () => this.events.anchorFocus(null))
        this.anchors.set(a.index, button)
        this.anchorsRoot.append(button)
      }
      button.setAttribute('aria-label', a.label)
      button.style.cssText = `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px`
    }
  }

  focusAnchor(index: number): void {
    this.anchorsRoot.querySelector<HTMLButtonElement>(`button[data-index="${index}"]`)?.focus({ preventScroll: true })
  }

  destroy(): void {
    for (const undo of this.cleanup) undo()
    this.host.remove()
    this.anchorsHost.remove()
    this.anchors.clear()
    this.cursorStyle?.remove()
    this.cursorStyle = null
  }

  private isOpen(): boolean {
    return this.menu.hasAttribute('data-open')
  }

  private onFab(): void {
    if (this.state.kind === 'attention' || this.state.kind === 'error') {
      this.events.action()
      return
    }
    if (this.isOpen()) this.close(false)
    else this.openMenu()
  }

  private openMenu(): void {
    this.menu.removeAttribute('data-closing')
    this.menu.setAttribute('data-open', '')
    this.fab.setAttribute('aria-expanded', 'true')
    this.rows[this.level - 1]!.focus()
  }

  private close(refocus: boolean): void {
    if (!this.isOpen()) return
    this.menu.removeAttribute('data-open')
    this.menu.setAttribute('data-closing', '')
    this.fab.setAttribute('aria-expanded', 'false')
    if (refocus) this.fab.focus()
  }

  private choose(level: Level, focus: boolean): void {
    this.setLevel(level)
    if (focus) this.rows[level - 1]!.focus()
    this.events.level(level)
  }

  private onMenuKey(e: KeyboardEvent): void {
    const step = (d: number) => (((this.level - 1 + d + 3) % 3) + 1) as Level
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault()
        this.choose(step(1), true)
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault()
        this.choose(step(-1), true)
        break
      case 'Home':
        e.preventDefault()
        this.choose(1, true)
        break
      case 'End':
        e.preventDefault()
        this.choose(3, true)
        break
      case 'Escape':
        e.preventDefault()
        this.close(true)
        break
      case 'Tab':
        this.close(false)
        break
    }
  }
}
