// Section rules of the experiment's `final` (variants.frozen.mjs), plus fix 1 (spec §6.2), behind `fixes`.
import type { Unit } from '@/shared/units'

export interface Window {
  sec: string
  title: string
  units: Unit[]
}

/** Introduction and Conclusion mostly restate the abstract; evidence there is a last resort */
export const RESTATING = /\b(introduction|conclusions?|concluding|summary|discussion and conclusion)\b/i
export const RELATED = /\b(related work|prior work|literature review)\b/i
export const ADMIN = /\b(acknowledg\w*|funding|competing interests?|conflicts? of interest|author(s’|s'|s)? contributions?|data availability|availability of data|ethics statement|broader impacts?)\b/i
/** Fix 1: an appendix listing who did what; a paper's own "Our contributions" in the body stays eligible */
const APPENDIX_CONTRIBUTIONS = /\bcontribut(ions|ors)\b/i

export const isAppendix = (sec: string): boolean => sec.startsWith('A')
export const isAdmin = (title: string, sec: string, fixes: boolean): boolean => ADMIN.test(title) || (fixes && isAppendix(sec) && APPENDIX_CONTRIBUTIONS.test(title))

export const abstractOf = (units: readonly Unit[]): Unit[] => units.filter(u => u.kind === 'abstract')
/** Fix 2: list-like units are never candidates */
export const bodyOf = (units: readonly Unit[], fixes: boolean): Unit[] => units.filter(u => u.kind !== 'abstract' && !(fixes && u.list))

/** Body sentences grouped by top-level section, split into windows of at most `max` sentences, never inside a paragraph */
export function windows(units: readonly Unit[], fixes: boolean, max = 180): Window[] {
  const out: Window[] = []
  let cur: Window | null = null
  for (const u of bodyOf(units, fixes)) {
    if (!cur || cur.sec !== u.sec || (cur.units.length >= max && cur.units[cur.units.length - 1]!.pid !== u.pid)) {
      cur = { sec: u.sec, title: u.secTitle, units: [] }
      out.push(cur)
    }
    cur.units.push(u)
  }
  return out
}

/** What a section's title and number say about it. The flags are not exclusive ("Introduction and Related Work"
 *  is both restating and related), and each rule below reads them in the experiment's order. */
export interface SectionPolicy {
  admin: boolean
  restating: boolean
  related: boolean
  appendix: boolean
}

export const policyOf = (title: string, sec: string, fixes: boolean): SectionPolicy => ({
  admin: isAdmin(title, sec, fixes),
  restating: RESTATING.test(title),
  related: RELATED.test(title),
  appendix: isAppendix(sec),
})

/** Policies read once per section of a paper: the regexes run once per (title, number), not per claim or sentence */
export function sectionPolicies(fixes: boolean): (title: string, sec: string) => SectionPolicy {
  const seen = new Map<string, SectionPolicy>()
  return (title, sec) => {
    const key = `${sec}\n${title}`
    const known = seen.get(key)
    if (known) return known
    const p = policyOf(title, sec, fixes)
    seen.set(key, p)
    return p
  }
}

/** evidenceWeight5 of the experiment. LOG.md "v2" weighed restating sections at 0.3, "v3" related work at 0.3 and
 *  administrative sections at 0; this version's restating 0.2 and appendix 0.8 are in no LOG.md section. All
 *  weights at 1 lose 4.9 best@1 on dev, within noise (measured 2026-09-25). */
export const evidenceWeight = (p: SectionPolicy): number => (p.admin ? 0 : p.restating ? 0.2 : p.related ? 0.3 : p.appendix ? 0.8 : 1)

/** Caveats are not looked for in administrative or related-work sections: the experiment's caveatWeight, since v3 */
export const caveatWeight = (p: SectionPolicy): number => (p.admin || p.related ? 0 : 1)

/** The pick's pool leaves out restating, related-work and administrative sections (LOG.md "v6") */
export const poolable = (p: SectionPolicy): boolean => !(p.restating || p.related || p.admin)
