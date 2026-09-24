// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cacheKey, ResultCache } from '@/background/cache'
import { ENGINE_VERSION } from '@/background/engine/version'
import { RULES_VERSION } from '@/core/rules/latexml'

const result = (n: number) => ({ claims: [{ sid: `s00${n}`, pClaim: 1, role: null, ranked: [] }], caveats: [] })

describe('ResultCache', () => {
  it('stores and reads a result', async () => {
    const cache = new ResultCache(`t-${Math.random()}`)
    await cache.put('k', result(1))
    expect(await cache.get('k')).toEqual(result(1))
    expect(await cache.get('missing')).toBeUndefined()
    cache.close()
  })

  it('evicts the least recently used beyond the limit', async () => {
    let t = 0
    const cache = new ResultCache(`t-${Math.random()}`, 2, () => ++t)
    await cache.put('a', result(1))
    await cache.put('b', result(2))
    await cache.get('a') // a is now more recent than b
    await cache.put('c', result(3))
    expect(await cache.get('b')).toBeUndefined()
    expect(await cache.get('a')).toBeDefined()
    expect(await cache.get('c')).toBeDefined()
    cache.close()
  })

  it('keys by paper, units, engine and rules', () => {
    expect(cacheKey('1706.03762', 'abc')).toBe(`1706.03762|abc|${ENGINE_VERSION}|${RULES_VERSION}`)
  })
})
