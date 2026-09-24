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

/** evidenceWeight5 of the experiment */
export const evidenceWeight = (w: Window, fixes: boolean): number =>
  isAdmin(w.title, w.sec, fixes) ? 0 : RESTATING.test(w.title) ? 0.2 : RELATED.test(w.title) ? 0.3 : isAppendix(w.units[0]!.sec) ? 0.8 : 1

export const caveatWeight = (w: Window, fixes: boolean): number => (isAdmin(w.title, w.sec, fixes) || RELATED.test(w.title) ? 0 : 1)

export const poolable = (u: Unit, fixes: boolean): boolean => !(RESTATING.test(u.secTitle) || RELATED.test(u.secTitle) || isAdmin(u.secTitle, u.sec, fixes))
