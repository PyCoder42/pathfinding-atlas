// common.js
// Shared contract for every pathfinding algorithm in this project.
//
// ───────────────────────────────────────────────────────────────────────────
// THE ALGORITHM INTERFACE  (read this before writing a new algorithm)
// ───────────────────────────────────────────────────────────────────────────
// Every algorithm is a GENERATOR function:
//
//   export function* myAlgo(graph, start, goal, opts = {}) { ... }
//
// It YIELDS step events (objects, shapes below) so the UI can animate the
// search one step at a time, and it RETURNS a Result object when done. The same
// generator is used for animation (step through it slowly) and for benchmarking
// (drain it as fast as possible and time the loop) — see runner.js.
//
// STEP EVENTS (yield these):
//   { type:'settle',   node, dist, dir? }          node finalized / popped
//   { type:'discover', node, dist, parent, dir? }   node entered/improved in frontier
//   { type:'relax',    from, to, w, dir? }          (optional) edge being examined
//   { type:'meet',     node, dir? }                 bidirectional frontiers touch
//   { type:'shortcut', u, v, w }                    CH preprocessing added a shortcut
//   { type:'info',     message }                    free-form progress note
//   { type:'found',    path, cost }                 final path discovered
//
//   `dir` is 'f' (forward) or 'b' (backward) for bidirectional searches; omit
//   it for unidirectional ones. `node`, `parent`, `from`, `to`, `u`, `v` are
//   integer node ids. The renderer ignores event types it doesn't understand,
//   so emitting extra detail is safe.
//
// RESULT (the generator's return value):
//   {
//     path: number[] | null,   // node ids from start..goal, or null if none
//     cost: number,            // total path weight, or Infinity if unreachable
//     stats: Stats,            // see makeStats()
//     dist?, parent?           // optional internal arrays (handy for debugging)
//   }
//
// Conventions:
//   - Use the shared MinHeap from ../core/priority-queue.js.
//   - Use graph.neighbors(u) / graph.inNeighbors(u) for adjacency.
//   - A* and informed searches read opts.heuristic(node) -> number; if absent,
//     fall back to (v) => graph.heuristic(v, goal).
//   - Track stats honestly: every pop is a settle, every improving relaxation
//     is a discover, every edge examined is a relaxation.
// ───────────────────────────────────────────────────────────────────────────

export const EventType = {
  SETTLE: 'settle',
  DISCOVER: 'discover',
  RELAX: 'relax',
  MEET: 'meet',
  SHORTCUT: 'shortcut',
  INFO: 'info',
  FOUND: 'found',
};

export function makeStats() {
  return {
    settled: 0,       // nodes popped/finalized from a frontier
    discovered: 0,    // nodes inserted/improved in a frontier
    relaxations: 0,   // edges examined
    maxFrontier: 0,   // peak open-set size
    pushes: 0,        // total heap pushes (incl. lazy duplicates)
    pathLength: 0,    // number of hops in the final path
  };
}

// Reconstruct a path from a parent array produced by a forward search.
// Returns [] if goal is unreachable (parent[goal] === -1 and goal !== start).
export function reconstructPath(parent, start, goal) {
  if (goal === start) return [start];
  if (parent[goal] === -1 || parent[goal] === undefined) return [];
  const path = [];
  let cur = goal;
  let guard = 0;
  const limit = parent.length + 1;
  while (cur !== -1 && cur !== undefined) {
    path.push(cur);
    if (cur === start) break;
    cur = parent[cur];
    if (++guard > limit) return []; // cycle guard
  }
  if (path[path.length - 1] !== start) return [];
  path.reverse();
  return path;
}

// Stitch a bidirectional path: forward parents start..meet, backward parents
// goal..meet. `parentF[meet]` walks toward start; `parentB[meet]` walks toward
// goal. Returns the full start..goal node list.
export function stitchBidirectional(parentF, parentB, start, goal, meet) {
  const front = reconstructPath(parentF, start, meet); // start..meet
  if (front.length === 0 && meet !== start) return [];
  const back = [];
  let cur = parentB[meet];
  let guard = 0;
  const limit = parentB.length + 1;
  while (cur !== -1 && cur !== undefined) {
    back.push(cur); // meet+1 .. goal
    if (cur === goal) break;
    cur = parentB[cur];
    if (++guard > limit) return [];
  }
  return front.concat(back);
}

// Helper to finalize stats with the resolved path length.
export function withPath(stats, path) {
  stats.pathLength = path && path.length > 1 ? path.length - 1 : 0;
  return stats;
}
