import { describe, expect, it } from 'vitest'
import type { ResolvedPublicFile, Wxt, WxtHooks } from 'wxt'
import { copyFor } from '@/shared/copy'
import config from '../../wxt.config'
import { DEFAULT_LOCALE, LOCALE_DIRS, localeFiles } from '../../scripts/locales'

const files = () => Object.fromEntries(localeFiles().map(f => [f.relativeDest, JSON.parse(f.contents)]))

describe('scripts/locales.ts', () => {
  it('writes one messages.json per language, English as the default locale', () => {
    expect(Object.keys(files()).sort()).toEqual(['_locales/en/messages.json', '_locales/zh_CN/messages.json'])
    expect(LOCALE_DIRS.en).toBe(DEFAULT_LOCALE)
  })

  it("holds copy.ts's name and description, and nothing else", () => {
    for (const lang of ['en', 'zh'] as const) {
      expect(files()[`_locales/${LOCALE_DIRS[lang]}/messages.json`]).toEqual({ name: { message: copyFor(lang).brand }, description: { message: copyFor(lang).description } })
    }
    expect(files()['_locales/zh_CN/messages.json'].description.message).toBe('打开 arXiv 论文，重点自动标出来。')
  })
})

describe('wxt.config.ts', () => {
  it('names the messages in the manifest, sets the default locale and adds the files to the build', async () => {
    const manifest = config.manifest as Record<string, unknown>
    expect(manifest.name).toBe('__MSG_name__')
    expect(manifest.description).toBe('__MSG_description__')
    expect(manifest.default_locale).toBe(DEFAULT_LOCALE)
    // Every message the manifest names is in every locale file
    const named = JSON.stringify(manifest).match(/__MSG_(\w+)__/g)!.map(m => m.slice(6, -2))
    for (const messages of Object.values(files())) expect(Object.keys(messages)).toEqual(expect.arrayContaining(named))
    const assets: ResolvedPublicFile[] = []
    const hooks = config.hooks as Pick<WxtHooks, 'build:publicAssets'>
    await hooks['build:publicAssets']({} as Wxt, assets)
    expect(assets).toEqual(localeFiles())
  })
})
