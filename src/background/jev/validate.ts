import type { ValidateReply } from '@/shared/messages'
import { type ClientOptions, createClient, JevError } from './client'
import type { Endpoint } from './providers'
import { yesno } from './wire'

/** One one-question request (a fraction of a cent): does this endpoint answer as Jev with this key? */
export async function validateKey(endpoint: Endpoint, options: ClientOptions = {}): Promise<ValidateReply> {
  const ask = createClient(endpoint, { maxAttempts: 2, timeoutMs: 10_000, ...options })
  try {
    const answers = await ask({ text: 'JevPaper' }, { ok: yesno('Is `text` a word?') })
    return answers.ok?.type === 'boolean' ? { ok: true } : { ok: false, error: 'not-jev' }
  } catch (error) {
    return { ok: false, error: error instanceof JevError ? error.code : 'offline' }
  }
}
