// visualizer.js
// The shared interactive engine used by BOTH sections (map + abstract graphs).
// A page builds its section-specific scenario controls into `vis.scenarioPanel`
// and calls vis.setScenario(...); everything else — algorithm selection, the
// animated/raced visualization, benchmarking, metrics, and the explanation
// panel — lives here so features land in both sections at once.

import { ALGORITHMS, CATEGORIES, byId, safeFor } from '../algorithms/index.js';
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
      Recommended: ['dijkstra', 'astar', 'bidirectional-dijkstra', 'contraction-hierarchies'],
      Classic: ['bfs', 'dijkstra', 'bellman-ford'],
      Heuristic: ['greedy', 'astar', 'alt'],
      Bidirectional: ['bidirectional-dijkstra', 'bidirectional-astar'],
      Hierarchical: ['contraction-hierarchies', 'customizable-ch'],
      All: ALGORITHMS.map((a) => a.id),
      None: [],
    };
    for (const [name, ids] of Object.entries(PRESETS)) {
      presets.append(
        el('button', {
          class: 'chip',
          onclick: () => {
            this.selected = new Set(ids);
            if (ids.length && !this.selected.has(this.focus)) this.focus = ids[0];
            this._syncAlgoChecks();
            this._buildMetrics();
            this._renderExplain();
          },
        }, name)
      );
    }
    p.append(presets);

    const groups = {};
    for (const a of ALGORITHMS) (groups[a.category] ||= []).push(a);
    const catOrder = Object.entries(CATEGORIES).sort((a, b) => a[1].order - b[1].order);

    this._checks = {};
    for (const [cat, meta] of catOrder) {
      const list = groups[cat] || [];
      if (!list.length) continue;
      p.append(el('div', { class: 'algo-cat' }, meta.label));
      for (const a of list) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = this.selected.has(a.id);
        cb.addEventListener('change', () => {
          if (cb.checked) this.selected.add(a.id);
          else this.selected.delete(a.id);
          if (cb.checked) this.focus = a.id;
          this._buildMetrics();
          this._renderExplain();
        });
        this._checks[a.id] = cb;
        const row = el('label', { class: 'algo-row', title: a.blurb }, [
          cb,
          el('span', { class: 'swatch', style: { background: a.color } }),
          el('span', {
            class: 'algo-name',
            onclick: (e) => {
              e.preventDefault();
              this.focus = a.id;
              this._renderExplain();
            },
          }, a.short),
          a.preprocess ? el('span', { class: 'tag tag-pre' }, 'pre') : null,
          a.optimal ? null : el('span', { class: 'tag tag-warn' }, '≉'),
        ]);
        p.append(row);
      }
    }
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
    const mkTog = (key, label) => {
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
      return el('label', { class: 'toggle' }, [cb, label]);
    };
    tog.append(
      mkTog('heatmap', 'Heatmap'),
      mkTog('showFrontier', 'Frontier'),
      mkTog('showEdges', 'Edges'),
      mkTog('showLabels', 'Labels')
    );
    p.append(tog);

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
    await this._mountRenderers([...this.selected].length ? [...this.selected] : ['dijkstra']);
    this._buildMetrics();
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
      this._status('All selected algorithms are too heavy for this graph size.');
      return;
    }

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
      : ['Algorithm', 'Settled', 'Frontier', 'Cost', 'Hops', 'Query', 'Preproc'];
    table.append(el('thead', {}, el('tr', {}, headCols.map((h) => el('th', {}, h)))));
    const tbody = el('tbody');
    this.rows = {};
    const ids = [...this.selected];
    for (const id of ids.length ? ids : ['dijkstra']) {
      const a = byId[id];
      const mk = () => el('td', {}, '—');
      const cells = bench
        ? { time: mk(), frontier: mk(), settled: mk(), pre: mk(), cost: mk(), hops: mk(), note: el('span', { class: 'note' }) }
        : { settled: mk(), frontier: mk(), cost: mk(), hops: mk(), time: mk(), pre: mk() };
      const nameTd = el('td', { class: 'algo-cell' }, [
        el('span', { class: 'swatch', style: { background: a.color } }),
        el('span', { class: 'name-link', onclick: () => { this.focus = id; this._renderExplain(); } }, a.short),
      ]);
      let tr;
      if (bench) {
        nameTd.append(cells.note);
        tr = el('tr', {}, [nameTd, cells.time, cells.frontier, cells.settled, cells.pre, cells.cost, cells.hops]);
      } else {
        tr = el('tr', {}, [nameTd, cells.settled, cells.frontier, cells.cost, cells.hops, cells.time, cells.pre]);
      }
      tbody.append(tr);
      this.rows[id] = { tr, cells };
    }
    table.append(tbody);
    p.append(table);
    p.append(el('div', { class: 'metrics-hint', html: bench
      ? '<b>Settled</b> = nodes expanded. Fewer settled + lower time = better. CH/CCH trade big preprocessing for tiny queries.'
      : '<b>Settled</b> grows live as each search expands nodes; <b>Frontier</b> is the open-set peak. Lower path <b>Cost</b> is better; optimal algorithms tie.' }));
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
  _renderExplain() {
    const p = clear(this.explainPanel);
    const a = byId[this.focus] || byId.dijkstra;
    const ex = (EXPLANATIONS && EXPLANATIONS[this.focus]) || null;
    p.append(
      el('div', { class: 'explain-head' }, [
        el('span', { class: 'swatch big', style: { background: a.color } }),
        el('div', {}, [
          el('h2', { class: 'panel-title' }, a.name),
          el('div', { class: 'tagline' }, ex ? ex.tagline : a.blurb),
        ]),
      ])
    );

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
