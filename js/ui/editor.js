// editor.js — interactive editor for grid / maze scenarios.
// Lets the user paint walls and terrain weights and place start/goal by
// clicking and dragging on the canvas. It mutates the live Graph (adjacency +
// passable + terrain) and asks the renderer to repaint. Works on any graph that
// has graph.grid (kind 'grid' or 'maze'); for other kinds it stays inert.
//
//   const editor = createEditor(renderer, {
//     onMutate: () => {...},      // graph changed -> clear search/aux + re-run
//     onSetStart: (id) => {...},
//     onSetGoal:  (id) => {...},
//   });
//   editor.enable('wall'); editor.setTool('weight+'); editor.disable();

import { clamp } from '../core/utils.js';

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function createEditor(renderer, hooks = {}) {
  let tool = 'wall';
  let active = false;
  let painting = false;
  let lastCell = -1;

  const graphOf = () => renderer.graph;
  const isGridLike = () => {
    const g = graphOf();
    return g && g.grid && (g.kind === 'grid' || g.kind === 'maze');
  };

  function cellCost(g, i) {
    if (!g.terrain) return 1;
    return 1 + g.terrain[i] * (g.terrainK ?? 9);
  }
  function weightBetween(g, a, b) {
    const len = g.euclidean(a, b); // 1 (orthogonal) or √2 (diagonal) in cell coords
    return ((cellCost(g, a) + cellCost(g, b)) / 2) * len;
  }
  function adjacentCells(g, id) {
    const { cols, rows, diagonal } = g.grid;
    const c = id % cols;
    const r = (id / cols) | 0;
    const dirs = diagonal ? ORTHO.concat(DIAG) : ORTHO;
    const out = [];
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) out.push(nr * cols + nc);
    }
    return out;
  }
  function hasEdge(g, a, b) {
    return g.adj[a].some((e) => e.to === b);
  }
  function addUndirected(g, a, b, w) {
    if (hasEdge(g, a, b)) return;
    g.adj[a].push({ to: b, w });
    g.radj[b].push({ to: a, w });
    g.adj[b].push({ to: a, w });
    g.radj[a].push({ to: b, w });
    g._m += 2;
  }
  function removeIncident(g, id) {
    for (const e of g.adj[id]) {
      const v = e.to;
      g.adj[v] = g.adj[v].filter((x) => x.to !== id);
      g.radj[v] = g.radj[v].filter((x) => x.to !== id);
    }
    g._m -= g.adj[id].length * 2;
    if (g._m < 0) g._m = 0;
    g.adj[id] = [];
    g.radj[id] = [];
  }

  function ensurePassable(g) {
    if (!g.passable) g.passable = new Uint8Array(g.n).fill(1);
  }

  function blockCell(g, id) {
    ensurePassable(g);
    if (!g.passable[id]) return;
    removeIncident(g, id);
    g.passable[id] = 0;
  }
  function unblockCell(g, id) {
    ensurePassable(g);
    if (g.passable[id]) return;
    g.passable[id] = 1;
    for (const v of adjacentCells(g, id)) {
      if (g.passable[v]) addUndirected(g, id, v, weightBetween(g, id, v));
    }
  }
  function paintTerrain(g, id, delta) {
    if (!g.terrain) return;
    if (g.passable && !g.passable[id]) return;
    g.terrain[id] = clamp(g.terrain[id] + delta, 0, 1);
    // recompute incident edge weights both ways
    for (const e of g.adj[id]) {
      const w = weightBetween(g, id, e.to);
      e.w = w;
      const back = g.adj[e.to].find((x) => x.to === id);
      if (back) back.w = w;
      const rb = g.radj[id].find((x) => x.to === e.to);
      if (rb) rb.w = w;
      const rback = g.radj[e.to].find((x) => x.to === id);
      if (rback) rback.w = w;
    }
  }

  function applyAt(cell, e) {
    const g = graphOf();
    if (!g || cell < 0 || cell >= g.n) return false;
    switch (tool) {
      case 'wall':
        // drag-paint walls; modifier/right paints open
        if (e && (e.shiftKey || e.button === 2)) unblockCell(g, cell);
        else blockCell(g, cell);
        return true;
      case 'erase':
        unblockCell(g, cell);
        return true;
      case 'weight+':
        paintTerrain(g, cell, 0.18);
        return true;
      case 'weight-':
        paintTerrain(g, cell, -0.18);
        return true;
      case 'start':
        if (g.passable && !g.passable[cell]) unblockCell(g, cell);
        if (hooks.onSetStart) hooks.onSetStart(cell);
        return false; // endpoint handled by app (it repaints)
      case 'goal':
        if (g.passable && !g.passable[cell]) unblockCell(g, cell);
        if (hooks.onSetGoal) hooks.onSetGoal(cell);
        return false;
      default:
        return false;
    }
  }

  function commit() {
    renderer.rebuildBase();
    renderer.render();
    if (hooks.onMutate) hooks.onMutate();
  }

  const onDown = (e) => {
    if (!active || !isGridLike()) return;
    e.preventDefault();
    const cell = renderer.nearestNode(e.offsetX, e.offsetY);
    if (tool === 'start' || tool === 'goal') {
      applyAt(cell, e);
      return;
    }
    painting = true;
    lastCell = cell;
    if (applyAt(cell, e)) commit();
  };
  const onMove = (e) => {
    if (!active || !painting) return;
    const cell = renderer.nearestNode(e.offsetX, e.offsetY);
    if (cell === lastCell || cell < 0) return;
    lastCell = cell;
    if (applyAt(cell, e)) commit();
  };
  const onUp = () => {
    painting = false;
    lastCell = -1;
  };
  const onContext = (e) => {
    if (active) e.preventDefault(); // allow right-click to paint open
  };

  function bind() {
    const cv = renderer.canvas;
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('contextmenu', onContext);
  }
  function unbind() {
    const cv = renderer.canvas;
    cv.removeEventListener('mousedown', onDown);
    cv.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    cv.removeEventListener('contextmenu', onContext);
  }

  return {
    get active() {
      return active;
    },
    get tool() {
      return tool;
    },
    setTool(t) {
      tool = t;
    },
    available() {
      return isGridLike();
    },
    enable(t) {
      if (t) tool = t;
      if (active) return;
      active = true;
      renderer.pauseInteraction(true);
      renderer.canvas.style.cursor = 'cell';
      bind();
    },
    disable() {
      if (!active) return;
      active = false;
      renderer.pauseInteraction(false);
      renderer.canvas.style.cursor = '';
      unbind();
    },
    destroy() {
      this.disable();
    },
  };
}
