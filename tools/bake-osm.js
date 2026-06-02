// tools/bake-osm.js — convert raw OpenStreetMap (Overpass JSON) into a compact,
// routable graph JSON the app can load. Dev-time only.
//   node tools/bake-osm.js <overpass.json> <out.json> "<Place Name>"
import { readFileSync, writeFileSync } from 'fs';

const [, , INP, OUT, PLACE = 'OSM area'] = process.argv;

const CLASS = {
  motorway: ['highway', 100], trunk: ['highway', 85], primary: ['highway', 65],
  motorway_link: ['highway', 60], trunk_link: ['highway', 55], primary_link: ['arterial', 50],
  secondary: ['arterial', 55], tertiary: ['arterial', 45],
  secondary_link: ['arterial', 40], tertiary_link: ['arterial', 35],
  residential: ['local', 30], unclassified: ['local', 40], living_street: ['local', 12],
  service: ['local', 18],
};
const defaultFor = (hw) => CLASS[hw] || ['local', 30];

function parseSpeed(tag, fallback) {
  if (!tag) return fallback;
  const m = /(\d+(?:\.\d+)?)/.exec(tag);
  if (!m) return fallback;
  let v = parseFloat(m[1]);
  if (/mph/i.test(tag)) v *= 1.60934;
  return v > 1 ? v : fallback;
}

function hav(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const raw = JSON.parse(readFileSync(INP, 'utf8')).elements;
const coord = new Map(); // osm node id -> {lat,lon}
const ways = [];
for (const el of raw) {
  if (el.type === 'node') coord.set(el.id, { lat: el.lat, lon: el.lon });
  else if (el.type === 'way' && el.tags && el.tags.highway) ways.push(el);
}

// Build directed edges between consecutive way nodes; collect used node ids.
const used = new Set();
const rawEdges = []; // {a,b,w,cls,oneway, name}
let maxSpeed = 1;
for (const w of ways) {
  const hw = w.tags.highway;
  const [cls, defSpeed] = defaultFor(hw);
  const speed = parseSpeed(w.tags.maxspeed, defSpeed);
  if (speed > maxSpeed) maxSpeed = speed;
  const oneway = w.tags.oneway === 'yes' || w.tags.oneway === 'true' || w.tags.oneway === '1' ? 1
    : w.tags.oneway === '-1' ? -1 : 0;
  const ns = w.nodes;
  for (let i = 0; i + 1 < ns.length; i++) {
    const a = ns[i], b = ns[i + 1];
    const ca = coord.get(a), cb = coord.get(b);
    if (!ca || !cb) continue;
    const km = hav(ca.lat, ca.lon, cb.lat, cb.lon);
    if (km <= 0) continue;
    const minutes = (km / speed) * 60;
    rawEdges.push({ a, b, w: minutes, cls, oneway, name: w.tags.name || null });
    used.add(a); used.add(b);
  }
}

// Largest connected component (undirected) via union-find.
const ids = [...used];
const idx = new Map(ids.map((id, i) => [id, i]));
const parent = ids.map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
for (const e of rawEdges) union(idx.get(e.a), idx.get(e.b));
const compCount = new Map();
for (let i = 0; i < ids.length; i++) { const r = find(i); compCount.set(r, (compCount.get(r) || 0) + 1); }
let bestComp = -1, bestN = -1;
for (const [r, c] of compCount) if (c > bestN) { bestN = c; bestComp = r; }
const inComp = (i) => find(i) === bestComp;

// Reindex kept nodes; project lat/lon -> km coordinates (north up).
const lat0 = ids.reduce((s, id) => s + coord.get(id).lat, 0) / ids.length;
const lon0 = ids.reduce((s, id) => s + coord.get(id).lon, 0) / ids.length;
const kmPerLat = 110.574;
const kmPerLon = 111.320 * Math.cos((lat0 * Math.PI) / 180);
const newIndex = new Map();
const X = [], Y = [], NAME = [];
for (let i = 0; i < ids.length; i++) {
  if (!inComp(i)) continue;
  const id = ids[i];
  const c = coord.get(id);
  newIndex.set(i, X.length);
  X.push(+((c.lon - lon0) * kmPerLon).toFixed(4));
  Y.push(+(-(c.lat - lat0) * kmPerLat).toFixed(4));
  NAME.push(null);
}

// edges referencing reindexed nodes
const seen = new Set();
const E = [];
const clsCode = { local: 0, arterial: 1, highway: 2 };
for (const e of rawEdges) {
  const ia = idx.get(e.a), ib = idx.get(e.b);
  if (!inComp(ia) || !inComp(ib)) continue;
  const u = newIndex.get(ia), v = newIndex.get(ib);
  if (u === v) continue;
  const key = u < v ? u + ':' + v : v + ':' + u;
  // keep one record per undirected pair (min weight); track oneway
  if (seen.has(key)) continue;
  seen.add(key);
  E.push([u, v, +e.w.toFixed(3), clsCode[e.cls], e.oneway]);
}

// POIs: representative node per distinct street name (for the From/To dropdowns).
const byName = new Map();
for (const e of rawEdges) {
  if (!e.name) continue;
  const ia = idx.get(e.a);
  if (!inComp(ia)) continue;
  if (!byName.has(e.name)) byName.set(e.name, newIndex.get(ia));
}
let pois = [...byName.entries()].map(([name, id]) => ({ id, name })).filter((p) => p.id != null);
// spread them out: sort by name, cap
pois.sort((a, b) => a.name.localeCompare(b.name));
if (pois.length > 24) {
  const step = pois.length / 24;
  pois = Array.from({ length: 24 }, (_, k) => pois[Math.floor(k * step)]);
}
for (const p of pois) NAME[p.id] = p.name;

// default start/goal = two POIs (or nodes) maximally far apart
let start = 0, goal = X.length - 1, best = -1;
const cand = pois.length >= 2 ? pois.map((p) => p.id) : X.map((_, i) => i).filter((_, i) => i % Math.ceil(X.length / 40) === 0);
for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
  const dx = X[cand[i]] - X[cand[j]], dy = Y[cand[i]] - Y[cand[j]];
  const d = dx * dx + dy * dy;
  if (d > best) { best = d; start = cand[i]; goal = cand[j]; }
}

const out = {
  place: PLACE,
  n: X.length,
  maxSpeed,
  x: X, y: Y,
  names: pois.map((p) => [p.id, p.name]),
  edges: E,
  start, goal,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`${PLACE}: ${X.length} nodes, ${E.length} edges, ${pois.length} named POIs, ${(JSON.stringify(out).length / 1024 / 1024).toFixed(2)} MB -> ${OUT}`);
