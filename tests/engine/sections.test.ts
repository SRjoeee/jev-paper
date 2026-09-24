// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { caveatWeight, evidenceWeight, isAdmin, policyOf, poolable, RESTATING, sectionPolicies, windows } from '@/background/engine/sections'
import type { Unit } from '@/shared/units'

const u = (sid: string, sec: string, secTitle: string, pid = sid, kind: Unit['kind'] = 'body'): Unit => ({ sid, kind, sec, secTitle, pid, text: `Sentence ${sid}.` })

describe('section rules', () => {
  it('treats Introduction and Conclusion as restating; a lone Discussion is not (known gap, LOG.md)', () => {
    expect(RESTATING.test('1 Introduction')).toBe(true)
    expect(RESTATING.test('7 Conclusion')).toBe(true)
    expect(RESTATING.test('6 Discussion')).toBe(false)
  })

  it('takes an appendix Contributions section as administrative only with the fixes on', () => {
    expect(isAdmin('Appendix A Contributions', 'A1', true)).toBe(true)
    expect(isAdmin('Appendix A Contributions', 'A1', false)).toBe(false)
    expect(isAdmin('1.1 Our Contributions', 'S1', true)).toBe(false)
    expect(isAdmin('Acknowledgements', 'S9', false)).toBe(true)
  })

  it('keeps restating, related-work and administrative sentences out of the pool', () => {
    expect(poolable(policyOf('1 Introduction', 'S1', true))).toBe(false)
    expect(poolable(policyOf('2 Related Work', 'S2', true))).toBe(false)
    expect(poolable(policyOf('Acknowledgements', 'S9', true))).toBe(false)
    expect(poolable(policyOf('3 Method', 'S3', true))).toBe(true)
    expect(poolable(policyOf('Appendix B Proofs', 'A2', true))).toBe(true)
  })

  it('weighs evidence and caveats by section, reading the rules in the experiment order', () => {
    const weights = (title: string, sec: string) => {
      const p = policyOf(title, sec, true)
      return [evidenceWeight(p), caveatWeight(p)]
    }
    expect(weights('Acknowledgements', 'S9')).toEqual([0, 0])
    expect(weights('1 Introduction', 'S1')).toEqual([0.2, 1])
    expect(weights('2 Related Work', 'S2')).toEqual([0.3, 0])
    // Both restating and related: restating wins for evidence, related still silences caveats
    expect(weights('1 Introduction and Related Work', 'S1')).toEqual([0.2, 0])
    expect(weights('Appendix B Proofs', 'A2')).toEqual([0.8, 1])
    expect(weights('3 Method', 'S3')).toEqual([1, 1])
  })

  it('reads the policy of each section once', () => {
    const policy = sectionPolicies(true)
    expect(policy('1 Introduction', 'S1')).toBe(policy('1 Introduction', 'S1'))
    expect(policy('1 Introduction', 'S1')).not.toBe(policy('1 Introduction', 'S2'))
  })
})

describe('windows', () => {
  it('cuts at sections and at the size limit without splitting a paragraph, and drops list units with the fixes', () => {
    const units = [
      u('s001', 'abstract', 'Abstract', 'a', 'abstract'),
      u('s002', 'S1', '1 Intro', 'p1'), u('s003', 'S1', '1 Intro', 'p1'), u('s004', 'S1', '1 Intro', 'p2'),
      u('s005', 'S2', '2 Method', 'p3'),
      { ...u('s006', 'A1', 'Appendix A Contributions', 'p4'), list: true as const },
    ]
    expect(windows(units, true, 2).map(w => w.units.map(x => x.sid))).toEqual([['s002', 's003'], ['s004'], ['s005']])
    expect(windows(units, false, 180).map(w => w.units.map(x => x.sid))).toEqual([['s002', 's003', 's004'], ['s005'], ['s006']])
  })
})
