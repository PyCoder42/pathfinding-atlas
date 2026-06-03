// graph-section.js — entry point for the abstract weighted-graph section
// (mazes, weighted terrain grids, large geometric graphs, negative weights).

import { Visualizer } from '../ui/visualizer.js';
import { generateMaze } from '../generators/maze.js';
import { generateGrid } from '../generators/grid.js';
import { generateRandomGraph, generateNegativeGraph } from '../generators/random-graph.js';
import { el, clear } from '../ui/dom.js';
import { fmtInt } from '../core/utils.js';
import { installTools } from '../ui/tools.js';
import { readStateFromURL } from '../ui/share.js';

const root = document.querySelector('#app');
const vis = new Visualizer(root, {
  section: 'graph',
  defaultSelected: ['bfs', 'dfs', 'bidirectional-bfs'],
  defaultFocus: 'bfs',
});

// The Graphs page is split into two domains (tabs). Each curates the scenarios
// where it makes sense and the algorithms you'd actually reach for there.
//   Unweighted → minimise the number of steps (BFS / DFS / Bi-BFS)
//   Weighted   → minimise total cost (Dijkstra → A* → CH → CCH, Bellman–Ford)
const DOMAINS = {
  unweighted: {
    label: 'Unweighted',
    sub: 'fewest steps',
    types: [
      { value: 'maze', label: 'Maze' },
      { value: 'grid', label: 'Uniform grid' },
    ],
    defaults: { type: 'maze', weighted: false, selected: ['bfs', 'dfs', 'bidirectional-bfs'], focus: 'bfs' },
  },
  weighted: {
    label: 'Weighted',
    sub: 'lowest cost',
    types: [
      { value: 'grid', label: 'Weighted terrain grid' },
      { value: 'random', label: 'Large geometric graph' },
      { value: 'negative', label: 'Negative weights (Bellman–Ford)' },
    ],
    defaults: { type: 'grid', weighted: true, selected: ['dijkstra', 'astar', 'bidirectional-dijkstra', 'contraction-hierarchies'], focus: 'astar' },
  },
};

const state = {
  domain: 'unweighted',
  type: 'maze',
  size: 46,
  seed: 1,
  mazeAlgo: 'backtracker',
  braid: 0.08,
  diagonal: false,
  weighted: false,
  wallDensity: 0,
};

function setDomain(d) {
  if (!DOMAINS[d]) return;
  state.domain = d;
  const def = DOMAINS[d].defaults;
  state.type = def.type;
  state.weighted = def.weighted;
  state.diagonal = false; // start each domain on a clean 4-connected (uniform) grid
  vis.selected = new Set(def.selected);
  vis.focus = def.focus;
  buildControls();
  vis._syncAlgoChecks();
  generate();
}

function sizeFor(type, t01) {
  if (type === 'random') {
    const n = Math.round(200 + (40000 - 200) * t01 * t01);
    return { n };
  }
  const cols = Math.round(8 + (150 - 8) * t01);
  const rows = Math.max(5, Math.round(cols * 0.62));
  return { cols, rows };
}

function describe() {
  const t = state.size / 100;
  if (state.type === 'random') {
    const { n } = sizeFor('random', t);
    return `${fmtInt(n)} nodes`;
  }
  const { cols, rows } = sizeFor(state.type, t);
  return `${cols}×${rows} = ${fmtInt(cols * rows)} cells`;
}

function buildControls() {
  const p = clear(vis.scenarioPanel);
  p.append(el('h2', { class: 'panel-title' }, 'Graph'));

  // Domain tabs: Unweighted (fewest steps) vs Weighted (lowest cost).
  const tabs = el('div', { class: 'seg domain-tabs' });
  for (const [key, d] of Object.entries(DOMAINS)) {
    tabs.append(el('button', {
      class: 'seg-btn' + (state.domain === key ? ' active' : ''),
      title: d.sub,
      onclick: () => { if (state.domain !== key) setDomain(key); },
    }, [d.label, el('span', { class: 'seg-sub' }, d.sub)]));
  }
  p.append(tabs);
  p.append(el('div', { class: 'hint domain-blurb' }, state.domain === 'unweighted'
    ? 'Minimise the number of steps — BFS, DFS and Bidirectional BFS, the first search algorithms you learn. On a 4-connected grid every edge costs the same; turn on 8-direction and diagonals cost √2, so BFS is no longer optimal — watch it drop out of “Recommended”.'
    : 'Minimise total cost (distance / time) — Dijkstra and everything built on it, up to the hierarchies real routers use.'));

  // Scenario type (the options depend on the domain).
  const typeSel = el('select', { class: 'select' },
    DOMAINS[state.domain].types.map((t) => el('option', { value: t.value }, t.label)));
  typeSel.value = state.type;
  typeSel.addEventListener('change', () => {
    state.type = typeSel.value;
    renderSub();
    sizeLabel.textContent = describe();
    if (state.type === 'negative') {
      vis.selected.add('bellman-ford');
      vis.focus = 'bellman-ford';
      vis._syncAlgoChecks();
      vis._buildMetrics();
      vis._renderExplain();
    }
    generate();
  });
  p.append(el('div', { class: 'field' }, [el('label', {}, 'Type'), typeSel]));

  // size
  const size = el('input', { type: 'range', min: '4', max: '100', value: String(state.size) });
  const sizeLabel = el('span', { class: 'field-val' }, describe());
  size.addEventListener('input', () => {
    state.size = +size.value;
    sizeLabel.textContent = describe();
  });
  size.addEventListener('change', () => generate());
  const sizeField = el('div', { class: 'field' }, [el('label', {}, 'Size'), size, sizeLabel]);
  p.append(sizeField);

  // sub-controls placeholder
  const sub = el('div', { class: 'subcontrols' });
  p.append(sub);

  function renderSub() {
    clear(sub);
    sizeField.style.display = state.type === 'negative' ? 'none' : '';
    if (state.type === 'maze') {
      const algo = el('select', { class: 'select' }, [
        el('option', { value: 'backtracker' }, 'Recursive backtracker'),
        el('option', { value: 'prim' }, "Randomized Prim's"),
      ]);
      algo.value = state.mazeAlgo;
      algo.addEventListener('change', () => { state.mazeAlgo = algo.value; generate(); });
      sub.append(el('div', { class: 'field' }, [el('label', {}, 'Algorithm'), algo]));

      const braid = el('input', { type: 'range', min: '0', max: '40', value: String(state.braid * 100) });
      const braidVal = el('span', { class: 'field-val' }, `${Math.round(state.braid * 100)}% loops`);
      braid.addEventListener('input', () => { braidVal.textContent = `${braid.value}% loops`; });
      braid.addEventListener('change', () => { state.braid = +braid.value / 100; generate(); });
      sub.append(el('div', { class: 'field' }, [el('label', {}, 'Braiding'), braid, braidVal]));
    } else if (state.type === 'grid') {
      const toggles = [];
      if (state.domain === 'weighted') {
        const wt = el('input', { type: 'checkbox' });
        wt.checked = state.weighted;
        wt.addEventListener('change', () => { state.weighted = wt.checked; generate(); });
        toggles.push(el('label', { class: 'toggle' }, [wt, 'Weighted terrain']));
      } else {
        state.weighted = false; // uniform grid in the unweighted domain
      }
      const dg = el('input', { type: 'checkbox' });
      dg.checked = state.diagonal;
      dg.addEventListener('change', () => { state.diagonal = dg.checked; generate(); });
      toggles.push(el('label', { class: 'toggle' }, [dg, '8-direction (enables JPS)']));
      sub.append(el('div', { class: 'toggles' }, toggles));
      const wall = el('input', { type: 'range', min: '0', max: '35', value: String(state.wallDensity * 100) });
      const wallVal = el('span', { class: 'field-val' }, `${Math.round(state.wallDensity * 100)}% walls`);
      wall.addEventListener('input', () => { wallVal.textContent = `${wall.value}% walls`; });
      wall.addEventListener('change', () => { state.wallDensity = +wall.value / 100; generate(); });
      sub.append(el('div', { class: 'field' }, [el('label', {}, 'Obstacles'), wall, wallVal]));
    } else if (state.type === 'negative') {
      sub.append(el('div', { class: 'hint', html: 'A small <b>directed</b> graph with some negative edges. Dijkstra/A* can be wrong here — Bellman–Ford is the correct choice.' }));
    } else {
      sub.append(el('div', { class: 'hint', html: 'A jittered geometric mesh. Scale it up to hundreds of thousands of edges to feel why preprocessing wins — note some heavy algorithms auto-skip past their size guard.' }));
    }
  }
  renderSub();

  // seed + generate
  const seed = el('input', { type: 'number', value: String(state.seed), class: 'num' });
  seed.addEventListener('change', () => { state.seed = +seed.value || 1; });
  p.append(el('div', { class: 'field' }, [
    el('label', {}, 'Seed'),
    seed,
    el('button', { class: 'btn small', onclick: () => { state.seed = Math.floor(Math.random() * 1e6); seed.value = state.seed; generate(); } }, '🎲'),
  ]));
  p.append(el('button', { class: 'btn primary wide', onclick: () => generate() }, 'Generate graph'));
  p.append(el('div', { class: 'hint', html: 'Tip: <b>click</b> a node to set Start, <b>Shift-click</b> for Goal.' }));
}

function generate() {
  const t = state.size / 100;
  let result;
  if (state.type === 'maze') {
    const { cols, rows } = sizeFor('maze', t);
    result = generateMaze(cols, rows, { seed: state.seed, algorithm: state.mazeAlgo, braid: state.braid });
  } else if (state.type === 'grid') {
    const { cols, rows } = sizeFor('grid', t);
    result = generateGrid(cols, rows, {
      seed: state.seed, weighted: state.weighted, diagonal: state.diagonal, wallDensity: state.wallDensity,
    });
  } else if (state.type === 'negative') {
    result = generateNegativeGraph({ seed: state.seed });
  } else {
    const { n } = sizeFor('random', t);
    result = generateRandomGraph(n, { seed: state.seed });
  }
  return vis.setScenario(result);
}

vis.onEndpointsChanged = () => {};

// Shareable scenario state + scaling-benchmark config (consumed by tools.js).
vis.shareState = () => ({ section: 'graph', st: { ...state }, start: vis.start, goal: vis.goal, selected: [...vis.selected], focus: vis.focus });
vis.scalingConfig = {
  sizes: [400, 1500, 5000, 15000, 40000],
  makeGraph: (n) => generateRandomGraph(n, { seed: state.seed }),
};

installTools(vis);

(async () => {
  const shared = readStateFromURL();
  if (shared && shared.section === 'graph' && shared.st) Object.assign(state, shared.st);
  buildControls();
  await generate();
  if (shared && shared.section === 'graph') {
    if (Array.isArray(shared.selected) && shared.selected.length) {
      vis.selected = new Set(shared.selected);
      vis.focus = shared.focus || [...vis.selected][0];
      vis._syncAlgoChecks();
      vis._buildMetrics();
      vis._renderExplain();
    }
    if (Number.isInteger(shared.start) && Number.isInteger(shared.goal)) {
      vis.setEndpoints(shared.start, shared.goal);
    }
  }
})();
