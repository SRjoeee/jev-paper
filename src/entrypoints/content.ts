import { BandLayer } from '@/content/bands/layer'
import { createController } from '@/content/controller'
import { Interaction, scrollToRanges } from '@/content/interaction'
import { pagePresence } from '@/content/presence'
import { PageUi } from '@/content/ui/page-ui'
import { hashUnits, pageUnitsChunked } from '@/content/units'
import { paperIdFrom } from '@/core/paper-id'
import { answer, presenceName, send } from '@/shared/messages'
import { getSettings, patchSettings, watchSettings } from '@/shared/settings'

export default defineContentScript({
  matches: ['https://arxiv.org/html/*', 'https://ar5iv.labs.arxiv.org/html/*', 'https://ar5iv.org/html/*'],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // arXiv embeds figures as <object> documents; never run inside one (spec §5.1)
    if (window.top !== window) return
    const page = await pageUnitsChunked(document)
    if (!page) return
    const paperId = paperIdFrom(location.pathname, 'html') ?? location.pathname
    const unitsHash = await hashUnits(page.units)
    const layer = new BandLayer(document)
    // Spec §6.1: the port that tells the service worker this page still waits on its run
    const presence = pagePresence(presenceName(paperId, unitsHash))
    const controller = createController({
      page,
      paperId,
      unitsHash,
      layer,
      digest: () => {
        presence.hold()
        return send({ type: 'digest', paperId, title: page.title, unitsHash, units: page.units })
      },
      openSetup: () => void send({ type: 'open-setup' }),
      settings: { get: getSettings, watch: watchSettings, patch: patchSettings },
      makeUi: events => new PageUi(document, events),
      scrollTo: (ranges, then) => scrollToRanges(ranges, then),
    })
    const interaction = new Interaction({
      doc: document,
      marks: () => controller.paintedMarks(),
      onHover: (hit, x) => controller.hover(hit, x),
      onScroll: () => controller.scrolled(),
      onActivate: index => controller.activate(index),
    })
    const listener = answer({ 'page-status': async () => controller.status() })
    browser.runtime.onMessage.addListener(listener)
    // Into the back/forward cache: close the port now (Chrome closes it too, but a frozen page never hears of it,
    // and would keep a dead port after coming back). Back from it: ask again unless the marks are already here.
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) presence.release()
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) controller.resume()
    }
    addEventListener('pagehide', onHide)
    addEventListener('pageshow', onShow)
    ctx.onInvalidated(() => {
      presence.release()
      removeEventListener('pagehide', onHide)
      removeEventListener('pageshow', onShow)
      browser.runtime.onMessage.removeListener(listener)
      interaction.destroy()
      controller.destroy()
    })
    await controller.start()
    // Read by the end-to-end performance budget (tests/e2e/run.mjs); on our own host, never on the paper
    document.querySelector('jevpaper-ui')?.setAttribute('data-timing', JSON.stringify({ units: page.busyMs, paint: controller.timing().paint }))
  },
})
