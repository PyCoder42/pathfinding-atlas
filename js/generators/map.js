// map.js
// The "fake Google Maps" road network generator.
//
// Produces a believable road graph: named cities, smaller towns, and many
// junction nodes, wired together by roads classified as highway / arterial /
// local — each with a speed limit. Edge weight is TRAVEL TIME in minutes
// (distance_km / speed_kmh * 60), so the shortest path is the FASTEST route,
// exactly like a real router. The A* heuristic stays admissible because we set
// graph.speedLimit from the network's maximum speed.
//
//   graph.kind = 'map'
//   graph.weightKind = 'time'
//   graph.speedLimit = MAX_SPEED / 60   (so heuristic = straight-km / maxSpeed in minutes)
//   node meta = { name?, kind:'city'|'town'|'junction' }
//   edge records = { to, w, cls:'highway'|'arterial'|'local', km, speed }
//   returns { graph, start, goal, cities:[{id,name}], pois:[{id,name,kind}], label }

import { Graph } from '../core/graph.js';
import { RNG } from '../core/utils.js';

const CITY_NAMES = [
  'Aldermoor', 'Brightwater', 'Castlereach', 'Dunhollow', 'Eastvale',
  'Fairmont', 'Grenshaw', 'Havenport', 'Ironcliff', 'Junewick',
  'Kingsford', 'Lakemere', 'Marrowind', 'Northgate', 'Oakhaven',
  'Pinecrest', 'Quarryton', 'Riverton', 'Stonebridge', 'Thornbury',
  'Underhill', 'Vellmore', 'Westmarch', 'Yarrowdale', 'Zephyrport',
];

const TOWN_NAMES = [
  'Ash', 'Birch', 'Cedar', 'Dell', 'Elm', 'Fern', 'Glen', 'Holt',
  'Ivy', 'Larch', 'Moss', 'Nook', 'Oak', 'Pike', 'Quay', 'Reed',
  'Sedge', 'Tarn', 'Vale', 'Wold', 'Yew', 'Bramble', 'Croft', 'Marsh',
  'Heath', 'Ridge', 'Briar', 'Combe', 'Fen', 'Hollow', 'Knoll', 'Mead',
];

const SPEEDS = { highway: 110, arterial: 75, local: 45 };
const MAX_SPEED = SPEEDS.highway;

// Rejection sampling for points with a minimum separation.
function poissonPoints(rng, w, h, minDist, maxCount, existing = []) {
  const pts = [];
  const all = existing.slice();
  let tries = 0;
  const maxTries = maxCount * 60;
  while (pts.length < maxCount && tries < maxTries) {
    tries++;
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    let ok = true;
    for (const p of all) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < minDist * minDist) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const p = { x, y };
      pts.push(p);
      all.push(p);
    }
  }
  return pts;
}

// Euclidean minimum spanning tree via Prim (O(n^2)). Guarantees connectivity.
function primMST(g) {
  const n = g.n;
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const bestFrom = new Int32Array(n).fill(-1);
  best[0] = 0;
  const edges = [];
  for (let it = 0; it < n; it++) {
    let u = -1;
    let bu = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && best[i] < bu) {
        bu = best[i];
        u = i;
      }
    }
    if (u === -1) break;
    inTree[u] = 1;
    if (bestFrom[u] !== -1) edges.push([bestFrom[u], u]);
    const ux = g.x[u];
    const uy = g.y[u];
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const dx = g.x[v] - ux;
      const dy = g.y[v] - uy;
      const d = dx * dx + dy * dy;
      if (d < best[v]) {
        best[v] = d;
        bestFrom[v] = u;
      }
    }
  }
  return edges;
}

// k nearest neighbors for each node, using a uniform spatial grid for speed.
function kNearest(g, k, cellSize, w, h) {
  const n = g.n;
  const gc = Math.max(1, Math.ceil(w / cellSize));
  const gr = Math.max(1, Math.ceil(h / cellSize));
  const buckets = Array.from({ length: gc * gr }, () => []);
  const cellOf = (x, y) =>
    Math.min(gr - 1, Math.floor(y / cellSize)) * gc +
    Math.min(gc - 1, Math.floor(x / cellSize));
  for (let i = 0; i < n; i++) buckets[cellOf(g.x[i], g.y[i])].push(i);

  const result = [];
  for (let i = 0; i < n; i++) {
    const cx = Math.min(gc - 1, Math.floor(g.x[i] / cellSize));
    const cy = Math.min(gr - 1, Math.floor(g.y[i] / cellSize));
    const cand = [];
    for (let ring = 1; ring <= 3 && cand.length < k * 3; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring && ring > 1) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gc || ny >= gr) continue;
          for (const j of buckets[ny * gc + nx]) {
            if (j !== i) cand.push(j);
          }
        }
      }
      if (ring === 1) {
        // also include own cell
        for (const j of buckets[cy * gc + cx]) if (j !== i) cand.push(j);
      }
    }
    cand.sort((a, b) => g.euclidean(i, a) - g.euclidean(i, b));
    result.push(cand.slice(0, k));
  }
  return result;
}

export function generateMap(opts = {}) {
  const seed = opts.seed ?? 42;
  const rng = new RNG(seed);
  const W = opts.width ?? 340; // km
  const H = opts.height ?? 230; // km
  const cityCount = opts.cityCount ?? 11;
  const townCount = opts.townCount ?? 26;
  const targetNodes = opts.nodes ?? 850;

  const g = new Graph();
  g.kind = 'map';
  g.weightKind = 'time';
  g.speedLimit = MAX_SPEED / 60; // heuristic returns minutes
  g.roadSpeeds = SPEEDS;

  // Place cities, then towns (kept apart from cities), then junctions to fill.
  const cityPts = poissonPoints(rng, W, H, Math.min(W, H) * 0.22, cityCount);
  const townPts = poissonPoints(rng, W, H, Math.min(W, H) * 0.07, townCount, cityPts);
  const junctionTarget = Math.max(0, targetNodes - cityPts.length - townPts.length);
  const junctionPts = poissonPoints(
    rng, W, H, Math.min(W, H) * 0.012, junctionTarget,
    cityPts.concat(townPts)
  );

  const cityNames = rng.shuffle(CITY_NAMES.slice()).slice(0, cityPts.length);
  const townBase = rng.shuffle(TOWN_NAMES.slice());
  const cities = [];
  const pois = [];

  cityPts.forEach((p, i) => {
    const id = g.addNode(p.x, p.y, { name: cityNames[i], kind: 'city' });
    cities.push({ id, name: cityNames[i] });
    pois.push({ id, name: cityNames[i], kind: 'city' });
  });
  townPts.forEach((p, i) => {
    const suffix = rng.pick(['ton', 'ville', 'ham', 'field', 'wood', 'borough', 'ford', 'stead']);
    const name = `${townBase[i % townBase.length]}${suffix}`;
    const id = g.addNode(p.x, p.y, { name, kind: 'town' });
    pois.push({ id, name, kind: 'town' });
  });
  junctionPts.forEach((p) => {
    g.addNode(p.x, p.y, { kind: 'junction' });
  });

  const kindRank = (id) => {
    const k = g.meta[id] && g.meta[id].kind;
    return k === 'city' ? 2 : k === 'town' ? 1 : 0;
  };

  const seen = new Set();
  const key = (a, b) => (a < b ? a * g.n + b : b * g.n + a);
  const classify = (a, b, km) => {
    const r = Math.max(kindRank(a), kindRank(b));
    if (r === 2) return km > 28 ? 'highway' : 'arterial';
    if (r === 1) return km > 40 ? 'highway' : 'arterial';
    return km > 22 ? 'arterial' : 'local';
  };
  const addRoad = (a, b, forceClass) => {
    if (a === b) return;
    const kk = key(a, b);
    if (seen.has(kk)) return;
    seen.add(kk);
    const km = g.euclidean(a, b);
    const cls = forceClass || classify(a, b, km);
    const speed = SPEEDS[cls];
    const minutes = (km / speed) * 60;
    g.addEdge(a, b, minutes, false);
    // tag the class/length on both directions' edge records
    const ea = g.adj[a][g.adj[a].length - 1];
    const eb = g.adj[b][g.adj[b].length - 1];
    ea.cls = eb.cls = cls;
    ea.km = eb.km = km;
    ea.speed = eb.speed = speed;
  };

  // 1) MST backbone over everything → guarantees a connected network.
  for (const [a, b] of primMST(g)) addRoad(a, b);

  // 2) Local mesh: connect every node to a few nearest neighbors for redundancy.
  const knn = kNearest(g, 4, Math.min(W, H) / 12, W, H);
  for (let i = 0; i < g.n; i++) {
    for (const j of knn[i]) addRoad(i, j);
  }

  // 3) Highways: connect each city to its 2-3 nearest cities directly (express).
  const cityIds = cities.map((c) => c.id);
  for (const a of cityIds) {
    const others = cityIds
      .filter((b) => b !== a)
      .sort((p, q) => g.euclidean(a, p) - g.euclidean(a, q))
      .slice(0, 3);
    for (const b of others) addRoad(a, b, 'highway');
  }

  // Choose default start/goal as two well-separated cities.
  let start = cityIds[0];
  let goal = cityIds[0];
  let bestSep = -1;
  for (let i = 0; i < cityIds.length; i++) {
    for (let j = i + 1; j < cityIds.length; j++) {
      const d = g.euclidean(cityIds[i], cityIds[j]);
      if (d > bestSep) {
        bestSep = d;
        start = cityIds[i];
        goal = cityIds[j];
      }
    }
  }

  pois.sort((a, b) => a.name.localeCompare(b.name));
  cities.sort((a, b) => a.name.localeCompare(b.name));

  return {
    graph: g,
    start,
    goal,
    cities,
    pois,
    label: `${cities.length} cities · ${g.n.toLocaleString()} nodes · ${g.m.toLocaleString()} road segments`,
  };
}
