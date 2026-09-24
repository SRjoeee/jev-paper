// Chrome's `_locales` for the manifest's name and description, generated from src/shared/copy.ts at build time
// (wxt.config.ts, `build:publicAssets`), so copy.ts stays the only source of every string the reader sees.
import { copyFor } from '../src/shared/copy'
import type { Lang } from '../src/shared/lang'

/** The manifest's `default_locale`: Chrome falls back to it for any UI language without a folder of its own */
export const DEFAULT_LOCALE = 'en'

/**
 * Chrome's locale folders and the copy each one holds. Chinese goes to Simplified and Traditional Chinese alike,
 * as the interface does for every `zh*` UI language (src/shared/lang.ts).
 */
export const LOCALES: Record<string, Lang> = { [DEFAULT_LOCALE]: 'en', zh_CN: 'zh', zh_TW: 'zh' }

export interface LocaleFile {
  /** Relative to the build's output directory */
  relativeDest: string
  contents: string
}

/** One `messages.json` per locale folder, holding the `__MSG_name__` and `__MSG_description__` the manifest names */
export function localeFiles(): LocaleFile[] {
  return Object.entries(LOCALES).map(([dir, lang]) => {
    const copy = copyFor(lang)
    const messages = { name: { message: copy.brand }, description: { message: copy.description } }
    return { relativeDest: `_locales/${dir}/messages.json`, contents: `${JSON.stringify(messages, null, 2)}\n` }
  })
}
