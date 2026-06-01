// tools.js — installs the extra interactive features onto a Visualizer:
//   • graph/maze editor (paint walls + terrain, set endpoints)
//   • CH/CCH preprocessing animation
//   • shareable scenario link (if the section provides vis.shareState)
//   • scaling benchmark charts (if the section provides vis.scalingConfig)
//   • PNG export, light/dark theme, keyboard shortcuts
//
// Kept separate so the core Visualizer stays focused. Call installTools(vis)
// after constructing the Visualizer.

import { createEditor } from './editor.js';
import { createPreprocessView } from './preprocess-view.js';
import { drawLineChart } from './charts.js';
import { buildShareURL } from './share.js';
import { byId } from '../algorithms/index.js';
import { benchmark, clearAux } from '../core/runner.js';
import { el, clear } from './dom.js';
import { fmtTime, fmtInt } from '../core/utils.js';

export function installTools(vis) {
  let editor = null;
  let preprocess = null;

  const panel = el('div', { class: 'tools' });
  const toolStrip = el('div', { class: 'tool-strip', style: { display: 'none' } });
  vis.runPanel.append(el('div', { class: 'divider' }), el('h2', { class: 'panel-title' }, 'Tools'), panel, toolStrip);

  // ── editor + preprocessing rebind whenever the scenario (graph/renderer) changes
  function rebind() {
    if (preprocess) preprocess.clear();
    const r = vis.mainRenderer;
    preprocess = r ? createPreprocessView(r) : null;
    editor = r
      ? createEditor(r, {
          onMutate: () => {
            clearAux(vis.graph);
            vis._reset();
            vis._status('Graph edited — search cleared. Press Play.');
          },
          onSetStart: (id) => setEndpoint('start', id),
          onSetGoal: (id) => setEndpoint('goal', id),
        })
      : null;
    if (editBtn) {
      editBtn.classList.remove('active');
      toolStrip.style.display = 'none';
    }
    updateButtons();
  }
  function setEndpoint(which, id) {
    if (which === 'start') vis.start = id;
    else vis.goal = id;
    const r = vis.mainRenderer;
    if (r) { r.setEndpoints(vis.start, vis.goal); r.render(); }
    vis._reset();
    if (vis.onEndpointsChanged) vis.onEndpointsChanged(vis.start, vis.goal);
  }

  // ── Edit ────────────────────────────────────────────────────────────────
  const editBtn = el('button', { class: 'btn small', onclick: onEdit }, '✏️ Edit');
  async function onEdit() {
    if (!vis.graph || !vis.graph.grid) {
      vis._status('Editing is available for grid & maze scenarios.');
      return;
    }
    if (editor && editor.active) {
      editor.disable();
      editBtn.classList.remove('active');
      toolStrip.style.display = 'none';
      return;
    }
    // ensure a single editable canvas
    if (!vis.mainRenderer) {
      await vis._mountRenderers([vis.focus || 'dijkstra']);
      rebind();
    }
    if (!editor) return;
    editor.enable('wall');
    editBtn.classList.add('active');
    toolStrip.style.display = 'flex';
    vis._status('Editing: drag to paint walls. Shift-drag erases. Pick a tool below.');
  }
  const TOOLS = [
    ['wall', '🧱 Wall'],
    ['weight+', '⛰️ Costlier'],
    ['weight-', '🌱 Cheaper'],
    ['erase', '🩹 Erase'],
    ['start', '🟢 Start'],
    ['goal', '🔴 Goal'],
  ];
  for (const [t, label] of TOOLS) {
    toolStrip.append(
      el('button', {
        class: 'chip',
        onclick: () => { if (editor) editor.setTool(t); },
      }, label)
    );
  }
  // fix: attach selection via event delegation (avoid stale ev)
  toolStrip.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    toolStrip.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
    btn.classList.add('sel');
  });

  // ── Preprocess animation ─────────────────────────────────────────────────
  const preBtn = el('button', { class: 'btn small', onclick: onPreprocess }, '🏔️ Preprocess');
  async function onPreprocess() {
    const id = vis.focus;
    const algo = byId[id];
    if (!algo || !algo.preprocess) {
      vis._status('Preprocessing view is for CH / CCH — select one as the focused algorithm.');
      return;
    }
    if (editor && editor.active) onEdit();
    if (!vis.mainRenderer) {
      await vis._mountRenderers([id]);
      rebind();
    }
    vis.playback.stop();
    preprocess.run(id, {
      onInfo: (m) => vis._status(m),
      onDone: () => {},
    });
  }

  // ── Copy share link ──────────────────────────────────────────────────────
  const linkBtn = el('button', { class: 'btn small', onclick: onShare }, '🔗 Copy link');
  async function onShare() {
    if (!vis.shareState) { vis._status('Sharing not available here.'); return; }
    const url = buildShareURL(vis.shareState());
    try {
      if (location && location.hash !== undefined) location.hash = url.split('#')[1] || '';
      if (navigator.clipboard) await navigator.clipboard.writeText(url);
      vis._status('Shareable link copied to clipboard ✓');
    } catch (e) {
      vis._status('Link set in the address bar — copy it from there.');
    }
  }

  // ── Scaling benchmark chart ──────────────────────────────────────────────
  const scaleBtn = el('button', { class: 'btn small', onclick: onScaling }, '📈 Scaling chart');
  async function onScaling() {
    if (!vis.scalingConfig) { vis._status('Scaling chart not available here.'); return; }
    const ids = [...vis.selected];
    if (!ids.length) { vis._status('Select algorithms to chart.'); return; }
    openChartModal();
    vis._status('Running scaling benchmark…');
    await new Promise((r) => requestAnimationFrame(() => r()));
    const { sizes, makeGraph } = vis.scalingConfig;
    const seriesTime = ids.map((id) => ({ label: byId[id].short, color: byId[id].color, points: [] }));
    const seriesNodes = ids.map((id) => ({ label: byId[id].short, color: byId[id].color, points: [] }));
    for (const size of sizes) {
      const r = makeGraph(size);
      const g = r.graph;
      const queries = [];
      for (let i = 0; i < 5; i++) {
        const s = (Math.random() * g.n) | 0;
        let go = (Math.random() * g.n) | 0;
        if (g.passable) { let k = 0; while (!g.passable[go] && k++ < 200) go = (Math.random() * g.n) | 0; }
        queries.push([s, go]);
      }
      for (let i = 0; i < ids.length; i++) {
        const algo = byId[ids[i]];
        if (algo.needsGrid && !g.grid) continue;
        let t = 0, nodes = 0, ok = 0;
        for (const [s, go] of queries) {
          try {
            const b = benchmark(algo, g, s, go, {}, 1);
            t += b.queryMs;
            nodes += b.result && b.result.stats ? b.result.stats.settled : 0;
            ok++;
          } catch (e) { /* skip */ }
        }
        if (ok) {
          seriesTime[i].points.push([g.n, t / ok]);
          seriesNodes[i].points.push([g.n, nodes / ok]);
        }
      }
      await new Promise((res) => requestAnimationFrame(() => res()));
    }
    drawLineChart(chartTime, { series: seriesTime, title: 'Query time vs graph size', xLabel: 'nodes', yLabel: 'ms (avg)', logX: true, logY: true });
    drawLineChart(chartNodes, { series: seriesNodes, title: 'Nodes settled vs graph size', xLabel: 'nodes', yLabel: 'settled (avg)', logX: true, logY: true });
    vis._status('Scaling benchmark done — see the charts.');
  }

  let chartTime, chartNodes;
  function openChartModal() {
    let modal = document.getElementById('chart-modal');
    if (modal) modal.remove();
    chartTime = el('canvas', { class: 'chart-canvas' });
    chartNodes = el('canvas', { class: 'chart-canvas' });
    modal = el('div', { id: 'chart-modal', class: 'modal' }, [
      el('div', { class: 'modal-card' }, [
        el('div', { class: 'modal-head' }, [
          el('h2', {}, 'Scaling benchmark'),
          el('button', { class: 'btn small', onclick: () => modal.remove() }, '✕ Close'),
        ]),
        el('div', { class: 'chart-grid' }, [chartTime, chartNodes]),
        el('div', { class: 'hint', html: 'Both axes are log-scaled. Watch CH/CCH stay flat while uninformed search climbs.' }),
      ]),
    ]);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.append(modal);
  }

  // ── PNG export + theme ───────────────────────────────────────────────────
  const pngBtn = el('button', { class: 'btn small', onclick: onPng }, '📷 PNG');
  function onPng() {
    const r = vis.mainRenderer || (vis.renderers && vis.renderers[0]);
    if (!r) { vis._status('Nothing to export yet.'); return; }
    try {
      const url = r.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `pathfinding-${vis.section}.png`;
      a.click();
      vis._status('Saved PNG ✓');
    } catch (e) { vis._status('PNG export failed.'); }
  }
  const themeBtn = el('button', { class: 'btn small', onclick: onTheme }, '🌓 Theme');
  function onTheme() {
    document.body.classList.toggle('light');
    try { localStorage.setItem('pa-theme', document.body.classList.contains('light') ? 'light' : 'dark'); } catch (e) {}
    vis.renderers.forEach((r) => { r._fullRepaint = true; r.rebuildBase(); r.render(); });
  }
  try { if (localStorage.getItem('pa-theme') === 'light') document.body.classList.add('light'); } catch (e) {}

  function updateButtons() {
    const gridLike = vis.graph && vis.graph.grid;
    editBtn.style.display = gridLike ? '' : 'none';
    const focusAlgo = byId[vis.focus];
    preBtn.style.display = focusAlgo && focusAlgo.preprocess ? '' : 'none';
    linkBtn.style.display = vis.shareState ? '' : 'none';
    scaleBtn.style.display = vis.scalingConfig ? '' : 'none';
  }

  panel.append(editBtn, preBtn, scaleBtn, linkBtn, pngBtn, themeBtn);

  // keep Preprocess button visibility in sync when focus changes: patch _renderExplain
  const origRenderExplain = vis._renderExplain.bind(vis);
  vis._renderExplain = function () { origRenderExplain(); updateButtons(); };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); vis._togglePlay(); }
    else if (e.key === 's') vis.playback.stepOnce();
    else if (e.key === 'f') vis.playback.skipToEnd();
    else if (e.key === 'r') vis._reset();
    else if (e.key === 'g') vis._randomQuery();
    else if (e.key === 'e') onEdit();
  });

  vis.onScenarioChange = rebind;
  rebind();
}
