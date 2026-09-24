import { ResultCache } from '@/background/cache'
import { createDigestService } from '@/background/digest'
import { digest } from '@/background/engine/pipeline'
import { createClient } from '@/background/jev/client'
import { endpointOf } from '@/background/jev/providers'
import { validateKey } from '@/background/jev/validate'
import { DEFAULT_CREDENTIALS, getCredentials } from '@/shared/credentials'
import { answer } from '@/shared/messages'

export default defineBackground(() => {
  const service = createDigestService({ cache: new ResultCache(), credentials: getCredentials, engine: digest, client: endpoint => createClient(endpoint) })

  browser.runtime.onMessage.addListener(
    answer({
      digest: (message, sender) => service.request(message, sender.tabId),
      validate: message => validateKey(endpointOf({ ...DEFAULT_CREDENTIALS, ...message })),
      'open-setup': async () => {
        await browser.tabs.create({ url: browser.runtime.getURL('/popup.html') })
        return null
      },
    }),
  )
  // A closed tab, or one that navigated to another URL (a reload keeps its URL and keeps waiting)
  browser.tabs.onRemoved.addListener(tabId => service.leave(tabId))
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) service.leave(tabId)
  })
})
