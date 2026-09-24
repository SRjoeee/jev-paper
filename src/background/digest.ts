// One run per paper at a time (spec §6.3): a second tab, a reload or a retry joins the run in flight, and a run is
// aborted only when the last tab waiting on it has gone. This is the rule that keeps a reload loop from charging
// the reader again and again (the prototype's recursion once ran one paper 88 times).
import type { DigestReply } from '@/shared/messages'
import { type Credentials, hasKey } from '@/shared/credentials'
import type { DigestResult } from '@/shared/result'
import type { Paper, Unit } from '@/shared/units'
import { cacheKey, runOf } from './cache'
import type { EngineAsk } from './engine/pipeline'
import { type Ask, JevError } from './jev/client'
import { type Endpoint, endpointOf } from './jev/providers'

export interface DigestDeps {
  /** `touch: false` reads without noting the use (an incognito tab leaves no trace) */
  cache: { get(key: string, options?: { touch?: boolean }): Promise<DigestResult | undefined>; put(key: string, result: DigestResult): Promise<void> }
  /** The key is read here, in the service worker, and nowhere a page can reach (spec §4) */
  credentials: () => Promise<Credentials>
  engine: (paper: Paper, ask: EngineAsk) => Promise<DigestResult>
  client: (endpoint: Endpoint) => Ask
}

interface Flight {
  promise: Promise<DigestReply>
  controller: AbortController
  waiters: Set<number | symbol>
  /** The paper and text it runs for (cache.ts runOf): a tab leaves the runs of the page it left, not every run */
  run: string
}

export function createDigestService(deps: DigestDeps) {
  const flights = new Map<string, Flight>()

  /**
   * An incognito tab (`incognito`) is served from the cache like any other, but nothing it asks is written: not its
   * result, not the time it read one. Its runs are its own, so a normal tab never waits on a result that will not be
   * stored, and an incognito tab never joins a normal tab's run.
   */
  async function request(msg: { paperId: string; title: string; unitsHash: string; units: Unit[] }, tabId?: number, incognito = false): Promise<DigestReply> {
    // The key holds the model asked, so the endpoint is read first — a cached result is served even without a key
    const credentials = await deps.credentials()
    const endpoint = endpointOf(credentials)
    const key = cacheKey(msg.paperId, msg.unitsHash, endpoint.model)
    const hit = await deps.cache.get(key, { touch: !incognito })
    if (hit) return { ok: true, result: hit, cached: true }
    const flightKey = incognito ? `${key}|incognito` : key
    // No await from here to `flights.set`: two requests for one key can never both start a run
    let flight = flights.get(flightKey)
    if (!flight) {
      if (!hasKey(credentials)) return { ok: false, error: 'no-key' }
      const controller = new AbortController()
      const ask = deps.client(endpoint)
      /** The versioned models that answered this run, kept on the result for diagnostics only */
      const served = new Set<string>()
      const promise: Promise<DigestReply> = deps
        .engine({ title: msg.title, units: msg.units }, async (state, questions) => {
          const reply = await ask(state, questions, controller.signal)
          if (reply.model) served.add(reply.model)
          return reply.answers
        })
        .then(async result => {
          const kept: DigestResult = served.size > 0 ? { ...result, model: [...served].join(', ') } : result
          // Best effort: a paid result is delivered even when it cannot be stored (a full disk's QuotaExceededError).
          // Awaited all the same, so the flight ends only once the cache can answer the next request.
          if (!incognito) await deps.cache.put(key, kept).catch(() => {})
          return { ok: true as const, result: kept, cached: false }
        })
        // A JevError keeps its code — an answer missing or of the wrong type is not-jev, from the client or the
        // engine — and anything else is busy. The run has failed as a whole (spec §9: no partial marks), so its
        // requests still in flight are cancelled rather than paid for.
        .catch(error => {
          controller.abort()
          return { ok: false as const, error: error instanceof JevError ? error.code : ('busy' as const) }
        })
        .finally(() => flights.delete(flightKey))
      flight = { promise, controller, waiters: new Set(), run: runOf(msg.paperId, msg.unitsHash) }
      flights.set(flightKey, flight)
    }
    const waiter: number | symbol = tabId ?? Symbol('anonymous')
    flight.waiters.add(waiter)
    try {
      return await flight.promise
    } finally {
      flight.waiters.delete(waiter)
    }
  }

  /**
   * A tab's page has gone (presence.ts: closed, navigated away, or into the back/forward cache): abort every run of
   * `run` — every run, when it is left out — that the tab was the last one waiting on. The run of another paper
   * the same tab has since opened is left alone.
   */
  function leave(tabId: number, run?: string): void {
    for (const flight of flights.values()) {
      if (run !== undefined && flight.run !== run) continue
      if (flight.waiters.delete(tabId) && flight.waiters.size === 0) flight.controller.abort()
    }
  }

  return { request, leave, inFlight: () => flights.size }
}
