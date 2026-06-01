// theta-star.js
// Theta* — ANY-ANGLE pathfinding on a grid.
//
// A* on a grid can only ever produce paths that travel along grid edges
// (multiples of 45°), so the routes it finds look jagged and are longer than the
// true shortest route through open space. Theta* fixes this. It runs almost
// exactly like A*, but when it relaxes a neighbour it asks one extra question:
// "can my PARENT see this neighbour in a straight line?" If yes, it skips the
// current node entirely and connects the neighbour directly to the parent. The
// result is a path made of straight line segments at ANY angle — shorter and
// more natural than a grid-locked A* path.
//
//   ── Standard A* ──         ── Theta* ──
//   start                     start
//     │  ┌──┐                   \
//     └──┘  │                    \____
//           goal                      goal
//
// The two ingredients:
//   1. g[v] is the true straight-line (Euclidean) length of the any-angle path
//      from start to v — NOT the grid-step distance.
//   2. lineOfSight(a, b): true iff a clear straight line can be drawn from cell
//      a to cell b, i.e. every grid cell the segment passes through is passable.
//
// Path update when relaxing neighbour v of the just-settled node u:
//   • Path 2 (any-angle): if lineOfSight(parent[u], v), connect v straight to
//     parent[u] with g = g[parent[u]] + euclidean(parent[u], v).
//   • Path 1 (grid step):  otherwise connect v to u with
//     g = g[u] + euclidean(u, v).
// Keep whichever gives the smaller g. Priority key = g + euclidean(v, goal),
// the same admissible straight-line heuristic A* uses.
//
// The returned path is the sequence of TURN POINTS (start, goal, and any cell
// where the direction changes). The renderer joins consecutive turn points with
// straight lines, which is exactly the any-angle route. cost is the sum of the
// Euclidean distances between consecutive turn points.

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath } from './common.js';

export function* thetaStar(graph, start, goal, opts = {}) {
  // Theta* is a grid algorithm: it needs cell coordinates and a passability map
  // to run line-of-sight tests. Without a grid there is nothing to do.
  if (!graph.grid) {
    yield {
      type: 'info',
      message: 'theta* requires a grid graph (graph.grid is missing)',
    };
    return { path: null, cost: Infinity, stats: withPath(makeStats(), null) };
  }

  const n = graph.n;
  const { cols, rows } = graph.grid;
  // passable[id] === 1 means the cell can be entered. Treat a missing map as
  // "everything passable" so the algorithm still works on open grids.
  const passable = graph.passable;
  const isPassable = (id) => !passable || passable[id] === 1;

  // ── Line-of-sight test ────────────────────────────────────────────────────
  // Supercover variant of Bresenham's line algorithm: walk a grid line from
  // cell a to cell b and require EVERY cell it touches to be passable. Unlike
  // plain Bresenham this also rejects lines that try to "squeeze" diagonally
  // between two blocked cells, so the straight segment is genuinely traversable.
  const lineOfSight = (aId, bId) => {
    if (!isPassable(aId) || !isPassable(bId)) return false;

    let x0 = graph.x[aId]; // column
    let y0 = graph.y[aId]; // row
    const x1 = graph.x[bId];
    const y1 = graph.y[bId];

    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;

    // The endpoints are already known passable; the loop checks the cells in
    // between (including b's cell on the final step).
    let err = dx - dy;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      const stepX = e2 > -dy;
      const stepY = e2 < dx;

      if (stepX && stepY) {
        // Pure diagonal move: also forbid cutting the corner between the two
        // orthogonally-adjacent cells, otherwise the line would clip a wall.
        const cornerA = (y0) * cols + (x0 + sx);
        const cornerB = (y0 + sy) * cols + (x0);
        if (!isPassable(cornerA) || !isPassable(cornerB)) return false;
        err -= dy;
        err += dx;
        x0 += sx;
        y0 += sy;
      } else if (stepX) {
        err -= dy;
        x0 += sx;
      } else {
        err += dx;
        y0 += sy;
      }

      if (!isPassable(y0 * cols + x0)) return false;
    }
    return true;
  };

  // ── Search state ────────────────────────────────────────────────────────
  const g = new Float64Array(n);
  g.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const settled = new Uint8Array(n);

  const stats = makeStats();
  const pq = new MinHeap();

  const h = (v) => graph.euclidean(v, goal); // straight-line heuristic

  // Handle the degenerate start === goal case before entering the loop.
  if (start === goal) {
    const path = [start];
    yield { type: 'found', path, cost: 0 };
    return { path, cost: 0, dist: g, parent, stats: withPath(stats, path) };
  }

  g[start] = 0;
  parent[start] = start; // start is its own parent so the any-angle check works
  pq.push(start, h(start));
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (settled[u]) continue; // stale heap entry (lazy deletion)
    settled[u] = 1;
    stats.settled++;
    yield { type: 'settle', node: u, dist: g[u] };

    if (u === goal) break;

    // Relax each grid neighbour. We use the graph's adjacency only to enumerate
    // neighbours; the edge weight is ignored because g is Euclidean length.
    for (const { to: v } of graph.neighbors(u)) {
      if (settled[v]) continue;
      stats.relaxations++;

      // ── The Theta* update ──────────────────────────────────────────────
      // Path 2: try to connect v straight to u's parent (any-angle shortcut).
      const gp = parent[u];
      let candParent;
      let candG;
      if (gp !== -1 && lineOfSight(gp, v)) {
        candParent = gp;
        candG = g[gp] + graph.euclidean(gp, v);
      } else {
        // Path 1: fall back to the grid step through u.
        candParent = u;
        candG = g[u] + graph.euclidean(u, v);
      }

      if (candG < g[v]) {
        g[v] = candG;
        parent[v] = candParent;
        pq.push(v, candG + h(v)); // priority = g + straight-line heuristic
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: v, dist: candG, parent: candParent };
      }
    }
  }

  // ── Reconstruct the any-angle path of turn points ──────────────────────────
  // The parent chain already encodes the any-angle path: because of the path-2
  // shortcuts, consecutive parents are exactly the turn points (cells where the
  // straight-line direction changes). We just walk parent[] from goal to start.
  let path = null;
  let cost = Infinity;
  if (Number.isFinite(g[goal])) {
    const rev = [];
    let cur = goal;
    let guard = 0;
    const limit = n + 1;
    while (cur !== -1) {
      rev.push(cur);
      if (cur === start) break;
      cur = parent[cur];
      if (++guard > limit) {
        rev.length = 0;
        break;
      }
    }
    if (rev.length && rev[rev.length - 1] === start) {
      rev.reverse();
      path = rev;
      // cost = total Euclidean length of the any-angle path (turn point to
      // turn point), NOT the grid-step cost.
      cost = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        cost += graph.euclidean(path[i], path[i + 1]);
      }
    }
  }

  yield { type: 'found', path, cost };

  return {
    path,
    cost,
    dist: g,
    parent,
    stats: withPath(stats, path),
  };
}
