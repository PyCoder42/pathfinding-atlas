// utils.js
// Small shared helpers: seeded RNG, formatting, color ramps, geometry.

// Deterministic PRNG (mulberry32). Same seed -> same graph, so a "regenerate
// with this seed" button and shareable scenarios are possible.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seeded RNG with convenience helpers.
export class RNG {
  constructor(seed = 1) {
    this._next = mulberry32(seed);
  }
  float() {
    return this._next();
  }
  // integer in [min, max]
  int(min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  }
  range(min, max) {
    return min + this._next() * (max - min);
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  bool(p = 0.5) {
    return this._next() < p;
  }
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Format a duration in milliseconds for display.
export function fmtTime(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '–';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Format a (possibly large) integer with thousands separators.
export function fmtInt(n) {
  if (n === undefined || n === null || !Number.isFinite(n)) return '–';
  return Math.round(n).toLocaleString('en-US');
}

// Format a cost value. For time-weighted graphs, render as minutes/hours.
export function fmtCost(v, kind = 'distance') {
  if (v === undefined || v === null || !Number.isFinite(v)) return '–';
  if (kind === 'time') {
    const mins = v;
    if (mins < 60) return `${mins.toFixed(1)} min`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h} h ${m} min`;
  }
  return v.toFixed(1);
}

// Linear interpolation between two hex colors, returns "rgb(...)".
export function mixHex(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(lerp(a.r, b.r, t));
  const g = Math.round(lerp(a.g, b.g, t));
  const bl = Math.round(lerp(a.b, b.b, t));
  return `rgb(${r},${g},${bl})`;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3
      ? h.split('').map((c) => c + c).join('')
      : h,
    16
  );
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// A perceptually-okay "cool->warm" ramp for visualizing search depth / cost.
// t in [0,1]. 0 = cool blue, 1 = hot red.
export function heatColor(t) {
  t = clamp(t, 0, 1);
  // blue -> cyan -> green -> yellow -> red
  const stops = ['#2b3a8f', '#1f8fc7', '#23c08a', '#f2c14e', '#e7553b'];
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  return mixHex(stops[i], stops[i + 1], seg - i);
}

// Throttle to once per animation frame would require rAF; this is a simple
// time-based throttle for resize handlers etc.
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = performance.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = performance.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
