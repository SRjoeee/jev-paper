// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runOf } from '@/background/cache'
import { createDigestService } from '@/background/digest'
import { createPresence, GRACE_MS, type PresencePort } from '@/background/presence'
import { JevError } from '@/background/jev/client'
import { DEFAULT_CREDENTIALS } from '@/shared/credentials'
import { presenceName, presenceOf } from '@/shared/messages'

/** Timers run by hand: `advance(ms)` fires every callback due by then */
function clock() {
  let now = 0
  const due: { at: number; cb: () => void }[] = []
  return {
    setTimeout: (cb: () => void, ms: number) => {
      due.push({ at: now + ms, cb })
    },
    advance(ms: number) {
      now += ms
      for (const t of due.filter(t => t.at <= now)) {
        due.splice(due.indexOf(t), 1)
        t.cb()
      }
    },
  }
}

/** A runtime port as the service worker sees one from a paper page in `tabId` */
function port(tabId: number | undefined, name: string) {
  const listeners: (() => void)[] = []
  const p: PresencePort = { name, sender: tabId === undefined ? {} : { tab: { id: tabId } }, onDisconnect: { addListener: cb => listeners.push(cb) } }
  const disconnect = () => {
    for (const cb of listeners) cb()
  }
  return { port: p, disconnect }
}

const A = presenceName('1706.03762', 'aa11')
const B = presenceName('2312.17141', 'bb22')

function harness() {
  const c = clock()
  const left: [number, string][] = []
  const presence = createPresence((tabId, run) => left.push([tabId, run]), { setTimeout: c.setTimeout })
  return { c, left, presence }
}

describe('presence port names', () => {
  it('name the paper and its units hash, and read them back', () => {
    expect(presenceOf(presenceName('hep-th/9711200v2', '0f9a'))).toEqual({ paperId: 'hep-th/9711200v2', unitsHash: '0f9a' })
    expect(presenceOf('something else')).toBeNull()
  })
})

describe('createPresence', () => {
  it('leaves the run once the grace period passes after a disconnect', () => {
    const h = harness()
    const a = port(7, A)
    h.presence.connect(a.port)
    a.disconnect()
    h.c.advance(GRACE_MS - 1)
    expect(h.left).toEqual([])
    h.c.advance(1)
    expect(h.left).toEqual([[7, runOf('1706.03762', 'aa11')]])
  })

  it('does not leave when the tab connects again for the same run within the grace (a reload)', () => {
    const h = harness()
    const a = port(7, A)
    h.presence.connect(a.port)
    a.disconnect()
    h.c.advance(GRACE_MS / 2)
    h.presence.connect(port(7, A).port)
    h.c.advance(GRACE_MS)
    expect(h.left).toEqual([])
  })

  it('does not leave when the new page connected before the old page disconnected', () => {
    const h = harness()
    const old = port(7, A)
    h.presence.connect(old.port)
    h.presence.connect(port(7, A).port)
    old.disconnect()
    h.c.advance(GRACE_MS)
    expect(h.left).toEqual([])
  })

  it('leaves when the tab comes back for another paper (a navigation, not a reload)', () => {
    const h = harness()
    const a = port(7, A)
    h.presence.connect(a.port)
    a.disconnect()
    h.presence.connect(port(7, B).port)
    h.c.advance(GRACE_MS)
    expect(h.left).toEqual([[7, runOf('1706.03762', 'aa11')]])
  })

  it('keeps tabs apart: another tab on the same paper does not keep this one', () => {
    const h = harness()
    const a = port(7, A)
    h.presence.connect(a.port)
    h.presence.connect(port(8, A).port)
    a.disconnect()
    h.c.advance(GRACE_MS)
    expect(h.left).toEqual([[7, runOf('1706.03762', 'aa11')]])
  })

  it('ignores a port without a tab or with another name', () => {
    const h = harness()
    const noTab = port(undefined, A)
    const other = port(7, 'popup')
    h.presence.connect(noTab.port)
    h.presence.connect(other.port)
    expect(h.presence.size()).toBe(0)
    noTab.disconnect()
    other.disconnect()
    h.c.advance(GRACE_MS)
    expect(h.left).toEqual([])
  })
})

describe('presence and the digest service together', () => {
  const msg = { paperId: '1706.03762', title: 'T', unitsHash: 'aa11', units: [] }
  function service() {
    let aborted = 0
    const s = createDigestService({
      cache: { get: async () => undefined, put: async () => {} },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: async (_paper, ask) => {
        await ask({}, {})
        return { claims: [], caveats: [] }
      },
      // Never answers; an abort rejects
      client: () => (_s, _q, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => {
            aborted++
            reject(new JevError('aborted', 'aborted'))
          }),
        ),
    })
    return { s, aborted: () => aborted }
  }
  const tick = () => new Promise(r => setTimeout(r, 0))

  it('a tab that disconnects and stays away aborts the run it alone waited on', async () => {
    const svc = service()
    const c = clock()
    const presence = createPresence((tabId, run) => svc.s.leave(tabId, run), { setTimeout: c.setTimeout })
    const a = port(7, A)
    presence.connect(a.port)
    const reply = svc.s.request(msg, 7)
    await tick()
    a.disconnect()
    c.advance(GRACE_MS)
    expect(await reply).toEqual({ ok: false, error: 'aborted' })
    expect(svc.aborted()).toBe(1)
  })

  it('a reload within the grace keeps the run, and the reloaded page gets its result', async () => {
    const svc = service()
    const c = clock()
    const presence = createPresence((tabId, run) => svc.s.leave(tabId, run), { setTimeout: c.setTimeout })
    const a = port(7, A)
    presence.connect(a.port)
    void svc.s.request(msg, 7)
    await tick()
    a.disconnect()
    presence.connect(port(7, A).port)
    void svc.s.request(msg, 7)
    c.advance(GRACE_MS)
    await tick()
    expect(svc.aborted()).toBe(0)
    expect(svc.s.inFlight()).toBe(1)
  })
})
