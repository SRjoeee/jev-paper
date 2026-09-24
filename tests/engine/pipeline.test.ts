// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { digest } from '@/background/engine/pipeline'
import type { Answers, Questions } from '@/background/jev/wire'
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

/** Deterministic answers; in the appendix window the evidence Choice leans hard on its first sentence */
function fakeAsk(log: { state: unknown; questions: Questions }[]) {
  return async (state: unknown, questions: Questions): Promise<Answers> => {
    log.push({ state, questions })
    const out: Answers = {}
    for (const [k, q] of Object.entries(questions)) {
      if (q.type === 'boolean') out[k] = { type: 'boolean', probability: 0.9 }
      else if (q.type === 'choice' && k.startsWith('role_')) out[k] = { type: 'choice', choice: 'method', probabilities: { background: 0.1, method: 0.8, result: 0.05, contribution: 0.05 } }
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
  it('asks round one (roles, one evidence request per window, one caveat request per chunk) then round two in parts of at most 55', async () => {
    const log: { state: unknown; questions: Questions }[] = []
    await digest({ title: 'T', units }, fakeAsk(log))
    const hasCandidates = (state: unknown): boolean => typeof state === 'object' && state !== null && 'candidates' in state
    const roundOne = log.filter(r => !hasCandidates(r.state))
    const roundTwo = log.filter(r => hasCandidates(r.state))
    expect(roundOne).toHaveLength(1 + 2 + 2) // roles + windows S1, A1 + one caveat chunk per window
    expect(roundTwo.length).toBeGreaterThan(0)
    expect(roundTwo.every(r => Object.keys(r.questions).length <= 55)).toBe(true)
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
