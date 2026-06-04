// visualizer.js
// The shared interactive engine used by BOTH sections (map + abstract graphs).
// A page builds its section-specific scenario controls into `vis.scenarioPanel`
// and calls vis.setScenario(...); everything else — algorithm selection, the
// animated/raced visualization, benchmarking, metrics, and the explanation
// panel — lives here so features land in both sections at once.

import {
  ALGORITHMS, byId, safeFor, optimalityFor,
  setIgnoreSizeLimits, getIgnoreSizeLimits, exceedsSizeLimit, sizeGuardFor,
} from '../algorithms/index.js';
import { Renderer } from './renderer.js';
import { Playback } from './playback.js';
import { makeQuery, benchmark, getAux, drain } from '../core/runner.js';
import { el, clear } from './dom.js';
import { fmtInt, fmtCost, fmtTime, downloadJSON, clamp } from '../core/utils.js';
import { EXPLANATIONS as EXPL_BASE } from '../content/explanations.js';
import { EXPLANATIONS_EXTRA } from '../content/explanations-extra.js';
const EXPLANATIONS = { ...EXPL_BASE, ...EXPLANATIONS_EXTRA };

const BWD_CONTRAST = '#ff7ad9'; // backward-direction color in single bidi view

// Applicability guards live in the algorithm registry (index.js) so the UI and
// the test harness agree. `safeFor(algoId, graph)` -> { ok, reason }.

export class Visualizer {
  constructor(root, config = {}) {
    this.root = root;
    this.config = config;
    this.section = config.section || 'graph';

    this.scenarioPanel = root.querySelector('#panel-scenario');
    this.algoPanel = root.querySelector('#panel-algos');
    this.runPanel = root.querySelector('#panel-run');
    this.stagePanel = root.querySelector('#panel-stage');
    this.metricsPanel = root.querySelector('#panel-metrics');
    this.explainPanel = root.querySelector('#panel-explain');

    this.graph = null;
    this.start = -1;
    this.goal = -1;
    this.cities = [];

    this.selected = new Set(config.defaultSelected || ['dijkstra', 'astar']);
    this.focus = config.defaultFocus || [...this.selected][0] || 'astar';
    this.mode = 'visualize';

    this.renderers = [];
    this.tracks = [];
    this.rows = {}; // algoId -> { tr, cells }
    this.playback = new Playback();
    this.playback.onAllDone = () => this._onAllDone();
    this.options = { heatmap: false, showFrontier: true, showEdges: true, showLabels: true };

    // Factory for the per-view renderer. A section can supply its own (the map
    // section returns a LeafletRenderer for the single full view so the search
    // animates over real OSM tiles); the default is the self-contained canvas.
    this.makeRenderer = config.makeRenderer || ((canvas) => new Renderer(canvas, {}));

    this.onEndpointsChanged = null; // section hook
    this.onScenarioChange = null; // fired after setScenario (tools rebind here)

    this._buildAlgoPanel();
    this._buildRunPanel();
    this._buildStage();
    this._buildMetrics();
    this._renderExplain();

    let rT = null;
    window.addEventListener('resize', () => {
      clearTimeout(rT);
      rT = setTimeout(() => this.renderers.forEach((r) => r.resize()), 120);
    });
  }

  // ── Algorithm selection panel ──────────────────────────────────────────────
  _buildAlgoPanel() {
    const p = clear(this.algoPanel);
    p.append(el('h2', { class: 'panel-title' }, 'Algorithms'));

    const presets = el('div', { class: 'presets' });
    const PRESETS = {
      Recommended: ['bfs', 'dijkstra', 'bidirectional-dijkstra', 'astar', 'bidirectional-astar', 'contraction-hierarchies', 'customizable-ch'],
      Unweighted: ['bfs', 'dfs', 'bidirectional-bfs'],
      Heuristic: ['greedy', 'astar', 'alt'],
      'Google Maps': ['contraction-hierarchies', 'customizable-ch'],
      All: ALGORITHMS.map((a) => a.id),
      None: [],
    };
    for (const [name, ids] of Object.entries(PRESETS)) {
      presets.append(
        el('button', {
          class: 'chip',
          onclick: () => {
            // Prune ids that can't run on the current graph (e.g. JPS on a maze)
            // so a preset never leaves an inapplicable algorithm checked or a
            // phantom metrics row behind. `!this.graph` => flat list, no-op.
            const ok = ids.filter((id) => !this.graph || safeFor(id, this.graph).ok);
            this.selected = new Set(ok);
            if (ok.length && !this.selected.has(this.focus)) this.focus = ok[0];
            this._buildAlgoPanel(); // re-prunes na + re-syncs checkbox disabled state
            this._buildMetrics();
            this._renderExplain();
          },
        }, name)
      );
    }
    p.append(presets);

    this._checks = {};
    const graph = this.graph;

    const mkRow = (a, opt) => {
      const na = opt && opt.status === 'na';
      const cb = el('input', { type: 'checkbox' });
      cb.checked = this.selected.has(a.id) && !na;
      if (na) { cb.disabled = true; this.selected.delete(a.id); }
      cb.addEventListener('change', () => {
        if (cb.checked) this.selected.add(a.id);
        else this.selected.delete(a.id);
        if (cb.checked) this.focus = a.id;
        this._buildMetrics();
        this._renderExplain();
      });
      this._checks[a.id] = cb;
      const badges = [];
      if (a.production) badges.push(el('span', { class: 'badge badge-maps', title: 'Used by production routers like Google Maps' }, 'Maps'));
      if (a.preprocess) badges.push(el('span', { class: 'tag tag-pre', title: 'Preprocesses the graph before queries' }, 'pre'));
      if (graph && getIgnoreSizeLimits() && exceedsSizeLimit(a.id, graph)) {
        badges.push(el('span', { class: 'tag tag-warn', title: 'Beyond its safe size on this graph — may be slow or freeze the tab' }, '⚠ slow'));
      }
      return el('label', { class: 'algo-row' + (na ? ' is-na' : ''), title: `${a.purpose}${opt ? ' — ' + opt.note : ''}` }, [
        cb,
        el('span', { class: 'swatch', style: { background: a.color } }),
        el('span', {
          class: 'algo-name',
          onclick: (e) => { e.preventDefault(); this._focusExplain(a.id); },
        }, a.short),
        ...badges,
      ]);
    };

    // Before any scenario is loaded there's no graph to judge against — show a
    // simple flat list; the optimality grouping appears once a graph exists.
    if (!graph) {
      for (const a of ALGORITHMS) p.append(mkRow(a, null));
      return;
    }

    // Power-user escape hatch: switch off the soft node-ceiling guards so heavy
    // algorithms can be forced onto large graphs (with a compute-aware warning).
    p.append(this._buildSizeGuardToggle(graph));

    // Group by whether each algorithm returns the shortest path ON THIS graph.
    const buckets = { optimal: [], sub: [], na: [] };
    for (const a of ALGORITHMS) {
      const opt = optimalityFor(a.id, graph);
      (opt.status === 'na' ? buckets.na : opt.status === 'optimal' ? buckets.optimal : buckets.sub).push([a, opt]);
    }

    p.append(el('div', { class: 'algo-group-title' }, 'Recommended — returns the shortest path'));
    for (const [a, opt] of buckets.optimal) p.append(mkRow(a, opt));

    if (buckets.sub.length) {
      const det = el('details', { class: 'algo-collapsible' });
      det.append(el('summary', {}, `Won't return the shortest path here (${buckets.sub.length})`));
      for (const [a, opt] of buckets.sub) det.append(mkRow(a, opt));
      p.append(det);
    }
    if (buckets.na.length) {
      const det = el('details', { class: 'algo-collapsible muted' });
      det.append(el('summary', {}, `Not available on this graph (${buckets.na.length})`));
      for (const [a, opt] of buckets.na) det.append(mkRow(a, opt));
      p.append(det);
    }
  }

  // Toggle for the soft node-ceiling guards. Off by default; when a power user
  // turns it on, the size-limited algorithms become selectable on the current
  // (over-large) graph and we surface a warning scaled to their machine.
  _buildSizeGuardToggle(graph) {
    const on = getIgnoreSizeLimits();
    const limited = ALGORITHMS.filter((a) => exceedsSizeLimit(a.id, graph));
    const wrap = el('div', { class: 'size-guard' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = on;
    cb.addEventListener('change', () => {
      setIgnoreSizeLimits(cb.checked);
      this._buildAlgoPanel();
      this._buildMetrics();
      this._renderExplain();
      if (cb.checked) this._status(this._sizeWarningText(graph, limited));
    });
    wrap.append(el('label', {
      class: 'toggle size-guard-toggle',
      title: 'Run heavy algorithms past their safe node-count. May freeze the tab.',
    }, [cb, '⚠ Ignore size limits (dangerous)']));
    if (on && limited.length) {
      wrap.append(el('div', { class: 'size-guard-warn' }, this._sizeWarningText(graph, limited)));
    } else if (!on && limited.length) {
      wrap.append(el('div', { class: 'hint' },
        `${limited.length} algorithm${limited.length > 1 ? 's' : ''} hidden as too heavy for ${graph.n.toLocaleString()} nodes — toggle to force them.`));
    }
    return wrap;
  }

  // Warning text tuned to the visitor's hardware (cores / memory when exposed).
  _sizeWarningText(graph, limited) {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const cores = nav.hardwareConcurrency || 0;
    const mem = nav.deviceMemory || 0;
    const machine = cores ? `${cores} cores${mem ? ` · ${mem} GB` : ''}` : 'this machine';
    const tone = cores >= 8
      ? 'your machine should handle moderate overages, but very large graphs can still freeze the tab'
      : 'this can freeze the tab on large graphs';
    const ceil = (id) => { const g = sizeGuardFor(id); return g ? g.maxNodes : 0; };
    const names = limited.map((a) => `${a.short} (>${ceil(a.id).toLocaleString()})`).join(', ') || 'none here yet';
    return `Size limits OFF (${machine}) — ${tone}. Heaviest are CH/CCH/ALT and Bellman–Ford; beyond their safe size on ${graph.n.toLocaleString()} nodes: ${names}.`;
  }

  _syncAlgoChecks() {
    for (const [id, cb] of Object.entries(this._checks)) cb.checked = this.selected.has(id);
  }

  // ── Run / transport panel ──────────────────────────────────────────────────
  _buildRunPanel() {
    const p = clear(this.runPanel);
    p.append(el('h2', { class: 'panel-title' }, 'Run'));

    // mode toggle
    const modeWrap = el('div', { class: 'seg' });
    const mkMode = (m, label) => {
      const b = el('button', {
        class: 'seg-btn' + (this.mode === m ? ' active' : ''),
        onclick: () => {
          this.mode = m;
          modeWrap.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          this._updateModeUI();
        },
      }, label);
      return b;
    };
    modeWrap.append(mkMode('visualize', 'Visualize'), mkMode('benchmark', 'Benchmark'));
    p.append(modeWrap);

    // transport
    this.transport = el('div', { class: 'transport' });
    this.playBtn = el('button', { class: 'btn primary', onclick: () => this._togglePlay() }, '▶ Play');
    this.transport.append(
      this.playBtn,
      el('button', { class: 'btn', title: 'Step once', onclick: () => this.playback.stepOnce() }, '⏯ Step'),
      el('button', { class: 'btn', title: 'Skip to result', onclick: () => this.playback.skipToEnd() }, '⏭ Finish'),
      el('button', { class: 'btn', title: 'Reset search', onclick: () => this._reset() }, '⟳ Reset'),
      el('button', { class: 'btn', title: 'Random start/goal', onclick: () => this._randomQuery() }, '🎲 Random')
    );
    p.append(this.transport);

    // speed
    const speedWrap = el('div', { class: 'field' });
    this.speed = el('input', { type: 'range', min: '0', max: '100', value: '52' });
    this.speedLabel = el('span', { class: 'field-val' }, '');
    this.speed.addEventListener('input', () => this._applySpeed());
    speedWrap.append(el('label', {}, 'Speed'), this.speed, this.speedLabel);
    p.append(speedWrap);
    this._applySpeed();

    // visual toggles
    const tog = el('div', { class: 'toggles' });
    const mkTog = (key, label, tip) => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = this.options[key];
      cb.addEventListener('change', () => {
        this.options[key] = cb.checked;
        this.renderers.forEach((r) => {
          r.setOptions(this.options);
          if (key === 'showEdges' || key === 'showLabels') r.rebuildBase();
          r._fullRepaint = true;
          r.render();
        });
      });
      return el('label', { class: 'toggle', title: tip || '' }, [cb, label]);
    };
    tog.append(
      mkTog('heatmap', 'Heatmap', 'Colour settled nodes by WHEN the search reached them — cool = early/cheap, hot = late/expensive — so you can see the wavefront spread.'),
      mkTog('showFrontier', 'Frontier', 'Show the open set: the ring of discovered-but-not-yet-settled nodes the search is about to expand next.'),
      mkTog('showEdges', 'Edges', 'Draw the underlying graph edges / roads beneath the search.'),
      mkTog('showLabels', 'Labels', 'Show place / node labels on the map.')
    );
    p.append(tog);
    p.append(el('div', { class: 'hint' }, [
      'New here? ',
      el('a', { href: 'learn.html#reading-the-visualization' }, 'How to read the visualization →'),
    ]));

    // benchmark options
    this.benchOpts = el('div', { class: 'bench-opts' });
    this.queriesInput = el('input', { type: 'number', min: '1', max: '500', value: '1', class: 'num' });
    this.benchOpts.append(
      el('div', { class: 'field' }, [el('label', {}, 'Random queries'), this.queriesInput]),
      el('button', { class: 'btn primary wide', onclick: () => this._runBenchmark() }, 'Run benchmark'),
      el('div', { class: 'hint', html: 'Averages query time over N random start/goal pairs (same pairs for every algorithm). Watch CH/CCH pull away.' })
    );
    p.append(this.benchOpts);

    this._updateModeUI();
  }

  _updateModeUI() {
    const bench = this.mode === 'benchmark';
    this.transport.style.display = bench ? 'none' : '';
    this.root.querySelector('.toggles').style.display = bench ? 'none' : '';
    this.benchOpts.style.display = bench ? '' : 'none';
    this._buildMetrics();
  }

  _applySpeed() {
    const v = +this.speed.value / 100;
    const steps = Math.round(Math.exp(0.2 * (1 - v) + Math.log(6000) * v)); // ~1 .. 6000
    this._speedSteps = Math.max(1, steps);
    this.playback.setSpeed(this._speedSteps);
    const label = steps < 4 ? 'Slow' : steps < 40 ? 'Medium' : steps < 600 ? 'Fast' : 'Turbo';
    this.speedLabel.textContent = `${label} (${fmtInt(steps)}/frame)`;
  }

  // ── Stage (canvas area) ────────────────────────────────────────────────────
  _buildStage() {
    const p = clear(this.stagePanel);
    const bar = el('div', { class: 'stage-bar' }, [
      (this.statusEl = el('div', { class: 'status' }, 'Ready')),
      el('div', { class: 'stage-actions' }, [
        el('button', { class: 'btn small', title: 'Fit view', onclick: () => this.renderers.forEach((r) => r.fitView()) }, 'Fit'),
        el('button', { class: 'btn small', onclick: () => this._zoom(1.3) }, '＋'),
        el('button', { class: 'btn small', onclick: () => this._zoom(1 / 1.3) }, '－'),
      ]),
    ]);
    this.canvasArea = el('div', { class: 'canvas-area single' });
    this.legendEl = el('div', { class: 'legend' });
    p.append(bar, this.canvasArea, this.legendEl);
  }

  _zoom(factor) {
    for (const r of this.renderers) {
      if (r.zoomBy) { r.zoomBy(factor); continue; } // Leaflet-backed map view
      const cx = r._cssW / 2;
      const cy = r._cssH / 2;
      const [wx, wy] = r.screenToWorld(cx, cy);
      r.viewport.scale = clamp(r.viewport.scale * factor, 0.02, 4000);
      r.viewport.originX = wx - cx / r.viewport.scale;
      r.viewport.originY = wy - cy / r.viewport.scale;
      r._fullRepaint = true;
      r.rebuildBase();
      r.render();
    }
  }

  _colorsFor(algo, single) {
    if (single && algo.category === 'bidirectional') {
      return { fwd: algo.color, bwd: BWD_CONTRAST, path: '#fff6cc' };
    }
    return { fwd: algo.color, bwd: algo.color, path: '#fff6cc' };
  }

  // Build canvases + renderers for `algoIds`. Returns a promise resolved once
  // they are laid out and bound to the graph.
  _mountRenderers(algoIds) {
    // Reuse the existing renderers when the same algorithm set is already
    // mounted on the same graph — avoids rebuilding canvases (and tearing down /
    // recreating the Leaflet map, which would reload tiles and lose the view)
    // every time Play is pressed.
    const sameSet =
      this._mountedGraph === this.graph &&
      this.renderers.length === algoIds.length &&
      this._mountedIds && this._mountedIds.length === algoIds.length &&
      this._mountedIds.every((id, i) => id === algoIds[i]);
    if (sameSet) return Promise.resolve();

    // Tear down old renderers (Leaflet maps + their window listeners) first.
    this.renderers.forEach((r) => { if (r.destroy) r.destroy(); });

    const area = clear(this.canvasArea);
    const single = algoIds.length <= 1;
    area.classList.toggle('single', single);
    area.classList.toggle('grid', !single);
    if (!single) {
      const cols = Math.ceil(Math.sqrt(algoIds.length));
      area.style.setProperty('--cols', cols);
    } else {
      area.style.removeProperty('--cols');
    }

    this.renderers = [];
    const panels = [];
    for (const id of algoIds) {
      const algo = byId[id];
      const canvas = el('canvas', { class: 'viz-canvas' });
      let panel;
      if (single) {
        panel = canvas;
      } else {
        panel = el('div', { class: 'mini' }, [
          el('div', { class: 'mini-head' }, [
            el('span', { class: 'swatch', style: { background: algo.color } }),
            el('span', { class: 'mini-name' }, algo.short),
            el('span', { class: 'mini-stat', id: `mini-${id}` }, ''),
          ]),
          canvas,
        ]);
      }
      area.append(panel);
      const r = this.makeRenderer(canvas, { single, id });
      r.setOptions(this.options);
      r.setColors(this._colorsFor(algo, single));
      r._algoId = id;
      this.renderers.push(r);
      panels.push({ r, single });
    }
    this._mountedIds = [...algoIds];
    this._mountedGraph = this.graph;

    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        for (const { r, single: sg } of panels) {
          r.setGraph(this.graph);
          r.setEndpoints(this.start, this.goal);
          if (sg) {
            r.enableInteraction({
              onPick: (node, e) => this._onPick(node, e),
              onHover: () => {},
            });
          } else {
            r.enableInteraction({ onHover: () => {} });
          }
          r.render();
        }
        resolve();
      });
    });
  }

  _onPick(node, e) {
    if (node < 0) return;
    if (e.shiftKey || e.button === 2) this.goal = node;
    else this.start = node;
    this._reset();
    this.renderers.forEach((r) => {
      r.setEndpoints(this.start, this.goal);
      r.render();
    });
    if (this.onEndpointsChanged) this.onEndpointsChanged(this.start, this.goal);
    this._status(`Start ${this._nodeLabel(this.start)} → Goal ${this._nodeLabel(this.goal)}. Press Play.`);
  }

  _nodeLabel(id) {
    if (id < 0 || !this.graph) return '?';
    const m = this.graph.meta[id];
    if (m && m.name) return m.name;
    if (this.graph.grid) {
      const c = id % this.graph.grid.cols;
      const r = (id / this.graph.grid.cols) | 0;
      return `(${c},${r})`;
    }
    return `#${id}`;
  }

  // ── Scenario lifecycle ─────────────────────────────────────────────────────
  async setScenario({ graph, start, goal, cities = [], pois = [], label = '' }) {
    this.playback.stop();
    this.graph = graph;
    this.start = start;
    this.goal = goal;
    this.cities = cities;
    this.pois = pois;
    this.scenarioLabel = label;
    this._buildLegend();
    this._buildAlgoPanel(); // regroup recommended / not-shortest / unavailable for this graph
    await this._mountRenderers([...this.selected].length ? [...this.selected] : ['dijkstra']);
    this._buildMetrics();
    this._renderExplain();
    this._status(label || 'Scenario loaded. Press Play.');
    if (this.onScenarioChange) this.onScenarioChange();
  }

  // The single full-size renderer (present in single/animate mode), used by the
  // editor and preprocessing view.
  get mainRenderer() {
    return this.renderers && this.renderers.length === 1 ? this.renderers[0] : null;
  }

  setEndpoints(start, goal) {
    this.start = start;
    this.goal = goal;
    this._reset();
    this.renderers.forEach((r) => {
      r.setEndpoints(start, goal);
      r.render();
    });
  }

  _randomQuery() {
    if (!this.graph) return;
    const pickNode = () => {
      if (this.section === 'map' && this.cities.length) {
        return this.cities[Math.floor(Math.random() * this.cities.length)].id;
      }
      let id = Math.floor(Math.random() * this.graph.n);
      if (this.graph.passable) {
        let guard = 0;
        while (!this.graph.passable[id] && guard++ < 1000) id = Math.floor(Math.random() * this.graph.n);
      }
      return id;
    };
    let s = pickNode();
    let g = pickNode();
    let guard = 0;
    while (g === s && guard++ < 50) g = pickNode();
    this.start = s;
    this.goal = g;
    this._reset();
    this.renderers.forEach((r) => {
      r.setEndpoints(s, g);
      r.render();
    });
    if (this.onEndpointsChanged) this.onEndpointsChanged(s, g);
    this._status(`Random: ${this._nodeLabel(s)} → ${this._nodeLabel(g)}. Press Play.`);
  }

  // ── Visualize ──────────────────────────────────────────────────────────────
  async _togglePlay() {
    if (this.playback.playing) {
      this.playback.pause();
      this.playBtn.textContent = '▶ Play';
      return;
    }
    if (this.playback.tracks.length && !this.playback.finished) {
      this.playback.play();
      this.playBtn.textContent = '⏸ Pause';
      return;
    }
    await this._startVisualize();
  }

  async _frameYield() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  async _startVisualize() {
    if (!this.graph) return;
    let ids = [...this.selected];
    if (!ids.length) {
      this._status('Select at least one algorithm.');
      return;
    }
    // apply guards
    const skipped = [];
    ids = ids.filter((id) => {
      const s = safeFor(id, this.graph);
      if (!s.ok) skipped.push(`${byId[id].short} (${s.reason})`);
      return s.ok;
    });
    if (!ids.length) {
      this._status('All selected algorithms are past their size limit here — tick “⚠ Ignore size limits” in the Algorithms panel to run them anyway.');
      return;
    }

    // Ground-truth shortest cost for THIS query, so each row can show how far
    // above optimal its path is (a fast finish ≠ a good route — e.g. Greedy).
    this._optimalCost = Infinity;
    try {
      const base = this.graph.hasNegative ? byId['bellman-ford'] : byId.dijkstra;
      this._optimalCost = drain(makeQuery(base, this.graph, this.start, this.goal, {})).cost;
    } catch (e) { /* leave Infinity → column shows “—” */ }

    await this._mountRenderers(ids);
    this._buildMetrics();

    // preprocessing (may block briefly) — show status first
    const needPre = ids.filter((id) => byId[id].preprocess);
    if (needPre.length) {
      this._status(`Preprocessing ${needPre.map((id) => byId[id].short).join(', ')}…`);
      await this._frameYield();
      for (const id of needPre) {
        const { ms } = getAux(byId[id], this.graph);
        if (this.rows[id]) this.rows[id].cells.pre.textContent = fmtTime(ms);
      }
    }

    const single = ids.length <= 1;
    this.tracks = ids.map((id, i) => {
      const algo = byId[id];
      const r = this.renderers[i];
      r.resetSearch();
      r.setColors(this._colorsFor(algo, single));
      const gen = makeQuery(algo, this.graph, this.start, this.goal, {});
      const live = { settled: 0, discovered: 0 };
      const miniEl = document.getElementById(`mini-${id}`);
      return {
        gen,
        onEvent: (ev) => {
          r.applyEvent(ev);
          if (ev.type === 'settle') live.settled++;
          else if (ev.type === 'discover') live.discovered++;
        },
        onFrame: () => {
          r.render();
          const c = this.rows[id] && this.rows[id].cells;
          if (c) {
            c.settled.textContent = fmtInt(live.settled);
            c.frontier.textContent = fmtInt(live.discovered);
          }
          if (miniEl) miniEl.textContent = `${fmtInt(live.settled)} settled`;
        },
        onDone: (res) => this._finishTrack(id, r, res, miniEl),
      };
    });

    this.playback.load(this.tracks);
    this._applySpeed();
    this.playback.play();
    this.playBtn.textContent = '⏸ Pause';
    this._status(skipped.length ? `Running… (skipped: ${skipped.join('; ')})` : 'Running…');
  }

  _finishTrack(id, renderer, res, miniEl) {
    renderer.setPath(res.path);
    renderer.render();
    const algo = byId[id];
    const c = this.rows[id] && this.rows[id].cells;
    if (c && res.stats) {
      c.settled.textContent = fmtInt(res.stats.settled);
      c.frontier.textContent = fmtInt(res.stats.maxFrontier);
      c.cost.textContent = res.path ? fmtCost(res.cost, this.graph.weightKind) : '—';
      c.hops.textContent = res.path ? fmtInt(res.stats.pathLength) : '—';
      // "vs best": how far this path is above the ground-truth shortest cost.
      if (c.quality) {
        const opt = this._optimalCost;
        const status = optimalityFor(id, this.graph).status;
        if (status === 'anyAngle') {
          c.quality.textContent = '∡ any-angle'; c.quality.className = 'q-any';
        } else if (!res.path || !Number.isFinite(res.cost) || !Number.isFinite(opt) || opt <= 0) {
          c.quality.textContent = res.path ? '—' : 'no path'; c.quality.className = '';
        } else {
          const ratio = res.cost / opt;
          if (ratio <= 1 + 1e-6) { c.quality.textContent = '✓ best'; c.quality.className = 'q-best'; }
          else { c.quality.textContent = `+${((ratio - 1) * 100).toFixed(ratio < 1.1 ? 1 : 0)}%`; c.quality.className = 'q-over'; }
        }
      }
      // accurate query time via a quick re-run
      try {
        const b = benchmark(algo, this.graph, this.start, this.goal, {}, 1);
        c.time.textContent = fmtTime(b.queryMs);
      } catch (e) {
        c.time.textContent = '—';
      }
    }
    if (miniEl && res.stats) {
      miniEl.textContent = `${fmtInt(res.stats.settled)} settled · ${
        res.path ? fmtCost(res.cost, this.graph.weightKind) : 'no path'
      }`;
    }
  }

  _onAllDone() {
    this.playBtn.textContent = '▶ Play';
    this._status('Done. Compare the metrics on the right →');
  }

  _reset() {
    this.playback.stop();
    this.renderers.forEach((r) => {
      r.resetSearch();
      r.render();
    });
    this._buildMetrics();
    this.playBtn.textContent = '▶ Play';
  }

  // ── Benchmark ──────────────────────────────────────────────────────────────
  async _runBenchmark() {
    if (!this.graph) return;
    let ids = [...this.selected];
    if (!ids.length) {
      this._status('Select at least one algorithm.');
      return;
    }
    const N = clamp(parseInt(this.queriesInput.value, 10) || 1, 1, 500);

    // Build N query pairs (shared across algorithms for fairness).
    const queries = [];
    const pickNode = () => {
      if (this.section === 'map' && this.cities.length) {
        return this.cities[Math.floor(Math.random() * this.cities.length)].id;
      }
      let id = Math.floor(Math.random() * this.graph.n);
      if (this.graph.passable) {
        let guard = 0;
        while (!this.graph.passable[id] && guard++ < 1000) id = Math.floor(Math.random() * this.graph.n);
      }
      return id;
    };
    if (N === 1) queries.push([this.start, this.goal]);
    else for (let i = 0; i < N; i++) {
      let s = pickNode();
      let g = pickNode();
      let guard = 0;
      while (g === s && guard++ < 50) g = pickNode();
      queries.push([s, g]);
    }

    // Optimal baseline (Dijkstra) for correctness + speedup.
    const optimalCost = queries.map(([s, g]) => {
      try {
        return drain(makeQuery(byId.dijkstra, this.graph, s, g, {})).cost;
      } catch (e) {
        return Infinity;
      }
    });
    let baseTime = Infinity;

    this._buildMetrics(true);
    this._status(`Benchmarking ${ids.length} algorithms over ${N} ${N === 1 ? 'query' : 'queries'}…`);
    await this._frameYield();

    const results = {};
    for (const id of ids) {
      const algo = byId[id];
      const guard = safeFor(id, this.graph);
      const c = this.rows[id] && this.rows[id].cells;
      if (!guard.ok) {
        if (c) {
          c.time.textContent = 'n/a';
          c.settled.textContent = '—';
          c.note.textContent = guard.reason;
        }
        continue;
      }
      if (c) c.time.textContent = '…';
      await this._frameYield();

      let sumTime = 0, sumSettled = 0, sumFrontier = 0, preMs = 0, costSum = 0, correct = 0, valid = 0;
      for (let qi = 0; qi < queries.length; qi++) {
        const [s, g] = queries[qi];
        const b = benchmark(algo, this.graph, s, g, {}, N === 1 ? 3 : 1);
        sumTime += b.queryMs;
        preMs = Math.max(preMs, b.preprocessMs);
        if (b.result && b.result.stats) {
          sumSettled += b.result.stats.settled;
          sumFrontier += b.result.stats.maxFrontier;
        }
        if (b.result && Number.isFinite(b.result.cost)) {
          costSum += b.result.cost;
          valid++;
          if (Math.abs(b.result.cost - optimalCost[qi]) < 1e-6 + 1e-6 * Math.abs(optimalCost[qi])) correct++;
        }
      }
      const avgTime = sumTime / queries.length;
      results[id] = { avgTime, preMs, settled: sumSettled / queries.length, cost: costSum / Math.max(1, valid), correct, valid };
      if (id === 'dijkstra') baseTime = avgTime;

      if (c) {
        c.time.textContent = fmtTime(avgTime);
        c.pre.textContent = preMs > 0.01 ? fmtTime(preMs) : '—';
        c.settled.textContent = fmtInt(results[id].settled);
        c.cost.textContent = fmtCost(results[id].cost, this.graph.weightKind);
        const okMark = algo.optimal
          ? (correct === valid ? '✓ optimal' : `✗ ${correct}/${valid}`)
          : `${(correct / Math.max(1, valid) * 100).toFixed(0)}% opt`;
        c.hops.textContent = okMark;
      }
    }
    // speedups (vs Dijkstra)
    if (Number.isFinite(baseTime)) {
      for (const id of ids) {
        const c = this.rows[id] && this.rows[id].cells;
        if (c && results[id]) {
          const sp = baseTime / results[id].avgTime;
          c.frontier.textContent = sp >= 1 ? `${sp.toFixed(1)}×` : `${sp.toFixed(2)}×`;
        }
      }
    }
    this._lastBench = { queries: N, results, baseTime, graph: this.scenarioLabel };
    this._status(`Benchmark done over ${N} ${N === 1 ? 'query' : 'queries'}. "vs Dijkstra" shows speedup.`);
  }

  // ── Metrics table ──────────────────────────────────────────────────────────
  _buildMetrics(bench = this.mode === 'benchmark') {
    const p = clear(this.metricsPanel);
    p.append(
      el('div', { class: 'panel-head' }, [
        el('h2', { class: 'panel-title' }, bench ? 'Benchmark' : 'Live metrics'),
        el('button', { class: 'btn small', title: 'Export results JSON', onclick: () => this._export() }, '⤓'),
      ])
    );
    const table = el('table', { class: 'metrics' });
    const headCols = bench
      ? ['Algorithm', 'Query', 'vs Dijkstra', 'Settled', 'Preproc', 'Cost', 'Optimal']
      : ['Algorithm', 'Settled', 'Frontier', 'Cost', 'vs best', 'Hops', 'Query', 'Preproc'];
    table.append(el('thead', {}, el('tr', {}, headCols.map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    this.rows = {};
    const ids = [...this.selected];
    for (const id of ids.length ? ids : ['dijkstra']) {
      const a = byId[id];
      const mk = () => el('td', {}, '—');
      const cells = bench
        ? { time: mk(), frontier: mk(), settled: mk(), pre: mk(), cost: mk(), hops: mk(), note: el('span', { class: 'note' }) }
        : { settled: mk(), frontier: mk(), cost: mk(), quality: mk(), hops: mk(), time: mk(), pre: mk() };
      const nameTd = el('td', { class: 'algo-cell' }, [
        el('span', { class: 'swatch', style: { background: a.color } }),
        el('span', { class: 'name-link', onclick: () => this._focusExplain(id) }, a.short),
      ]);
      let tr;
      if (bench) {
        nameTd.append(cells.note);
        tr = el('tr', {}, [nameTd, cells.time, cells.frontier, cells.settled, cells.pre, cells.cost, cells.hops]);
      } else {
        tr = el('tr', {}, [nameTd, cells.settled, cells.frontier, cells.cost, cells.quality, cells.hops, cells.time, cells.pre]);
      }
      tbody.append(tr);
      this.rows[id] = { tr, cells };
    }
    table.append(tbody);
    p.append(el('div', { class: 'metrics-wrap' }, table));
    p.append(el('div', { class: 'metrics-hint', html: bench
      ? '<b>Settled</b> = nodes expanded. Fewer settled + lower time = better. CH/CCH trade big preprocessing for tiny queries.'
      : '<b>Settled</b> grows live as each search expands nodes; <b>Frontier</b> is the open-set peak. <b>vs best</b> = how far the returned path is above the shortest possible — <span class="q-best">✓ best</span> ties, <span class="q-over">+%</span> is longer. A fast finish (e.g. Greedy) does NOT mean a good route.' }));
  }

  _export() {
    const payload = {
      section: this.section,
      scenario: this.scenarioLabel,
      mode: this.mode,
      start: this.start,
      goal: this.goal,
      selected: [...this.selected],
      benchmark: this._lastBench || null,
      timestamp: new Date().toISOString(),
    };
    downloadJSON(`pathfinding-${this.section}-results.json`, payload);
  }

  // ── Explanation panel ──────────────────────────────────────────────────────
  // The panel shows EVERY selected algorithm as a collapsible card. Clicking an
  // algorithm name (in the list or the metrics) opens + scrolls to its card via
  // _focusExplain, instead of swapping a single-algorithm view.
  _renderExplain() {
    const p = clear(this.explainPanel);
    const ids = [...this.selected];
    if (!ids.length) {
      p.append(el('p', { class: 'muted' }, 'Tick one or more algorithms to see how each one works.'));
      return;
    }
    if (!ids.includes(this.focus)) this.focus = ids[0];
    for (const id of ids) {
      const a = byId[id];
      const opt = this.graph ? optimalityFor(id, this.graph) : null;
      const mark = !opt ? '' : opt.status === 'optimal' ? '✓' : opt.status === 'anyAngle' ? '∡' : opt.status === 'na' ? '—' : '≉';
      const det = el('details', { class: 'explain-item', id: 'explain-' + id });
      det.open = id === this.focus || ids.length === 1;
      det.append(el('summary', { class: 'explain-summary' }, [
        el('span', { class: 'swatch', style: { background: a.color } }),
        el('span', { class: 'explain-name' }, a.name),
        a.production ? el('span', { class: 'badge badge-maps', title: 'Used by production routers like Google Maps' }, 'Maps') : null,
        opt ? el('span', { class: 'opt-mark opt-' + opt.status, title: opt.note }, mark) : null,
      ]));
      this._renderAlgoExplain(det, id);
      p.append(det);
    }
  }

  // Select (if applicable), then open + scroll to an algorithm's card.
  _focusExplain(id) {
    this.focus = id;
    if (!this.selected.has(id) && (!this.graph || safeFor(id, this.graph).ok)) {
      this.selected.add(id);
      this._syncAlgoChecks();
      this._buildMetrics();
    }
    this._renderExplain();
    const safe = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id;
    const sec = this.explainPanel.querySelector('#explain-' + safe);
    if (sec) { sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  // Render one algorithm's details into `p` (used per-card by _renderExplain).
  _renderAlgoExplain(p, id) {
    const a = byId[id] || byId.dijkstra;
    const ex = (EXPLANATIONS && EXPLANATIONS[id]) || null;
    p.append(el('div', { class: 'tagline' }, ex ? ex.tagline : a.blurb));

    // What is this algorithm FOR, and does it return the shortest path on the
    // graph currently loaded? (The "note in the sandbox".)
    p.append(el('div', { class: 'purpose-line' }, a.purpose));
    if (this.graph) {
      const opt = optimalityFor(id, this.graph);
      const label = opt.status === 'optimal' ? '✓ Optimal on this graph'
        : opt.status === 'anyAngle' ? '∡ Any-angle — shorter than the grid path'
        : opt.status === 'na' ? '— Not available on this graph'
        : '≉ Not the shortest on this graph';
      p.append(el('div', { class: 'opt-note opt-' + opt.status }, [el('b', {}, label), el('span', {}, opt.note)]));
    }

    if (!ex) {
      p.append(el('p', { class: 'muted' }, a.blurb));
      p.append(el('a', { class: 'btn small', href: 'learn.html' }, 'Open the learning guides →'));
      return;
    }

    const tabsBar = el('div', { class: 'tabs' });
    const body = el('div', { class: 'tab-body' });
    const TABS = {
      Summary: () => {
        body.append(el('p', {}, ex.summary));
        const meta = el('div', { class: 'meta-grid' });
        meta.append(
          el('div', { class: 'meta' }, [el('b', {}, 'Optimal'), el('span', {}, ex.optimal)]),
          el('div', { class: 'meta' }, [el('b', {}, 'When to use'), el('span', {}, ex.whenToUse)])
        );
        body.append(meta);
      },
      'How it works': () => {
        for (const para of ex.howItWorks) {
          body.append(el('p', { html: para.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>') }));
        }
      },
      Complexity: () => {
        const c = ex.complexity;
        const ul = el('ul', { class: 'complexity' });
        for (const [k, v] of Object.entries(c)) {
          ul.append(el('li', {}, [el('b', {}, `${k}: `), el('code', {}, v)]));
        }
        body.append(ul);
        body.append(el('div', { class: 'pc' }, [
          el('div', {}, [el('b', { class: 'good' }, 'Pros'), el('ul', {}, ex.pros.map((x) => el('li', {}, x)))]),
          el('div', {}, [el('b', { class: 'bad' }, 'Cons'), el('ul', {}, ex.cons.map((x) => el('li', {}, x)))]),
        ]));
      },
      Pseudocode: () => {
        body.append(el('pre', { class: 'pseudo' }, el('code', {}, ex.pseudocode)));
      },
      Veritasium: () => {
        body.append(el('p', {}, ex.veritasium));
        body.append(el('a', { class: 'btn small', href: 'learn.html#how-maps-work' }, 'Full guide →'));
      },
    };
    let first = true;
    for (const [name, fn] of Object.entries(TABS)) {
      const b = el('button', {
        class: 'tab' + (first ? ' active' : ''),
        onclick: () => {
          tabsBar.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          clear(body);
          fn();
        },
      }, name);
      tabsBar.append(b);
      if (first) {
        fn();
        first = false;
      }
    }
    p.append(tabsBar, body);
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  _buildLegend() {
    const p = clear(this.legendEl);
    const item = (color, label, ring = false) =>
      el('span', { class: 'leg' }, [
        el('span', { class: 'leg-dot' + (ring ? ' ring' : ''), style: ring ? { borderColor: color } : { background: color } }),
        label,
      ]);
    p.append(
      item('#36d399', 'Start'),
      item('#ff6b6b', 'Goal'),
      item('#4f86f7', 'Settled'),
      item('#9fc0ff', 'Frontier', true),
      item('#fff6cc', 'Shortest path')
    );
    if (this.section === 'map') {
      p.append(
        item('#e0b341', 'Highway'),
        item('#8aa0c8', 'Arterial'),
        item('#3c4a66', 'Local road')
      );
    } else if (this.graph && this.graph.terrain) {
      p.append(el('span', { class: 'leg' }, [el('span', { class: 'leg-grad' }), 'Cheap → costly terrain']));
    }
  }

  _status(t) {
    if (this.statusEl) this.statusEl.textContent = t;
  }
}
