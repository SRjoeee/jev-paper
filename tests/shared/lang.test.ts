import { afterEach, describe, expect, it } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { COPY, copyFor, LANG } from '@/shared/copy'
import { LANG_TAG, uiLang } from '@/shared/lang'

describe('uiLang', () => {
  // tests/setup.ts pins Chinese for every other suite
  afterEach(() => {
    fakeBrowser.i18n.getUILanguage = () => 'zh-CN'
  })

  it.each(['zh-CN', 'zh-TW', 'zh', 'zh-HK'])('reads Chrome UI language %s as Chinese', tag => {
    fakeBrowser.i18n.getUILanguage = () => tag
    expect(uiLang()).toBe('zh')
  })

  it.each(['en-US', 'fr', 'ja', 'en-GB'])('reads Chrome UI language %s as English', tag => {
    fakeBrowser.i18n.getUILanguage = () => tag
    expect(uiLang()).toBe('en')
  })

  it('falls back to English, and never throws, when Chrome cannot say', () => {
    fakeBrowser.i18n.getUILanguage = () => {
      throw new Error('i18n unavailable')
    }
    expect(uiLang()).toBe('en')
  })

  it('writes zh-CN or en into lang attributes', () => {
    expect(LANG_TAG).toEqual({ zh: 'zh-CN', en: 'en' })
  })

  it('under the test setup the interface is Chinese, the default the other suites assert', () => {
    expect(LANG).toBe('zh')
    expect(COPY).toBe(copyFor('zh'))
  })
})
