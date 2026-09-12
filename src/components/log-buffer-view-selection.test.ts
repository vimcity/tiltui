import { describe, test, expect } from "bun:test";
import { sliceByDisplayPosition } from "../utils/ansi-parser";
import { extractSelectedText } from "./log-selection";
import type { VisibleRow } from "./log-buffer";
import type { LogLine } from "../tilt/types";

function makeRow(text: string, isContinuation = false): VisibleRow {
  const line: LogLine = {
    text,
    level: "INFO",
    manifestName: "test",
    spanId: "span-1",
    storedLineIndex: 0,
    time: "2024-01-01T12:34:56Z",
  };
  return { text, level: "INFO", isContinuation, line };
}

describe("sliceByDisplayPosition", () => {
  test("slices plain text by position", () => {
    expect(sliceByDisplayPosition("Hello World", 0, 5)).toBe("Hello");
    expect(sliceByDisplayPosition("Hello World", 6)).toBe("World");
    expect(sliceByDisplayPosition("Hello World", 6, 11)).toBe("World");
  });

  test("skips ANSI escape codes when counting positions", () => {
    const text = "\x1b[31mHello\x1b[0m World";
    expect(sliceByDisplayPosition(text, 0, 5)).toBe("Hello");
    expect(sliceByDisplayPosition(text, 6, 11)).toBe("World");
    expect(sliceByDisplayPosition(text, 0, 11)).toBe("Hello World");
  });

  test("handles ANSI codes at start of text", () => {
    const text = "\x1b[1;33mWarning:\x1b[0m check this";
    expect(sliceByDisplayPosition(text, 0, 8)).toBe("Warning:");
  });

  test("handles multiple ANSI codes in middle", () => {
    const text = "before\x1b[31mred\x1b[0mmiddle\x1b[34mblue\x1b[0mafter";
    expect(sliceByDisplayPosition(text, 0)).toBe("beforeredmiddleblueafter");
    expect(sliceByDisplayPosition(text, 6, 9)).toBe("red");
    expect(sliceByDisplayPosition(text, 9, 15)).toBe("middle");
  });

  test("handles text with no ANSI codes", () => {
    expect(sliceByDisplayPosition("plain text", 5)).toBe(" text");
    expect(sliceByDisplayPosition("plain text", 0, 5)).toBe("plain");
  });

  test("handles empty result", () => {
    expect(sliceByDisplayPosition("Hello", 5, 5)).toBe("");
    expect(sliceByDisplayPosition("Hello", 10)).toBe("");
  });
});

describe("extractSelectedText", () => {
  test("single-line selection with plain text", () => {
    const rows = [makeRow("[12:00:00] Hello World")];
    const result = extractSelectedText(rows, 11, 0, 15, 0);
    expect(result).toBe("Hello");
  });

  test("single-line selection with ANSI codes", () => {
    const rows = [makeRow("[12:00:00] \x1b[31mERROR:\x1b[0m something")];
    const result = extractSelectedText(rows, 11, 0, 16, 0);
    expect(result).toBe("ERROR:");
  });

  test("multi-line selection with plain text", () => {
    const rows = [
      makeRow("[12:00:00] Line one"),
      makeRow("[12:00:01] Line two"),
      makeRow("[12:00:02] Line three"),
    ];
    const result = extractSelectedText(rows, 11, 0, 14, 2);
    expect(result).toBe("Line one\n[12:00:01] Line two\n[12:00:02] Line");
  });

  test("multi-line selection with ANSI codes", () => {
    const rows = [
      makeRow("[12:00:00] \x1b[31mERROR:\x1b[0m first error"),
      makeRow("[12:00:01] \x1b[33mWARN:\x1b[0m a warning"),
      makeRow("[12:00:02] \x1b[31mERROR:\x1b[0m second error"),
    ];
    const result = extractSelectedText(rows, 11, 0, 16, 2);
    expect(result).toBe("ERROR: first error\n[12:00:01] WARN: a warning\n[12:00:02] ERROR:");
  });

  test("returns empty string for collapsed selection", () => {
    const rows = [makeRow("Hello")];
    expect(extractSelectedText(rows, 3, 0, 3, 0)).toBe("");
  });

  test("handles reversed selection (focus before anchor)", () => {
    const rows = [makeRow("Hello World")];
    const result = extractSelectedText(rows, 10, 0, 0, 0);
    expect(result).toBe("Hello World");
  });

  test("handles reversed multi-line selection", () => {
    const rows = [
      makeRow("First line"),
      makeRow("Second line"),
    ];
    // anchor=(5,1) focus=(0,0) → normalized start=(0,0) end=(5,1)
    // Row 0: full line from startX=0 → "First line"
    // Row 1: slice to endX+1=6 → "Second"
    const result = extractSelectedText(rows, 5, 1, 0, 0);
    expect(result).toBe("First line\nSecond");
  });

  test("clamps to row boundaries", () => {
    const rows = [makeRow("Short")];
    const result = extractSelectedText(rows, 0, 0, 100, 0);
    expect(result).toBe("Short");
  });

  test("handles selection starting before first row", () => {
    const rows = [makeRow("Hello"), makeRow("World")];
    const result = extractSelectedText(rows, 0, -1, 4, 0);
    expect(result).toBe("Hello");
  });

  test("handles selection ending past last row", () => {
    const rows = [makeRow("Hello"), makeRow("World")];
    const result = extractSelectedText(rows, 0, 0, 4, 10);
    expect(result).toBe("Hello\nWorld");
  });
});
