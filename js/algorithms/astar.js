// astar.js
// A* search — Dijkstra plus a heuristic. It orders the frontier by
// f(n) = g(n) + h(n), where g is the cost from the start and h is an admissible
// (never-overestimating) estimate of the cost to the goal. With a good
// heuristic the search "leans" toward the goal and settles far fewer nodes than
// Dijkstra while still returning the optimal path. With h ≡ 0 it IS Dijkstra.
//
// This is the algorithm Veritasium spends the most time on: the heuristic is
// the straight-line distance, which is why A* fans out as an ellipse pointed at
// the destination instead of Dijkstra's even circle.

import { MinHeap } from '../core/priority-queue.js';
import { reconstructPath, makeStats, withPath } from './common.js';

export function* astar(graph, start, goal, opts = {}) {
  const n = graph.n;
  const h = opts.heuristic || ((v) => graph.heuristic(v, goal));

  const g = new Float64Array(n);
  g.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const settled = new Uint8Array(n);

  const stats = makeStats();
  const pq = new MinHeap();

  g[start] = 0;
  pq.push(start, h(start));
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (settled[u]) continue;
    settled[u] = 1;
    stats.settled++;
    yield { type: 'settle', node: u, dist: g[u] };

    if (u === goal) break;

    for (const { to: v, w } of graph.neighbors(u)) {
      if (settled[v]) continue;
      stats.relaxations++;
      const ng = g[u] + w;
      if (ng < g[v]) {
        g[v] = ng;
        parent[v] = u;
        pq.push(v, ng + h(v)); // priority = f = g + h
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: v, dist: ng, parent: u };
      }
    }
  }

  const path = reconstructPath(parent, start, goal);
  const cost = g[goal];
  yield { type: 'found', path, cost: Number.isFinite(cost) ? cost : Infinity };

  return {
    path: path.length ? path : null,
    cost: Number.isFinite(cost) ? cost : Infinity,
    dist: g,
    parent,
    stats: withPath(stats, path),
  };
}
