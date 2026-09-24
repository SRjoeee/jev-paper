// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { digest, ROLE_CONFIDENCE, roleOf } from '@/background/engine/pipeline'
import { pickQuestion } from '@/background/engine/questions'
import type { Answer, Answers, Questions } from '@/background/jev/wire'
import type { Unit } from '@/shared/units'

const unit = (sid: string, kind: Unit['kind'], sec: string, secTitle: string, text: string): Unit => ({ sid, kind, sec, secTitle, pid: sid, text })

const units: Unit[] = [
  unit('s001', 'abstract', 'abstract', 'Abstract', 'We propose a method.'),
  unit('s002', 'abstract', 'abstract', 'Abstract', 'It improves accuracy by 3 points.'),
  unit('s003', 'body', 'S1', '1 Method', 'The method works by mixing.'),
  unit('s004', 'body', 'S1', '1 Method', 'We define the mixer as follows.'),
  unit('s005', 'body', 'S1', '1 Method', 'The mixer is cheap.'),
  unit('s006', 'body', 'A1', 'Appendix A Contributions', 'Alice wrote the code.'),
  unit('s007', 'body', 'A1', 'Appendix A Contributions', 'Bob ran the experiments.'),
]

/** The shapes of state the engine builds: round one's role/evidence/caveat requests, and round two's. */
type EngineState =
  | { abstract: Record<string, string> }
  | { abstract: Record<string, string>; section: { title: string; sentences: Record<string, string> } }
  | { paper: { title: string; abstract: string }; section: string; passage: Record<string, string> }
  | { abstract: Record<string, string>; candidates: Record<string, string> }

const sectionTitle = (state: unknown): string | undefined => {
  const s = state as EngineState
  return 'section' in s && typeof s.section === 'object' ? s.section.title : undefined
}

const hasCandidates = (state: unknown): boolean => typeof state === 'object' && state !== null && 'candidates' in state

const METHOD: Answer = { type: 'choice', choice: 'method', probabilities: { background: 0.1, method: 0.8, result: 0.05, contribution: 0.05 } }

/** Deterministic answers; in the appendix window the evidence Choice leans hard on its first sentence */
function fakeAsk(log: { state: unknown; questions: Questions }[], role: Answer = METHOD) {
  return async (state: unknown, questions: Questions): Promise<Answers> => {
    log.push({ state, questions })
    const out: Answers = {}
    for (const [k, q] of Object.entries(questions)) {
      if (q.type === 'boolean') out[k] = { type: 'boolean', probability: 0.9 }
      else if (q.type === 'choice' && k.startsWith('role_')) out[k] = role
      else if (q.type === 'choice' && k.startsWith('cv_')) out[k] = { type: 'choice', choice: 'none', probabilities: { none: 0.6, limitation: 0.4 } }
      else if (q.type === 'choice') {
        const ids = Object.keys(q.criteria)
        const lean = sectionTitle(state)?.includes('Contributions') ? 1 : 0.5
        out[k] = { type: 'choice', choice: ids[0]!, probabilities: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? lean : (1 - lean) / Math.max(1, ids.length - 1)])) }
      }
    }
    return out
  }
}

describe('digest', () => {
  it('asks round one (roles, one evidence request per window, one caveat request per chunk) then round two', async () => {
    const log: { state: unknown; questions: Questions }[] = []
    await digest({ title: 'T', units }, fakeAsk(log))
    const roundOne = log.filter(r => !hasCandidates(r.state))
    const roundTwo = log.filter(r => hasCandidates(r.state))
    expect(roundOne).toHaveLength(1 + 2 + 2) // roles + windows S1, A1 + one caveat chunk per window
    expect(roundTwo).toHaveLength(1)
  })

  it('sends a round two of more than 110 questions in ⌈n/110⌉ parts of at most 110, all with the same state', async () => {
    const body = Array.from({ length: 100 }, (_, i) => unit(`s${String(i + 10).padStart(3, '0')}`, 'body', 'S1', '1 Method', `Sentence ${i}.`))
    const log: { state: unknown; questions: Questions }[] = []
    await digest({ title: 'T', units: [...units.slice(0, 2), ...body] }, fakeAsk(log))
    const roundTwo = log.filter(r => hasCandidates(r.state))
    const sizes = roundTwo.map(r => Object.keys(r.questions).length)
    const n = sizes.reduce((a, b) => a + b, 0)
    expect(n).toBe(2 * (1 + 5) + 2 * 70) // two claims: a pick and 5 verifications each; 70 caveat candidates: 2 each
    expect(sizes).toEqual([110, n - 110])
    expect(new Set(roundTwo.map(r => JSON.stringify(r.state))).size).toBe(1)
  })

  it('never ranks an appendix Contributions sentence as evidence with the fixes, and does without them', async () => {
    const on = await digest({ title: 'T', units }, fakeAsk([]))
    const off = await digest({ title: 'T', units }, fakeAsk([]), { fixes: false })
    expect(on.claims[0]!.ranked[0]![0]).toBe('s003')
    expect(off.claims[0]!.ranked[0]![0]).toBe('s006')
  })

  it('keeps list units out of every request', async () => {
    const log: { state: unknown; questions: Questions }[] = []
    const withList = [...units, { ...unit('s008', 'body', 'A2', 'Appendix B Authors', 'Ann Lee Bo Chen …'), list: true as const }]
    await digest({ title: 'T', units: withList }, fakeAsk(log))
    expect(JSON.stringify(log.map(r => r.state))).not.toContain('s008')
  })

  it('returns the top 8 ranked per claim, the top 40 caveats, and never the type "none"', async () => {
    const result = await digest({ title: 'T', units }, fakeAsk([]))
    expect(result.claims.map(c => c.sid)).toEqual(['s001', 's002'])
    expect(result.claims.every(c => c.ranked.length <= 8 && c.pClaim === 0.9 && c.role === 'method')).toBe(true)
    expect(result.caveats.length).toBeLessThanOrEqual(40)
    expect(result.caveats.every(([, , t]) => t === null || t !== ('none' as never))).toBe(true)
  })

  it('returns nothing for a paper without an abstract', async () => {
    expect(await digest({ title: 'T', units: units.filter(u => u.kind !== 'abstract') }, fakeAsk([]))).toEqual({ claims: [], caveats: [] })
  })
})

describe('the role a claim is shown with', () => {
  const role = (probabilities: Record<string, number>): Answer => ({ type: 'choice', choice: 'background', probabilities })

  it('shows the top role from a share of 0.7 of the non-background probability, and none below it', () => {
    expect(ROLE_CONFIDENCE).toBe(0.7)
    expect(roleOf({ background: 0, method: 0.69, result: 0.31, contribution: 0 })).toEqual({ top: 'method', shown: null })
    expect(roleOf({ background: 0, method: 0.71, result: 0.29, contribution: 0 })).toEqual({ top: 'method', shown: 'method' })
    // The share ignores background: 0.2 of 0.28 is 0.71
    expect(roleOf({ background: 0.72, method: 0.04, result: 0.2, contribution: 0.04 })).toEqual({ top: 'result', shown: 'result' })
    expect(roleOf({ background: 1 })).toEqual({ top: 'method', shown: null })
  })

  it('puts the gated role on the result', async () => {
    const shown = await digest({ title: 'T', units }, fakeAsk([], role({ background: 0.1, method: 0.05, result: 0.8, contribution: 0.05 })))
    expect(shown.claims.map(c => c.role)).toEqual(['result', 'result'])
    const hidden = await digest({ title: 'T', units }, fakeAsk([], role({ background: 0.1, method: 0.3, result: 0.35, contribution: 0.25 })))
    expect(hidden.claims.map(c => c.role)).toEqual([null, null])
  })

  it('words the pick by the top non-background role when background leads the answer', async () => {
    const picks = async (answer: Answer) => {
      const log: { state: unknown; questions: Questions }[] = []
      const result = await digest({ title: 'T', units }, fakeAsk(log, answer))
      const asked = Object.entries(Object.assign({}, ...log.filter(r => hasCandidates(r.state)).map(r => r.questions)) as Questions)
      return { result, picks: asked.filter(([k]) => k.startsWith('pk_')).map(([, q]) => q.instructions) }
    }
    // Background 0.45 leads, yet the claim is kept (P(claim) 0.55): the pick asks for a result, and the role is shown
    const led = await picks(role({ background: 0.45, method: 0.1, result: 0.4, contribution: 0.05 }))
    expect(led.result.claims.map(c => [c.pClaim, c.role])).toEqual([[0.55, 'result'], [0.55, 'result']])
    expect(led.picks).toEqual(['s001', 's002'].map(sid => pickQuestion('result', sid, {}).instructions))
    // Below the share the role is withheld, but the pick is still worded by the top non-background role
    const unsure = await picks(role({ background: 0.48, method: 0.3, result: 0.12, contribution: 0.1 }))
    expect(unsure.result.claims.map(c => c.role)).toEqual([null, null])
    expect(unsure.picks).toEqual(['s001', 's002'].map(sid => pickQuestion('method', sid, {}).instructions))
  })
})

describe('answers the engine cannot do without', () => {
  /** fakeAsk, with the answers to one kind of question left out */
  const without = (prefix: string) => {
    const ask = fakeAsk([])
    return async (state: unknown, questions: Questions): Promise<Answers> =>
      Object.fromEntries(Object.entries(await ask(state, questions)).filter(([k]) => !k.startsWith(prefix)))
  }

  it.each(['role_', 'ev_', 'ex_', 'cv_', 'pk_', 'vf_', 'ql_', 'wk_'])('throws not-jev when the %s answers are missing', async prefix => {
    await expect(digest({ title: 'T', units }, without(prefix))).rejects.toMatchObject({ name: 'JevError', code: 'not-jev' })
  })

  it('throws not-jev on an answer of the wrong type', async () => {
    const ask = fakeAsk([])
    const mistyped = async (state: unknown, questions: Questions): Promise<Answers> => {
      const out = await ask(state, questions)
      for (const k of Object.keys(out)) if (k.startsWith('ex_')) out[k] = METHOD
      return out
    }
    await expect(digest({ title: 'T', units }, mistyped)).rejects.toMatchObject({ code: 'not-jev' })
  })
})
