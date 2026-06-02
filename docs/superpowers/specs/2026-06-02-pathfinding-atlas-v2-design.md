# Pathfinding Atlas v2 — Design

Date: 2026-06-02
Status: Approved (design); implementation pending

## Goal

Turn the educational pathfinding app into a polished, professional product that
clearly tells the "How does Google Maps actually work?" story, separates
**unweighted** (fewest-steps) from **weighted** (lowest-cost) algorithms, routes
on a **real map** (Leaflet + OpenStreetMap tiles), and labels which algorithms
are optimal and which ones production routers (CH/CCH) actually use.

### Acceptance criteria
- All four pages load and are fully functional (incl. real Chromium check).
- `node tests/verify-all.js` and the other test scripts pass after every change.
- Weighted vs unweighted separation shipped (Graphs page tabs).
- Map page renders a real OSM tile basemap with the search animating on top,
  with a graceful canvas-only fallback when tiles/data are unavailable.
- Each algorithm shows a clear one-line purpose; CH & CCH badged "Used by
  Google Maps"; non-optimal algorithms are grouped and annotated.
- Comprehensive, professional visual redesign (design-token system).
- The small fixes from the request are all done (see §4).

## Constraints
Pure static HTML/CSS/vanilla ES modules, no build step, runs under any static
server. **Deliberate exception (documented in CLAUDE.md):** the Map page vendors
Leaflet locally (`js/vendor/leaflet.{js,css}`) and fetches OSM raster tiles at
runtime — so the Map page needs network for tiles, with a canvas fallback when
offline. Everything else stays self-contained and offline-capable.

## 1. Page architecture (4 pages, non-overlapping)
- **Home** (`index.html`): the Google-Maps narrative (BFS/Dijkstra → A* →
  Contraction Hierarchies → live traffic), pitch, dynamic algorithm count, CTAs.
- **Map** (`map.html`): applied single-algorithm routing on a real Leaflet/OSM
  basemap. City picker (Monaco / Midtown Manhattan / Cambridge), From/To,
  traffic. The "looks like Google Maps" page.
- **Graphs** (`graph.html`): the lab, with **Unweighted | Weighted** tabs.
  - Unweighted: BFS, DFS, Bidirectional BFS on mazes & uniform grids.
  - Weighted: Dijkstra, A*, Greedy, ALT, CH, CCH, bidirectional variants,
    Bellman–Ford, JPS, Theta*, D* Lite on synthetic weighted graphs/terrain/
    meshes. Racing, benchmark, scaling charts, editor.
- **Learn** (`learn.html`): guides + glossary, same narrative spine.

## 2. Map page (Leaflet + OSM)
- **Data**: re-bake Monaco / Manhattan / Cambridge from Overpass storing per-node
  `lat`/`lng` (plus existing travel-time weights and road class). `data/*.json`
  schema gains `lat:[]`, `lng:[]` (or `ll:[[lat,lng],…]`); km `x`/`y` retained
  for the admissible heuristic. `tools/bake-osm.js` updated; if any city's
  Overpass fetch fails, that city ships with the current canvas renderer.
- **Library**: vendor Leaflet locally (UMD global `L`, loaded via `<script>`
  before module scripts). No CDN runtime dependency.
- **Rendering**: a Leaflet map with an OSM `TileLayer`, plus a canvas overlay
  pane synced to Leaflet `move`/`zoom`. Nodes positioned by lat/lng → layer
  point. The search animation (settled / frontier / path / markers) draws on the
  overlay. Click = set From, Shift-click = set To (lat/lng → nearest node).
- **Fallback**: if Leaflet/tiles/data are unavailable (offline, `file://`, fetch
  failure), the Map page uses the existing self-contained canvas renderer so it
  is never broken.
- Multi-algorithm racing lives on the Graphs page; Map stays single-focus.

## 3. Algorithm UX
- Selection grouped by **domain** (`DOMAINS`: unweighted / weighted). Within a
  domain, split **Recommended** vs a collapsed **"Won't return the shortest path
  here"** group, computed from `safeFor` + `optimal`/`domain`/`anyAngle` flags
  (BFS/DFS/Greedy on weighted graphs, Theta* any-angle, etc.).
- **Optimality note** in the sandbox while running: states whether the selected
  algorithm returns the optimal path on the *current* graph. Examples:
  - DFS → "finds *a* path, not the shortest."
  - BFS on weighted → "minimizes hops, not travel time → not optimal here."
  - Dijkstra/A*/ALT/CH/CCH → "provably shortest."
- **Purpose** string shown per algorithm (already authored in the registry).
- **CH & CCH** badged "Used by Google Maps" (registry `production` flag).

## 4. Small fixes
- Home strip "Ten algorithms, one common engine" → number rendered **in words**,
  derived dynamically from `ALGORITHMS.length` (helper `numberToWords`).
- **Logo acts as Home**, linking to `./` so the URL drops `index.html`; the Home
  nav link also points to `./`.
- **Remove** the top-right `.ghost` algorithm-name strip on all pages.

## 5. Visual redesign (comprehensive)
- Design-token system in CSS custom properties: color palette (Maps-inspired,
  lighter, professional), type scale, spacing, radius, shadow, motion.
- Rebuilt components: nav (logo-as-home + active states), buttons, cards,
  selects, panels, tabs, and **badges** (Optimal / Not optimal / Used by Google
  Maps). Responsive. Keep the per-letter Google wordmark. Light primary with
  refined dark parity via the existing theme toggle.

## 6. Testing & quality
- Correctness gate after every algorithm/registry change: `node tests/verify-all.js`
  (+ `test-new-algos.js`, `integration.js`, `smoke.js`). Extend tests to cover
  the new DFS/Bi-BFS domains and the `safeFor` grouping logic.
- `node tests/browser-check.js` (real Chromium) across all four pages.
- Run `/simplify` and a `/systematic-debugging` pass; fix all bugs.
- `/ultrareview` is user-triggered & billed — flag the right moment; do not
  attempt to launch it.

## 7. Implementation phases (orchestrated, main kept green, commit per phase)
- **A — Map**: Overpass re-bake (+ schema), Leaflet vendor + map renderer +
  overlay sync + fallback.
- **B — Graphs**: Unweighted/Weighted tabs; algorithm grouping + optimality
  notes; CH/CCH labeling; test coverage.
- **C — Polish**: design-token redesign; small fixes (dynamic count, logo→home,
  remove ghost); Home/Learn narrative content.
- **D — Hardening**: test/debug/simplify sweep; browser-check; CLAUDE.md update.

## Risks
- **Overpass availability** is the main external risk — mitigated by the
  per-city canvas fallback and by de-risking the fetch before the full build.
- **Leaflet ↔ canvas overlay alignment**: validate projection (lat/lng → layer
  point) against tile streets early on Monaco (smallest city).
- Renderer changes must not regress the Graphs page (keep the canvas renderer
  intact for synthetic graphs).
