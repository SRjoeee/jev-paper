import { describe, expect, it, vi } from 'vitest'
import { createController } from '@/content/controller'
import type { PageUiEvents } from '@/content/ui/page-ui'
import type { PageUnits } from '@/content/units'
import type { DigestReply } from '@/shared/messages'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

const r = () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ top: 0 }) }) as unknown as Range
const page: PageUnits = {
  title: 'T',
  units: [
    { sid: 's001', kind: 'abstract', sec: 'abstract', secTitle: 'Abstract', pid: 'a', text: 'We propose X.' },
    { sid: 's002', kind: 'body', sec: 'S1', secTitle: '1 Method', pid: 'p', text: 'X works by Y.' },
    { sid: 's003', kind: 'body', sec: 'S2', secTitle: '2 Limits', pid: 'q', text: 'X fails on Z.' },
  ],
  ranges: new Map([['s001', [r()]], ['s002', [r()]], ['s003', [r()]]]),
}
const RESULT = { claims: [{ sid: 's001', pClaim: 0.9, role: 'method' as const, ranked: [['s002', 0.8]] as [string, number][] }], caveats: [['s003', 0.9, 'limitation']] as [string, number, 'limitation'][] }

function harness(initial: Partial<Settings>, replies: DigestReply[], digestOverride?: () => Promise<DigestReply>) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  const watchers: ((s: Settings) => void)[] = []
  const layer = {
    theme: 'light' as const,
    onTheme: undefined as ((t: 'light' | 'dark') => void) | undefined,
    onLayout: undefined as (() => void) | undefined,
    paint: vi.fn(),
    bandsOf: vi.fn(() => [{ mark: 0, tone: 'claim' as const, left: 1, top: 2, width: 3, height: 4, radius: [4, 4, 4, 4] as [number, number, number, number] }]),
    setHot: vi.fn(),
    pulse: vi.fn(),
    destroy: vi.fn(),
  }
  const ui = { setState: vi.fn(), setLevel: vi.fn(), setTheme: vi.fn(), announce: vi.fn(), showBubble: vi.fn(), showTip: vi.fn(), hideTip: vi.fn(), isOverTip: vi.fn(() => false), setAnchors: vi.fn(), focusAnchor: vi.fn(), setPointer: vi.fn(), destroy: vi.fn() }
  const digest = vi.fn(digestOverride ?? (async () => replies.shift()!))
  const openSetup = vi.fn()
  const patch = vi.fn(async (p: Partial<Settings>) => {
    settings = { ...settings, ...p }
    for (const w of watchers) w(settings)
  })
  let events!: PageUiEvents
  const c = createController({
    page, paperId: '1706.03762', unitsHash: 'h', digest, openSetup, layer,
    makeUi: e => { events = e; return ui },
    settings: { get: async () => settings, watch: cb => { watchers.push(cb); return () => {} }, patch },
    scrollTo: (_ranges, then) => then(),
  })
  return { c, ui, layer, digest, openSetup, patch, events: () => events }
}
const flush = () => new Promise(r => setTimeout(r, 0))

describe('createController', () => {
  it('without a key: a dot on the button; a saved key (keyStamp bump) runs the paper again', async () => {
    const h = harness({}, [{ ok: false, error: 'no-key' }, { ok: true, result: RESULT, cached: false }])
    await h.c.start()
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'attention', error: 'no-key' })
    expect(h.c.status()).toEqual({ state: 'error', error: 'no-key' })
    await h.patch({ keyStamp: 1 })
    await flush()
    expect(h.digest).toHaveBeenCalledTimes(2)
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'done' })
  })

  it('a new key re-runs a paper that failed on the key', async () => {
    const h = harness({}, [{ ok: false, error: 'invalid-key' }, { ok: true, result: RESULT, cached: false }])
    await h.c.start()
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'error', error: 'invalid-key' })
    await h.patch({ keyStamp: 1 })
    await flush()
    expect(h.digest).toHaveBeenCalledTimes(2)
    expect(h.c.status()).toEqual({ state: 'done', marks: 2 })
  })

  it('back from the back/forward cache mid-run: asks again, and drops the reply that never came', async () => {
    let first!: (r: DigestReply) => void
    const replies: Promise<DigestReply>[] = [new Promise(r => { first = r }), Promise.resolve({ ok: true, result: RESULT, cached: false })]
    const h = harness({}, [], () => replies.shift()!)
    void h.c.start()
    await flush()
    expect(h.c.status()).toEqual({ state: 'computing' })
    h.c.resume()
    await flush()
    expect(h.digest).toHaveBeenCalledTimes(2)
    expect(h.c.status()).toEqual({ state: 'done', marks: 2 })
    // The first request's reply, if Chrome ever delivers it, is stale
    first({ ok: false, error: 'aborted' })
    await flush()
    expect(h.c.status()).toEqual({ state: 'done', marks: 2 })
  })

  it('back from the back/forward cache after an aborted or busy run: asks again', async () => {
    for (const error of ['aborted', 'busy'] as const) {
      const h = harness({}, [{ ok: false, error }, { ok: true, result: RESULT, cached: true }])
      await h.c.start()
      h.c.resume()
      await flush()
      expect(h.digest).toHaveBeenCalledTimes(2)
      expect(h.c.status()).toEqual({ state: 'done', marks: 2 })
    }
  })

  it('back from the back/forward cache with marks, or waiting on the key: asks nothing', async () => {
    const done = harness({}, [{ ok: true, result: RESULT, cached: false }])
    await done.c.start()
    done.c.resume()
    const key = harness({}, [{ ok: false, error: 'invalid-key' }])
    await key.c.start()
    key.c.resume()
    await flush()
    expect(done.digest).toHaveBeenCalledTimes(1)
    expect(key.digest).toHaveBeenCalledTimes(1)
  })

  it('a keyStamp change after a busy error does not re-run by itself', async () => {
    const h = harness({}, [{ ok: false, error: 'busy' }])
    await h.c.start()
    await h.patch({ keyStamp: 1 })
    await flush()
    expect(h.digest).toHaveBeenCalledTimes(1)
  })

  it('paints claims and rank-1 evidence at level 1, and adds the caveat at level 2 without asking again', async () => {
    const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
    await h.c.start()
    expect(h.layer.paint).toHaveBeenLastCalledWith([expect.objectContaining({ tone: 'claim' }), expect.objectContaining({ tone: 'evidence' })])
    await h.patch({ level: 2 })
    expect(h.layer.paint.mock.lastCall![0].map((m: { tone: string }) => m.tone)).toEqual(['claim', 'evidence', 'caveat'])
    expect(h.digest).toHaveBeenCalledTimes(1)
  })

  it('announces the count, anchors the claim and the evidence, and shows the bubble once', async () => {
    const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
    await h.c.start()
    expect(h.ui.announce).toHaveBeenLastCalledWith('已标出 2 处')
    expect(h.ui.setAnchors.mock.lastCall![0].map((a: { label: string }) => a.label)).toEqual(['摘要第 1 条：跳到正文证据', '证据：回到摘要第 1 条'])
    expect(h.ui.showBubble).toHaveBeenCalledTimes(1)
    h.ui.showBubble.mock.calls[0]![0]()
    expect(h.patch).toHaveBeenCalledWith({ bubbleSeen: true })
  })

  it('the button retries a busy error and opens setup for a key error', async () => {
    const busy = harness({}, [{ ok: false, error: 'busy' }, { ok: true, result: RESULT, cached: false }])
    await busy.c.start()
    busy.events().action()
    await flush()
    expect(busy.digest).toHaveBeenCalledTimes(2)
    expect(busy.openSetup).not.toHaveBeenCalled()
    const credit = harness({}, [{ ok: false, error: 'credit' }])
    await credit.c.start()
    credit.events().action()
    expect(credit.openSetup).toHaveBeenCalledTimes(1)
    expect(credit.digest).toHaveBeenCalledTimes(1)
  })

  it('activating a claim pulses its evidence; activating the evidence pulses the claim', async () => {
    const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
    await h.c.start()
    h.c.activate(0)
    expect(h.layer.pulse).toHaveBeenLastCalledWith(1)
    h.c.activate(1)
    expect(h.layer.pulse).toHaveBeenLastCalledWith(0)
  })

  it('an aborted run leaves the button idle and says nothing', async () => {
    const h = harness({}, [{ ok: false, error: 'aborted' }])
    await h.c.start()
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'idle' })
    expect(h.ui.announce).not.toHaveBeenCalled()
  })

  // Ruling 18: the band layer can relayout on its own (resize, fonts, mutations, theme); anchors must be
  // rebuilt from the fresh geometry, not left stale from the paint that first built them.
  it('a layer relayout (onLayout) refreshes the anchors with the new geometry', async () => {
    const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
    await h.c.start()
    expect(h.ui.setAnchors).toHaveBeenCalledTimes(1)
    h.layer.bandsOf.mockReturnValue([{ mark: 0, tone: 'claim' as const, left: 100, top: 200, width: 30, height: 40, radius: [4, 4, 4, 4] as [number, number, number, number] }])
    expect(h.layer.onLayout).toBeTypeOf('function')
    h.layer.onLayout?.()
    expect(h.ui.setAnchors).toHaveBeenCalledTimes(2)
    expect(h.ui.setAnchors.mock.lastCall![0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: 100, top: 200, width: 30, height: 40 })]),
    )
  })

  // Fix round 1, finding 1: the pointer cursor must never touch the paper's own <html> — it goes through the
  // UI port instead, never `document.documentElement.style` directly.
  it('hovering a claim sets the pointer, a caveat clears it, and leaving clears it after the hide delay', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
      await h.c.start()
      await h.patch({ level: 2 }) // brings in the caveat mark (index 2) alongside claim (0) and evidence (1)
      const rect = { top: 0, bottom: 10 } as DOMRect
      h.c.hover({ index: 0, rect }, 10)
      expect(h.ui.setPointer).toHaveBeenLastCalledWith(true)
      h.c.hover({ index: 2, rect }, 10)
      expect(h.ui.setPointer).toHaveBeenLastCalledWith(false)
      h.c.hover({ index: 0, rect }, 10)
      h.c.hover(null, 0)
      vi.advanceTimersByTime(220)
      expect(h.ui.setPointer).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Spec §5.4 "Scrolling hides the tip" (found in the Task 14 e2e): not after the pointer-leave delay, which a smooth
  // jump's stream of scroll events kept restarting — the tip hung over the page, pointing at nothing, for the whole jump
  it('scrolling hides the tip, the hover colour and the pointer at once, and the same mark can show its tip again', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({}, [{ ok: true, result: RESULT, cached: false }])
      await h.c.start()
      const rect = { top: 0, bottom: 10 } as DOMRect
      h.c.hover({ index: 0, rect }, 10)
      h.c.hover(null, 0) // a leave delay pending when the scroll starts
      h.ui.hideTip.mockClear()
      h.c.scrolled()
      expect(h.ui.hideTip).toHaveBeenCalledTimes(1)
      expect(h.layer.setHot).toHaveBeenLastCalledWith(null)
      expect(h.ui.setPointer).toHaveBeenLastCalledWith(false)
      h.ui.showTip.mockClear()
      h.c.hover({ index: 0, rect }, 10)
      expect(h.ui.showTip).toHaveBeenCalledTimes(1)
      // The leave delay pending before the scroll was dropped: it does not hide the tip just shown
      h.ui.hideTip.mockClear()
      vi.advanceTimersByTime(500)
      expect(h.ui.hideTip).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // Fix round 1, finding 2: nothing must run after destroy(), and a rejected digest must not become an
  // unhandled rejection.
  it('destroy() while the digest is pending stops the run from touching the torn-down layer and ui', async () => {
    let resolve!: (reply: DigestReply) => void
    const pending = new Promise<DigestReply>(res => {
      resolve = res
    })
    const h = harness({}, [], () => pending)
    const started = h.c.start()
    await flush()
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'computing' })
    h.c.destroy()
    resolve({ ok: true, result: RESULT, cached: false })
    await started
    await flush()
    expect(h.layer.paint).not.toHaveBeenCalled()
    expect(h.ui.setAnchors).not.toHaveBeenCalled()
    expect(h.ui.setState).not.toHaveBeenCalledWith({ kind: 'done' })
  })

  it('a rejected digest shows the busy error state, with no unhandled rejection', async () => {
    const h = harness({}, [], () => Promise.reject(new Error('Extension context invalidated.')))
    await h.c.start()
    expect(h.ui.setState).toHaveBeenLastCalledWith({ kind: 'error', error: 'busy' })
    expect(h.c.status()).toEqual({ state: 'error', error: 'busy' })
  })
})
