// Everything a paper page does, in order: ask for the digest, paint the current level, follow level and key
// changes, show states on the button, drive interaction A. DOM work is behind the layer and UI ports.
import type { Band } from '@/content/bands/geometry'
import type { PaintMark } from '@/content/bands/layer'
import type { Theme } from '@/content/bands/palette'
import type { Anchor, ButtonState, PageUiEvents } from '@/content/ui/page-ui'
import type { PageUnits } from '@/content/units'
import { COPY } from '@/shared/copy'
import type { ErrorCode } from '@/shared/errors'
import { type Level, type Mark, marksFor } from '@/shared/levels'
import type { DigestReply, PageStatus } from '@/shared/messages'
import type { DigestResult } from '@/shared/result'
import type { Settings } from '@/shared/settings'
import type { Hit } from './interaction'

export interface LayerPort {
  readonly theme: Theme
  onTheme?: (theme: Theme) => void
  /** Ruling 18: fires after paint() and after every relayout the layer schedules on its own (resize, fonts,
   * mutations, theme) — the controller rebuilds anchors from the fresh geometry each time, never stale ones. */
  onLayout?: () => void
  paint(marks: PaintMark[]): void
  bandsOf(index: number): Band[]
  setHot(index: number | null): void
  pulse(index: number): void
  destroy(): void
}

export interface UiPort {
  setState(state: ButtonState): void
  setLevel(level: Level): void
  setTheme(theme: Theme): void
  announce(text: string): void
  showBubble(onDismiss: () => void): void
  showTip(text: string, at: { x: number; top: number; bottom: number }, link: boolean): void
  hideTip(): void
  isOverTip(): boolean
  setAnchors(anchors: Anchor[]): void
  focusAnchor(index: number): void
  destroy(): void
}

export interface ControllerDeps {
  page: PageUnits
  paperId: string
  unitsHash: string
  digest: () => Promise<DigestReply>
  openSetup: () => void
  settings: { get(): Promise<Settings>; watch(cb: (s: Settings) => void): () => void; patch(p: Partial<Omit<Settings, 'version'>>): Promise<unknown> }
  layer: LayerPort
  makeUi: (events: PageUiEvents) => UiPort
  scrollTo: (ranges: Range[], then: () => void) => void
}

/** Errors the reader fixes in the settings, not by retrying */
const KEY_ERRORS = new Set<ErrorCode>(['no-key', 'invalid-key', 'credit', 'not-jev'])

export function createController(deps: ControllerDeps) {
  const { page, layer } = deps
  let settings: Settings
  let result: DigestResult | null = null
  let marks: Mark[] = []
  let status: PageStatus = { state: 'idle' }
  let lastError: ErrorCode | null = null
  let running = false
  let tipTarget: number | null = null
  let hideTimer = 0
  let unwatch: () => void = () => {}

  const ui = deps.makeUi({
    level: level => void deps.settings.patch({ level }),
    action: () => (lastError && KEY_ERRORS.has(lastError) ? deps.openSetup() : void run()),
    tip: () => {
      if (tipTarget !== null) jump(tipTarget, false)
    },
    anchor: index => jump(index, true),
    anchorFocus: index => {
      layer.setHot(index)
      if (index === null) return ui.hideTip()
      // Bands are in document coordinates; the tip is fixed, so convert with the scroll offset at focus time
      const band = layer.bandsOf(index)[0]
      if (band) ui.showTip(tipText(marks[index]!), { x: band.left + band.width / 2 - window.scrollX, top: band.top - window.scrollY, bottom: band.top + band.height - window.scrollY }, false)
    },
  })

  function tipText(mark: Mark): string {
    if (mark.tone === 'claim') return COPY.tip.claim(mark.no, mark.role ? COPY.role[mark.role] : COPY.roleFallback)
    if (mark.tone === 'caveat') return mark.type ? COPY.caveat[mark.type] : COPY.caveatFallback
    return COPY.tip.evidence(mark.claims, mark.tone === 'candidate')
  }

  function targetOf(index: number): number {
    const mark = marks[index]!
    if (mark.tone === 'claim') return marks.findIndex(m => m.tone === 'evidence' && m.sid === mark.evidence)
    if (mark.tone === 'evidence' || mark.tone === 'candidate') return marks.findIndex(m => m.tone === 'claim' && m.sid === mark.claimSid)
    return -1
  }

  function jump(index: number, fromKeyboard: boolean): void {
    const target = targetOf(index)
    if (target < 0) return
    ui.hideTip()
    deps.scrollTo(page.ranges.get(marks[target]!.sid)!, () => {
      layer.pulse(target)
      if (fromKeyboard) ui.focusAnchor(target)
    })
  }

  /** Ruling 18: the anchors the keyboard path uses, rebuilt from the layer's current geometry — called after
   * paint() and again whenever the layer relayouts on its own, so a focus ring never lands on a stale position. */
  function refreshAnchors(): void {
    const anchors: Anchor[] = []
    marks.forEach((m, index) => {
      if (m.tone !== 'claim' && m.tone !== 'evidence') return
      const band = layer.bandsOf(index)[0]
      if (!band) return
      const label = m.tone === 'claim' ? COPY.anchor.claim(m.no) : COPY.anchor.evidence(m.claims[0]!)
      anchors.push({ index, label, left: band.left, top: band.top, width: band.width, height: band.height })
    })
    ui.setAnchors(anchors)
  }

  function paint(): void {
    if (!result) return
    marks = marksFor(result, settings.level).filter(m => page.ranges.has(m.sid))
    layer.paint(marks.map(m => ({ tone: m.tone, ranges: page.ranges.get(m.sid)! })))
    refreshAnchors()
  }

  async function run(): Promise<void> {
    if (running) return
    running = true
    lastError = null
    status = { state: 'computing' }
    ui.setState({ kind: 'computing' })
    const reply = await deps.digest()
    running = false
    if (!reply.ok) {
      lastError = reply.error
      if (reply.error === 'aborted') {
        status = { state: 'idle' }
        ui.setState({ kind: 'idle' })
        return
      }
      status = { state: 'error', error: reply.error }
      ui.setState({ kind: reply.error === 'no-key' ? 'attention' : 'error', error: reply.error })
      ui.announce(COPY.pageError[reply.error])
      return
    }
    result = reply.result
    paint()
    status = { state: 'done', marks: marks.length }
    ui.setState({ kind: 'done' })
    ui.announce(marks.length ? COPY.status.marked(marks.length) : COPY.status.none)
    if (marks.length && !settings.bubbleSeen) ui.showBubble(() => void deps.settings.patch({ bubbleSeen: true }))
  }

  function onSettings(next: Settings): void {
    const prev = settings
    settings = next
    if (next.level !== prev.level) {
      ui.setLevel(next.level)
      paint()
    }
    // The key itself is never read here (spec §4): the popup bumps keyStamp whenever it saves credentials
    if (next.keyStamp !== prev.keyStamp && lastError && KEY_ERRORS.has(lastError)) void run()
  }

  return {
    async start(): Promise<void> {
      settings = await deps.settings.get()
      ui.setLevel(settings.level)
      ui.setTheme(layer.theme)
      layer.onTheme = theme => ui.setTheme(theme)
      layer.onLayout = () => refreshAnchors()
      unwatch = deps.settings.watch(onSettings)
      // Whether a key exists is the service worker's answer ('no-key'), not something this page reads
      await run()
    },
    status: (): PageStatus => status,
    paintedMarks: (): PaintMark[] => marks.map(m => ({ tone: m.tone, ranges: page.ranges.get(m.sid)! })),
    hover(hit: Hit | null, x: number): void {
      clearTimeout(hideTimer)
      if (!hit) {
        hideTimer = window.setTimeout(() => {
          if (ui.isOverTip()) return
          tipTarget = null
          layer.setHot(null)
          ui.hideTip()
          document.documentElement.style.cursor = ''
        }, 220)
        return
      }
      if (tipTarget === hit.index) return
      tipTarget = hit.index
      const mark = marks[hit.index]!
      layer.setHot(hit.index)
      ui.showTip(tipText(mark), { x, top: hit.rect.top, bottom: hit.rect.bottom }, mark.tone !== 'caveat')
      document.documentElement.style.cursor = mark.tone === 'caveat' ? '' : 'pointer'
    },
    activate: (index: number): void => jump(index, false),
    destroy(): void {
      unwatch()
      clearTimeout(hideTimer)
      layer.onTheme = undefined
      layer.onLayout = undefined
      ui.destroy()
      layer.destroy()
    },
  }
}
