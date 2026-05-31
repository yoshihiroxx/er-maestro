import type { Relationship } from "../types";

/** Undirected adjacency map: table id -> set of directly connected table ids. */
export function buildAdjacency(
  relationships: Relationship[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const r of relationships) {
    link(r.from_table, r.to_table);
    link(r.to_table, r.from_table);
  }
  return adj;
}

/**
 * BFS outward from `start` up to `depth` hops (undirected). The returned set
 * always includes `start` itself. depth 1 = direct neighbors, etc.
 */
export function relatedTables(
  adjacency: Map<string, Set<string>>,
  start: string,
  depth: number,
): Set<string> {
  const visited = new Set<string>([start]);
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return visited;
}
