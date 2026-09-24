import { storage } from 'wxt/utils/storage'
import { z } from 'zod'
import type { Level } from './levels'

export type ProviderId = 'openrouter' | 'typesafe' | 'custom'

export interface Settings {
  version: 1
  provider: ProviderId
  /** Custom endpoint only */
  baseUrl: string
  /** Custom endpoint only */
  model: string
  apiKey: string
  level: Level
  guideSeen: boolean
  bubbleSeen: boolean
}

export const DEFAULT_SETTINGS: Settings = { version: 1, provider: 'openrouter', baseUrl: '', model: '', apiKey: '', level: 1, guideSeen: false, bubbleSeen: false }

const schema = z.object({
  version: z.literal(1),
  provider: z.enum(['openrouter', 'typesafe', 'custom']),
  baseUrl: z.string().max(2048),
  model: z.string().max(200),
  apiKey: z.string().max(1000),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  guideSeen: z.boolean(),
  bubbleSeen: z.boolean(),
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

export const hasKey = (s: Pick<Settings, 'apiKey'>): boolean => s.apiKey.trim().length > 0
