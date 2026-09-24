// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createClient, JevError } from '@/background/jev/client'
import { choice, yesno } from '@/background/jev/wire'

const endpoint = { url: 'https://jev.test/v1/systemone', model: 'jev-latest', apiKey: 'k' }
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
/** Answers every question: yes/no at 0.7, a choice for its first option */
const answering = (body: { questions: Record<string, { type: string; criteria?: Record<string, unknown> }> }) =>
  Object.fromEntries(Object.entries(body.questions).map(([k, q]) => {
    if (q.type === 'noul') return [k, { type: 'noul', noul: 0.7 }]
    const first = Object.keys(q.criteria ?? {})[0]!
    return [k, { type: 'choice', choice: first, probabilities: { [first]: 1 } }]
  }))
const noSleep = { sleep: async () => {}, random: () => 0.5 }

describe('createClient', () => {
  it('sends the official spelling with the key and model, and reads answers back', async () => {
    let seen: { headers: Headers; body: any } | undefined
    const ask = createClient(endpoint, { ...noSleep, fetch: async (_url, init) => {
      seen = { headers: new Headers(init!.headers), body: JSON.parse(init!.body as string) }
      return json(200, { answers: answering(seen.body), usage: { input_tokens: 10 } })
    } })
    const answers = await ask({ text: 'x' }, { a: yesno('Is it?'), b: choice('Which?', { s1: null, s2: null }) })
    expect(seen!.headers.get('authorization')).toBe('Bearer k')
    expect(seen!.body.model).toBe('jev-latest')
    expect(seen!.body.questions.a).toEqual({ type: 'noul', instructions: 'Is it?' })
    expect(answers.a).toEqual({ type: 'boolean', probability: 0.7 })
    expect(answers.b).toMatchObject({ type: 'choice', choice: 's1' })
  })

  it('waits for retry-after on 429, then succeeds', async () => {
    const waits: number[] = []
    let calls = 0
    const ask = createClient(endpoint, { random: () => 0.5, sleep: async ms => { waits.push(ms) }, fetch: async (_u, init) => {
      calls++
      return calls === 1 ? json(429, 'slow down', { 'retry-after': '2' }) : json(200, { answers: answering(JSON.parse(init!.body as string)) })
    } })
    await ask({}, { a: yesno('q') })
    expect(waits).toEqual([2000])
  })

  it('splits a request that draws 503 twice and merges the halves', async () => {
    const sizes: number[] = []
    const ask = createClient(endpoint, { ...noSleep, fetch: async (_u, init) => {
      const body = JSON.parse(init!.body as string)
      const n = Object.keys(body.questions).length
      sizes.push(n)
      return n > 2 ? json(503, 'overloaded') : json(200, { answers: answering(body) })
    } })
    const answers = await ask({}, { a: yesno('1'), b: yesno('2'), c: yesno('3'), d: yesno('4') })
    expect(Object.keys(answers).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(sizes).toEqual([4, 4, 2, 2])
  })

  it('does not retry 401 and reports an invalid key', async () => {
    let calls = 0
    const ask = createClient(endpoint, { ...noSleep, fetch: async () => { calls++; return json(401, 'no') } })
    await expect(ask({}, { a: yesno('q') })).rejects.toMatchObject({ code: 'invalid-key' })
    expect(calls).toBe(1)
  })

  it('reports used-up credit on a 403 that mentions a limit', async () => {
    const ask = createClient(endpoint, { ...noSleep, fetch: async () => json(403, { error: { message: 'Key limit exceeded (total limit).' } }) })
    await expect(ask({}, { a: yesno('q') })).rejects.toMatchObject({ code: 'credit' })
  })

  it('gives up as offline after six network failures', async () => {
    let calls = 0
    const ask = createClient(endpoint, { ...noSleep, fetch: async () => { calls++; throw new TypeError('fetch failed') } })
    await expect(ask({}, { a: yesno('q') })).rejects.toMatchObject({ code: 'offline' })
    expect(calls).toBe(6)
  })

  it('gives up as busy after six 500s', async () => {
    const ask = createClient(endpoint, { ...noSleep, fetch: async () => json(500, 'boom') })
    await expect(ask({}, { a: yesno('q') })).rejects.toMatchObject({ code: 'busy' })
  })

  it('calls an endpoint that answers but not as Jev not-jev', async () => {
    const ask = createClient(endpoint, { ...noSleep, fetch: async () => json(200, { choices: [] }) })
    await expect(ask({}, { a: yesno('q') })).rejects.toMatchObject({ code: 'not-jev' })
    const ask404 = createClient(endpoint, { ...noSleep, fetch: async () => json(404, 'no route') })
    await expect(ask404({}, { a: yesno('q') })).rejects.toBeInstanceOf(JevError)
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    const ask = createClient(endpoint, { ...noSleep, fetch: async (_u, init) => {
      controller.abort()
      throw init!.signal!.reason ?? new DOMException('aborted', 'AbortError')
    } })
    await expect(ask({}, { a: yesno('q') }, controller.signal)).rejects.toMatchObject({ code: 'aborted' })
  })

  it('never has more requests in flight than the limit', async () => {
    let live = 0
    let peak = 0
    const ask = createClient(endpoint, { ...noSleep, maxInFlight: 2, fetch: async (_u, init) => {
      live++
      peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
      return json(200, { answers: answering(JSON.parse(init!.body as string)) })
    } })
    await Promise.all(Array.from({ length: 6 }, () => ask({}, { a: yesno('q') })))
    expect(peak).toBe(2)
  })
})
