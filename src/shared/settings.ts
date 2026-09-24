import { storage } from 'wxt/utils/storage'
import { z } from 'zod'
import type { Level } from './levels'

/** Everything a paper page may read. The key is not here: it lives in src/shared/credentials.ts (spec §6.4) */
export interface Settings {
  version: 1
  level: Level
  guideSeen: boolean
  bubbleSeen: boolean
  /** Bumped whenever the credentials are saved, so open papers can re-run after a key error without reading the key */
  keyStamp: number
}

export const DEFAULT_SETTINGS: Settings = { version: 1, level: 1, guideSeen: false, bubbleSeen: false, keyStamp: 0 }

const schema = z.object({
  version: z.literal(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  guideSeen: z.boolean(),
  bubbleSeen: z.boolean(),
  keyStamp: z.number().int().nonnegative(),
})

/** `local:` — the key stays on this device, never `sync` */
export const settingsItem = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS, version: 1 })

const valid = (value: unknown): Settings => {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}

export async function getSettings(): Promise<Settings> {
  return valid(await settingsItem.getValue())
}

export async function patchSettings(patch: Partial<Omit<Settings, 'version'>>): Promise<Settings> {
  const next = schema.parse({ ...(await getSettings()), ...patch })
  await settingsItem.setValue(next)
  return next
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch(value => callback(valid(value)))
}
