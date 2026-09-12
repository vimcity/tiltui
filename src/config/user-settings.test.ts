import { describe, test, expect } from "bun:test";
import { shouldFilterLogLine, type CompiledLogFilters } from "./user-settings";

describe("shouldFilterLogLine", () => {
  test("returns false when no filters provided", () => {
    expect(shouldFilterLogLine("any text", [])).toBe(false);
  });

  test("returns true when text matches a filter pattern", () => {
    const filters: CompiledLogFilters[] = [
      { name: "test", patterns: [/error/i] },
    ];

    expect(shouldFilterLogLine("This is an error message", filters)).toBe(true);
    expect(shouldFilterLogLine("This is an ERROR message", filters)).toBe(true);
  });

  test("returns false when text does not match any filter", () => {
    const filters: CompiledLogFilters[] = [
      { name: "test", patterns: [/error/i] },
    ];

    expect(shouldFilterLogLine("This is a normal message", filters)).toBe(
      false,
    );
  });

  test("matches against multiple patterns in a filter", () => {
    const filters: CompiledLogFilters[] = [
      { name: "test", patterns: [/error/i, /warn/i] },
    ];

    expect(shouldFilterLogLine("Error occurred", filters)).toBe(true);
    expect(shouldFilterLogLine("Warning message", filters)).toBe(true);
    expect(shouldFilterLogLine("Info message", filters)).toBe(false);
  });

  test("matches against multiple filters", () => {
    const filters: CompiledLogFilters[] = [
      { name: "errors", patterns: [/error/i] },
      { name: "debug", patterns: [/debug/i] },
    ];

    expect(shouldFilterLogLine("Error occurred", filters)).toBe(true);
    expect(shouldFilterLogLine("Debug info", filters)).toBe(true);
    expect(shouldFilterLogLine("Normal log", filters)).toBe(false);
  });

  test("matches with regex anchors", () => {
    const filters: CompiledLogFilters[] = [
      { name: "flagd", patterns: [/^\[flagd\]/] },
    ];

    expect(shouldFilterLogLine("[flagd] some message", filters)).toBe(true);
    expect(shouldFilterLogLine("message from [flagd]", filters)).toBe(false);
    expect(shouldFilterLogLine("normal message", filters)).toBe(false);
  });

  test("matches complex regex patterns", () => {
    const filters: CompiledLogFilters[] = [
      { name: "timestamps", patterns: [/^\d{4}-\d{2}-\d{2}/] },
    ];

    expect(shouldFilterLogLine("2024-01-15 log entry", filters)).toBe(true);
    expect(shouldFilterLogLine("Some other log", filters)).toBe(false);
  });
});
