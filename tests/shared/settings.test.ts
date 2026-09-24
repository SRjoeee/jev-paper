import { beforeEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_SETTINGS, getSettings, hasKey, patchSettings, settingsItem, watchSettings } from '@/shared/settings'

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset())

  it('starts from the defaults: OpenRouter, level 1, no key', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(hasKey(DEFAULT_SETTINGS)).toBe(false)
  })

  it('patches and reads back', async () => {
    await patchSettings({ apiKey: ' sk-or-1 ', level: 3 })
    const s = await getSettings()
    expect(s.level).toBe(3)
    expect(hasKey(s)).toBe(true)
  })

  it('falls back to the defaults when the stored value is malformed', async () => {
    await settingsItem.setValue({ nonsense: true } as never)
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects a patch that breaks the schema', async () => {
    await expect(patchSettings({ level: 7 as never })).rejects.toThrow()
  })

  it('tells watchers about changes', async () => {
    const seen: number[] = []
    const stop = watchSettings(s => seen.push(s.level))
    await patchSettings({ level: 2 })
    stop()
    expect(seen).toEqual([2])
  })
})
