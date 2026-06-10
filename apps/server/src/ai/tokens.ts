/**
 * Approximate token counting: 4 characters per token, the standard heuristic
 * for English text. Used for context budgeting and quota accounting, where
 * being within 20 percent is sufficient. Exact provider token counts from
 * API responses are preferred wherever the provider reports them.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
