// articles.js — long-form learning guides + glossary for the Learn page.
// Bodies are Markdown (rendered by ui/md.js). Avoid backticks inside these
// template literals; use **bold**/*italic* instead.

export const ARTICLES = [
  {
    id: 'how-maps-work',
    category: 'Overview',
    title: 'How Does Google Maps Actually Find Your Route?',
    body: `
When you ask a map app for directions, it answers in well under a second — even though it is searching a road network with **hundreds of millions of intersections** spanning a continent. How? This whole project is a hands-on tour of the ideas that make that possible, in the spirit of Veritasium's video *"How Does Google Maps Actually Work?"* — but with the algorithms laid bare so you can run them yourself.

## Step 1: turn the map into a graph

Every intersection becomes a **node**; every road segment becomes an **edge** with a **weight**. The weight is usually *travel time* (segment length ÷ speed limit), so the "shortest" path is really the **fastest** route. In this app's map section, that is exactly how roads are weighted — highways are fast, local streets are slow.

## Step 2: the textbook answer, and why it is too slow

The classic algorithm for shortest paths on a weighted graph is **Dijkstra's algorithm**. It is correct and elegant, but it is *uninformed*: it expands outward in every direction equally, like a balloon inflating from the start. To route from Los Angeles to New York it would explore halfway to the Arctic and deep into Mexico before reaching the goal. On a continental graph that is hundreds of millions of node expansions — far too slow for an interactive app.

## Step 3: give the search a sense of direction

**A\\*** keeps Dijkstra's correctness but adds a **heuristic**: a guess of how far each node still is from the goal, usually the straight-line distance. Now the search leans toward the destination, exploring an ellipse instead of a circle. As long as the heuristic never *overestimates* (it is **admissible**), A\\* still returns the optimal route.

You can sharpen the heuristic dramatically with **landmarks (ALT)**: precompute exact distances from a few reference points, then use the triangle inequality to get a much tighter, still-admissible bound — so the search barely strays from the ideal path.

## Step 4: search from both ends

A **bidirectional** search runs one search from the start and another backward from the goal, meeting in the middle. Two small explored regions cover far less area than one big one — a clean ~2× win that also underpins the heavy machinery below.

## Step 5: precompute the hard part

Even a great A\\* is too slow at continental scale if you start from scratch every query. The production trick is **preprocessing**. **Contraction Hierarchies (CH)** spend a one-time effort ranking nodes by importance and adding **shortcut** edges, so that an actual query only walks a short way "uphill" in importance from each end and meets near the top. Queries drop from "explore a million nodes" to "explore a few hundred" — microseconds.

## Step 6: cope with live traffic

CH bakes the weights into its shortcuts, so when traffic changes you would have to redo all that work. **Customizable Contraction Hierarchies (CCH)** fix this by splitting preprocessing into a weight-free structural phase (done once) and a cheap **customization** phase that re-pours the current weights in milliseconds. That is how the map can re-route around a jam that appeared two minutes ago.

## Try it

Open the **Map** section and race Dijkstra against A\\*, bidirectional search, and CH on the same route. Then open the **Graphs** section and watch the same algorithms attack mazes and huge weighted grids. Use **Benchmark** mode to see CH and CCH leave everything else behind as the graph grows. The rest of these guides dig into each idea in detail.
`,
  },
  {
    id: 'dijkstra-vs-astar',
    category: 'Foundations',
    title: 'From Dijkstra to A*: Adding a Sense of Direction',
    body: `
## Uniform-cost search

**Dijkstra's algorithm** maintains a tentative distance for every node and repeatedly **settles** the closest unsettled one, relaxing its edges. The key invariant: when a node is settled, its shortest distance is final. This holds only because edge weights are **non-negative** — nothing discovered later can undercut a node that was already the cheapest on the frontier.

Because Dijkstra has no notion of *where the goal is*, it expands in concentric shells of equal distance. Watch it in the visualizer: the explored region is a near-perfect disk centred on the start. Every node in that disk was settled before the goal was reached — most of that work was wasted.

## The heuristic

**A\\*** changes the priority used to order the frontier. Instead of g(n) — the cost from the start — it uses

> f(n) = g(n) + h(n)

where **h(n)** estimates the remaining cost to the goal. With the straight-line distance as h, nodes that are both cheap to reach and *pointed at the goal* get expanded first. The explored region stretches into an **ellipse** with the start and goal at its focal points.

## Admissibility and consistency

A\\* is **optimal** as long as h is **admissible** — it never overestimates the true remaining cost. The straight-line distance is admissible on a map because no road can be shorter than a straight line (and we divide by the maximum speed so the time estimate stays a lower bound).

A stronger property is **consistency** (or *monotonicity*): for every edge u→v, h(u) ≤ w(u,v) + h(v). A consistent heuristic is automatically admissible, and it guarantees each node is settled at most once — so A\\* runs as cleanly as Dijkstra, just more focused.

## The spectrum

- **h ≡ 0** → A\\* *is* Dijkstra (no direction).
- **h = true remaining cost** → A\\* walks straight to the goal with zero waste.
- **h between** → the better the estimate, the tighter the search.

Push h too far (overestimate) and you get speed at the cost of optimality — which is exactly **Greedy Best-First Search** and **weighted A\\***, covered in the heuristics guide.
`,
  },
  {
    id: 'heuristics',
    category: 'Foundations',
    title: 'Heuristics, Admissibility, and Why They Matter',
    body: `
A **heuristic** h(n) is an estimate of the cost remaining from node n to the goal. It is the single most important lever in informed search.

## Admissible = never overestimates

If h(n) ≤ (true cost from n to goal) for every node, h is **admissible**, and A\\* is guaranteed to return an optimal path. Intuition: an admissible h can only ever make A\\* *postpone* expanding a node, never wrongly discard the optimal route.

## Consistent = locally sane

h is **consistent** (monotone) if for every edge u→v with weight w:

> h(u) ≤ w + h(v)

Consistency implies admissibility and guarantees the f-values never decrease along a path, so each node is settled once. Most geometric heuristics (straight-line distance, landmark bounds) are consistent.

## The speed–optimality tradeoff

The closer h is to the true remaining cost, the fewer nodes A\\* explores. This tempts you to *inflate* the heuristic:

| Heuristic | Behaviour |
| --- | --- |
| h = 0 | Dijkstra — optimal, slow |
| h = admissible estimate | A\\* — optimal, focused |
| h = ε-inflated (weighted A\\*) | faster, at most ε× longer paths |
| h = pure estimate, g ignored | Greedy — fast, no optimality |

**Weighted A\\*** uses f = g + ε·h with ε > 1. It explores less and returns paths guaranteed within a factor ε of optimal — a knob real systems use when "good and fast" beats "perfect and slow".

## Greedy: the degenerate case

**Greedy Best-First Search** orders the frontier by h alone (g ignored). It is the extreme end of inflating the heuristic: very fast, frequently wrong. In the visualizer, watch Greedy sprint toward the goal and then get trapped behind a maze wall, while A\\* calmly finds the true shortest path. The lesson: a heuristic should *guide* the search, not *replace* the accounting of cost already spent.
`,
  },
  {
    id: 'bidirectional',
    category: 'Techniques',
    title: 'Meeting in the Middle: Bidirectional Search',
    body: `
## The area argument

A search that explores everything within distance r covers an area proportional to r² (in 2D) or even more on real graphs. If instead you run **two** searches — one forward from the start, one backward from the goal — each only needs to reach distance r/2 before they meet. Two circles of radius r/2 have *half* the combined area of one circle of radius r. That is the entire intuition: meeting in the middle roughly halves the work.

## Running two Dijkstras at once

The forward search relaxes outgoing edges from the start; the backward search relaxes **incoming** edges from the goal (so you need the reverse graph). Each maintains its own distances, parents, and priority queue. Whenever a node x has been reached from **both** sides, distF(x) + distB(x) is a candidate path length; we track the best such value, μ, and the node where it occurred.

## The subtle stopping rule

The tempting mistake is to stop the moment the two frontiers touch. **That can miss the optimal path** — the first meeting is not necessarily the best one. The correct rule is to stop only when

> (smallest key in forward queue) + (smallest key in backward queue) ≥ μ

At that point no undiscovered meeting could be cheaper than the best already found. This is the condition implemented here, and it keeps the result provably optimal.

## Bidirectional A*

Adding heuristics to *both* directions is harder than it looks, because the forward and backward heuristics must be **consistent with each other** or optimality breaks. The standard fix is **symmetric (averaged) potentials**: reduce edge costs by p_f(v) = (h_goal(v) − h_start(v)) / 2 forward and its negation backward. The queues are ordered by reduced cost, distances are kept in true cost, and termination uses μ plus a constant offset. The payoff is a search that is both goal-directed *and* meets in the middle — and the difficulty of getting it exactly right is a big reason production systems prefer the preprocessing techniques next.
`,
  },
  {
    id: 'landmarks-alt',
    category: 'Techniques',
    title: 'Landmarks and the Triangle Inequality (ALT)',
    body: `
The straight-line heuristic is admissible but often *weak*: near a coastline, a canyon, or a river with few bridges, the true driving distance is far larger than the crow-flies distance, so A\\* still explores a lot. **ALT** (A\\*, Landmarks, Triangle inequality) builds a much sharper heuristic from a little precomputation.

## Precompute landmark distances

Pick a small set of **landmarks** — a dozen or so well-spread nodes. For each landmark L, run one Dijkstra to record the exact distance from L to every node (and, on directed graphs, from every node to L). This costs one Dijkstra per landmark and O(L · V) memory.

## The triangle inequality

For any landmark L, node v, and goal t, distances obey the triangle inequality, giving two lower bounds on dist(v, t):

> dist(v, t) ≥ dist(L, t) − dist(L, v)
>
> dist(v, t) ≥ dist(v, L) − dist(t, L)

Both are valid lower bounds, so we take the **maximum** over all landmarks and both forms (clamped at zero). Because each term is a difference of *exact* distances, the bound captures real detours that straight-line distance misses — it "knows" about the bridge you must cross.

## Choosing landmarks

Good landmarks lie *beyond* the regions you route through — think corners of the map. A common method is **farthest-point selection** (used here): start somewhere, repeatedly add the node farthest from all chosen landmarks. Better landmark sets give sharper bounds and faster queries; poor ones barely beat straight-line distance.

## Tradeoffs

ALT is optimal (the bound is admissible) and can cut A\\*'s explored nodes by a large factor. The costs are preprocessing time, O(L·V) memory, and **metric dependence**: the stored distances assume a fixed cost model, so changing the weights (traffic!) means recomputing them. That limitation is exactly what contraction-based methods and CCH address.
`,
  },
  {
    id: 'contraction-hierarchies',
    category: 'Preprocessing',
    title: 'Contraction Hierarchies: Shortcuts to Speed',
    body: `
Heuristics and bidirectional search help, but at continental scale even a great A\\* explores too much if it begins each query from raw roads. **Contraction Hierarchies (CH)** invest a one-time preprocessing effort so that queries become almost free.

## Importance and contraction

Assign every node an **importance rank**, then process nodes from least to most important. **Contracting** a node v means removing it and asking, for each pair of its neighbours u and w: *was v the only shortest path between them?* If so, add a **shortcut** edge u→w with weight dist(u,v)+dist(v,w) and remember that its "middle" was v.

To decide whether the shortcut is necessary, run a small, local **witness search** — a bounded Dijkstra from u that avoids v. If it finds an alternative route to w no longer than the candidate, no shortcut is needed. (A truncated witness search just adds a harmless extra shortcut: never wrong, only slightly slower.)

## Ordering matters

Contracting nodes in a bad order produces a blizzard of shortcuts. CH chooses the order greedily by an **edge-difference** heuristic — prefer contracting nodes that add few shortcuts relative to the edges they remove — plus terms that spread contraction across the graph. Highways naturally end up *important* (high rank); cul-de-sacs end up unimportant (low rank).

## The query: only ever go uphill

After preprocessing, every edge (original or shortcut) connects a lower rank to a higher rank. A query runs a **bidirectional search that only follows edges to higher rank**. The forward search climbs from the start, the backward search climbs from the goal, and they meet near the top of the hierarchy. Each side touches only a handful of nodes — this is why queries take microseconds.

## Unpacking

The meeting path is riddled with shortcuts, so a final step **unpacks** them: each shortcut is recursively replaced by its two halves (using the stored middle node) until only real road segments remain. The unpacked path has exactly the optimal cost the query computed.

Open **Benchmark** mode and grow the graph: CH pays a visible preprocessing cost once, then its per-query time and "settled" count stay tiny while Dijkstra's explode.
`,
  },
  {
    id: 'cch-and-traffic',
    category: 'Preprocessing',
    title: 'Customizable CH and Living With Traffic',
    body: `
Plain Contraction Hierarchies have one operational flaw: the **edge weights are baked into the shortcuts**. If a traffic jam changes travel times, the shortcut weights are wrong, and rebuilding a full CH for the whole continent every few minutes is impractical. **Customizable Contraction Hierarchies (CCH)** restructure the work to fix exactly this.

## Separate topology from metric

CCH splits preprocessing into two phases:

1. **Metric-independent (once).** Choose a contraction order from the **graph topology alone** — no weights. A common choice is a **nested-dissection** or **minimum-degree** ordering (this app uses minimum-degree). Then play the *elimination game*: when a node is eliminated, make its neighbours pairwise adjacent, adding **fill-in** edges. The result is a fixed shortcut structure (a chordal supergraph) that depends only on which roads exist, not how fast they are.

2. **Customization (cheap, repeatable).** Pour the current weights into that fixed structure with one sweep of **triangle relaxations**: processing nodes in rank order, set w(a,b) ← min(w(a,b), w(v,a) + w(v,b)) for each node v and its higher neighbours a, b. This computes correct shortcut weights and runs in a small fraction of the structural cost.

## Why this wins

When traffic changes — or a user picks "avoid tolls", or a truck needs a height-aware metric — you re-run **only customization**. The expensive topological skeleton is reused. Production systems can re-customize a continental graph in well under a second, which is what makes live, traffic-aware routing feasible.

In this app's **Map** section, change the **Traffic** setting and notice the message: the weights update and preprocessed methods (CH/CCH) will rebuild on the next run. CCH is the variant designed so that rebuild is the cheap customization step, not a from-scratch contraction.

## Tradeoffs

A topology-only order can produce more shortcuts than a metric-aware CH order, so CCH queries are sometimes a touch slower than CH's. In exchange you get fast, repeatable re-weighting — the right tradeoff whenever the metric is not fixed.
`,
  },
  {
    id: 'complexity-cheatsheet',
    category: 'Reference',
    title: 'Complexity & Capability Cheat Sheet',
    body: `
A side-by-side summary of every algorithm in this app. "Query" is the cost of a single point-to-point search; "Preproc" is one-time setup.

| Algorithm | Optimal? | Negative weights | Heuristic | Preproc | Query (practical) |
| --- | --- | --- | --- | --- | --- |
| BFS | Unweighted only | Yes (hops) | No | none | O(V+E) |
| Dijkstra | Yes | No | No | none | O((V+E) log V) |
| Bellman–Ford | Yes | **Yes** + cycle detect | No | none | O(V·E) |
| Greedy Best-First | No | No | Yes | none | fast, variable |
| A\\* | Yes (admissible h) | No | Yes | none | ≤ Dijkstra, often ≪ |
| Bidirectional Dijkstra | Yes | No | No | none | ~½ of Dijkstra |
| Bidirectional A\\* | Yes (consistent pot.) | No | Yes | none | < Bi-Dijkstra |
| ALT | Yes | No | Yes (landmarks) | O(L·(V+E) log V) | ≪ A\\* |
| Contraction Hierarchies | Yes | No | No | heavy, once | microseconds |
| Customizable CH | Yes | No | No | topology once + cheap customize | microseconds |

## How to read it

- **Dijkstra** is the correctness baseline. Everything optimal must agree with it on cost.
- **A\\*, ALT** keep optimality but shrink the explored region with better information.
- **Bidirectional** methods roughly halve the work by meeting in the middle.
- **CH / CCH** move almost all the work into preprocessing, leaving near-constant-time queries — the production answer for huge, query-heavy road networks.
- **Bellman–Ford** is the outlier: the only one that tolerates negative weights, at a steep time cost.

## Rules of thumb

1. Small graph, one query: **Dijkstra** (or A\\* if you have a heuristic).
2. Geometric graph, many queries: **A\\*** or **ALT**.
3. Huge static network, massive query volume: **Contraction Hierarchies**.
4. Huge network with changing weights (traffic): **Customizable CH**.
5. Negative weights anywhere: **Bellman–Ford**.
`,
  },
];

export const GLOSSARY = [
  { term: 'Node (vertex)', def: 'A point in the graph — for maps, an intersection.' },
  { term: 'Edge', def: 'A connection between two nodes, carrying a weight (cost).' },
  { term: 'Weight', def: 'The cost of traversing an edge — distance, or travel time on the map.' },
  { term: 'Frontier (open set)', def: 'The set of discovered-but-not-yet-settled nodes, held in a priority queue.' },
  { term: 'Settled (closed)', def: 'A node whose final shortest distance is known and will not change.' },
  { term: 'Relaxation', def: 'Checking whether going through node u reaches neighbour v more cheaply, and if so updating v.' },
  { term: 'Heuristic h(n)', def: 'An estimate of the remaining cost from n to the goal, used to guide informed search.' },
  { term: 'Admissible', def: 'A heuristic that never overestimates the true remaining cost; required for A* optimality.' },
  { term: 'Consistent (monotone)', def: 'A heuristic where h(u) ≤ w(u,v) + h(v) for every edge; implies admissibility and single settling.' },
  { term: 'Potential', def: 'A per-node offset applied to edge costs (reduced costs); used to make bidirectional A* consistent.' },
  { term: 'g(n) / f(n)', def: 'g is the cost from the start to n; f = g + h is the value A* orders its frontier by.' },
  { term: 'Optimal path', def: 'A path of minimum total weight between two nodes.' },
  { term: 'Landmark', def: 'A precomputed reference node whose exact distances give ALT its sharp lower bounds.' },
  { term: 'Triangle inequality', def: 'dist(a,c) ≤ dist(a,b) + dist(b,c); rearranged, it yields ALT’s admissible bounds.' },
  { term: 'Bidirectional search', def: 'Running two searches — forward from start, backward from goal — that meet in the middle.' },
  { term: 'Meet node', def: 'The node where the forward and backward searches connect to form the path.' },
  { term: 'Contraction', def: 'Removing a node and adding shortcut edges that preserve shortest distances through it.' },
  { term: 'Shortcut', def: 'An added edge summarising a shortest path through one or more contracted nodes.' },
  { term: 'Witness search', def: 'A bounded local search that checks whether a shortcut is actually necessary.' },
  { term: 'Rank / importance', def: 'A node’s position in the contraction order; queries only move to higher ranks.' },
  { term: 'Unpacking', def: 'Recursively expanding shortcut edges back into the original road segments.' },
  { term: 'Edge difference', def: 'Shortcuts a contraction would add minus edges it removes; the core CH ordering heuristic.' },
  { term: 'Nested dissection', def: 'A topology-based ordering (recursively splitting the graph) used for CCH.' },
  { term: 'Customization', def: 'CCH’s cheap phase that recomputes shortcut weights when the metric changes.' },
  { term: 'Priority queue', def: 'A heap that always returns the smallest-key element; the engine behind Dijkstra and A*.' },
];
