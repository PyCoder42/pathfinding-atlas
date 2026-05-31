// dijkstra.js
// Dijkstra's algorithm — the reference implementation every other algorithm in
// this project mirrors. Explores outward from the start in order of increasing
// distance, settling the closest unsettled node each step. Guarantees the
// shortest path on non-negative weights. This is the "no heuristic" baseline:
// it has no idea where the goal is, so it grows an even disk in every direction.

import { MinHeap } from '../core/priority-queue.js';
import { reconstructPath, makeStats, withPath } from './common.js';

export function* dijkstra(graph, start, goal, opts = {}) {
  const n = graph.n;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const settled = new Uint8Array(n);

  const stats = makeStats();
  const pq = new MinHeap();

  dist[start] = 0;
  pq.push(start, 0);
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (settled[u]) continue; // stale heap entry (lazy deletion)
    settled[u] = 1;
    stats.settled++;
    yield { type: 'settle', node: u, dist: dist[u] };

    if (u === goal) break;

    for (const { to: v, w } of graph.neighbors(u)) {
      if (settled[v]) continue;
      stats.relaxations++;
      const nd = dist[u] + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        parent[v] = u;
        pq.push(v, nd);
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: v, dist: nd, parent: u };
      }
    }
  }

  const path = reconstructPath(parent, start, goal);
  const cost = dist[goal];
  yield { type: 'found', path, cost: Number.isFinite(cost) ? cost : Infinity };

  return {
    path: path.length ? path : null,
    cost: Number.isFinite(cost) ? cost : Infinity,
    dist,
    parent,
    stats: withPath(stats, path),
  };
}
