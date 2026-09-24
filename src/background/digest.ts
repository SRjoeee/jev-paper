// One run per paper at a time (spec §6.3): a second tab, a reload or a retry joins the run in flight, and a run is
// aborted only when the last tab waiting on it has gone. This is the rule that keeps a reload loop from charging
// the reader again and again (the prototype's recursion once ran one paper 88 times).
import type { DigestReply } from '@/shared/messages'
import { type Credentials, hasKey } from '@/shared/credentials'
import type { DigestResult } from '@/shared/result'
import type { Paper, Unit } from '@/shared/units'
import { cacheKey } from './cache'
import type { EngineAsk } from './engine/pipeline'
import { type Ask, JevError } from './jev/client'
import { type Endpoint, endpointOf } from './jev/providers'

export interface DigestDeps {
  cache: { get(key: string): Promise<DigestResult | undefined>; put(key: string, result: DigestResult): Promise<void> }
  /** The key is read here, in the service worker, and nowhere a page can reach (spec §4) */
  credentials: () => Promise<Credentials>
  engine: (paper: Paper, ask: EngineAsk) => Promise<DigestResult>
  client: (endpoint: Endpoint) => Ask
}

interface Flight {
  promise: Promise<DigestReply>
  controller: AbortController
  waiters: Set<number | symbol>
}

export function createDigestService(deps: DigestDeps) {
  const flights = new Map<string, Flight>()

  async function request(msg: { paperId: string; title: string; unitsHash: string; units: Unit[] }, tabId?: number): Promise<DigestReply> {
    const key = cacheKey(msg.paperId, msg.unitsHash)
    const hit = await deps.cache.get(key)
    if (hit) return { ok: true, result: hit, cached: true }
    let flight = flights.get(key)
    if (!flight) {
      const credentials = await deps.credentials()
      if (!hasKey(credentials)) return { ok: false, error: 'no-key' }
      // Re-check after the await: another request may have started the flight meanwhile
      flight = flights.get(key)
      if (!flight) {
        const controller = new AbortController()
        const ask = deps.client(endpointOf(credentials))
        const promise: Promise<DigestReply> = deps
          .engine({ title: msg.title, units: msg.units }, (state, questions) => ask(state, questions, controller.signal))
          .then(async result => {
            await deps.cache.put(key, result)
            return { ok: true as const, result, cached: false }
          })
          .catch(error => ({ ok: false as const, error: error instanceof JevError ? error.code : ('busy' as const) }))
          .finally(() => flights.delete(key))
        flight = { promise, controller, waiters: new Set() }
        flights.set(key, flight)
      }
    }
    const waiter: number | symbol = tabId ?? Symbol('anonymous')
    flight.waiters.add(waiter)
    try {
      return await flight.promise
    } finally {
      flight.waiters.delete(waiter)
    }
  }

  /** A tab closed or navigated to another page: abort every run it was the last one waiting on */
  function leave(tabId: number): void {
    for (const flight of flights.values()) if (flight.waiters.delete(tabId) && flight.waiters.size === 0) flight.controller.abort()
  }

  return { request, leave, inFlight: () => flights.size }
}
