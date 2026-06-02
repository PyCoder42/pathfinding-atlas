// leaflet-renderer.js
// A Renderer that draws the search animation on top of a REAL slippy map
// (Leaflet + OpenStreetMap tiles), instead of the self-contained canvas basemap.
//
// The trick: the whole canvas Renderer routes every coordinate through
// worldToScreen()/screenToWorld(). So we subclass it and override ONLY those two
// projections (graph-km ↔ Leaflet container pixel) plus a transparent base layer
// — and inherit all of the search state, overlay compositing, path and marker
// drawing for free. The OSM tiles ARE the basemap; we paint settled/frontier/
// path on a transparent canvas pinned over the map and redraw on every pan/zoom.
//
// Requires the global `L` (Leaflet) to be loaded (see js/vendor/leaflet). The
// graph must carry `geo = {lat0, lon0, kmPerLat, kmPerLon}` (baked by tools/
// bake-osm.js). If either is missing the section falls back to the plain
// canvas Renderer, so this path is never the only thing standing between the
// user and a working map.

import { Renderer } from './renderer.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export class LeafletRenderer extends Renderer {
  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.style = 'map';
    this.geo = opts.geo || null;
    this._mapReady = false;
    this._buildHost(canvas);
  }

  _buildHost(canvas) {
    const L = window.L;
    const parent = canvas.parentNode;
    const host = document.createElement('div');
    host.className = 'leaflet-host';
    const mapDiv = document.createElement('div');
    mapDiv.className = 'leaflet-map';
    if (parent) parent.insertBefore(host, canvas);
    host.appendChild(mapDiv);
    host.appendChild(canvas); // overlay canvas sits on top of the tiles
    canvas.classList.add('leaflet-overlay-canvas');
    this.host = host;

    this.map = L.map(mapDiv, {
      zoomControl: false,        // the stage already has Fit / + / − buttons
      attributionControl: true,
      zoomAnimation: false,      // keep the canvas overlay pixel-aligned with tiles
      fadeAnimation: false,
      markerZoomAnimation: false,
      doubleClickZoom: false,    // double-click is reserved for setting endpoints fast
      worldCopyJump: false,
    }).setView([0, 0], 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, minZoom: 2, attribution: ATTRIB }).addTo(this.map);

    const onMove = () => { this._fullRepaint = true; this.render(); };
    this.map.on('move zoom zoomend moveend resize', onMove);
    this._onMove = onMove;
    this._mapReady = true;
  }

  // graph km → pixel relative to the map container (== the overlay canvas origin)
  worldToScreen(wx, wy) {
    const g = this.geo;
    if (!g || !this.map) return [wx, wy];
    const lat = g.lat0 - wy / g.kmPerLat;
    const lon = g.lon0 + wx / g.kmPerLon;
    const p = this.map.latLngToContainerPoint([lat, lon]);
    return [p.x, p.y];
  }

  screenToWorld(sx, sy) {
    const g = this.geo;
    if (!g || !this.map) return [sx, sy];
    const ll = this.map.containerPointToLatLng([sx, sy]);
    return [(ll.lng - g.lon0) * g.kmPerLon, -(ll.lat - g.lat0) * g.kmPerLat];
  }

  // The OSM tiles are the basemap, so the base layer stays fully transparent.
  rebuildBase() {
    if (!this._baseCtx) return;
    this._baseCtx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._baseCtx.clearRect(0, 0, this._cssW, this._cssH);
  }

  resize() {
    if (this.map) this.map.invalidateSize({ animate: false });
    const rect = this.canvas.getBoundingClientRect();
    this._cssW = Math.max(1, Math.floor(rect.width));
    this._cssH = Math.max(1, Math.floor(rect.height));
    const dpr = this._dpr;
    for (const cv of [this.canvas, this._base, this._overlay]) {
      cv.width = this._cssW * dpr;
      cv.height = this._cssH * dpr;
    }
    this._fullRepaint = true;
    this.rebuildBase();
    this.render();
  }

  fitView() {
    if (!this.graph || !this.map || !this.geo) return;
    const b = this.graph.bounds();
    const g = this.geo;
    const toLL = (x, y) => [g.lat0 - y / g.kmPerLat, g.lon0 + x / g.kmPerLon];
    const bounds = window.L.latLngBounds(toLL(b.minX, b.minY), toLL(b.maxX, b.maxY));
    this.map.fitBounds(bounds, { padding: [24, 24], animate: false });
    this._fullRepaint = true;
    this.rebuildBase();
    this.render();
  }

  // Stage +/− buttons go through here (Visualizer._zoom prefers zoomBy).
  zoomBy(factor) {
    if (this.map) this.map.setZoom(this.map.getZoom() + (factor > 1 ? 1 : -1));
  }

  // Leaflet owns pan/zoom/click (the overlay canvas is pointer-events:none),
  // so endpoint picking listens to the map's click instead of the canvas.
  enableInteraction({ onPick } = {}) {
    if (!this.map) return;
    if (this._clickHandler) this.map.off('click', this._clickHandler);
    this._clickHandler = (e) => {
      const p = this.map.latLngToContainerPoint(e.latlng);
      const node = this.nearestNode(p.x, p.y, 44);
      if (node >= 0 && onPick) onPick(node, e.originalEvent || {});
    };
    this.map.on('click', this._clickHandler);
  }

  // Hit-test in screen space using the world-space spatial hash. The inherited
  // version assumes the canvas viewport scale; here the scale is the Leaflet
  // zoom, so we derive the world search radius from the click pixel span.
  nearestNode(sx, sy, maxPx = 44) {
    if (!this.graph) return -1;
    const [wx, wy] = this.screenToWorld(sx, sy);
    const [wx2, wy2] = this.screenToWorld(sx + maxPx, sy);
    const radius = Math.hypot(wx2 - wx, wy2 - wy) || 1e-6;
    if (!this._index) this._buildIndex();
    const idx = this._index;
    const cx = Math.floor((wx - idx.b.minX) / idx.cell);
    const cy = Math.floor((wy - idx.b.minY) / idx.cell);
    const reach = Math.max(1, Math.ceil(radius / idx.cell));
    let best = -1, bestD = radius * radius;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const arr = idx.buckets.get(idx.keyOf(cx + dx, cy + dy));
        if (!arr) continue;
        for (const i of arr) {
          const ddx = this.graph.x[i] - wx, ddy = this.graph.y[i] - wy;
          const d = ddx * ddx + ddy * ddy;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return best;
  }

  // Called by the Visualizer when this renderer is being torn down / replaced,
  // so we don't leak Leaflet maps and their window listeners across re-mounts.
  destroy() {
    try {
      if (this.map) { this.map.off(); this.map.remove(); this.map = null; }
      if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    } catch (e) { /* ignore */ }
    this._mapReady = false;
  }
}
