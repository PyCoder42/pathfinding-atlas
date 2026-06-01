import { generateGrid } from './js/generators/grid.js';
import { thetaStar } from './js/algorithms/theta-star.js';

const drain = (g) => { let r = g.next(); while (!r.done) r = g.next(); return r.value; };

// Reproduce LOS exactly as the algorithm does
function makeLOS(graph) {
  const { cols } = graph.grid; const P = graph.passable; const isP = (id) => !P || P[id] === 1;
  return (aId, bId) => {
    if (!isP(aId) || !isP(bId)) return false;
    let x0 = graph.x[aId], y0 = graph.y[aId]; const x1 = graph.x[bId], y1 = graph.y[bId];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err; const stepX = e2 > -dy, stepY = e2 < dx;
      if (stepX && stepY) {
        const cornerA = y0 * cols + (x0 + sx); const cornerB = (y0 + sy) * cols + x0;
        if (!isP(cornerA) || !isP(cornerB)) return false;
        err -= dy; err += dx; x0 += sx; y0 += sy;
      } else if (stepX) { err -= dy; x0 += sx; } else { err += dx; y0 += sy; }
      if (!isP(y0 * cols + x0)) return false;
    }
    return true;
  };
}

const cfg = { cols: 30, rows: 30, seed: 1, diagonal: true, weighted: false, wallDensity: 0.15 };
const { graph, start, goal } = generateGrid(cfg.cols, cfg.rows, cfg);
const los = makeLOS(graph);
const th = drain(thetaStar(graph, start, goal));
console.log('path:', th.path.join(' '));
for (let i = 0; i + 1 < th.path.length; i++) {
  const a = th.path[i], b = th.path[i + 1];
  const good = los(a, b);
  if (!good) {
    console.log(`BAD SEG ${a}(${graph.x[a]},${graph.y[a]}) -> ${b}(${graph.x[b]},${graph.y[b]})  passableA=${graph.passable[a]} passableB=${graph.passable[b]}`);
  }
}
