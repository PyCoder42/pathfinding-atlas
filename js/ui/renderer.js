// renderer.js
// Canvas renderer for both the map and the abstract-graph sections.
//
// Performance model (so it stays smooth on large graphs):
//   - The static graph (roads / grid cells / network edges) is drawn ONCE into
//     an offscreen "base" canvas whenever the view changes (pan/zoom/resize).
//   - Search progress is drawn incrementally into an offscreen "overlay"
//     canvas: applyEvent() just records state + queues the changed node; each
//     render() only repaints the nodes that changed since the last frame.
//   - A frame = blit(base) + blit(overlay) + draw(path) + draw(markers).
//
// This means animating a search that touches 100k nodes never redraws the whole
// graph per frame — only the handful of cells/nodes that changed.

import { heatColor, mixHex, clamp } from '../core/utils.js';

const PALETTE = {
  bg: '#0e1320',
  gridCell: '#161d2e',
  gridLine: '#0b1018',
  wall: '#0a0e17',
  edge: 'rgba(120,140,180,0.16)',
  node: 'rgba(150,170,210,0.55)',
  // road classes (map)
  highway: '#e0b341',
  arterial: '#8aa0c8',
  local: '#3c4a66',
  city: '#ffd98a',
  town: '#9fb4dd',
  pathGlow: 'rgba(255,247,200,0.9)',
  pathCore: '#fff6cc',
  start: '#36d399',
  goal: '#ff6b6b',
};

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graph = null;
    this.style = 'network';

    this.viewport = { scale: 1, originX: 0, originY: 0 };
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._cssW = 1;
    this._cssH = 1;

    this._base = document.createElement('canvas');
    this._baseCtx = this._base.getContext('2d');
    this._overlay = document.createElement('canvas');
    this._overlayCtx = this._overlay.getContext('2d');

    // search state
    this.status = null; // Uint8Array: 0 none, 1 frontier, 2 settled, 3 path
    this.dir = null;    // Uint8Array: 1 forward, 2 backward, 3 both
    this.val = null;    // Float64Array: distance/order for heatmap
    this.maxVal = 1;
    this._touched = [];
    this._dirty = [];
    this._fullRepaint = false;

    this.path = null;
    this.start = -1;
    this.goal = -1;
    this.hover = -1;
    this.annotations = null; // CH/CCH preprocessing overlay (shortcuts + ranks)

    this.colors = { fwd: '#4f86f7', bwd: '#f5a623', path: PALETTE.pathCore };
    this.options = {
      heatmap: false,
      showFrontier: true,
      showEdges: true,
      showLabels: true,
      compact: false, // small-multiples mode (lighter drawing)
    };

    this._index = null; // spatial hash for hit-testing (non-grid)
    this._interaction = null;
    this._interactionPaused = false; // editor pauses pan/click while painting
  }

  // Pause pan/click handling (wheel-zoom still works) — used by the editor so
  // dragging paints cells instead of panning the view.
  pauseInteraction(paused) {
    this._interactionPaused = paused;
  }

  setGraph(graph) {
    this.graph = graph;
    this.style = graph.kind || 'network';
    const n = graph.n;
    this.status = new Uint8Array(n);
    this.dir = new Uint8Array(n);
    this.val = new Float64Array(n);
    this._touched = [];
    this._dirty = [];
    this.path = null;
    this.maxVal = 1;
    if (this.style !== 'grid' && this.style !== 'maze') this._buildIndex();
    this.resize();
    this.fitView();
  }

  _buildIndex() {
    const g = this.graph;
    const b = g.bounds();
    const cell = Math.max(1e-6, Math.max(b.maxX - b.minX, b.maxY - b.minY) / Math.sqrt(g.n + 1));
    const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell) + 1);
    const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell) + 1);
    const buckets = new Map();
    const keyOf = (cx, cy) => cx + cy * cols;
    for (let i = 0; i < g.n; i++) {
      const cx = Math.floor((g.x[i] - b.minX) / cell);
      const cy = Math.floor((g.y[i] - b.minY) / cell);
      const k = keyOf(cx, cy);
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(i);
    }
    this._index = { b, cell, cols, rows, buckets, keyOf };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this._cssW = Math.max(1, Math.floor(rect.width));
    this._cssH = Math.max(1, Math.floor(rect.height));
    const dpr = this._dpr;
    for (const cv of [this.canvas, this._base, this._overlay]) {
      cv.width = this._cssW * dpr;
      cv.height = this._cssH * dpr;
    }
    this.canvas.style.imageRendering = 'auto';
    this._fullRepaint = true;
    this.rebuildBase();
    this.render();
  }

  fitView() {
    if (!this.graph) return;
    const b = this.graph.bounds();
    let bw = b.maxX - b.minX || 1;
    let bh = b.maxY - b.minY || 1;
    // pad
    const padX = bw * 0.06 + (this.style === 'grid' || this.style === 'maze' ? 1 : 0);
    const padY = bh * 0.06 + (this.style === 'grid' || this.style === 'maze' ? 1 : 0);
    bw += padX * 2;
    bh += padY * 2;
    const scale = Math.min(this._cssW / bw, this._cssH / bh);
    this.viewport.scale = scale;
    this.viewport.originX = b.minX - padX - (this._cssW / scale - bw) / 2;
    this.viewport.originY = b.minY - padY - (this._cssH / scale - bh) / 2;
    this._fullRepaint = true;
    this.rebuildBase();
    this.render();
  }

  worldToScreen(wx, wy) {
    const v = this.viewport;
    return [(wx - v.originX) * v.scale, (wy - v.originY) * v.scale];
  }
  screenToWorld(sx, sy) {
    const v = this.viewport;
    return [sx / v.scale + v.originX, sy / v.scale + v.originY];
  }

  // ── base layer ────────────────────────────────────────────────────────────
  rebuildBase() {
    if (!this.graph) return;
    const ctx = this._baseCtx;
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._cssW, this._cssH);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this._cssW, this._cssH);

    if (this.style === 'maze') this._drawMazeBase(ctx);
    else if (this.style === 'grid') this._drawGridBase(ctx);
    else this._drawNetworkBase(ctx);
  }

  _cellRectScreen(c, r) {
    const [sx, sy] = this.worldToScreen(c - 0.5, r - 0.5);
    const s = this.viewport.scale;
    return [sx, sy, s, s];
  }

  _drawGridBase(ctx) {
    const g = this.graph;
    const { cols, rows } = g.grid;
    const s = this.viewport.scale;
    const drawLines = s > 6 && cols * rows < 40000;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c;
        const [x, y, w, h] = this._cellRectScreen(c, r);
        if (x + w < 0 || y + h < 0 || x > this._cssW || y > this._cssH) continue;
        if (g.passable && !g.passable[id]) {
          ctx.fillStyle = PALETTE.wall;
        } else if (g.terrain) {
          const t = g.terrain[id];
          ctx.fillStyle = mixHex('#1b2740', '#5e708f', t);
        } else {
          ctx.fillStyle = PALETTE.gridCell;
        }
        ctx.fillRect(x, y, Math.ceil(w), Math.ceil(h));
        if (drawLines) {
          ctx.strokeStyle = PALETTE.gridLine;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, w, h);
        }
      }
    }
  }

  _drawMazeBase(ctx) {
    const g = this.graph;
    const { cols, rows } = g.grid;
    const s = this.viewport.scale;
    // floor
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [x, y, w, h] = this._cellRectScreen(c, r);
        if (x + w < 0 || y + h < 0 || x > this._cssW || y > this._cssH) continue;
        ctx.fillStyle = PALETTE.gridCell;
        ctx.fillRect(x, y, Math.ceil(w), Math.ceil(h));
      }
    }
    // walls = absent passages
    ctx.strokeStyle = '#5a6b8c';
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.lineCap = 'round';
    const connected = (a, b) => g.adj[a].some((e) => e.to === b);
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c;
        const [x, y] = this.worldToScreen(c - 0.5, r - 0.5);
        const right = x + s;
        const bottom = y + s;
        // top & left borders of the grid
        if (r === 0) { ctx.moveTo(x, y); ctx.lineTo(right, y); }
        if (c === 0) { ctx.moveTo(x, y); ctx.lineTo(x, bottom); }
        // right wall
        if (c + 1 >= cols || !connected(id, id + 1)) { ctx.moveTo(right, y); ctx.lineTo(right, bottom); }
        // bottom wall
        if (r + 1 >= rows || !connected(id, id + cols)) { ctx.moveTo(x, bottom); ctx.lineTo(right, bottom); }
      }
    }
    ctx.stroke();
  }

  _drawNetworkBase(ctx) {
    const g = this.graph;
    const isMap = this.style === 'map';
    if (this.options.showEdges) {
      const s = this.viewport.scale;
      if (isMap) {
        // draw by class so highways sit on top and are thicker
        const classes = [
          ['local', PALETTE.local, 0.6],
          ['arterial', PALETTE.arterial, 1.1],
          ['highway', PALETTE.highway, 1.8],
        ];
        for (const [cls, color, baseW] of classes) {
          ctx.strokeStyle = color;
          ctx.lineWidth = clamp(baseW * Math.sqrt(s), 0.4, 6);
          ctx.globalAlpha = cls === 'local' ? 0.5 : 0.85;
          ctx.beginPath();
          for (let u = 0; u < g.n; u++) {
            for (const e of g.adj[u]) {
              if (e.to < u) continue; // undirected: draw once
              if ((e.cls || 'local') !== cls) continue;
              const [ax, ay] = this.worldToScreen(g.x[u], g.y[u]);
              const [bx, by] = this.worldToScreen(g.x[e.to], g.y[e.to]);
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
            }
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = PALETTE.edge;
        ctx.lineWidth = clamp(0.6 * Math.sqrt(s), 0.3, 2);
        ctx.beginPath();
        for (let u = 0; u < g.n; u++) {
          for (const e of g.adj[u]) {
            if (e.to < u) continue;
            const [ax, ay] = this.worldToScreen(g.x[u], g.y[u]);
            const [bx, by] = this.worldToScreen(g.x[e.to], g.y[e.to]);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
        }
        ctx.stroke();
      }
    }

    // nodes
    const s = this.viewport.scale;
    if (isMap) {
      for (let i = 0; i < g.n; i++) {
        const m = g.meta[i];
        const kind = m && m.kind;
        if (kind !== 'city' && kind !== 'town') continue;
        const [x, y] = this.worldToScreen(g.x[i], g.y[i]);
        const rad = kind === 'city' ? clamp(4 * Math.sqrt(s), 3, 9) : clamp(2.4 * Math.sqrt(s), 2, 5);
        ctx.beginPath();
        ctx.fillStyle = kind === 'city' ? PALETTE.city : PALETTE.town;
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.stroke();
      }
      if (this.options.showLabels) {
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < g.n; i++) {
          const m = g.meta[i];
          if (!m || m.kind !== 'city') continue;
          const [x, y] = this.worldToScreen(g.x[i], g.y[i]);
          if (x < -40 || y < 0 || x > this._cssW + 40 || y > this._cssH) continue;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillText(m.name, x + 8 + 1, y + 1);
          ctx.fillStyle = '#ffe9b8';
          ctx.fillText(m.name, x + 8, y);
        }
      }
    } else if (!this.options.compact || s > 4) {
      ctx.fillStyle = PALETTE.node;
      const rad = clamp(0.9 * Math.sqrt(s), 0.6, 3);
      for (let i = 0; i < g.n; i++) {
        const [x, y] = this.worldToScreen(g.x[i], g.y[i]);
        if (x < 0 || y < 0 || x > this._cssW || y > this._cssH) continue;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── search state ────────────────────────────────────────────────────────
  resetSearch() {
    if (!this.graph) return;
    this.status.fill(0);
    this.dir.fill(0);
    this.val.fill(0);
    this.maxVal = 1;
    this._touched.length = 0;
    this._dirty.length = 0;
    this.path = null;
    this._fullRepaint = true;
  }

  applyEvent(ev) {
    const n = this.graph.n;
    const mark = (node, st, d, value) => {
      if (node < 0 || node >= n) return;
      if (this.status[node] === 0) this._touched.push(node);
      // path > settled > frontier precedence
      if (st >= this.status[node] || st === 3) this.status[node] = st;
      if (d) this.dir[node] |= d === 'f' ? 1 : 2;
      if (value !== undefined && Number.isFinite(value)) {
        this.val[node] = value;
        if (value > this.maxVal) this.maxVal = value;
      }
      this._dirty.push(node);
    };
    switch (ev.type) {
      case 'discover':
        mark(ev.node, this.status[ev.node] === 2 ? 2 : 1, ev.dir, ev.dist);
        break;
      case 'settle':
        mark(ev.node, 2, ev.dir, ev.dist);
        break;
      case 'meet':
        mark(ev.node, 2, ev.dir, undefined);
        break;
      default:
        break;
    }
  }

  setPath(path) {
    this.path = path && path.length ? path : null;
    if (this.path) {
      for (const id of this.path) {
        if (this.status[id] === 0) this._touched.push(id);
        this.status[id] = 3;
        this._dirty.push(id);
      }
    }
  }

  setEndpoints(start, goal) {
    this.start = start;
    this.goal = goal;
  }

  setColors({ fwd, bwd, path } = {}) {
    if (fwd) this.colors.fwd = fwd;
    this.colors.bwd = bwd || fwd || this.colors.fwd;
    if (path) this.colors.path = path;
  }

  setOptions(opts) {
    Object.assign(this.options, opts);
  }

  // ── per-frame composite ───────────────────────────────────────────────────
  _nodeColor(node) {
    const st = this.status[node];
    if (st === 3) return this.colors.path;
    if (this.options.heatmap && st === 2) {
      return heatColor(this.val[node] / this.maxVal);
    }
    const d = this.dir[node];
    const base = d === 2 ? this.colors.bwd : this.colors.fwd;
    if (st === 1) return mixHex(base, '#ffffff', 0.45);
    return base;
  }

  _paintNodeOverlay(node) {
    const ctx = this._overlayCtx;
    const g = this.graph;
    const st = this.status[node];
    if (this.style === 'grid' || this.style === 'maze') {
      const cols = g.grid.cols;
      const c = node % cols;
      const r = (node / cols) | 0;
      const [x, y, w, h] = this._cellRectScreen(c, r);
      ctx.clearRect(x - 1, y - 1, w + 2, h + 2);
      if (st === 0) return;
      ctx.globalAlpha = st === 1 ? 0.5 : st === 3 ? 1 : 0.82;
      ctx.fillStyle = this._nodeColor(node);
      const inset = st === 1 ? w * 0.22 : st === 3 ? 0 : w * 0.06;
      ctx.fillRect(x + inset, y + inset, Math.ceil(w - inset * 2), Math.ceil(h - inset * 2));
      ctx.globalAlpha = 1;
    } else {
      const [x, y] = this.worldToScreen(g.x[node], g.y[node]);
      const s = this.viewport.scale;
      const R = clamp(2.2 * Math.sqrt(s), 1.6, 6) + 3;
      ctx.clearRect(x - R, y - R, R * 2, R * 2);
      if (st === 0) return;
      const rad =
        st === 3 ? clamp(2.4 * Math.sqrt(s), 2, 6) : clamp(1.7 * Math.sqrt(s), 1.2, 4.5);
      if (st === 1) {
        ctx.strokeStyle = this._nodeColor(node);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = this._nodeColor(node);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  render() {
    if (!this.graph) return;
    const octx = this._overlayCtx;
    const dpr = this._dpr;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this._fullRepaint) {
      octx.clearRect(0, 0, this._cssW, this._cssH);
      for (const node of this._touched) this._paintNodeOverlay(node);
      this._fullRepaint = false;
      this._dirty.length = 0;
    } else if (this._dirty.length) {
      for (const node of this._dirty) this._paintNodeOverlay(node);
      this._dirty.length = 0;
    }

    // composite to screen
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._cssW, this._cssH);
    ctx.drawImage(this._base, 0, 0, this._cssW, this._cssH);
    ctx.drawImage(this._overlay, 0, 0, this._cssW, this._cssH);

    if (this.annotations) this._drawAnnotations(ctx);
    this._drawPath(ctx);
    this._drawMarkers(ctx);
    this._drawHover(ctx);
  }

  // Annotation layer for the CH/CCH preprocessing view:
  //   { shortcuts:[{u,v}], rank:Int32Array|null, maxRank:number }
  // Shortcuts are drawn as gold arcs; if rank is given, nodes are tinted by
  // their contraction importance (low = cool, high = hot).
  setAnnotations(ann) {
    this.annotations = ann;
  }

  _drawAnnotations(ctx) {
    const g = this.graph;
    const a = this.annotations;
    if (!g) return;
    if (a.rank) {
      const mr = a.maxRank || 1;
      for (let i = 0; i < g.n; i++) {
        if (a.rank[i] < 0) continue;
        if (a.revealRank !== undefined && a.rank[i] > a.revealRank) continue;
        const [x, y] = this.worldToScreen(g.x[i], g.y[i]);
        if (x < 0 || y < 0 || x > this._cssW || y > this._cssH) continue;
        ctx.beginPath();
        ctx.fillStyle = heatColor(a.rank[i] / mr);
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (a.shortcuts && a.shortcuts.length) {
      ctx.strokeStyle = 'rgba(245,185,66,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const n = a.shortcuts.length;
      const start = Math.max(0, n - 4000); // cap drawn arcs for performance
      for (let k = start; k < n; k++) {
        const s = a.shortcuts[k];
        const [ax, ay] = this.worldToScreen(g.x[s.u], g.y[s.u]);
        const [bx, by] = this.worldToScreen(g.x[s.v], g.y[s.v]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
  }

  _drawPath(ctx) {
    if (!this.path || this.path.length < 2) return;
    const g = this.graph;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const s = this.viewport.scale;
    // glow
    ctx.strokeStyle = PALETTE.pathGlow;
    ctx.lineWidth = clamp(5 * Math.sqrt(s) * 0.5, 3, 10);
    ctx.shadowColor = 'rgba(255,240,170,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < this.path.length; i++) {
      const [x, y] = this.worldToScreen(g.x[this.path[i]], g.y[this.path[i]]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    // core
    ctx.strokeStyle = PALETTE.pathCore;
    ctx.lineWidth = clamp(2.4 * Math.sqrt(s) * 0.5, 1.5, 5);
    ctx.beginPath();
    for (let i = 0; i < this.path.length; i++) {
      const [x, y] = this.worldToScreen(g.x[this.path[i]], g.y[this.path[i]]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _marker(ctx, node, color, label) {
    if (node < 0 || node >= this.graph.n) return;
    const [x, y] = this.worldToScreen(this.graph.x[node], this.graph.y[node]);
    const r = 7;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0b0f1a';
    ctx.stroke();
    ctx.fillStyle = '#0b0f1a';
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 0.5);
    ctx.textAlign = 'start';
  }

  _drawMarkers(ctx) {
    this._marker(ctx, this.start, PALETTE.start, 'S');
    this._marker(ctx, this.goal, PALETTE.goal, 'G');
  }

  _drawHover(ctx) {
    if (this.hover < 0 || this.hover >= this.graph.n) return;
    const g = this.graph;
    const m = g.meta[this.hover];
    const [x, y] = this.worldToScreen(g.x[this.hover], g.y[this.hover]);
    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    if (m && m.name) {
      const label = m.name;
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(8,12,20,0.92)';
      ctx.fillRect(x + 12, y - 12, w, 22);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 18, y);
    }
  }

  // ── hit-testing ─────────────────────────────────────────────────────────
  nearestNode(sx, sy, maxPx = 24) {
    if (!this.graph) return -1;
    const [wx, wy] = this.screenToWorld(sx, sy);
    if (this.style === 'grid' || this.style === 'maze') {
      const c = Math.round(wx);
      const r = Math.round(wy);
      const { cols, rows } = this.graph.grid;
      if (c < 0 || r < 0 || c >= cols || r >= rows) return -1;
      return r * cols + c;
    }
    if (!this._index) this._buildIndex();
    const idx = this._index;
    const cx = Math.floor((wx - idx.b.minX) / idx.cell);
    const cy = Math.floor((wy - idx.b.minY) / idx.cell);
    let best = -1;
    let bestD = (maxPx / this.viewport.scale) ** 2;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = idx.buckets.get(idx.keyOf(cx + dx, cy + dy));
        if (!arr) continue;
        for (const i of arr) {
          const ddx = this.graph.x[i] - wx;
          const ddy = this.graph.y[i] - wy;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  // ── interaction (pan/zoom/hover/click) ────────────────────────────────────
  enableInteraction({ onPick, onHover } = {}) {
    const cv = this.canvas;
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e) => {
      if (this._interactionPaused) return;
      dragging = true;
      moved = false;
      lastX = e.offsetX;
      lastY = e.offsetY;
    };
    const onMove = (e) => {
      if (this._interactionPaused) return;
      if (dragging) {
        const dx = e.offsetX - lastX;
        const dy = e.offsetY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        this.viewport.originX -= dx / this.viewport.scale;
        this.viewport.originY -= dy / this.viewport.scale;
        lastX = e.offsetX;
        lastY = e.offsetY;
        this._fullRepaint = true;
        this.rebuildBase();
        this.render();
      } else if (onHover) {
        const node = this.nearestNode(e.offsetX, e.offsetY);
        if (node !== this.hover) {
          this.hover = node;
          this.render();
          onHover(node);
        }
      }
    };
    const onUp = (e) => {
      dragging = false;
      if (!moved && onPick) {
        const node = this.nearestNode(e.offsetX, e.offsetY);
        if (node >= 0) onPick(node, e);
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      const [wx, wy] = this.screenToWorld(e.offsetX, e.offsetY);
      this.viewport.scale = clamp(this.viewport.scale * factor, 0.02, 4000);
      // keep cursor world point fixed
      this.viewport.originX = wx - e.offsetX / this.viewport.scale;
      this.viewport.originY = wy - e.offsetY / this.viewport.scale;
      this._fullRepaint = true;
      this.rebuildBase();
      this.render();
    };
    const onLeave = () => {
      dragging = false;
      if (this.hover !== -1) {
        this.hover = -1;
        this.render();
      }
    };

    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mouseleave', onLeave);
    this._interaction = { onDown, onMove, onUp, onWheel, onLeave };
  }

  // Remove every listener enableInteraction added — critically the window-level
  // 'mouseup', which would otherwise outlive the canvas and keep this renderer
  // (and its graph) alive on every re-mount. The Visualizer calls destroy() on
  // each renderer when it tears down a view (see _mountRenderers).
  destroy() {
    const i = this._interaction;
    if (!i) return;
    const cv = this.canvas;
    if (cv) {
      cv.removeEventListener('mousedown', i.onDown);
      cv.removeEventListener('mousemove', i.onMove);
      cv.removeEventListener('wheel', i.onWheel);
      cv.removeEventListener('mouseleave', i.onLeave);
    }
    window.removeEventListener('mouseup', i.onUp);
    this._interaction = null;
  }
}
