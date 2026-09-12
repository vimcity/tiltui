// Fuzzy match utility for filterable lists
// Each character in needle must appear in haystack in order.
// Returns a score (lower is better) or null if no match.

export function fuzzyMatch(needle: string, haystack: string): number | null {
  const needleLower = needle.toLowerCase();
  const haystackLower = haystack.toLowerCase();

  let score = 0;
  let haystackIdx = 0;

  for (const char of needleLower) {
    const foundIdx = haystackLower.indexOf(char, haystackIdx);
    if (foundIdx === -1) return null;

    score += foundIdx - haystackIdx;
    haystackIdx = foundIdx + 1;
  }

  return score;
}
