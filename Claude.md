# Claude.md — Pathfinding Atlas

## What this is
An interactive, **fully educational** web app comparing shortest-path / routing
algorithms — from textbook Dijkstra to Customizable Contraction Hierarchies —
on two kinds of scenarios:

1. **Map** (`map.html`): a procedurally generated "fake Google Maps" road network
   (named cities, highways/arterials/local roads weighted by travel time).
2. **Graphs** (`graph.html`): mazes, weighted terrain grids, huge geometric
   graphs, and a negative-weight graph.

Plus a **Learn** page (`learn.html`) with long-form guides, per-algorithm
deep-dives, and a glossary. Inspired by Veritasium's *"How Does Google Maps
Actually Work?"*, extended with the production techniques.

## Project type & constraints
- **Pure static HTML/CSS/vanilla-JS (ES modules). No build step. No runtime
  dependencies.** This is deliberate — it must run under VS Code **Live Server**
  (or any static server). Don't introduce a bundler or framework.
- ES modules only load over `http://` (not `file://`) — use a static server.
- `jsdom` is a **dev-only** dependency for the headless test (installed on demand
  with `npm install --no-save jsdom`; never committed).

## How to run
- VS Code: right-click `index.html` → **Open with Live Server**.
- Or: `python3 -m http.server 8000` then open `http://localhost:8000`.

## The 13 algorithms (js/algorithms/, registered in index.js)
BFS, Dijkstra, Bellman–Ford, Greedy, A*, Bidirectional Dijkstra, Bidirectional
A* (consistent symmetric potentials), ALT, Contraction Hierarchies,
Customizable CH, **JPS** (8-connected uniform grids), **Theta\*** (any-angle),
**D\* Lite** (incremental). Every algorithm is a generator yielding step events
and returning `{ path, cost, stats }` (contract in `js/algorithms/common.js`).
Applicability guards live in `index.js` (`safeFor`).

## Features
Side-by-side races, live metrics, benchmark mode (speedups + optimality check),
**graph/maze editor** (paint walls/terrain, set endpoints), **CH/CCH
preprocessing animation**, **shareable URLs**, **scaling charts**, heatmaps,
playback controls, live traffic, PNG export, light/dark theme, keyboard
shortcuts (space=play, s=step, f=finish, r=reset, g=random, e=edit).

## Architecture
- `js/core/` — graph, priority-queue, runner (aux caching/benchmark), utils.
- `js/algorithms/` — the 13 algorithms + registry (`index.js`) + `common.js`.
- `js/generators/` — map, maze, grid, random-graph.
- `js/ui/` — renderer (canvas), playback, visualizer (shared engine), tools
  (editor/preprocess/share/charts/theme), editor, preprocess-view, charts,
  share, md, dom.
- `js/content/` — explanations(+extra), articles.
- `js/app/` — map-section, graph-section, learn (page entry points).

## Tests (Node; no browser needed)
```bash
node tests/verify-all.js        # all algorithms vs Dijkstra, 6 seeds (~6000 checks)
node tests/test-new-algos.js    # JPS / Theta* / D* Lite specific validators
node tests/integration.js       # imports resolve to real exports + DOM ids present
npm install --no-save jsdom && node tests/smoke.js   # headless DOM smoke (UI pipeline + tools)
```
All currently pass: verify-all 6082/0, new-algos 0 fails, integration ✓, smoke 18/18.

## How to continue
- Add an algorithm: drop a generator in `js/algorithms/`, register it in
  `index.js` (with any `needsGrid`/`uniformOnly`/`anyAngle` flags + `safeFor`
  considerations), add an `EXPLANATIONS` entry, and it appears everywhere.
- Run `node tests/verify-all.js` after any algorithm change — it's the safety net.
- The renderer is canvas-based with a cached base layer + incremental overlay;
  see `js/ui/renderer.js`.

## Notes / gotchas
- Bidirectional A* uses consistent symmetric potentials with a balance-
  independent stopping rule — the naive `topF+topB>=mu` rule is subtly wrong
  (it can return slightly-suboptimal paths). Don't "simplify" it back.
- CH/CCH/ALT/Bellman-Ford are size-guarded; JPS is 8-connected-uniform-grid-only;
  on the negative-weight graph only BFS/Bellman-Ford are enabled. All via `safeFor`.
- GitHub remote not yet set (gh CLI is missing the `workflow` scope this session).
