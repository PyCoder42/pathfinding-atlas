# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is
**Pathfinding Atlas** — an interactive, educational web app comparing 13 shortest-path / routing algorithms (BFS → Dijkstra → A* → bidirectional → ALT → CH → CCH, plus JPS, Theta*, D* Lite) on a "fake Google Maps" road network and on weighted graphs/mazes, with a Learn section of guides. Pure static **HTML/CSS/vanilla ES modules — no build step, no runtime dependencies.** This is a hard constraint: it must run under VS Code Live Server / any static server. Do not add a bundler or framework. ES modules only load over `http://`/`https://`, never `file://`.

## Commands
```bash
# Run locally (either):
python3 -m http.server 8000          # then open http://localhost:8000
#   or VS Code: right-click index.html → Open with Live Server

# Tests are standalone Node scripts (package.json has "type":"module"); run one directly:
node tests/verify-all.js             # every algorithm vs Dijkstra, 6 seeds (~6000 checks). Pass a seed: `node tests/verify-all.js 777`
node tests/test-new-algos.js         # JPS / Theta* / D* Lite specific validators
node tests/integration.js            # every relative import resolves to a real export; required DOM ids exist
node tests/smoke.js                  # headless-DOM (jsdom) smoke of the whole UI pipeline incl. tools
node tests/browser-check.js [BASE]   # REAL Chromium check of every page (default BASE http://localhost:8011)

# Dev-only deps (NEVER committed — node_modules is gitignored):
npm install --no-save jsdom          # for smoke.js
npm install --no-save puppeteer      # for browser-check.js
```
There is no lint/build step. `node tests/verify-all.js` is the primary correctness gate — run it after any algorithm change.

## Deployment
Hosted on **GitHub Pages** (deploy-from-branch: `main` root) at https://pycoder42.github.io/pathfinding-atlas/. A `.nojekyll` file makes Pages serve the JS/CSS verbatim. Any push to `main` auto-redeploys in ~30–60s. All relative paths are written to work under the `/pathfinding-atlas/` subpath. To verify the deployed site: `node tests/browser-check.js https://pycoder42.github.io/pathfinding-atlas`.

## Architecture (the parts that span multiple files)

**The algorithm contract is the keystone.** Every algorithm in `js/algorithms/` is a *generator* (`function* algo(graph, start, goal, opts)`) that **yields** step events (`{type:'settle'|'discover'|'meet'|'found'|...}`) and **returns** `{ path, cost, stats }`. The same generator drives both the animation (stepped slowly) and the benchmark (drained as fast as possible) — see `js/algorithms/common.js` for the full contract and helpers (`makeStats`, `reconstructPath`, `stitchBidirectional`, `withPath`). When adding an algorithm, mirror `dijkstra.js`.

**The registry is the single source of truth** (`js/algorithms/index.js`): `ALGORITHMS` (metadata + flags), `byId`, `CATEGORIES`, and crucially `safeFor(algoId, graph)` — applicability guards (size limits, `needsGrid`/`needsDiagonal`/`uniformOnly`, non-negative-weight requirement). **Both the UI (`visualizer.js`) and the test harness (`verify-all.js`) import `safeFor`** so they never disagree about which algorithm runs on which graph. Adding an algorithm = drop the file, register it here (with flags), add an `EXPLANATIONS` entry — and it appears in both sections, the Learn page, and the tests automatically.

**One Graph type, set up by generators, read by everyone** (`js/core/graph.js`). Generators (`js/generators/{map,maze,grid,random-graph}.js`) build a `Graph` and tag it with fields that the renderer and algorithms rely on: `kind` (`'map'|'maze'|'grid'|'network'`), `grid {cols,rows,diagonal}`, `passable`, `terrain`/`terrainK`, `uniform`, `weightKind` (`'distance'|'time'`), and `speedLimit`. `graph.heuristic(a,b) = euclidean(a,b)/speedLimit` is the admissible heuristic used by A*/greedy/bidi-A*; the map sets `speedLimit = maxSpeed/60` so the time-weighted heuristic stays admissible. Grid id = `row*cols + col`.

**`Visualizer` is the shared engine for both sections** (`js/ui/visualizer.js`). The page-level entry points (`js/app/{map-section,graph-section,learn}.js`) build only their scenario controls, then call `vis.setScenario(...)`, set `vis.shareState`/`vis.scalingConfig`, and call `installTools(vis)`. The Visualizer owns algorithm selection, the animate/race grid, benchmark mode, live metrics, and the explanation panel. Single selection → one full renderer with pan/zoom + click-to-set-endpoints; multiple → a synchronized small-multiples grid.

**Rendering is layered for performance** (`js/ui/renderer.js`): a cached offscreen *base* layer (graph drawn once per view change), an incremental *overlay* (only changed nodes repainted per frame via a dirty queue), an *annotation* layer (CH/CCH shortcuts + rank coloring), then path + markers. `applyEvent()` is cheap (state only); `render()` composites. Two draw styles: grid/maze (cells + walls) and network/map (nodes + classed road edges).

**Preprocessing is cached on the graph** (`js/core/runner.js`): `getAux`/`makeQuery`/`benchmark` run an algorithm's `preprocess` generator once per graph (keyed by id on `graph._auxCache`) and inject the result via `opts[optsKey]`. `clearAux(graph)` is called when edge weights change (e.g. map traffic, editor edits).

**Interactive tools live in `js/ui/tools.js`** (installed onto the Visualizer): the grid/maze editor (`editor.js`), CH/CCH preprocessing animation (`preprocess-view.js`), shareable URLs (`share.js`), scaling charts (`charts.js`), PNG export, theme, keyboard shortcuts (space=play, s=step, f=finish, r=reset, g=random, e=edit). These bind to `vis.mainRenderer` and re-bind on `vis.onScenarioChange`.

## Non-obvious gotchas (don't regress these)
- **Bidirectional A*** uses consistent *symmetric potentials* with a *balance-independent* stop rule (stop when each side's min key passes its own `mu - C`/`mu - D` threshold). The intuitive `topF + topB >= mu` rule starves one side and returns slightly-suboptimal paths. Do not "simplify" it back.
- **JPS** is valid only on 8-connected *uniform-cost* grids (guarded via `needsDiagonal`+`uniformOnly`). **Theta*** is any-angle: its cost is intentionally *less* than grid-Dijkstra, so it's flagged `anyAngle` and excluded from the optimal-vs-Dijkstra assertions (it has its own validator in `test-new-algos.js`). On the negative-weight graph only BFS/Bellman-Ford are enabled.
- **CH/CCH/ALT correctness** is fragile (shortcut unpacking, backward up-adjacency orientation, witness search). Always re-run `verify-all.js` after touching them.
- Educational/long-form content is split: base entries in `js/content/explanations.js`, the three newer algorithms in `explanations-extra.js`. Both the Visualizer and the Learn page **merge** them — keep that merge when adding content.
