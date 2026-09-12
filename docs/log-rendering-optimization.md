# Log Rendering Optimization Plan

## Overview

This document outlines a plan to improve log rendering performance in the Tilt TUI application by replacing JSX-based component rendering with OpenTUI's `FrameBufferRenderable` for direct character-level drawing.

## Problem Analysis

### Current Implementation Issues

1. **JSX Component Per Line** (`src/components/resourceview.tsx:221-223`)
   - Each log line creates a `<LogLine>` component with:
     - `<box>` wrapper
     - `<text>` element
     - 4 `createMemo()` computations per line (timestamp, textColor, displayText, fullLine)
   - With 10,000 logs = 10,000 components + 40,000+ memos

2. **Array Spreading on Updates** (`src/components/resourceview.tsx:71`)

   ```tsx
   setRenderedLines((prev) => [...prev, ...patch.lines]);
   ```

   - Creates new array on every update
   - O(n) memory allocation per update

3. **Solid Reconciliation Overhead**
   - Solid's `<For>` tracks each item for fine-grained updates
   - Terminal UI doesn't need DOM diffing - logs are append-only
   - Scrollbox must manage layout for all children

### Symptoms

- Frame rate drops when log count exceeds ~1000 lines
- Noticeable lag when scrolling through large log buffers
- Memory usage grows linearly with log count

## Design Decisions

| Feature                | Decision                                        |
| ---------------------- | ----------------------------------------------- |
| Data source            | Use `logstore2.ts` (full Tilt-style LogStore)   |
| ANSI colors            | Preserve and render with per-character coloring |
| Long lines             | Word-aware wrapping with visual indicators      |
| Continuation indicator | `↳` (arrow down-right)                          |
| Continuation styling   | Dimmed text color                               |
| Scrolling              | Row-by-row (accounts for wrapped lines)         |
| Scrollbox              | Full replacement with custom vertical scrollbar |
| Timestamps             | Toggleable via `t` key, global setting          |

## Inspiration

### Tilt Web App (`OverviewLogPane.tsx`)

The Tilt web app solves this with:

1. **Direct DOM manipulation** - bypasses React reconciliation entirely
2. **Windowed rendering** (`renderWindow = 250`) - renders in batches via RAF
3. **Forward/backward buffers** - prioritizes visible content, renders rest async
4. **LineHashList** - O(1) line lookup by stored index
5. **RequestAnimationFrame batching** - prevents frame drops during bulk updates

### OpenTUI FrameBuffer

From the FrameBuffer documentation and demo:

- `FrameBufferRenderable` provides a low-level 2D rendering surface
- Direct cell manipulation via `drawText()`, `setCell()`, `fillRect()`
- No component reconciliation - just character arrays
- Supports transparency and layering via `respectAlpha`

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  ResourceView (JSX - unchanged structure)           │
│  ┌───────────────────────────────────────────────┐  │
│  │  LogBufferView (New Component)                │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  FrameBufferRenderable                  │  │  │
│  │  │  - Direct character drawing             │  │  │
│  │  │  - Word-aware line wrapping             │  │  │
│  │  │  - ANSI color preservation              │  │  │
│  │  │  - Custom scrollbar                     │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  LogBuffer (class)                            │  │
│  │  - Manages virtual scroll position            │  │
│  │  - Calculates wrapped display rows            │  │
│  │  - Toggleable timestamp display               │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Data Source: logstore2.ts

### Why logstore2.ts Instead of logstore.ts

The optimization uses `src/tilt/logstore2.ts` as the data source instead of `src/tilt/logstore.ts`. The `logstore2.ts` implementation is a complete port of the Tilt web app's LogStore with important features:

#### Feature Comparison

| Feature            | logstore.ts (simple)    | logstore2.ts (full)                                    |
| ------------------ | ----------------------- | ------------------------------------------------------ |
| Line Continuation  | No - 1 segment = 1 line | Yes - segments combine into lines                      |
| Progress Overwrite | No                      | Yes - `progressID` field support                       |
| Span Tracking      | Simple map              | Full `LogSpan` with first/last indices                 |
| Alert Indexing     | No                      | Yes - `LogAlert` for WARN/ERROR                        |
| Log Truncation     | No                      | Yes - `ensureMaxLength()` with smart truncation        |
| Update Callbacks   | No (uses signal)        | Yes - `addUpdateListener()` / `removeUpdateListener()` |
| Line Cache         | No                      | Yes - `lineCache` prevents redundant object creation   |
| Build Span Support | No                      | Yes - `isBuildSpanId()`, `traceLog()`                  |

#### Key Features to Leverage

**1. Line Continuation Logic**

```typescript
// Segments with same spanId/level combine into one line
if (line.isComplete() || !line.canContinueLine(candidate)) {
  isStartingNewLine = true;
} else {
  line.text += candidate.text; // Append to existing line
}
```

**2. Progress Line Overwriting**

```typescript
// Lines with progressID can overwrite previous lines with same ID
// Used for progress bars, spinners, etc.
private maybeOverwriteLine(candidate: StoredLine, span: LogSpan): number
```

**3. Smart Log Truncation**

```typescript
// When logs exceed maxLength (2MB default), truncate older logs per-manifest
// Weights by recency AND size to balance short critical logs vs verbose logs
ensureMaxLength();
heaviestManifestName();
```

1. Special Spans

```typescript
// Special spans are ones with a buildSpanId or traceLog attribute.
// these can be given special rendering treatment in the logs view
isBuildSpanId();
isTraceLog();
```

#### Reactivity Adaptation

`logstore2.ts` uses callbacks instead of SolidJS signals. Bridge this in `LogBufferView`:

```typescript
import LogStore, {
  LogUpdateAction,
  type LogUpdateEvent,
  type LogLine,
} from "../tilt/logstore2";

// In LogBufferView component:
onMount(() => {
  const handleUpdate = (e: LogUpdateEvent) => {
    if (e.action === LogUpdateAction.truncate) {
      // Full reset - logs were truncated
      buffer.clear();
      buffer.checkpoint = 0;
    }

    // Fetch new/updated lines
    const patch = logStore.manifestLogPatchSet(manifestName, buffer.checkpoint);
    if (patch.lines.length > 0 || e.action === LogUpdateAction.truncate) {
      buffer.appendLines(patch.lines);
      buffer.checkpoint = patch.checkpoint;
      setRenderVersion((v) => v + 1);
    }
  };

  logStore.addUpdateListener(handleUpdate);
  onCleanup(() => logStore.removeUpdateListener(handleUpdate));
});
```

#### Type Alignment

Use `logstore2.ts` types directly in `LogBuffer`:

```typescript
// logstore2.ts exports
export type LogLine = {
  text: string;
  level: LogLevel;
  manifestName: string;
  buildEvent?: string;
  spanId: string;
  storedLineIndex: number;
};

// LogBuffer stores references to LogLine, not copies
class LogBuffer {
  private lines: LogLine[] = []; // References to logstore2's cached lines

  appendLines(newLines: LogLine[]): void {
    for (const line of newLines) {
      this.lines.push(line); // Store reference, don't copy
      // Wrap for display...
    }
  }
}
```

#### Handling Truncation Events

When logs exceed `maxLogLength` (default 2MB), `logstore2.ts` truncates older logs intelligently. The UI must handle this:

```typescript
// LogUpdateAction.truncate means the log store was rebuilt
// All checkpoints are invalidated - must reset and re-fetch
if (e.action === LogUpdateAction.truncate) {
  buffer.clear();
  buffer.checkpoint = 0;

  // Re-fetch all lines for this manifest from scratch
  const patch = logStore.manifestLogPatchSet(manifestName, 0);
  buffer.appendLines(patch.lines);
  buffer.checkpoint = patch.checkpoint;
}
```

## Implementation Plan

### Phase 1: LogBuffer Class

**File:** `src/components/log-buffer.ts`

```typescript
import type { LogLine } from "../tilt/logstore2";

interface WrappedLine {
  line: LogLine;
  displayRows: string[];
  startRow: number;
}

interface VisibleRow {
  text: string;
  levelColor: string;
  isContinuation: boolean;
  ansiSegments?: AnsiSegment[];
}

/**
 * Manages log lines and virtual scrolling state.
 * Handles word-aware wrapping and timestamp toggling.
 * Uses LogLine references from logstore2 (doesn't copy data).
 */
export class LogBuffer {
  private lines: LogLine[] = [];
  private wrappedLines: WrappedLine[] = [];
  private totalDisplayRows: number = 0;

  private _scrollTop: number = 0;
  private _autoScroll: boolean = true;
  private _showTimestamps: boolean = true;

  // Checkpoint for incremental updates from LogStore
  checkpoint: number = 0;

  // Viewport dimensions (set by component)
  width: number = 80;
  height: number = 24;

  // Constants
  private readonly CONTINUATION_PREFIX = "↳ ";
  private readonly TIMESTAMP_FORMAT = "[HH:MM:SS] ";

  /**
   * Toggle timestamp display. Triggers full rewrap.
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
   * Append new lines from LogStore patch.
   * Only wraps new lines - O(m) where m = new lines.
   * Stores references to LogLine objects (owned by logstore2).
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
    }

    if (this._autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * Clear all lines (e.g., when switching resources).
   */
  clear(): void {
    this.lines = [];
    this.wrappedLines = [];
    this.totalDisplayRows = 0;
    this._scrollTop = 0;
    this.checkpoint = 0;
  }

  /**
   * Recalculate wrapping for all lines.
   * Called when width or timestamp visibility changes.
   */
  recalculateWrapping(): void {
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

    // Clamp scroll position
    this.scrollTo(this._scrollTop);
  }

  /**
   * Get rows currently visible in viewport.
   */
  getVisibleRows(): VisibleRow[] {
    const result: VisibleRow[] = [];

    for (const wrapped of this.wrappedLines) {
      for (let i = 0; i < wrapped.displayRows.length; i++) {
        const displayRow = wrapped.startRow + i;

        if (displayRow >= this._scrollTop + this.height) {
          return result; // Past viewport
        }

        if (displayRow >= this._scrollTop) {
          result.push({
            text: wrapped.displayRows[i],
            levelColor: wrapped.line.level,
            isContinuation: i > 0,
          });
        }
      }
    }

    return result;
  }

  /**
   * Wrap a line at word boundaries when possible.
   * Falls back to character wrap if a single word exceeds width.
   */
  private wrapLine(line: LogLine): string[] {
    const prefix = this.getLinePrefix(line);
    const text = line.text;
    const fullLine = prefix + text;
    const width = this.width - 1; // Reserve 1 char for scrollbar

    if (this.displayWidth(fullLine) <= width) {
      return [fullLine];
    }

    const rows: string[] = [];
    const continuationWidth =
      width - this.displayWidth(this.CONTINUATION_PREFIX);

    // First row gets full width
    const firstResult = this.wrapAtWord(fullLine, width);
    rows.push(firstResult.wrapped);
    let remaining = firstResult.remaining;

    // Continuation rows get reduced width
    while (remaining.length > 0) {
      const result = this.wrapAtWord(remaining, continuationWidth);
      rows.push(this.CONTINUATION_PREFIX + result.wrapped);
      remaining = result.remaining;
    }

    return rows;
  }

  /**
   * Wrap text at word boundary, falling back to character wrap.
   */
  private wrapAtWord(
    text: string,
    maxWidth: number,
  ): { wrapped: string; remaining: string } {
    if (this.displayWidth(text) <= maxWidth) {
      return { wrapped: text, remaining: "" };
    }

    // Find last space within maxWidth
    let breakPoint = -1;
    let currentWidth = 0;
    let lastCharIndex = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Skip ANSI escape sequences
      if (char === "\x1B") {
        const match = text
          .slice(i)
          .match(/^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/);
        if (match) {
          i += match[0].length - 1;
          continue;
        }
      }

      if (currentWidth >= maxWidth) {
        break;
      }

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

    // Word wrap at space
    return {
      wrapped: text.slice(0, breakPoint),
      remaining: text.slice(breakPoint + 1), // Skip the space
    };
  }

  private getLinePrefix(line: LogLine): string {
    if (!this._showTimestamps) {
      return "";
    }
    const timestamp = this.formatTimestamp(line.time);
    return `[${timestamp}] `;
  }

  private formatTimestamp(time: string): string {
    const t = new Date(time);
    return t.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /**
   * Calculate display width, ignoring ANSI escape sequences.
   */
  private displayWidth(text: string): number {
    const stripped = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
    return stripped.length;
  }

  // Scroll API
  scrollTo(position: number): void {
    const maxScroll = Math.max(0, this.totalDisplayRows - this.height);
    this._scrollTop = Math.max(0, Math.min(position, maxScroll));
    this._autoScroll = this._scrollTop >= maxScroll;
  }

  scrollBy(delta: number): void {
    this.scrollTo(this._scrollTop + delta);
  }

  scrollToBottom(): void {
    this.scrollTo(this.totalDisplayRows);
  }

  scrollToTop(): void {
    this.scrollTo(0);
    this._autoScroll = false;
  }

  // Properties
  get scrollTop(): number {
    return this._scrollTop;
  }
  get scrollHeight(): number {
    return this.totalDisplayRows;
  }
  get autoScroll(): boolean {
    return this._autoScroll;
  }
  set autoScroll(value: boolean) {
    this._autoScroll = value;
    if (value) this.scrollToBottom();
  }
  get lineCount(): number {
    return this.lines.length;
  }
}
```

### Phase 2: ANSI Parser Utility

**File:** `src/utils/ansi-parser.ts`

```typescript
import { RGBA } from "@opentui/core";

export interface AnsiSegment {
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

// Standard ANSI color palette
const ANSI_COLORS: Record<number, string> = {
  30: "#000000",
  31: "#cc0000",
  32: "#00cc00",
  33: "#cccc00",
  34: "#0000cc",
  35: "#cc00cc",
  36: "#00cccc",
  37: "#cccccc",
  90: "#666666",
  91: "#ff0000",
  92: "#00ff00",
  93: "#ffff00",
  94: "#0000ff",
  95: "#ff00ff",
  96: "#00ffff",
  97: "#ffffff",
};

/**
 * Parse text with ANSI escape codes into segments with color information.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const regex = /\x1B\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentFg: RGBA | undefined;
  let currentBg: RGBA | undefined;
  let bold = false;
  let dim = false;

  let match;
  while ((match = regex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        fg: currentFg,
        bg: currentBg,
        bold,
        dim,
      });
    }

    // Parse SGR parameters
    const params = match[1].split(";").map(Number);
    for (const param of params) {
      if (param === 0) {
        // Reset
        currentFg = undefined;
        currentBg = undefined;
        bold = false;
        dim = false;
      } else if (param === 1) {
        bold = true;
      } else if (param === 2) {
        dim = true;
      } else if (param >= 30 && param <= 37) {
        currentFg = RGBA.fromHex(ANSI_COLORS[param]);
      } else if (param >= 90 && param <= 97) {
        currentFg = RGBA.fromHex(ANSI_COLORS[param]);
      } else if (param >= 40 && param <= 47) {
        currentBg = RGBA.fromHex(ANSI_COLORS[param - 10]);
      }
      // TODO: 256-color and true color support (38;5;n and 38;2;r;g;b)
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      fg: currentFg,
      bg: currentBg,
      bold,
      dim,
    });
  }

  return segments;
}
```

### Phase 3: LogBufferView Component

**File:** `src/components/log-buffer-view.tsx`

```tsx
import { FrameBufferRenderable, RGBA } from "@opentui/core";
import { useRenderer, onResize } from "@opentui/solid";
import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  on,
} from "solid-js";
import { LogBuffer } from "./log-buffer";
import { parseAnsi } from "../utils/ansi-parser";
import LogStore, {
  LogUpdateAction,
  type LogUpdateEvent,
} from "../tilt/logstore2";
import type { Theme } from "../theme/theme";

export interface LogBufferViewProps {
  logStore: LogStore;
  manifestName: () => string | null;
  theme: Theme;
  showTimestamps: () => boolean;
  onAutoScrollChange?: (autoScroll: boolean) => void;
}

export interface LogBufferViewRef {
  scrollBy: (delta: number) => void;
  scrollTo: (position: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  toggleAutoScroll: () => void;
  readonly autoScroll: boolean;
  readonly scrollTop: number;
  readonly scrollHeight: number;
}

export function LogBufferView(
  props: LogBufferViewProps,
): [() => JSX.Element, LogBufferViewRef] {
  const renderer = useRenderer();

  const [width, setWidth] = createSignal(80);
  const [height, setHeight] = createSignal(20);
  const [renderVersion, setRenderVersion] = createSignal(0);

  const buffer = new LogBuffer();
  let frameBuffer: FrameBufferRenderable | null = null;
  let containerEl: any = null;

  // Pre-compute colors from theme
  const colors = createMemo(() => ({
    bg: RGBA.fromHex(props.theme.background),
    text: RGBA.fromHex(props.theme.text),
    textMuted: RGBA.fromHex(props.theme.textMuted),
    warn: RGBA.fromHex(props.theme.warning),
    error: RGBA.fromHex(props.theme.error),
    accent: RGBA.fromHex(props.theme.accent),
    scrollTrack: RGBA.fromHex(props.theme.textMuted),
    scrollThumb: RGBA.fromHex(props.theme.primary),
  }));

  function getLevelColor(level: string): RGBA {
    switch (level) {
      case "WARN":
        return colors().warn;
      case "ERROR":
        return colors().error;
      default:
        return colors().text;
    }
  }

  onMount(() => {
    createFrameBuffer();

    // Subscribe to logstore2 updates via callback
    const handleLogUpdate = (e: LogUpdateEvent) => {
      const name = props.manifestName();
      if (!name) return;

      if (e.action === LogUpdateAction.truncate) {
        // Full reset - logs were truncated, all checkpoints invalidated
        buffer.clear();
        buffer.checkpoint = 0;
      }

      // Fetch new/updated lines
      const patch = props.logStore.manifestLogPatchSet(name, buffer.checkpoint);
      if (patch.lines.length > 0 || e.action === LogUpdateAction.truncate) {
        buffer.appendLines(patch.lines);
        buffer.checkpoint = patch.checkpoint;
        setRenderVersion((v) => v + 1);
      }
    };

    props.logStore.addUpdateListener(handleLogUpdate);
    onCleanup(() => props.logStore.removeUpdateListener(handleLogUpdate));
  });

  onCleanup(() => {
    if (frameBuffer) {
      renderer.root.remove(frameBuffer.id);
      frameBuffer = null;
    }
  });

  function createFrameBuffer(): void {
    if (frameBuffer) {
      renderer.root.remove(frameBuffer.id);
    }

    const w = width();
    const h = height();

    frameBuffer = new FrameBufferRenderable(renderer, {
      id: `log-buffer-${props.manifestName() ?? "default"}-${Date.now()}`,
      width: w,
      height: h,
      position: "relative",
    });

    buffer.width = w;
    buffer.height = h;

    if (containerEl) {
      containerEl.add(frameBuffer);
    }

    renderVisibleLines();
  }

  // Handle resize
  onResize(() => {
    if (containerEl) {
      const w = containerEl.width ?? 80;
      const h = containerEl.height ?? 20;

      if (w !== width() || h !== height()) {
        setWidth(w);
        setHeight(h);
        buffer.width = w;
        buffer.height = h;
        buffer.recalculateWrapping();

        if (frameBuffer) {
          frameBuffer.frameBuffer.resize(w, h);
        }

        setRenderVersion((v) => v + 1);
      }
    }
  });

  // Reset when manifest changes
  createEffect(
    on(
      () => props.manifestName(),
      () => {
        buffer.clear();
        createFrameBuffer();
      },
    ),
  );

  // Handle timestamp toggle
  createEffect(
    on(
      () => props.showTimestamps(),
      (show) => {
        buffer.showTimestamps = show;
        setRenderVersion((v) => v + 1);
      },
    ),
  );

  // Note: Log fetching is handled by the callback registered in onMount
  // The logstore2 uses callbacks instead of SolidJS signals for reactivity

  // Render when version changes
  createEffect(() => {
    renderVersion();
    renderVisibleLines();
  });

  function renderVisibleLines(): void {
    if (!frameBuffer) return;

    const fb = frameBuffer.frameBuffer;
    const w = width();
    const h = height();
    const c = colors();

    // Clear buffer
    fb.fillRect(0, 0, w, h, c.bg);

    // Get visible rows
    const rows = buffer.getVisibleRows();

    // Draw each row
    for (let y = 0; y < h && y < rows.length; y++) {
      const row = rows[y];

      if (row.isContinuation) {
        // Draw continuation indicator
        fb.drawText("↳", 0, y, c.accent, c.bg);

        // Draw rest of line dimmed, preserving ANSI colors
        drawAnsiText(fb, row.text.slice(2), 2, y, c.textMuted, c.bg, true);
      } else {
        // Draw normal line with level color as default
        const levelColor = getLevelColor(row.levelColor);
        drawAnsiText(fb, row.text, 0, y, levelColor, c.bg, false);
      }
    }

    // Draw scrollbar
    drawScrollbar(fb, w, h, c);
  }

  function drawAnsiText(
    fb: any,
    text: string,
    startX: number,
    y: number,
    defaultFg: RGBA,
    bg: RGBA,
    dimmed: boolean,
  ): void {
    const segments = parseAnsi(text);
    let x = startX;

    for (const segment of segments) {
      let fg = segment.fg ?? defaultFg;

      // Apply dimming by reducing alpha or using muted color
      if (dimmed && !segment.fg) {
        fg = colors().textMuted;
      }

      for (const char of segment.text) {
        if (x >= width() - 1) break; // Reserve scrollbar column
        fb.setCell(x, y, char, fg, bg);
        x++;
      }
    }
  }

  function drawScrollbar(
    fb: any,
    w: number,
    h: number,
    c: ReturnType<typeof colors>,
  ): void {
    const totalRows = buffer.scrollHeight;
    if (totalRows <= h) return; // No scrollbar needed

    const scrollbarX = w - 1;
    const thumbRatio = h / totalRows;
    const thumbSize = Math.max(1, Math.floor(h * thumbRatio));
    const thumbPos = Math.floor(
      (buffer.scrollTop / Math.max(1, totalRows - h)) * (h - thumbSize),
    );

    for (let y = 0; y < h; y++) {
      const isThumb = y >= thumbPos && y < thumbPos + thumbSize;
      const char = isThumb ? "█" : "░";
      const color = isThumb ? c.scrollThumb : c.scrollTrack;
      fb.setCell(scrollbarX, y, char, color, c.bg);
    }
  }

  // Ref API
  const ref: LogBufferViewRef = {
    scrollBy: (delta: number) => {
      buffer.scrollBy(delta);
      props.onAutoScrollChange?.(buffer.autoScroll);
      setRenderVersion((v) => v + 1);
    },
    scrollTo: (position: number) => {
      buffer.scrollTo(position);
      props.onAutoScrollChange?.(buffer.autoScroll);
      setRenderVersion((v) => v + 1);
    },
    scrollToTop: () => {
      buffer.scrollToTop();
      props.onAutoScrollChange?.(buffer.autoScroll);
      setRenderVersion((v) => v + 1);
    },
    scrollToBottom: () => {
      buffer.scrollToBottom();
      props.onAutoScrollChange?.(buffer.autoScroll);
      setRenderVersion((v) => v + 1);
    },
    toggleAutoScroll: () => {
      buffer.autoScroll = !buffer.autoScroll;
      props.onAutoScrollChange?.(buffer.autoScroll);
      setRenderVersion((v) => v + 1);
    },
    get autoScroll() {
      return buffer.autoScroll;
    },
    get scrollTop() {
      return buffer.scrollTop;
    },
    get scrollHeight() {
      return buffer.scrollHeight;
    },
  };

  const Component = () => (
    <box
      ref={(el: any) => {
        containerEl = el;
        if (el && frameBuffer) {
          el.add(frameBuffer);
        }
      }}
      flexGrow={1}
    />
  );

  return [Component, ref];
}
```

### Phase 4: Integration with ResourceView

**Modify:** `src/components/resourceview.tsx`

Key changes:

1. Add global timestamp toggle state (in TiltContext or local signal)
2. Replace scrollbox + For loop with LogBufferView
3. Update keyboard handlers to use LogBufferView ref
4. Add `t` keybinding for timestamp toggle

```tsx
// Add to keyboard handler
case Commands.TOGGLE_TIMESTAMPS:
  setShowTimestamps((s) => !s);
  break;

// Replace scrollbox section with:
<Show when={state.selectedResource}>
  {(() => {
    const [LogView, logRef] = LogBufferView({
      logStore,
      manifestName: () => state.selectedResource,
      theme,
      showTimestamps,
      onAutoScrollChange: setAutoScroll,
    });

    // Store ref for keyboard handlers
    logBufferRef = logRef;

    return <LogView />;
  })()}
</Show>
```

## Tasks

### High Priority

#### Data Source Migration

- [ ] Update TiltContext to use `logstore2.ts` instead of `logstore.ts`
- [ ] Add callback-based update listener in LogBufferView
- [ ] Handle `LogUpdateAction.truncate` events - reset buffer state
- [ ] Use `LogLine` type from logstore2 in LogBuffer
- [ ] Test with progress lines (spinners, build progress)

#### Core Implementation

- [ ] Create `LogBuffer` class (`src/components/log-buffer.ts`)
  - Word-aware wrapping algorithm
  - Virtual row calculation
  - Timestamp toggle support
  - Scroll state management
  - Store `LogLine` references (not copies)

- [ ] Create ANSI parser utility (`src/utils/ansi-parser.ts`)
  - Parse SGR escape sequences
  - Support standard 16 colors
  - Return segments with color info

- [ ] Create `LogBufferView` component (`src/components/log-buffer-view.tsx`)
  - FrameBufferRenderable integration
  - Render visible rows with ANSI colors
  - Continuation indicators with dimmed text
  - Vertical scrollbar rendering
  - Subscribe to logstore2 via `addUpdateListener()`

- [ ] Implement scroll handling
  - `scrollBy(rows)` - row-based scrolling
  - `scrollTo(row)` - absolute positioning
  - `scrollToTop()` / `scrollToBottom()`
  - Auto-scroll (follow) mode

- [ ] Add keyboard navigation
  - `j`/`k` or `↓`/`↑` - scroll by 1 row
  - `Page Up`/`Page Down` - scroll by half viewport
  - `g`/`G` - top/bottom
  - `f` - toggle follow mode
  - `t` - toggle timestamps

- [ ] Replace scrollbox in ResourceView with LogBufferView

### Medium Priority

- [ ] Handle terminal resize
  - Recalculate wrapping on width change
  - Preserve scroll position relative to content
  - Resize FrameBuffer

- [ ] Remove `logstore.ts` after migration is complete and verified

### Testing

- [ ] Add stress test resources to a local test Tiltfile
  - `log-stress-10k` - 10k lines rapid load
  - `log-stream-continuous` - continuous streaming at 100/sec
  - `log-long-lines` - word wrapping test
  - `log-ansi-colors` - ANSI color preservation test
  - `log-progress-test` - progress line overwriting
  - `log-mixed-levels` - WARN/ERROR level coloring

- [ ] Unit tests for `logstore2.ts` (`src/tilt/logstore2.test.ts`)
  - Segment appending and line creation
  - Line continuation logic
  - Checkpoint deduplication
  - Alert indexing
  - Incremental patch sets
  - Manifest filtering
  - Truncation behavior
  - Span removal

- [ ] Unit tests for `LogBuffer` (`src/components/log-buffer.test.ts`)
  - Word wrapping algorithm
  - Character wrap fallback
  - Timestamp toggle and rewrap
  - Scroll position management
  - Auto-scroll behavior
  - Clear/reset state
  - Visible row calculation

- [ ] Unit tests for ANSI parser (`src/utils/ansi-parser.test.ts`)
  - Plain text passthrough
  - Standard colors (30-37)
  - Bright colors (90-97)
  - Bold/dim attributes
  - Reset code handling
  - Multiple attributes

- [ ] Performance benchmarks (`src/components/log-buffer.bench.ts`)
  - appendLines with 1k, 10k lines
  - Long line wrapping performance
  - getVisibleRows with large buffer
  - Scroll + render cycle
  - recalculateWrapping performance

### Low Priority (Future)

- [ ] Search highlighting
- [ ] Line selection / copy
- [ ] Wide character support (CJK, emoji)
- [ ] 256-color and true color ANSI support

## Testing Strategy

### 1. Local Stress Test Resources

Add log-generating resources to a local test Tiltfile for manual stress testing:

```python
# High-volume log generator - produces 10k lines rapidly
local_resource(
    'log-stress-10k',
    cmd='for i in $(seq 1 10000); do echo "[$i] Log line with some content to test rendering performance"; done',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)

# Continuous log stream - produces logs at ~100/sec for 60 seconds
local_resource(
    'log-stream-continuous',
    cmd='for i in $(seq 1 6000); do echo "[$(date +%H:%M:%S)] Streaming log $i with variable content"; sleep 0.01; done',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)

# Long line generator - tests word wrapping
local_resource(
    'log-long-lines',
    cmd='for i in $(seq 1 1000); do echo "This is a very long log line number $i that should trigger word wrapping because it exceeds the typical terminal width of 80 characters and needs to be handled gracefully by the rendering system with proper continuation indicators"; done',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)

# ANSI color test - tests color preservation
local_resource(
    'log-ansi-colors',
    cmd='for i in $(seq 1 100); do echo -e "\033[31mRed\033[0m \033[32mGreen\033[0m \033[33mYellow\033[0m \033[34mBlue\033[0m line $i"; done',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)

# Progress line test - tests progressID overwriting
local_resource(
    'log-progress-test',
    cmd='for i in $(seq 1 100); do echo -ne "\r[Progress] $i% complete"; sleep 0.05; done; echo ""',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)

# Mixed levels - tests WARN/ERROR coloring
local_resource(
    'log-mixed-levels',
    cmd='for i in $(seq 1 1000); do case $((i % 10)) in 0) echo "[ERROR] Error on line $i";; 3|7) echo "[WARN] Warning on line $i";; *) echo "[INFO] Info on line $i";; esac; done',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=['stress-test']
)
```

### 2. Unit Tests for logstore2.ts

**File:** `src/tilt/logstore2.test.ts`

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import LogStore, { LogUpdateAction } from "./logstore2";

describe("LogStore", () => {
  let store: LogStore;

  beforeEach(() => {
    store = new LogStore();
  });

  describe("append", () => {
    test("appends segments and creates lines", () => {
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Hello\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 1,
      });

      const lines = store.manifestLog("api");
      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Hello");
    });

    test("combines incomplete segments into single line", () => {
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Hello ",
            level: "INFO",
          },
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "World\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 2,
      });

      const lines = store.manifestLog("api");
      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Hello World");
    });

    test("handles checkpoint deduplication", () => {
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Line 1\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 1,
      });

      // Server re-sends same segment
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Line 1\n",
            level: "INFO",
          },
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:01Z",
            text: "Line 2\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 2,
      });

      const lines = store.manifestLog("api");
      expect(lines.length).toBe(2);
    });

    test("indexes WARN and ERROR alerts", () => {
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Info\n",
            level: "INFO",
            anchor: true,
          },
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:01Z",
            text: "Warning\n",
            level: "WARN",
            anchor: true,
          },
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:02Z",
            text: "Error\n",
            level: "ERROR",
            anchor: true,
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 3,
      });

      const alerts = store.alertsForSpanId("span-1");
      expect(alerts.length).toBe(2);
      expect(alerts[0].level).toBe("WARN");
      expect(alerts[1].level).toBe("ERROR");
    });
  });

  describe("manifestLogPatchSet", () => {
    test("returns incremental patches", () => {
      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "Line 1\n",
            level: "INFO",
          },
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:01Z",
            text: "Line 2\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 2,
      });

      const patch1 = store.manifestLogPatchSet("api", 0);
      expect(patch1.lines.length).toBe(2);
      expect(patch1.checkpoint).toBe(2);

      store.append({
        spans: {},
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:02Z",
            text: "Line 3\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 2,
        toCheckpoint: 3,
      });

      const patch2 = store.manifestLogPatchSet("api", patch1.checkpoint);
      expect(patch2.lines.length).toBe(1);
      expect(patch2.lines[0].text).toBe("Line 3");
    });

    test("filters by manifest", () => {
      store.append({
        spans: {
          "span-1": { manifestName: "api" },
          "span-2": { manifestName: "web" },
        },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "API log\n",
            level: "INFO",
          },
          {
            spanId: "span-2",
            time: "2024-01-01T00:00:01Z",
            text: "Web log\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 2,
      });

      const apiLogs = store.manifestLogPatchSet("api", 0);
      expect(apiLogs.lines.length).toBe(1);
      expect(apiLogs.lines[0].text).toBe("API log");
    });
  });

  describe("truncation", () => {
    test("invokes truncate callback when logs exceed maxLength", () => {
      store.maxLogLength = 100; // Very small for testing

      let truncateCallCount = 0;
      store.addUpdateListener((e) => {
        if (e.action === LogUpdateAction.truncate) {
          truncateCallCount++;
        }
      });

      store.append({
        spans: { "span-1": { manifestName: "api" } },
        segments: Array.from({ length: 50 }, (_, i) => ({
          spanId: "span-1",
          time: "2024-01-01T00:00:00Z",
          text: `Line ${i} with some padding text\n`,
          level: "INFO",
        })),
        fromCheckpoint: 0,
        toCheckpoint: 50,
      });

      // Should have triggered truncation
      expect(truncateCallCount).toBeGreaterThan(0);
    });
  });

  describe("removeSpans", () => {
    test("removes spans and rebuilds lines", () => {
      store.append({
        spans: {
          "span-1": { manifestName: "api" },
          "span-2": { manifestName: "web" },
        },
        segments: [
          {
            spanId: "span-1",
            time: "2024-01-01T00:00:00Z",
            text: "API\n",
            level: "INFO",
          },
          {
            spanId: "span-2",
            time: "2024-01-01T00:00:01Z",
            text: "Web\n",
            level: "INFO",
          },
        ],
        fromCheckpoint: 0,
        toCheckpoint: 2,
      });

      store.removeSpans(["span-1"]);

      expect(store.manifestLog("api").length).toBe(0);
      expect(store.manifestLog("web").length).toBe(1);
    });
  });
});
```

### 3. Unit Tests for LogBuffer

**File:** `src/components/log-buffer.test.ts`

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { LogBuffer } from "./log-buffer";
import type { LogLine } from "../tilt/logstore2";

function makeLine(text: string, level = "INFO"): LogLine {
  return {
    text,
    level,
    manifestName: "test",
    spanId: "span-1",
    storedLineIndex: 0,
  };
}

describe("LogBuffer", () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer();
    buffer.width = 40;
    buffer.height = 10;
  });

  describe("word wrapping", () => {
    test("does not wrap short lines", () => {
      buffer.appendLines([makeLine("Short line")]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBe(1);
      expect(rows[0].isContinuation).toBe(false);
    });

    test("wraps long lines at word boundaries", () => {
      buffer.appendLines([
        makeLine(
          "This is a very long line that should wrap at word boundaries",
        ),
      ]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBeGreaterThan(1);
      expect(rows[0].isContinuation).toBe(false);
      expect(rows[1].isContinuation).toBe(true);
      expect(rows[1].text.startsWith("↳")).toBe(true);
    });

    test("falls back to character wrap for long words", () => {
      buffer.appendLines([
        makeLine("Supercalifragilisticexpialidocious".repeat(3)),
      ]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBeGreaterThan(1);
    });

    test("recalculates wrapping when width changes", () => {
      buffer.appendLines([makeLine("This line fits in 80 chars but not 20")]);

      const rowsBefore = buffer.getVisibleRows();
      buffer.width = 20;
      buffer.recalculateWrapping();
      const rowsAfter = buffer.getVisibleRows();

      expect(rowsAfter.length).toBeGreaterThan(rowsBefore.length);
    });
  });

  describe("timestamps", () => {
    test("includes timestamp when showTimestamps is true", () => {
      buffer.showTimestamps = true;
      buffer.appendLines([makeLine("Test")]);

      const rows = buffer.getVisibleRows();
      expect(rows[0].text).toMatch(/^\[\d{2}:\d{2}:\d{2}\]/);
    });

    test("excludes timestamp when showTimestamps is false", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([makeLine("Test")]);

      const rows = buffer.getVisibleRows();
      expect(rows[0].text).not.toMatch(/^\[/);
      expect(rows[0].text).toBe("Test");
    });

    test("rewraps when timestamp visibility changes", () => {
      buffer.showTimestamps = true;
      buffer.appendLines([makeLine("A line that barely fits with timestamp")]);

      const rowsWithTs = buffer.getVisibleRows().length;
      buffer.showTimestamps = false;
      const rowsWithoutTs = buffer.getVisibleRows().length;

      expect(rowsWithoutTs).toBeLessThanOrEqual(rowsWithTs);
    });
  });

  describe("scrolling", () => {
    test("scrollToBottom sets autoScroll true", () => {
      buffer.appendLines(
        Array.from({ length: 50 }, (_, i) => makeLine(`Line ${i}`)),
      );

      buffer.scrollToTop();
      expect(buffer.autoScroll).toBe(false);

      buffer.scrollToBottom();
      expect(buffer.autoScroll).toBe(true);
    });

    test("scrollBy moves scroll position", () => {
      buffer.appendLines(
        Array.from({ length: 50 }, (_, i) => makeLine(`Line ${i}`)),
      );

      buffer.scrollToTop();
      const initialTop = buffer.scrollTop;

      buffer.scrollBy(5);
      expect(buffer.scrollTop).toBe(initialTop + 5);
    });

    test("scroll position is clamped to valid range", () => {
      buffer.appendLines(
        Array.from({ length: 5 }, (_, i) => makeLine(`Line ${i}`)),
      );

      buffer.scrollTo(-100);
      expect(buffer.scrollTop).toBe(0);

      buffer.scrollTo(10000);
      expect(buffer.scrollTop).toBeLessThanOrEqual(buffer.scrollHeight);
    });

    test("auto-scroll appends new lines at bottom", () => {
      buffer.autoScroll = true;
      buffer.appendLines(
        Array.from({ length: 50 }, (_, i) => makeLine(`Line ${i}`)),
      );

      const visibleBefore = buffer.getVisibleRows();
      const lastLineBefore = visibleBefore[visibleBefore.length - 1];

      buffer.appendLines([makeLine("New line")]);

      const visibleAfter = buffer.getVisibleRows();
      const lastLineAfter = visibleAfter[visibleAfter.length - 1];

      expect(lastLineAfter.text).toContain("New line");
    });
  });

  describe("clear", () => {
    test("resets all state", () => {
      buffer.appendLines(
        Array.from({ length: 50 }, (_, i) => makeLine(`Line ${i}`)),
      );
      buffer.scrollBy(10);

      buffer.clear();

      expect(buffer.lineCount).toBe(0);
      expect(buffer.scrollTop).toBe(0);
      expect(buffer.scrollHeight).toBe(0);
      expect(buffer.checkpoint).toBe(0);
    });
  });

  describe("visible rows", () => {
    test("returns only rows in viewport", () => {
      buffer.appendLines(
        Array.from({ length: 50 }, (_, i) => makeLine(`Line ${i}`)),
      );

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBeLessThanOrEqual(buffer.height);
    });

    test("includes level color information", () => {
      buffer.appendLines([
        makeLine("Info", "INFO"),
        makeLine("Warning", "WARN"),
        makeLine("Error", "ERROR"),
      ]);

      const rows = buffer.getVisibleRows();
      expect(rows[0].levelColor).toBe("INFO");
      expect(rows[1].levelColor).toBe("WARN");
      expect(rows[2].levelColor).toBe("ERROR");
    });
  });
});
```

### 4. Unit Tests for ANSI Parser

**File:** `src/utils/ansi-parser.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { parseAnsi } from "./ansi-parser";

describe("parseAnsi", () => {
  test("returns single segment for plain text", () => {
    const segments = parseAnsi("Hello World");
    expect(segments.length).toBe(1);
    expect(segments[0].text).toBe("Hello World");
    expect(segments[0].fg).toBeUndefined();
  });

  test("parses standard foreground colors", () => {
    const segments = parseAnsi("\x1B[31mRed\x1B[0m");
    expect(segments.length).toBe(2);
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].text).toBe("Red");
  });

  test("handles reset code", () => {
    const segments = parseAnsi("\x1B[31mRed\x1B[0mNormal");
    expect(segments.length).toBe(2);
    expect(segments[0].fg).toBeDefined();
    expect(segments[1].fg).toBeUndefined();
    expect(segments[1].text).toBe("Normal");
  });

  test("parses bold attribute", () => {
    const segments = parseAnsi("\x1B[1mBold\x1B[0m");
    expect(segments[0].bold).toBe(true);
  });

  test("parses dim attribute", () => {
    const segments = parseAnsi("\x1B[2mDim\x1B[0m");
    expect(segments[0].dim).toBe(true);
  });

  test("handles multiple attributes", () => {
    const segments = parseAnsi("\x1B[1;31mBoldRed\x1B[0m");
    expect(segments[0].bold).toBe(true);
    expect(segments[0].fg).toBeDefined();
  });

  test("handles bright colors (90-97)", () => {
    const segments = parseAnsi("\x1B[91mBrightRed\x1B[0m");
    expect(segments[0].fg).toBeDefined();
  });
});
```

### 5. Performance Benchmarks

**File:** `src/components/log-buffer.bench.ts`

```typescript
import { bench, run } from "mitata";
import { LogBuffer } from "./log-buffer";
import type { LogLine } from "../tilt/logstore2";

function makeLines(count: number): LogLine[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Log line ${i} with some content to simulate real logs`,
    level: i % 10 === 0 ? "ERROR" : i % 5 === 0 ? "WARN" : "INFO",
    manifestName: "test",
    spanId: "span-1",
    storedLineIndex: i,
  }));
}

function makeLongLines(count: number): LogLine[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Line ${i}: ${"word ".repeat(50)}end`,
    level: "INFO",
    manifestName: "test",
    spanId: "span-1",
    storedLineIndex: i,
  }));
}

bench("appendLines - 1000 short lines", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLines(1000));
});

bench("appendLines - 10000 short lines", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLines(10000));
});

bench("appendLines - 1000 long lines (wrapping)", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLongLines(1000));
});

bench("getVisibleRows - 10000 lines", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLines(10000));
  buffer.getVisibleRows();
});

bench("scrollBy - 10000 lines", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLines(10000));
  for (let i = 0; i < 100; i++) {
    buffer.scrollBy(10);
    buffer.getVisibleRows();
  }
});

bench("recalculateWrapping - 1000 long lines", () => {
  const buffer = new LogBuffer();
  buffer.width = 80;
  buffer.height = 24;
  buffer.appendLines(makeLongLines(1000));
  buffer.width = 60;
  buffer.recalculateWrapping();
});

await run();
```

### Running Tests

```bash
# Run all unit tests
bun test

# Run specific test file
bun test src/tilt/logstore2.test.ts

# Run benchmarks
bun run src/components/log-buffer.bench.ts

# Run with coverage
bun test --coverage
```

### Manual Testing Checklist

Use the stress test resources in the demo app:

1. **[ ] 10k lines rapid load** - Trigger `log-stress-10k`, verify no frame drops
2. **[ ] Continuous stream** - Trigger `log-stream-continuous`, verify smooth scrolling during append
3. **[ ] Long line wrapping** - Trigger `log-long-lines`, verify continuation indicators
4. **[ ] ANSI colors** - Trigger `log-ansi-colors`, verify colors render correctly
5. **[ ] Progress lines** - Trigger `log-progress-test`, verify overwriting works
6. **[ ] Mixed levels** - Trigger `log-mixed-levels`, verify WARN/ERROR coloring
7. **[ ] Timestamp toggle** - Press `t` during each test, verify rewrap
8. **[ ] Scroll performance** - Hold `j` to rapid scroll through 10k lines

## Performance Expectations

| Metric                   | Current (JSX)        | Proposed (FrameBuffer) |
| ------------------------ | -------------------- | ---------------------- |
| Components per 10k lines | 10,000               | 1                      |
| Memos per 10k lines      | 40,000+              | ~10 (fixed)            |
| Memory per update        | O(n) array copy      | O(m) append only       |
| Render complexity        | O(n) reconciliation  | O(viewport)            |
| Scroll performance       | Re-reconcile visible | Redraw visible only    |

**Expected improvements:**

- Initial render: 5-10x faster for large log counts
- Scroll performance: Consistent regardless of total line count
- Memory usage: Grows with log count, not with component count

## File Structure

```
src/
├── components/
│   ├── log-buffer.ts          # NEW: LogBuffer class
│   ├── log-buffer.test.ts     # NEW: LogBuffer unit tests
│   ├── log-buffer.bench.ts    # NEW: LogBuffer benchmarks
│   ├── log-buffer-view.tsx    # NEW: LogBufferView component
│   ├── resourceview.tsx       # MODIFIED: Use LogBufferView
│   └── ...
├── context/
│   └── tilt.tsx               # MODIFIED: Use logstore2.ts
├── tilt/
│   ├── logstore2.ts           # USE: Full Tilt-style LogStore
│   ├── logstore2.test.ts      # NEW: LogStore unit tests
│   ├── logstore.ts            # DEPRECATED: Remove after migration
│   └── ...
├── utils/
│   ├── ansi-parser.ts         # NEW: ANSI escape code parser
│   └── ansi-parser.test.ts    # NEW: ANSI parser unit tests
└── ...

docs/
└── log-rendering-optimization.md  # This document
```

## References

- [OpenTUI FrameBuffer Demo](https://github.com/anomalyco/opentui/blob/main/packages/core/src/examples/framebuffer-demo.ts)
- [OpenTUI FrameBuffer Docs](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/components/frame-buffer.mdx)
- [Tilt Web OverviewLogPane](https://github.com/tilt-dev/tilt/blob/master/web/src/OverviewLogPane.tsx)
