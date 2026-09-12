// LogBufferView - High-performance log rendering using FrameBufferRenderable
//
// Replaces JSX-based log rendering with direct character drawing for:
// - Constant-time rendering regardless of log count
// - Word-aware line wrapping with continuation indicators
// - ANSI color preservation
// - Virtual scrolling with custom scrollbar
// - Mouse scroll wheel support
// - Text selection with clipboard copy

import {
  BoxRenderable,
  FrameBufferRenderable,
  RGBA,
  type MouseEvent,
  Selection as TUISelection,
  convertGlobalToLocalSelection,
  type LocalSelectionBounds,
  type RenderContext,
  type FrameBufferOptions,
} from "@opentui/core";

import { useRenderer, onResize } from "@opentui/solid";
import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  on,
  type JSX,
} from "solid-js";
import {
  LogBuffer,
  type VisibleRow,
  type MatchRange,
  type LogSearchFilter,
} from "./log-buffer";
import { parseAnsi, type AnsiSegment } from "../utils/ansi-parser";
import { extractSelectedText } from "./log-selection";
import { copyToClipboard } from "../utils/clipboard";
import type LogStore from "../tilt/logstore2";
import { LogUpdateAction, type LogUpdateEvent } from "../tilt/logstore2";
import { Theme } from "../theme/theme";

const DEFAULT_SCROLL_WHEEL_LINES = 3;

export interface LogBufferViewProps {
  /** The log store to read logs from */
  logStore: LogStore;
  /** Accessor for the current manifest/resource name to display logs for */
  manifestName: () => string | null;
  /** Theme for colors */
  theme: Theme;
  /** Whether to show timestamps */
  showTimestamps: () => boolean;
  /** Callback when auto-scroll state changes */
  onAutoScrollChange?: (autoScroll: boolean) => void;
  /** Lines to scroll per mouse wheel event (default: 3) */
  scrollLinesPerWheel?: number;
  /** Callback when text is copied to clipboard */
  onTextCopied?: (text: string) => void;
  /** Disable copying selected logs to local clipboard sinks. */
  disableClipboardCopy?: () => boolean;
}

export interface LogBufferViewRef {
  /** Scroll by a relative amount (positive = down) */
  scrollBy: (delta: number) => void;
  /** Scroll to an absolute position */
  scrollTo: (position: number) => void;
  /** Scroll to the top */
  scrollToTop: () => void;
  /** Scroll to the bottom and enable auto-scroll */
  scrollToBottom: () => void;
  /** Toggle auto-scroll mode */
  toggleAutoScroll: () => void;
  /** Set a search filter for log lines */
  setSearchFilter: (filter: LogSearchFilter | null) => void;
  /** Clear the search filter */
  clearSearchFilter: () => void;
  /** Current auto-scroll state */
  readonly autoScroll: boolean;
  /** Current scroll position in display rows */
  readonly scrollTop: number;
  /** Total height in display rows */
  readonly scrollHeight: number;
  /** Viewport height in rows */
  readonly height: number;
  /** Whether filtering is active */
  readonly isFiltering: boolean;
  /** Number of lines matching the current filter */
  readonly matchCount: number;
}

interface Dimensions {
  width: number;
  height: number;
}

// SelectableLogFrameBuffer - FrameBuffer with mouse selection and scroll support
interface SelectableLogFrameBufferOptions extends FrameBufferOptions {
  scrollLinesPerWheel: number;
  onScrollWheel: (delta: number) => void;
  onSelectionChange: (
    selection: LocalSelectionBounds | null,
    isDragging: boolean,
  ) => void;
  onSelectionEnd: (text: string) => void;
  getVisibleRows: () => VisibleRow[];
}

class SelectableLogFrameBuffer extends FrameBufferRenderable {
  public override selectable: boolean = true;
  private _localSelection: LocalSelectionBounds | null = null;
  private _prevWasDragging = false;
  private scrollLinesPerWheel: number;
  private onScrollWheel: (delta: number) => void;
  private onSelectionChange: (
    selection: LocalSelectionBounds | null,
    isDragging: boolean,
  ) => void;
  private onSelectionEnd: (text: string) => void;
  private getVisibleRows: () => VisibleRow[];

  constructor(ctx: RenderContext, options: SelectableLogFrameBufferOptions) {
    super(ctx, {
      id: options.id,
      width: options.width,
      height: options.height,
      flexGrow: options.flexGrow,
    });
    this.scrollLinesPerWheel = options.scrollLinesPerWheel;
    this.onScrollWheel = options.onScrollWheel;
    this.onSelectionChange = options.onSelectionChange;
    this.onSelectionEnd = options.onSelectionEnd;
    this.getVisibleRows = options.getVisibleRows;
  }

  override shouldStartSelection(x: number, y: number): boolean {
    const localX = x - this.x;
    const localY = y - this.y;
    return (
      localX >= 0 && localX < this.width && localY >= 0 && localY < this.height
    );
  }

  override onSelectionChanged(sel: TUISelection | null): boolean {
    if (!sel) {
      this._localSelection = null;
      this._prevWasDragging = false;
      this.onSelectionChange(null, false);
      return false;
    }

    const wasDragging = this._prevWasDragging;
    const isDragging = sel?.isDragging ?? false;

    this._localSelection = convertGlobalToLocalSelection(sel, this.x, this.y);
    this._prevWasDragging = isDragging;

    // Notify parent of selection change
    this.onSelectionChange(this._localSelection, isDragging);

    // Copy to clipboard when a non-empty selection ends (was dragging, now not)
    if (
      wasDragging &&
      sel &&
      !isDragging &&
      this.hasSelection() &&
      !this.isSelectionCollapsed()
    ) {
      const text = this.getSelectedText();
      if (text) {
        this.onSelectionEnd(text);
      }
    }

    this.requestRender();
    return this.hasSelection();
  }

  override getSelectedText(): string {
    if (!this._localSelection?.isActive) return "";

    const rows = this.getVisibleRows();
    const { anchorX, anchorY, focusX, focusY } = this._localSelection;

    return extractSelectedText(rows, anchorX, anchorY, focusX, focusY);
  }

  private isSelectionCollapsed(): boolean {
    if (!this._localSelection?.isActive) return true;

    const { anchorX, anchorY, focusX, focusY } = this._localSelection;
    return anchorX === focusX && anchorY === focusY;
  }

  override hasSelection(): boolean {
    return this._localSelection !== null && this._localSelection.isActive;
  }

  getLocalSelection(): LocalSelectionBounds | null {
    return this._localSelection;
  }

  protected override onMouseEvent(event: MouseEvent): void {
    if (event.propagationStopped) return;

    if (event.type === "scroll" && event.scroll) {
      const delta =
        event.scroll.direction === "up"
          ? -this.scrollLinesPerWheel
          : this.scrollLinesPerWheel;
      this.onScrollWheel(delta);
      event.stopPropagation();
    }
  }
}

/**
 * High-performance log view using FrameBufferRenderable.
 *
 * Returns a tuple of [Component, Ref] for use in parent components.
 * The ref provides scroll control methods.
 */
export function LogBufferView(
  props: LogBufferViewProps,
): [() => JSX.Element, LogBufferViewRef] {
  const renderer = useRenderer();

  // Viewport dimensions - updated on mount and resize (single signal to avoid double triggers)
  const [dimensions, setDimensions] = createSignal<Dimensions>({
    width: 80,
    height: 20,
  });

  // Trigger re-renders when buffer state changes
  const [renderVersion, setRenderVersion] = createSignal(0);

  // The LogBuffer manages virtual scrolling and line wrapping
  const buffer = new LogBuffer();

  // Container element reference for size tracking
  let containerEl: BoxRenderable | null = null;

  // SelectableLogFrameBuffer for direct character rendering with mouse support
  let selectableFrameBuffer: SelectableLogFrameBuffer | null = null;

  // Selection state for rendering
  let localSelection: LocalSelectionBounds | null = null;

  // Track whether auto-scroll was enabled before a drag selection started,
  // so we can restore it after the selection ends.
  let autoScrollBeforeSelection: boolean | null = null;

  // Log rows are redrawn frequently while a stream is active. Cache parsed ANSI
  // segments so redraws do not repeatedly scan the same strings.
  const ansiCache = new Map<string, AnsiSegment[]>();
  const ANSI_CACHE_LIMIT = 2048;

  function getParsedAnsi(text: string): AnsiSegment[] {
    const cached = ansiCache.get(text);
    if (cached) return cached;

    const segments = parseAnsi(text);
    if (ansiCache.size >= ANSI_CACHE_LIMIT) {
      const firstKey = ansiCache.keys().next().value;
      if (firstKey !== undefined) ansiCache.delete(firstKey);
    }
    ansiCache.set(text, segments);
    return segments;
  }

  // Scroll lines per wheel event
  const scrollLinesPerWheel =
    props.scrollLinesPerWheel ?? DEFAULT_SCROLL_WHEEL_LINES;

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
    // Highlight color for search matches
    highlight: RGBA.fromHex(props.theme.primary),
    highlightBg: RGBA.fromHex("#3d3200"), // Dark yellow background for highlighting
    // Selection colors
    selectionFg: RGBA.fromHex(props.theme.selectionFg),
    selectionBg: RGBA.fromHex(props.theme.selectionBg),
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

  function createFrameBuffer(): void {
    if (selectableFrameBuffer) {
      selectableFrameBuffer.destroy();
    }

    const { width: w, height: h } = dimensions();

    if (w <= 0 || h <= 0) return;

    selectableFrameBuffer = new SelectableLogFrameBuffer(renderer, {
      id: `log-buffer-${props.manifestName() ?? "default"}-${Date.now()}`,
      width: w,
      height: h,
      flexGrow: 1,
      scrollLinesPerWheel,
      onScrollWheel: (delta: number) => {
        buffer.scrollBy(delta);
        props.onAutoScrollChange?.(buffer.autoScroll);
        setRenderVersion((v) => v + 1);
      },
      onSelectionChange: (
        selection: LocalSelectionBounds | null,
        isDragging: boolean,
      ) => {
        // Pause auto-scroll while dragging to prevent viewport shifts
        if (isDragging && autoScrollBeforeSelection === null) {
          autoScrollBeforeSelection = buffer.autoScroll;
          buffer.autoScroll = false;
        }
        localSelection = selection;
        setRenderVersion((v) => v + 1);
      },
      onSelectionEnd: (text: string) => {
        if (!props.disableClipboardCopy?.()) {
          // Use subprocess clipboard, then OSC52 fallback for terminal-only cases.
          copyToClipboard(text);
          renderer.copyToClipboardOSC52(text);
        }
        // Restore auto-scroll state from before the selection
        if (autoScrollBeforeSelection !== null) {
          buffer.autoScroll = autoScrollBeforeSelection;
          autoScrollBeforeSelection = null;
          props.onAutoScrollChange?.(buffer.autoScroll);
        }
        localSelection = null;
        setRenderVersion((v) => v + 1);
        props.onTextCopied?.(text);
      },
      getVisibleRows: () => buffer.getVisibleRows(),
    });

    if (containerEl) {
      containerEl.add(selectableFrameBuffer);
    }

    renderVisibleLines();
  }

  /**
   * Handle log store updates via callback.
   * This bridges logstore2's callback-based updates to SolidJS reactivity.
   */
  function handleLogUpdate(e: LogUpdateEvent): void {
    const name = props.manifestName();
    if (!name) return;

    if (e.action === LogUpdateAction.truncate) {
      // Full reset - logs were truncated, all checkpoints invalidated
      buffer.clear();
    }

    // Fetch new/updated lines incrementally
    const patch = props.logStore.manifestLogPatchSet(name, buffer.checkpoint);
    if (patch.lines.length > 0 || e.action === LogUpdateAction.truncate) {
      buffer.appendLines(patch.lines);
      buffer.checkpoint = patch.checkpoint;
      setRenderVersion((v) => v + 1);
    }
  }

  onMount(() => {
    props.logStore.addUpdateListener(handleLogUpdate);

    // Initial load of existing logs
    const name = props.manifestName();
    if (name) {
      const patch = props.logStore.manifestLogPatchSet(name, 0);
      if (patch.lines.length > 0) {
        buffer.appendLines(patch.lines);
        buffer.checkpoint = patch.checkpoint;
      }
    }
  });

  onCleanup(() => {
    props.logStore.removeUpdateListener(handleLogUpdate);

    if (selectableFrameBuffer) {
      selectableFrameBuffer.destroy();
      selectableFrameBuffer = null;
    }
  });

  const reflowLogs = (attempt = 0): void => {
    const el = containerEl;
    if (!el) return;

    const w = el.width - 2;
    const h = el.height;
    if (w <= 0 || h <= 0) {
      // During terminal minimize/restore Yoga can briefly report zero size.
      // Retry until layout has settled instead of leaving a blank framebuffer.
      if (attempt < 20) {
        setTimeout(() => reflowLogs(attempt + 1), 50);
      }
      return;
    }

    const current = dimensions();
    if (w === current.width && h === current.height) {
      renderer.requestRender();
      return;
    }

    setDimensions({ width: w, height: h });
    buffer.resize(w, h);

    if (selectableFrameBuffer) {
      selectableFrameBuffer.frameBuffer.resize(w, h);
    }

    setRenderVersion((v) => v + 1);
    renderer.requestRender();
  };

  onResize(() => {
    // Let the parent layout settle before measuring the framebuffer viewport.
    setTimeout(() => reflowLogs(), 0);
  });

  // Reset when manifest changes
  createEffect(
    on(
      () => props.manifestName(),
      (name) => {
        buffer.clear();

        // Load logs for new manifest
        if (name) {
          const patch = props.logStore.manifestLogPatchSet(name, 0);
          if (patch.lines.length > 0) {
            buffer.appendLines(patch.lines);
            buffer.checkpoint = patch.checkpoint;
          }
        }

        setRenderVersion((v) => v + 1);
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

  // Render when version changes
  createEffect(
    on(renderVersion, () => {
      renderVisibleLines();
    }),
  );

  /**
   * Compute selection range for a given row based on current selection.
   */
  function getSelectionRangeForRow(
    y: number,
  ): { startX: number; endX: number } | null {
    if (!localSelection?.isActive) return null;

    const { anchorX, anchorY, focusX, focusY } = localSelection;

    // Normalize to reading order
    let startY = anchorY,
      startX = anchorX,
      endY = focusY,
      endX = focusX;
    if (startY > endY || (startY === endY && startX > endX)) {
      [startY, endY] = [endY, startY];
      [startX, endX] = [endX, startX];
    }

    // Check if this row is within selection
    if (y < startY || y > endY) return null;

    // Determine selection range for this row
    const { width: w } = dimensions();
    let rowStartX = 0;
    let rowEndX = w - 2; // Account for scrollbar

    if (y === startY) rowStartX = Math.max(0, startX);
    if (y === endY) rowEndX = Math.min(w - 2, endX);

    return { startX: rowStartX, endX: rowEndX };
  }

  /**
   * Render visible log lines to the FrameBuffer.
   * This is O(viewport height), not O(total lines).
   */
  function renderVisibleLines(): void {
    if (!selectableFrameBuffer) return;

    const fb = selectableFrameBuffer.frameBuffer;
    if (!fb) return;

    const { width: configuredWidth, height: configuredHeight } = dimensions();
    // Keep the native buffer synchronized before drawing. During sidebar and
    // terminal resizes, Yoga and the framebuffer can briefly disagree; drawing
    // with the stale smaller buffer leaves most of the pane blank.
    if (fb.width !== configuredWidth || fb.height !== configuredHeight) {
      fb.resize(configuredWidth, configuredHeight);
    }
    const w = fb.width;
    const h = fb.height;
    if (buffer.width !== w || buffer.height !== h) {
      buffer.resize(w, h);
    }
    const c = colors();

    // Clear buffer with background color
    fb.fillRect(0, 0, w, h, c.bg);

    // Get visible rows from LogBuffer
    const rows = buffer.getVisibleRows();

    // Draw each row
    for (let y = 0; y < h && y < rows.length; y++) {
      const row = rows[y];
      const selectionRange = getSelectionRangeForRow(y);
      drawRow(fb, row, y, w, c, selectionRange);
    }

    // Draw scrollbar in rightmost column
    drawScrollbar(fb, w, h, c);

    // Request a render to flush framebuffer changes to screen
    renderer.requestRender();
  }

  /**
   * Draw a single row to the FrameBuffer.
   */
  function drawRow(
    fb: any,
    row: VisibleRow,
    y: number,
    w: number,
    c: ReturnType<typeof colors>,
    selectionRange: { startX: number; endX: number } | null,
  ): void {
    if (row.isContinuation) {
      // Indent continuation rows without injecting a distracting glyph.
      // Draw the rest of the line dimmed, preserving ANSI colors.
      // Adjust match positions for continuation prefix offset
      const matches = row.matches
        ?.map((m) => ({
          start: Math.max(0, m.start - 2),
          end: Math.max(0, m.end - 2),
        }))
        .filter((m) => m.end > 0);
      drawAnsiText(
        fb,
        row.text.slice(2),
        2,
        y,
        c.textMuted,
        c.bg,
        true,
        w,
        matches,
        selectionRange,
      );
    } else if (row.line.buildEvent) {
      // Draw build event highlighted line
      const levelColor = getLevelColor(row.level);
      drawAnsiText(
        fb,
        row.text,
        0,
        y,
        levelColor,
        c.accent,
        false,
        w,
        undefined,
        selectionRange,
      );
    } else {
      // Draw normal line with level color as default
      const levelColor = getLevelColor(row.level);
      drawAnsiText(
        fb,
        row.text,
        0,
        y,
        levelColor,
        c.bg,
        false,
        w,
        row.matches,
        selectionRange,
      );
    }
  }

  /**
   * Check if a position is within any of the match ranges.
   */
  function isInMatchRange(pos: number, matches?: MatchRange[]): boolean {
    if (!matches) return false;
    return matches.some((m) => pos >= m.start && pos < m.end);
  }

  /**
   * Check if a position is within the selection range.
   */
  function isInSelectionRange(
    x: number,
    selectionRange: { startX: number; endX: number } | null,
  ): boolean {
    if (!selectionRange) return false;
    return x >= selectionRange.startX && x <= selectionRange.endX;
  }

  /**
   * Draw text with ANSI color codes to the FrameBuffer.
   * Optionally highlights matched ranges and selection.
   */
  function drawAnsiText(
    fb: any,
    text: string,
    startX: number,
    y: number,
    defaultFg: RGBA,
    bg: RGBA,
    dimmed: boolean,
    maxWidth: number,
    matches?: MatchRange[],
    selectionRange?: { startX: number; endX: number } | null,
  ): void {
    const segments = getParsedAnsi(text);
    let x = startX;
    // Track position in original text (before ANSI parsing)
    let textPos = 0;
    const c = colors();

    for (const segment of segments) {
      let fg = segment.fg ?? defaultFg;

      // Apply dimming for continuation lines
      if (dimmed && !segment.fg) {
        fg = c.textMuted;
      }

      // Apply dim attribute from ANSI
      if (segment.dim) {
        fg = c.textMuted;
      }

      for (const char of segment.text) {
        // Reserve rightmost column for scrollbar
        if (x >= maxWidth - 1) break;

        // Check if this character is in selection range (takes priority)
        const inSelection = isInSelectionRange(x, selectionRange ?? null);
        // Check if this character is in a match range
        const inMatch = !inSelection && isInMatchRange(textPos, matches);

        let cellFg = fg;
        let cellBg = segment.bg ?? bg;

        if (inSelection) {
          cellFg = c.selectionFg;
          cellBg = c.selectionBg;
        } else if (inMatch) {
          cellFg = c.highlight;
          cellBg = c.highlightBg;
        }

        fb.setCell(x, y, char, cellFg, cellBg);
        x++;
        textPos++;
      }
    }
  }

  /**
   * Draw the scrollbar in the rightmost column.
   */
  function drawScrollbar(
    fb: any,
    w: number,
    h: number,
    c: ReturnType<typeof colors>,
  ): void {
    const totalRows = buffer.scrollHeight;

    // No scrollbar needed if content fits in viewport
    if (totalRows <= h) return;

    const scrollbarX = w - 1;

    // Calculate thumb size and position
    const thumbRatio = h / totalRows;
    const thumbSize = Math.max(1, Math.floor(h * thumbRatio));
    const maxScrollTop = Math.max(1, totalRows - h);
    const thumbPos = Math.floor(
      (buffer.scrollTop / maxScrollTop) * (h - thumbSize),
    );

    // Draw scrollbar track and thumb
    for (let y = 0; y < h; y++) {
      const isThumb = y >= thumbPos && y < thumbPos + thumbSize;
      const char = isThumb ? "█" : "░";
      const color = isThumb ? c.scrollThumb : c.scrollTrack;
      fb.setCell(scrollbarX, y, char, color, c.bg);
    }
  }

  // --- Ref API for external control ---

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

    setSearchFilter: (filter: LogSearchFilter | null) => {
      buffer.searchFilter = filter;
      setRenderVersion((v) => v + 1);
    },

    clearSearchFilter: () => {
      buffer.searchFilter = null;
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

    get height() {
      return buffer.height;
    },

    get isFiltering() {
      return buffer.isFiltering;
    },

    get matchCount() {
      return buffer.matchCount;
    },
  };

  // --- Component ---

  function Component() {
    // Track if we've initialized
    let initialized = false;

    // Try to initialize with element dimensions
    const tryInitialize = (el: BoxRenderable) => {
      if (initialized) return;

      const w = el.width - 2;
      const h = el.height;

      // Only proceed if we have real computed dimensions
      if (w && h && w > 0 && h > 0) {
        console.log("Initializing with dimensions: %dx%d", w, h);
        setDimensions({ width: w, height: h });
        buffer.resize(w, h);

        createFrameBuffer();
        initialized = true;

        // Trigger initial render
        setRenderVersion((v) => v + 1);
      } else {
        // Layout not computed yet, schedule a retry
        setTimeout(() => {
          if (containerEl) {
            tryInitialize(containerEl);
          }
        }, 16); // Try again next frame
      }
    };

    return (
      <box
        flexGrow={1}
        flexDirection="column"
        ref={(el: BoxRenderable) => {
          containerEl = el;
          if (el) {
            tryInitialize(el);
          }
        }}
        onSizeChange={() => {
          reflowLogs();
        }}
      ></box>
    );
  }

  return [Component, ref];
}
