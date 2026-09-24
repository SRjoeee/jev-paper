// Copied from Read arXiv tests/sentences/lengths.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import type { WireFormat } from '@/core/protector'
import { sentenceCuts, type SplitContext } from '@/core/sentences'

/**
 * Sentence lengths, in order, summing exactly to `text.length` — the splitter's cuts in the shape an alignment has.
 * For the tests: production takes the cuts (`sentenceCuts`) and the service turns them into lengths while it marks the
 * text (`providers/sentence-markers.ts`). The exact partition is the contract: `verifyAlignment` rejects anything
 * that does not reconstruct the text it describes. A single length for text with no interior boundary
 */
export function splitSentences(text: string, format: WireFormat = 'tags', context: SplitContext = {}): number[] {
  if (text.length === 0) return []
  const lengths: number[] = []
  let prev = 0
  for (const cut of sentenceCuts(text, format, context)) {
    lengths.push(cut - prev)
    prev = cut
  }
  lengths.push(text.length - prev)
  return lengths
}
