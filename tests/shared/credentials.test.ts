import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_CREDENTIALS, getCredentials, hasKey, saveCredentials } from '@/shared/credentials'
import { getSettings } from '@/shared/settings'

describe('credentials', () => {
  beforeEach(() => fakeBrowser.reset())

  it('defaults to OpenRouter with no key', async () => {
    expect(await getCredentials()).toEqual(DEFAULT_CREDENTIALS)
    expect(hasKey(DEFAULT_CREDENTIALS)).toBe(false)
  })

  it('saves trimmed values and hasKey returns true', async () => {
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: ' sk-or-1 ' })
    const c = await getCredentials()
    expect(c.apiKey).toBe('sk-or-1')
    expect(hasKey(c)).toBe(true)
  })

  it('bumps keyStamp on each save', async () => {
    expect((await getSettings()).keyStamp).toBe(0)
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'key1' })
    expect((await getSettings()).keyStamp).toBe(1)
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'key2' })
    expect((await getSettings()).keyStamp).toBe(2)
  })

  it('falls back to defaults when stored value is malformed', async () => {
    const { credentialsItem } = await import('@/shared/credentials')
    await credentialsItem.setValue({ nonsense: true } as never)
    expect(await getCredentials()).toEqual(DEFAULT_CREDENTIALS)
  })

  it('rejects an invalid provider', async () => {
    await expect(saveCredentials({ provider: 'invalid' as never, baseUrl: '', model: '', apiKey: '' })).rejects.toThrow()
  })
})
