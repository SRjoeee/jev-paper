// The experiment's frozen `final` pipeline (variants.frozen.mjs: makeV6 with evidenceWeight5, caveatWeight,
// round2Max 55), ported operation for operation, with round two sent in parts of 110 — the parity test replays its
// recorded answers per question, by a hash of the state and the question, so every state and question object must
// serialise exactly as the experiment's. `fixes` adds spec §6.2's two general fixes.
import { CLAIM_THRESHOLD } from '@/shared/levels'
import type { CaveatType, ClaimRole, DigestResult } from '@/shared/result'
import type { Paper, Unit } from '@/shared/units'
import { JevError } from '../jev/client'
import type { Answer, Answers, Questions } from '../jev/wire'
import * as Q from './questions'
import { abstractOf, caveatWeight, evidenceWeight, isAppendix, poolable, sectionPolicies, type Window, windows } from './sections'

export type EngineAsk = (state: unknown, questions: Questions) => Promise<Answers>
/** Neither option is for the product, which always runs with the defaults */
export interface EngineOptions {
  /** Test only: false turns off spec §6.2's two fixes, so the parity test can run the experiment's `final` */
  fixes?: boolean
  /** Eval only (eval/regress.test.ts): keep every ranked sentence and every caveat instead of the top 8 / top 40 */
  full?: boolean
}

// Each constant names its source: a section of eval/LOG.md, or the review of 2026-09-25 ("measured 2026-09-25").
/** Sentences per evidence window: the experiment's (LOG.md "v7 / v8": 60-sentence windows did no better) */
const WINDOW = 180
/** Sentences per caveat request: LOG.md "v1"; a 40-sentence passage beats section context ("v7 / v8") */
const CAVEAT_CHUNK = 40
/** Round one's ranking kept per claim, from which the pool is drawn: the experiment's `rank` (no LOG.md figure) */
const RANK_TOP = 10
/** A claim's pool for the pick: LOG.md "v5" (the top 8 hold a good sentence for 93 % of claims); a pool of 5
 *  loses 4.8 hit@1 (measured 2026-09-25) */
const POOL_TOP = 8
/** Pool sentences verified: the experiment's v5–v6 code (no LOG.md figure); at or near best
 *  (measured 2026-09-25) */
const VERIFY_TOP = 5
/** Caveat candidates for round two: LOG.md "v4"; 40 gives AP 51.7 and 100 gives 51.1, against 52.5
 *  (measured 2026-09-25) */
const CAVEAT_TOP = 70
/** Round two's part size. The experiment's 55 came from the Vercel gateway's 503s on larger requests (LOG.md
 *  "v9 / v10"); on OpenRouter, 110 measured −2 requests and −4.9 % tokens per paper at the same quality and
 *  latency, and 194 questions in one request succeeded 12/12 (measured 2026-09-25). The experiment keeps its 55:
 *  the parity test replays per question. */
const ROUND2_MAX = 110
/** The output's top 8 ranked per claim and top 40 caveats (spec §6.2); the levels show at most 3 and 20 */
const OUT_RANKED = 8
const OUT_CAVEATS = 40
/** The pick's floor, so a sentence the pick gives 0 still orders by verification: LOG.md "v6" (the untuned default
 *  kept); 0 changes no ranking (measured 2026-09-25) */
const PICK_FLOOR = 0.02
/** A caption's weight as evidence: LOG.md "v6" ("captions × 0.6"); at 1 the change is within noise
 *  (measured 2026-09-25) */
const CAPTION = 0.6
/** A caveat left out of round two keeps its detection score × 0.05, so it sorts after the candidates: the
 *  experiment's v4–v6 code (no LOG.md figure); cosmetic (measured 2026-09-25) */
const NON_CANDIDATE = 0.05
/** The caveat logistic: the weights of LOG.md "v4"'s leave-one-paper-out fit, with its "about the main method"
 *  and importance features dropped. The intercept is in no LOG.md section; it changes no ranking (the logistic is
 *  monotone in its linear predictor), and a refit does not beat these weights (measured 2026-09-25). */
const CAVEAT_FIT = { det: 1.69, appendix: -1.55, qualifies: 0.89, weaker: 1.4, intercept: -2.15 }

// The share of the non-background probability a claim's top role needs to be shown; below it the tip says 「主张」.
// Chosen on dev in the 2026-09-25 review: the roles shown were right 94 % (dev) and 96 % (test) of the time, against
// 79 % and 84 % ungated, with about 20 % of claims falling back.
export const ROLE_CONFIDENCE = 0.7
const CLAIM_ROLES: readonly ClaimRole[] = ['method', 'result', 'contribution']

/** A claim's roles from its role answer. `top`, the argmax over the non-background roles, words the pick, so a kept
 *  claim is never worded as background. `shown` is `top` when its share of the non-background probability reaches
 *  ROLE_CONFIDENCE, and null otherwise. */
export function roleOf(probabilities: Record<string, number>): { top: ClaimRole; shown: ClaimRole | null } {
  let top = CLAIM_ROLES[0]!
  let total = 0
  for (const role of CLAIM_ROLES) {
    const p = probabilities[role] ?? 0
    total += p
    if (p > (probabilities[top] ?? 0)) top = role
  }
  return { top, shown: total > 0 && (probabilities[top] ?? 0) / total >= ROLE_CONFIDENCE ? top : null }
}

type ChoiceAnswer = Extract<Answer, { type: 'choice' }>
// The client checks every answer against its question (client.ts); a missing one here is not Jev's either
const missing = (key: string) => new JevError('not-jev', `no answer for ${key}`)
const noul = (answers: Answers, key: string): number => {
  const a = answers[key]
  if (a?.type !== 'boolean') throw missing(key)
  return a.probability
}
const chosen = (answers: Answers, key: string): ChoiceAnswer => {
  const a = answers[key]
  if (a?.type !== 'choice') throw missing(key)
  return a
}
const rank = (scores: Record<string, number>, n = RANK_TOP): [string, number][] => Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n)
const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

function evidenceQuestions(abs: Unit[], w: Window): Questions {
  const q: Questions = {}
  const ids = Object.fromEntries(w.units.map(u => [u.sid, null])) as Record<string, null>
  for (const a of abs) {
    q[`ev_${a.sid}`] = Q.evidenceQuestion(a.sid, ids)
    q[`ex_${a.sid}`] = Q.existsQuestion(a.sid)
  }
  return q
}

export async function digest(paper: Paper, ask: EngineAsk, options: EngineOptions = {}): Promise<DigestResult> {
  const fixes = options.fixes ?? true
  const abs = abstractOf(paper.units)
  if (abs.length === 0) return { claims: [], caveats: [] }
  const absState = Object.fromEntries(abs.map(a => [a.sid, a.text]))
  const wins = windows(paper.units, fixes, WINDOW)
  const policy = sectionPolicies(fixes)

  // ---- round one: roles; per window, evidence Choice + exists; per 40-sentence chunk, the caveat kind ----
  const roleQ = Object.fromEntries(abs.map(a => [`role_${a.sid}`, Q.roleQuestion(a.sid)])) as Questions
  const cvChunks = wins.flatMap(w => chunks(w.units, CAVEAT_CHUNK).map(c => ({ w, c })))
  const [roleRes, ...rest] = await Promise.all([
    ask({ abstract: absState }, roleQ),
    ...wins.map(w => ask({ abstract: absState, section: { title: w.title, sentences: Object.fromEntries(w.units.map(u => [u.sid, u.text])) } }, evidenceQuestions(abs, w))),
    ...cvChunks.map(({ w, c }) =>
      ask(
        { paper: { title: paper.title, abstract: abs.map(a => a.text).join(' ') }, section: w.title, passage: Object.fromEntries(c.map(u => [u.sid, u.text])) },
        Object.fromEntries(c.map(u => [`cv_${u.sid}`, Q.caveatQuestion(u.sid)])) as Questions,
      ),
    ),
  ])
  const winRes = rest.slice(0, wins.length)
  const cvRes = rest.slice(wins.length)

  const evWeights = wins.map(w => evidenceWeight(policy(w.title, w.sec)))
  const claims = abs.map(a => {
    const r = chosen(roleRes!, `role_${a.sid}`)
    const scores: Record<string, number> = {}
    wins.forEach((_, i) => {
      const ev = chosen(winRes[i]!, `ev_${a.sid}`)
      const ex = noul(winRes[i]!, `ex_${a.sid}`)
      for (const [sid, p] of Object.entries(ev.probabilities)) scores[sid] = p * ex * evWeights[i]!
    })
    return { sid: a.sid, pClaim: 1 - (r.probabilities.background ?? 0), ...roleOf(r.probabilities), ranked: rank(scores) }
  })

  let caveats: [string, number, string][] = []
  cvChunks.forEach(({ w, c }, i) => {
    const weight = caveatWeight(policy(w.title, w.sec))
    for (const u of c) {
      const a = chosen(cvRes[i]!, `cv_${u.sid}`)
      caveats.push([u.sid, (1 - (a.probabilities.none ?? 0)) * weight, a.choice])
    }
  })
  caveats.sort((a, b) => b[1] - a[1])

  // ---- round two: a role-aware pick over each claim's pool, verification, and two caveat questions ----
  const unit = new Map(paper.units.map(u => [u.sid, u]))
  const text = (s: string) => `[${unit.get(s)!.secTitle}] ${unit.get(s)!.text}`
  const claimSet = claims.filter(c => c.pClaim >= CLAIM_THRESHOLD)
  const pool = new Map(
    claimSet.map(c => {
      const keep = c.ranked.filter(x => poolable(policy(unit.get(x[0])!.secTitle, unit.get(x[0])!.sec))).map(x => x[0])
      const ids = keep.length >= 3 ? keep : c.ranked.map(x => x[0])
      return [c.sid, ids.slice(0, POOL_TOP)] as const
    }),
  )
  // A claim with an empty pool (a paper with no body sentences) is asked nothing more and keeps its ranking
  const picked = claimSet.filter(c => pool.get(c.sid)!.length > 0)
  const cvCands = caveats.slice(0, CAVEAT_TOP).map(c => c[0])
  const cand = [...new Set([...[...pool.values()].flat(), ...cvCands])]
  const q: Questions = {}
  for (const c of picked) {
    const ids = pool.get(c.sid)!
    q[`pk_${c.sid}`] = Q.pickQuestion(c.top, c.sid, Object.fromEntries(ids.map(s => [s, null])) as Record<string, null>)
    for (const s of ids.slice(0, VERIFY_TOP)) q[`vf_${c.sid}_${s}`] = Q.verifyQuestion(c.sid, s)
  }
  for (const s of cvCands) {
    q[`ql_${s}`] = Q.qualifiesQuestion(s)
    q[`wk_${s}`] = Q.weakerQuestion(s)
  }
  const state2 = { abstract: absState, candidates: Object.fromEntries(cand.map(s => [s, text(s)])) }
  const keys = Object.keys(q)
  const parts = Array.from({ length: Math.ceil(keys.length / ROUND2_MAX) }, (_, i) =>
    Object.fromEntries(keys.slice(i * ROUND2_MAX, i * ROUND2_MAX + ROUND2_MAX).map(k => [k, q[k]!])) as Questions,
  )
  const A: Answers = Object.assign({}, ...(await Promise.all(parts.map(part => ask(state2, part)))))

  for (const c of picked) {
    const ids = pool.get(c.sid)!
    const pk = chosen(A, `pk_${c.sid}`).probabilities
    const rescored = ids
      .map((s, i) => {
        // Only the top VERIFY_TOP were asked; the others weigh as a middling verification (LOG.md "v6", untuned)
        const verified = i < VERIFY_TOP ? noul(A, `vf_${c.sid}_${s}`) : null
        const caption = unit.get(s)!.kind === 'caption'
        return [s, ((pk[s] ?? 0) + PICK_FLOOR) * (verified === null ? 0.5 : 0.5 + 0.5 * verified) * (caption ? CAPTION : 1)] as [string, number]
      })
      .sort((x, y) => y[1] - x[1])
    c.ranked = [...rescored, ...c.ranked.filter(x => !ids.includes(x[0]))]
  }

  const candidates = new Set(cvCands)
  caveats = caveats.map(([s, det, t]) => {
    if (!candidates.has(s)) return [s, det * NON_CANDIDATE, t]
    const appendix = isAppendix(unit.get(s)!.sec) ? 1 : 0
    const f = CAVEAT_FIT
    const x = f.det * det + f.appendix * appendix + f.qualifies * noul(A, `ql_${s}`) + f.weaker * noul(A, `wk_${s}`) + f.intercept
    return [s, 1 / (1 + Math.exp(-x)), t]
  })
  caveats.sort((a, b) => b[1] - a[1])

  const keep = <T>(xs: T[], n: number) => (options.full ? xs : xs.slice(0, n))
  return {
    claims: claims.map(c => ({ sid: c.sid, pClaim: c.pClaim, role: c.shown, ranked: keep(c.ranked, OUT_RANKED) })),
    caveats: keep(caveats, OUT_CAVEATS).map(([s, v, t]) => [s, v, t === 'none' ? null : (t as CaveatType)]),
  }
}
