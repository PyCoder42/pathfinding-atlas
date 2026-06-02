// map-section.js — real-world routing on actual OpenStreetMap road data.
// Loads baked OSM graphs (see tools/bake-osm.js, data/*.json) for several real
// places. Roads are weighted by travel time, so the shortest path is the
// fastest route — exactly like a real router.

import { Visualizer } from '../ui/visualizer.js';
import { Renderer } from '../ui/renderer.js';
import { LeafletRenderer } from '../ui/leaflet-renderer.js';
import { loadOSM } from '../generators/osm-map.js';
import { generateMap } from '../generators/map.js';
import { clearAux } from '../core/runner.js';
import { el, clear } from '../ui/dom.js';
import { installTools } from '../ui/tools.js';
import { readStateFromURL } from '../ui/share.js';

const root = document.querySelector('#app');
const vis = new Visualizer(root, {
  section: 'map',
  defaultSelected: ['astar'],
  defaultFocus: 'astar',
  // Single full view → animate the search over a real OSM tile map (Leaflet);
  // multi-view (racing) and any environment without Leaflet/geo fall back to the
  // self-contained canvas renderer so the map always works.
  makeRenderer: (canvas, { single }) => {
    const g = vis.graph;
    if (single && window.L && g && g.geo) return new LeafletRenderer(canvas, { geo: g.geo });
    return new Renderer(canvas, {});
  },
});

const PLACES = [
  { key: 'monaco', name: 'Monaco' },
  { key: 'manhattan', name: 'Midtown Manhattan' },
  { key: 'cambridge', name: 'Cambridge, UK' },
];

const TRAFFIC = {
  none: { label: 'Free flow', highway: 1, arterial: 1, local: 1 },
  light: { label: 'Light traffic', highway: 1.1, arterial: 1.25, local: 1.3 },
  rush: { label: 'Rush hour', highway: 1.35, arterial: 1.7, local: 1.95 },
};

const state = { place: 'monaco', traffic: 'none' };
let startSel, goalSel, placeSel;

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
    for (const e of g.adj[u]) e.w = (e.baseW ?? e.w) * (f[e.cls] || 1);
  }
  clearAux(g); // metric changed → CH/CCH/ALT must re-preprocess
  vis._reset();
  vis._status(`${f.label} applied — preprocessed methods (CH/CCH/ALT) will rebuild on next run.`);
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
  p.append(el('h2', { class: 'panel-title' }, 'Real map (OpenStreetMap)'));

  placeSel = el('select', { class: 'select' }, PLACES.map((pl) => el('option', { value: pl.key }, pl.name)));
  placeSel.value = state.place;
  placeSel.addEventListener('change', () => { state.place = placeSel.value; loadPlace(); });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Place'), placeSel]));

  startSel = el('select', { class: 'select' });
  goalSel = el('select', { class: 'select' });
  startSel.addEventListener('change', () => vis.setEndpoints(+startSel.value, +goalSel.value));
  goalSel.addEventListener('change', () => vis.setEndpoints(+startSel.value, +goalSel.value));
  p.append(el('div', { class: 'field' }, [el('label', {}, 'From'), startSel]));
  p.append(el('div', { class: 'field' }, [el('label', {}, 'To'), goalSel]));

  const traf = el('select', { class: 'select' }, Object.entries(TRAFFIC).map(([k, v]) => el('option', { value: k }, v.label)));
  traf.value = state.traffic;
  traf.addEventListener('change', () => { state.traffic = traf.value; applyTraffic(); });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Traffic'), traf]));

  p.append(el('button', { class: 'btn primary wide', onclick: () => loadPlace() }, 'Reload map'));
  p.append(el('div', { class: 'hint', html: 'Real road network, weighted by <b>travel time</b> → shortest path = <b>fastest route</b>. Click the map to set <b>From</b>; Shift-click for <b>To</b>. The <b>C-algorithms (CH, CCH)</b> are what real routers like Google Maps actually use.' }));
}

async function loadPlace() {
  vis._status(`Loading ${PLACES.find((p) => p.key === state.place)?.name || state.place}…`);
  try {
    const result = await loadOSM(`data/${state.place}.json`);
    await vis.setScenario(result);
    snapshotBase(result.graph);
    if (state.traffic !== 'none') applyTraffic();
    populateCityDropdowns();
  } catch (e) {
    vis._status(`Could not load map data (${e.message}). Serve the folder over http (not file://).`);
  }
}

vis.onEndpointsChanged = (s, g) => {
  if (startSel) startSel.value = String(s);
  if (goalSel) goalSel.value = String(g);
};

vis.shareState = () => ({ section: 'map', st: { ...state }, start: vis.start, goal: vis.goal, selected: [...vis.selected], focus: vis.focus });
// Scaling chart uses synthetic maps of controllable size (the trend is what matters).
vis.scalingConfig = {
  sizes: [400, 900, 1600, 2600, 4000],
  makeGraph: (n) => generateMap({ seed: 42, nodes: n, cityCount: 11 }),
};

installTools(vis);

(async () => {
  const shared = readStateFromURL();
  if (shared && shared.section === 'map' && shared.st) Object.assign(state, shared.st);
  buildControls();
  await loadPlace();
  if (shared && shared.section === 'map') {
    if (Array.isArray(shared.selected) && shared.selected.length) {
      vis.selected = new Set(shared.selected);
      vis.focus = shared.focus || [...vis.selected][0];
      vis._syncAlgoChecks();
      vis._buildMetrics();
      vis._renderExplain();
    }
    if (Number.isInteger(shared.start) && Number.isInteger(shared.goal)) {
      vis.setEndpoints(shared.start, shared.goal);
      if (startSel) startSel.value = String(shared.start);
      if (goalSel) goalSel.value = String(shared.goal);
    }
  }
})();
