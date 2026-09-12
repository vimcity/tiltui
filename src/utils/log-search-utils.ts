// Log search utility functions

import type { LogSearchFilter } from "../components/log-buffer";

/**
 * Parse a search query into a LogSearchFilter.
 * If the query is wrapped in /.../, treat it as a regex.
 * Otherwise, treat it as a simple string match.
 */
export function parseSearchQuery(query: string): LogSearchFilter | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Check for regex syntax: /pattern/
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      const pattern = regexMatch[1];
      const flags = regexMatch[2] || "i"; // default to case-insensitive
      return {
        query: trimmed,
        isRegex: true,
        regex: new RegExp(pattern, flags),
      };
    } catch {
      // Invalid regex, fall through to string match
    }
  }

  // Simple string match (case-insensitive)
  return {
    query: trimmed,
    isRegex: false,
    regex: null,
  };
}
