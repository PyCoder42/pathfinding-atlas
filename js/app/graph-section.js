// graph-section.js — entry point for the abstract weighted-graph section
// (mazes, weighted terrain grids, large geometric graphs, negative weights).

import { Visualizer } from '../ui/visualizer.js';
import { generateMaze } from '../generators/maze.js';
import { generateGrid } from '../generators/grid.js';
import { generateRandomGraph, generateNegativeGraph } from '../generators/random-graph.js';
import { el, clear } from '../ui/dom.js';
import { fmtInt } from '../core/utils.js';

const root = document.querySelector('#app');
const vis = new Visualizer(root, {
  section: 'graph',
  defaultSelected: ['dijkstra', 'astar', 'greedy', 'bidirectional-dijkstra'],
  defaultFocus: 'astar',
});

const state = {
  type: 'maze',
  size: 46,
  seed: 1,
  mazeAlgo: 'backtracker',
  braid: 0.08,
  diagonal: false,
  weighted: true,
  wallDensity: 0,
};

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

  // type
  const typeSel = el('select', { class: 'select' }, [
    el('option', { value: 'maze' }, 'Maze'),
    el('option', { value: 'grid' }, 'Weighted terrain grid'),
    el('option', { value: 'random' }, 'Large geometric graph'),
    el('option', { value: 'negative' }, 'Negative weights (Bellman–Ford)'),
  ]);
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
      const wt = el('input', { type: 'checkbox' });
      wt.checked = state.weighted;
      wt.addEventListener('change', () => { state.weighted = wt.checked; generate(); });
      const dg = el('input', { type: 'checkbox' });
      dg.checked = state.diagonal;
      dg.addEventListener('change', () => { state.diagonal = dg.checked; generate(); });
      sub.append(el('div', { class: 'toggles' }, [
        el('label', { class: 'toggle' }, [wt, 'Weighted terrain']),
        el('label', { class: 'toggle' }, [dg, '8-direction']),
      ]));
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
  vis.setScenario(result);
}

vis.onEndpointsChanged = () => {};
buildControls();
generate();
