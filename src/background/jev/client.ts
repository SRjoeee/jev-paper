import type { ErrorCode } from '@/shared/errors'
import type { Endpoint } from './providers'
import { type Answers, fromWire, type Questions, toWire } from './wire'

export class JevError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'JevError'
  }
}

/** Thrown inside the client when a request should be halved (503 twice); never escapes it */
class Split extends Error {}

/** What one request brings back */
export interface JevReply {
  answers: Answers
  /** The versioned model that answered, as the response's `model` field names it; null when it names none */
  model: string | null
}

export type Ask = (state: unknown, questions: Questions, signal?: AbortSignal) => Promise<JevReply>

export interface ClientOptions {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Requests in flight at once (spec §6.1: 32 per paper) */
  maxInFlight?: number
  timeoutMs?: number
  maxAttempts?: number
}

const CREDIT = /limit|credit|quota|balance|insufficient/i

/** A client serves one digest (digest.ts makes one per run), so the fallback it switches to lasts that digest. */
export function createClient(endpoint: Endpoint, options: ClientOptions = {}): Ask {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const random = options.random ?? Math.random
  const limit = options.maxInFlight ?? 32
  const timeoutMs = options.timeoutMs ?? 20_000
  const maxAttempts = options.maxAttempts ?? 6

  let active = 0
  const waiting: (() => void)[] = []
  const acquire = () => new Promise<void>(resolve => {
    if (active < limit) {
      active++
      resolve()
    } else waiting.push(resolve)
  })
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  /** The model asked: the endpoint's until it is rejected as unknown, then its fallback for the rest of this client */
  let model = endpoint.model
  /** spec §6.1: a 404, or a 400 whose body names the model (OpenRouter's exact reply could not be seen: no key).
   *  422 is TypeSafe's documented status for a request that fails validation; it is taken the same way. */
  const unknownModel = (status: number, text: string, asked: string): boolean =>
    status === 404 || ((status === 400 || status === 422) && (/model/i.test(text) || text.includes(asked)))

  async function once(state: unknown, questions: Questions, signal?: AbortSignal): Promise<JevReply> {
    const wire = toWire(questions)
    let asked = model
    let body = JSON.stringify({ model: asked, state, questions: wire })
    /** The previous attempt's status, to tell a lone 503 (retry) from two in a row (spec §6.1: split) */
    let prevStatus = 0
    let attempt = 0
    for (;;) {
      if (signal?.aborted) throw new JevError('aborted', 'aborted')
      let status = 0
      let text = ''
      let retryAfter = 0
      await acquire()
      try {
        const timeout = AbortSignal.timeout(timeoutMs)
        const res = await doFetch(endpoint.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${endpoint.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
        status = res.status
        retryAfter = Number(res.headers.get('retry-after')) || 0
        text = await res.text()
      } catch (error) {
        if (signal?.aborted) throw new JevError('aborted', 'aborted')
        text = String(error)
      } finally {
        release()
      }
      if (status === 200) {
        let json: { model?: unknown; answers?: unknown } | null = null
        try {
          json = JSON.parse(text)
        } catch {}
        if (!json || typeof json.answers !== 'object' || json.answers === null) throw new JevError('not-jev', 'the response holds no answers')
        return { answers: fromWire(json.answers as Record<string, unknown>), model: typeof json.model === 'string' ? json.model : null }
      }
      if (status === 401) throw new JevError('invalid-key', text.slice(0, 300))
      if (status === 403) throw new JevError(CREDIT.test(text) ? 'credit' : 'invalid-key', text.slice(0, 300))
      // The pinned model rejected as unknown: the same request once more with the fallback, which every later request
      // of this client asks from the start. Not counted as an attempt; a second rejection falls through to not-jev.
      if (endpoint.fallback && asked !== endpoint.fallback && unknownModel(status, text, asked)) {
        model = endpoint.fallback
        asked = model
        body = JSON.stringify({ model: asked, state, questions: wire })
        prevStatus = 0
        continue
      }
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500
      if (!retryable) throw new JevError('not-jev', `${status} ${text.slice(0, 300)}`)
      // spec §6.1: "a request that draws 503 twice is split" — two 503s *in a row*, not a 503 anywhere in the history
      // (a 500 → 503 sequence keeps retrying at the same size)
      if (status === 503 && prevStatus === 503 && Object.keys(questions).length > 1) throw new Split()
      if (attempt + 1 >= maxAttempts) throw new JevError(status === 0 ? 'offline' : 'busy', `${status} ${text.slice(0, 300)}`)
      await sleep(status === 429 && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt) * (0.7 + random() * 0.6))
      prevStatus = status
      attempt++
    }
  }

  const ask: Ask = async (state, questions, signal) => {
    try {
      return await once(state, questions, signal)
    } catch (error) {
      if (!(error instanceof Split)) throw error
      // Questions are answered independently, so halves answer the same as the whole (measured on the experiment)
      const keys = Object.keys(questions)
      const half = keys.length >> 1
      const pick = (ks: string[]) => Object.fromEntries(ks.map(k => [k, questions[k]!])) as Questions
      const [a, b] = await Promise.all([ask(state, pick(keys.slice(0, half)), signal), ask(state, pick(keys.slice(half)), signal)])
      return { answers: { ...a.answers, ...b.answers }, model: a.model ?? b.model }
    }
  }
  return ask
}
