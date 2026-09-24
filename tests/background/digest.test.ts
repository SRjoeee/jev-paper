// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDigestService } from '@/background/digest'
import { type Ask, JevError } from '@/background/jev/client'
import { type Credentials, DEFAULT_CREDENTIALS } from '@/shared/credentials'

const RESULT = { claims: [], caveats: [] }
const msg = { paperId: 'p', title: 'T', unitsHash: 'h', units: [] }

function harness(credentials: Partial<Credentials> = { apiKey: 'k' }, fail?: JevError) {
  const store = new Map<string, unknown>()
  let runs = 0
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let aborted = false
  const client = (): Ask => async (_s, _q, signal) => {
    await new Promise<void>((resolve, reject) => {
      gate.then(resolve)
      signal?.addEventListener('abort', () => { aborted = true; reject(new JevError('aborted', 'aborted')) })
    })
    if (fail) throw fail
    return {}
  }
  const service = createDigestService({
    cache: { get: async k => store.get(k) as never, put: async (k, v) => { store.set(k, v) } },
    credentials: async () => ({ ...DEFAULT_CREDENTIALS, ...credentials }),
    engine: async (_paper, ask) => { runs++; await ask({}, {}); return RESULT },
    client,
  })
  return { service, store, runs: () => runs, release: () => release(), aborted: () => aborted }
}

describe('createDigestService', () => {
  it('returns no-key without running the engine', async () => {
    const h = harness({ apiKey: '' })
    expect(await h.service.request(msg, 1)).toEqual({ ok: false, error: 'no-key' })
    expect(h.runs()).toBe(0)
  })

  it('runs once for two tabs asking at once, then answers from the cache', async () => {
    const h = harness()
    const a = h.service.request(msg, 1)
    const b = h.service.request(msg, 2)
    await new Promise(r => setTimeout(r, 0))
    h.release()
    expect(await a).toEqual({ ok: true, result: RESULT, cached: false })
    expect(await b).toEqual({ ok: true, result: RESULT, cached: false })
    expect(h.runs()).toBe(1)
    expect(await h.service.request(msg, 3)).toEqual({ ok: true, result: RESULT, cached: true })
    expect(h.runs()).toBe(1)
    expect(h.service.inFlight()).toBe(0)
  })

  it('a tab leaving does not abort a run another tab still waits on', async () => {
    const h = harness()
    const a = h.service.request(msg, 1)
    const b = h.service.request(msg, 2)
    await new Promise(r => setTimeout(r, 0))
    h.service.leave(1)
    expect(h.aborted()).toBe(false)
    h.release()
    expect((await b).ok).toBe(true)
    await a
  })

  it('the last waiting tab leaving aborts the run', async () => {
    const h = harness()
    const a = h.service.request(msg, 1)
    await new Promise(r => setTimeout(r, 0))
    h.service.leave(1)
    expect(h.aborted()).toBe(true)
    expect(await a).toEqual({ ok: false, error: 'aborted' })
    expect(h.service.inFlight()).toBe(0)
  })

  it('reports the client error and runs again on the next request', async () => {
    const h = harness({ apiKey: 'k' }, new JevError('credit', 'limit'))
    const a = h.service.request(msg, 1)
    await new Promise(r => setTimeout(r, 0))
    h.release()
    expect(await a).toEqual({ ok: false, error: 'credit' })
    const b = h.service.request(msg, 1)
    await b
    expect(h.runs()).toBe(2)
  })
})
