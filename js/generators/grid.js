// grid.js
// Weighted terrain grids. Every cell is a node; adjacent cells are connected
// (4- or 8-connectivity). Each cell carries a terrain cost in [0,1]; the weight
// of moving between two cells is the average terrain cost times the geometric
// step length (1 orthogonally, √2 diagonally). This is the classic "game map"
// pathfinding setup and shows weighted A* vs Dijkstra beautifully.
//
// Grid contract (renderer + app):
//   graph.kind = 'grid'
//   graph.grid = { cols, rows, diagonal:boolean }
//   graph.terrain = Float64Array(n) in [0,1]  (0 = cheap/open, 1 = costly)
//   graph.maxTerrain (for color scaling)
//   node id = r*cols + c ; x=c ; y=r
//   returns { graph, start, goal, label }

import { Graph } from '../core/graph.js';
import { RNG, clamp } from '../core/utils.js';

// Value-noise terrain via a coarse random lattice with smooth interpolation.
function valueNoise(cols, rows, rng, scale) {
  const gw = Math.max(2, Math.ceil(cols / scale) + 1);
  const gh = Math.max(2, Math.ceil(rows / scale) + 1);
  const lattice = new Float64Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
  const smooth = (t) => t * t * (3 - 2 * t); // smoothstep
  const out = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gx = c / scale;
      const gy = r / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smooth(gx - x0);
      const ty = smooth(gy - y0);
      const v00 = lattice[y0 * gw + x0];
      const v10 = lattice[y0 * gw + Math.min(gw - 1, x0 + 1)];
      const v01 = lattice[Math.min(gh - 1, y0 + 1) * gw + x0];
      const v11 = lattice[Math.min(gh - 1, y0 + 1) * gw + Math.min(gw - 1, x0 + 1)];
      const top = v00 + (v10 - v00) * tx;
      const bot = v01 + (v11 - v01) * tx;
      out[r * cols + c] = top + (bot - top) * ty;
    }
  }
  return out;
}

export function generateGrid(cols, rows, opts = {}) {
  const seed = opts.seed ?? 1;
  const diagonal = opts.diagonal ?? false;
  const weighted = opts.weighted ?? true;
  const wallDensity = opts.wallDensity ?? 0; // fraction of impassable cells
  const rng = new RNG(seed);

  const g = new Graph();
  g.kind = 'grid';
  g.grid = { cols, rows, diagonal };
  g.weightKind = 'distance';

  let terrain;
  if (weighted) {
    const noise = valueNoise(cols, rows, rng, opts.terrainScale ?? Math.max(6, cols / 8));
    terrain = new Float64Array(cols * rows);
    for (let i = 0; i < terrain.length; i++) {
      // Push to a nice range; emphasize variation a bit.
      terrain[i] = clamp(Math.pow(noise[i], 1.3), 0, 1);
    }
  } else {
    terrain = new Float64Array(cols * rows); // all 0 -> uniform weight 1
  }

  // Optional random impassable walls (marked terrain = Infinity, no edges).
  const passable = new Uint8Array(cols * rows).fill(1);
  if (wallDensity > 0) {
    for (let i = 0; i < passable.length; i++) {
      if (rng.float() < wallDensity) passable[i] = 0;
    }
  }

  g.terrain = terrain;
  g.maxTerrain = 1;
  g.passable = passable;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.addNode(c, r, null);
    }
  }

  const idx = (c, r) => r * cols + c;
  // Cost of a step is the average terrain of the two endpoints (scaled to a
  // sensible weight range 1..1+k) times the geometric length.
  const K = 9; // costliest terrain is ~10x the cheapest
  const cellCost = (i) => 1 + terrain[i] * K;
  const neighborsOrtho = [
    [1, 0],
    [0, 1],
  ];
  const neighborsDiag = [
    [1, 1],
    [1, -1],
  ];

  const addStep = (a, b, len) => {
    if (!passable[a] || !passable[b]) return;
    const w = ((cellCost(a) + cellCost(b)) / 2) * len;
    g.addEdge(a, b, w);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = idx(c, r);
      for (const [dc, dr] of neighborsOrtho) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < cols && nr < rows) addStep(a, idx(nc, nr), 1);
      }
      if (diagonal) {
        for (const [dc, dr] of neighborsDiag) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
            addStep(a, idx(nc, nr), Math.SQRT2);
          }
        }
      }
    }
  }

  // Pick start/goal as passable cells near opposite corners.
  const findPassable = (startIdx, dir) => {
    let i = startIdx;
    let guard = 0;
    while (!passable[i] && guard++ < cols * rows) i += dir;
    return clamp(i, 0, cols * rows - 1);
  };
  const start = findPassable(0, 1);
  const goal = findPassable(cols * rows - 1, -1);

  return {
    graph: g,
    start,
    goal,
    label: `${cols}×${rows} ${weighted ? 'weighted ' : ''}grid${diagonal ? ' (8-dir)' : ''}`,
  };
}
