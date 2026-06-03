// leaflet-renderer.js
// A Renderer that draws the search animation on top of a REAL slippy map
// (Leaflet + modern raster tiles), instead of the self-contained canvas basemap.
//
// The trick: the whole canvas Renderer routes every coordinate through
// worldToScreen()/screenToWorld(). So we subclass it and override ONLY those two
// projections (graph-km ↔ Leaflet container pixel) plus a transparent base layer
// — and inherit all of the search state, overlay compositing and path drawing
// for free. The tiles ARE the basemap; we paint settled/frontier/path on a
// transparent canvas pinned over the map and redraw on every pan/zoom.
//
// To get as close to Google-Maps quality as a keyless static site can:
//   • CARTO "Voyager" retina vector-style tiles as the default street map,
//   • an Esri World-Imagery satellite layer (with place labels) one toggle away,
//   • a Google-style route (blue core + white casing) and A/B teardrop pins,
//   • repaints coalesced into one rAF per pan/zoom burst so big graphs stay smooth.
//
// Requires the global `L` (Leaflet). The graph must carry
// `geo = {lat0, lon0, kmPerLat, kmPerLon}` (baked by tools/bake-osm.js). If
// either is missing the section falls back to the plain canvas Renderer, so this
// path is never the only thing between the user and a working map.

import { Renderer } from './renderer.js';

// Keyless, retina-capable basemaps. {r} → "@2x" on hi-dpi via detectRetina.
const BASEMAPS = {
  streets: {
    label: 'Map',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opts: {
      subdomains: 'abcd', maxZoom: 20, detectRetina: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: {
      maxZoom: 20, maxNativeZoom: 19,
      attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    },
    // Place / road labels painted over the imagery (like Google's "Satellite").
    labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
};

export class LeafletRenderer extends Renderer {
  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.style = 'map';
    this.geo = opts.geo || null;
    this.basemapKey = opts.basemap || 'streets';
    this._mapReady = false;
    this._repaintScheduled = false;
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

    // Start centred on the graph's own region (geo carries the bake centroid) so
    // we never flash the [0,0] Gulf-of-Guinea tiles before fitBounds runs.
    const center = this.geo ? [this.geo.lat0, this.geo.lon0] : [20, 0];
    this.map = L.map(mapDiv, {
      zoomControl: false,        // the stage already has Fit / + / − buttons
      attributionControl: true,
      zoomAnimation: false,      // keep the canvas overlay pixel-aligned with tiles
      fadeAnimation: false,
      markerZoomAnimation: false,
      doubleClickZoom: false,    // double-click is reserved for setting endpoints fast
      worldCopyJump: false,
      preferCanvas: true,
    }).setView(center, this.geo ? 14 : 3);

    this._baseLayer = null;
    this._labelLayer = null;
    this._setBasemap(this.basemapKey);
    this._addLayerToggle();
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    // Coalesce the flood of move/zoom events into one repaint per animation
    // frame — panning a finished search on a 16k-node city would otherwise
    // re-project every settled node many times per frame.
    const onMove = () => this._scheduleRepaint();
    this.map.on('move zoom zoomend moveend resize viewreset', onMove);
    this._onMove = onMove;
    this._mapReady = true;
  }

  _setBasemap(key) {
    const L = window.L;
    const def = BASEMAPS[key] || BASEMAPS.streets;
    this.basemapKey = BASEMAPS[key] ? key : 'streets';
    if (this._baseLayer) { this.map.removeLayer(this._baseLayer); this._baseLayer = null; }
    if (this._labelLayer) { this.map.removeLayer(this._labelLayer); this._labelLayer = null; }
    this._baseLayer = L.tileLayer(def.url, def.opts).addTo(this.map);
    if (def.labels) {
      this._labelLayer = L.tileLayer(def.labels, { maxZoom: 20, maxNativeZoom: 19, pane: 'overlayPane' }).addTo(this.map);
    }
    this._scheduleRepaint();
  }

  // Compact two-button basemap switch (Map / Satellite), styled in css/style.css.
  _addLayerToggle() {
    const L = window.L;
    const ctl = L.control({ position: 'topright' });
    ctl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-layer-toggle');
      for (const [key, def] of Object.entries(BASEMAPS)) {
        const b = L.DomUtil.create('button', key === this.basemapKey ? 'active' : '', div);
        b.type = 'button';
        b.textContent = def.label;
        b.dataset.k = key;
      }
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        this._setBasemap(b.dataset.k);
        div.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      return div;
    };
    ctl.addTo(this.map);
    this._layerToggle = ctl;
  }

  _scheduleRepaint() {
    if (this._repaintScheduled || !this._mapReady) return;
    this._repaintScheduled = true;
    requestAnimationFrame(() => {
      this._repaintScheduled = false;
      this._fullRepaint = true;
      this.render();
    });
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

  // The tiles are the basemap, so the base layer stays fully transparent.
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
    this.map.fitBounds(bounds, { padding: [28, 28], animate: false });
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

  // ── Google-style route + pins (override the dark-canvas versions, which are
  // tuned for the night-mode graph pages and would vanish on light tiles). ──
  _drawPath(ctx) {
    if (!this.path || this.path.length < 2) return;
    const g = this.graph;
    const pts = this.path.map((id) => this.worldToScreen(g.x[id], g.y[id]));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i];
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; // white casing
    ctx.lineWidth = 9;
    trace();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#1a73e8';                // Google route blue
    ctx.lineWidth = 5.5;
    trace();
    ctx.restore();
  }

  _drawMarkers(ctx) {
    this._pin(ctx, this.start, '#1a73e8', 'A');
    this._pin(ctx, this.goal, '#ea4335', 'B');
  }

  _pin(ctx, node, color, label) {
    if (node < 0 || node >= this.graph.n) return;
    const [x, y] = this.worldToScreen(this.graph.x[node], this.graph.y[node]);
    const r = 11;        // head radius
    const cy = y - 26;   // head centre sits above the tip
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);          // head
    ctx.moveTo(x - r * 0.6, cy + r * 0.78);     // tail triangle → tip
    ctx.lineTo(x, y);
    ctx.lineTo(x + r * 0.6, cy + r * 0.78);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 12px ' + '-apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, cy + 0.5);
    ctx.restore();
    ctx.textAlign = 'start';
  }

  // Called by the Visualizer when this renderer is being torn down / replaced,
  // so we don't leak Leaflet maps and their window listeners across re-mounts.
  destroy() {
    super.destroy();
    try {
      if (this.map) { this.map.off(); this.map.remove(); this.map = null; }
      if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    } catch (e) { /* ignore */ }
    this._mapReady = false;
  }
}
