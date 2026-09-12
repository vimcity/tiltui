import { describe, expect, it } from "bun:test";
import type { EngineDump } from "./client";
import {
  asciiDependencyTreeRows,
  buildDependencyTreeRows,
  collectDependencies,
  dependencyLineDisplayText,
} from "./engine-dump-deps";

function createDump(
  manifests: Record<string, string[]>,
  tiltfilePath?: string,
): EngineDump {
  const manifestTargets: EngineDump["manifestTargets"] = {};
  for (const [name, deps] of Object.entries(manifests)) {
    manifestTargets[name] = {
      manifest: {
        name: name,
        resourceDependencies: deps,
      },
    };
  }
  return { manifestTargets, desiredTiltfilePath: tiltfilePath };
}

describe("collectDependencies", () => {
  it("returns single node for resource with no deps", () => {
    const dump = createDump({ root: [] });
    const graph = collectDependencies("root", dump);
    expect(graph.nodes.size).toBe(1);
    expect(graph.nodes.get("root")?.deps).toEqual([]);
  });

  it("collects linear chain of dependencies", () => {
    const dump = createDump({
      app: ["db"],
      db: ["init"],
      init: [],
    });
    const graph = collectDependencies("app", dump);
    expect(graph.nodes.size).toBe(3);
    expect([...graph.nodes.keys()].sort()).toEqual(["app", "db", "init"]);
  });

  it("handles cycles without infinite loop", () => {
    const dump = createDump({
      a: ["b"],
      b: ["c"],
      c: ["a"],
    });
    const graph = collectDependencies("a", dump);
    expect(graph.nodes.size).toBe(3);
  });

  it("includes referenced deps even if missing from ManifestTargets", () => {
    const dump = createDump({
      app: ["known", "unknown"],
      known: [],
    });
    const graph = collectDependencies("app", dump);
    expect(graph.nodes.size).toBe(3);
    expect(graph.nodes.has("unknown")).toBe(true);
    expect(graph.nodes.get("unknown")?.deps).toEqual([]);
  });
});

describe("asciiDependencyTreeRows", () => {
  it("handles a single leaf", () => {
    const dump = createDump({ x: [] });
    const graph = collectDependencies("x", dump);
    const rows = asciiDependencyTreeRows("x", graph);
    expect(rows.map(dependencyLineDisplayText)).toEqual(["x"]);
    expect(rows.map((r) => r.resourceName)).toEqual(["x"]);
  });

  it("tags each tree line with the manifest name for status UI", () => {
    const dump = createDump({
      app: ["db"],
      db: ["init"],
      init: [],
    });
    const graph = collectDependencies("app", dump);
    const rows = asciiDependencyTreeRows("app", graph);
    expect(rows.map((r) => r.resourceName)).toEqual(["app", "db", "init"]);
  });

  it("marks a cycle on re-entry", () => {
    const dump = createDump({
      a: ["b"],
      b: ["c"],
      c: ["a"],
    });
    const graph = collectDependencies("a", dump);
    const rows = asciiDependencyTreeRows("a", graph);
    const cycleRow = rows.find((r) =>
      dependencyLineDisplayText(r).includes("(cycle)"),
    );
    expect(cycleRow?.resourceName).toBe("a");
    expect(
      rows.some((r) => dependencyLineDisplayText(r).includes("(cycle)")),
    ).toBe(true);
  });
});

describe("buildDependencyTreeRows", () => {
  it("returns tiltfile notice rows without resource names", () => {
    const dump = createDump({}, "/path/Tiltfile");
    const result = buildDependencyTreeRows("(Tiltfile)", dump);
    expect(result).not.toBeNull();
    expect(result!.every((r) => r.resourceName === null)).toBe(true);
    expect(
      result!.some((ln) =>
        dependencyLineDisplayText(ln).includes("/path/Tiltfile"),
      ),
    ).toBe(true);
  });

  it("returns null for unknown resource", () => {
    const dump = createDump({ known: [] });
    expect(buildDependencyTreeRows("ghost", dump)).toBeNull();
  });
});
