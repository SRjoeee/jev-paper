import type { Credentials, ProviderId } from '@/shared/credentials'

export interface Endpoint {
  url: string
  model: string
  apiKey: string
}

export const PRESETS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest', keys: 'https://openrouter.ai/keys' },
  // Not called live yet (no key): verify url, model and the key page when one exists (spec §6.1)
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keys: 'https://typesafe.ai' },
} as const

export function endpointOf(s: Pick<Credentials, 'provider' | 'baseUrl' | 'model' | 'apiKey'>): Endpoint {
  const where = s.provider === 'custom' ? { url: s.baseUrl.trim(), model: s.model.trim() } : PRESETS[s.provider]
  return { url: where.url, model: where.model, apiKey: s.apiKey.trim() }
}

export const keysUrl = (provider: ProviderId): string | null => (provider === 'custom' ? null : PRESETS[provider].keys)

/** The match pattern `chrome.permissions` wants for an endpoint's origin */
export function originPattern(url: string): string {
  const u = new URL(url)
  return `${u.protocol}//${u.hostname}/*`
}
