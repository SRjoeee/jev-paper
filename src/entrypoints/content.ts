import { BandLayer } from '@/content/bands/layer'
import { createController } from '@/content/controller'
import { Interaction, scrollToRanges } from '@/content/interaction'
import { PageUi } from '@/content/ui/page-ui'
import { hashUnits, pageUnitsChunked } from '@/content/units'
import { paperIdFrom } from '@/core/paper-id'
import { answer, send } from '@/shared/messages'
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
    const controller = createController({
      page,
      paperId,
      unitsHash,
      layer,
      digest: () => send({ type: 'digest', paperId, title: page.title, unitsHash, units: page.units }),
      openSetup: () => void send({ type: 'open-setup' }),
      settings: { get: getSettings, watch: watchSettings, patch: patchSettings },
      makeUi: events => new PageUi(document, events),
      scrollTo: (ranges, then) => scrollToRanges(ranges, then),
    })
    const interaction = new Interaction({
      doc: document,
      marks: () => controller.paintedMarks(),
      onHover: (hit, x) => controller.hover(hit, x),
      onActivate: index => controller.activate(index),
    })
    const listener = answer({ 'page-status': async () => controller.status() })
    browser.runtime.onMessage.addListener(listener)
    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(listener)
      interaction.destroy()
      controller.destroy()
    })
    await controller.start()
  },
})
