// bidirectional-dijkstra.js — run two Dijkstra searches toward each other.
// One search grows OUTWARD from `start` over forward edges (graph.neighbors),
// the other grows BACKWARD from `goal` over reverse edges (graph.inNeighbors).
// When the two search fronts touch, we have a candidate path; the trick is
// knowing WHEN that candidate is provably optimal so we can stop early.
//
// Same Result/event shapes as dijkstra.js. The new wrinkle is the `dir`
// field on events ('f' = forward search, 'b' = backward search) so the
// visualizer can paint the two halves in different colors, plus the special
// 'meet' event fired whenever the best known meeting cost (mu) improves.
//
// Why it's faster than one Dijkstra: a single search explores a disk of
// radius D around the start. Two searches of radius D/2 each explore far
// less total area, so they meet in the middle having touched fewer nodes.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath, stitchBidirectional } from './common.js';

export function* bidirectionalDijkstra(graph, start, goal, opts = {}) {
  const n = graph.n;
  const stats = makeStats();

  // Trivial query: start IS the goal. Path is just [start], cost 0.
  if (start === goal) {
    const path = [start];
    yield { type: 'found', path, cost: 0 };
    return { path, cost: 0, dist: null, parent: null, stats: withPath(stats, path) };
  }

  // Forward search state (from start, over out-edges).
  const distF = new Float64Array(n); distF.fill(Infinity);
  const parentF = new Int32Array(n); parentF.fill(-1);
  const settledF = new Uint8Array(n);

  // Backward search state (from goal, over in-edges). parentB[x] points to the
  // node one step CLOSER to the goal, which is exactly what stitchBidirectional
  // walks when assembling the goal-ward half of the path.
  const distB = new Float64Array(n); distB.fill(Infinity);
  const parentB = new Int32Array(n); parentB.fill(-1);
  const settledB = new Uint8Array(n);

  const pqF = new MinHeap();
  const pqB = new MinHeap();

  distF[start] = 0;
  pqF.push(start, 0);
  distB[goal] = 0;
  pqB.push(goal, 0);
  stats.pushes += 2;
  stats.discovered += 2;

  // mu = cost of the best start->goal path found so far through any node that
  // both fronts have reached. meetNode is the node achieving it. We stop once
  // no unexplored path could possibly beat mu.
  let mu = Infinity;
  let meetNode = -1;

  // Helper: a node x reached by BOTH fronts gives a candidate path of cost
  // distF[x] + distB[x]. If that beats the best so far, record it and tell the
  // visualizer the frontiers have (better) met. We must run this on every
  // relaxation — not just on settle — because the optimal meeting point is not
  // always settled in both directions before the stopping rule trips.
  function* considerMeet(x) {
    if (distF[x] !== Infinity && distB[x] !== Infinity) {
      const cand = distF[x] + distB[x];
      if (cand < mu) {
        mu = cand;
        meetNode = x;
        yield { type: 'meet', node: x };
      }
    }
  }

  // Main loop: keep going until a heap empties OR the stopping rule proves mu
  // is optimal. The stopping rule: the smallest forward key plus the smallest
  // backward key is a lower bound on any path not yet completed. Once that
  // lower bound meets or exceeds mu, nothing better remains.
  while (!pqF.isEmpty() && !pqB.isEmpty()) {
    // Termination: minimum possible cost of any still-open path >= best found.
    if (pqF.peekPriority() + pqB.peekPriority() >= mu) break;

    stats.maxFrontier = Math.max(stats.maxFrontier, pqF.size + pqB.size);

    // Expand whichever side currently has the smaller frontier key. Balancing
    // the two fronts this way keeps them meeting near the middle.
    if (pqF.peekPriority() <= pqB.peekPriority()) {
      // ---- one forward step ----
      const u = pqF.pop();
      if (settledF[u]) continue;     // stale heap entry — skip
      settledF[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distF[u], dir: 'f' };

      // Note: we do NOT break when u is settled by the backward search. We keep
      // relaxing so every meeting candidate is discovered; the stopping rule
      // above is what guarantees we finish at the right time.
      const edges = graph.neighbors(u);
      for (let i = 0; i < edges.length; i++) {
        const { to: v, w } = edges[i];
        stats.relaxations++;
        const nd = distF[u] + w;
        if (nd < distF[v]) {
          distF[v] = nd;
          parentF[v] = u;
          pqF.push(v, nd);
          stats.pushes++;
          stats.discovered++;
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'f' };
          yield* considerMeet(v);
        }
      }
    } else {
      // ---- one backward step ----
      const u = pqB.pop();
      if (settledB[u]) continue;     // stale heap entry — skip
      settledB[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distB[u], dir: 'b' };

      // Backward search walks REVERSE edges: inNeighbors(u) are the nodes that
      // have an edge INTO u, i.e. predecessors on a path toward u (and onward
      // to the goal). parentB[v] = u records that step toward the goal.
      const edges = graph.inNeighbors(u);
      for (let i = 0; i < edges.length; i++) {
        const { to: v, w } = edges[i];
        stats.relaxations++;
        const nd = distB[u] + w;
        if (nd < distB[v]) {
          distB[v] = nd;
          parentB[v] = u;
          pqB.push(v, nd);
          stats.pushes++;
          stats.discovered++;
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'b' };
          yield* considerMeet(v);
        }
      }
    }
  }

  // Stitch the two halves at the best meeting node. If the fronts never met,
  // meetNode is -1, stitchBidirectional returns null, and the goal is
  // unreachable.
  const path = stitchBidirectional(parentF, parentB, start, goal, meetNode);
  const cost = path ? mu : Infinity;
  yield { type: 'found', path, cost };
  return {
    path,
    cost,
    dist: distF,      // forward distances, mirroring dijkstra's `dist`
    parent: parentF,
    stats: withPath(stats, path),
  };
}
