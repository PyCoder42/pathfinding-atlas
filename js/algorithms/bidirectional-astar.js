// bidirectional-astar.js
// Bidirectional A* done correctly, via consistent SYMMETRIC potentials.
//
// Two traps make naive bidirectional A* return slightly-too-long paths:
//   1. If each side uses its own independent heuristic, the searches measure
//      progress on different scales and don't meet in the middle.
//   2. Even with a shared potential, the popular "stop when topF + topB >= mu"
//      rule is only valid if the two searches stay BALANCED — if one starves,
//      the other overshoots and that rule fires too early on a suboptimal path.
//
// We fix both:
//   - Couple the searches with one consistent potential:
//        pf(v) = (h_goal(v) - h_start(v)) / 2     (forward)
//        pb(v) = -pf(v)                           (backward)
//     With h_goal, h_start consistent, the REDUCED edge costs are non-negative,
//     so each side is an ordinary Dijkstra on the reduced graph (true distances
//     are tracked separately; only the queue keys carry the potential).
//   - Use the balance-INDEPENDENT stopping rule: stop once NEITHER side can
//     still reach a node that could improve mu, i.e. each side's minimum key has
//     passed its own threshold (topF >= mu - D and topB >= mu - C, where
//     C = pf(start), D = -pf(goal)). A side is only expanded while still
//     "productive", which also prevents one side from starving the other.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath, stitchBidirectional } from './common.js';

export function* bidirectionalAstar(graph, start, goal, opts = {}) {
  const n = graph.n;
  const stats = makeStats();

  if (start === goal) {
    yield { type: 'found', path: [start], cost: 0 };
    return { path: [start], cost: 0, stats: withPath(stats, [start]) };
  }

  const hGoal = (v) => graph.heuristic(v, goal);
  const hStart = (v) => graph.heuristic(v, start);
  const pf = (v) => (hGoal(v) - hStart(v)) / 2; // forward potential; backward = -pf
  const C = pf(start); // forward key offset
  const D = -pf(goal); // backward key offset

  const distF = new Float64Array(n);
  distF.fill(Infinity);
  const distB = new Float64Array(n);
  distB.fill(Infinity);
  const parentF = new Int32Array(n);
  parentF.fill(-1);
  const parentB = new Int32Array(n);
  parentB.fill(-1);
  const setF = new Uint8Array(n);
  const setB = new Uint8Array(n);
  const pqF = new MinHeap();
  const pqB = new MinHeap();

  distF[start] = 0;
  pqF.push(start, pf(start));
  distB[goal] = 0;
  pqB.push(goal, -pf(goal));
  stats.discovered += 2;
  stats.pushes += 2;
  stats.maxFrontier = 2;

  let mu = Infinity;
  let meet = -1;

  function* expand(dir) {
    const fwd = dir === 'f';
    const pq = fwd ? pqF : pqB;
    const dist = fwd ? distF : distB;
    const other = fwd ? distB : distF;
    const parent = fwd ? parentF : parentB;
    const settled = fwd ? setF : setB;
    const u = pq.pop();
    if (settled[u]) return;
    settled[u] = 1;
    stats.settled++;
    yield { type: 'settle', node: u, dist: dist[u], dir };
    if (Number.isFinite(other[u]) && dist[u] + other[u] < mu) {
      mu = dist[u] + other[u];
      meet = u;
      yield { type: 'meet', node: u, dir };
    }
    const edges = fwd ? graph.neighbors(u) : graph.inNeighbors(u);
    for (const { to: v, w } of edges) {
      if (settled[v]) continue;
      stats.relaxations++;
      const nd = dist[u] + w; // true tentative distance
      if (nd < dist[v]) {
        dist[v] = nd;
        parent[v] = u;
        pq.push(v, nd + (fwd ? pf(v) : -pf(v))); // reduced-cost key
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: v, dist: nd, parent: u, dir };
        if (Number.isFinite(other[v]) && nd + other[v] < mu) {
          mu = nd + other[v];
          meet = v;
          yield { type: 'meet', node: v, dir };
        }
      }
    }
  }

  while (true) {
    const topF = pqF.isEmpty() ? Infinity : pqF.peekPriority();
    const topB = pqB.isEmpty() ? Infinity : pqB.peekPriority();
    const fProductive = topF < mu - D;
    const bProductive = topB < mu - C;
    if (!fProductive && !bProductive) break;
    const dir = fProductive && bProductive ? (topF <= topB ? 'f' : 'b') : fProductive ? 'f' : 'b';
    yield* expand(dir);
  }

  if (meet < 0 || !Number.isFinite(mu)) {
    yield { type: 'found', path: null, cost: Infinity };
    return { path: null, cost: Infinity, stats: withPath(stats, []) };
  }

  const path = stitchBidirectional(parentF, parentB, start, goal, meet);
  yield { type: 'found', path, cost: mu };
  return { path, cost: mu, stats: withPath(stats, path) };
}
