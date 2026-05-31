// map-section.js — entry point for the "fake Google Maps" road-network section.

import { Visualizer } from '../ui/visualizer.js';
import { generateMap } from '../generators/map.js';
import { clearAux } from '../core/runner.js';
import { el, clear } from '../ui/dom.js';

const root = document.querySelector('#app');
const vis = new Visualizer(root, {
  section: 'map',
  defaultSelected: ['dijkstra', 'astar', 'bidirectional-dijkstra', 'contraction-hierarchies'],
  defaultFocus: 'astar',
});

const TRAFFIC = {
  none: { label: 'Free flow', highway: 1, arterial: 1, local: 1 },
  light: { label: 'Light traffic', highway: 1.1, arterial: 1.25, local: 1.3 },
  rush: { label: 'Rush hour', highway: 1.35, arterial: 1.7, local: 1.95 },
};

const state = { seed: 42, size: 'medium', cities: 11, traffic: 'none' };
const SIZES = { small: 520, medium: 880, large: 1500, dense: 2600 };

let startSel, goalSel;

function snapshotBase(graph) {
  for (let u = 0; u < graph.n; u++) {
    for (const e of graph.adj[u]) if (e.baseW === undefined) e.baseW = e.w;
  }
}

function applyTraffic() {
  const g = vis.graph;
  if (!g) return;
  const f = TRAFFIC[state.traffic];
  for (let u = 0; u < g.n; u++) {
    for (const e of g.adj[u]) {
      const mult = f[e.cls] || 1;
      e.w = (e.baseW ?? e.w) * mult;
    }
  }
  clearAux(g); // metric changed -> CH/CCH/ALT must re-preprocess
  vis._reset();
  vis._status(`${f.label} applied. Edge weights updated — preprocessed methods will rebuild on next run.`);
}

function populateCityDropdowns() {
  for (const sel of [startSel, goalSel]) {
    clear(sel);
    for (const c of vis.cities) sel.append(el('option', { value: String(c.id) }, c.name));
  }
  startSel.value = String(vis.start);
  goalSel.value = String(vis.goal);
}

function buildControls() {
  const p = clear(vis.scenarioPanel);
  p.append(el('h2', { class: 'panel-title' }, 'Map'));

  startSel = el('select', { class: 'select' });
  goalSel = el('select', { class: 'select' });
  startSel.addEventListener('change', () => setEndpoints());
  goalSel.addEventListener('change', () => setEndpoints());
  p.append(el('div', { class: 'field' }, [el('label', {}, 'From'), startSel]));
  p.append(el('div', { class: 'field' }, [el('label', {}, 'To'), goalSel]));

  // traffic
  const traf = el('select', { class: 'select' },
    Object.entries(TRAFFIC).map(([k, v]) => el('option', { value: k }, v.label)));
  traf.value = state.traffic;
  traf.addEventListener('change', () => { state.traffic = traf.value; applyTraffic(); });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Traffic'), traf]));

  p.append(el('div', { class: 'divider' }));

  // size
  const sizeSel = el('select', { class: 'select' }, [
    el('option', { value: 'small' }, 'Small town region'),
    el('option', { value: 'medium' }, 'Medium region'),
    el('option', { value: 'large' }, 'Large region'),
    el('option', { value: 'dense' }, 'Dense metro'),
  ]);
  sizeSel.value = state.size;
  sizeSel.addEventListener('change', () => { state.size = sizeSel.value; });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Map size'), sizeSel]));

  const cityRange = el('input', { type: 'range', min: '4', max: '18', value: String(state.cities) });
  const cityVal = el('span', { class: 'field-val' }, `${state.cities} cities`);
  cityRange.addEventListener('input', () => { state.cities = +cityRange.value; cityVal.textContent = `${state.cities} cities`; });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Cities'), cityRange, cityVal]));

  const seed = el('input', { type: 'number', value: String(state.seed), class: 'num' });
  seed.addEventListener('change', () => { state.seed = +seed.value || 1; });
  p.append(el('div', { class: 'field' }, [
    el('label', {}, 'Seed'),
    seed,
    el('button', { class: 'btn small', onclick: () => { state.seed = Math.floor(Math.random() * 1e6); seed.value = state.seed; generate(); } }, '🎲'),
  ]));
  p.append(el('button', { class: 'btn primary wide', onclick: () => generate() }, 'Generate map'));
  p.append(el('div', { class: 'hint', html: 'Roads are weighted by <b>travel time</b>, so the shortest path is the <b>fastest route</b>. Click the map to set From; Shift-click for To.' }));
}

function setEndpoints() {
  const s = +startSel.value;
  const g = +goalSel.value;
  vis.setEndpoints(s, g);
}

async function generate() {
  const result = generateMap({
    seed: state.seed,
    nodes: SIZES[state.size],
    cityCount: state.cities,
  });
  await vis.setScenario(result);
  snapshotBase(result.graph);
  if (state.traffic !== 'none') applyTraffic();
  populateCityDropdowns();
}

vis.onEndpointsChanged = (s, g) => {
  if (startSel) startSel.value = String(s);
  if (goalSel) goalSel.value = String(g);
};

buildControls();
generate();
