// dfs.js — Depth-First Search, the other algorithm you meet on day one.
// It dives as deep as possible down one branch before backtracking, using a
// stack (here an explicit array). It finds *a* path if one exists, but NOT the
// shortest one — the path it returns is whatever its dive happened to reach the
// goal through. Included as a baseline so the difference between "a path" and
// "the shortest path" is visible.

import { reconstructPath, makeStats, withPath } from './common.js';

export function* dfs(graph, start, goal, opts = {}) {
  const n = graph.n;
  const parent = new Int32Array(n);
  parent.fill(-1);
  const depth = new Int32Array(n);
  const visited = new Uint8Array(n);

  const stats = makeStats();
  const stack = [start];
  visited[start] = 1;
  stats.discovered++;
  stats.pushes++;

  while (stack.length) {
    if (stack.length > stats.maxFrontier) stats.maxFrontier = stack.length;
    const u = stack.pop();
    stats.settled++;
    yield { type: 'settle', node: u, dist: depth[u] };
    if (u === goal) break;

    // Push neighbours in reverse so they pop in natural order. Marking visited
    // on push keeps DFS from looping; the resulting parent tree gives one path.
    const nbrs = graph.neighbors(u);
    for (let i = nbrs.length - 1; i >= 0; i--) {
      const v = nbrs[i].to;
      stats.relaxations++;
      if (!visited[v]) {
        visited[v] = 1;
        parent[v] = u;
        depth[v] = depth[u] + 1;
        stack.push(v);
        stats.discovered++;
        stats.pushes++;
        yield { type: 'discover', node: v, dist: depth[v], parent: u };
      }
    }
  }

  const path = reconstructPath(parent, start, goal);
  const cost = path.length ? graph.pathCost(path) : Infinity;
  yield { type: 'found', path, cost };
  return {
    path: path.length ? path : null,
    cost,
    parent,
    stats: withPath(stats, path),
  };
}
