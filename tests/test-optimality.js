// tests/test-optimality.js — validate the registry's optimalityFor() verdicts
// against reality, plus the unweighted-domain algorithms (DFS, Bidirectional
// BFS) and the domain assignments. One source of truth (index.js) drives the UI
// grouping, the sandbox note, and these tests, so they can never disagree.
import { writeFileSync } from 'fs';
import { ALGORITHMS, byId, safeFor, optimalityFor, graphIsUniform } from '../js/algorithms/index.js';
import { makeQuery, drain } from '../js/core/runner.js';
import { generateGrid } from '../js/generators/grid.js';
import { generateMaze } from '../js/generators/maze.js';
import { generateMap } from '../js/generators/map.js';
import { generateRandomGraph, generateNegativeGraph } from '../js/generators/random-graph.js';

const OUT = process.argv[2] || '/tmp/optimality.json';
let rng = 7;
const rand = () => { rng += 0x6d2b79f5; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const eq = (a, b) => Math.abs(a - b) <= 1e-6 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
const pick = (g) => { let id = (rand() * g.n) | 0; let k = 0; while (g.passable && !g.passable[id] && k++ < 500) id = (rand() * g.n) | 0; return id; };

const report = { checks: 0, fails: 0, samples: [], byStatus: {} };
function fail(msg) { report.fails++; if (report.samples.length < 25) report.samples.push(msg); }

function groundTruthCost(g, s, go) {
  const base = g.hasNegative ? byId['bellman-ford'] : byId.dijkstra;
  return drain(makeQuery(base, g, s, go, {})).cost;
}

// Core invariant: whenever optimalityFor() says 'optimal', the algorithm really
// does return a minimum-cost path (== ground truth) wherever a path exists.
function checkGraph(label, g, queries) {
  for (let q = 0; q < queries; q++) {
    const s = pick(g), go = pick(g);
    if (s === go) continue;
    const opt = groundTruthCost(g, s, go);
    for (const a of ALGORITHMS) {
      const verdict = optimalityFor(a.id, g);
      report.byStatus[verdict.status] = (report.byStatus[verdict.status] || 0) + 1;
      if (verdict.status !== 'optimal') continue;
      if (!safeFor(a.id, g).ok) { fail(`${label}: ${a.id} marked optimal but not safeFor`); continue; }
      report.checks++;
      let res;
      try { res = drain(makeQuery(a, g, s, go, {})); }
      catch (e) { fail(`${label}: ${a.id} ${s}->${go} threw ${e.message}`); continue; }
      if (Number.isFinite(opt)) {
        if (!res.path || !eq(res.cost, opt)) fail(`${label}: ${a.id} 'optimal' but cost=${res && res.cost} vs truth=${opt}`);
      } else if (res.path) {
        fail(`${label}: ${a.id} found a path where ground truth says none`);
      }
    }
  }
}

// Classification sanity: BFS/Bi-BFS are optimal exactly on equal-weight graphs.
function checkBfsClassification(label, g, expectUniform) {
  if (graphIsUniform(g) !== expectUniform) fail(`${label}: graphIsUniform=${graphIsUniform(g)} expected ${expectUniform}`);
  for (const id of ['bfs', 'bidirectional-bfs']) {
    if (!safeFor(id, g).ok) continue;
    const st = optimalityFor(id, g).status;
    const want = expectUniform ? 'optimal' : 'suboptimal';
    report.checks++;
    if (st !== want) fail(`${label}: ${id} status=${st} expected ${want}`);
  }
}

// DFS is never the shortest-path choice; it must always read as suboptimal (or
// unavailable), never 'optimal'. And it should still return a *valid* path.
function checkDfs(label, g) {
  const st = optimalityFor('dfs', g).status;
  report.checks++;
  if (st === 'optimal') fail(`${label}: dfs must never be 'optimal' (got ${st})`);
  const s = pick(g), go = pick(g);
  if (s === go) return;
  const res = drain(makeQuery(byId.dfs, g, s, go, {}));
  const truth = groundTruthCost(g, s, go);
  if (Number.isFinite(truth)) {
    if (!res.path || res.path[0] !== s || res.path[res.path.length - 1] !== go) fail(`${label}: dfs path invalid ${s}->${go}`);
  }
}

for (const seed of [1, 2, 3]) {
  const maze = generateMaze(23, 15, { seed, braid: 0.08 }).graph;
  const gridU = generateGrid(26, 20, { seed, weighted: false, diagonal: false }).graph;
  const gridU8 = generateGrid(26, 20, { seed, weighted: false, diagonal: true, wallDensity: 0.1 }).graph;
  const gridW = generateGrid(26, 20, { seed, weighted: true, diagonal: false }).graph;
  const geo = generateRandomGraph(500, { seed }).graph;
  const map = generateMap({ seed, nodes: 600, cityCount: 8 }).graph;
  const neg = generateNegativeGraph({ seed }).graph;

  for (const [label, g] of [['maze', maze], ['gridU', gridU], ['gridU8', gridU8], ['gridW', gridW], ['geo', geo], ['map', map], ['neg', neg]]) {
    checkGraph(label, g, 6);
  }
  checkBfsClassification('maze', maze, true);
  checkBfsClassification('gridU', gridU, true);
  checkBfsClassification('gridW', gridW, false);
  checkBfsClassification('geo', geo, false);
  checkBfsClassification('map', map, false);
  for (const [label, g] of [['maze', maze], ['gridW', gridW], ['geo', geo], ['map', map]]) checkDfs(label, g);
}

// Domain assignments: only the three unweighted searches are 'unweighted'.
const UNW = new Set(['bfs', 'dfs', 'bidirectional-bfs']);
for (const a of ALGORITHMS) {
  report.checks++;
  const want = UNW.has(a.id) ? 'unweighted' : 'weighted';
  if (a.domain !== want) fail(`domain: ${a.id} is '${a.domain}' expected '${want}'`);
}

report.RESULT = report.fails === 0 ? 'ALL_PASS' : 'FAILURES';
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(report.RESULT, report.checks, report.fails);
process.exit(report.fails === 0 ? 0 : 1);
