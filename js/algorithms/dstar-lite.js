// dstar-lite.js
// D* Lite (one-shot form). D* Lite is the incremental replanning algorithm used
// by robots: it searches BACKWARD from the goal and maintains two values per
// node — g (current best estimate of cost-to-goal) and rhs (a one-step-lookahead
// value). A node is "locally consistent" when g === rhs; the algorithm works to
// make every relevant node consistent. When the map later changes, only the
// affected nodes need re-processing — that is D* Lite's superpower.
//
// For a single STATIC query (what we run here) it produces the OPTIMAL path,
// identical in cost to Dijkstra/A*. We expose it so the comparison includes a
// goal-rooted, replanning-style search.
//
// Priority key: we order the queue by k1 = min(g, rhs) + h(node, start). The
// full D* Lite key is a 2-tuple (k1, k2); for the final g-values the k2
// tie-break only affects efficiency, not correctness, so we use k1 with lazy
// stale-entry skipping.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath } from './common.js';

export function* dstarLite(graph, start, goal, opts = {}) {
  const n = graph.n;
  const stats = makeStats();

  if (start === goal) {
    yield { type: 'found', path: [start], cost: 0 };
    return { path: [start], cost: 0, stats: withPath(stats, [start]) };
  }

  const g = new Float64Array(n);
  g.fill(Infinity);
  const rhs = new Float64Array(n);
  rhs.fill(Infinity);
  const h = (s) => graph.heuristic(s, start); // search runs goal -> start
  const keyOf = (s) => Math.min(g[s], rhs[s]) + h(s);

  rhs[goal] = 0;
  const U = new MinHeap();
  U.push(goal, keyOf(goal));
  stats.discovered++;
  stats.pushes++;

  // Recompute rhs(u) from successors and (re)queue u if it's inconsistent.
  function* updateVertex(u) {
    if (u !== goal) {
      let best = Infinity;
      for (const { to: v, w } of graph.neighbors(u)) {
        const c = w + g[v];
        if (c < best) best = c;
      }
      stats.relaxations++;
      if (best !== rhs[u]) {
        rhs[u] = best;
        yield { type: 'discover', node: u, dist: Math.min(g[u], rhs[u]) };
      }
    }
    if (g[u] !== rhs[u]) {
      U.push(u, keyOf(u));
      stats.pushes++;
      if (U.size > stats.maxFrontier) stats.maxFrontier = U.size;
    }
  }

  // computeShortestPath
  let guard = 0;
  const limit = 40 * n + 100;
  while (!U.isEmpty()) {
    if (!(U.peekPriority() < keyOf(start) || rhs[start] !== g[start])) break;
    if (++guard > limit) break; // safety

    const u = U.pop();
    if (g[u] === rhs[u]) continue; // stale entry — node already locally consistent

    stats.settled++;
    yield { type: 'settle', node: u, dist: Math.min(g[u], rhs[u]) };

    if (g[u] > rhs[u]) {
      // over-consistent: lower g to rhs, then fix predecessors
      g[u] = rhs[u];
      for (const { to: p } of graph.inNeighbors(u)) yield* updateVertex(p);
    } else {
      // under-consistent: raise g, then fix this node and predecessors
      g[u] = Infinity;
      yield* updateVertex(u);
      for (const { to: p } of graph.inNeighbors(u)) yield* updateVertex(p);
    }
  }

  // Extract the path by greedily stepping to the successor that minimizes
  // edge-cost + g (i.e. walking "downhill" in cost-to-goal).
  const cost = g[start];
  let path = null;
  if (Number.isFinite(cost)) {
    path = [start];
    let cur = start;
    let steps = 0;
    while (cur !== goal && steps++ <= n) {
      let best = Infinity;
      let nxt = -1;
      for (const { to: v, w } of graph.neighbors(cur)) {
        const c = w + g[v];
        if (c < best) {
          best = c;
          nxt = v;
        }
      }
      if (nxt < 0 || !Number.isFinite(best)) {
        path = null;
        break;
      }
      cur = nxt;
      path.push(cur);
    }
    if (path && path[path.length - 1] !== goal) path = null;
  }

  yield { type: 'found', path, cost: path ? cost : Infinity };
  return { path, cost: path ? cost : Infinity, stats: withPath(stats, path || []) };
}
