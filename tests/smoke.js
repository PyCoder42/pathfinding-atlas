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
// keep Node's native global.performance (jsdom's recurses with Node 24)
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
try { Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true }); } catch (e) {}
try { Object.defineProperty(global, 'location', { value: window.location, configurable: true }); } catch (e) {}
Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
global.devicePixelRatio = 1;

const { Visualizer } = await import('../js/ui/visualizer.js');
const { ALGORITHMS } = await import('../js/algorithms/index.js');
const { generateMap } = await import('../js/generators/map.js');
const { generateMaze } = await import('../js/generators/maze.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

const root = window.document.getElementById('app');
const vis = new Visualizer(root, { section: 'map', defaultSelected: ['dijkstra', 'astar', 'bidirectional-astar', 'contraction-hierarchies'], defaultFocus: 'astar' });

check(`algorithm panel built (${ALGORITHMS.length} algos)`, root.querySelectorAll('.algo-row').length === ALGORITHMS.length);
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

// ── tools / editor / preprocess-view / share / charts ──────────────────────
const { installTools } = await import('../js/ui/tools.js');
const { createEditor } = await import('../js/ui/editor.js');
const { createPreprocessView } = await import('../js/ui/preprocess-view.js');
const { drawLineChart } = await import('../js/ui/charts.js');
const share = await import('../js/ui/share.js');

vis.shareState = () => ({ section: 'graph', st: { seed: 5 }, start: vis.start, goal: vis.goal, selected: [...vis.selected], focus: vis.focus });
vis.scalingConfig = { sizes: [100, 300], makeGraph: (n) => generateMaze(10, 10, { seed: 1 }) };
let toolsThrew = false;
try { installTools(vis); } catch (e) { toolsThrew = true; results.push({ name: 'installTools threw: ' + e.message, ok: false }); }
check('tools installed', !toolsThrew);
check('tools panel rendered', !!root.querySelector('.tools'));
check('tools buttons present', root.querySelectorAll('.tools .btn').length >= 4);

// editor: paint a wall on a maze cell via a synthetic canvas event
let edOk = false;
try {
  const r = vis.mainRenderer;
  const g = vis.graph;
  if (r && g.grid) {
    const cell = 0;
    const [sx, sy] = r.worldToScreen(g.x[cell], g.y[cell]);
    const ed = createEditor(r, { onMutate: () => {}, onSetStart: () => {}, onSetGoal: () => {} });
    const before = g.adj[cell].length;
    ed.enable('wall');
    const down = new window.MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(down, 'offsetX', { value: sx });
    Object.defineProperty(down, 'offsetY', { value: sy });
    r.canvas.dispatchEvent(down);
    window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    edOk = before > 0 && g.adj[cell].length === 0 && g.passable && g.passable[cell] === 0;
    ed.disable();
  }
} catch (e) { results.push({ name: 'editor threw: ' + e.message, ok: false }); }
check('editor paints a wall (mutates graph)', edOk);

// preprocess-view: run CH preprocessing animation
let pvOk = false;
try {
  const r = vis.mainRenderer;
  const pv = createPreprocessView(r);
  pv.run('contraction-hierarchies', { onInfo: () => {}, onDone: () => {} });
  await sleep(80);
  pvOk = !!r.annotations && Array.isArray(r.annotations.shortcuts);
  pv.clear();
} catch (e) { results.push({ name: 'preprocess threw: ' + e.message, ok: false }); }
check('preprocess-view runs + annotates', pvOk);

// share round-trip + URL
const st = { section: 'graph', st: { seed: 5, type: 'maze' }, start: 1, goal: 9, selected: ['astar', 'dijkstra'], focus: 'astar' };
check('share encode/decode round-trip', JSON.stringify(share.decodeState(share.encodeState(st))) === JSON.stringify(st));
const surl = share.buildShareURL(st);
window.location.hash = surl.substring(surl.indexOf('#'));
const fromUrl = share.readStateFromURL();
check('share read-from-URL', !!fromUrl && fromUrl.start === 1 && fromUrl.section === 'graph');

// charts draw (stub canvas)
let chOk = false;
try {
  const cc = window.document.createElement('canvas');
  drawLineChart(cc, { series: [{ label: 'a', color: '#f00', points: [[1, 2], [10, 20], [100, 5]] }], title: 't', xLabel: 'x', yLabel: 'y', logX: true, logY: true });
  chOk = true;
} catch (e) { results.push({ name: 'charts threw: ' + e.message, ok: false }); }
check('charts drawLineChart no-throw', chOk);

const fails = results.filter((r) => !r.ok);
writeFileSync('/tmp/smoke.json', JSON.stringify({ total: results.length, failed: fails.length, results }, null, 2));
process.exit(fails.length === 0 ? 0 : 1);
