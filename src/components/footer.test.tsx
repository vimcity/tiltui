import { describe, test, expect } from "bun:test";

// Extract formatUptime for testing
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

describe("formatUptime", () => {
  test("returns empty string for null", () => {
    expect(formatUptime(null)).toBe("");
  });

  test("formats seconds only", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 5000); // 5 seconds ago
    expect(formatUptime(start.toISOString())).toBe("5s");
  });

  test("formats minutes and seconds", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 125000); // 2 minutes 5 seconds ago
    expect(formatUptime(start.toISOString())).toBe("2m 5s");
  });

  test("formats hours and minutes", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 3665000); // 1 hour 1 minute 5 seconds ago
    expect(formatUptime(start.toISOString())).toBe("1h 1m");
  });

  test("formats days and hours", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 90000000); // 1 day 1 hour ago
    expect(formatUptime(start.toISOString())).toBe("1d 1h");
  });

  test("handles exact minute boundary", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 60000); // exactly 1 minute ago
    expect(formatUptime(start.toISOString())).toBe("1m 0s");
  });

  test("handles exact hour boundary", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 3600000); // exactly 1 hour ago
    expect(formatUptime(start.toISOString())).toBe("1h 0m");
  });

  test("handles exact day boundary", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 86400000); // exactly 1 day ago
    expect(formatUptime(start.toISOString())).toBe("1d 0h");
  });

  test("handles multiple days", () => {
    const now = new Date();
    const start = new Date(now.getTime() - 259200000); // 3 days ago
    expect(formatUptime(start.toISOString())).toBe("3d 0h");
  });
});
