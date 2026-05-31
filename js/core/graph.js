// graph.js
// The single graph representation used by every algorithm and both sections
// (the "fake Google Maps" road network and the abstract weighted graphs).
//
// Design goals:
//   - Cheap to build incrementally (addNode / addEdge).
//   - Fast neighbor iteration for searches over large graphs.
//   - Carries 2D coordinates so geometric heuristics (A*) work everywhere and
//     so the renderer can draw it without a separate layout pass.
//
// Edges are stored as flat {to, w} records in per-node adjacency arrays. We
// also keep a reverse adjacency list (`radj`) so bidirectional searches and
// Contraction Hierarchies can walk incoming edges in O(1).

export class Graph {
  constructor() {
    this.x = [];        // x[id] -> coordinate
    this.y = [];        // y[id] -> coordinate
    this.meta = [];     // meta[id] -> arbitrary node metadata (name, kind, ...)
    this.adj = [];      // adj[id]  -> [{to, w}]  (outgoing edges)
    this.radj = [];     // radj[id] -> [{to, w}]  (incoming edges, reversed)
    this._m = 0;        // directed-edge count

    // Heuristic configuration. The default admissible heuristic is the
    // straight-line (Euclidean) distance divided by `speedLimit`. For graphs
    // whose edge weights ARE distances, leave speedLimit = 1 and the heuristic
    // equals Euclidean distance. For the map (edge weight = travel time in the
    // same units as distance/speed), set speedLimit to the network's maximum
    // speed so the heuristic stays an admissible lower bound on travel time.
    this.speedLimit = 1;

    // Optional semantic hint for the UI / heuristics:
    //   'distance' -> edge weights are geometric distances
    //   'time'     -> edge weights are travel times
    this.weightKind = 'distance';
  }

  get n() {
    return this.x.length;
  }

  get m() {
    return this._m;
  }

  addNode(x, y, meta = null) {
    const id = this.x.length;
    this.x.push(x);
    this.y.push(y);
    this.meta.push(meta);
    this.adj.push([]);
    this.radj.push([]);
    return id;
  }

  // Add an edge u->v with weight w. When `directed` is false (default) the
  // reverse edge v->u is added with the same weight.
  addEdge(u, v, w, directed = false) {
    this.adj[u].push({ to: v, w });
    this.radj[v].push({ to: u, w });
    this._m++;
    if (!directed) {
      this.adj[v].push({ to: u, w });
      this.radj[u].push({ to: v, w });
      this._m++;
    }
  }

  neighbors(u) {
    return this.adj[u];
  }

  inNeighbors(u) {
    return this.radj[u];
  }

  // Straight-line distance between two node ids (used for drawing and as the
  // raw geometric term inside heuristics).
  euclidean(a, b) {
    const dx = this.x[a] - this.x[b];
    const dy = this.y[a] - this.y[b];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Admissible lower bound on the cost of the best path from a to b.
  // Used as the default A* heuristic. ALT and other algorithms may supply a
  // tighter heuristic via the algorithm's `opts.heuristic`.
  heuristic(a, b) {
    return this.euclidean(a, b) / this.speedLimit;
  }

  // Total weight of a path given as a list of node ids. Returns Infinity for a
  // null/empty path so callers can compare freely.
  pathCost(path) {
    if (!path || path.length < 2) return path && path.length === 1 ? 0 : Infinity;
    let cost = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const u = path[i];
      const v = path[i + 1];
      let best = Infinity;
      for (const e of this.adj[u]) {
        if (e.to === v && e.w < best) best = e.w;
      }
      cost += best;
    }
    return cost;
  }

  // Bounding box of all node coordinates: {minX, minY, maxX, maxY}.
  bounds() {
    if (this.n === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.x[i] < minX) minX = this.x[i];
      if (this.y[i] < minY) minY = this.y[i];
      if (this.x[i] > maxX) maxX = this.x[i];
      if (this.y[i] > maxY) maxY = this.y[i];
    }
    return { minX, minY, maxX, maxY };
  }
}
