// LogBuffer - Manages log lines and virtual scrolling for FrameBuffer rendering
//
// This class handles:
// - Word-aware line wrapping with continuation indicators
// - Virtual scrolling (only renders visible rows)
// - Timestamp toggle support
// - Auto-scroll (follow) mode
// - Search filtering with match highlighting

import type { LogLine } from "../tilt/types";
import { displayWidth } from "../utils/ansi-parser";

/**
 * Search filter configuration for log filtering.
 */
export interface LogSearchFilter {
  /** The raw search query string */
  query: string;
  /** Whether this is a regex search */
  isRegex: boolean;
  /** Compiled regex if isRegex is true */
  regex: RegExp | null;
}

/**
 * A wrapped line with its display rows and source reference.
 */
interface WrappedLine {
  /** Reference to the original LogLine from logstore2 */
  line: LogLine;
  /** Pre-computed display rows (including continuation prefixes) */
  displayRows: string[];
  /** The starting virtual row index for this line */
  startRow: number;
}

/**
 * A match range within text for highlighting.
 */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * A single row visible in the viewport.
 */
export interface VisibleRow {
  /** The text to display (may include continuation prefix) */
  text: string;
  /** The log level for coloring (INFO, WARN, ERROR) */
  level: string;
  /** Whether this row is a continuation of the previous line */
  isContinuation: boolean;
  /** Reference to the source LogLine */
  line: LogLine;
  /** Match ranges for highlighting search results */
  matches?: MatchRange[];
}

/**
 * Manages log lines with word-aware wrapping and virtual scrolling.
 *
 * Design principles:
 * - Stores references to LogLine objects (owned by logstore2, not copied)
 * - Pre-computes wrapped rows for efficient scrolling
 * - Only returns rows visible in the current viewport
 * - Supports timestamp toggling with rewrap
 */
export class LogBuffer {
  /** References to LogLine objects from logstore2 */
  private lines: LogLine[] = [];

  /** Pre-computed wrapped lines with display rows */
  private wrappedLines: WrappedLine[] = [];

  /** Total number of display rows (sum of all wrapped row counts) */
  private totalDisplayRows: number = 0;

  /** Current scroll position (in display rows, not lines) */
  private _scrollTop: number = 0;

  /** Whether to auto-scroll to bottom when new lines are appended */
  private _autoScroll: boolean = true;

  /** Whether to show timestamps in the output */
  private _showTimestamps: boolean = true;

  /** Current search filter (null means no filtering) */
  private _searchFilter: LogSearchFilter | null = null;

  /** Indices of filtered lines that match the search (null means show all) */
  private filteredIndices: number[] | null = null;

  /** Pre-computed wrapped lines for filtered view */
  private filteredWrappedLines: WrappedLine[] = [];

  /** Total display rows in filtered view */
  private filteredTotalDisplayRows: number = 0;

  /** Checkpoint for incremental updates from LogStore */
  checkpoint: number = 0;

  /** Viewport width in characters */
  width: number = 80;

  /** Viewport height in rows */
  height: number = 24;

  // Constants
  private readonly CONTINUATION_PREFIX = "  ";
  private readonly CONTINUATION_PREFIX_WIDTH = 2;

  // --- Public API ---

  /**
   * Toggle timestamp display. Triggers full rewrap of all lines.
   */
  get showTimestamps(): boolean {
    return this._showTimestamps;
  }

  set showTimestamps(value: boolean) {
    if (this._showTimestamps !== value) {
      this._showTimestamps = value;
      this.recalculateWrapping();
    }
  }

  /**
   * Get the current search filter.
   */
  get searchFilter(): LogSearchFilter | null {
    return this._searchFilter;
  }

  /**
   * Set a search filter. Pass null to clear the filter.
   * Triggers recalculation of filtered lines.
   */
  set searchFilter(filter: LogSearchFilter | null) {
    this._searchFilter = filter;
    this.recalculateFiltering();
  }

  /**
   * Check if a search filter is active.
   */
  get isFiltering(): boolean {
    return this._searchFilter !== null;
  }

  /**
   * Get the number of matching lines when filtering is active.
   */
  get matchCount(): number {
    return this.filteredIndices?.length ?? 0;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.recalculateWrapping();
  }

  /**
   * Append new lines from LogStore patch.
   * Only wraps new lines - O(m) where m = new lines count.
   * Stores references to LogLine objects (does not copy).
   */
  appendLines(newLines: LogLine[]): void {
    for (const line of newLines) {
      const displayRows = this.wrapLine(line);
      this.wrappedLines.push({
        line,
        displayRows,
        startRow: this.totalDisplayRows,
      });
      this.totalDisplayRows += displayRows.length;
      this.lines.push(line);

      // If filtering is active, check if this line matches
      if (this._searchFilter) {
        if (
          line.buildEvent ||
          this.lineMatchesFilter(line, this._searchFilter)
        ) {
          const wrappedIndex = this.wrappedLines.length - 1;
          this.filteredIndices?.push(wrappedIndex);
          this.filteredWrappedLines.push({
            line,
            displayRows,
            startRow: this.filteredTotalDisplayRows,
          });
          this.filteredTotalDisplayRows += displayRows.length;
        }
      }
    }

    if (this._autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * Clear all lines and reset state.
   * Call this when switching resources or on truncation events.
   */
  clear(): void {
    this.lines = [];
    this.wrappedLines = [];
    this.totalDisplayRows = 0;
    this._scrollTop = 0;
    this.checkpoint = 0;
    // Clear filtered state
    this._searchFilter = null;
    this.filteredIndices = null;
    this.filteredWrappedLines = [];
    this.filteredTotalDisplayRows = 0;
  }

  /**
   * Recalculate wrapping for all lines.
   * Call this when viewport width or timestamp visibility changes.
   */
  recalculateWrapping(): void {
    // Preserve user's autoScroll preference across rewrap
    const wasAutoScroll = this._autoScroll;

    this.wrappedLines = [];
    this.totalDisplayRows = 0;

    for (const line of this.lines) {
      const displayRows = this.wrapLine(line);
      this.wrappedLines.push({
        line,
        displayRows,
        startRow: this.totalDisplayRows,
      });
      this.totalDisplayRows += displayRows.length;
    }

    // Clamp scroll position to valid range after rewrap
    const maxScroll = Math.max(0, this.totalDisplayRows - this.height);
    this._scrollTop = Math.max(0, Math.min(this._scrollTop, maxScroll));

    // Preserve autoScroll state if user explicitly disabled it (scrolled up)
    // Only re-enable autoScroll if it was already enabled AND we're at the bottom
    if (wasAutoScroll) {
      this._autoScroll = this._scrollTop >= maxScroll;
    }
    // If autoScroll was false (user scrolled up), keep it false

    // Also recalculate filtering if a filter is active
    if (this._searchFilter) {
      this.recalculateFiltering();
    }
  }

  /**
   * Recalculate which lines match the current search filter.
   * Called when filter changes or when lines are appended.
   */
  private recalculateFiltering(): void {
    if (!this._searchFilter) {
      this.filteredIndices = null;
      this.filteredWrappedLines = [];
      this.filteredTotalDisplayRows = 0;
      return;
    }

    const filter = this._searchFilter;
    this.filteredIndices = [];
    this.filteredWrappedLines = [];
    this.filteredTotalDisplayRows = 0;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      // Always include separator lines (buildEvent lines)
      if (line.buildEvent) {
        this.filteredIndices.push(i);
        const wrapped = this.wrappedLines[i];
        this.filteredWrappedLines.push({
          line: wrapped.line,
          displayRows: wrapped.displayRows,
          startRow: this.filteredTotalDisplayRows,
        });
        this.filteredTotalDisplayRows += wrapped.displayRows.length;
        continue;
      }

      // Check if line matches the filter
      if (this.lineMatchesFilter(line, filter)) {
        this.filteredIndices.push(i);
        const wrapped = this.wrappedLines[i];
        this.filteredWrappedLines.push({
          line: wrapped.line,
          displayRows: wrapped.displayRows,
          startRow: this.filteredTotalDisplayRows,
        });
        this.filteredTotalDisplayRows += wrapped.displayRows.length;
      }
    }

    // Reset scroll to top when filter changes (and enable auto-scroll if at bottom)
    this._scrollTop = 0;
    this._autoScroll = this.filteredTotalDisplayRows <= this.height;
  }

  /**
   * Check if a line matches the current filter.
   */
  private lineMatchesFilter(line: LogLine, filter: LogSearchFilter): boolean {
    if (filter.isRegex && filter.regex) {
      return filter.regex.test(line.text);
    }
    // Case-insensitive string match
    return line.text.toLowerCase().includes(filter.query.toLowerCase());
  }

  /**
   * Find all match ranges in a text string for the current filter.
   */
  private findMatchRanges(text: string): MatchRange[] {
    if (!this._searchFilter) return [];

    const matches: MatchRange[] = [];
    const filter = this._searchFilter;

    if (filter.isRegex && filter.regex) {
      // Ensure global flag for findAll
      const regex = new RegExp(
        filter.regex.source,
        filter.regex.flags.includes("g")
          ? filter.regex.flags
          : filter.regex.flags + "g",
      );
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
        });
        // Prevent infinite loop on zero-width matches
        if (match[0].length === 0) regex.lastIndex++;
      }
    } else {
      // Case-insensitive string search
      const needle = filter.query.toLowerCase();
      const haystack = text.toLowerCase();
      let idx = 0;
      while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        matches.push({ start: idx, end: idx + needle.length });
        idx += needle.length;
      }
    }

    return matches;
  }

  /**
   * Get rows currently visible in the viewport.
   * Returns an array of VisibleRow objects with text, level, and continuation info.
   * Uses binary search to find the starting line - O(log n + viewport) instead of O(n).
   * When filtering is active, only shows filtered lines with match highlighting.
   */
  getVisibleRows(): VisibleRow[] {
    const result: VisibleRow[] = [];

    // Use filtered wrapped lines if a filter is active
    const wrappedLines = this._searchFilter
      ? this.filteredWrappedLines
      : this.wrappedLines;

    if (wrappedLines.length === 0) {
      return result;
    }

    // Binary search to find the first wrapped line that contains visible rows
    const startIdx = this.findFirstVisibleLineIndexIn(
      wrappedLines,
      this._scrollTop,
    );

    for (let i = startIdx; i < wrappedLines.length; i++) {
      const wrapped = wrappedLines[i];

      for (let j = 0; j < wrapped.displayRows.length; j++) {
        const displayRow = wrapped.startRow + j;

        // Skip rows before viewport
        if (displayRow < this._scrollTop) {
          continue;
        }

        // Stop if past viewport
        if (displayRow >= this._scrollTop + this.height) {
          return result;
        }

        // Find match ranges for highlighting when filtering
        const matches = this._searchFilter
          ? this.findMatchRanges(wrapped.displayRows[j])
          : undefined;

        result.push({
          text: wrapped.displayRows[j],
          level: wrapped.line.level,
          isContinuation: j > 0,
          line: wrapped.line,
          matches,
        });
      }

      // Early exit if we've filled the viewport
      if (result.length >= this.height) {
        return result;
      }
    }

    return result;
  }

  /**
   * Binary search to find the index of the first wrapped line in a list that contains
   * rows at or after the given scrollTop position.
   */
  private findFirstVisibleLineIndexIn(
    wrappedLines: WrappedLine[],
    scrollTop: number,
  ): number {
    if (wrappedLines.length === 0) return 0;

    let lo = 0;
    let hi = wrappedLines.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const wrapped = wrappedLines[mid];
      const endRow = wrapped.startRow + wrapped.displayRows.length;

      if (endRow <= scrollTop) {
        // This line ends before the viewport, search later
        lo = mid + 1;
      } else {
        // This line contains or is after the viewport start
        hi = mid;
      }
    }

    return lo;
  }

  // --- Scroll API ---

  /**
   * Get the effective total display rows (filtered or all).
   */
  private getEffectiveTotalRows(): number {
    return this._searchFilter
      ? this.filteredTotalDisplayRows
      : this.totalDisplayRows;
  }

  /**
   * Scroll to an absolute position (in display rows).
   * Position is clamped to valid range.
   */
  scrollTo(position: number): void {
    const totalRows = this.getEffectiveTotalRows();
    const maxScroll = Math.max(0, totalRows - this.height);
    this._scrollTop = Math.max(0, Math.min(position, maxScroll));
    // Auto-scroll is enabled when we're at or near the bottom
    this._autoScroll = this._scrollTop >= maxScroll;
  }

  /**
   * Scroll by a relative amount (positive = down, negative = up).
   */
  scrollBy(delta: number): void {
    this.scrollTo(this._scrollTop + delta);
  }

  /**
   * Scroll to the bottom and enable auto-scroll.
   */
  scrollToBottom(): void {
    this.scrollTo(this.getEffectiveTotalRows());
  }

  /**
   * Scroll to the top and disable auto-scroll.
   */
  scrollToTop(): void {
    this.scrollTo(0);
    this._autoScroll = false;
  }

  // --- Properties ---

  /** Current scroll position in display rows */
  get scrollTop(): number {
    return this._scrollTop;
  }

  /** Total height in display rows (accounts for wrapping and filtering) */
  get scrollHeight(): number {
    return this.getEffectiveTotalRows();
  }

  /** Whether auto-scroll is enabled */
  get autoScroll(): boolean {
    return this._autoScroll;
  }

  set autoScroll(value: boolean) {
    this._autoScroll = value;
    if (value) {
      this.scrollToBottom();
    }
  }

  /** Number of original log lines (not display rows) */
  get lineCount(): number {
    return this.lines.length;
  }

  // --- Private Implementation ---

  /**
   * Wrap a line at word boundaries when possible.
   * Falls back to character wrap if a single word exceeds available width.
   */
  private wrapLine(line: LogLine): string[] {
    const prefix = this.getLinePrefix(line);
    // Carriage returns are terminal cursor instructions, not printable log text.
    // Keeping them in a framebuffer row makes suffixes appear to wrap backward.
    const text = line.text.replace(/\r/g, "");
    const fullLine = prefix + text;

    // Reserve 1 char for scrollbar
    const availableWidth = this.width - 1;

    // If line fits, no wrapping needed
    if (displayWidth(fullLine) <= availableWidth) {
      return [fullLine];
    }

    const rows: string[] = [];
    const continuationWidth = availableWidth - this.CONTINUATION_PREFIX_WIDTH;

    // First row gets full width
    const firstResult = this.wrapAtWord(fullLine, availableWidth);
    rows.push(firstResult.wrapped);
    let remaining = firstResult.remaining;

    // Continuation rows get reduced width (for ↳ prefix)
    while (remaining.length > 0) {
      const result = this.wrapAtWord(remaining, continuationWidth);
      rows.push(this.CONTINUATION_PREFIX + result.wrapped);
      remaining = result.remaining;
    }

    return rows;
  }

  /**
   * Wrap text at word boundary, falling back to character wrap.
   * Returns the wrapped portion and the remaining text.
   */
  private wrapAtWord(
    text: string,
    maxWidth: number,
  ): { wrapped: string; remaining: string } {
    // If text fits, return it all
    if (displayWidth(text) <= maxWidth) {
      return { wrapped: text, remaining: "" };
    }

    // Find the last space within maxWidth, accounting for ANSI codes
    let breakPoint = -1;
    let currentWidth = 0;
    let lastCharIndex = 0;
    let inEscape = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Handle ANSI escape sequences - don't count them in width
      if (char === "\x1B") {
        inEscape = true;
        continue;
      }
      if (inEscape) {
        // End of SGR sequence
        if (char === "m") {
          inEscape = false;
        }
        continue;
      }

      // We've exceeded the width, stop here
      if (currentWidth >= maxWidth) {
        break;
      }

      // Track word boundaries
      if (char === " ") {
        breakPoint = i;
      }

      currentWidth++;
      lastCharIndex = i + 1;
    }

    // If no space found or space is at start, fall back to character wrap
    if (breakPoint <= 0) {
      return {
        wrapped: text.slice(0, lastCharIndex),
        remaining: text.slice(lastCharIndex),
      };
    }

    // Word wrap at space (skip the space itself)
    return {
      wrapped: text.slice(0, breakPoint),
      remaining: text.slice(breakPoint + 1),
    };
  }

  /**
   * Get the line prefix (timestamp if enabled).
   */
  private getLinePrefix(line: LogLine): string {
    if (!this._showTimestamps) {
      return "";
    }
    const timestamp = this.formatTimestamp(line.time);
    return `[${timestamp}] `;
  }

  /**
   * Format a timestamp string for display.
   */
  private formatTimestamp(time: string | undefined): string {
    if (!time) {
      return "??:??:??";
    }
    try {
      const t = new Date(time);
      return t.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "??:??:??";
    }
  }
}
