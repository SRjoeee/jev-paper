// The reader's key and endpoint. Only the service worker and the popup import this module: a paper page never
// reads the key (spec §4, §6.4). tests/shared/boundary.test.ts pins that.
import { storage } from 'wxt/utils/storage'
import { z } from 'zod'
import { getSettings, patchSettings } from './settings'

export type ProviderId = 'openrouter' | 'typesafe' | 'custom'

export interface Credentials {
  version: 1
  provider: ProviderId
  /** Custom endpoint only */
  baseUrl: string
  /** Custom endpoint only */
  model: string
  apiKey: string
}

export const DEFAULT_CREDENTIALS: Credentials = { version: 1, provider: 'openrouter', baseUrl: '', model: '', apiKey: '' }

const schema = z.object({
  version: z.literal(1),
  provider: z.enum(['openrouter', 'typesafe', 'custom']),
  baseUrl: z.string().max(2048),
  model: z.string().max(200),
  apiKey: z.string().max(1000),
})

/** `local:` — the key stays on this device, never `sync` */
export const credentialsItem = storage.defineItem<Credentials>('local:credentials', { fallback: DEFAULT_CREDENTIALS, version: 1 })

export async function getCredentials(): Promise<Credentials> {
  const parsed = schema.safeParse(await credentialsItem.getValue())
  return parsed.success ? parsed.data : DEFAULT_CREDENTIALS
}

/** Saves trimmed values and bumps `keyStamp` so open papers that failed on the key run again */
export async function saveCredentials(c: Omit<Credentials, 'version'>): Promise<Credentials> {
  const next = schema.parse({ version: 1, provider: c.provider, baseUrl: c.baseUrl.trim(), model: c.model.trim(), apiKey: c.apiKey.trim() })
  await credentialsItem.setValue(next)
  await patchSettings({ keyStamp: (await getSettings()).keyStamp + 1 })
  return next
}

export function watchCredentials(callback: (c: Credentials) => void): () => void {
  return credentialsItem.watch(value => {
    const parsed = schema.safeParse(value)
    callback(parsed.success ? parsed.data : DEFAULT_CREDENTIALS)
  })
}

export const hasKey = (c: Pick<Credentials, 'apiKey'>): boolean => c.apiKey.trim().length > 0
