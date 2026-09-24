// @vitest-environment node
// Parity with the experiment's frozen `final` (spec §11.1, controller ruling 13): the experiment's own cache has
// since had whole-request answers overwritten by later lab re-runs, so `runs/final/*.json` can no longer be
// reproduced from it (proven: the unmodified `variants.frozen.mjs`, replayed on the same cache, diverges from
// `runs/final` on the same 9/12 papers as the port did). The real, still-checkable claim is that the port is
// operation-for-operation identical to the experiment's code: given the same units and the same recorded answers
// (however stale), both must produce exactly the same rankings. This test runs both engines against one replay of
// the cache and compares their outputs directly. Runs only where the experiment's data is on disk; never in CI.
//
// The replay answers per question (2026-09-25): the experiment sends round two in parts of 55 questions, the port
// in parts of 110, so their requests no longer match. Every recorded request is indexed question by question, by
// a hash of its state, the question's id and the question, and any request of any size is answered from that
// index one question at a time. Both engines therefore draw the same answer for the same question, and a question
// the index does not hold (a changed wording, state or id) fails the paper.
//
// The record holds some questions more than once with different answers: other variants asked the same question
// in the same state inside other requests (v7's evidence windows carry 39 more questions than `final`'s), and lab
// re-runs overwrote whole requests. Where it does, the answer `final` itself consumed wins: `final` is replayed
// once by request hash, as this test did before, and the answers it drew are preferred. A question with several
// answers and no preferred one fails the paper; no answer is ever picked arbitrarily.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { digest } from '@/background/engine/pipeline'
import type { Answer, Answers, Question, Questions } from '@/background/jev/wire'
import type { CaveatType, Role } from '@/shared/result'
import type { Unit } from '@/shared/units'

const DIR = process.env.JEV_EXPERIMENT_DIR ?? join(homedir(), 'Developer/ArxivTranslate/research/key-points')
const present = existsSync(join(DIR, 'runs/final')) && existsSync(join(DIR, 'cache')) && existsSync(join(DIR, 'units'))

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const stateKey = (state: unknown): string => sha(JSON.stringify(state))
/** One question in one state: what the index is keyed by. The id is included, so both engines must also name
 *  every question as the experiment did. */
const questionKey = (state: string, id: string, question: Question): string => sha(`${state}\n${id}\n${JSON.stringify(question)}`)

interface Index {
  /** Every distinct answer recorded for a question, in file-name order */
  answers: Map<string, Answer[]>
  requests: number
  /** Questions recorded with more than one distinct answer */
  ambiguous: number
}

/** Every answer in the experiment's cache (files written by its jev.mjs: `{ request: { model, state, questions },
 *  response: { answers } }`, split halves included), indexed per question. Built once, lazily. */
let index: Index | null = null
function indexOf(cacheDir: string): Index {
  if (index) return index
  const answers = new Map<string, Answer[]>()
  let requests = 0
  for (const file of readdirSync(cacheDir).filter(f => f.endsWith('.json')).sort()) {
    const { request, response } = JSON.parse(readFileSync(join(cacheDir, file), 'utf8')) as { request: { state: unknown; questions: Questions }; response: { answers: Answers } }
    requests++
    const state = stateKey(request.state)
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = response.answers[id]
      if (!answer) throw new Error(`${file}: no recorded answer for ${id}`)
      const key = questionKey(state, id, question)
      const seen = answers.get(key) ?? []
      if (!seen.some(a => JSON.stringify(a) === JSON.stringify(answer))) seen.push(answer)
      answers.set(key, seen)
    }
  }
  index = { answers, requests, ambiguous: [...answers.values()].filter(a => a.length > 1).length }
  return index
}

/** The experiment's jev.mjs cache file for a whole request: sha256({ model, state, questions }), 32 hex digits */
const requestFile = (cacheDir: string, state: unknown, questions: Questions): string =>
  join(cacheDir, `${sha(JSON.stringify({ model: 'typesafe-ai/jev', state, questions })).slice(0, 32)}.json`)

/** The replay this test used before 2026-09-25: whole requests by hash, a request the experiment had to split
 *  looked up by halves as jev.mjs split it. Every answer it serves is recorded in `drawn`, by question. */
function byRequest(cacheDir: string, drawn: Map<string, Answer>) {
  const ask = async (state: unknown, questions: Questions): Promise<Answers> => {
    const file = requestFile(cacheDir, state, questions)
    if (existsSync(file)) {
      const answers = (JSON.parse(readFileSync(file, 'utf8')) as { response: { answers: Answers } }).response.answers
      const s = stateKey(state)
      for (const [id, question] of Object.entries(questions)) drawn.set(questionKey(s, id, question), answers[id]!)
      return answers
    }
    const keys = Object.keys(questions)
    if (keys.length < 2) throw new Error(`no recorded request for ${keys[0]}`)
    const half = keys.length >> 1
    const pick = (ks: string[]) => Object.fromEntries(ks.map(k => [k, questions[k]!])) as Questions
    return { ...(await ask(state, pick(keys.slice(0, half)))), ...(await ask(state, pick(keys.slice(half)))) }
  }
  return ask
}

interface Asked {
  /** Every question asked, as its index key */
  keys: string[]
  /** Question count of each round-two request (the state with `candidates`) */
  roundTwo: number[]
}

/** An ask that answers each question of a request from the index — the preferred answer where the record holds
 *  several — and records what it was asked */
function replay(ix: Index, preferred: Map<string, Answer>, asked: Asked) {
  return async (state: unknown, questions: Questions): Promise<Answers> => {
    const s = stateKey(state)
    const out: Answers = {}
    for (const [id, question] of Object.entries(questions)) {
      const key = questionKey(s, id, question)
      const recorded = ix.answers.get(key)
      if (!recorded) throw new Error(`no recorded answer for ${id}`)
      const answer = recorded.length === 1 ? recorded[0] : preferred.get(key)
      if (!answer) throw new Error(`${recorded.length} recorded answers for ${id} and none preferred`)
      asked.keys.push(key)
      out[id] = structuredClone(answer)
    }
    if (typeof state === 'object' && state !== null && 'candidates' in state) asked.roundTwo.push(Object.keys(questions).length)
    return out
  }
}

interface ExperimentClaim {
  sid: string
  pClaim: number
  role: string | null
  ranked: [string, number][]
}
type ExperimentCaveat = [sid: string, score: number, type: string | null]
interface ExperimentResult {
  claims: ExperimentClaim[]
  caveats: ExperimentCaveat[]
}
type ExperimentAsk = (state: unknown, questions: Questions) => Promise<{ answers: Answers }>
interface ExperimentModule {
  VARIANTS: { final: { run: (doc: { title: string; units: Unit[] }, ask: ExperimentAsk) => Promise<ExperimentResult> } }
}

/** The experiment's own frozen pipeline, imported dynamically so a missing `JEV_EXPERIMENT_DIR` only skips this
 *  suite; `variants.frozen.mjs` and its `jev.mjs` import are pure module definitions (verified by reading both) —
 *  importing them makes no network call and writes no file. */
let variantsModule: Promise<ExperimentModule> | null = null
function loadVariants(): Promise<ExperimentModule> {
  variantsModule ??= import(/* @vite-ignore */ pathToFileURL(join(DIR, 'variants.frozen.mjs')).href) as Promise<ExperimentModule>
  return variantsModule
}

interface ClaimShape {
  sid: string
  pClaim: number
  role: string | null
  ranked: [string, number][]
}
const shape = (c: { sid: string; pClaim: number; role: Role | string | null; ranked: [string, number][] }): ClaimShape => ({
  sid: c.sid,
  pClaim: c.pClaim,
  role: c.role,
  ranked: c.ranked.slice(0, 8),
})
const noneToNull = (t: string | null): CaveatType | null => (t === 'none' || t === null ? null : (t as CaveatType))
const count = (xs: string[]): Map<string, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())

/** Across the corpus, for the checks that the replay exercised what it claims to */
const corpusWide = { papers: 0, roundTwoOver55: 0 }

describe.skipIf(!present)('parity with the experiment', () => {
  const corpus: { id: string }[] = present ? (JSON.parse(readFileSync(join(DIR, 'corpus.json'), 'utf8')) as { id: string }[]) : []
  for (const paper of corpus) {
    it(paper.id, async () => {
      const { VARIANTS } = await loadVariants()
      const cacheDir = join(DIR, 'cache')
      const ix = indexOf(cacheDir)
      const doc = JSON.parse(readFileSync(join(DIR, 'units', `${paper.id}.json`), 'utf8')) as { title: string; units: Unit[] }
      // The answers `final` itself draws, replayed by request hash: preferred where the record holds several
      const preferred = new Map<string, Answer>()
      const byRequestAsk = byRequest(cacheDir, preferred)
      const reference = await VARIANTS.final.run(doc, async (state, questions) => ({ answers: await byRequestAsk(state, questions) }))

      const port: Asked = { keys: [], roundTwo: [] }
      const experiment: Asked = { keys: [], roundTwo: [] }
      const got = await digest({ title: doc.title, units: doc.units }, replay(ix, preferred, port), { fixes: false })
      const ask = replay(ix, preferred, experiment)
      const expected = await VARIANTS.final.run(doc, async (state, questions) => ({ answers: await ask(state, questions) }))

      // The per-question replay feeds the experiment exactly what the request replay did
      expect(expected).toEqual(reference)
      expect(got.claims.map(shape)).toEqual(expected.claims.map(shape))
      expect(got.caveats).toEqual(expected.caveats.slice(0, 40).map(([s, v, t]) => [s, v, noneToNull(t)]))

      // Not vacuous: both engines asked the very same questions, every one answered from the record, and round two
      // went out in each engine's own part size — ⌈n/55⌉ requests for the experiment, ⌈n/110⌉ for the port
      expect(port.keys.length).toBeGreaterThan(0)
      expect(count(port.keys)).toEqual(count(experiment.keys))
      const n = port.roundTwo.reduce((a, b) => a + b, 0)
      expect(n).toBeGreaterThan(0)
      expect(experiment.roundTwo.reduce((a, b) => a + b, 0)).toBe(n)
      expect(experiment.roundTwo).toHaveLength(Math.ceil(n / 55))
      expect(port.roundTwo).toHaveLength(Math.ceil(n / 110))
      expect(Math.max(...experiment.roundTwo)).toBeLessThanOrEqual(55)
      expect(Math.max(...port.roundTwo)).toBeLessThanOrEqual(110)
      corpusWide.papers++
      if (Math.max(...port.roundTwo) > 55) corpusWide.roundTwoOver55++
    }, 60_000)
  }

  it('replayed the whole corpus, with round-two parts larger than the experiment could send', () => {
    const ix = indexOf(join(DIR, 'cache'))
    expect(ix.requests).toBeGreaterThan(0)
    expect(ix.answers.size).toBeGreaterThan(0)
    expect(corpusWide.papers).toBe(corpus.length)
    expect(corpusWide.roundTwoOver55).toBeGreaterThan(0)
  })
})
