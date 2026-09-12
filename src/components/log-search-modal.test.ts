import { describe, test, expect } from "bun:test";
import { parseSearchQuery } from "../utils/log-search-utils";

describe("parseSearchQuery", () => {
  test("returns null for empty string", () => {
    expect(parseSearchQuery("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseSearchQuery("   ")).toBeNull();
  });

  test("parses simple string query", () => {
    const result = parseSearchQuery("hello");
    expect(result).not.toBeNull();
    expect(result!.query).toBe("hello");
    expect(result!.isRegex).toBe(false);
    expect(result!.regex).toBeNull();
  });

  test("trims whitespace from query", () => {
    const result = parseSearchQuery("  hello  ");
    expect(result!.query).toBe("hello");
  });

  test("parses regex syntax /pattern/", () => {
    const result = parseSearchQuery("/error/");
    expect(result!.isRegex).toBe(true);
    expect(result!.regex).not.toBeNull();
    expect(result!.regex!.test("error")).toBe(true);
    expect(result!.regex!.test("ERROR")).toBe(true); // default case-insensitive
  });

  test("parses regex with flags /pattern/gi", () => {
    const result = parseSearchQuery("/error/g");
    expect(result!.isRegex).toBe(true);
    expect(result!.regex!.flags).toContain("g");
  });

  test("falls back to string match for invalid regex", () => {
    const result = parseSearchQuery("/[invalid/");
    expect(result!.isRegex).toBe(false);
    expect(result!.regex).toBeNull();
    expect(result!.query).toBe("/[invalid/");
  });

  test("treats single slash as string, not regex", () => {
    const result = parseSearchQuery("/path/to/file");
    expect(result!.isRegex).toBe(false);
    expect(result!.query).toBe("/path/to/file");
  });

  test("parses regex with complex pattern", () => {
    const result = parseSearchQuery("/Error:\\s+\\w+/i");
    expect(result!.isRegex).toBe(true);
    expect(result!.regex!.test("Error: something")).toBe(true);
    expect(result!.regex!.test("error: thing")).toBe(true);
    expect(result!.regex!.test("Warning: something")).toBe(false);
  });
});
