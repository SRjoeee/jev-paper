// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runOf } from '@/background/cache'
import { createDigestService } from '@/background/digest'
import { digest } from '@/background/engine/pipeline'
import { type Ask, JevError } from '@/background/jev/client'
import { yesno } from '@/background/jev/wire'
import { type Credentials, DEFAULT_CREDENTIALS } from '@/shared/credentials'
import type { DigestResult } from '@/shared/result'

const RESULT = { claims: [], caveats: [] }
const msg = { paperId: 'p', title: 'T', unitsHash: 'h', units: [] }

function harness(credentials: Partial<Credentials> = { apiKey: 'k' }, fail?: JevError, served: string | null = null) {
  const store = new Map<string, unknown>()
  let current: Credentials = { ...DEFAULT_CREDENTIALS, ...credentials }
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
    return { answers: {}, model: served }
  }
  const service = createDigestService({
    cache: { get: async k => store.get(k) as never, put: async (k, v) => { store.set(k, v) } },
    credentials: async () => current,
    engine: async (_paper, ask) => { runs++; await ask({}, {}); return RESULT },
    client,
  })
  const use = (next: Partial<Credentials>) => { current = { ...DEFAULT_CREDENTIALS, ...next } }
  return { service, store, use, runs: () => runs, release: () => release(), aborted: () => aborted }
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

  it("a tab leaving one paper's run keeps the run of the paper it opened next", async () => {
    const h = harness()
    const a = h.service.request(msg, 1)
    const b = h.service.request({ ...msg, paperId: 'q', unitsHash: 'g' }, 1)
    await new Promise(r => setTimeout(r, 0))
    expect(h.service.inFlight()).toBe(2)
    h.service.leave(1, runOf('q', 'g'))
    expect(await b).toEqual({ ok: false, error: 'aborted' })
    expect(h.service.inFlight()).toBe(1)
    h.release()
    expect((await a).ok).toBe(true)
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

  it('keys the cache by the model asked, so another model never reuses a result', async () => {
    const h = harness()
    h.release()
    await h.service.request(msg, 1)
    expect([...h.store.keys()]).toEqual([expect.stringMatching(/^p\|h\|typesafe\/jev-1\.13-20260917\|/)])
    h.use({ provider: 'typesafe', apiKey: 'k' })
    expect(await h.service.request(msg, 1)).toMatchObject({ cached: false })
    expect(h.runs()).toBe(2)
    h.use({ provider: 'custom', baseUrl: 'https://x.test/v1/systemone', model: 'my-jev', apiKey: 'k' })
    await h.service.request(msg, 1)
    expect(h.runs()).toBe(3)
    expect(await h.service.request(msg, 1)).toMatchObject({ cached: true })
    expect(h.runs()).toBe(3)
  })

  it('serves a cached result without a key', async () => {
    const h = harness()
    h.release()
    await h.service.request(msg, 1)
    h.use({ apiKey: '' })
    expect(await h.service.request(msg, 1)).toEqual({ ok: true, result: RESULT, cached: true })
  })

  it('keeps the model that answered on the result, for diagnostics', async () => {
    const h = harness({ apiKey: 'k' }, undefined, 'typesafe/jev-1.13-20260917')
    h.release()
    expect(await h.service.request(msg, 1)).toEqual({ ok: true, result: { ...RESULT, model: 'typesafe/jev-1.13-20260917' }, cached: false })
  })

  it('reports an incomplete answer as not-jev, not as busy', async () => {
    const units = [
      { sid: 's001', kind: 'abstract' as const, sec: 'abstract', secTitle: 'Abstract', pid: 'a', text: 'We propose X.' },
      { sid: 's002', kind: 'body' as const, sec: 'S1', secTitle: '1 Method', pid: 'p', text: 'X works by Y.' },
    ]
    const service = createDigestService({
      cache: { get: async () => undefined, put: async () => {} },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: digest,
      client: () => async () => ({ answers: {}, model: null }),
    })
    expect(await service.request({ ...msg, units }, 1)).toEqual({ ok: false, error: 'not-jev' })
  })

  it('delivers a paid result even when storing it fails (a full disk)', async () => {
    let runs = 0
    const service = createDigestService({
      cache: {
        get: async () => undefined,
        put: async () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
      },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: async (_paper, ask) => {
        runs++
        await ask({}, {})
        return RESULT
      },
      client: () => async () => ({ answers: {}, model: null }),
    })
    expect(await service.request(msg, 1)).toEqual({ ok: true, result: RESULT, cached: false })
    expect(runs).toBe(1)
    expect(service.inFlight()).toBe(0)
  })

  it('an incognito tab is served from the cache but writes nothing: no result, no read time', async () => {
    const gets: { key: string; touch?: boolean }[] = []
    const puts: string[] = []
    const store = new Map<string, DigestResult>()
    let runs = 0
    const service = createDigestService({
      cache: {
        get: async (key, options) => {
          gets.push({ key, touch: options?.touch })
          return store.get(key)
        },
        put: async (key, value) => {
          puts.push(key)
          store.set(key, value)
        },
      },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: async (_paper, ask) => {
        runs++
        await ask({}, {})
        return RESULT
      },
      client: () => async () => ({ answers: {}, model: null }),
    })
    expect(await service.request(msg, 1, true)).toEqual({ ok: true, result: RESULT, cached: false })
    expect(puts).toEqual([])
    expect(gets.at(-1)?.touch).toBe(false)
    // A normal tab runs it (the incognito run left nothing) and stores it; incognito then reads it without a trace
    await service.request(msg, 2)
    expect(runs).toBe(2)
    expect(puts).toHaveLength(1)
    expect(await service.request(msg, 1, true)).toEqual({ ok: true, result: RESULT, cached: true })
    expect(gets.at(-1)?.touch).toBe(false)
    expect(await service.request(msg, 2)).toMatchObject({ cached: true })
    expect(gets.at(-1)?.touch).toBe(true)
  })

  it('an incognito tab and a normal tab never share a run', async () => {
    const h = harness()
    const a = h.service.request(msg, 1, true)
    const b = h.service.request(msg, 2)
    await new Promise(r => setTimeout(r, 0))
    expect(h.service.inFlight()).toBe(2)
    h.release()
    await Promise.all([a, b])
    expect(h.store.size).toBe(1)
  })

  it('cancels the requests still in flight when one request of the run fails', async () => {
    let cancelled = 0
    const service = createDigestService({
      cache: { get: async () => undefined, put: async () => {} },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: async (_paper, ask) => {
        await Promise.all([ask({}, { fail: yesno('q') }), ask({}, { slow: yesno('q') })])
        return RESULT
      },
      client: () => async (_s, questions, signal) => {
        if ('fail' in questions) throw new JevError('busy', '503')
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => {
            cancelled++
            reject(new JevError('aborted', 'aborted'))
          }),
        )
      },
    })
    expect(await service.request(msg, 1)).toEqual({ ok: false, error: 'busy' })
    expect(cancelled).toBe(1)
  })

  it('reports any other failure of the engine as busy', async () => {
    const service = createDigestService({
      cache: { get: async () => undefined, put: async () => {} },
      credentials: async () => ({ ...DEFAULT_CREDENTIALS, apiKey: 'k' }),
      engine: async () => {
        throw new TypeError('boom')
      },
      client: () => async () => ({ answers: {}, model: null }),
    })
    expect(await service.request(msg, 1)).toEqual({ ok: false, error: 'busy' })
  })
})
