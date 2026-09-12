import { describe, test, expect } from "bun:test";

// Extract formatUptime from header for testing
function formatUptime(startTime: string | null): string {
  if (!startTime) return "";

  const start = new Date(startTime);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

describe("Header formatUptime", () => {
  test("returns empty string for null", () => {
    expect(formatUptime(null)).toBe("");
  });

  test("formats seconds only", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 5000);
    expect(formatUptime(start.toISOString())).toBe("5s");
  });

  test("formats minutes and seconds", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 125000);
    expect(formatUptime(start.toISOString())).toBe("2m 5s");
  });

  test("formats hours and minutes", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 3665000);
    expect(formatUptime(start.toISOString())).toBe("1h 1m");
  });

  test("formats days and hours", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 90000000);
    expect(formatUptime(start.toISOString())).toBe("1d 1h");
  });

  test("handles long uptime", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 604800000); // 7 days
    expect(formatUptime(start.toISOString())).toBe("7d 0h");
  });
});
