// @vitest-environment node
// Parity with the experiment's frozen `final` (spec §11.1, controller ruling 13): the experiment's own cache has
// since had whole-request answers overwritten by later lab re-runs, so `runs/final/*.json` can no longer be
// reproduced from it (proven: the unmodified `variants.frozen.mjs`, replayed on the same cache, diverges from
// `runs/final` on the same 9/12 papers as the port did). The real, still-checkable claim is that the port is
// operation-for-operation identical to the experiment's code: given the same units and the same recorded answers
// (however stale), both must produce exactly the same rankings. This test runs both engines against one replay of
// the cache and compares their outputs directly. Runs only where the experiment's data is on disk; never in CI.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { digest } from '@/background/engine/pipeline'
import type { Answers, Questions } from '@/background/jev/wire'
import type { CaveatType, Role } from '@/shared/result'
import type { Unit } from '@/shared/units'

const DIR = process.env.JEV_EXPERIMENT_DIR ?? join(homedir(), 'Developer/ArxivTranslate/research/key-points')
const present = existsSync(join(DIR, 'runs/final')) && existsSync(join(DIR, 'cache')) && existsSync(join(DIR, 'units'))

/** Answers recorded by the experiment's jev.mjs: file = sha256({ model, state, questions }) truncated to 32 hex digits.
 *  A request the experiment had to split is looked up by halves, as jev.mjs split it. */
function replay(cacheDir: string) {
  const lookup = (state: unknown, questions: Questions): Answers | null => {
    const body = JSON.stringify({ model: 'typesafe-ai/jev', state, questions })
    const file = join(cacheDir, `${createHash('sha256').update(body).digest('hex').slice(0, 32)}.json`)
    if (!existsSync(file)) return null
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { response: { answers: Answers } }
    return cached.response.answers
  }
  const ask = async (state: unknown, questions: Questions): Promise<Answers> => {
    const hit = lookup(state, questions)
    if (hit) return hit
    const keys = Object.keys(questions)
    if (keys.length < 2) throw new Error(`no recorded answer for ${keys[0]}`)
    const half = keys.length >> 1
    const pick = (ks: string[]) => Object.fromEntries(ks.map(k => [k, questions[k]!])) as Questions
    return { ...(await ask(state, pick(keys.slice(0, half)))), ...(await ask(state, pick(keys.slice(half)))) }
  }
  return ask
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

describe.skipIf(!present)('parity with the experiment', () => {
  const corpus: { id: string }[] = present ? (JSON.parse(readFileSync(join(DIR, 'corpus.json'), 'utf8')) as { id: string }[]) : []
  for (const paper of corpus) {
    it(paper.id, async () => {
      const { VARIANTS } = await loadVariants()
      const doc = JSON.parse(readFileSync(join(DIR, 'units', `${paper.id}.json`), 'utf8')) as { title: string; units: Unit[] }
      const cacheDir = join(DIR, 'cache')
      const got = await digest({ title: doc.title, units: doc.units }, replay(cacheDir), { fixes: false })
      const expected = await VARIANTS.final.run(doc, async (state, questions) => ({ answers: await replay(cacheDir)(state, questions) }))

      expect(got.claims.map(shape)).toEqual(expected.claims.map(shape))
      expect(got.caveats).toEqual(expected.caveats.slice(0, 40).map(([s, v, t]) => [s, v, noneToNull(t)]))
    }, 60_000)
  }
})
