import { describe, test, expect, beforeEach, mock } from "bun:test";
import LogStore, { LogUpdateAction, LogAlertIndex } from "./logstore2";
import { APILogList, APILogSegment } from "./api-types";

// Helper to create a basic log segment
function createSegment(
  text: string,
  spanId = "span:1",
  level = "INFO",
  time = "2024-01-01T00:00:00Z",
  fields?: Record<string, string>,
  anchor?: boolean,
): APILogSegment {
  return { text, spanId, level, time, fields, anchor };
}

// Helper to create a basic log list
function createLogList(
  segments: APILogSegment[],
  spans: Record<string, { manifestName?: string }> = {},
  fromCheckpoint = 0,
  toCheckpoint?: number,
): APILogList {
  return {
    segments,
    spans,
    fromCheckpoint,
    toCheckpoint: toCheckpoint ?? segments.length,
  };
}

describe("LogStore", () => {
  let logStore: LogStore;

  beforeEach(() => {
    logStore = new LogStore();
  });

  describe("basic append operations", () => {
    test("starts empty", () => {
      expect(logStore.allLog()).toEqual([]);
      expect(logStore.checkpoint).toBe(0);
    });

    test("appends a single log line", () => {
      const logList = createLogList([createSegment("Hello world\n")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Hello world");
      expect(lines[0].manifestName).toBe("resource-a");
      expect(lines[0].level).toBe("INFO");
    });

    test("appends multiple log lines", () => {
      const logList = createLogList(
        [
          createSegment("Line 1\n"),
          createSegment("Line 2\n"),
          createSegment("Line 3\n"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(3);
      expect(lines[0].text).toBe("Line 1");
      expect(lines[1].text).toBe("Line 2");
      expect(lines[2].text).toBe("Line 3");
    });

    test("strips trailing newline from text", () => {
      const logList = createLogList([createSegment("Text with newline\n")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines[0].text).toBe("Text with newline");
    });

    test("preserves time field in log lines", () => {
      const timestamp = "2024-06-15T10:30:00.123Z";
      const logList = createLogList(
        [createSegment("Test\n", "span:1", "INFO", timestamp)],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines[0].time).toBe(timestamp);
    });
  });

  describe("line continuation", () => {
    test("continues incomplete lines from same span and level", () => {
      const logList = createLogList(
        [
          createSegment("Part 1 ", "span:1", "INFO"),
          createSegment("Part 2\n", "span:1", "INFO"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Part 1 Part 2");
    });

    test("does not continue lines from different spans", () => {
      const logList = createLogList(
        [
          createSegment("Span 1 text", "span:1", "INFO"),
          createSegment("Span 2 text\n", "span:2", "INFO"),
        ],
        {
          "span:1": { manifestName: "resource-a" },
          "span:2": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(2);
      expect(lines[0].text).toBe("Span 1 text");
      expect(lines[1].text).toBe("Span 2 text");
    });

    test("does not continue lines with different log levels", () => {
      const logList = createLogList(
        [
          createSegment("Info text", "span:1", "INFO"),
          createSegment("Warn text\n", "span:1", "WARN"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(2);
      expect(lines[0].level).toBe("INFO");
      expect(lines[1].level).toBe("WARN");
    });
  });

  describe("progress ID overwriting", () => {
    test("overwrites lines with same progressID", () => {
      const logList = createLogList(
        [
          createSegment(
            "Progress 0%\n",
            "span:1",
            "INFO",
            "2024-01-01T00:00:00Z",
            { progressID: "dl1" },
          ),
          createSegment(
            "Progress 50%\n",
            "span:1",
            "INFO",
            "2024-01-01T00:00:01Z",
            { progressID: "dl1" },
          ),
          createSegment(
            "Progress 100%\n",
            "span:1",
            "INFO",
            "2024-01-01T00:00:02Z",
            { progressID: "dl1" },
          ),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      // Should only have one line with the final progress
      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Progress 100%");
    });

    test("does not overwrite lines with different progressID", () => {
      const logList = createLogList(
        [
          createSegment(
            "Download A: 100%\n",
            "span:1",
            "INFO",
            "2024-01-01T00:00:00Z",
            { progressID: "dl-a" },
          ),
          createSegment(
            "Download B: 100%\n",
            "span:1",
            "INFO",
            "2024-01-01T00:00:01Z",
            { progressID: "dl-b" },
          ),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(2);
      expect(lines[0].text).toBe("Download A: 100%");
      expect(lines[1].text).toBe("Download B: 100%");
    });
  });

  describe("span filtering", () => {
    test("filters logs by manifest name", () => {
      const logList = createLogList(
        [
          createSegment("Resource A log\n", "span:a"),
          createSegment("Resource B log\n", "span:b"),
          createSegment("Resource A log 2\n", "span:a"),
        ],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);
      const aLogs = logStore.manifestLog("resource-a");
      const bLogs = logStore.manifestLog("resource-b");

      expect(aLogs.length).toBe(2);
      expect(bLogs.length).toBe(1);
      expect(aLogs[0].text).toBe("Resource A log");
      expect(aLogs[1].text).toBe("Resource A log 2");
      expect(bLogs[0].text).toBe("Resource B log");
    });

    test("filters logs by span IDs", () => {
      const logList = createLogList(
        [
          createSegment("Span 1 log\n", "span:1"),
          createSegment("Span 2 log\n", "span:2"),
        ],
        {
          "span:1": { manifestName: "resource-a" },
          "span:2": { manifestName: "resource-a" },
        },
      );

      logStore.append(logList);
      const span1Logs = logStore.spanLog(["span:1"]);

      expect(span1Logs.length).toBe(1);
      expect(span1Logs[0].text).toBe("Span 1 log");
    });

    test("hasLinesForSpan returns correct values", () => {
      const logList = createLogList([createSegment("Test\n", "span:1")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);

      expect(logStore.hasLinesForSpan("span:1")).toBe(true);
      // Returns falsy (undefined) for non-existent spans
      expect(logStore.hasLinesForSpan("span:nonexistent")).toBeFalsy();
    });
  });

  describe("alerts (warnings and errors)", () => {
    test("indexes warning log lines", () => {
      const logList = createLogList(
        [
          createSegment("Normal log\n", "span:1", "INFO"),
          createSegment(
            "Warning message\n",
            "span:1",
            "WARN",
            "2024-01-01T00:00:00Z",
            undefined,
            true,
          ),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const alerts = logStore.alertsForSpanId("span:1");

      expect(alerts.length).toBe(1);
      expect(alerts[0].level).toBe("WARN");
      expect(alerts[0].lineIndex).toBe(1);
    });

    test("indexes error log lines", () => {
      const logList = createLogList(
        [
          createSegment(
            "Error message\n",
            "span:1",
            "ERROR",
            "2024-01-01T00:00:00Z",
            undefined,
            true,
          ),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const alerts = logStore.alertsForSpanId("span:1");

      expect(alerts.length).toBe(1);
      expect(alerts[0].level).toBe("ERROR");
    });

    test("does not index alerts without anchor flag", () => {
      const logList = createLogList(
        [createSegment("Error without anchor\n", "span:1", "ERROR")],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const alerts = logStore.alertsForSpanId("span:1");

      expect(alerts.length).toBe(0);
    });

    test("returns empty array for nonexistent span", () => {
      const alerts = logStore.alertsForSpanId("nonexistent");
      expect(alerts).toEqual([]);
    });
  });

  describe("checkpoint-based updates", () => {
    test("updates checkpoint on append", () => {
      const logList = createLogList(
        [createSegment("Test\n")],
        { "span:1": { manifestName: "resource-a" } },
        0,
        5,
      );

      logStore.append(logList);
      expect(logStore.checkpoint).toBe(5);
    });

    test("returns incremental patch set", () => {
      // First append
      const logList1 = createLogList(
        [createSegment("Line 1\n", "span:1")],
        { "span:1": { manifestName: "resource-a" } },
        0,
        1,
      );
      logStore.append(logList1);
      const patchSet1 = logStore.allLogPatchSet(0);
      expect(patchSet1.lines.length).toBe(1);
      expect(patchSet1.checkpoint).toBe(1);

      // Second append
      const logList2 = createLogList(
        [createSegment("Line 2\n", "span:1")],
        { "span:1": { manifestName: "resource-a" } },
        1,
        2,
      );
      logStore.append(logList2);

      // Get only new lines
      const patchSet2 = logStore.allLogPatchSet(patchSet1.checkpoint);
      expect(patchSet2.lines.length).toBe(1);
      expect(patchSet2.lines[0].text).toBe("Line 2");
      expect(patchSet2.checkpoint).toBe(2);
    });

    test("handles duplicate checkpoint gracefully", () => {
      const logList1 = createLogList(
        [createSegment("Original\n")],
        { "span:1": { manifestName: "resource-a" } },
        0,
        1,
      );
      logStore.append(logList1);

      // Resend with overlapping checkpoint
      const logList2 = createLogList(
        [createSegment("Original\n"), createSegment("New\n")],
        { "span:1": { manifestName: "resource-a" } },
        0,
        2,
      );
      logStore.append(logList2);

      const lines = logStore.allLog();
      expect(lines.length).toBe(2);
    });

    test("ignores negative fromCheckpoint", () => {
      const logList = createLogList(
        [createSegment("Test\n")],
        { "span:1": { manifestName: "resource-a" } },
        -1,
        1,
      );
      logStore.append(logList);

      const lines = logStore.allLog();
      expect(lines.length).toBe(0);
    });
  });

  describe("update callbacks", () => {
    test("invokes callback on append", () => {
      const callback = mock((_: { action: LogUpdateAction }) => {});
      logStore.addUpdateListener(callback);

      const logList = createLogList([createSegment("Test\n")], {
        "span:1": { manifestName: "resource-a" },
      });
      logStore.append(logList);

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].action).toBe(LogUpdateAction.append);
    });

    test("removes callback correctly", () => {
      const callback = mock((_: { action: LogUpdateAction }) => {});
      logStore.addUpdateListener(callback);
      logStore.removeUpdateListener(callback);

      const logList = createLogList([createSegment("Test\n")], {
        "span:1": { manifestName: "resource-a" },
      });
      logStore.append(logList);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("span management", () => {
    test("registers new spans from log list", () => {
      const logList = createLogList([createSegment("Test\n", "span:1")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const spans = logStore.allSpans();

      expect(spans["span:1"]).toBeDefined();
      expect(spans["span:1"].manifestName).toBe("resource-a");
    });

    test("returns spans for manifest", () => {
      const logList = createLogList(
        [createSegment("Test\n", "span:a"), createSegment("Test\n", "span:b")],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);
      const spans = logStore.spansForManifest("resource-a");

      expect(Object.keys(spans).length).toBe(1);
      expect(spans["span:a"]).toBeDefined();
    });

    test("removes spans correctly", () => {
      const logList = createLogList(
        [
          createSegment("Span A log\n", "span:a"),
          createSegment("Span B log\n", "span:b"),
        ],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);
      logStore.removeSpans(["span:a"]);

      const lines = logStore.allLog();
      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("Span B log");
    });

    test("handles empty span ID correctly", () => {
      const logList = createLogList([createSegment("Default span\n", "")], {
        "": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(1);
      // Empty span ID is normalized to "_"
      expect(logStore.hasLinesForSpan("_")).toBe(true);
    });
  });

  describe("toLogList export", () => {
    test("exports logs back to API format", () => {
      const logList = createLogList(
        [
          createSegment("Line 1\n", "span:1"),
          createSegment("Line 2\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const exported = logStore.toLogList(null);

      expect(exported.segments.length).toBe(2);
      expect(exported.spans["span:1"]).toBeDefined();
      expect(exported.spans["span:1"].manifestName).toBe("resource-a");
    });

    test("respects maxSize in export", () => {
      const logList = createLogList(
        [
          createSegment("A".repeat(100) + "\n", "span:1"),
          createSegment("B".repeat(100) + "\n", "span:1"),
          createSegment("C".repeat(100) + "\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      // Export with maxSize of 150 bytes - should only get the last segment
      const exported = logStore.toLogList(150);

      expect(exported.segments.length).toBeLessThan(3);
    });
  });

  describe("log truncation", () => {
    test("truncates logs when exceeding max length", () => {
      // Set a small max length for testing
      logStore.maxLogLength = 100;

      const logList = createLogList(
        [
          createSegment("A".repeat(60) + "\n", "span:1"),
          createSegment("B".repeat(60) + "\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);

      // Total is 120 bytes, should trigger truncation
      // After truncation, should have approximately maxLogLength/2 bytes
      expect(logStore.logLength).toBeLessThanOrEqual(60);
    });

    test("logTruncationTarget is half of maxLogLength", () => {
      logStore.maxLogLength = 1000;
      expect(logStore.logTruncationTarget()).toBe(500);
    });
  });

  describe("build span operations", () => {
    test("gets ordered build span IDs", () => {
      const logList = createLogList(
        [
          createSegment("Build 1\n", "build:1"),
          createSegment("Build 2\n", "build:2"),
        ],
        {
          "build:1": { manifestName: "resource-a" },
          "build:2": { manifestName: "resource-a" },
        },
      );

      logStore.append(logList);
      const buildSpanIds = logStore.getOrderedBuildSpanIds("build:1");

      expect(buildSpanIds).toContain("build:1");
      expect(buildSpanIds).toContain("build:2");
    });

    test("returns empty array for nonexistent span", () => {
      const buildSpanIds = logStore.getOrderedBuildSpanIds("nonexistent");
      expect(buildSpanIds).toEqual([]);
    });

    test("nextBuildSpan returns next build in sequence", () => {
      const logList = createLogList(
        [
          createSegment("Build 1\n", "build:1"),
          createSegment("Build 2\n", "build:2"),
        ],
        {
          "build:1": { manifestName: "resource-a" },
          "build:2": { manifestName: "resource-a" },
        },
      );

      logStore.append(logList);
      const nextSpan = logStore.nextBuildSpan("build:1");

      expect(nextSpan).not.toBeNull();
      expect(nextSpan?.spanId).toBe("build:2");
    });

    test("nextBuildSpan returns null for last build", () => {
      const logList = createLogList([createSegment("Build 1\n", "build:1")], {
        "build:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const nextSpan = logStore.nextBuildSpan("build:1");

      expect(nextSpan).toBeNull();
    });
  });

  describe("trace log", () => {
    test("returns logs traced from a build span", () => {
      const logList = createLogList(
        [
          createSegment("Build log\n", "build:1"),
          createSegment("Runtime log\n", "runtime:1"),
        ],
        {
          "build:1": { manifestName: "resource-a" },
          "runtime:1": { manifestName: "resource-a" },
        },
      );

      logStore.append(logList);
      const traceLogs = logStore.traceLog("build:1");

      // Should include both the build log and subsequent runtime logs
      expect(traceLogs.length).toBeGreaterThanOrEqual(1);
    });

    test("returns empty array for non-build span", () => {
      const logList = createLogList(
        [createSegment("Runtime log\n", "runtime:1")],
        { "runtime:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const traceLogs = logStore.traceLog("runtime:1");

      expect(traceLogs).toEqual([]);
    });
  });

  describe("starred log", () => {
    test("returns patch set for starred manifests", () => {
      const logList = createLogList(
        [
          createSegment("Resource A\n", "span:a"),
          createSegment("Resource B\n", "span:b"),
          createSegment("Resource C\n", "span:c"),
        ],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
          "span:c": { manifestName: "resource-c" },
        },
      );

      logStore.append(logList);
      const patchSet = logStore.starredLogPatchSet(
        ["resource-a", "resource-c"],
        0,
      );

      expect(patchSet.lines.length).toBe(2);
      expect(patchSet.lines.map((l) => l.manifestName)).toContain("resource-a");
      expect(patchSet.lines.map((l) => l.manifestName)).toContain("resource-c");
      expect(patchSet.lines.map((l) => l.manifestName)).not.toContain(
        "resource-b",
      );
    });
  });

  describe("LogAlertIndex interface", () => {
    test("LogStore implements LogAlertIndex", () => {
      // TypeScript compile-time check
      const alertIndex: LogAlertIndex = logStore;
      expect(typeof alertIndex.alertsForSpanId).toBe("function");
    });
  });

  describe("log filtering", () => {
    test("filters out segments matching log filter patterns", () => {
      const filters = [
        {
          name: "test-filter",
          patterns: [/DEBUG/, /VERBOSE/],
        },
      ];
      logStore.setLogFilters(filters);

      const logList = createLogList(
        [
          createSegment("DEBUG: verbose output\n", "span:1"),
          createSegment("INFO: keep this\n", "span:1"),
          createSegment("VERBOSE trace\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(1);
      expect(lines[0].text).toBe("INFO: keep this");
    });

    test("streaming multiple segments with active filters maintains checkpoint continuity", () => {
      const filters = [
        {
          name: "verbose-filter",
          patterns: [/\[VERBOSE\]/],
        },
      ];
      logStore.setLogFilters(filters);

      // First batch: 10 segments, 8 filtered out, 2 kept
      const batch1Segments = [];
      for (let i = 1; i <= 10; i++) {
        if (i % 5 === 0) {
          batch1Segments.push(createSegment(`[INFO] Line ${i}\n`, "span:1"));
        } else {
          batch1Segments.push(
            createSegment(`[VERBOSE] Debug ${i}\n`, "span:1"),
          );
        }
      }
      const logList1 = createLogList(
        batch1Segments,
        { "span:1": { manifestName: "resource-a" } },
        0,
        10,
      );
      logStore.append(logList1);

      // Get initial state
      const patchSet1 = logStore.allLogPatchSet(0);
      expect(patchSet1.lines.length).toBe(2);
      expect(patchSet1.checkpoint).toBe(10);

      // Second batch: another 10 segments, 8 filtered, 2 kept
      const batch2Segments = [];
      for (let i = 11; i <= 20; i++) {
        if (i % 5 === 0) {
          batch2Segments.push(createSegment(`[INFO] Line ${i}\n`, "span:1"));
        } else {
          batch2Segments.push(
            createSegment(`[VERBOSE] Debug ${i}\n`, "span:1"),
          );
        }
      }
      const logList2 = createLogList(
        batch2Segments,
        { "span:1": { manifestName: "resource-a" } },
        10,
        20,
      );
      logStore.append(logList2);

      // Get incremental update
      const patchSet2 = logStore.allLogPatchSet(patchSet1.checkpoint);
      expect(patchSet2.lines.length).toBe(2);
      expect(patchSet2.checkpoint).toBe(20);
      expect(patchSet2.lines[0].text).toBe("[INFO] Line 15");
      expect(patchSet2.lines[1].text).toBe("[INFO] Line 20");
    });

    test("streaming with heavy filtering (99% filtered) still delivers all non-filtered lines", () => {
      const filters = [
        {
          name: "noise-filter",
          patterns: [/NOISE/],
        },
      ];
      logStore.setLogFilters(filters);

      // Simulate high-volume output with mostly noise
      const batch1Segments = [];
      for (let i = 1; i <= 100; i++) {
        if (i % 20 === 0) {
          batch1Segments.push(
            createSegment(`[IMPORTANT] Message ${i}\n`, "span:1"),
          );
        } else {
          batch1Segments.push(createSegment(`NOISE ${i}\n`, "span:1"));
        }
      }
      const logList1 = createLogList(
        batch1Segments,
        { "span:1": { manifestName: "resource-a" } },
        0,
        100,
      );
      logStore.append(logList1);

      const patchSet1 = logStore.allLogPatchSet(0);
      expect(patchSet1.lines.length).toBe(5); // Lines 20, 40, 60, 80, 100
      expect(patchSet1.checkpoint).toBe(100);

      // Second batch
      const batch2Segments = [];
      for (let i = 101; i <= 200; i++) {
        if (i % 20 === 0) {
          batch2Segments.push(
            createSegment(`[IMPORTANT] Message ${i}\n`, "span:1"),
          );
        } else {
          batch2Segments.push(createSegment(`NOISE ${i}\n`, "span:1"));
        }
      }
      const logList2 = createLogList(
        batch2Segments,
        { "span:1": { manifestName: "resource-a" } },
        100,
        200,
      );
      logStore.append(logList2);

      const patchSet2 = logStore.allLogPatchSet(patchSet1.checkpoint);
      expect(patchSet2.lines.length).toBe(5); // Lines 120, 140, 160, 180, 200
      expect(patchSet2.checkpoint).toBe(200);

      // Verify all lines are present
      const allLines = logStore.allLog();
      expect(allLines.length).toBe(10);
      expect(allLines[0].text).toBe("[IMPORTANT] Message 20");
      expect(allLines[9].text).toBe("[IMPORTANT] Message 200");
    });

    test("filters work correctly with multi-span streaming", () => {
      const filters = [
        {
          name: "span-a-filter",
          patterns: [/\[span-a-noise\]/],
        },
      ];
      logStore.setLogFilters(filters);

      const logList = createLogList(
        [
          createSegment("[span-a-noise] verbose\n", "span:a"),
          createSegment("[span-a] important\n", "span:a"),
          createSegment("[span-b] message\n", "span:b"),
          createSegment("[span-a-noise] more verbose\n", "span:a"),
          createSegment("[span-a] another important\n", "span:a"),
        ],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);

      const allLines = logStore.allLog();
      expect(allLines.length).toBe(3);
      expect(allLines[0].text).toBe("[span-a] important");
      expect(allLines[1].text).toBe("[span-b] message");
      expect(allLines[2].text).toBe("[span-a] another important");
    });

    test("incremental updates with filters handle line continuation correctly", () => {
      const filters = [
        {
          name: "filter",
          patterns: [/SKIP/],
        },
      ];
      logStore.setLogFilters(filters);

      // First batch - incomplete line that should not be filtered
      const logList1 = createLogList(
        [
          createSegment("Part 1 ", "span:1", "INFO"),
          createSegment("SKIP this line\n", "span:2", "INFO"),
        ],
        {
          "span:1": { manifestName: "resource-a" },
          "span:2": { manifestName: "resource-b" },
        },
        0,
        2,
      );
      logStore.append(logList1);

      const patchSet1 = logStore.allLogPatchSet(0);
      expect(patchSet1.lines.length).toBe(1);
      expect(patchSet1.lines[0].text).toBe("Part 1 ");

      // Second batch - complete the first line
      const logList2 = createLogList(
        [createSegment("Part 2\n", "span:1", "INFO")],
        { "span:1": { manifestName: "resource-a" } },
        2,
        3,
      );
      logStore.append(logList2);

      const patchSet2 = logStore.allLogPatchSet(patchSet1.checkpoint);
      expect(patchSet2.lines.length).toBe(1);
      expect(patchSet2.lines[0].text).toBe("Part 1 Part 2");
    });

    test("manifest log with filters returns only non-filtered lines", () => {
      const filters = [
        {
          name: "filter",
          patterns: [/FILTERED/],
        },
      ];
      logStore.setLogFilters(filters);

      const logList = createLogList(
        [
          createSegment("FILTERED line 1\n", "span:a"),
          createSegment("KEEP line 2\n", "span:a"),
          createSegment("FILTERED line 3\n", "span:b"),
          createSegment("KEEP line 4\n", "span:b"),
        ],
        {
          "span:a": { manifestName: "resource-a" },
          "span:b": { manifestName: "resource-b" },
        },
      );

      logStore.append(logList);

      const aLogs = logStore.manifestLog("resource-a");
      const bLogs = logStore.manifestLog("resource-b");

      expect(aLogs.length).toBe(1);
      expect(aLogs[0].text).toBe("KEEP line 2");
      expect(bLogs.length).toBe(1);
      expect(bLogs[0].text).toBe("KEEP line 4");
    });

    test("checkpoint tracking remains consistent with filtered segments", () => {
      const filters = [
        {
          name: "filter",
          patterns: [/NOISE/],
        },
      ];
      logStore.setLogFilters(filters);

      // First append with mixed content
      const logList1 = createLogList(
        [
          createSegment("SIGNAL 1\n", "span:1"),
          createSegment("NOISE 1\n", "span:1"),
          createSegment("NOISE 2\n", "span:1"),
          createSegment("SIGNAL 2\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
        0,
        4,
      );
      logStore.append(logList1);

      expect(logStore.checkpoint).toBe(4);
      const lines1 = logStore.allLog();
      expect(lines1.length).toBe(2);

      // Second append continuing from checkpoint
      const logList2 = createLogList(
        [
          createSegment("NOISE 3\n", "span:1"),
          createSegment("SIGNAL 3\n", "span:1"),
        ],
        { "span:1": { manifestName: "resource-a" } },
        4,
        6,
      );
      logStore.append(logList2);

      expect(logStore.checkpoint).toBe(6);
      const lines2 = logStore.allLog();
      expect(lines2.length).toBe(3);
      expect(lines2[2].text).toBe("SIGNAL 3");
    });
  });

  describe("edge cases", () => {
    test("handles segments without span in spans map gracefully", () => {
      const logList = createLogList(
        [createSegment("Orphan log\n", "orphan-span")],
        {}, // No spans defined
      );

      logStore.append(logList);
      const lines = logStore.allLog();

      // Should gracefully handle missing span
      expect(lines.length).toBe(0);
    });

    test("handles empty segment text", () => {
      const logList = createLogList([createSegment("", "span:1")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const lines = logStore.allLog();

      // Empty text should still create a line
      expect(lines.length).toBe(1);
    });

    test("handles very long log lines", () => {
      const longText = "X".repeat(10000) + "\n";
      const logList = createLogList([createSegment(longText, "span:1")], {
        "span:1": { manifestName: "resource-a" },
      });

      logStore.append(logList);
      const lines = logStore.allLog();

      expect(lines.length).toBe(1);
      expect(lines[0].text.length).toBe(10000);
    });

    test("handles multiple appends to same store", () => {
      const logList1 = createLogList(
        [createSegment("First\n", "span:1")],
        { "span:1": { manifestName: "resource-a" } },
        0,
        1,
      );
      const logList2 = createLogList(
        [createSegment("Second\n", "span:1")],
        { "span:1": { manifestName: "resource-a" } },
        1,
        2,
      );

      logStore.append(logList1);
      logStore.append(logList2);

      const lines = logStore.allLog();
      expect(lines.length).toBe(2);
      expect(lines[0].text).toBe("First");
      expect(lines[1].text).toBe("Second");
    });
  });
});
