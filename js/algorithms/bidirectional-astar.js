// bidirectional-astar.js
// Bidirectional A* with CONSISTENT SYMMETRIC POTENTIALS.
//
// Bidirectional Dijkstra runs two searches at once — one growing forward from
// the start, one growing backward from the goal — and stops when the two
// frontiers provably overlap on the shortest path. Adding a heuristic to make
// it "A*" is famously tricky: if the forward search uses h-to-goal and the
// backward search uses h-to-start naively, the two reduced-cost spaces are
// INCONSISTENT and the algorithm can return a wrong (non-optimal) cost.
//
// The standard fix (Ikeda et al. / Goldberg) is to use a single pair of
// *symmetric* potentials that are CONSISTENT for BOTH directions:
//
//     hs(v) = h(v, start)      // estimated distance from v back to the start
//     ht(v) = h(v, goal)       // estimated distance from v to the goal
//
//     pf(v) = (ht(v) - hs(v)) / 2     // forward potential
//     pb(v) = (hs(v) - ht(v)) / 2 = -pf(v)
//
// Both pf and pb are consistent (the reduced edge weights stay non-negative),
// so each side is effectively running a correct A*. Because pb = -pf, an edge
// that looks "downhill" forward looks "uphill" backward by the same amount —
// the two searches share one coherent landscape, which is what makes the
// meeting test valid.
//
// CRUCIAL: distF / distB store the TRUE g-costs (relaxed with the real edge
// weight w). The potentials only shape the priority QUEUE keys, never the
// stored distances. That means the best meeting value `mu` is already a true
// cost and needs no un-shifting at the end.
//
// TERMINATION: with these potentials the search may stop as soon as
//     pqF.peekPriority() + pqB.peekPriority() >= mu + pf(goal)
// (pf(goal) is a constant offset of the forward key space — see the proof note
// inline below). We also stop if either heap empties (no more meeting points
// reachable). The best path found so far is then provably optimal.
//
// With h ≡ 0 this degenerates into plain bidirectional Dijkstra, so it is a
// strict, optimal generalization of the unidirectional A* in astar.js.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath, stitchBidirectional, reconstructPath } from './common.js';

export function* bidirectionalAstar(graph, start, goal, opts = {}) {
  const n = graph.n;

  const stats = makeStats();

  // ── Trivial cases ────────────────────────────────────────────────────────
  // start === goal: the path is just [start] at cost 0. Yield a found event so
  // the UI stays in sync, then return immediately.
  if (start === goal) {
    const path = [start];
    yield { type: 'found', path, cost: 0 };
    return { path, cost: 0, stats: withPath(stats, path) };
  }

  // ── Heuristic setup ──────────────────────────────────────────────────────
  // h-to-goal: prefer opts.heuristic if supplied (it is defined as an estimate
  // to the GOAL, exactly like astar.js). h-to-start always comes from the graph
  // geometry — there is no opts hook for it, and using the graph keeps the
  // potentials symmetric and consistent.
  const htFn = opts.heuristic || ((v) => graph.heuristic(v, goal));
  const hsFn = (v) => graph.heuristic(v, start);

  // Symmetric potentials. pf(v) = (ht - hs)/2, pb(v) = -pf(v).
  const pf = (v) => (htFn(v) - hsFn(v)) / 2;
  const pb = (v) => -pf(v);

  // Constant forward-key offset used in the termination test. Computed once.
  const pfGoal = pf(goal);

  // ── State: two independent searches sharing the meeting bookkeeping ──────
  // True g-costs from the start (forward) and from the goal (backward).
  const distF = new Float64Array(n);
  distF.fill(Infinity);
  const distB = new Float64Array(n);
  distB.fill(Infinity);

  // Parent pointers. parentF[v] walks toward the start; parentB[v] walks toward
  // the goal — exactly the convention stitchBidirectional expects.
  const parentF = new Int32Array(n);
  parentF.fill(-1);
  const parentB = new Int32Array(n);
  parentB.fill(-1);

  // "Settled" = popped and finalized on that side. A node may be settled on one
  // side and still open on the other.
  const settledF = new Uint8Array(n);
  const settledB = new Uint8Array(n);

  const pqF = new MinHeap();
  const pqB = new MinHeap();

  // Best meeting cost found so far (a TRUE cost) and the node that achieves it.
  let mu = Infinity;
  let meetNode = -1;

  // ── Seed both frontiers ──────────────────────────────────────────────────
  distF[start] = 0;
  pqF.push(start, distF[start] + pf(start)); // forward key = g + pf
  distB[goal] = 0;
  pqB.push(goal, distB[goal] + pb(goal)); // backward key = g + pb

  // Two pushes, two discoveries; opening frontier size is 2.
  stats.pushes += 2;
  stats.discovered += 2;
  stats.maxFrontier = 2;

  const trackFrontier = () => {
    const total = pqF.size + pqB.size;
    if (total > stats.maxFrontier) stats.maxFrontier = total;
  };

  // Try to improve the best meeting value using node `v`, which has just been
  // given a finite distance on one side. If it is also reachable from the other
  // side, distF[v] + distB[v] is a candidate complete path cost.
  function relaxMeet(v) {
    if (distF[v] !== Infinity && distB[v] !== Infinity) {
      const cand = distF[v] + distB[v];
      if (cand < mu) {
        mu = cand;
        meetNode = v;
        return true; // mu improved → caller yields a 'meet' event
      }
    }
    return false;
  }

  // ── Main loop: alternate forward / backward expansions ───────────────────
  // We expand whichever frontier currently has the smaller top key; this is the
  // standard balanced strategy and keeps both searches roughly in step.
  while (!pqF.isEmpty() && !pqB.isEmpty()) {
    // TERMINATION TEST.
    // topF = best remaining forward key  = min over open v of (distF[v] + pf(v))
    // topB = best remaining backward key = min over open v of (distB[v] + pb(v))
    //
    // For any node x that could still close a path, its true completion cost
    // distF[x] + distB[x] is bounded below by (forward key of x) + (backward
    // key of x) minus the shared offset, and that combined key is at least
    // topF + topB. Working through the algebra with pb = -pf shows
    //     distF[x] + distB[x] >= topF + topB - pf(goal)
    // so once topF + topB >= mu + pf(goal), no unexplored meeting point can beat
    // the best `mu` we already have. The current `mu` is therefore optimal.
    const topF = pqF.peekPriority();
    const topB = pqB.peekPriority();
    if (topF + topB >= mu + pfGoal) break;

    // Expand the cheaper side.
    if (topF <= topB) {
      // ── Forward step ──────────────────────────────────────────────────────
      const u = pqF.pop();
      if (settledF[u]) continue; // stale heap entry (lazy deletion)
      settledF[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distF[u], dir: 'f' };

      for (const { to: v, w } of graph.neighbors(u)) {
        if (settledF[v]) continue;
        stats.relaxations++;
        const nd = distF[u] + w; // TRUE cost (no potential here)
        if (nd < distF[v]) {
          distF[v] = nd;
          parentF[v] = u;
          pqF.push(v, nd + pf(v)); // queue key uses the forward potential
          stats.pushes++;
          stats.discovered++;
          trackFrontier();
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'f' };
          if (relaxMeet(v)) yield { type: 'meet', node: v, dir: 'f' };
        }
      }
    } else {
      // ── Backward step ─────────────────────────────────────────────────────
      // Walk INCOMING edges (inNeighbors) so the reverse search respects edge
      // direction on directed graphs; on undirected graphs this is identical to
      // neighbors().
      const u = pqB.pop();
      if (settledB[u]) continue;
      settledB[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distB[u], dir: 'b' };

      for (const { to: v, w } of graph.inNeighbors(u)) {
        if (settledB[v]) continue;
        stats.relaxations++;
        const nd = distB[u] + w; // TRUE cost
        if (nd < distB[v]) {
          distB[v] = nd;
          parentB[v] = u;
          pqB.push(v, nd + pb(v)); // queue key uses the backward potential
          stats.pushes++;
          stats.discovered++;
          trackFrontier();
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'b' };
          if (relaxMeet(v)) yield { type: 'meet', node: v, dir: 'b' };
        }
      }
    }
  }

  // ── Reconstruct ──────────────────────────────────────────────────────────
  // mu already holds the TRUE optimal cost; meetNode is where the two halves
  // join. stitchBidirectional glues start..meet (via parentF) to meet..goal
  // (via parentB).
  let path = null;
  let cost = Infinity;
  if (meetNode !== -1 && Number.isFinite(mu)) {
    const stitched = stitchBidirectional(parentF, parentB, start, goal, meetNode);
    if (stitched.length) {
      path = stitched;
      cost = mu;
    }
  }

  yield { type: 'found', path, cost: Number.isFinite(cost) ? cost : Infinity };

  return {
    path,
    cost: Number.isFinite(cost) ? cost : Infinity,
    distF,
    distB,
    parentF,
    parentB,
    // Provide forward-style aliases for callers that expect dist/parent.
    dist: distF,
    parent: parentF,
    stats: withPath(stats, path || []),
  };
}
