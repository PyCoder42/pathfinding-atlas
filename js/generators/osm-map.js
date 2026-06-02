// osm-map.js — build a routable Graph from baked OpenStreetMap data (real roads).
// The data files in /data are produced by tools/bake-osm.js from Overpass output.
// Coordinates are in kilometres (north-up); edge weights are travel TIME in
// minutes (length / speed), so the shortest path is the fastest route — exactly
// like a real router. Roads are treated as two-way for connectivity.
//
//   graph.kind='map', weightKind='time', speedLimit = maxSpeed/60 (admissible heuristic)
//   edge records carry .cls ('highway'|'arterial'|'local') for styling.

import { Graph } from '../core/graph.js';

const CLS = ['local', 'arterial', 'highway'];

export function buildOSMGraph(data) {
  const g = new Graph();
  g.kind = 'map';
  g.weightKind = 'time';
  g.speedLimit = (data.maxSpeed || 100) / 60; // heuristic = straight-km / maxSpeed (minutes)
  g.equalWeights = false;
  g.osm = true;
  // Linear projection params so a Leaflet basemap can place nodes geographically:
  //   lon = lon0 + x/kmPerLon ,  lat = lat0 - y/kmPerLat   (exact inverse of bake).
  if (data.geo) g.geo = data.geo;

  const names = new Map((data.names || []).map(([id, name]) => [id, name]));
  for (let i = 0; i < data.n; i++) {
    g.addNode(data.x[i], data.y[i], names.has(i) ? { name: names.get(i), kind: 'city' } : null);
  }
  for (const e of data.edges) {
    const u = e[0], v = e[1], w = e[2], clsCode = e[3];
    g.addEdge(u, v, w, false); // two-way
    const cls = CLS[clsCode] || 'local';
    g.adj[u][g.adj[u].length - 1].cls = cls;
    g.adj[v][g.adj[v].length - 1].cls = cls;
  }

  const cities = (data.names || [])
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    graph: g,
    start: data.start,
    goal: data.goal,
    cities,
    pois: cities,
    label: `${data.place} · ${g.n.toLocaleString()} intersections · real OpenStreetMap data`,
  };
}

export async function loadOSM(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return buildOSMGraph(await res.json());
}
