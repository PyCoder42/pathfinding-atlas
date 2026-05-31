// tests/smoke.js — headless DOM integration test (needs: npm install --no-save jsdom).
// Drives the real Visualizer + Renderer + Playback + generators against a
// stubbed canvas, exercising the full UI pipeline a browser would run.
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'fs';

const SKELETON = `<!DOCTYPE html><html><body>
  <div id="app">
    <section id="panel-scenario"></section>
    <section id="panel-algos"></section>
    <section id="panel-run"></section>
    <main id="panel-stage"></main>
    <section id="panel-metrics"></section>
    <section id="panel-explain"></section>
  </div></body></html>`;

const dom = new JSDOM(SKELETON, { pretendToBeVisual: true });
const { window } = dom;
const stubCtx = new Proxy(
  { measureText: () => ({ width: 8 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get(t, p) { return p in t ? t[p] : () => {}; }, set() { return true; } }
);
window.HTMLCanvasElement.prototype.getContext = () => stubCtx;
window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 600, left: 0, top: 0 });
global.window = window;
global.document = window.document;
global.Event = window.Event;
global.performance = window.performance;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.navigator = window.navigator;
Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
global.devicePixelRatio = 1;

const { Visualizer } = await import('../js/ui/visualizer.js');
const { generateMap } = await import('../js/generators/map.js');
const { generateMaze } = await import('../js/generators/maze.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

const root = window.document.getElementById('app');
const vis = new Visualizer(root, { section: 'map', defaultSelected: ['dijkstra', 'astar', 'bidirectional-astar', 'contraction-hierarchies'], defaultFocus: 'astar' });

check('algorithm panel built (10 algos)', root.querySelectorAll('.algo-row').length === 10);
check('run panel built', root.querySelector('.transport') != null);
check('explanation rendered', /A\*|Search/.test(root.querySelector('#panel-explain').textContent || ''));

const map = generateMap({ seed: 11, nodes: 600, cityCount: 8 });
await vis.setScenario(map);
await sleep(30);
check('renderers mounted', vis.renderers.length >= 1);
check('metrics rows == selected', root.querySelectorAll('.metrics tbody tr').length === 4);

vis.mode = 'benchmark';
vis._updateModeUI();
vis.queriesInput.value = '3';
await vis._runBenchmark();
await sleep(20);
const benchText = root.querySelector('#panel-metrics').textContent;
check('benchmark produced timings', /ms|µs/.test(benchText));
check('benchmark shows optimality', /optimal|✓|%/.test(benchText));

vis.mode = 'visualize';
vis._updateModeUI();
await vis._startVisualize();
vis.playback.skipToEnd();
await sleep(20);
check('visualize produced a drawn path', vis.renderers.some((r) => r.path && r.path.length > 1));
check('visualize filled metrics', [...root.querySelectorAll('.metrics tbody td')].filter((td) => td.textContent.trim() && td.textContent.trim() !== '—').length >= 12);

vis.selected = new Set(['astar']);
vis._buildMetrics();
await vis.setScenario(generateMaze(21, 15, { seed: 4, braid: 0.1 }));
await sleep(20);
await vis._startVisualize();
vis.playback.skipToEnd();
await sleep(20);
check('maze: single A* drew a path', vis.renderers.some((r) => r.path && r.path.length > 1));

const fails = results.filter((r) => !r.ok);
writeFileSync('/tmp/smoke.json', JSON.stringify({ total: results.length, failed: fails.length, results }, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
