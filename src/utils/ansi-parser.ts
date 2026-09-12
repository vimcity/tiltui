// ANSI escape code parser for preserving terminal colors in log rendering

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

// Standard ANSI 4-bit color palette (foreground codes 30-37, 90-97)
// Map ANSI's named colors to the Catppuccin Frappé palette instead of the
// terminal's harsh legacy RGB values.
const ANSI_COLORS: Record<number, string> = {
  30: "#51576d",
  31: "#e78284",
  32: "#a6d189",
  33: "#e5c890",
  34: "#8caaee",
  35: "#ca9ee6",
  36: "#81c8be",
  37: "#c6d0f5",
  90: "#737994",
  91: "#e78284",
  92: "#a6d189",
  93: "#e5c890",
  94: "#8caaee",
  95: "#f4b8e4",
  96: "#99d1db",
  97: "#f2d5cf",
};

// Background color codes are fg + 10 (40-47, 100-107)
function getBgColorCode(code: number): number | null {
  if (code >= 40 && code <= 47) {
    return code - 10;
  }
  if (code >= 100 && code <= 107) {
    return code - 10;
  }
  return null;
}

function ansi256ToHex(code: number): string {
  if (code < 16) {
    return ANSI_COLORS[code < 8 ? code + 30 : code + 82] ?? "#c6d0f5";
  }
  if (code >= 232) {
    const value = 8 + (code - 232) * 10;
    return `#${value.toString(16).padStart(2, "0").repeat(3)}`;
  }
  const index = code - 16;
  const channels = [
    Math.floor(index / 36),
    Math.floor((index % 36) / 6),
    index % 6,
  ].map((channel) => (channel === 0 ? 0 : 55 + channel * 40));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Parse text with ANSI escape codes into segments with color/style information.
 *
 * Supports:
 * - Standard foreground colors (30-37)
 * - Bright foreground colors (90-97)
 * - Standard background colors (40-47)
 * - Bright background colors (100-107)
 * - Bold (1), Dim (2), Italic (3), Underline (4)
 * - Reset (0)
 *
 * Also supports 256-color and true-color foreground/background sequences.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];

  // Match SGR (Select Graphic Rendition) sequences: ESC[...m
  const regex = /\x1B\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentFg: RGBA | undefined;
  let currentBg: RGBA | undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;

  let match;
  while ((match = regex.exec(text)) !== null) {
    // Add text before this escape sequence as a segment
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        fg: currentFg,
        bg: currentBg,
        bold,
        dim,
        italic,
        underline,
      });
    }

    // Parse SGR parameters (semicolon-separated numbers)
    const paramsStr = match[1];
    const params = paramsStr ? paramsStr.split(";").map(Number) : [0];

    for (let i = 0; i < params.length; i++) {
      const param = params[i];

      // Support the common 256-color and true-color forms emitted by logs.
      if (param === 38 || param === 48) {
        const isBackground = param === 48;
        if (params[i + 1] === 5 && params[i + 2] !== undefined) {
          const color = ansi256ToHex(params[i + 2]);
          if (isBackground) currentBg = RGBA.fromHex(color);
          else currentFg = RGBA.fromHex(color);
          i += 2;
        } else if (
          params[i + 1] === 2 &&
          params[i + 2] !== undefined &&
          params[i + 3] !== undefined &&
          params[i + 4] !== undefined
        ) {
          const color = `#${[params[i + 2], params[i + 3], params[i + 4]]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")}`;
          if (isBackground) currentBg = RGBA.fromHex(color);
          else currentFg = RGBA.fromHex(color);
          i += 4;
        }
        continue;
      }

      if (param === 0) {
        // Reset all attributes
        currentFg = undefined;
        currentBg = undefined;
        bold = false;
        dim = false;
        italic = false;
        underline = false;
      } else if (param === 1) {
        bold = true;
      } else if (param === 2) {
        dim = true;
      } else if (param === 3) {
        italic = true;
      } else if (param === 4) {
        underline = true;
      } else if (param === 22) {
        // Normal intensity (neither bold nor dim)
        bold = false;
        dim = false;
      } else if (param === 23) {
        italic = false;
      } else if (param === 24) {
        underline = false;
      } else if (param >= 30 && param <= 37) {
        // Standard foreground color
        currentFg = RGBA.fromHex(ANSI_COLORS[param]);
      } else if (param === 39) {
        // Default foreground color
        currentFg = undefined;
      } else if (param >= 40 && param <= 47) {
        // Standard background color
        const fgCode = getBgColorCode(param);
        if (fgCode !== null) {
          currentBg = RGBA.fromHex(ANSI_COLORS[fgCode]);
        }
      } else if (param === 49) {
        // Default background color
        currentBg = undefined;
      } else if (param >= 90 && param <= 97) {
        // Bright foreground color
        currentFg = RGBA.fromHex(ANSI_COLORS[param]);
      } else if (param >= 100 && param <= 107) {
        // Bright background color
        const fgCode = getBgColorCode(param);
        if (fgCode !== null) {
          currentBg = RGBA.fromHex(ANSI_COLORS[fgCode]);
        }
      }

    }

    lastIndex = regex.lastIndex;
  }

  // Add any remaining text after the last escape sequence
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      fg: currentFg,
      bg: currentBg,
      bold,
      dim,
      italic,
      underline,
    });
  }

  // If no segments were created (no ANSI codes), return the whole text as one segment
  if (segments.length === 0 && text.length > 0) {
    segments.push({ text });
  }

  return segments;
}

/**
 * Strip all ANSI escape codes from text, returning plain text.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Calculate the display width of text, ignoring ANSI escape sequences.
 * Note: Does not handle wide characters (CJK, emoji) - assumes 1 char = 1 cell.
 */
export function displayWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Slice text by visual (display) position rather than raw string index.
 * ANSI escape codes are skipped when counting positions, so visual
 * coordinates from the rendered output map correctly to the underlying text.
 * Returns plain text (ANSI codes stripped from the result).
 */
export function sliceByDisplayPosition(
  text: string,
  start: number,
  end?: number,
): string {
  const result: string[] = [];
  let visualPos = 0;
  let inEscape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === "\x1B") {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (char === "m") {
        inEscape = false;
      }
      continue;
    }

    if (end !== undefined && visualPos >= end) break;

    if (visualPos >= start) {
      result.push(char);
    }

    visualPos++;
  }

  return result.join("");
}
