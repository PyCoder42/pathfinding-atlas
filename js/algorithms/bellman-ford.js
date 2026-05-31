// bellman-ford.js
// Bellman–Ford — the shortest-path algorithm that, unlike Dijkstra and A*,
// tolerates NEGATIVE edge weights and can DETECT negative cycles. Dijkstra's
// greedy "settle the closest node and never revisit it" trick is only valid when
// edges are non-negative; a negative edge encountered later could improve a node
// we already finalized. Bellman–Ford gives up the greedy ordering and instead
// keeps relaxing edges until distances stop improving (or until it has relaxed
// so many times that the only explanation is a negative cycle).
//
// The textbook version relaxes EVERY edge n-1 times — simple but slow, and it
// produces a boring animation (the whole graph flickers each pass). We use the
// queue-based variant known as SPFA (Shortest Path Faster Algorithm): instead of
// blindly re-relaxing all edges, we keep a work queue of nodes whose distance
// just improved, because only their outgoing edges can possibly relax anything
// new. This is essentially "Dijkstra without the priority ordering": a node can
// be enqueued, settled, and later re-enqueued if a cheaper route to it appears.
//
// On non-negative graphs this returns exactly Dijkstra's optimal cost (it just
// may do more work). On graphs with a reachable negative cycle there is no
// shortest path — distances decrease without bound — so we cap the number of
// times any single node may be relaxed at n; exceeding that is a certificate of
// a negative cycle, which we report via an 'info' event and a negativeCycle flag.

import { reconstructPath, makeStats, withPath } from './common.js';

export function* bellmanFord(graph, start, goal, opts = {}) {
  const n = graph.n;

  // dist[v] = best known cost from start to v so far (Infinity = undiscovered).
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  // parent[v] = predecessor of v on the best known path (-1 = none yet).
  const parent = new Int32Array(n);
  parent.fill(-1);
  // inQueue[v] = 1 if v is currently sitting in the work queue. We use this to
  // avoid enqueuing the same node twice; if a node is already queued, improving
  // its distance again does not require another queue entry — it will be popped
  // with whatever the latest (smaller) dist[v] is.
  const inQueue = new Uint8Array(n);
  // relaxCount[v] = how many times v has been POPPED and had its edges relaxed.
  // In a graph with no negative cycle, a node's shortest path uses at most n-1
  // edges, so it can be improved at most n-1 times. If we pop (relax out of) any
  // node more than n times, a reachable negative cycle is the only explanation.
  const relaxCount = new Int32Array(n);

  const stats = makeStats();

  // A plain FIFO array used as the work queue. We track a head index instead of
  // calling Array.prototype.shift() (which is O(n)) so large graphs stay fast.
  const queue = [];
  let head = 0;

  let negativeCycle = false;

  // ── Seed the search at the start node ────────────────────────────────────
  dist[start] = 0;
  queue.push(start);
  inQueue[start] = 1;
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  // ── Main loop: drain the queue, relaxing each popped node's edges ─────────
  // The queue holds nodes whose distance improved since we last looked at them.
  while (head < queue.length) {
    const u = queue[head++];
    inQueue[u] = 0;

    // Popping u and processing its edges is one "settle" in this project's
    // bookkeeping (analogous to Dijkstra popping a node off the heap). Note a
    // node can be settled more than once here — that is the whole point of
    // Bellman–Ford and is fine for an unsettled-distance algorithm.
    stats.settled++;
    yield { type: 'settle', node: u, dist: dist[u] };

    // Negative-cycle guard: count how many times u has been relaxed out of. If
    // any node is processed more than n times, distances are decreasing without
    // bound, so a negative cycle reachable from start exists. Report it once and
    // stop — there is no well-defined shortest path, so we return best effort.
    relaxCount[u]++;
    if (relaxCount[u] > n) {
      negativeCycle = true;
      yield { type: 'info', message: 'Negative cycle detected' };
      break;
    }

    for (const { to: v, w } of graph.neighbors(u)) {
      stats.relaxations++;            // every edge examined counts as a relaxation
      const nd = dist[u] + w;
      if (nd < dist[v]) {
        // Found a cheaper way to reach v: record it.
        dist[v] = nd;
        parent[v] = u;
        stats.discovered++;
        // Only enqueue v if it is not already waiting to be processed. If it is
        // already queued, its newer (smaller) dist will be used when popped.
        if (!inQueue[v]) {
          queue.push(v);
          inQueue[v] = 1;
          stats.pushes++;
          // Peak frontier = the most nodes simultaneously waiting in the queue.
          const open = queue.length - head;
          if (open > stats.maxFrontier) stats.maxFrontier = open;
        }
        yield { type: 'discover', node: v, dist: nd, parent: u };
      }
    }
  }

  // ── Build the answer ──────────────────────────────────────────────────────
  // reconstructPath returns [start] when start === goal and [] when goal is
  // unreachable, matching the rest of the algorithms. With a negative cycle we
  // still report the best path/cost we managed to compute (best effort), since
  // distances may not be the true optimum in that case.
  const path = reconstructPath(parent, start, goal);
  const cost = dist[goal];
  const finiteCost = Number.isFinite(cost) ? cost : Infinity;
  yield { type: 'found', path, cost: finiteCost };

  const result = {
    path: path.length ? path : null,
    cost: finiteCost,
    dist,
    parent,
    stats: withPath(stats, path),
  };
  // Surface the negative-cycle finding so callers (and the UI) can flag that the
  // returned cost is not a guaranteed shortest path.
  if (negativeCycle) result.negativeCycle = true;
  return result;
}
