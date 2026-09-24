import type { Credentials, ProviderId } from '@/shared/credentials'

export interface Endpoint {
  url: string
  model: string
  /** Asked instead once `model` is rejected as unknown (spec §6.1). Presets only: a custom endpoint has none. */
  fallback?: string
  apiKey: string
}

// The presets pin the version the engine was tuned on (jev-1.13; docs.typesafe.ai/models: "pin that version's ID
// instead of the alias"), with the alias as the fallback for the day that version is retired (spec §6.1).
export const PRESETS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.13-20260917', fallback: '~typesafe/jev-latest', keys: 'https://openrouter.ai/keys' },
  // Not called live yet (no key): verify url, model and the key page when one exists (spec §6.1). The pinned id is
  // the one docs.typesafe.ai/models.md names for Jev 1.13 (read 2026-09-25).
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', fallback: 'jev-latest', keys: 'https://typesafe.ai' },
} as const

export function endpointOf(s: Pick<Credentials, 'provider' | 'baseUrl' | 'model' | 'apiKey'>): Endpoint {
  if (s.provider === 'custom') return { url: s.baseUrl.trim(), model: s.model.trim(), apiKey: s.apiKey.trim() }
  const preset = PRESETS[s.provider]
  return { url: preset.url, model: preset.model, fallback: preset.fallback, apiKey: s.apiKey.trim() }
}

export const keysUrl = (provider: ProviderId): string | null => (provider === 'custom' ? null : PRESETS[provider].keys)

/** The match pattern `chrome.permissions` wants for an endpoint's origin */
export function originPattern(url: string): string {
  const u = new URL(url)
  return `${u.protocol}//${u.hostname}/*`
}
