// Adapted from Read arXiv src/core/protector/index.ts@3f3c91f8 (GPL-3.0), 2026-09-24: trimmed to the serialiser
// and the offset mapping; validation, rehydration and runs belong to translation.
export { VOID_DENSE_THRESHOLD, serialize, staleSlot, type ProtectedBlock } from './serialize'
export { fromAlpha, toAlpha, tokenize, writeVoid, MARKER_RE, TAG_RE, type Token, type WireFormat } from './tokens'
export { decodeText, escapeText, unescapeText } from './escape'
export { indexSpans, nodeOffsetAt, rangesOf, scanTokens, spanAt, wholeRanges, wireOffsetAt, type PositionedToken, type SpanIndex, type WireSpan } from './offsets'
