import { describe, test, expect } from "bun:test";
import { parseAnsi, stripAnsi, displayWidth } from "./ansi-parser";

describe("parseAnsi", () => {
  test("returns single segment for plain text", () => {
    const segments = parseAnsi("Hello World");
    expect(segments.length).toBe(1);
    expect(segments[0].text).toBe("Hello World");
    expect(segments[0].fg).toBeUndefined();
    expect(segments[0].bg).toBeUndefined();
    expect(segments[0].bold).toBeFalsy();
  });

  test("returns empty array for empty string", () => {
    const segments = parseAnsi("");
    expect(segments.length).toBe(0);
  });

  test("parses standard red foreground color", () => {
    const segments = parseAnsi("\x1B[31mRed\x1B[0m");
    // Only 1 segment since there's no text after the reset code
    expect(segments.length).toBe(1);
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].text).toBe("Red");
  });

  test("parses all standard foreground colors (30-37)", () => {
    for (let code = 30; code <= 37; code++) {
      const segments = parseAnsi(`\x1B[${code}mText\x1B[0m`);
      expect(segments[0].fg).toBeDefined();
      expect(segments[0].text).toBe("Text");
    }
  });

  test("parses bright foreground colors (90-97)", () => {
    for (let code = 90; code <= 97; code++) {
      const segments = parseAnsi(`\x1B[${code}mText\x1B[0m`);
      expect(segments[0].fg).toBeDefined();
      expect(segments[0].text).toBe("Text");
    }
  });

  test("handles reset code (0)", () => {
    const segments = parseAnsi("\x1B[31mRed\x1B[0mNormal");
    expect(segments.length).toBe(2);
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].text).toBe("Red");
    expect(segments[1].fg).toBeUndefined();
    expect(segments[1].text).toBe("Normal");
  });

  test("parses bold attribute (1)", () => {
    const segments = parseAnsi("\x1B[1mBold\x1B[0m");
    expect(segments[0].bold).toBe(true);
    expect(segments[0].text).toBe("Bold");
  });

  test("parses dim attribute (2)", () => {
    const segments = parseAnsi("\x1B[2mDim\x1B[0m");
    expect(segments[0].dim).toBe(true);
    expect(segments[0].text).toBe("Dim");
  });

  test("parses italic attribute (3)", () => {
    const segments = parseAnsi("\x1B[3mItalic\x1B[0m");
    expect(segments[0].italic).toBe(true);
  });

  test("parses underline attribute (4)", () => {
    const segments = parseAnsi("\x1B[4mUnderline\x1B[0m");
    expect(segments[0].underline).toBe(true);
  });

  test("handles multiple attributes in one sequence", () => {
    const segments = parseAnsi("\x1B[1;31mBoldRed\x1B[0m");
    expect(segments[0].bold).toBe(true);
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].text).toBe("BoldRed");
  });

  test("handles multiple separate sequences", () => {
    const segments = parseAnsi("\x1B[1mBold\x1B[31mBoldRed\x1B[0mNormal");
    expect(segments.length).toBe(3);
    expect(segments[0].bold).toBe(true);
    expect(segments[0].fg).toBeUndefined();
    expect(segments[1].bold).toBe(true);
    expect(segments[1].fg).toBeDefined();
    expect(segments[2].bold).toBeFalsy();
    expect(segments[2].fg).toBeUndefined();
  });

  test("parses background colors (40-47)", () => {
    const segments = parseAnsi("\x1B[41mRedBg\x1B[0m");
    expect(segments[0].bg).toBeDefined();
    expect(segments[0].text).toBe("RedBg");
  });

  test("parses bright background colors (100-107)", () => {
    const segments = parseAnsi("\x1B[101mBrightRedBg\x1B[0m");
    expect(segments[0].bg).toBeDefined();
    expect(segments[0].text).toBe("BrightRedBg");
  });

  test("handles empty parameter list as reset", () => {
    const segments = parseAnsi("\x1B[31mRed\x1B[mNormal");
    expect(segments[0].fg).toBeDefined();
    expect(segments[1].fg).toBeUndefined();
  });

  test("handles default foreground (39) and background (49)", () => {
    const segments = parseAnsi("\x1B[31;41mColored\x1B[39mNoFg\x1B[49mNoBg");
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].bg).toBeDefined();
    expect(segments[1].fg).toBeUndefined();
    expect(segments[1].bg).toBeDefined();
    expect(segments[2].bg).toBeUndefined();
  });

  test("handles text with no trailing reset", () => {
    const segments = parseAnsi("\x1B[31mRed text without reset");
    expect(segments.length).toBe(1);
    expect(segments[0].fg).toBeDefined();
    expect(segments[0].text).toBe("Red text without reset");
  });

  test("handles adjacent escape sequences", () => {
    const segments = parseAnsi("\x1B[31m\x1B[1mBoldRed");
    // Should be one segment since no text between sequences
    expect(segments.length).toBe(1);
    expect(segments[0].bold).toBe(true);
    expect(segments[0].fg).toBeDefined();
  });

  test("handles real-world npm output pattern", () => {
    const text = "\x1B[32m✓\x1B[0m Test passed";
    const segments = parseAnsi(text);
    expect(segments.length).toBe(2);
    expect(segments[0].fg).toBeDefined(); // Green checkmark
    expect(segments[0].text).toBe("✓");
    expect(segments[1].text).toBe(" Test passed");
  });
});

describe("stripAnsi", () => {
  test("returns plain text unchanged", () => {
    expect(stripAnsi("Hello World")).toBe("Hello World");
  });

  test("strips color codes", () => {
    expect(stripAnsi("\x1B[31mRed\x1B[0m")).toBe("Red");
  });

  test("strips multiple codes", () => {
    expect(stripAnsi("\x1B[1m\x1B[31mBoldRed\x1B[0m Normal")).toBe(
      "BoldRed Normal",
    );
  });

  test("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  test("strips cursor movement codes", () => {
    expect(stripAnsi("\x1B[2J\x1B[HCleared")).toBe("Cleared");
  });
});

describe("displayWidth", () => {
  test("returns length for plain text", () => {
    expect(displayWidth("Hello")).toBe(5);
  });

  test("ignores ANSI codes in width calculation", () => {
    expect(displayWidth("\x1B[31mRed\x1B[0m")).toBe(3);
  });

  test("handles mixed content", () => {
    // "Normal Bold Normal" = 6 + 1 + 4 + 1 + 6 = 18 chars
    expect(displayWidth("Normal \x1B[1mBold\x1B[0m Normal")).toBe(18);
  });

  test("returns 0 for empty string", () => {
    expect(displayWidth("")).toBe(0);
  });

  test("returns 0 for only ANSI codes", () => {
    expect(displayWidth("\x1B[31m\x1B[0m")).toBe(0);
  });
});
