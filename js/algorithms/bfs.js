// bfs.js
// Breadth-First Search — the unweighted baseline. It ignores edge weights and
// finds the path with the fewest hops, settling nodes in rings of equal hop
// count. Included so learners can see what "shortest" means when every edge
// costs 1, and why that diverges from Dijkstra on a weighted graph.

import { reconstructPath, makeStats, withPath } from './common.js';

export function* bfs(graph, start, goal, opts = {}) {
  const n = graph.n;
  const dist = new Float64Array(n); // hop count
  dist.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const visited = new Uint8Array(n);

  const stats = makeStats();
  const queue = [start];
  let head = 0;

  dist[start] = 0;
  visited[start] = 1;
  stats.discovered++;
  stats.maxFrontier = 1;

  while (head < queue.length) {
    const u = queue[head++];
    stats.settled++;
    if (queue.length - head + 1 > stats.maxFrontier) {
      stats.maxFrontier = queue.length - head + 1;
    }
    yield { type: 'settle', node: u, dist: dist[u] };

    if (u === goal) break;

    for (const { to: v } of graph.neighbors(u)) {
      stats.relaxations++;
      if (!visited[v]) {
        visited[v] = 1;
        dist[v] = dist[u] + 1;
        parent[v] = u;
        queue.push(v);
        stats.discovered++;
        yield { type: 'discover', node: v, dist: dist[v], parent: u };
      }
    }
  }

  const path = reconstructPath(parent, start, goal);
  // Report the true weighted cost of the (possibly suboptimal) path so the
  // comparison table is apples-to-apples with the weighted algorithms.
  const cost = path.length ? graph.pathCost(path) : Infinity;
  yield { type: 'found', path, cost };

  return {
    path: path.length ? path : null,
    cost,
    dist,
    parent,
    stats: withPath(stats, path),
  };
}
