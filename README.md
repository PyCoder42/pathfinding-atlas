# 🗺️ Pathfinding Atlas

An interactive, **fully educational** lab for the algorithms behind modern
routing — from textbook Dijkstra all the way to **Customizable Contraction
Hierarchies**, the technique production routers actually use. Inspired by
Veritasium's *"How Does Google Maps Actually Work?"*, extended with the real
machinery (ALT, CH, CCH) and a lot more depth.

Pure **HTML / CSS / vanilla JavaScript** (ES modules) — no build step, no
dependencies. Just open it with a static server.

---

## ▶️ Running it

This app uses ES modules, which browsers only load over **http://** (not
`file://`). Use any static server:

**VS Code Live Server (recommended)**
1. Open this folder in VS Code.
2. Install the *Live Server* extension (Ritwick Dey) if you don't have it.
3. Right-click `index.html` → **“Open with Live Server”**.

**Or from a terminal**
```bash
cd mapping-algorithms
python3 -m http.server 8000      # then open http://localhost:8000
# or:  npx serve .
```

Open **`index.html`** to start.

---

## 🧭 The two sections

### 1. Map — a fake Google Maps
A procedurally generated road network with named **cities**, **towns**, and
**junctions**, wired by **highways / arterials / local roads**, each with a
speed limit. Edges are weighted by **travel time**, so the shortest path is the
**fastest route** — exactly like a real router.

- Pick **From / To** cities (dropdowns or click the map; Shift-click sets the
  destination).
- Add **traffic** (free-flow → rush hour) and watch why preprocessed methods
  must re-customize when weights change.
- Resize the region from a small town to a dense metro.

### 2. Graphs & Mazes — abstract weighted graphs
- **Mazes** (recursive backtracker / Prim's, with adjustable braiding/loops).
- **Weighted terrain grids** (4- or 8-direction, obstacles, value-noise
  terrain — beautiful with the heatmap on).
- **Large geometric graphs** — scale into the hundreds of thousands of edges to
  feel why preprocessing wins.
- **Negative-weight graph** — where Dijkstra/A\* are invalid and **Bellman–Ford**
  is the correct choice (the app guards the others automatically).

---

## 🧠 The ten algorithms

| Algorithm | Category | Optimal | Notes |
|---|---|---|---|
| Breadth-First Search | Classic | unweighted only | fewest-hops baseline |
| Dijkstra | Classic | ✓ | uniform-cost baseline |
| Bellman–Ford | Classic | ✓ | handles **negative** weights, detects cycles |
| Greedy Best-First | Informed | ✗ | fast, heuristic-only, not optimal |
| A\* | Informed | ✓ | Dijkstra + straight-line heuristic |
| Bidirectional Dijkstra | Bidirectional | ✓ | meet-in-the-middle, ~½ the work |
| Bidirectional A\* | Bidirectional | ✓ | consistent symmetric potentials |
| ALT (A\* + Landmarks) | Speedup | ✓ | sharp triangle-inequality heuristic |
| Contraction Hierarchies | Hierarchical | ✓ | preprocess into shortcuts → µs queries |
| Customizable CH | Hierarchical | ✓ | metric-independent + fast re-customization |

All are verified against Dijkstra for optimality (see **Testing** below).

---

## ✨ Features

- **Visualize** any subset together — 1 algorithm in full detail, or many in a
  synchronized **small-multiples race**.
- **Live metrics**: nodes settled, frontier peak, path cost, hops, query time,
  preprocessing time — updating as the search runs.
- **Benchmark mode**: average query time over N random routes (same routes for
  every algorithm), with **speedup vs Dijkstra** and an automatic
  **optimality check** (✓ / % optimal).
- **Playback controls**: play / pause / single-step / skip-to-result, plus a
  speed slider from slow to turbo.
- **Heatmap** of search depth, toggles for frontier / edges / labels.
- **Pan & zoom** (drag + wheel), click-to-set endpoints, hover tooltips.
- **Live traffic** on the map, demonstrating CCH's re-customization story.
- **Size guards** that gracefully skip algorithms too heavy for a given graph
  (e.g. Bellman–Ford on huge graphs, CH/CCH preprocessing past a threshold).
- **Export** results to JSON.
- **Learn page**: 8 long-form guides, per-algorithm deep-dives (summary, how it
  works, complexity, pros/cons, pseudocode, the Veritasium connection), and a
  glossary.

---

## 📁 Project structure

```
mapping-algorithms/
├── index.html              Landing page
├── map.html                Fake-Google-Maps section
├── graph.html              Mazes / grids / large graphs section
├── learn.html              Guides, deep-dives, glossary
├── css/style.css           Design system
├── js/
│   ├── core/
│   │   ├── graph.js            Graph data structure (coords + weights)
│   │   ├── priority-queue.js   Binary min-heap (lazy deletion)
│   │   ├── runner.js           Aux/preprocess caching + benchmarking
│   │   └── utils.js            RNG, formatting, color ramps
│   ├── algorithms/
│   │   ├── common.js           Shared event/Result contract
│   │   ├── index.js            Algorithm registry
│   │   ├── bfs.js dijkstra.js astar.js greedy.js bellman-ford.js
│   │   ├── bidirectional-dijkstra.js  bidirectional-astar.js
│   │   ├── alt.js  contraction-hierarchies.js  customizable-ch.js
│   ├── generators/
│   │   ├── map.js  maze.js  grid.js  random-graph.js
│   ├── ui/
│   │   ├── renderer.js  playback.js  visualizer.js  md.js  dom.js
│   ├── content/
│   │   ├── explanations.js  articles.js
│   └── app/
│       ├── map-section.js  graph-section.js  learn.js
└── tests/correctness.js    Node validation harness
```

Every algorithm is a **generator** that *yields* step events (for animation)
and *returns* a result `{ path, cost, stats }` (for benchmarking) — the same
code drives both. See `js/algorithms/common.js` for the contract.

---

## ✅ Testing

Three Node-based test layers (no browser required):

```bash
# 1. Algorithm correctness — every algorithm vs Dijkstra across maps, grids,
#    mazes, random graphs, and the negative-weight graph. Deterministic
#    (seeded); checks path validity, cost == true path weight, optimality, and
#    edge cases. ~2,566 checks per seed.
node tests/correctness.js            # default seed
node tests/correctness.js 99999      # any seed

# 2. Static integration — every cross-module import resolves to a real export,
#    and the DOM ids the UI queries exist in the HTML.
node tests/integration.js

# 3. Headless DOM smoke (optional, needs jsdom) — drives the real Visualizer +
#    Renderer + Playback against a stubbed canvas: build panels, generate a
#    scenario, benchmark, animate to completion, confirm a path is drawn.
npm install --no-save jsdom && node tests/smoke.js
```

All three pass clean. Algorithm correctness was verified across multiple random
seeds; bidirectional A* in particular uses consistent symmetric potentials so it
is provably optimal (not the naive two-heuristic version, which silently returns
slightly-too-long paths).

---

## 📚 Credits

Built as an educational sandbox. The narrative arc — model the map as a graph,
add a heuristic, search from both ends, then precompute shortcuts — follows
Veritasium's *"How Does Google Maps Actually Work?"*, with the production-grade
techniques (ALT, Contraction Hierarchies, Customizable CH) and full
explanations added on top.
