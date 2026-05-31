// explanations.js — per-algorithm educational content shown in the Visualizer's
// explanation panel and on the Learn page. Keyed by algorithm id.

export const EXPLANATIONS = {
  bfs: {
    tagline: 'The fewest-hops baseline.',
    summary:
      'Breadth-First Search explores a graph in rings of equal hop-count from the start, so it finds the path using the fewest edges. It ignores edge weights entirely, which makes it the right tool only when every edge costs the same.',
    howItWorks: [
      'BFS keeps a simple **FIFO queue**. It dequeues a node, marks it visited, and enqueues every unvisited neighbour. Because the queue processes nodes in the order they were discovered, all nodes one hop away are handled before any node two hops away, and so on.',
      'This expanding-ring behaviour means the first time BFS reaches the goal, it has done so along a path with the minimum number of edges.',
      'On a **weighted** graph that guarantee breaks: the fewest-hops path is often not the cheapest path. In this app, BFS reports the true weighted cost of the path it found so you can see exactly how far off it can be.',
    ],
    complexity: { time: 'O(V + E)', space: 'O(V)' },
    optimal: 'Only on unweighted graphs (all edges equal). On weighted graphs it minimises hops, not cost.',
    pros: ['Dead simple', 'Linear time', 'Optimal for unweighted graphs', 'No priority queue needed'],
    cons: ['Ignores weights', 'Not optimal on weighted graphs', 'No goal-direction'],
    whenToUse: 'Unweighted graphs, or when you genuinely want the fewest-edges path (e.g. social-network degrees of separation).',
    veritasium:
      'The video starts by framing routing as a graph problem. BFS is the mental warm-up: it shows that "explore outward until you hit the destination" works, but treating every road as equal length is obviously wrong — which motivates weighting edges and moving to Dijkstra.',
    pseudocode: `BFS(start, goal):
  queue = [start]; visited = {start}
  while queue not empty:
    u = queue.dequeue()
    if u == goal: return path
    for v in neighbours(u):
      if v not visited:
        visited.add(v); parent[v] = u
        queue.enqueue(v)`,
  },

  dijkstra: {
    tagline: 'Uniform-cost search — the gold-standard baseline.',
    summary:
      "Dijkstra's algorithm finds the provably shortest path on a graph with non-negative edge weights by always expanding the closest not-yet-finalised node. It has no idea where the goal is, so it grows an even disk of explored nodes in every direction.",
    howItWorks: [
      'Each node has a tentative distance, starting at 0 for the source and ∞ for everything else. A **priority queue** always hands back the unsettled node with the smallest tentative distance.',
      'When a node is popped it is **settled** — its shortest distance is now final. We then **relax** each outgoing edge: if going through this node reaches a neighbour more cheaply, we lower the neighbour\'s tentative distance and record the new parent.',
      'Because we always settle the globally-closest node, when the goal is popped we can stop — no cheaper route to it can exist.',
      'The cost of being uninformed is wasted work: Dijkstra explores roughly the same distance in *every* direction, including directly away from the goal.',
    ],
    complexity: { time: 'O((V + E) log V)', space: 'O(V)' },
    optimal: 'Yes — guaranteed shortest path for non-negative weights.',
    pros: ['Always optimal (non-negative weights)', 'Simple and robust', 'Works on any graph shape'],
    cons: ['No goal-direction → explores everywhere', 'Too slow for continental road networks', 'Fails with negative weights'],
    whenToUse: 'When you need a guaranteed-correct baseline, or one-to-all shortest paths, on a small-to-medium graph.',
    veritasium:
      'Dijkstra is the heart of the video\'s first real answer: model the map as a weighted graph and expand the cheapest frontier node. The animation of Dijkstra "ballooning" outward in all directions is exactly why the video then asks: can we point the search at the destination?',
    pseudocode: `Dijkstra(start, goal):
  dist[start] = 0; PQ = {(0, start)}
  while PQ not empty:
    (d, u) = PQ.pop_min()
    if u settled: continue
    settle u
    if u == goal: break
    for (v, w) in neighbours(u):
      if dist[u] + w < dist[v]:
        dist[v] = dist[u] + w; parent[v] = u
        PQ.push((dist[v], v))`,
  },

  'bellman-ford': {
    tagline: 'Slower, but survives negative weights.',
    summary:
      'Bellman–Ford computes shortest paths even when some edges have negative weights, and it can detect negative cycles (where "shortest" becomes meaningless). It pays for this generality with a higher time complexity.',
    howItWorks: [
      'The textbook version relaxes **every edge**, repeatedly, V−1 times. After k full passes, all shortest paths using at most k edges are correct; since any simple path has at most V−1 edges, V−1 passes suffice.',
      'This implementation uses the **queue-based (SPFA) variant**: only nodes whose distance just improved are re-examined, which is far faster in practice while computing the same result.',
      'A negative edge can make a longer-hop path cheaper, which is exactly why Dijkstra\'s "settle once" assumption fails and why Bellman–Ford must keep revisiting nodes.',
      'If any node is still improving after V passes, a **negative cycle** is reachable and the algorithm reports it.',
    ],
    complexity: { time: 'O(V · E)', space: 'O(V)' },
    optimal: 'Yes — optimal even with negative edges (when no negative cycle exists).',
    pros: ['Handles negative weights', 'Detects negative cycles', 'Simple to reason about'],
    cons: ['Much slower than Dijkstra', 'Impractical on large graphs', 'No goal-direction'],
    whenToUse: 'Graphs with negative edge weights (currency arbitrage, certain scheduling problems) or when you must detect negative cycles.',
    veritasium:
      'The video focuses on road networks, where weights (time/distance) are non-negative, so Dijkstra-family methods dominate. Bellman–Ford is the important footnote: it shows *why* Dijkstra needs the non-negativity assumption, by being the algorithm that works precisely when that assumption is dropped.',
    pseudocode: `BellmanFord(start, goal):   # queue-based SPFA
  dist[start] = 0; queue = [start]
  while queue not empty:
    u = queue.pop()
    for (v, w) in neighbours(u):
      if dist[u] + w < dist[v]:
        dist[v] = dist[u] + w; parent[v] = u
        if v not in queue: queue.push(v)
        if relaxCount[v]++ > V: report negative cycle`,
  },

  greedy: {
    tagline: 'Charges at the goal — fast, but often wrong.',
    summary:
      'Greedy Best-First Search orders its frontier purely by the heuristic estimate of distance-to-goal, ignoring how far it has already travelled. It often reaches the goal very quickly, but the path it finds is frequently not the shortest.',
    howItWorks: [
      'Where A* uses f(n) = g(n) + h(n), greedy uses **f(n) = h(n) only**. It always expands whichever frontier node *looks* closest to the goal.',
      'This makes it laser-focused and usually fast: it tends to head straight at the destination.',
      'But by ignoring accumulated cost g(n), it happily walks into detours and dead-ends that a tiny bit of "how far have I come?" bookkeeping would avoid. The result is a valid path, but not necessarily a cheap one.',
      'Greedy is best understood as one extreme of a spectrum: it is A* with the g-term switched off.',
    ],
    complexity: { time: 'O((V + E) log V) worst case', space: 'O(V)' },
    optimal: 'No — it minimises estimated remaining distance, not total cost, so it can return longer paths.',
    pros: ['Very fast in open spaces', 'Strong goal-direction', 'Tiny memory footprint'],
    cons: ['Not optimal', 'Easily fooled by obstacles/dead-ends', 'Quality depends entirely on the heuristic'],
    whenToUse: 'When a "good enough, found fast" path is acceptable and optimality is not required.',
    veritasium:
      'Greedy is the cautionary tale between Dijkstra and A*: pointing the search at the goal makes it fast, but going *all in* on the heuristic sacrifices correctness. It sets up the punchline that A* is the principled balance of the two ideas.',
    pseudocode: `Greedy(start, goal):
  PQ = {(h(start), start)}
  while PQ not empty:
    (_, u) = PQ.pop_min()
    if u == goal: return path
    mark u visited
    for (v, w) in neighbours(u):
      if v not visited:
        parent[v] = u
        PQ.push((h(v), v))   # priority = heuristic ONLY`,
  },

  astar: {
    tagline: 'Dijkstra with a sense of direction.',
    summary:
      'A* expands nodes in order of f(n) = g(n) + h(n): the cost already spent plus an admissible estimate of the cost remaining. With a good heuristic it explores dramatically fewer nodes than Dijkstra while still returning the optimal path.',
    howItWorks: [
      'g(n) is the exact best-known cost from the start to n. h(n) is a heuristic **lower bound** on the cost from n to the goal — in this app, the straight-line distance (divided by the max speed on the road map).',
      'Ordering the frontier by f = g + h means A* prefers nodes that are both cheap to reach *and* estimated to be near the goal, so its explored region stretches into an **ellipse aimed at the destination** rather than Dijkstra\'s circle.',
      'If h never overestimates (it is **admissible**), A* is guaranteed optimal. If h is also **consistent** (monotone), each node is settled at most once, just like Dijkstra.',
      'With h ≡ 0, A* is exactly Dijkstra. The better h approximates the true remaining cost, the more focused — and faster — the search.',
    ],
    complexity: { time: 'O((V + E) log V), far fewer nodes in practice', space: 'O(V)' },
    optimal: 'Yes — provided the heuristic is admissible (never overestimates).',
    pros: ['Optimal with an admissible heuristic', 'Explores far less than Dijkstra', 'Tunable speed/quality tradeoff'],
    cons: ['Needs a good heuristic', 'Heuristic must be admissible for optimality', 'Still slow on continental graphs'],
    whenToUse: 'Geometric/road graphs where a meaningful distance estimate exists — the default choice for game and map pathfinding.',
    veritasium:
      'A* is the video\'s big "aha": add a straight-line estimate to Dijkstra and the balloon collapses into a beam pointed at the destination. The admissibility condition — never overestimate — is the subtle rule that keeps it correct.',
    pseudocode: `A*(start, goal):
  g[start] = 0; PQ = {(h(start), start)}
  while PQ not empty:
    (_, u) = PQ.pop_min()        # ordered by f = g + h
    if u settled: continue
    settle u
    if u == goal: break
    for (v, w) in neighbours(u):
      if g[u] + w < g[v]:
        g[v] = g[u] + w; parent[v] = u
        PQ.push((g[v] + h(v), v))`,
  },

  'bidirectional-dijkstra': {
    tagline: 'Two searches that meet in the middle.',
    summary:
      'Bidirectional Dijkstra runs one search forward from the start and another backward from the goal simultaneously, stopping when they meet. Two small explored circles cover far less area than one big one.',
    howItWorks: [
      'Two independent Dijkstra searches advance at once: a forward search over outgoing edges from the start, and a backward search over incoming edges from the goal.',
      'Whenever a node has been reached by **both** searches, the sum of its two distances is a candidate shortest-path length, μ. We keep the best (smallest) μ and the node where it occurred.',
      'The clever part is the **stopping rule**: it is *not* "stop when the frontiers touch." We stop only once the smallest key remaining in the forward queue plus the smallest in the backward queue is ≥ μ — guaranteeing no shorter meeting can still appear.',
      'Geometrically, two radius-r/2 circles have far less combined area than one radius-r circle, so the algorithm settles roughly half as many nodes as plain Dijkstra.',
    ],
    complexity: { time: 'O((V + E) log V), ~½ the nodes of Dijkstra', space: 'O(V)' },
    optimal: 'Yes — with the correct min-key stopping condition.',
    pros: ['Explores ~half as much as Dijkstra', 'Still optimal', 'No heuristic required'],
    cons: ['Needs the reverse graph', 'Subtle stopping condition', 'Two frontiers to manage'],
    whenToUse: 'Point-to-point queries where you have (or can build) the reverse graph and want a free ~2× speedup over Dijkstra.',
    veritasium:
      'The "search from both ends and meet in the middle" trick is one of the video\'s key accelerators. The intuition — two half-size circles beat one full-size circle — is visually obvious in the animation, and it is the foundation that contraction hierarchies build on.',
    pseudocode: `BiDijkstra(start, goal):
  distF[start]=0; distB[goal]=0; mu = inf
  while topF + topB < mu:        # min keys of both queues
    expand the smaller frontier (forward or backward)
    on settling/relaxing node x reached by both sides:
      if distF[x] + distB[x] < mu:
        mu = distF[x] + distB[x]; meet = x
  return path stitched through meet`,
  },

  'bidirectional-astar': {
    tagline: 'Meet-in-the-middle, now goal-directed.',
    summary:
      'Bidirectional A* combines two accelerators — searching from both ends and using a heuristic — but doing so correctly is subtle, because the two searches must agree on a consistent set of "potentials" to remain optimal.',
    howItWorks: [
      'Naively bolting a heuristic onto each side of a bidirectional search breaks optimality, because the forward and backward heuristics pull in inconsistent directions.',
      'The fix used here is **symmetric (averaged) potentials**: the forward search reduces edge costs by p_f(v) = (h_goal(v) − h_start(v)) / 2 and the backward search by p_b(v) = −p_f(v). These potentials are *consistent*, so each search behaves like a valid A*.',
      'Distances are tracked with the **true** edge weights; only the priority-queue keys use the reduced costs. As before, μ records the best meeting cost.',
      'Termination accounts for the constant potential offset: the search stops when the sum of the two minimum keys reaches μ plus that offset, which keeps the result provably optimal.',
    ],
    complexity: { time: 'O((V + E) log V), fewer nodes than Bi-Dijkstra', space: 'O(V)' },
    optimal: 'Yes — with consistent (averaged) potentials and the matching stopping rule.',
    pros: ['Combines two speedups', 'Optimal with consistent potentials', 'Strong on geometric graphs'],
    cons: ['Tricky to implement correctly', 'Heuristic must be consistent', 'Easy to make subtly suboptimal'],
    whenToUse: 'Point-to-point geometric queries where you want both heuristic guidance and meet-in-the-middle savings.',
    veritasium:
      'This is where the video\'s two crowd-pleasing tricks — heuristics and bidirectional search — combine. The fact that the combination is fiddly to get right is exactly why specialised techniques like contraction hierarchies became the production answer.',
    pseudocode: `BiA*(start, goal):
  p_f(v) = (h_goal(v) - h_start(v)) / 2
  p_b(v) = -p_f(v)
  forward key = distF[v] + p_f(v)
  backward key = distB[v] + p_b(v)
  track mu over nodes reached by both sides
  stop when topF + topB >= mu + p_f(goal)
  return path stitched through meet`,
  },

  alt: {
    tagline: 'A heuristic so sharp it barely explores.',
    summary:
      'ALT (A*, Landmarks, Triangle inequality) precomputes exact distances from a few landmark nodes to everywhere, then uses the triangle inequality to turn them into a much tighter admissible heuristic than straight-line distance — so A* explores a fraction of the nodes.',
    howItWorks: [
      'In a **preprocessing** step, a handful of well-spread **landmarks** are chosen and the exact distance from each landmark to (and from) every node is computed with one Dijkstra per landmark.',
      'For any node v and goal t, the **triangle inequality** gives lower bounds such as dist(v,t) ≥ dist(L,t) − dist(L,v). Taking the maximum over all landmarks yields a heuristic that is admissible *and* far closer to the true distance than the straight-line guess — especially around rivers, coastlines, and dead-ends where geometry lies.',
      'A* then runs exactly as usual, but with this sharper h. Tighter h means fewer nodes settled and a faster query.',
      'ALT is metric-aware: the landmark distances assume a fixed cost model, so changing the metric (e.g. traffic) requires recomputing them.',
    ],
    complexity: { time: 'query like A* but with far fewer nodes', space: 'O(L · V)', preprocess: 'O(L · (V+E) log V)' },
    optimal: 'Yes — the landmark/triangle-inequality bound is admissible.',
    pros: ['Much sharper heuristic than straight-line', 'Optimal', 'Great on graphs where geometry misleads'],
    cons: ['Preprocessing time and O(L·V) memory', 'Landmark choice matters a lot', 'Metric-dependent (recompute on weight change)'],
    whenToUse: 'Road networks where you want big A* speedups without the full machinery of contraction hierarchies.',
    veritasium:
      'ALT is the natural follow-up to "use straight-line distance as the heuristic": precompute some real distances and the heuristic gets dramatically better. It bridges the video\'s heuristic story to its preprocessing story.',
    pseudocode: `preprocess: pick landmarks L; store dist(L, ·) and dist(·, L)
h(v) = max over L of:
         dist(L,goal) - dist(L,v),
         dist(v,L)    - dist(goal,L),
         0
query: run A* with this h(v)`,
  },

  'contraction-hierarchies': {
    tagline: 'Preprocess once, then queries are almost free.',
    summary:
      'Contraction Hierarchies precompute a layered set of "shortcut" edges so that a point-to-point query only ever needs to walk a short way "up" the hierarchy from both ends. After preprocessing, queries on a continental road network take microseconds.',
    howItWorks: [
      'Every node is assigned an **importance rank**. Nodes are then **contracted** from least to most important. Contracting a node removes it and inserts **shortcut** edges between its neighbours wherever it was the only shortest connection between them — verified by a local **witness search**.',
      'The output is the original graph plus these shortcuts, organised so that each edge goes from a lower-ranked to a higher-ranked node.',
      'A query is a **bidirectional search that only moves upward** in rank. The forward search climbs from the start, the backward search climbs from the goal, and they meet near the top of the hierarchy — each touching only a tiny number of nodes.',
      'The path the query finds is full of shortcuts, so a final **unpacking** step recursively expands each shortcut back into the real sequence of road segments.',
    ],
    complexity: { time: 'query ~O(log V) in practice', space: 'O(V + E + shortcuts)', preprocess: 'O(V log V · witness cost)', query: 'milliseconds → microseconds' },
    optimal: 'Yes — shortcuts preserve exact shortest-path distances.',
    pros: ['Astonishingly fast queries', 'Optimal', 'Modest memory overhead', 'Used in production routers'],
    cons: ['Preprocessing is involved', 'Metric baked into shortcuts (re-preprocess on weight change)', 'Harder to implement correctly'],
    whenToUse: 'Static road networks with millions of nodes and huge query volumes, where preprocessing cost is amortised over many queries.',
    veritasium:
      'Contraction hierarchies are the video\'s grand finale for static maps: the reason a route across a continent returns instantly. The "contract unimportant nodes into shortcuts, then only ever drive uphill in importance" picture is the core insight.',
    pseudocode: `preprocess:
  order nodes by importance (edge-difference heuristic)
  for v in order:
    for each pair (u, w) of v's neighbours:
      if shortest u->w path goes only through v (witness search):
        add shortcut u->w of weight d(u,v)+d(v,w), remember mid=v
    rank[v] = next
query:
  bidirectional Dijkstra using only edges to HIGHER rank
  meet at top; unpack shortcuts via mid to recover real path`,
  },

  'customizable-ch': {
    tagline: 'CH that survives live traffic.',
    summary:
      'Customizable Contraction Hierarchies separate the expensive, weight-free structural work from a cheap weight-dependent step. When traffic changes the edge weights, only the cheap "customization" sweep is re-run — not the whole preprocessing.',
    howItWorks: [
      'Phase 1 — **metric-independent**: choose a contraction order from the graph **topology alone** (here, a minimum-degree elimination ordering) and build the fill-in shortcut structure. No edge weights are used, so this is done once and reused forever.',
      'Phase 2 — **customization**: pour the current weights into that fixed structure with a single sweep of **triangle relaxations** (for each node, w(a,b) ← min(w(a,b), w(v,a)+w(v,b)) over its higher neighbours). This computes correct shortcut weights quickly.',
      'When the metric changes — rush hour, a road closure, a new "avoid tolls" preference — you re-run only Phase 2, which is far cheaper than rebuilding a full CH.',
      'The query is identical to CH: a bidirectional upward search plus shortcut unpacking.',
    ],
    complexity: { time: 'query like CH', space: 'O(V + E + fill-in)', preprocess: 'order: O(V·E) ; customize: O(fill-in)', query: 'microseconds' },
    optimal: 'Yes — same correctness guarantees as CH.',
    pros: ['Fast re-customization when weights change', 'Optimal', 'Ideal for live traffic / personalised metrics', 'Separation of concerns'],
    cons: ['More moving parts than CH', 'Topology order can give more shortcuts than a metric-aware CH', 'Still needs the one-time ordering'],
    whenToUse: 'Production routing with frequently changing edge weights — live traffic, road closures, per-user cost models — where re-preprocessing CH every few minutes is too expensive.',
    veritasium:
      'This is the answer to the video\'s closing question: how does the map update for traffic in real time? You do not rebuild everything — you keep the metric-independent skeleton and only re-pour the weights. CCH is the modern, traffic-aware evolution of contraction hierarchies.',
    pseudocode: `preprocess (once, weight-free):
  order = minimum-degree elimination
  build fill-in edges (chordal supergraph)
customize (cheap, repeat on weight change):
  set original edge weights; shortcuts = inf
  for v in ascending rank:
    for higher neighbours a, b of v:
      w(a,b) = min(w(a,b), w(v,a) + w(v,b))
query: identical to CH (upward bidirectional + unpack)`,
  },
};
