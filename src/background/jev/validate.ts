import type { ValidateReply } from '@/shared/messages'
import { type ClientOptions, createClient, JevError } from './client'
import type { Endpoint } from './providers'
import { yesno } from './wire'

/** One one-question request (a fraction of a cent): does this endpoint answer as Jev with this key? */
export async function validateKey(endpoint: Endpoint, options: ClientOptions = {}): Promise<ValidateReply> {
  const ask = createClient(endpoint, { maxAttempts: 2, timeoutMs: 10_000, ...options })
  try {
    // The client checks the answer is a yes/no one, or throws not-jev
    await ask({ text: 'JevPaper' }, { ok: yesno('Is `text` a word?') })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof JevError ? error.code : 'offline' }
  }
}
