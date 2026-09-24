import { describe, expect, it } from 'vitest'
import { type Copy, copyFor } from '@/shared/copy'
import type { Lang } from '@/shared/lang'

const zh = copyFor('zh')
const en = copyFor('en')
const CJK = /[　-〿㐀-鿿＀-￯]/

/** Sample arguments for every function-valued entry, by its path: a new function needs samples here */
const SAMPLES: Record<string, unknown[][]> = {
  'status.marked': [[1], [12]],
  'status.pageMarked': [[1], [24]],
  'tip.claim': [
    [1, 'X'],
    [3, 'Y'],
  ],
  'tip.evidence': [
    [[1], false],
    [[1, 3], true],
  ],
  'anchor.claim': [[1]],
  'anchor.evidence': [[2]],
}

/** Every leaf of a copy object as `path: kind`, nested objects and tuples included */
function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}: function(${value.length})`]
  if (typeof value === 'string') return [`${path}: string`]
  if (value && typeof value === 'object') return Object.keys(value).flatMap(k => shape((value as Record<string, unknown>)[k], path ? `${path}.${k}` : k))
  return [`${path}: ${typeof value}`]
}

/** Every string a copy object renders: its string leaves, and each function called with its samples */
function rendered(copy: Copy): [path: string, text: string][] {
  const out: [string, string][] = []
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') out.push([path, value])
    else if (typeof value === 'function') for (const args of SAMPLES[path] ?? []) out.push([`${path}(${JSON.stringify(args)})`, value(...args)])
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
  }
  walk(copy, '')
  return out
}

describe('copy.ts', () => {
  it('English has every key Chinese has, and no other, nested objects and functions included', () => {
    expect(shape(en)).toEqual(shape(zh))
    expect(shape(zh).length).toBeGreaterThan(50)
  })

  it('every function has samples, and in both languages returns text for each of them', () => {
    const functions = shape(zh)
      .filter(s => s.includes(': function'))
      .map(s => s.split(':')[0])
    expect(functions.sort()).toEqual(Object.keys(SAMPLES).sort())
    for (const lang of ['zh', 'en'] as Lang[]) {
      for (const [path, text] of rendered(copyFor(lang)).filter(([p]) => p.includes('('))) {
        expect(typeof text, `${lang} ${path}`).toBe('string')
        expect(text.trim().length, `${lang} ${path}`).toBeGreaterThan(0)
      }
    }
  })

  it('English carries no Chinese; the strings the languages share are names, not words', () => {
    for (const [path, text] of rendered(en)) expect(text, path).not.toMatch(CJK)
    const shared = rendered(en).filter(([path, text]) => rendered(zh).some(([p, t]) => p === path && t === text) && text !== '')
    expect(shared.map(([path]) => path).sort()).toEqual(['brand', 'setup.endpointPlaceholder', 'setup.keyLabel', 'setup.keyPlaceholder.openrouter', 'setup.modelPlaceholder', 'setup.providers.openrouter', 'setup.providers.typesafe'])
  })

  it('English keeps the agreed terms', () => {
    expect(en.layers).toEqual({ 1: 'Claims & evidence', 2: 'Assumptions & limits', 3: 'More candidates' })
    expect(en.layersLabel).toBe('What to mark')
    expect(en.setup.submit).toBe('Get started')
    expect(en.guide.cta).toBe('Try it: Attention Is All You Need')
    expect(en.ready).toEqual({ change: 'Change', guideAgain: 'Show guide' })
    expect(en.role).toEqual({ method: 'Method', result: 'Result', contribution: 'Contribution', background: 'Background' })
    expect(en.roleFallback).toBe('Claim')
    expect(en.caveat).toEqual({ assumption: 'Assumption', condition: 'Condition', limitation: 'Limitation', evaluation: 'Evaluation caveat', unsupported: 'Unsupported', tradeoff: 'Trade-off' })
    expect(en.caveatFallback).toBe('Assumption or limit')
  })

  it('English tips, labels and counts read as agreed, in the singular and the plural', () => {
    expect(en.tip.claim(1, en.role.method)).toBe('Claim 1 · Method · Click to see its evidence')
    // The fallback role is the tip's own first word: it is not said twice
    expect(en.tip.claim(2, en.roleFallback)).toBe('Claim 2 · Click to see its evidence')
    expect(en.tip.evidence([1], false)).toBe('Delivers claim 1 · Click to go back')
    expect(en.tip.evidence([1, 3], true)).toBe('Delivers claims 1, 3 (candidate) · Click to go back')
    expect(en.button).toBe('JevPaper: choose what to mark')
    expect(en.bubble).toBe('Click here to choose what to mark')
    expect(en.status.pageMarked(12)).toBe('12 marks on this page')
    expect(en.status.pageMarked(1)).toBe('1 mark on this page')
    expect(en.status.marked(1)).toBe('1 mark on this page')
  })

  it('English errors and statuses that are sentences end with a period; fragments do not', () => {
    const sentences = [...Object.values(en.setup.errors), ...Object.values(en.pageError), ...Object.values(en.status.error), en.status.notPaper]
    for (const text of sentences) expect(text, text).toMatch(/[^.]\.$/)
    for (const text of [en.status.none, en.status.pageMarked(12), en.status.marked(1)]) expect(text, text).not.toMatch(/\.$/)
  })

  it('the popup status for a failed page names the fix and never says to click, in both languages', () => {
    for (const copy of [zh, en]) {
      expect(Object.keys(copy.status.error).sort()).toEqual(Object.keys(copy.pageError).sort())
      for (const text of Object.values(copy.status.error)) expect(text, text).not.toMatch(/click|点这里|点击/i)
    }
    expect(en.status.error.aborted).toBe(en.status.error.busy)
    expect(zh.status.error.aborted).toBe(zh.status.error.busy)
  })

  it('English calls what is marked sentences, never key points', () => {
    expect(en.lede).toBe('Open an arXiv paper and its key sentences are marked for you.')
    for (const [path, text] of rendered(en)) expect(text, path).not.toMatch(/key points?/i)
  })

  it('the manifest description stays the popup lede in both languages', () => {
    expect(zh.description).toBe('打开 arXiv 论文，重点自动标出来。')
    expect(zh.description).toBe(zh.lede)
    expect(en.description).toBe(en.lede)
  })
})
