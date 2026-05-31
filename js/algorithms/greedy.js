// greedy.js
// Greedy Best-First Search — A*'s reckless cousin. Where A* orders the frontier
// by f(n) = g(n) + h(n), greedy throws away the g term entirely and orders ONLY
// by h(n): the heuristic estimate of remaining distance to the goal. It always
// expands whatever node *looks* closest to the goal, with no memory of how much
// it has already paid to get there.
//
// The payoff is speed: greedy charges almost straight at the destination and
// often settles dramatically fewer nodes than Dijkstra or A*. The price is
// correctness — it is NOT optimal. Because it never weighs the cost-so-far, it
// will happily commit to a path that started off pointing the right way even if
// that path turns out to be long and winding. That is precisely the teaching
// point: a search that only chases the heuristic can be fast AND wrong.
//
// Mirrors astar.js in structure and event shapes; the single conceptual change
// is the priority pushed into the heap (h(v) instead of g(v) + h(v)) and the
// fact that, classically, greedy commits to the first parent that discovers a
// node and never revisits it (no decrease-key), since g doesn't drive ordering.

import { MinHeap } from '../core/priority-queue.js';
import { reconstructPath, makeStats, withPath } from './common.js';

export function* greedy(graph, start, goal, opts = {}) {
  const n = graph.n;
  // Heuristic: distance estimate from a node to the goal. Same default A* uses,
  // but here it is the WHOLE priority, not just a tie-breaking lean.
  const h = opts.heuristic || ((v) => graph.heuristic(v, goal));

  // g tracks the ACTUAL accumulated cost along the parent pointers we commit to.
  // It does not influence ordering at all — we keep it only so the `settle`
  // events can report a meaningful running distance and for debugging.
  const g = new Float64Array(n);
  g.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  // `visited` marks nodes already popped/settled (lazy-deletion guard). We also
  // treat "g is finite" as "already discovered" so greedy commits to the first
  // parent that reaches a node and never re-pushes it (no decrease-key).
  const visited = new Uint8Array(n);

  const stats = makeStats();
  const pq = new MinHeap();

  g[start] = 0;
  pq.push(start, h(start)); // priority = h alone
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (visited[u]) continue; // stale heap entry (lazy deletion)
    visited[u] = 1;
    stats.settled++;
    // dist reported is the real cost g[u] along the chosen parent chain, even
    // though the heap ordering ignored it.
    yield { type: 'settle', node: u, dist: g[u] };

    if (u === goal) break; // popped the goal — greedy stops, optimal or not

    for (const { to: v, w } of graph.neighbors(u)) {
      if (visited[v]) continue;
      stats.relaxations++;
      // Classic greedy: only act on a neighbor we have not discovered yet.
      // Once a node has a finite g it already sits in the frontier with its
      // h-priority; since g never affects ordering, there is nothing to improve.
      if (g[v] === Infinity) {
        g[v] = g[u] + w;       // record actual cost along this committed edge
        parent[v] = u;
        pq.push(v, h(v));      // priority = h(v) ONLY — ignore cost so far
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: v, dist: g[v], parent: u };
      }
    }
  }

  // Reconstruct the (possibly suboptimal) path greedy committed to, then report
  // its TRUE weight via graph.pathCost — g[goal] would also work here since we
  // accumulate along the same parent pointers, but pathCost is the source of
  // truth for "what does this path actually cost".
  const path = reconstructPath(parent, start, goal);
  const cost = path.length ? graph.pathCost(path) : Infinity;
  yield { type: 'found', path, cost: Number.isFinite(cost) ? cost : Infinity };

  return {
    path: path.length ? path : null,
    cost: Number.isFinite(cost) ? cost : Infinity,
    dist: g,
    parent,
    stats: withPath(stats, path),
  };
}
