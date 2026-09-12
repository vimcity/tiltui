import { describe, test, expect, beforeEach } from "bun:test";
import { LogBuffer } from "./log-buffer";
import type { LogLine, LogLevel } from "../tilt/types";

function makeLine(
  text: string,
  level: LogLevel = "INFO",
  index: number = 0,
): LogLine {
  return {
    text,
    level,
    manifestName: "test",
    spanId: "span-1",
    storedLineIndex: index,
    time: "2024-01-01T12:34:56Z",
  };
}

function makeLines(count: number, prefix = "Line"): LogLine[] {
  return Array.from({ length: count }, (_, i) =>
    makeLine(`${prefix} ${i}`, "INFO", i),
  );
}

describe("LogBuffer", () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer();
    buffer.width = 40;
    buffer.height = 10;
  });

  describe("appendLines", () => {
    test("appends lines and updates line count", () => {
      buffer.appendLines([makeLine("Hello"), makeLine("World")]);

      expect(buffer.lineCount).toBe(2);
    });

    test("stores references to original LogLine objects", () => {
      const line = makeLine("Test");
      buffer.appendLines([line]);

      const rows = buffer.getVisibleRows();
      expect(rows[0].line).toBe(line);
    });

    test("auto-scrolls to bottom by default", () => {
      buffer.appendLines(makeLines(20));

      // Should be scrolled to show the last lines
      const rows = buffer.getVisibleRows();
      expect(rows[rows.length - 1].text).toContain("Line 19");
    });
  });

  describe("word wrapping", () => {
    test("does not wrap short lines", () => {
      buffer.appendLines([makeLine("Short line")]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBe(1);
      expect(rows[0].isContinuation).toBe(false);
    });

    test("wraps long lines with continuation indicator", () => {
      // Create a line that will definitely wrap at width 40
      const longText =
        "This is a very long line that should definitely wrap at word boundaries because it is longer than 40 characters";
      buffer.appendLines([makeLine(longText)]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBeGreaterThan(1);
      expect(rows[0].isContinuation).toBe(false);
      expect(rows[1].isContinuation).toBe(true);
      expect(rows[1].text.startsWith("  ")).toBe(true);
    });

    test("removes carriage returns from terminal progress output", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([makeLine("old progress\rnew progress")]);

      const rows = buffer.getVisibleRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].text).toBe("old progressnew progress");
    });

    test("falls back to character wrap for long words", () => {
      // Word longer than available width
      const longWord = "A".repeat(50);
      buffer.appendLines([makeLine(longWord)]);

      const rows = buffer.getVisibleRows();
      expect(rows.length).toBeGreaterThan(1);
    });

    test("recalculates wrapping when width changes", () => {
      const text = "This line fits in 80 chars but not 20";
      buffer.width = 80;
      buffer.appendLines([makeLine(text)]);

      const rowsBefore = buffer.getVisibleRows().length;

      buffer.width = 25;
      buffer.recalculateWrapping();

      const rowsAfter = buffer.getVisibleRows().length;
      expect(rowsAfter).toBeGreaterThan(rowsBefore);
    });
  });

  describe("timestamps", () => {
    test("includes timestamp when showTimestamps is true", () => {
      buffer.showTimestamps = true;
      buffer.appendLines([makeLine("Test")]);

      const rows = buffer.getVisibleRows();
      // Should contain HH:MM:SS format
      expect(rows[0].text).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    test("excludes timestamp when showTimestamps is false", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([makeLine("Test")]);

      const rows = buffer.getVisibleRows();
      expect(rows[0].text).not.toMatch(/\[/);
      expect(rows[0].text).toBe("Test");
    });

    test("rewraps when timestamp visibility changes", () => {
      buffer.showTimestamps = true;
      buffer.width = 50;
      // Line that fits without timestamp but might wrap with timestamp
      buffer.appendLines([makeLine("A moderately long line of text here")]);

      const rowsWithTs = buffer.getVisibleRows().length;

      buffer.showTimestamps = false;
      // Wrapping is recalculated in setter

      const rowsWithoutTs = buffer.getVisibleRows().length;
      expect(rowsWithoutTs).toBeLessThanOrEqual(rowsWithTs);
    });
  });

  describe("scrolling", () => {
    test("scrollToTop moves to position 0", () => {
      buffer.appendLines(makeLines(50));

      buffer.scrollToTop();

      expect(buffer.scrollTop).toBe(0);
    });

    test("scrollToTop disables autoScroll", () => {
      buffer.appendLines(makeLines(50));

      buffer.scrollToTop();

      expect(buffer.autoScroll).toBe(false);
    });

    test("scrollToBottom enables autoScroll", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollToTop();

      buffer.scrollToBottom();

      expect(buffer.autoScroll).toBe(true);
    });

    test("scrollBy moves scroll position", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollToTop();

      const initialTop = buffer.scrollTop;
      buffer.scrollBy(5);

      expect(buffer.scrollTop).toBe(initialTop + 5);
    });

    test("scrollBy with negative moves up", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollTo(20);

      buffer.scrollBy(-5);

      expect(buffer.scrollTop).toBe(15);
    });

    test("scroll position is clamped to minimum 0", () => {
      buffer.appendLines(makeLines(5));

      buffer.scrollTo(-100);

      expect(buffer.scrollTop).toBe(0);
    });

    test("scroll position is clamped to maximum", () => {
      buffer.appendLines(makeLines(5));

      buffer.scrollTo(10000);

      // Should be clamped to max scroll position
      expect(buffer.scrollTop).toBeLessThanOrEqual(
        Math.max(0, buffer.scrollHeight - buffer.height),
      );
    });

    test("auto-scroll appends new lines at bottom", () => {
      buffer.autoScroll = true;
      buffer.appendLines(makeLines(50));

      const rowsBefore = buffer.getVisibleRows();
      const lastBefore = rowsBefore[rowsBefore.length - 1];

      buffer.appendLines([makeLine("New line", "INFO", 50)]);

      const rowsAfter = buffer.getVisibleRows();
      const lastAfter = rowsAfter[rowsAfter.length - 1];

      expect(lastAfter.text).toContain("New line");
    });

    test("does not auto-scroll when disabled", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollToTop();
      buffer.autoScroll = false;

      const topBefore = buffer.scrollTop;

      buffer.appendLines([makeLine("New line", "INFO", 50)]);

      expect(buffer.scrollTop).toBe(topBefore);
    });
  });

  describe("clear", () => {
    test("resets all state", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollBy(10);
      buffer.checkpoint = 100;

      buffer.clear();

      expect(buffer.lineCount).toBe(0);
      expect(buffer.scrollTop).toBe(0);
      expect(buffer.scrollHeight).toBe(0);
      expect(buffer.checkpoint).toBe(0);
    });
  });

  describe("getVisibleRows", () => {
    test("returns only rows in viewport", () => {
      buffer.appendLines(makeLines(50));

      const rows = buffer.getVisibleRows();

      expect(rows.length).toBeLessThanOrEqual(buffer.height);
    });

    test("returns empty array when no lines", () => {
      const rows = buffer.getVisibleRows();

      expect(rows.length).toBe(0);
    });

    test("includes level information", () => {
      buffer.appendLines([
        makeLine("Info", "INFO", 0),
        makeLine("Warning", "WARN", 1),
        makeLine("Error", "ERROR", 2),
      ]);

      const rows = buffer.getVisibleRows();

      expect(rows[0].level).toBe("INFO");
      expect(rows[1].level).toBe("WARN");
      expect(rows[2].level).toBe("ERROR");
    });

    test("marks continuation rows correctly", () => {
      // Create a line that will wrap
      const longText = "A ".repeat(50);
      buffer.appendLines([makeLine(longText)]);

      const rows = buffer.getVisibleRows();

      // First row is not continuation
      expect(rows[0].isContinuation).toBe(false);

      // All subsequent rows for this line are continuations
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].isContinuation).toBe(true);
      }
    });
  });

  describe("scrollHeight", () => {
    test("equals line count for short lines", () => {
      buffer.showTimestamps = false;
      buffer.appendLines(makeLines(10, "Short"));

      // Each short line = 1 display row
      expect(buffer.scrollHeight).toBe(10);
    });

    test("is greater than line count when lines wrap", () => {
      const longLines = Array.from({ length: 5 }, (_, i) =>
        makeLine("A ".repeat(50), "INFO", i),
      );
      buffer.appendLines(longLines);

      // Each long line wraps to multiple rows
      expect(buffer.scrollHeight).toBeGreaterThan(5);
    });
  });

  describe("autoScroll property", () => {
    test("setting autoScroll true scrolls to bottom", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollToTop();

      buffer.autoScroll = true;

      // Should be at/near bottom
      const maxScroll = buffer.scrollHeight - buffer.height;
      expect(buffer.scrollTop).toBe(maxScroll);
    });

    test("setting autoScroll false does not move position", () => {
      buffer.appendLines(makeLines(50));
      buffer.scrollTo(10);

      buffer.autoScroll = false;

      expect(buffer.scrollTop).toBe(10);
    });

    test("resize does not re-enable autoScroll when user has scrolled up", () => {
      // Setup: narrow width so lines wrap more
      buffer.showTimestamps = false;
      buffer.width = 20;
      buffer.height = 10;

      // Create lines that will wrap at narrow width but not at wider width
      const longLines = Array.from({ length: 20 }, (_, i) =>
        makeLine("A".repeat(30), "INFO", i),
      );
      buffer.appendLines(longLines);

      // Verify we have wrapped lines (totalDisplayRows > lineCount)
      const rowsBefore = buffer.scrollHeight;
      expect(rowsBefore).toBeGreaterThan(20);
      expect(buffer.autoScroll).toBe(true);

      // User scrolls up - this should disable autoScroll
      buffer.scrollBy(-5);
      expect(buffer.autoScroll).toBe(false);

      // Simulate sidebar collapse: width increases, causing resize/rewrap
      // Lines that wrapped before might now fit, reducing totalDisplayRows
      buffer.resize(80, buffer.height);

      // totalDisplayRows should have decreased since lines fit without wrapping
      const rowsAfter = buffer.scrollHeight;
      expect(rowsAfter).toBeLessThan(rowsBefore);

      // autoScroll should STILL be false since user explicitly scrolled up
      expect(buffer.autoScroll).toBe(false);
    });

    test("scrollBy works multiple times in succession", () => {
      // Setup: buffer with enough content to scroll
      buffer.appendLines(makeLines(100));

      // Scroll up multiple times
      for (let i = 0; i < 5; i++) {
        const before = buffer.scrollTop;
        buffer.scrollBy(-1);
        expect(buffer.scrollTop).toBe(before - 1);
      }

      // Verify we're not stuck
      expect(buffer.scrollTop).toBeLessThan(
        buffer.scrollHeight - buffer.height - 4,
      );
    });
  });

  describe("searchFilter", () => {
    test("isFiltering returns false when no filter is set", () => {
      buffer.appendLines(makeLines(10));

      expect(buffer.isFiltering).toBe(false);
    });

    test("isFiltering returns true when filter is set", () => {
      buffer.appendLines(makeLines(10));
      buffer.searchFilter = { query: "test", isRegex: false, regex: null };

      expect(buffer.isFiltering).toBe(true);
    });

    test("string filter matches case-insensitively", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([
        makeLine("Hello World", "INFO", 0),
        makeLine("hello world", "INFO", 1),
        makeLine("HELLO WORLD", "INFO", 2),
        makeLine("Something else", "INFO", 3),
      ]);

      buffer.searchFilter = { query: "hello", isRegex: false, regex: null };

      expect(buffer.matchCount).toBe(3);
      const rows = buffer.getVisibleRows();
      expect(rows.length).toBe(3);
    });

    test("regex filter matches correctly", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([
        makeLine("Error: something failed", "ERROR", 0),
        makeLine("Warning: check this", "WARN", 1),
        makeLine("Info: all good", "INFO", 2),
        makeLine("Error: another failure", "ERROR", 3),
      ]);

      buffer.searchFilter = {
        query: "/Error:/",
        isRegex: true,
        regex: new RegExp("Error:", "i"),
      };

      expect(buffer.matchCount).toBe(2);
      const rows = buffer.getVisibleRows();
      expect(rows.length).toBe(2);
    });

    test("clearing filter restores all lines", () => {
      buffer.showTimestamps = false;
      buffer.appendLines(makeLines(10));

      buffer.searchFilter = { query: "Line 5", isRegex: false, regex: null };
      expect(buffer.matchCount).toBe(1);

      buffer.searchFilter = null;

      expect(buffer.isFiltering).toBe(false);
      const rows = buffer.getVisibleRows();
      expect(rows.length).toBe(10);
    });

    test("filter preserves buildEvent separator lines", () => {
      buffer.showTimestamps = false;
      const lines = [
        makeLine("Normal line", "INFO", 0),
        { ...makeLine("Build separator", "INFO", 1), buildEvent: "start" },
        makeLine("Build output", "INFO", 2),
        makeLine("Another normal line", "INFO", 3),
      ];
      buffer.appendLines(lines);

      buffer.searchFilter = { query: "separator", isRegex: false, regex: null };

      // Should include the separator line and one match
      const rows = buffer.getVisibleRows();
      expect(rows.some((r) => r.line.buildEvent)).toBe(true);
    });

    test("match ranges are provided for visible rows when filtering", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([makeLine("Hello World, hello again!", "INFO", 0)]);

      buffer.searchFilter = { query: "hello", isRegex: false, regex: null };

      const rows = buffer.getVisibleRows();
      expect(rows[0].matches).toBeDefined();
      expect(rows[0].matches!.length).toBe(2);
      expect(rows[0].matches![0].start).toBe(0);
      expect(rows[0].matches![0].end).toBe(5);
      expect(rows[0].matches![1].start).toBe(13);
      expect(rows[0].matches![1].end).toBe(18);
    });

    test("scrollHeight reflects filtered content when filtering", () => {
      buffer.showTimestamps = false;
      buffer.appendLines(makeLines(100));

      const heightBefore = buffer.scrollHeight;

      buffer.searchFilter = { query: "Line 5", isRegex: false, regex: null };

      // Only lines containing "Line 5" match: Line 5, Line 50-59
      expect(buffer.scrollHeight).toBeLessThan(heightBefore);
      expect(buffer.matchCount).toBe(11); // Line 5 and Line 50-59
    });

    test("new lines are filtered when appended during active filter", () => {
      buffer.showTimestamps = false;
      buffer.appendLines([
        makeLine("Find this line", "INFO", 0),
        makeLine("Not relevant", "INFO", 1),
      ]);

      buffer.searchFilter = { query: "Find", isRegex: false, regex: null };
      expect(buffer.matchCount).toBe(1);

      // Append new lines while filter is active
      buffer.appendLines([
        makeLine("Another Find here", "INFO", 2),
        makeLine("Still not relevant", "INFO", 3),
      ]);

      expect(buffer.matchCount).toBe(2);
    });

    test("clear resets filter state", () => {
      buffer.appendLines(makeLines(10));
      buffer.searchFilter = { query: "test", isRegex: false, regex: null };

      buffer.clear();

      expect(buffer.isFiltering).toBe(false);
      expect(buffer.matchCount).toBe(0);
    });
  });
});
