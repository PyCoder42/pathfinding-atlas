// contraction-hierarchies.js
// Contraction Hierarchies (CH) — the technique that makes continental routing
// feel instant. It trades a one-time PREPROCESSING phase for tiny QUERIES.
//
// Idea: rank every node by "importance", then contract nodes from least to most
// important. Contracting a node means removing it but adding "shortcut" edges
// between its neighbors wherever the node lay on a shortest path between them
// (verified with a local "witness search"). The result is the original graph
// plus a set of shortcuts. A query is then a bidirectional search that only
// ever moves to HIGHER-ranked nodes ("upward"). Because the two upward searches
// meet near the top of the hierarchy, each touches only a handful of nodes.
//
// preprocessCH(graph) -> { rank, forwardUp, backwardUp, mid }
// contractionHierarchies(graph, s, t, {ch}) -> bidirectional upward query
// chBidirectionalQuery(...) is exported and reused by Customizable CH.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath, stitchBidirectional } from './common.js';
import { dijkstra } from './dijkstra.js';

const WITNESS_MAX_SETTLE = 60; // bound on local witness searches (safe if truncated)

// Local witness search: is there a path u -> w that AVOIDS v with length
// <= bound? If yes, contracting v needs no shortcut u->w. Bounded for speed;
// a truncated search conservatively returns false (we then add a harmless
// extra shortcut — never wrong, only slightly slower queries).
function hasWitness(u, w, v, bound, outE, contracted) {
  const dist = new Map();
  const settled = new Set();
  const pq = new MinHeap();
  dist.set(u, 0);
  pq.push(u, 0);
  let count = 0;
  while (!pq.isEmpty()) {
    const x = pq.pop();
    if (settled.has(x)) continue;
    settled.add(x);
    const dx = dist.get(x);
    if (x === w) return dx <= bound + 1e-9;
    if (dx > bound + 1e-9) return false;
    if (++count > WITNESS_MAX_SETTLE) return false;
    const edges = outE[x];
    if (!edges) continue;
    for (const [y, wt] of edges) {
      if (y === v || contracted[y]) continue;
      const nd = dx + wt;
      if (nd <= bound + 1e-9 && (!dist.has(y) || nd < dist.get(y))) {
        dist.set(y, nd);
        pq.push(y, nd);
      }
    }
  }
  return false;
}

// Count (or apply) the shortcuts needed to contract v. Returns shortcut count.
function contract(v, outE, inE, contracted, mid, apply) {
  let shortcuts = 0;
  const ins = [];
  for (const [u, w] of inE[v]) if (!contracted[u] && u !== v) ins.push([u, w]);
  const outs = [];
  for (const [x, w] of outE[v]) if (!contracted[x] && x !== v) outs.push([x, w]);
  if (!ins.length || !outs.length) return 0;

  // largest outgoing weight bounds each witness search
  let maxOut = 0;
  for (const [, w] of outs) if (w > maxOut) maxOut = w;

  for (const [u, wuv] of ins) {
    const bound = wuv + maxOut;
    // run a single witness search budget per source u (re-run per pair is also
    // fine; we keep it simple and correct by searching per pair)
    for (const [x, wvx] of outs) {
      if (u === x) continue;
      const cand = wuv + wvx;
      if (!hasWitness(u, x, v, cand, outE, contracted)) {
        shortcuts++;
        if (apply) {
          const cur = outE[u].get(x);
          if (cur === undefined || cand < cur) {
            outE[u].set(x, cand);
            inE[x].set(u, cand);
            mid.set(u + ',' + x, v);
          }
        }
      }
    }
  }
  return shortcuts;
}

function importance(v, outE, inE, contracted, deletedNeighbors) {
  const sc = contract(v, outE, inE, contracted, null, false);
  let deg = 0;
  for (const [u] of inE[v]) if (!contracted[u]) deg++;
  for (const [x] of outE[v]) if (!contracted[x]) deg++;
  // edge difference + spreading term
  return sc - deg + 2 * deletedNeighbors[v];
}

export function* preprocessCH(graph, opts = {}) {
  const n = graph.n;
  // mutable working adjacency (Maps allow dedup + relaxation of shortcuts)
  const outE = new Array(n);
  const inE = new Array(n);
  for (let i = 0; i < n; i++) {
    outE[i] = new Map();
    inE[i] = new Map();
  }
  for (let u = 0; u < n; u++) {
    for (const { to: v, w } of graph.neighbors(u)) {
      const cur = outE[u].get(v);
      if (cur === undefined || w < cur) {
        outE[u].set(v, w);
        inE[v].set(u, w);
      }
    }
  }

  const contracted = new Uint8Array(n);
  const rank = new Int32Array(n);
  rank.fill(-1);
  const deletedNeighbors = new Int32Array(n);
  const mid = new Map();

  yield { type: 'info', message: 'Computing node importance…' };
  const pq = new MinHeap();
  for (let v = 0; v < n; v++) {
    pq.push(v, importance(v, outE, inE, contracted, deletedNeighbors));
  }

  let order = 0;
  let sinceYield = 0;
  while (!pq.isEmpty()) {
    const v = pq.pop();
    if (contracted[v]) continue;
    // lazy update: recompute importance; if no longer the minimum, reinsert
    const imp = importance(v, outE, inE, contracted, deletedNeighbors);
    if (!pq.isEmpty() && imp > pq.peekPriority()) {
      pq.push(v, imp);
      continue;
    }
    // contract for real
    contract(v, outE, inE, contracted, mid, true);
    contracted[v] = 1;
    rank[v] = order++;
    // notify neighbors
    const touched = new Set();
    for (const [u] of inE[v]) if (!contracted[u]) touched.add(u);
    for (const [x] of outE[v]) if (!contracted[x]) touched.add(x);
    for (const u of touched) {
      deletedNeighbors[u]++;
      pq.push(u, importance(u, outE, inE, contracted, deletedNeighbors));
    }
    if (++sinceYield >= Math.max(1, (n / 40) | 0)) {
      sinceYield = 0;
      yield { type: 'info', message: `Contracting… ${order}/${n}` };
    }
  }

  // Build upward query graph over all edges (originals + shortcuts).
  const forwardUp = new Array(n);
  const backwardUp = new Array(n);
  for (let i = 0; i < n; i++) {
    forwardUp[i] = [];
    backwardUp[i] = [];
  }
  for (let u = 0; u < n; u++) {
    for (const [v, w] of outE[u]) {
      if (rank[v] > rank[u]) {
        forwardUp[u].push({ to: v, w });
      } else if (rank[u] > rank[v]) {
        backwardUp[v].push({ to: u, w });
      }
    }
  }

  yield { type: 'info', message: `Done — ${mid.size} shortcuts added.` };
  return { rank, forwardUp, backwardUp, mid };
}

// Recursively expand shortcut edges back into the real path of original nodes.
// `seq` is a node list where every consecutive pair (a,b) is a directed edge in
// the (possibly shortcut-laden) search graph; mid.get('a,b') gives the via-node.
function unpack(seq, mid) {
  if (!seq || seq.length < 2) return seq ? seq.slice() : seq;
  const out = [seq[0]];
  const stack = [];
  for (let i = seq.length - 2; i >= 0; i--) stack.push([seq[i], seq[i + 1]]);
  // process in order using an explicit stack to avoid deep recursion
  const expand = (a, b, acc) => {
    const m = mid.get(a + ',' + b);
    if (m === undefined) {
      acc.push(b);
    } else {
      expand(a, m, acc);
      expand(m, b, acc);
    }
  };
  for (let i = 0; i + 1 < seq.length; i++) expand(seq[i], seq[i + 1], out);
  return out;
}

// The shared bidirectional UPWARD query (used by both CH and CCH).
export function* chBidirectionalQuery(graph, start, goal, data) {
  const n = graph.n;
  const { forwardUp, backwardUp, mid } = data;
  const stats = makeStats();

  if (start === goal) {
    yield { type: 'found', path: [start], cost: 0 };
    return { path: [start], cost: 0, stats: withPath(stats, [start]) };
  }

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
  pqF.push(start, 0);
  distB[goal] = 0;
  pqB.push(goal, 0);
  stats.discovered += 2;
  stats.pushes += 2;

  let mu = Infinity;
  let meet = -1;

  while (true) {
    const topF = pqF.isEmpty() ? Infinity : pqF.peekPriority();
    const topB = pqB.isEmpty() ? Infinity : pqB.peekPriority();
    if (topF === Infinity && topB === Infinity) break;
    if (topF >= mu && topB >= mu) break;

    let dir = topF <= topB ? 'f' : 'b';
    if (dir === 'f' && topF >= mu) dir = 'b';
    if (dir === 'b' && topB >= mu) dir = 'f';

    if (dir === 'f') {
      const u = pqF.pop();
      if (setF[u]) continue;
      setF[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distF[u], dir: 'f' };
      if (Number.isFinite(distB[u]) && distF[u] + distB[u] < mu) {
        mu = distF[u] + distB[u];
        meet = u;
        yield { type: 'meet', node: u, dir: 'f' };
      }
      for (const { to: v, w } of forwardUp[u]) {
        const nd = distF[u] + w;
        stats.relaxations++;
        if (nd < distF[v]) {
          distF[v] = nd;
          parentF[v] = u;
          pqF.push(v, nd);
          stats.pushes++;
          stats.discovered++;
          if (pqF.size > stats.maxFrontier) stats.maxFrontier = pqF.size;
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'f' };
          if (Number.isFinite(distB[v]) && nd + distB[v] < mu) {
            mu = nd + distB[v];
            meet = v;
            yield { type: 'meet', node: v, dir: 'f' };
          }
        }
      }
    } else {
      const u = pqB.pop();
      if (setB[u]) continue;
      setB[u] = 1;
      stats.settled++;
      yield { type: 'settle', node: u, dist: distB[u], dir: 'b' };
      if (Number.isFinite(distF[u]) && distF[u] + distB[u] < mu) {
        mu = distF[u] + distB[u];
        meet = u;
        yield { type: 'meet', node: u, dir: 'b' };
      }
      for (const { to: v, w } of backwardUp[u]) {
        const nd = distB[u] + w;
        stats.relaxations++;
        if (nd < distB[v]) {
          distB[v] = nd;
          parentB[v] = u;
          pqB.push(v, nd);
          stats.pushes++;
          stats.discovered++;
          if (pqB.size > stats.maxFrontier) stats.maxFrontier = pqB.size;
          yield { type: 'discover', node: v, dist: nd, parent: u, dir: 'b' };
          if (Number.isFinite(distF[v]) && nd + distF[v] < mu) {
            mu = nd + distF[v];
            meet = v;
            yield { type: 'meet', node: v, dir: 'b' };
          }
        }
      }
    }
  }

  if (meet < 0 || !Number.isFinite(mu)) {
    yield { type: 'found', path: null, cost: Infinity };
    return { path: null, cost: Infinity, stats: withPath(stats, []) };
  }

  const seq = stitchBidirectional(parentF, parentB, start, goal, meet);
  const path = unpack(seq, mid);
  yield { type: 'found', path, cost: mu };
  return { path, cost: mu, stats: withPath(stats, path) };
}

export function* contractionHierarchies(graph, start, goal, opts = {}) {
  const ch = opts.ch;
  if (!ch) {
    // Safety net: preprocessing wasn't supplied (shouldn't happen via the
    // runner). Fall back to plain Dijkstra so the answer is still correct.
    return yield* dijkstra(graph, start, goal, {});
  }
  return yield* chBidirectionalQuery(graph, start, goal, ch);
}
