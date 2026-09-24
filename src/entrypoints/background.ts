import { ResultCache } from '@/background/cache'
import { createDigestService } from '@/background/digest'
import { digest } from '@/background/engine/pipeline'
import { createClient } from '@/background/jev/client'
import { endpointOf } from '@/background/jev/providers'
import { validateKey } from '@/background/jev/validate'
import { createPresence } from '@/background/presence'
import { DEFAULT_CREDENTIALS, getCredentials } from '@/shared/credentials'
import { answer } from '@/shared/messages'

export default defineBackground(() => {
  const service = createDigestService({ cache: new ResultCache(), credentials: getCredentials, engine: digest, client: endpoint => createClient(endpoint) })

  browser.runtime.onMessage.addListener(
    answer({
      digest: (message, sender) => service.request(message, sender.tabId, sender.incognito),
      validate: message => validateKey(endpointOf({ ...DEFAULT_CREDENTIALS, ...message })),
      'open-setup': async () => {
        await browser.tabs.create({ url: browser.runtime.getURL('/popup.html') })
        return null
      },
    }),
  )
  // A paper page's port closes when its tab closes, navigates away or enters the back/forward cache; after a grace
  // period in which a reload can rejoin, the tab leaves that page's run (spec §6.1). No tabs.* listener: without the
  // `tabs` permission Chrome strips the URL from tabs.onUpdated, and a closed tab closes its port anyway.
  const presence = createPresence((tabId, run) => service.leave(tabId, run))
  browser.runtime.onConnect.addListener(port => presence.connect(port))
})
