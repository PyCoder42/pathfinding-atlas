// maze.js
// Maze generators. A maze is modeled as a grid Graph where every cell is a node
// and a passage between two adjacent cells is an undirected edge of weight 1.
// Walls are simply the ABSENCE of an edge — the renderer draws a wall between
// any two grid-adjacent cells that are not connected.
//
// Contract for grid-style graphs (read by renderer + app):
//   graph.kind = 'maze'
//   graph.grid = { cols, rows }
//   node id = r * cols + c ; graph.x[id] = c ; graph.y[id] = r
//   returns { graph, start, goal, label }

import { Graph } from '../core/graph.js';
import { RNG } from '../core/utils.js';

function makeGridNodes(cols, rows) {
  const g = new Graph();
  g.kind = 'maze';
  g.grid = { cols, rows };
  g.weightKind = 'distance';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.addNode(c, r, null);
    }
  }
  return g;
}

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// Recursive backtracker (randomized DFS) — long, winding corridors.
function recursiveBacktracker(g, cols, rows, rng) {
  const idx = (c, r) => r * cols + c;
  const visited = new Uint8Array(cols * rows);
  const stack = [[rng.int(0, cols - 1), rng.int(0, rows - 1)]];
  visited[idx(stack[0][0], stack[0][1])] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const opts = [];
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[idx(nc, nr)]) {
        opts.push([nc, nr]);
      }
    }
    if (opts.length === 0) {
      stack.pop();
      continue;
    }
    const [nc, nr] = rng.pick(opts);
    g.addEdge(idx(c, r), idx(nc, nr), 1);
    visited[idx(nc, nr)] = 1;
    stack.push([nc, nr]);
  }
}

// Randomized Prim's — more uniform, "bushy" texture with many short branches.
function prim(g, cols, rows, rng) {
  const idx = (c, r) => r * cols + c;
  const inMaze = new Uint8Array(cols * rows);
  const sc = rng.int(0, cols - 1);
  const sr = rng.int(0, rows - 1);
  inMaze[idx(sc, sr)] = 1;
  const walls = [];
  const pushWalls = (c, r) => {
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !inMaze[idx(nc, nr)]) {
        walls.push([c, r, nc, nr]);
      }
    }
  };
  pushWalls(sc, sr);
  while (walls.length) {
    const wi = rng.int(0, walls.length - 1);
    const [c, r, nc, nr] = walls[wi];
    walls.splice(wi, 1);
    if (inMaze[idx(nc, nr)]) continue;
    g.addEdge(idx(c, r), idx(nc, nr), 1);
    inMaze[idx(nc, nr)] = 1;
    pushWalls(nc, nr);
  }
}

// Carve a few extra passages so the maze has loops / multiple solutions —
// makes algorithm comparison far more interesting (otherwise every algorithm
// finds the single unique path).
function addBraids(g, cols, rows, rng, fraction) {
  const idx = (c, r) => r * cols + c;
  const connected = (a, b) => g.adj[a].some((e) => e.to === b);
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !connected(idx(c, r), idx(c + 1, r))) {
        candidates.push([idx(c, r), idx(c + 1, r)]);
      }
      if (r + 1 < rows && !connected(idx(c, r), idx(c, r + 1))) {
        candidates.push([idx(c, r), idx(c, r + 1)]);
      }
    }
  }
  rng.shuffle(candidates);
  const count = Math.floor(candidates.length * fraction);
  for (let i = 0; i < count; i++) {
    const [a, b] = candidates[i];
    g.addEdge(a, b, 1);
  }
}

export function generateMaze(cols, rows, opts = {}) {
  const seed = opts.seed ?? 1;
  const algorithm = opts.algorithm || 'backtracker';
  const braid = opts.braid ?? 0.08; // fraction of walls to remove for loops
  const rng = new RNG(seed);
  const g = makeGridNodes(cols, rows);

  if (algorithm === 'prim') {
    prim(g, cols, rows, rng);
  } else {
    recursiveBacktracker(g, cols, rows, rng);
  }
  if (braid > 0) addBraids(g, cols, rows, rng, braid);

  const start = 0; // top-left
  const goal = cols * rows - 1; // bottom-right
  return {
    graph: g,
    start,
    goal,
    label: `${cols}×${rows} maze (${algorithm})`,
  };
}
