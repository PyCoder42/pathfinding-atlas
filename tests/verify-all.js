// tests/verify-all.js — self-contained multi-seed correctness check.
// Validates every algorithm vs Dijkstra across all scenarios and several seeds,
// writing a machine-readable summary to the path given as argv[2].
import { writeFileSync } from 'fs';
import { byId, ALGORITHMS, safeFor } from '../js/algorithms/index.js';
import { makeQuery, drain } from '../js/core/runner.js';
import { generateMap } from '../js/generators/map.js';
import { generateGrid } from '../js/generators/grid.js';
import { generateMaze } from '../js/generators/maze.js';
import { generateRandomGraph, generateNegativeGraph } from '../js/generators/random-graph.js';

const OUT = process.argv[2] || '/tmp/verify.json';
const ALL = ALGORITHMS.map((a) => a.id);

function eq(a, b) {
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  return Math.abs(a - b) <= 1e-6 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}
function edgeW(g, a, b) { let w = Infinity; for (const e of g.adj[a]) if (e.to === b && e.w < w) w = e.w; return w; }
function pathCost(g, p) { let c = 0; for (let i = 0; i + 1 < p.length; i++) { const w = edgeW(g, p[i], p[i + 1]); if (!Number.isFinite(w)) return NaN; c += w; } return c; }

let rng = 1;
function rand() { rng += 0x6d2b79f5; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

const report = { seeds: [], totalChecks: 0, totalFails: 0, sampleFailures: [] };

function testGraph(label, g, count) {
  const n = g.n;
  const pick = () => { let id = (rand() * n) | 0; if (g.passable) { let k = 0; while (!g.passable[id] && k++ < 500) id = (rand() * n) | 0; } return id; };
  for (let q = 0; q < count; q++) {
    let s = pick(), go = pick(), k = 0;
    while (go === s && k++ < 20) go = pick();
    const opt = drain(makeQuery(byId.dijkstra, g, s, go, {})).cost;
    for (const id of ALL) {
      const algo = byId[id];
      if (!safeFor(id, g).ok) continue;        // skip algos not applicable to this graph
      if (algo.anyAngle) continue;             // any-angle (Theta*) has its own validator
      let res;
      try { res = drain(makeQuery(algo, g, s, go, {})); }
      catch (e) { report.totalChecks++; report.totalFails++; if (report.sampleFailures.length < 30) report.sampleFailures.push(`${label}/${id} ${s}->${go} threw: ${e.message}`); continue; }
      report.totalChecks++;
      if (res.path) {
        const pc = pathCost(g, res.path);
        const validEnds = res.path[0] === s && res.path[res.path.length - 1] === go;
        const costOk = eq(pc, res.cost);
        const optOk = algo.optimal ? eq(res.cost, opt) : res.cost >= opt - 1e-6;
        if (!(validEnds && costOk && optOk)) {
          report.totalFails++;
          if (report.sampleFailures.length < 30) report.sampleFailures.push(`${label}/${id} ${s}->${go} cost=${res.cost} opt=${opt} pathCost=${pc} ends=${validEnds}`);
        }
      } else {
        report.totalChecks++;
        if (Number.isFinite(opt)) { report.totalFails++; if (report.sampleFailures.length < 30) report.sampleFailures.push(`${label}/${id} ${s}->${go} no path but opt=${opt}`); }
      }
    }
  }
}

for (const seed of [1, 2, 3, 12345, 777, 2024]) {
  rng = seed >>> 0;
  const before = report.totalFails;
  testGraph('map', generateMap({ seed, nodes: 650, cityCount: 9 }).graph, 20);
  testGraph('grid4', generateGrid(32, 24, { seed, weighted: true, diagonal: false }).graph, 18);
  testGraph('grid8', generateGrid(30, 22, { seed, weighted: true, diagonal: true, wallDensity: 0.12 }).graph, 18);
  testGraph('maze', generateMaze(25, 17, { seed, braid: 0.1 }).graph, 18);
  testGraph('random', generateRandomGraph(600, { seed }).graph, 18);
  report.seeds.push({ seed, failsThisSeed: report.totalFails - before });
}

// negative graph: bellman-ford only
{
  rng = 7;
  const g = generateNegativeGraph({ seed: 7 }).graph;
  for (let q = 0; q < 10; q++) {
    const s = (rand() * g.n) | 0, go = (rand() * g.n) | 0;
    if (s === go) continue;
    const res = drain(makeQuery(byId['bellman-ford'], g, s, go, {}));
    report.totalChecks++;
    if (res.path) { const pc = pathCost(g, res.path); if (!eq(pc, res.cost)) { report.totalFails++; report.sampleFailures.push(`neg/bellman ${s}->${go} cost=${res.cost} pathCost=${pc}`); } }
  }
}

report.RESULT = report.totalFails === 0 ? 'ALL_PASS' : 'FAILURES';
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(report.RESULT, report.totalChecks, report.totalFails);
process.exit(report.totalFails === 0 ? 0 : 1);
