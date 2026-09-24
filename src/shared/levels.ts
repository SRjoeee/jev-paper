import { COPY } from './copy'
import type { CaveatType, DigestResult, Role } from './result'

export type Level = 1 | 2 | 3

/** How many rank places of evidence and how many caveats each level shows (cumulative) */
export const LEVELS: Record<Level, { evidence: number; caveats: number }> = {
  1: { evidence: 1, caveats: 0 },
  2: { evidence: 1, caveats: 8 },
  3: { evidence: 3, caveats: 20 },
}

export const CLAIM_THRESHOLD = 0.5

export type Tone = 'claim' | 'evidence' | 'candidate' | 'caveat'

export type Mark =
  | { tone: 'claim'; sid: string; no: number; role: Role | null; evidence: string | null }
  | { tone: 'evidence' | 'candidate'; sid: string; claims: number[]; claimSid: string }
  | { tone: 'caveat'; sid: string; type: CaveatType | null }

/** The menu's rows: each level adds the tones listed on its row */
export const LAYERS: readonly { level: Level; name: string; tones: readonly Tone[] }[] = [
  { level: 1, name: COPY.layers[1], tones: ['claim', 'evidence'] },
  { level: 2, name: COPY.layers[2], tones: ['caveat'] },
  { level: 3, name: COPY.layers[3], tones: ['candidate'] },
]

/** The marks a level shows. A sentence that is rank 1 for any claim is evidence, whatever else it is for. */
export function marksFor(result: DigestResult, level: Level): Mark[] {
  const { evidence, caveats } = LEVELS[level]
  const claims = result.claims.filter(c => c.pClaim >= CLAIM_THRESHOLD)
  const marks: Mark[] = []
  const found = new Map<string, { tone: 'evidence' | 'candidate'; claims: number[]; claimSid: string }>()
  claims.forEach((c, i) => {
    const no = i + 1
    marks.push({ tone: 'claim', sid: c.sid, no, role: c.role, evidence: c.ranked[0]?.[0] ?? null })
    c.ranked.slice(0, evidence).forEach(([sid], k) => {
      const tone = k === 0 ? 'evidence' : 'candidate'
      const seen = found.get(sid)
      if (!seen) {
        found.set(sid, { tone, claims: [no], claimSid: c.sid })
        return
      }
      if (!seen.claims.includes(no)) seen.claims.push(no)
      if (tone === 'evidence' && seen.tone === 'candidate') {
        seen.tone = 'evidence'
        seen.claimSid = c.sid
      }
    })
  })
  for (const [sid, e] of found) marks.push({ tone: e.tone, sid, claims: e.claims, claimSid: e.claimSid })
  for (const [sid, , type] of result.caveats.slice(0, caveats)) marks.push({ tone: 'caveat', sid, type })
  return marks
}
