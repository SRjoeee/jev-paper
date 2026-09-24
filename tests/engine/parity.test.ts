// @vitest-environment node
// Parity with the experiment's frozen `final` (spec §11.1): the same units and the recorded Jev answers must give
// exactly the same rankings. Runs only where the experiment's data is on disk; never in CI.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digest } from '@/background/engine/pipeline'
import type { Answers, Questions } from '@/background/jev/wire'

const DIR = process.env.JEV_EXPERIMENT_DIR ?? join(homedir(), 'Developer/ArxivTranslate/research/key-points')
const present = existsSync(join(DIR, 'runs/final')) && existsSync(join(DIR, 'cache')) && existsSync(join(DIR, 'units'))

/** Answers recorded by the experiment's jev.mjs: file = sha256({ model, state, questions }) truncated to 32 hex digits.
 *  A request the experiment had to split is looked up by halves, as jev.mjs split it. */
function replay(cacheDir: string) {
  const lookup = (state: unknown, questions: Questions): Answers | null => {
    const body = JSON.stringify({ model: 'typesafe-ai/jev', state, questions })
    const file = join(cacheDir, `${createHash('sha256').update(body).digest('hex').slice(0, 32)}.json`)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).response.answers : null
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

describe.skipIf(!present)('parity with the experiment', () => {
  const corpus: { id: string }[] = present ? JSON.parse(readFileSync(join(DIR, 'corpus.json'), 'utf8')) : []
  for (const paper of corpus) {
    it(paper.id, async () => {
      const doc = JSON.parse(readFileSync(join(DIR, 'units', `${paper.id}.json`), 'utf8'))
      const expected = JSON.parse(readFileSync(join(DIR, 'runs/final', `${paper.id}.json`), 'utf8'))
      const got = await digest({ title: doc.title, units: doc.units }, replay(join(DIR, 'cache')), { fixes: false })
      const shape = (c: any) => ({ sid: c.sid, pClaim: c.pClaim, role: c.role, ranked: c.ranked.slice(0, 8) })
      expect(got.claims.map(shape)).toEqual(expected.claims.map(shape))
      expect(got.caveats).toEqual(expected.caveats.slice(0, 40).map(([s, v, t]: [string, number, string | null]) => [s, v, t === 'none' ? null : t]))
    }, 60_000)
  }
})
