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
import { dfs } from './dfs.js';
import { bidirectionalBfs } from './bidirectional-bfs.js';

// Top-level split the UI groups by: algorithms designed for UNWEIGHTED graphs
// (fewest edges) vs WEIGHTED graphs (lowest total cost).
export const DOMAINS = {
  unweighted: {
    label: 'Unweighted — fewest edges',
    order: 0,
    blurb: 'Ignore edge weights and minimise the number of steps. The first search algorithms you learn.',
  },
  weighted: {
    label: 'Weighted — lowest cost',
    order: 1,
    blurb: 'Account for edge weights (distance / travel time) to find the cheapest route. Dijkstra and everything built on it.',
  },
};

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
  {
    id: 'dfs',
    name: 'Depth-First Search',
    short: 'DFS',
    color: '#7c8aa8',
    category: 'classic',
    run: dfs,
    optimal: false, // returns *a* path, never guaranteed shortest
    needsHeuristic: false,
    supportsNegative: true,
    blurb: 'Dives down one branch first. Finds *a* path, not the shortest.',
  },
  {
    id: 'bidirectional-bfs',
    name: 'Bidirectional BFS',
    short: 'Bi-BFS',
    color: '#5fb0c9',
    category: 'bidirectional',
    run: bidirectionalBfs,
    optimal: false, // fewest-edges; optimal only on equal-weight graphs
    needsHeuristic: false,
    supportsNegative: true,
    blurb: 'BFS from both ends — fewest-edges path, meeting in the middle.',
  },
];

// Domain (which UI section), one-line purpose, and which are used by real
// production routers. Applied here so the entries above stay compact.
const DOMAIN = { bfs: 'unweighted', dfs: 'unweighted', 'bidirectional-bfs': 'unweighted' };
const PURPOSE = {
  bfs: 'Shortest path by number of steps on unweighted graphs (friend-of-a-friend, web crawling).',
  dfs: 'Reach the goal or explore everything (maze carving, cycle detection) — not for shortest paths.',
  'bidirectional-bfs': 'Fewest-steps path, faster than BFS by meeting in the middle.',
  dijkstra: 'The shortest route when edges have different lengths/times — the routing baseline.',
  'bellman-ford': 'Shortest paths when some edges are negative (currency arbitrage, scheduling).',
  greedy: "A quick 'good enough' route when speed matters more than optimality.",
  astar: 'Fast optimal routing with a sense of direction — games, robotics, maps.',
  'bidirectional-dijkstra': "Halve Dijkstra's work for point-to-point queries.",
  'bidirectional-astar': 'Goal-directed and meet-in-the-middle combined.',
  alt: 'Sharper A* on road networks via precomputed landmark distances.',
  'contraction-hierarchies': 'Continental routing in microseconds — the core of production map routers (Google Maps, OSRM).',
  'customizable-ch': 'CH that re-optimises in milliseconds when live traffic changes — what keeps map ETAs current.',
  jps: 'Grid game pathfinding — A* with huge speedups on uniform grids.',
  'theta-star': 'Natural any-angle paths for robots & games (no zig-zag along grid lines).',
  'dstar-lite': 'Re-plan cheaply when the map changes mid-route — robotics, Mars rovers.',
};
const PRODUCTION = new Set(['contraction-hierarchies', 'customizable-ch']);
for (const a of ALGORITHMS) {
  a.domain = DOMAIN[a.id] || 'weighted';
  a.purpose = PURPOSE[a.id] || a.blurb;
  a.production = PRODUCTION.has(a.id);
}

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
  // Road networks are sparse and contract fast (≈0.8s for Cambridge's 15.7k
  // nodes), so all three OSM cities can demo CH/CCH. Dense synthetic meshes near
  // this ceiling preprocess in a few seconds (shown via the "Preprocessing…" status).
  'contraction-hierarchies': { maxNodes: 16000, reason: 'JS preprocessing gets slow above ~16k nodes' },
  'customizable-ch': { maxNodes: 16000, reason: 'JS preprocessing gets slow above ~16k nodes' },
};
const NEEDS_NONNEGATIVE = new Set([
  'dijkstra', 'astar', 'greedy', 'bidirectional-dijkstra', 'bidirectional-astar',
  'alt', 'contraction-hierarchies', 'customizable-ch', 'jps', 'theta-star', 'dstar-lite',
]);

// The SIZE_GUARDS are "soft": they exist to stop the browser locking up for many
// seconds, NOT because the result would be wrong. A power user on a fast machine
// can switch them off to force a heavy algorithm (CH/CCH/ALT, Bellman–Ford) onto
// a graph past its node ceiling — at their own risk (the tab may freeze while it
// preprocesses/runs). Hard guards (negative weights, grid/diagonal/uniform) are
// about correctness and are NEVER bypassed. Default ON, so the tests are unchanged.
let IGNORE_SIZE_LIMITS = false;
export function setIgnoreSizeLimits(on) { IGNORE_SIZE_LIMITS = !!on; }
export function getIgnoreSizeLimits() { return IGNORE_SIZE_LIMITS; }
// The node ceiling for an algorithm (or null if it has none) — for UI warnings.
export function sizeGuardFor(algoId) { return SIZE_GUARDS[algoId] || null; }
// Is `algoId` past its node ceiling on `graph`? Independent of the override, so
// the UI can still flag "running beyond the safe size" while it's allowed.
export function exceedsSizeLimit(algoId, graph) {
  const g = SIZE_GUARDS[algoId];
  return !!(g && graph && graph.n > g.maxNodes);
}

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
  if (g && graph.n > g.maxNodes && !IGNORE_SIZE_LIMITS) {
    return { ok: false, reason: g.reason, sizeLimited: true };
  }
  return { ok: true };
}

// True when every edge costs the same, so "fewest edges" == "lowest cost" and
// the unweighted searches (BFS / Bi-BFS) are actually optimal. Note an
// 8-connected grid is NOT uniform even with terrain off: diagonal moves cost √2,
// so BFS (which counts hops) can return a longer path than Dijkstra.
export function graphIsUniform(graph) {
  if (!graph) return false;
  if (graph.kind === 'maze') return true;            // 4-connected, unit steps
  if (graph.grid) return graph.uniform === true && !graph.grid.diagonal;
  if (graph.equalWeights === true) return true;
  return false;
}

// Does `algoId` return the optimal (minimum-cost) path on THIS graph?
//   status: 'optimal' | 'suboptimal' | 'anyAngle' | 'na'
//   note:   one short, human sentence for the UI and the sandbox.
// Single source of truth shared by the algorithm panel grouping, the sandbox
// optimality note, and the tests — so they can never disagree.
export function optimalityFor(algoId, graph) {
  const algo = byId[algoId];
  if (!algo) return { status: 'na', note: 'unknown algorithm' };
  const safe = safeFor(algoId, graph);
  if (!safe.ok) return { status: 'na', note: safe.reason };
  if (algo.anyAngle) {
    return { status: 'anyAngle', note: 'any-angle: finds a shorter path than the grid-optimal one' };
  }
  if (algo.id === 'dfs') return { status: 'suboptimal', note: 'finds *a* path, not the shortest' };
  if (algo.id === 'greedy') return { status: 'suboptimal', note: 'follows the heuristic greedily — usually not the shortest' };
  if (algo.id === 'bfs' || algo.id === 'bidirectional-bfs') {
    return graphIsUniform(graph)
      ? { status: 'optimal', note: 'fewest hops = shortest when every edge costs the same' }
      : { status: 'suboptimal', note: 'minimizes the number of hops, not weighted cost — not optimal here' };
  }
  if (algo.optimal) return { status: 'optimal', note: 'returns the provably shortest path' };
  return { status: 'suboptimal', note: 'not guaranteed to be the shortest path' };
}
