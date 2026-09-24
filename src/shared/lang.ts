import { browser } from 'wxt/browser'

export type Lang = 'zh' | 'en'

/** The tag each language writes into `lang` attributes: the extension pages' `<html>` and the page UI's hosts */
export const LANG_TAG: Record<Lang, string> = { zh: 'zh-CN', en: 'en' }

/**
 * The interface language: Chrome's own UI language, which a content script and every extension page can read.
 * Any Chinese locale (`zh`, `zh-CN`, `zh-TW`, `zh-HK`, …) gives Chinese; everything else gives English. There is
 * no switch.
 */
export function uiLang(): Lang {
  // Node has no extension API: the build reads copy.ts there (wxt.config.ts), and never shows a page
  const tag = browser?.i18n?.getUILanguage() ?? ''
  return /^zh(?:[-_]|$)/i.test(tag) ? 'zh' : 'en'
}
