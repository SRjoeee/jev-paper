// The experiment's frozen `final` pipeline (variants.frozen.mjs: makeV6 with evidenceWeight5, caveatWeight,
// round2Max 55), ported operation for operation, with round two sent in parts of 110 — the parity test replays its
// recorded answers per question, by a hash of the state and the question, so every state and question object must
// serialise exactly as the experiment's. `fixes` adds spec §6.2's two general fixes.
import type { CaveatType, DigestResult, Role } from '@/shared/result'
import type { Paper, Unit } from '@/shared/units'
import type { Answer, Answers, Questions } from '../jev/wire'
import * as Q from './questions'
import { abstractOf, caveatWeight, evidenceWeight, isAppendix, poolable, type Window, windows } from './sections'

export type EngineAsk = (state: unknown, questions: Questions) => Promise<Answers>
export interface EngineOptions {
  fixes?: boolean
  /** Evaluation only: keep every ranked sentence and every caveat instead of the top 8 / top 40 */
  full?: boolean
}

const WINDOW = 180
const CAVEAT_CHUNK = 40
const RANK_TOP = 10
const POOL_TOP = 8
const VERIFY_TOP = 5
const CAVEAT_TOP = 70
// Round two's part size. The experiment's 55 came from the Vercel gateway's 503s on larger requests (LOG.md "v9 /
// v10"); on OpenRouter the 2026-09-25 review measured 110 at −2 requests and −4.9 % tokens with the same quality
// and latency, and 194 questions in one request succeeded 12/12. The experiment keeps 55 (parity replays per question).
const ROUND2_MAX = 110
const OUT_RANKED = 8
const OUT_CAVEATS = 40

type ChoiceAnswer = Extract<Answer, { type: 'choice' }>
const probability = (a: Answer | undefined): number => (a?.type === 'boolean' ? a.probability : 0)
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

  const claims = abs.map(a => {
    const r = roleRes![`role_${a.sid}`] as ChoiceAnswer
    const scores: Record<string, number> = {}
    wins.forEach((w, i) => {
      const ev = winRes[i]![`ev_${a.sid}`] as ChoiceAnswer
      const ex = probability(winRes[i]![`ex_${a.sid}`])
      const weight = evidenceWeight(w, fixes)
      for (const [sid, p] of Object.entries(ev.probabilities)) scores[sid] = p * ex * weight
    })
    return { sid: a.sid, pClaim: 1 - (r.probabilities.background ?? 0), role: r.choice as Role, ranked: rank(scores) }
  })

  let caveats: [string, number, string | null][] = []
  cvChunks.forEach(({ w, c }, i) => {
    const weight = caveatWeight(w, fixes)
    for (const u of c) {
      const a = cvRes[i]![`cv_${u.sid}`]!
      const p = a.type === 'boolean' ? a.probability : 1 - ((a as ChoiceAnswer).probabilities.none ?? 0)
      caveats.push([u.sid, p * weight, a.type === 'choice' ? a.choice : null])
    }
  })
  caveats.sort((a, b) => b[1] - a[1])

  // ---- round two: a role-aware pick over each claim's pool, verification, and two caveat questions ----
  const unit = new Map(paper.units.map(u => [u.sid, u]))
  const text = (s: string) => `[${unit.get(s)!.secTitle}] ${unit.get(s)!.text}`
  const claimSet = claims.filter(c => c.pClaim >= 0.5)
  const pool = new Map(
    claimSet.map(c => {
      const keep = c.ranked.filter(x => poolable(unit.get(x[0])!, fixes)).map(x => x[0])
      const ids = keep.length >= 3 ? keep : c.ranked.map(x => x[0])
      return [c.sid, ids.slice(0, POOL_TOP)] as const
    }),
  )
  const cvCands = caveats.slice(0, CAVEAT_TOP).map(c => c[0])
  const cand = [...new Set([...[...pool.values()].flat(), ...cvCands])]
  const q: Questions = {}
  for (const c of claimSet) {
    const ids = pool.get(c.sid)!
    if (ids.length === 0) continue
    q[`pk_${c.sid}`] = Q.pickQuestion(c.role, c.sid, Object.fromEntries(ids.map(s => [s, null])) as Record<string, null>)
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

  for (const c of claimSet) {
    const ids = pool.get(c.sid)!
    if (ids.length === 0) continue
    const pk = (A[`pk_${c.sid}`] as ChoiceAnswer | undefined)?.probabilities ?? {}
    const rescored = ids
      .map(s => {
        const vf = A[`vf_${c.sid}_${s}`]
        const verified = vf?.type === 'boolean' ? vf.probability : null
        const caption = unit.get(s)!.kind === 'caption'
        return [s, ((pk[s] ?? 0) + 0.02) * (verified === null ? 0.5 : 0.5 + 0.5 * verified) * (caption ? 0.6 : 1)] as [string, number]
      })
      .sort((x, y) => y[1] - x[1])
    c.ranked = [...rescored, ...c.ranked.filter(x => !ids.includes(x[0]))]
  }

  const candidates = new Set(cvCands)
  caveats = caveats.map(([s, det, t]) => {
    if (!candidates.has(s)) return [s, det * 0.05, t]
    const appendix = isAppendix(unit.get(s)!.sec) ? 1 : 0
    const ql = probability(A[`ql_${s}`])
    const wk = probability(A[`wk_${s}`])
    return [s, 1 / (1 + Math.exp(-(1.69 * det - 1.55 * appendix + 0.89 * ql + 1.4 * wk - 2.15))), t]
  })
  caveats.sort((a, b) => b[1] - a[1])

  const keep = <T>(xs: T[], n: number) => (options.full ? xs : xs.slice(0, n))
  return {
    claims: claims.map(c => ({ sid: c.sid, pClaim: c.pClaim, role: c.role, ranked: keep(c.ranked, OUT_RANKED) })),
    caveats: keep(caveats, OUT_CAVEATS).map(([s, v, t]) => [s, v, t === 'none' || t === null ? null : (t as CaveatType)]),
  }
}
