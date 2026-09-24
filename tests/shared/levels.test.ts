import { describe, expect, it } from 'vitest'
import { marksFor } from '@/shared/levels'
import type { DigestResult } from '@/shared/result'

const result: DigestResult = {
  claims: [
    { sid: 's001', pClaim: 0.1, role: null, ranked: [['s050', 0.9]] },
    { sid: 's002', pClaim: 0.9, role: 'method', ranked: [['s020', 0.8], ['s021', 0.5], ['s022', 0.4], ['s023', 0.3]] },
    { sid: 's003', pClaim: 0.8, role: 'result', ranked: [['s020', 0.7], ['s030', 0.6], ['s021', 0.2]] },
  ],
  caveats: Array.from({ length: 30 }, (_, i) => [`s1${String(i).padStart(2, '0')}`, 1 - i / 100, 'limitation'] as [string, number, 'limitation']),
}

describe('marksFor', () => {
  it('level 1: claims above the threshold, numbered in abstract order, and each rank-1 evidence once', () => {
    const marks = marksFor(result, 1)
    expect(marks.filter(m => m.tone === 'claim').map(m => [m.sid, m.no])).toEqual([['s002', 1], ['s003', 2]])
    const ev = marks.filter(m => m.tone === 'evidence')
    expect(ev).toEqual([{ tone: 'evidence', sid: 's020', claims: [1, 2], claimSid: 's002' }])
    expect(marks.some(m => m.tone === 'caveat' || m.tone === 'candidate')).toBe(false)
  })

  it('a claim points at its own rank-1 evidence', () => {
    const claim = marksFor(result, 1).find(m => m.tone === 'claim' && m.sid === 's003')
    expect(claim).toMatchObject({ evidence: 's020', role: 'result' })
  })

  it('level 2 adds the top 8 caveats in rank order', () => {
    const cv = marksFor(result, 2).filter(m => m.tone === 'caveat')
    expect(cv.map(m => m.sid)).toEqual(['s100', 's101', 's102', 's103', 's104', 's105', 's106', 's107'])
  })

  it('level 3 adds rank-2/3 candidates, keeps a sentence that is rank 1 anywhere as evidence, and 20 caveats', () => {
    const marks = marksFor(result, 3)
    expect(marks.filter(m => m.tone === 'candidate').map(m => m.sid).sort()).toEqual(['s021', 's022', 's030'])
    expect(marks.find(m => m.sid === 's020')?.tone).toBe('evidence')
    expect(marks.filter(m => m.tone === 'caveat')).toHaveLength(20)
  })

  it('caps the caveats at what the result holds', () => {
    expect(marksFor({ ...result, caveats: result.caveats.slice(0, 3) }, 3).filter(m => m.tone === 'caveat')).toHaveLength(3)
  })
})
