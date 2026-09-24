export type Role = 'method' | 'result' | 'contribution' | 'background'
/** The roles a claim is shown with: a claim is never labelled background */
export type ClaimRole = Exclude<Role, 'background'>
export type CaveatType = 'assumption' | 'condition' | 'limitation' | 'evaluation' | 'unsupported' | 'tradeoff'

export interface ClaimResult {
  /** An abstract sentence */
  sid: string
  /** Probability that the sentence is a claim of this paper (1 − P(background)) */
  pClaim: number
  /** The top non-background role when the answer is confident enough (share ≥ 0.7), else null (the tip says 「主张」) */
  role: ClaimRole | null
  /** Body sentences ranked as where the claim is delivered, best first (top 8) */
  ranked: [sid: string, score: number][]
}

export type CaveatResult = [sid: string, score: number, type: CaveatType | null]

export interface DigestResult {
  claims: ClaimResult[]
  /** Best first, top 40 */
  caveats: CaveatResult[]
  /** The versioned model(s) that answered, as the responses named them. Diagnostics only; never shown. */
  model?: string
}
