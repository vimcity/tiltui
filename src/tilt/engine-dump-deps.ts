import type { EngineDump } from "./client";

export interface DependencyNode {
  name: string;
  deps: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  root: string;
}

/** One rendered row of the dependency tree with optional manifest for status UI. */
export interface DependencyTreeLine {
  textLeft: string;
  textRight?: string;
  resourceName: string | null;
}

export function dependencyLineDisplayText(line: DependencyTreeLine): string {
  return line.textLeft + (line.textRight ?? "");
}

export function collectDependencies(
  rootName: string,
  dump: EngineDump,
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const visited = new Set<string>();
  const queue = [rootName];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);

    const target = dump.manifestTargets[name];
    const deps = target?.manifest?.resourceDependencies ?? [];

    nodes.set(name, { name, deps });

    for (const dep of deps) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return { nodes, root: rootName };
}

export function asciiDependencyTreeRows(
  rootName: string,
  graph: DependencyGraph,
): DependencyTreeLine[] {
  const rows: DependencyTreeLine[] = [];

  function recur(
    name: string,
    indent: string,
    isTail: boolean,
    ancestors: Set<string>,
    isRoot: boolean,
  ): void {
    if (isRoot) {
      rows.push({ textLeft: name, resourceName: name });
    } else {
      const branch = isTail ? "└── " : "├── ";
      rows.push({
        textLeft: indent + branch,
        textRight: name,
        resourceName: name,
      });
    }

    const path = new Set(ancestors);
    path.add(name);

    const node = graph.nodes.get(name);
    const deps = [...(node?.deps ?? [])].sort((a, b) => a.localeCompare(b));
    const childIndent = isRoot ? "" : indent + (isTail ? "    " : "│   ");

    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      const isLastDep = i === deps.length - 1;
      if (path.has(dep)) {
        const br = isLastDep ? "└── " : "├── ";
        rows.push({
          textLeft: `${childIndent}${br}`,
          textRight: `${dep} (cycle)`,
          resourceName: dep,
        });
        continue;
      }
      recur(dep, childIndent, isLastDep, path, false);
    }
  }

  recur(rootName, "", true, new Set(), true);
  return rows;
}
export function buildDependencyTreeRows(
  resourceName: string,
  dump: EngineDump,
): DependencyTreeLine[] | null {
  if (resourceName === "(Tiltfile)") {
    const path = dump.desiredTiltfilePath ?? "unknown";
    return [
      { textLeft: "Tiltfile", resourceName: null },
      { textLeft: `Path: ${path}`, resourceName: null },
      { textLeft: "", resourceName: null },
      { textLeft: "(no dependency tree)", resourceName: null },
    ];
  }

  if (!dump.manifestTargets[resourceName]) {
    return null;
  }

  const graph = collectDependencies(resourceName, dump);
  return asciiDependencyTreeRows(resourceName, graph);
}
