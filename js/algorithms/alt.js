// alt.js
// ALT = A* + Landmarks + Triangle inequality.
//
// The weakness of plain A* on a road network is that the straight-line
// heuristic is loose: a mountain or a river means the true driving distance is
// much larger than "as the crow flies", so A* still explores a lot. ALT fixes
// this by precomputing the exact distance from a handful of well-chosen
// "landmark" nodes to everywhere. The triangle inequality then turns those
// precomputed distances into a much SHARPER admissible lower bound on the
// remaining cost — so A* explores far fewer nodes, while staying optimal.
//
// preprocessALT(graph)  -> { landmarks, distFrom, distTo }   (one Dijkstra/landmark)
// alt(graph, s, t, {alt}) -> A* using the landmark heuristic

import { MinHeap } from '../core/priority-queue.js';
import { reconstructPath, makeStats, withPath } from './common.js';

// Full single-source distance array (no early stop). `reverse` walks incoming
// edges so we also get "distance TO the landmark" on directed graphs.
function singleSource(graph, src, reverse) {
  const n = graph.n;
  const dist = new Float64Array(n);
  dist.fill(Infinity);
  const settled = new Uint8Array(n);
  const pq = new MinHeap();
  dist[src] = 0;
  pq.push(src, 0);
  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (settled[u]) continue;
    settled[u] = 1;
    const nbrs = reverse ? graph.inNeighbors(u) : graph.neighbors(u);
    for (const { to: v, w } of nbrs) {
      const nd = dist[u] + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        pq.push(v, nd);
      }
    }
  }
  return dist;
}

export function* preprocessALT(graph, opts = {}) {
  const n = graph.n;
  const L = opts.landmarks || Math.min(16, Math.max(4, Math.round(Math.sqrt(n / 2))));
  const landmarks = [];
  const distFrom = [];
  const distTo = [];

  // farthest-point ("avoid"-lite) selection: each new landmark is the node
  // currently farthest from all chosen landmarks.
  const minToChosen = new Float64Array(n);
  minToChosen.fill(Infinity);

  // seed: farthest finite node from node 0
  const seed = singleSource(graph, 0, false);
  let first = 0;
  let bestD = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(seed[i]) && seed[i] > bestD) {
      bestD = seed[i];
      first = i;
    }
  }

  for (let k = 0; k < L; k++) {
    let lm;
    if (k === 0) {
      lm = first;
    } else {
      let best = -1;
      let bd = -1;
      for (let i = 0; i < n; i++) {
        const d = minToChosen[i];
        if (Number.isFinite(d) && d > bd) {
          bd = d;
          best = i;
        }
      }
      if (best === -1) break;
      lm = best;
    }
    landmarks.push(lm);
    const dF = singleSource(graph, lm, false);
    const dT = singleSource(graph, lm, true);
    distFrom.push(dF);
    distTo.push(dT);
    for (let i = 0; i < n; i++) if (dF[i] < minToChosen[i]) minToChosen[i] = dF[i];
    yield { type: 'info', message: `Computing landmark ${k + 1}/${L}` };
  }

  return { landmarks, distFrom, distTo };
}

export function* alt(graph, start, goal, opts = {}) {
  const n = graph.n;
  const aux = opts.alt;

  // Landmark heuristic h(v) = lower bound on dist(v, goal).
  // For each landmark L:  dist(v,goal) >= distFrom[L][goal] - distFrom[L][v]
  //                       dist(v,goal) >= distTo[L][v]      - distTo[L][goal]
  let h;
  if (aux && aux.landmarks && aux.landmarks.length) {
    const { landmarks, distFrom, distTo } = aux;
    const tArr = [];
    for (let k = 0; k < landmarks.length; k++) {
      tArr.push({ dFt: distFrom[k][goal], dTt: distTo[k][goal], dF: distFrom[k], dT: distTo[k] });
    }
    h = (v) => {
      let best = 0;
      for (let k = 0; k < tArr.length; k++) {
        const e = tArr[k];
        const a = e.dFt - e.dF[v];
        if (a > best && Number.isFinite(a)) best = a;
        const b = e.dT[v] - e.dTt;
        if (b > best && Number.isFinite(b)) best = b;
      }
      return best;
    };
  } else {
    h = (v) => graph.heuristic(v, goal); // fallback if preprocessing missing
  }

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
        pq.push(v, ng + h(v));
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
