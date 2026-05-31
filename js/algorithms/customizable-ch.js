// customizable-ch.js
// Customizable Contraction Hierarchies (CCH).
//
// CH bakes the edge weights (the "metric") into its shortcuts. That is great
// until the metric changes — e.g. live traffic every few minutes — because
// re-running CH preprocessing is expensive. CCH splits the work in two:
//
//   1. METRIC-INDEPENDENT phase (expensive, once): choose a contraction order
//      from the graph TOPOLOGY ALONE and build the "fill-in" shortcut structure
//      (the elimination game / chordal graph). No weights involved.
//   2. CUSTOMIZATION phase (cheap, repeatable): pour the current weights into
//      that fixed structure with a single sweep of triangle relaxations. When
//      traffic changes you re-run ONLY this phase.
//
// The query is identical to CH (a bidirectional upward search + unpacking), so
// we reuse chBidirectionalQuery.
//
// preprocessCCH(graph) -> { rank, forwardUp, backwardUp, mid }
// customizableCH(graph, s, t, {cch}) -> upward bidirectional query

import { MinHeap } from '../core/priority-queue.js';
import { chBidirectionalQuery } from './contraction-hierarchies.js';
import { dijkstra } from './dijkstra.js';

const keyOf = (a, b) => (a < b ? a + ',' + b : b + ',' + a);

export function* preprocessCCH(graph, opts = {}) {
  const n = graph.n;

  // Symmetric original weights + neighbour sets (undirected interpretation).
  const origW = new Map();
  const nb = new Array(n);
  for (let i = 0; i < n; i++) nb[i] = new Set();
  for (let u = 0; u < n; u++) {
    for (const { to: v, w } of graph.neighbors(u)) {
      if (v === u) continue;
      const k = keyOf(u, v);
      const cur = origW.get(k);
      if (cur === undefined || w < cur) origW.set(k, w);
      nb[u].add(v);
      nb[v].add(u);
    }
  }

  // ── Phase 1: metric-independent min-degree elimination ─────────────────────
  yield { type: 'info', message: 'Building metric-independent order…' };
  const contracted = new Uint8Array(n);
  const rank = new Int32Array(n);
  rank.fill(-1);
  const edges = new Set(); // all CCH edges (original + fill-in), undirected keys
  for (const k of origW.keys()) edges.add(k);

  const pq = new MinHeap();
  for (let v = 0; v < n; v++) pq.push(v, nb[v].size);

  let order = 0;
  let sinceYield = 0;
  while (!pq.isEmpty()) {
    const v = pq.pop();
    if (contracted[v]) continue;
    const deg = nb[v].size;
    if (!pq.isEmpty() && deg > pq.peekPriority()) {
      pq.push(v, deg); // stale; reinsert with current degree
      continue;
    }
    const neighbors = [...nb[v]];
    // make neighbours pairwise adjacent (fill-in)
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const a = neighbors[i];
        const b = neighbors[j];
        if (!nb[a].has(b)) {
          nb[a].add(b);
          nb[b].add(a);
          edges.add(keyOf(a, b));
        }
      }
    }
    // remove v from the working graph
    for (const a of neighbors) nb[a].delete(v);
    contracted[v] = 1;
    rank[v] = order++;
    for (const a of neighbors) pq.push(a, nb[a].size);

    if (++sinceYield >= Math.max(1, (n / 30) | 0)) {
      sinceYield = 0;
      yield { type: 'info', message: `Ordering… ${order}/${n}` };
    }
  }

  // higher-ranked neighbour adjacency for the customization sweep
  const higher = new Array(n);
  for (let i = 0; i < n; i++) higher[i] = [];
  for (const k of edges) {
    const ci = k.indexOf(',');
    const a = +k.slice(0, ci);
    const b = +k.slice(ci + 1);
    if (rank[a] < rank[b]) higher[a].push(b);
    else higher[b].push(a);
  }

  // ── Phase 2: customization (assign weights from the metric) ────────────────
  yield { type: 'info', message: 'Customizing weights…' };
  const W = new Map();
  for (const k of edges) W.set(k, origW.has(k) ? origW.get(k) : Infinity);
  const mid = new Map();

  // process nodes in ascending rank
  const byRank = new Array(n);
  for (let v = 0; v < n; v++) byRank[rank[v]] = v;
  for (let r = 0; r < n; r++) {
    const v = byRank[r];
    if (v === undefined) continue;
    const hs = higher[v];
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      const wva = W.get(keyOf(v, a));
      if (!Number.isFinite(wva)) continue;
      for (let j = 0; j < hs.length; j++) {
        if (i === j) continue;
        const b = hs[j];
        const wvb = W.get(keyOf(v, b));
        if (!Number.isFinite(wvb)) continue;
        const cand = wva + wvb;
        const k = keyOf(a, b);
        if (cand < W.get(k)) {
          W.set(k, cand);
          mid.set(a + ',' + b, v);
          mid.set(b + ',' + a, v);
        }
      }
    }
  }

  // build upward query graph. The graph is undirected, so BOTH the forward and
  // backward upward searches climb from the lower-ranked endpoint to the
  // higher-ranked one — the two up-adjacencies are identical.
  const forwardUp = new Array(n);
  const backwardUp = new Array(n);
  for (let i = 0; i < n; i++) {
    forwardUp[i] = [];
    backwardUp[i] = [];
  }
  for (const k of edges) {
    const w = W.get(k);
    if (!Number.isFinite(w)) continue;
    const ci = k.indexOf(',');
    const a = +k.slice(0, ci);
    const b = +k.slice(ci + 1);
    const lo = rank[a] < rank[b] ? a : b;
    const hi = lo === a ? b : a;
    forwardUp[lo].push({ to: hi, w });
    backwardUp[lo].push({ to: hi, w });
  }

  yield { type: 'info', message: `Done — ${edges.size} edges (incl. fill-in).` };
  return { rank, forwardUp, backwardUp, mid, ordered: true };
}

export function* customizableCH(graph, start, goal, opts = {}) {
  const cch = opts.cch;
  if (!cch) {
    return yield* dijkstra(graph, start, goal, {});
  }
  return yield* chBidirectionalQuery(graph, start, goal, cch);
}
