// explanations-extra.js — educational content for the three additional algorithms
// (Jump Point Search, Theta*, D* Lite). Same object shape as explanations.js,
// keyed by algorithm id, ready to be merged into EXPLANATIONS.

export const EXPLANATIONS_EXTRA = {
  jps: {
    tagline: 'A* on grids, minus the wasted symmetry.',
    summary:
      'Jump Point Search is an optimisation of A* for uniform-cost grids. On open grids there are huge numbers of equivalent paths (the same length, just reordering the same steps), and ordinary A* expands almost all of them. JPS prunes that symmetry and "jumps" over long straight runs of cells, expanding only a handful of decision points while returning the exact same optimal path A* would.',
    howItWorks: [
      'On a uniform-cost grid, many distinct routes between two cells have **identical length** — they are just permutations of the same horizontal, vertical, and diagonal steps. This **path symmetry** is what makes plain A* waste effort: it dutifully expands all those interchangeable cells.',
      'JPS breaks the symmetry with **pruning rules**. From a cell reached in a given direction, most neighbours are *dominated* — there is already an equal-or-better way to reach them without going through this cell — so they are never added to the open list.',
      'Instead of stepping one cell at a time, JPS **jumps**: it scans in a straight line (or diagonal) skipping over cells until it finds a **jump point** — a cell that has a "forced neighbour" (a neighbour that can only be reached optimally by turning here, usually because an obstacle blocks the straight route) or that is the goal. Only jump points are ever pushed onto the open list.',
      'Because the jumps and prunes never discard an optimal route, the final path is **identical in cost to A***. JPS simply reaches it after expanding far fewer nodes — often orders of magnitude fewer on open maps — with **no preprocessing**.',
    ],
    complexity: { time: 'O((V + E) log V) worst case, but expands far fewer nodes than A* on grids', space: 'O(V)' },
    optimal: 'Yes — returns a path of identical cost to A* (the pruning and jumping never remove an optimal route).',
    pros: ['Often orders of magnitude fewer expansions than A* on open grids', 'No preprocessing required', 'Same optimal path as A*', 'Trivial to add to an existing A* / grid pipeline'],
    cons: ['Uniform-cost grids only', 'Assumes every traversable cell costs the same — no weighted terrain', 'Jumping/forced-neighbour rules are fiddly to implement correctly', 'Little benefit on cluttered maps with few long straight runs'],
    whenToUse: 'Grid-based pathfinding with uniform movement cost — most notably game maps and tile-based worlds — where you want A*-quality paths but A* is expanding too many cells in open areas.',
    veritasium:
      "The video frames A* as Dijkstra given a sense of direction. JPS is the next refinement once you notice that on a flat grid A* still re-derives thousands of interchangeable paths. The insight — recognise that many routes are secretly the same and skip straight over the redundant cells — is exactly the kind of \"stop doing obviously wasted work\" move the video keeps returning to.",
    pseudocode: `JPS(start, goal):           # uniform-cost grid, A*-style open list
  g[start] = 0; PQ = {(h(start), start)}
  while PQ not empty:
    (_, u) = PQ.pop_min()        # ordered by f = g + h
    if u == goal: return path
    for dir in pruned_directions(u, parent[u]):
      j = jump(u, dir)           # scan until jump point / goal / blocked
      if j is null: continue
      newg = g[u] + dist(u, j)
      if newg < g[j]:
        g[j] = newg; parent[j] = u
        PQ.push((newg + h(j), j))

jump(c, dir):                    # returns next jump point along dir, or null
  n = step(c, dir)
  if n is blocked or off-grid: return null
  if n == goal: return n
  if n has a forced neighbour: return n      # obstacle forces a turn here
  if dir is diagonal:
    for d in straight_components(dir):        # check both axes first
      if jump(n, d) is not null: return n
  return jump(n, dir)            # keep sliding in the same direction`,
  },

  'theta-star': {
    tagline: 'Any-angle paths that ignore the grid lines.',
    summary:
      'Theta* is an any-angle variant of A* for grids. Ordinary grid A* can only travel along cell edges (and, with diagonals, 45° steps), so its paths zig-zag and are longer than the true shortest route. Theta* fixes this with a single change: when relaxing a node, it checks line-of-sight back to the *grandparent* and, if the straight line is clear, attaches the node directly to it — producing taut, near-shortest paths at arbitrary angles.',
    howItWorks: [
      'Grid-constrained A* is forced onto the lattice: every move follows a cell edge or a 45° diagonal. The result is a **staircase** path that can be noticeably longer than the geometric shortest route, and looks unnatural for an agent crossing open space.',
      'Theta* runs the A* loop almost unchanged. The one difference is in **how it sets a node\'s parent**. When it would relax neighbour s from the current node u, it first asks: is there **line of sight** between s and u\'s parent?',
      'If the straight segment from parent(u) to s is unobstructed, Theta* skips u entirely and sets **parent(s) = parent(u)**, with g(s) = g(parent(u)) + straight-line distance. This "shortcutting" lets path segments cut across cells at **any angle**, not just multiples of 45°.',
      'If line of sight is blocked (an obstacle is in the way), it falls back to the ordinary A* update, parenting s to u. Repeatedly preferring the grandparent connection pulls the path **taut around obstacle corners**, giving results that are shorter than grid A* and very close to the true any-angle optimum.',
    ],
    complexity: { time: 'O((V + E) log V) plus an O(grid-diagonal) line-of-sight check per relaxation', space: 'O(V)' },
    optimal: 'Optimal for any-angle paths in practice (shorter than grid-constrained A*); Theta* is not guaranteed to find the exact Euclidean-optimal path, but it comes very close and always beats edge-locked A*.',
    pros: ['Produces taut, natural-looking paths at any angle', 'Shorter than grid-constrained A*', 'No path-smoothing post-process needed', 'Only a small change on top of A*'],
    cons: ['Each relaxation needs a line-of-sight check (extra per-node cost)', 'Not provably Euclidean-optimal (only any-angle near-optimal)', 'Designed for grids with a line-of-sight test', 'More expensive per node than plain A*'],
    whenToUse: 'Grid worlds where agents move freely in continuous space and you want short, realistic paths — robotics navigation and game units crossing open terrain — rather than the zig-zag a grid-locked planner produces.',
    veritasium:
      'After the video establishes A* as the smart way to search a graph, Theta* answers a complaint you can almost feel watching the animation: the path is stuck to the grid and obviously longer than a straight shot would be. The fix — let a node attach to its grandparent whenever it can see it — is a tiny tweak with a big visual payoff, turning staircases into straight lines.',
    pseudocode: `Theta*(start, goal):        # any-angle A* on a grid
  g[start] = 0; parent[start] = start
  PQ = {(h(start), start)}
  while PQ not empty:
    (_, u) = PQ.pop_min()        # ordered by f = g + h
    if u == goal: return path
    settle u
    for s in neighbours(u):
      if s settled: continue
      # Path 2: try shortcutting to the grandparent
      if line_of_sight(parent[u], s):
        if g[parent[u]] + dist(parent[u], s) < g[s]:
          g[s] = g[parent[u]] + dist(parent[u], s)
          parent[s] = parent[u]
          PQ.push((g[s] + h(s), s))
      else:
        # Path 1: ordinary A* edge update
        if g[u] + dist(u, s) < g[s]:
          g[s] = g[u] + dist(u, s)
          parent[s] = u
          PQ.push((g[s] + h(s), s))`,
  },

  'dstar-lite': {
    tagline: 'The replanner robots actually run.',
    summary:
      'D* Lite is an incremental shortest-path algorithm for agents moving through a changing or partially-known world. It searches **backward from the goal**, and when the map changes — a new obstacle appears, an edge cost rises — it repairs only the part of the search that the change actually affected instead of replanning from scratch. On a static map with no changes, a single run is equivalent to Dijkstra.',
    howItWorks: [
      'Each node keeps two estimates of distance-to-goal: **g** (the value computed so far) and **rhs** (a one-step lookahead, the best g of a successor plus the edge to it). A node is **locally consistent** when g = rhs; any node where g ≠ rhs is **inconsistent** and sits on a priority queue waiting to be repaired.',
      'The search runs **from the goal outward**. `computeShortestPath` repeatedly pops the most promising inconsistent node and makes it consistent (lowering g to rhs, or raising it and re-examining its predecessors), exactly until the start node is settled. With no prior information this first pass **is just Dijkstra run backward** from the goal.',
      'As the agent moves and **senses changes** — an edge becomes blocked or cheaper — only the **endpoints of the changed edges** have their rhs updated and are pushed back onto the queue as inconsistent. The next `computeShortestPath` touches just the nodes whose distances could actually have changed, leaving the rest of the previous search intact.',
      'A clever **priority offset (key modifier `k_m`)** lets the queue keys stay valid as the agent\'s position moves, so the algorithm never has to reorder the whole queue when the start changes. The net effect: cheap, continuous **replanning** for an agent driving through an evolving map — which is why D* Lite (and its ancestor D*) is a staple of real mobile-robot navigation.',
    ],
    complexity: { time: 'first run like Dijkstra O((V + E) log V); each replan proportional only to the nodes affected by the change', space: 'O(V)' },
    optimal: 'Yes — after each repair it yields the true shortest path under the current known edge costs (it is exact, like Dijkstra, just maintained incrementally).',
    pros: ['Cheap incremental replanning when the map changes', 'Reuses previous search effort instead of restarting', 'Exact/optimal under current edge costs', 'Battle-tested for real robot navigation'],
    cons: ['More complex than one-shot Dijkstra/A* (g, rhs, key modifier bookkeeping)', 'Overkill for static maps that never change', 'Memory cost of keeping g/rhs for every touched node', 'Backward search needs goal-anchored edge information'],
    whenToUse: 'Agents navigating an unknown or dynamic environment — a robot discovering obstacles as it drives, or any setting where the goal is fixed, the start keeps moving, and edge costs change — so that replanning from scratch every step would be far too expensive.',
    veritasium:
      'The video is mostly about computing one route on a fixed map. D* Lite is the answer to the unspoken follow-up: what happens when the map changes *while you are driving*? Rather than rerun the whole search, it surgically repairs only the affected region — the same "do not redo work you have already done" spirit behind contraction-hierarchy customisation, applied to a robot reacting in real time.',
    pseudocode: `D*Lite(start, goal):        # searches backward from goal
  rhs[goal] = 0; g = inf for all
  U = {}; k_m = 0
  U.insert(goal, calcKey(goal))
  computeShortestPath()
  while start != goal:
    start = argmin succ s of g[s] + cost(start, s)   # step the agent
    if any edge costs changed (sensed):
      k_m += h(old_start, start)
      for each changed edge (u, v):
        update rhs[u]; updateVertex(u)
      computeShortestPath()

updateVertex(u):
  if u != goal: rhs[u] = min over succ s of (cost(u,s) + g[s])
  remove u from U
  if g[u] != rhs[u]: U.insert(u, calcKey(u))   # inconsistent → repair later

computeShortestPath():
  while U.topKey() < calcKey(start) or rhs[start] != g[start]:
    u = U.pop_min()
    if g[u] > rhs[u]:                 # overconsistent
      g[u] = rhs[u]
    else:                            # underconsistent
      g[u] = inf; updateVertex(u)
    for pred p of u: updateVertex(p)

calcKey(s):
  return ( min(g[s], rhs[s]) + h(start, s) + k_m ,
           min(g[s], rhs[s]) )`,
  },
};
