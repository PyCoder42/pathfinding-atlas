// tests/test-new-algos.js — validate JPS, Theta*, D* Lite directly.
import { writeFileSync } from 'fs';
import { jps } from '../js/algorithms/jps.js';
import { thetaStar } from '../js/algorithms/theta-star.js';
import { dstarLite } from '../js/algorithms/dstar-lite.js';
import { dijkstra } from '../js/algorithms/dijkstra.js';
import { generateGrid } from '../js/generators/grid.js';
import { generateMaze } from '../js/generators/maze.js';
import { generateMap } from '../js/generators/map.js';
import { generateRandomGraph } from '../js/generators/random-graph.js';

const OUT = process.argv[2] || '/tmp/newalgo.json';
let rng = 99;
const rand = () => { rng += 0x6d2b79f5; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const drain = (g) => { let r = g.next(); let k = 0; while (!r.done && k++ < 9e6) r = g.next(); return r.value; };
const eq = (a, b) => Math.abs(a - b) <= 1e-6 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
const report = { dstar: { checks: 0, fails: 0, samples: [] }, jps: { checks: 0, fails: 0, samples: [] }, theta: { checks: 0, fails: 0, samples: [] } };

function edgeW(g, a, b) { let w = Infinity; for (const e of g.adj[a]) if (e.to === b && e.w < w) w = e.w; return w; }
function pathCost(g, p) { let c = 0; for (let i = 0; i + 1 < p.length; i++) { const w = edgeW(g, p[i], p[i + 1]); if (!Number.isFinite(w)) return NaN; c += w; } return c; }
function passOK(g, id) { return !g.passable || g.passable[id] === 1; }
function lineOfSight(g, a, b) {
  const cols = g.grid.cols;
  let x0 = a % cols, y0 = (a / cols) | 0; const x1 = b % cols, y1 = (b / cols) | 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let k = 0; k < dx + dy + 2; k++) {
    if (!passOK(g, y0 * cols + x0)) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return true;
}
function pick(g) { let id = (rand() * g.n) | 0; let k = 0; while (g.passable && !g.passable[id] && k++ < 500) id = (rand() * g.n) | 0; return id; }

function testDstar(label, g, count) {
  for (let q = 0; q < count; q++) {
    const s = pick(g), go = pick(g); if (s === go) continue;
    const opt = drain(dijkstra(g, s, go, {})).cost;
    report.dstar.checks++;
    let res; try { res = drain(dstarLite(g, s, go, {})); } catch (e) { report.dstar.fails++; if (report.dstar.samples.length < 12) report.dstar.samples.push(`${label} ${s}->${go} threw ${e.message}`); continue; }
    if (res.path) {
      const pc = pathCost(g, res.path);
      if (!(res.path[0] === s && res.path[res.path.length - 1] === go && eq(pc, res.cost) && eq(res.cost, opt))) { report.dstar.fails++; if (report.dstar.samples.length < 12) report.dstar.samples.push(`${label} ${s}->${go} cost=${res.cost} opt=${opt} pc=${pc}`); }
    } else if (Number.isFinite(opt)) { report.dstar.fails++; if (report.dstar.samples.length < 12) report.dstar.samples.push(`${label} ${s}->${go} nopath opt=${opt}`); }
  }
}
function testJps(label, g, count) {
  for (let q = 0; q < count; q++) {
    const s = pick(g), go = pick(g); if (s === go) continue;
    const opt = drain(dijkstra(g, s, go, {})).cost;
    report.jps.checks++;
    let res; try { res = drain(jps(g, s, go, {})); } catch (e) { report.jps.fails++; if (report.jps.samples.length < 12) report.jps.samples.push(`${label} ${s}->${go} threw ${e.message}`); continue; }
    if (res.path) {
      const pc = pathCost(g, res.path);
      if (!(res.path[0] === s && res.path[res.path.length - 1] === go && eq(pc, res.cost) && eq(res.cost, opt))) { report.jps.fails++; if (report.jps.samples.length < 12) report.jps.samples.push(`${label} ${s}->${go} cost=${res.cost} opt=${opt} pc=${pc} ends=${res.path[0] === s && res.path[res.path.length - 1] === go}`); }
    } else if (Number.isFinite(opt)) { report.jps.fails++; if (report.jps.samples.length < 12) report.jps.samples.push(`${label} ${s}->${go} nopath opt=${opt}`); }
  }
}
function testTheta(label, g, count) {
  for (let q = 0; q < count; q++) {
    const s = pick(g), go = pick(g); if (s === go) continue;
    const opt = drain(dijkstra(g, s, go, {})).cost;
    if (!Number.isFinite(opt)) continue;
    report.theta.checks++;
    let res; try { res = drain(thetaStar(g, s, go, {})); } catch (e) { report.theta.fails++; if (report.theta.samples.length < 12) report.theta.samples.push(`${label} ${s}->${go} threw ${e.message}`); continue; }
    if (!res.path) { report.theta.fails++; if (report.theta.samples.length < 12) report.theta.samples.push(`${label} ${s}->${go} nopath`); continue; }
    const cols = g.grid.cols;
    const straight = Math.hypot((s % cols) - (go % cols), ((s / cols) | 0) - ((go / cols) | 0));
    let losOK = res.path[0] === s && res.path[res.path.length - 1] === go, len = 0;
    for (let i = 0; i + 1 < res.path.length; i++) { if (!lineOfSight(g, res.path[i], res.path[i + 1])) losOK = false; len += g.euclidean(res.path[i], res.path[i + 1]); }
    if (!(losOK && eq(len, res.cost) && res.cost <= opt + 1e-6 && res.cost >= straight - 1e-6)) { report.theta.fails++; if (report.theta.samples.length < 12) report.theta.samples.push(`${label} ${s}->${go} cost=${res.cost} grid=${opt} straight=${straight.toFixed(2)} los=${losOK} lenMatch=${eq(len, res.cost)}`); }
  }
}

for (const seed of [1, 2, 3]) {
  testDstar('map', generateMap({ seed, nodes: 500, cityCount: 8 }).graph, 10);
  testDstar('grid4w', generateGrid(28, 22, { seed, weighted: true, diagonal: false }).graph, 10);
  testDstar('grid8w', generateGrid(26, 20, { seed, weighted: true, diagonal: true, wallDensity: 0.1 }).graph, 10);
  testDstar('maze', generateMaze(23, 15, { seed, braid: 0.1 }).graph, 10);
  testDstar('random', generateRandomGraph(500, { seed }).graph, 10);
  testJps('grid4u', generateGrid(30, 24, { seed, weighted: false, diagonal: false, wallDensity: 0.12 }).graph, 14);
  testJps('grid8u', generateGrid(30, 24, { seed, weighted: false, diagonal: true, wallDensity: 0.12 }).graph, 14);
  testJps('grid4open', generateGrid(28, 20, { seed, weighted: false, diagonal: false }).graph, 8);
  testTheta('grid4u', generateGrid(30, 24, { seed, weighted: false, diagonal: false, wallDensity: 0.1 }).graph, 12);
  testTheta('grid8u', generateGrid(30, 24, { seed, weighted: false, diagonal: true, wallDensity: 0.1 }).graph, 12);
}

report.RESULT = report.dstar.fails + report.jps.fails + report.theta.fails === 0 ? 'ALL_PASS' : 'FAILURES';
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(report.RESULT);
process.exit(report.RESULT === 'ALL_PASS' ? 0 : 1);
