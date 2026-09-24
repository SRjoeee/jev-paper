// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isAdmin, poolable, RESTATING, windows } from '@/background/engine/sections'
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
    expect(poolable(u('s1', 'S1', '1 Introduction'), true)).toBe(false)
    expect(poolable(u('s2', 'S2', '2 Related Work'), true)).toBe(false)
    expect(poolable(u('s3', 'S3', '3 Method'), true)).toBe(true)
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
