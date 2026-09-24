// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateKey } from '@/background/jev/validate'
import { endpointOf, originPattern, PRESETS } from '@/background/jev/providers'
import { DEFAULT_CREDENTIALS } from '@/shared/credentials'

const endpoint = { url: 'https://jev.test/v1/systemone', model: 'm', apiKey: 'k' }

describe('validateKey', () => {
  it('accepts a key whose one-question request comes back as Jev', async () => {
    const reply = await validateKey(endpoint, { fetch: async () => new Response(JSON.stringify({ answers: { ok: { type: 'noul', noul: 0.9 } } })) })
    expect(reply).toEqual({ ok: true })
  })

  it('passes the client error code through', async () => {
    const reply = await validateKey(endpoint, { fetch: async () => new Response('nope', { status: 401 }) })
    expect(reply).toEqual({ ok: false, error: 'invalid-key' })
  })
})

describe('providers', () => {
  it('resolves the presets and a custom endpoint', () => {
    expect(endpointOf({ ...DEFAULT_CREDENTIALS, apiKey: ' k ' })).toEqual({ url: PRESETS.openrouter.url, model: 'typesafe/jev-1.13-20260917', fallback: '~typesafe/jev-latest', apiKey: 'k' })
    expect(endpointOf({ ...DEFAULT_CREDENTIALS, provider: 'typesafe', apiKey: 'k' })).toEqual({ url: PRESETS.typesafe.url, model: 'jev-1.13.0', fallback: 'jev-latest', apiKey: 'k' })
    const custom = endpointOf({ ...DEFAULT_CREDENTIALS, provider: 'custom', baseUrl: ' https://x.test/v1/systemone ', model: ' jev ', apiKey: 'k' })
    expect(custom).toEqual({ url: 'https://x.test/v1/systemone', model: 'jev', apiKey: 'k' })
    expect('fallback' in custom).toBe(false)
    expect(originPattern('https://x.test:8443/v1/systemone')).toBe('https://x.test/*')
  })
})
