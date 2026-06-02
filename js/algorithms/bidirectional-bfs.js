// bidirectional-bfs.js — Breadth-First Search from both ends at once.
// Two BFS frontiers (from start over out-edges, from goal over in-edges) grow in
// lockstep and meet in the middle, giving the fewest-EDGES path while exploring
// far fewer nodes than one-directional BFS. Like plain BFS it ignores weights,
// so it's optimal only when every edge costs the same.

import { makeStats, withPath, stitchBidirectional } from './common.js';

export function* bidirectionalBfs(graph, start, goal, opts = {}) {
  const n = graph.n;
  const stats = makeStats();

  if (start === goal) {
    yield { type: 'found', path: [start], cost: 0 };
    return { path: [start], cost: 0, stats: withPath(stats, [start]) };
  }

  const distF = new Int32Array(n).fill(-1);
  const distB = new Int32Array(n).fill(-1);
  const parentF = new Int32Array(n).fill(-1);
  const parentB = new Int32Array(n).fill(-1);
  distF[start] = 0;
  distB[goal] = 0;
  let frontierF = [start];
  let frontierB = [goal];
  stats.discovered += 2;

  let meet = -1;

  // Expand whole BFS levels, always the smaller frontier, until they touch.
  while (frontierF.length && frontierB.length && meet < 0) {
    const fwd = frontierF.length <= frontierB.length;
    const frontier = fwd ? frontierF : frontierB;
    const dist = fwd ? distF : distB;
    const odist = fwd ? distB : distF;
    const parent = fwd ? parentF : parentB;
    const next = [];
    for (const u of frontier) {
      stats.settled++;
      yield { type: 'settle', node: u, dist: dist[u], dir: fwd ? 'f' : 'b' };
      const edges = fwd ? graph.neighbors(u) : graph.inNeighbors(u);
      for (const { to: v } of edges) {
        stats.relaxations++;
        if (dist[v] === -1) {
          dist[v] = dist[u] + 1;
          parent[v] = u;
          next.push(v);
          stats.discovered++;
          yield { type: 'discover', node: v, dist: dist[v], parent: u, dir: fwd ? 'f' : 'b' };
          if (odist[v] !== -1) { meet = v; yield { type: 'meet', node: v, dir: fwd ? 'f' : 'b' }; break; }
        }
      }
      if (meet >= 0) break;
    }
    if (fwd) frontierF = next; else frontierB = next;
    if (frontier.length > stats.maxFrontier) stats.maxFrontier = frontier.length;
  }

  if (meet < 0) {
    yield { type: 'found', path: null, cost: Infinity };
    return { path: null, cost: Infinity, stats: withPath(stats, []) };
  }
  const path = stitchBidirectional(parentF, parentB, start, goal, meet);
  const cost = path.length ? graph.pathCost(path) : Infinity;
  yield { type: 'found', path, cost };
  return { path: path.length ? path : null, cost, stats: withPath(stats, path) };
}
