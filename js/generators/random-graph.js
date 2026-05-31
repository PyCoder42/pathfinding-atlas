// random-graph.js
// Abstract weighted graphs ("regular node-based graphs"). These are geometric:
// nodes have 2D positions and edge weights equal Euclidean distance, so A* and
// the landmark/triangle-inequality heuristics are meaningful. Built on a
// jittered grid so the graph is guaranteed connected and scales to very large
// sizes, with optional extra random edges for richer structure.
//
//   graph.kind = 'network'  (drawn as nodes + edges)
//   returns { graph, start, goal, label }

import { Graph } from '../core/graph.js';
import { RNG } from '../core/utils.js';

export function generateRandomGraph(nApprox, opts = {}) {
  const seed = opts.seed ?? 1;
  const diagonal = opts.diagonal ?? true;
  const extraEdges = opts.extraEdges ?? 0.04; // long-range edges as fraction of n
  const jitter = opts.jitter ?? 0.38;
  const rng = new RNG(seed);

  const cols = Math.max(2, Math.round(Math.sqrt(nApprox)));
  const rows = Math.max(2, Math.round(nApprox / cols));
  const spacing = 24;

  const g = new Graph();
  g.kind = 'network';
  g.weightKind = 'distance';

  const idx = (c, r) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rng.float() - 0.5) * 2 * jitter * spacing;
      const jy = (rng.float() - 0.5) * 2 * jitter * spacing;
      g.addNode(c * spacing + jx, r * spacing + jy, null);
    }
  }

  const connect = (a, b) => g.addEdge(a, b, g.euclidean(a, b));

  // Base 4-connectivity guarantees the graph is connected.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = idx(c, r);
      if (c + 1 < cols) connect(a, idx(c + 1, r));
      if (r + 1 < rows) connect(a, idx(c, r + 1));
      if (diagonal) {
        // Add one diagonal per cell (probabilistically) for a triangulated mesh.
        if (c + 1 < cols && r + 1 < rows && rng.bool(0.5)) {
          connect(a, idx(c + 1, r + 1));
        } else if (c + 1 < cols && r + 1 < rows) {
          connect(idx(c + 1, r), idx(c, r + 1));
        }
      }
    }
  }

  // A sprinkling of long-range "express" edges to create shortcuts that reward
  // bidirectional / hierarchical methods.
  const n = g.n;
  const extra = Math.floor(n * extraEdges);
  for (let i = 0; i < extra; i++) {
    const a = rng.int(0, n - 1);
    const b = rng.int(0, n - 1);
    if (a !== b) connect(a, b);
  }

  const start = idx(0, 0);
  const goal = idx(cols - 1, rows - 1);
  return {
    graph: g,
    start,
    goal,
    label: `${n.toLocaleString()}-node geometric graph`,
  };
}

// A small hand-shaped graph with some NEGATIVE edges, for the Bellman–Ford
// teaching scenario. Dijkstra/A* are not valid here; that's the point.
export function generateNegativeGraph(opts = {}) {
  const seed = opts.seed ?? 7;
  const rng = new RNG(seed);
  const cols = 6;
  const rows = 4;
  const spacing = 60;
  const g = new Graph();
  g.kind = 'network';
  g.weightKind = 'distance';
  g.hasNegative = true;

  const idx = (c, r) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.addNode(c * spacing + (rng.float() - 0.5) * 14, r * spacing + (rng.float() - 0.5) * 14, null);
    }
  }
  // Directed edges with mostly positive, a few negative weights (no negative
  // cycle), so a shortest path still exists.
  const edges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = idx(c, r);
      if (c + 1 < cols) edges.push([a, idx(c + 1, r)]);
      if (r + 1 < rows) edges.push([a, idx(c, r + 1)]);
      if (c + 1 < cols && r + 1 < rows && rng.bool(0.4)) edges.push([a, idx(c + 1, r + 1)]);
    }
  }
  for (const [a, b] of edges) {
    let w = Math.round(g.euclidean(a, b) / 6);
    if (rng.bool(0.22)) w = -Math.max(1, Math.round(w * 0.5)); // some negatives
    g.addEdge(a, b, w, true); // directed to avoid trivial negative 2-cycles
  }

  return {
    graph: g,
    start: idx(0, 0),
    goal: idx(cols - 1, rows - 1),
    label: 'Directed graph with negative weights',
  };
}
