/** Why a digest or a key check did not produce a result. `aborted` is never shown to the reader. */
export type ErrorCode = 'no-key' | 'invalid-key' | 'credit' | 'busy' | 'offline' | 'not-jev' | 'aborted'
