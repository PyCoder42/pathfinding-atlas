// index.js — the algorithm registry.
//
// Every algorithm is registered here with display metadata and an optional
// preprocessing step. The UI builds its checklists, colors, and explanation
// links from this list. The runner (runner.js) reads `preprocess`/`optsKey` to
// build auxiliary data once per graph and feed it to the query generator.
//
// Contract recap (see common.js for the full spec):
//   run:        function*(graph, start, goal, opts) -> yields steps, returns Result
//   preprocess: function*(graph, opts) -> yields progress, returns auxData   (optional)
//   optsKey:    the opts property name the query reads its auxData from       (optional)

import { bfs } from './bfs.js';
import { dijkstra } from './dijkstra.js';
import { astar } from './astar.js';
import { greedy } from './greedy.js';
import { bidirectionalDijkstra } from './bidirectional-dijkstra.js';
import { bidirectionalAstar } from './bidirectional-astar.js';
import { bellmanFord } from './bellman-ford.js';
import { alt, preprocessALT } from './alt.js';
import { contractionHierarchies, preprocessCH } from './contraction-hierarchies.js';
import { customizableCH, preprocessCCH } from './customizable-ch.js';
import { jps } from './jps.js';
import { thetaStar } from './theta-star.js';
import { dstarLite } from './dstar-lite.js';

export const CATEGORIES = {
  classic: { label: 'Classic', order: 0 },
  informed: { label: 'Informed (heuristic)', order: 1 },
  bidirectional: { label: 'Bidirectional', order: 2 },
  speedup: { label: 'Goal-directed speedup', order: 3 },
  hierarchical: { label: 'Hierarchical (preprocessed)', order: 4 },
  specialized: { label: 'Specialized', order: 5 },
};

export const ALGORITHMS = [
  {
    id: 'bfs',
    name: 'Breadth-First Search',
    short: 'BFS',
    color: '#8e9bbf',
    category: 'classic',
    run: bfs,
    optimal: false, // optimal only when all weights are equal
    needsHeuristic: false,
    supportsNegative: true,
    blurb: 'Fewest-hops baseline. Ignores weights.',
  },
  {
    id: 'dijkstra',
    name: "Dijkstra's Algorithm",
    short: 'Dijkstra',
    color: '#4f86f7',
    category: 'classic',
    run: dijkstra,
    optimal: true,
    needsHeuristic: false,
    supportsNegative: false,
    blurb: 'Uniform-cost search. The gold-standard baseline.',
  },
  {
    id: 'bellman-ford',
    name: 'Bellman–Ford',
    short: 'Bellman–Ford',
    color: '#9b59b6',
    category: 'classic',
    run: bellmanFord,
    optimal: true,
    needsHeuristic: false,
    supportsNegative: true,
    blurb: 'Handles negative weights; detects negative cycles.',
  },
  {
    id: 'greedy',
    name: 'Greedy Best-First Search',
    short: 'Greedy',
    color: '#e0529c',
    category: 'informed',
    run: greedy,
    optimal: false,
    needsHeuristic: true,
    supportsNegative: false,
    blurb: 'Charges at the goal by heuristic alone. Fast but not optimal.',
  },
  {
    id: 'astar',
    name: 'A* Search',
    short: 'A*',
    color: '#f5a623',
    category: 'informed',
    run: astar,
    optimal: true,
    needsHeuristic: true,
    supportsNegative: false,
    blurb: 'Dijkstra + heuristic. Optimal and goal-directed.',
  },
  {
    id: 'bidirectional-dijkstra',
    name: 'Bidirectional Dijkstra',
    short: 'Bi-Dijkstra',
    color: '#2bb673',
    category: 'bidirectional',
    run: bidirectionalDijkstra,
    optimal: true,
    needsHeuristic: false,
    supportsNegative: false,
    blurb: 'Two searches, from start and goal, meeting in the middle.',
  },
  {
    id: 'bidirectional-astar',
    name: 'Bidirectional A*',
    short: 'Bi-A*',
    color: '#16a3a3',
    category: 'bidirectional',
    run: bidirectionalAstar,
    optimal: true,
    needsHeuristic: true,
    supportsNegative: false,
    blurb: 'Two heuristic searches converging from both ends.',
  },
  {
    id: 'alt',
    name: 'ALT (A* + Landmarks)',
    short: 'ALT',
    color: '#d64545',
    category: 'speedup',
    run: alt,
    preprocess: preprocessALT,
    optsKey: 'alt',
    optimal: true,
    needsHeuristic: false, // builds its own landmark heuristic
    supportsNegative: false,
    blurb: 'A* with a far sharper landmark/triangle-inequality heuristic.',
  },
  {
    id: 'contraction-hierarchies',
    name: 'Contraction Hierarchies',
    short: 'CH',
    color: '#c9a227',
    category: 'hierarchical',
    run: contractionHierarchies,
    preprocess: preprocessCH,
    optsKey: 'ch',
    optimal: true,
    needsHeuristic: false,
    supportsNegative: false,
    blurb: 'Preprocess once into shortcuts; queries are blazing fast.',
  },
  {
    id: 'customizable-ch',
    name: 'Customizable Contraction Hierarchies',
    short: 'CCH',
    color: '#6b4ce6',
    category: 'hierarchical',
    run: customizableCH,
    preprocess: preprocessCCH,
    optsKey: 'cch',
    optimal: true,
    needsHeuristic: false,
    supportsNegative: false,
    blurb: 'CH split into metric-independent + fast metric customization.',
  },
  {
    id: 'jps',
    name: 'Jump Point Search',
    short: 'JPS',
    color: '#21c0a8',
    category: 'specialized',
    run: jps,
    optimal: true,
    needsHeuristic: true,
    supportsNegative: false,
    needsGrid: true,
    needsDiagonal: true, // classic JPS requires 8-connectivity
    uniformOnly: true,   // only valid on uniform-cost grids
    blurb: 'A* that "jumps" over symmetric grid paths. Same path, far fewer expansions.',
  },
  {
    id: 'theta-star',
    name: 'Theta* (any-angle)',
    short: 'Theta*',
    color: '#ff8c42',
    category: 'specialized',
    run: thetaStar,
    optimal: false,    // optimal for ANY-ANGLE paths, not grid-constrained ones
    anyAngle: true,
    needsHeuristic: true,
    supportsNegative: false,
    needsGrid: true,
    blurb: 'Any-angle paths via line-of-sight shortcuts — shorter than grid A*.',
  },
  {
    id: 'dstar-lite',
    name: 'D* Lite',
    short: 'D* Lite',
    color: '#b07cff',
    category: 'specialized',
    run: dstarLite,
    optimal: true,
    needsHeuristic: false,
    supportsNegative: false,
    blurb: 'Incremental replanning from the goal — what robots use when the map changes.',
  },
];

export const byId = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a]));

export function algoColor(id) {
  return byId[id] ? byId[id].color : '#888';
}

// ── Applicability guards ────────────────────────────────────────────────────
// Some algorithms only make sense on certain graphs (size limits, grid-only,
// non-negative weights). One source of truth, used by the UI and the tests.
const SIZE_GUARDS = {
  'bellman-ford': { maxNodes: 8000, reason: 'O(V·E) — too slow above ~8k nodes' },
  alt: { maxNodes: 50000, reason: 'precomputes a Dijkstra per landmark' },
  'contraction-hierarchies': { maxNodes: 14000, reason: 'JS preprocessing gets slow above ~14k nodes' },
  'customizable-ch': { maxNodes: 12000, reason: 'JS preprocessing gets slow above ~12k nodes' },
};
const NEEDS_NONNEGATIVE = new Set([
  'dijkstra', 'astar', 'greedy', 'bidirectional-dijkstra', 'bidirectional-astar',
  'alt', 'contraction-hierarchies', 'customizable-ch', 'jps', 'theta-star', 'dstar-lite',
]);

export function safeFor(algoId, graph) {
  const algo = byId[algoId];
  if (!algo || !graph) return { ok: false, reason: 'unknown' };
  if (graph.hasNegative && NEEDS_NONNEGATIVE.has(algoId)) {
    return { ok: false, reason: 'assumes non-negative weights — use Bellman–Ford' };
  }
  if (algo.needsGrid && !graph.grid) {
    return { ok: false, reason: 'grid scenarios only' };
  }
  if (algo.needsDiagonal && !(graph.grid && graph.grid.diagonal)) {
    return { ok: false, reason: 'needs an 8-direction grid' };
  }
  if (algo.uniformOnly && graph.uniform === false) {
    return { ok: false, reason: 'uniform-cost grids only (turn off terrain weights)' };
  }
  const g = SIZE_GUARDS[algoId];
  if (g && graph.n > g.maxNodes) return { ok: false, reason: g.reason };
  return { ok: true };
}
