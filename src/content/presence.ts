// This page's side of spec §6.1's abort (Ruling 33; the service worker's side is src/background/presence.ts): a
// runtime port, named after the run the page waits on, held from the page's first digest request for as long as the
// page lives. Chrome closes it when the tab closes, navigates away or the page enters the back/forward cache, and
// the service worker takes that as the page leaving its run.
//
// Chrome also closes it when the service worker stops (it does after about 30 s idle) and on a page's way into the
// back/forward cache; the next digest request then opens a new one, so a port is always open while a request waits.

/** The parts of a runtime port this module uses */
export interface PagePort {
  onDisconnect: { addListener(cb: () => void): void }
  disconnect(): void
}

export function pagePresence(name: string, connect: (name: string) => PagePort = n => browser.runtime.connect({ name: n })) {
  let port: PagePort | null = null
  return {
    /** Opens the port unless it is open: call before every digest request */
    hold(): void {
      if (port) return
      try {
        const opened = connect(name)
        opened.onDisconnect.addListener(() => {
          if (port === opened) port = null
        })
        port = opened
      } catch {
        // "Extension context invalidated" after an update: the digest request that follows fails the same way
        port = null
      }
    },
    /** Closes the port (the content script is being torn down) */
    release(): void {
      const open = port
      port = null
      try {
        open?.disconnect()
      } catch {}
    },
  }
}
