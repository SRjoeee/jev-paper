// Which paper pages are still open (spec §6.1, Ruling 33). A paper page holds a runtime port for as long as it lives,
// named after the run it waits on. A closed tab, a navigation to another page and a page entering the back/forward
// cache all disconnect that port, so the disconnect is how a run learns its tab has gone — Chrome gives this
// extension no tab URLs (no `tabs` permission, no arXiv host permission), so `tabs.onUpdated` cannot tell it.
//
// A reload disconnects the old page's port too, and the reloaded page connects a new one for the same run once it
// has cut its sentences. So a disconnect waits a grace period before it counts: if the tab holds a port for the same
// run again by then, nothing happens and the reloaded page keeps waiting on the run it rejoined.
import { presenceOf } from '@/shared/messages'
import { runOf } from './cache'

/** How long a tab has to connect again (a reload of the same paper) before its disconnect counts as leaving */
export const GRACE_MS = 2000

/** The parts of a runtime port this module reads */
export interface PresencePort {
  name: string
  sender?: { tab?: { id?: number } }
  onDisconnect: { addListener(cb: () => void): void }
}

export interface PresenceOptions {
  graceMs?: number
  setTimeout?: (cb: () => void, ms: number) => unknown
}

/** `leave(tabId, run)` is called once a tab has held no port for `run` for the whole grace period */
export function createPresence(leave: (tabId: number, run: string) => void, options: PresenceOptions = {}) {
  const graceMs = options.graceMs ?? GRACE_MS
  const later = options.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))
  /** Open ports per tab and run. A count, not a flag: a reloaded page may connect before the old page's port is gone */
  const open = new Map<string, number>()

  return {
    connect(port: PresencePort): void {
      const tabId = port.sender?.tab?.id
      const page = presenceOf(port.name)
      if (tabId === undefined || !page) return
      const run = runOf(page.paperId, page.unitsHash)
      const at = `${tabId}\n${run}`
      open.set(at, (open.get(at) ?? 0) + 1)
      port.onDisconnect.addListener(() => {
        const left = (open.get(at) ?? 1) - 1
        if (left > 0) open.set(at, left)
        else open.delete(at)
        later(() => {
          if (!open.has(at)) leave(tabId, run)
        }, graceMs)
      })
    },
    /** Open ports, for tests */
    size: (): number => [...open.values()].reduce((a, b) => a + b, 0),
  }
}
