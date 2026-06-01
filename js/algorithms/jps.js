// jps.js
// Jump Point Search (JPS) — an optimization of A* for UNIFORM-COST grids.
//
// On an open grid, plain A* wastes enormous effort expanding the huge number of
// symmetric paths between two points (all the zig-zags of the same length look
// equally good). JPS kills that symmetry. Instead of stepping to every adjacent
// cell, from a node it "jumps" in a straight line along each allowed direction,
// skipping over every cell that has no reason to be a turning point, and only
// stops at "jump points": the goal, or a cell with a FORCED neighbour (a cell
// that is only reachable cheaply by turning here, because a wall blocks the
// straight-line alternative). Those jump points are the only nodes pushed onto
// the open set, ordered by f = g + h exactly like A*.
//
// Because it never reorders moves, JPS returns a path with the SAME optimal cost
// as Dijkstra/A* on the same uniform grid — it just touches far fewer nodes.
//
// IMPORTANT: JPS is only correct on grids where every orthogonal step costs the
// same and every diagonal step costs the same (here: 1 and √2). The app guards
// this elsewhere; we assume graph.grid exists. Movement cost is purely the
// geometric step length, so we read the grid directly via graph.passable rather
// than the (possibly terrain-weighted) edges in graph.neighbors().
//
// The app's grids (see generators/grid.js) connect every in-bounds diagonal
// neighbour, i.e. they ALLOW "corner cutting" past a single blocked cell. To
// stay cost-identical to Dijkstra on that exact graph, this JPS therefore also
// permits corner cutting on diagonal grids (no extra corner test).

import { MinHeap } from '../core/priority-queue.js';
import { makeStats, withPath } from './common.js';

export function* jps(graph, start, goal, opts = {}) {
  // ── Fallback: JPS is a grid-only algorithm. ──────────────────────────────
  if (!graph.grid) {
    yield { type: 'info', message: 'JPS requires a grid' };
    return { path: null, cost: Infinity, stats: withPath(makeStats(), null) };
  }

  const cols = graph.grid.cols;
  const rows = graph.grid.rows;
  const diagonal = !!graph.grid.diagonal;
  const n = graph.n;

  // passable[id] === 0 means a wall. If absent, treat every cell as open.
  const passable = graph.passable;
  const SQRT2 = Math.SQRT2;

  // Grid helpers. Node id = r*cols + c, with x = c (column) and y = r (row).
  const inBounds = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
  const walkable = (c, r) => {
    if (!inBounds(c, r)) return false;
    if (!passable) return true;
    return passable[r * cols + c] !== 0;
  };
  const id = (c, r) => r * cols + c;
  const colOf = (node) => node % cols;
  const rowOf = (node) => (node - (node % cols)) / cols;

  const gx = colOf(goal);
  const gy = rowOf(goal);

  // Octile distance (diagonal grids) or Manhattan (4-connected). Both are
  // admissible lower bounds on the true uniform-grid cost to the goal.
  const h = (c, r) => {
    const dx = Math.abs(c - gx);
    const dy = Math.abs(r - gy);
    if (diagonal) {
      // straight-line over the grid: SQRT2 per diagonal step + 1 per leftover
      return (dx < dy ? dx : dy) * SQRT2 + Math.abs(dx - dy);
    }
    return dx + dy;
  };

  // ── State (same typed-array conventions as the other algorithms). ────────
  const g = new Float64Array(n);
  g.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const closed = new Uint8Array(n); // expanded jump points

  const stats = makeStats();
  const pq = new MinHeap();

  // ── start === goal short-circuit. ────────────────────────────────────────
  if (start === goal) {
    const path = [start];
    yield { type: 'settle', node: start, dist: 0 };
    yield { type: 'found', path, cost: 0 };
    return { path, cost: 0, dist: g, parent, stats: withPath(stats, path) };
  }

  g[start] = 0;
  pq.push(start, h(colOf(start), rowOf(start)));
  stats.pushes++;
  stats.discovered++;
  stats.maxFrontier = 1;

  // ── Jumping core ─────────────────────────────────────────────────────────
  // From (cx,cy), step repeatedly by (dx,dy). Return the id of the jump point
  // found in that direction, or -1 if we leave the grid / hit a wall first.
  // The forced-neighbour rules differ between 8- and 4-connected grids.
  function jump(cx, cy, dx, dy) {
    return diagonal ? jumpDiag(cx, cy, dx, dy) : jumpOrtho4(cx, cy, dx, dy);
  }

  // 8-connected jump (orthogonal OR diagonal step). Corner cutting is allowed,
  // matching the app's grid edges, so there is no "both flanks blocked" abort.
  function jumpDiag(cx, cy, dx, dy) {
    let x = cx;
    let y = cy;
    while (true) {
      x += dx;
      y += dy;
      if (!walkable(x, y)) return -1; // wall or grid edge

      if (id(x, y) === goal) return id(x, y); // always stop at the goal

      if (dx !== 0 && dy !== 0) {
        // ── Diagonal move. ──
        // Forced neighbour: a side cell is blocked but the cell diagonally past
        // it is open, so a turn here could be optimal.
        if (
          (!walkable(x - dx, y) && walkable(x - dx, y + dy)) ||
          (!walkable(x, y - dy) && walkable(x + dx, y - dy))
        ) {
          return id(x, y);
        }
        // Probe both orthogonal components; if either finds a jump point, THIS
        // cell is a jump point (the classic JPS diagonal recursion).
        if (jumpDiag(x, y, dx, 0) !== -1 || jumpDiag(x, y, 0, dy) !== -1) {
          return id(x, y);
        }
      } else if (dx !== 0) {
        // ── Horizontal move. ── Forced neighbour above/below a just-ended wall.
        if (
          (!walkable(x, y + 1) && walkable(x + dx, y + 1)) ||
          (!walkable(x, y - 1) && walkable(x + dx, y - 1))
        ) {
          return id(x, y);
        }
      } else {
        // ── Vertical move. ──
        if (
          (!walkable(x + 1, y) && walkable(x + 1, y + dy)) ||
          (!walkable(x - 1, y) && walkable(x - 1, y + dy))
        ) {
          return id(x, y);
        }
      }
      // Otherwise keep sliding in the same direction.
    }
  }

  // 4-connected jump (orthogonal steps only). A cell reached travelling along
  // the primary axis is a jump point if a turn onto the perpendicular axis is
  // "forced": the perpendicular neighbour was blocked at the previous cell but
  // is open here (an obstacle just ended). This is a pure straight scan with no
  // cross-axis recursion, so it always terminates.
  function jumpOrtho4(cx, cy, dx, dy) {
    let x = cx;
    let y = cy;
    while (true) {
      const px = x;
      const py = y;
      x += dx;
      y += dy;
      if (!walkable(x, y)) return -1; // wall or grid edge

      if (id(x, y) === goal) return id(x, y); // always stop at the goal

      if (dx !== 0) {
        // Horizontal scan: a forced turn opens when a vertical neighbour was
        // blocked at the previous column but is open at this column.
        if (
          (walkable(x, y + 1) && !walkable(px, y + 1)) ||
          (walkable(x, y - 1) && !walkable(px, y - 1))
        ) {
          return id(x, y);
        }
      } else {
        // Vertical scan: symmetric with horizontal neighbours.
        if (
          (walkable(x + 1, y) && !walkable(x + 1, py)) ||
          (walkable(x - 1, y) && !walkable(x - 1, py))
        ) {
          return id(x, y);
        }
      }
      // Otherwise keep sliding along the primary axis.
    }
  }

  // Directions to explore from a node, pruned by the direction we arrived from.
  // The start has no parent, so it explores every allowed direction. For other
  // nodes we emit the natural successors implied by the travel direction plus
  // the forced ones created by adjacent walls.
  function successors(node) {
    const cx = colOf(node);
    const cy = rowOf(node);
    const dirs = [];

    if (parent[node] === -1) {
      // Start node: try every allowed direction.
      dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      if (diagonal) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      return { cx, cy, dirs };
    }

    // Travel direction from parent into this node, normalized to {-1,0,1}.
    const px = colOf(parent[node]);
    const py = rowOf(parent[node]);
    const dx = Math.sign(cx - px);
    const dy = Math.sign(cy - py);

    if (diagonal && dx !== 0 && dy !== 0) {
      // Diagonal travel: natural successors are the two orthogonal components
      // and the continuing diagonal; plus forced diagonals around blocked sides.
      dirs.push([0, dy], [dx, 0], [dx, dy]);
      if (!walkable(cx - dx, cy) && walkable(cx - dx, cy + dy)) dirs.push([-dx, dy]);
      if (!walkable(cx, cy - dy) && walkable(cx + dx, cy - dy)) dirs.push([dx, -dy]);
    } else if (dx !== 0) {
      // Horizontal travel.
      dirs.push([dx, 0]); // natural: keep going straight
      if (diagonal) {
        // Forced diagonal turns where a vertical neighbour is blocked.
        if (!walkable(cx, cy + 1) && walkable(cx + dx, cy + 1)) dirs.push([dx, 1]);
        if (!walkable(cx, cy - 1) && walkable(cx + dx, cy - 1)) dirs.push([dx, -1]);
      } else {
        // 4-connected: turn only where an obstacle just ended (forced turn).
        if (walkable(cx, cy + 1) && !walkable(cx - dx, cy + 1)) dirs.push([0, 1]);
        if (walkable(cx, cy - 1) && !walkable(cx - dx, cy - 1)) dirs.push([0, -1]);
      }
    } else {
      // Vertical travel.
      dirs.push([0, dy]); // natural: keep going straight
      if (diagonal) {
        if (!walkable(cx + 1, cy) && walkable(cx + 1, cy + dy)) dirs.push([1, dy]);
        if (!walkable(cx - 1, cy) && walkable(cx - 1, cy + dy)) dirs.push([-1, dy]);
      } else {
        if (walkable(cx + 1, cy) && !walkable(cx + 1, cy - dy)) dirs.push([1, 0]);
        if (walkable(cx - 1, cy) && !walkable(cx - 1, cy - dy)) dirs.push([-1, 0]);
      }
    }
    return { cx, cy, dirs };
  }

  // True step cost between two cells on a straight (ortho/diag) line: the number
  // of king-moves between them times the per-step length.
  const segmentCost = (ax, ay, bx, by) => {
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const diag = Math.min(dx, dy);
    const straight = Math.abs(dx - dy);
    return diag * SQRT2 + straight;
  };

  // ── Main A*-over-jump-points loop. ───────────────────────────────────────
  let found = false;
  while (!pq.isEmpty()) {
    const u = pq.pop();
    if (closed[u]) continue; // stale heap entry (lazy deletion)
    closed[u] = 1;
    stats.settled++;
    yield { type: 'settle', node: u, dist: g[u] };

    if (u === goal) {
      found = true;
      break;
    }

    const { cx, cy, dirs } = successors(u);
    for (const [dx, dy] of dirs) {
      stats.relaxations++;
      const j = jump(cx, cy, dx, dy);
      if (j === -1) continue;
      if (closed[j]) continue;

      const jx = colOf(j);
      const jy = rowOf(j);
      const ng = g[u] + segmentCost(cx, cy, jx, jy);
      if (ng < g[j]) {
        g[j] = ng;
        parent[j] = u;
        pq.push(j, ng + h(jx, jy)); // priority = f = g + h
        stats.pushes++;
        stats.discovered++;
        if (pq.size > stats.maxFrontier) stats.maxFrontier = pq.size;
        yield { type: 'discover', node: j, dist: ng, parent: u };
      }
    }
  }

  // ── Reconstruct & EXPAND the path. ───────────────────────────────────────
  // The parent chain holds only jump points, so we expand each straight segment
  // into its intermediate adjacent cells. This yields a continuous chain of
  // neighbouring grid cells whose total cost equals Dijkstra's optimum.
  const path = found && Number.isFinite(g[goal]) ? expandPath() : null;
  const cost = path ? g[goal] : Infinity;

  yield { type: 'found', path: path || [], cost: Number.isFinite(cost) ? cost : Infinity };

  return {
    path: path && path.length ? path : null,
    cost: Number.isFinite(cost) ? cost : Infinity,
    dist: g,
    parent,
    stats: withPath(stats, path),
  };

  function expandPath() {
    // Collect jump points goal -> start, then reverse to start -> goal.
    const jumpPoints = [];
    let cur = goal;
    let guard = 0;
    while (cur !== -1) {
      jumpPoints.push(cur);
      if (cur === start) break;
      cur = parent[cur];
      if (++guard > n + 1) return null; // cycle guard
    }
    if (jumpPoints[jumpPoints.length - 1] !== start) return null;
    jumpPoints.reverse();

    const full = [start];
    for (let i = 1; i < jumpPoints.length; i++) {
      const a = jumpPoints[i - 1];
      const b = jumpPoints[i];
      let ax = colOf(a);
      let ay = rowOf(a);
      const bx = colOf(b);
      const by = rowOf(b);
      const sx = Math.sign(bx - ax);
      const sy = Math.sign(by - ay);
      // Step one cell at a time along the straight segment toward b.
      while (ax !== bx || ay !== by) {
        ax += sx;
        ay += sy;
        full.push(id(ax, ay));
      }
    }
    return full;
  }
}
