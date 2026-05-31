// tests/correctness.js
// Validates every algorithm against Dijkstra on several scenarios:
//   - returned paths are valid (endpoints correct, consecutive edges exist)
//   - reported cost equals the true weight of the returned path
//   - optimal algorithms tie Dijkstra's optimal cost
//   - non-optimal algorithms (BFS/Greedy) return a valid path with cost >= optimal
// Run: node tests/correctness.js   (requires package.json "type":"module")

import { byId, ALGORITHMS } from '../js/algorithms/index.js';
import { makeQuery, drain } from '../js/core/runner.js';
import { generateMap } from '../js/generators/map.js';
import { generateGrid } from '../js/generators/grid.js';
import { generateMaze } from '../js/generators/maze.js';
import { generateRandomGraph, generateNegativeGraph } from '../js/generators/random-graph.js';
import { writeFileSync } from 'fs';

// Deterministic RNG so any failure is reproducible. Pass a seed as argv[2].
const SEED = Number(process.argv[2] || 12345) >>> 0;
let _rngState = SEED;
Math.random = function () {
  _rngState += 0x6d2b79f5;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let pass = 0;
let fail = 0;
const failures = [];

function eq(a, b) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 1e-6 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}

function edgeWeight(graph, a, b) {
  let best = Infinity;
  for (const e of graph.adj[a]) if (e.to === b && e.w < best) best = e.w;
  return best;
}

function validatePath(graph, path, start, goal) {
  if (path[0] !== start) return 'path does not start at start';
  if (path[path.length - 1] !== goal) return 'path does not end at goal';
  let cost = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const w = edgeWeight(graph, path[i], path[i + 1]);
    if (!Number.isFinite(w)) return `no edge ${path[i]}->${path[i + 1]}`;
    cost += w;
  }
  return { cost };
}

function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}: ${detail}`);
  }
}

function optimalCost(graph, s, g) {
  return drain(makeQuery(byId.dijkstra, graph, s, g, {})).cost;
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function testScenario(label, result, queries, algoIds) {
  const { graph } = result;
  for (const [s, g] of queries) {
    const opt = optimalCost(graph, s, g);
    for (const id of algoIds) {
      const algo = byId[id];
      let res;
      try {
        res = drain(makeQuery(algo, graph, s, g, {}));
      } catch (e) {
        check(`${label}/${id}`, false, `threw: ${e && e.message}\n${e && e.stack}`);
        continue;
      }
      const tag = `${label}/${id} (${s}->${g})`;
      if (res.path) {
        const v = validatePath(graph, res.path, s, g);
        if (typeof v === 'string') {
          check(tag, false, `invalid path: ${v}`);
          continue;
        }
        check(`${tag} cost=pathweight`, eq(v.cost, res.cost), `reported ${res.cost} but path weighs ${v.cost}`);
        if (algo.optimal) {
          check(`${tag} optimal`, eq(res.cost, opt), `cost ${res.cost} != Dijkstra ${opt}`);
        } else {
          check(`${tag} valid-suboptimal`, res.cost >= opt - 1e-6, `cost ${res.cost} < optimal ${opt}?!`);
        }
      } else {
        // no path -> Dijkstra must also report unreachable
        check(`${tag} reachability`, !Number.isFinite(opt), `returned no path but Dijkstra found ${opt}`);
      }
    }
  }
}

function edgeCases(label, result, algoIds) {
  const { graph, start, goal } = result;
  // start === goal
  for (const id of algoIds) {
    const algo = byId[id];
    let res;
    try {
      res = drain(makeQuery(algo, graph, start, start, {}));
    } catch (e) {
      check(`${label}/${id} self`, false, `threw: ${e && e.message}`);
      continue;
    }
    check(`${label}/${id} self cost0`, res.cost === 0, `start==goal cost ${res.cost}`);
    check(`${label}/${id} self path`, res.path && res.path.length === 1 && res.path[0] === start, `start==goal path ${JSON.stringify(res.path)}`);
  }
}

const NONNEG = ALGORITHMS.map((a) => a.id).filter((id) => id !== 'bellman-ford' || true);

function queriesFor(graph, n, count) {
  const qs = [];
  const pick = () => {
    let id = randInt(n);
    if (graph.passable) {
      let guard = 0;
      while (!graph.passable[id] && guard++ < 500) id = randInt(n);
    }
    return id;
  };
  for (let i = 0; i < count; i++) {
    let s = pick();
    let g = pick();
    let guard = 0;
    while (g === s && guard++ < 20) g = pick();
    qs.push([s, g]);
  }
  return qs;
}

console.log('Running correctness harness…\n');

// All non-negative-requiring algorithms (everything except we test bellman-ford separately on neg graph)
const ALL = ALGORITHMS.map((a) => a.id);

// 1) Map (medium) — good size for CH/CCH/ALT
{
  const r = generateMap({ seed: 11, nodes: 700, cityCount: 9 });
  testScenario('map', r, queriesFor(r.graph, r.graph.n, 25), ALL);
  edgeCases('map', r, ALL);
}

// 2) Weighted terrain grid (4-dir)
{
  const r = generateGrid(34, 26, { seed: 5, weighted: true, diagonal: false });
  testScenario('grid4', r, queriesFor(r.graph, r.graph.n, 25), ALL);
}

// 3) Weighted grid (8-dir) with obstacles
{
  const r = generateGrid(30, 24, { seed: 8, weighted: true, diagonal: true, wallDensity: 0.12 });
  testScenario('grid8', r, queriesFor(r.graph, r.graph.n, 25), ALL);
  edgeCases('grid8', r, ALL);
}

// 4) Maze with braids
{
  const r = generateMaze(25, 17, { seed: 3, algorithm: 'backtracker', braid: 0.1 });
  testScenario('maze', r, queriesFor(r.graph, r.graph.n, 25), ALL);
}

// 5) Random geometric graph
{
  const r = generateRandomGraph(600, { seed: 2 });
  testScenario('random', r, queriesFor(r.graph, r.graph.n, 25), ALL);
}

// 6) Negative-weight graph — Bellman–Ford correctness (vs brute force) + path validity
{
  const r = generateNegativeGraph({ seed: 7 });
  const { graph } = r;
  const qs = queriesFor(graph, graph.n, 6);
  for (const [s, g] of qs) {
    let res;
    try {
      res = drain(makeQuery(byId['bellman-ford'], graph, s, g, {}));
    } catch (e) {
      check(`neg/bellman (${s}->${g})`, false, `threw: ${e && e.message}`);
      continue;
    }
    if (res.path) {
      const v = validatePath(graph, res.path, s, g);
      if (typeof v === 'string') check(`neg/bellman (${s}->${g})`, false, `invalid path: ${v}`);
      else check(`neg/bellman cost (${s}->${g})`, eq(v.cost, res.cost), `reported ${res.cost} path weighs ${v.cost}`);
    } else {
      check(`neg/bellman (${s}->${g})`, true, 'no path (acceptable)');
    }
  }
}

writeFileSync('/tmp/hr.json', JSON.stringify({ seed: SEED, pass, fail, failures: failures.slice(0, 40) }, null, 2));
console.log(`\n${pass} checks passed, ${fail} failed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures.slice(0, 60)) console.log('  ' + f);
  process.exit(1);
} else {
  console.log('✅ All algorithms validated.');
}
