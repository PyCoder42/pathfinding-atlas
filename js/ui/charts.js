// charts.js
// Self-contained, dependency-free Canvas 2D charting helpers.
//
// Two public entry points:
//   drawLineChart(canvas, config) — multi-series line chart with optional
//                                   logarithmic x/y axes.
//   drawBarChart(canvas, config)  — grouped/simple bar chart (bonus).
//
// Both render onto an existing <canvas> element and handle high-DPI displays
// the same way renderer.js does: read the element's CSS size, scale the backing
// store by min(devicePixelRatio, 2), then draw entirely in CSS pixels via
// ctx.setTransform(dpr, 0, 0, dpr, 0, 0).
//
// Design goals: robust to empty/short series, sane behaviour on log scales
// (non-positive values are skipped), dark theme that matches the rest of the UI.

// ── theme ───────────────────────────────────────────────────────────────────
const THEME = {
  bg: '#0e1320',          // chart background (matches renderer.js PALETTE.bg)
  grid: 'rgba(120,140,180,0.12)', // subtle gridlines
  axis: 'rgba(150,170,210,0.45)', // axis lines
  text: '#9aa7c2',        // tick + axis label text
  title: '#dce4f5',       // brighter title text
  // default vibrant series palette (used when a series omits `color`)
  series: ['#4f86f7', '#f5a623', '#36d399', '#ff6b6b', '#a78bfa', '#22d3ee', '#f472b6', '#facc15'],
};

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

// ── high-DPI setup (mirrors renderer.js) ─────────────────────────────────────
/**
 * Resize the canvas backing store for crisp rendering and return a context
 * already transformed so that all drawing happens in CSS pixels.
 * @returns {{ ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number }}
 */
function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  // Fall back to attribute size if the element isn't laid out yet (e.g. detached).
  const cssW = Math.max(1, Math.floor(rect.width || canvas.width || 300));
  const cssH = Math.max(1, Math.floor(rect.height || canvas.height || 150));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH, dpr };
}

// ── small helpers ─────────────────────────────────────────────────────────────
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Format a tick value compactly: integers stay plain, otherwise use a short
// fixed/precision form, and switch to scientific notation for extreme magnitudes.
function fmtNumber(v) {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-4) return v.toExponential(1).replace('e+', 'e');
  if (Number.isInteger(v)) return String(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
  return v.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Produce "nice" linear ticks covering [min, max] with roughly `count` steps,
 * snapping the step to 1/2/5 * 10^k so labels read cleanly.
 */
function niceLinearTicks(min, max, count = 6) {
  if (!(max > min)) {
    // Degenerate range: fabricate a small symmetric window around the value.
    const c = isFiniteNum(min) ? min : 0;
    const pad = Math.abs(c) > 0 ? Math.abs(c) * 0.5 : 1;
    min = c - pad;
    max = c + pad;
  }
  const range = max - min;
  const rawStep = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  // Snap to a friendly multiple.
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  // Guard against runaway loops if step underflows.
  for (let t = start, i = 0; t <= max + step * 1e-6 && i < 1000; t += step, i++) {
    // Re-snap to step to avoid float drift accumulating in the label.
    ticks.push(Math.round(t / step) * step);
  }
  return { ticks, niceMin: min, niceMax: max };
}

/**
 * Produce log-scale ticks (powers of ten) covering [min, max] in *value* space.
 * Both bounds are assumed positive. Returns tick values (not exponents).
 */
function niceLogTicks(min, max) {
  const loMin = Math.floor(Math.log10(min));
  const loMax = Math.ceil(Math.log10(max));
  const ticks = [];
  for (let e = loMin; e <= loMax && ticks.length < 100; e++) ticks.push(Math.pow(10, e));
  return { ticks, niceMin: Math.pow(10, loMin), niceMax: Math.pow(10, loMax) };
}

// Build a value→pixel mapping for one axis, honouring log scale.
function makeScale({ min, max, pxMin, pxMax, log }) {
  if (log) {
    const lmin = Math.log10(min);
    const lmax = Math.log10(max);
    const span = lmax - lmin || 1;
    return (v) => pxMin + ((Math.log10(v) - lmin) / span) * (pxMax - pxMin);
  }
  const span = max - min || 1;
  return (v) => pxMin + ((v - min) / span) * (pxMax - pxMin);
}

// Filter a [x,y] point list to those usable under the active scales.
function validPoints(points, logX, logY) {
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [x, y] = p;
    if (!isFiniteNum(x) || !isFiniteNum(y)) continue;
    if (logX && x <= 0) continue; // log of non-positive is undefined → skip
    if (logY && y <= 0) continue;
    out.push([x, y]);
  }
  return out;
}

// Draw a "no data" placeholder centered in the plotting area.
function drawEmpty(ctx, w, h, title) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);
  if (title) {
    ctx.fillStyle = THEME.title;
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, 12, 10);
  }
  ctx.fillStyle = THEME.text;
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('No data', w / 2, h / 2);
  ctx.textAlign = 'left';
}

// ── public: clear ─────────────────────────────────────────────────────────────
/**
 * Reset a canvas to a blank dark-theme background. Handles high-DPI sizing the
 * same way the chart renderers do, so a cleared canvas matches a drawn one.
 * @param {HTMLCanvasElement} canvas
 */
export function clearChart(canvas) {
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);
}

// ── line chart ────────────────────────────────────────────────────────────────
/**
 * Draw a multi-series line chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   series?: Array<{ label?: string, color?: string, points: Array<[number,number]> }>,
 *   title?: string, xLabel?: string, yLabel?: string,
 *   logY?: boolean, logX?: boolean
 * }} config
 */
export function drawLineChart(canvas, config = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const { title, xLabel, yLabel, logX = false, logY = false } = config;
  const series = Array.isArray(config.series) ? config.series : [];

  // Normalise each series and drop points that don't survive the active scales.
  const prepared = series.map((s, i) => ({
    label: s && s.label != null ? String(s.label) : `series ${i + 1}`,
    color: (s && s.color) || THEME.series[i % THEME.series.length],
    points: validPoints((s && s.points) || [], logX, logY),
  }));

  // Compute combined data bounds across all drawable points.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of prepared) {
    for (const [x, y] of s.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  // Robust to empty / all-skipped input.
  if (!isFiniteNum(minX) || !isFiniteNum(minY)) {
    drawEmpty(ctx, w, h, title);
    return;
  }

  // ── layout: reserve margins for labels/title/legend ──
  const hasTitle = !!title;
  const hasLegend = prepared.some((s) => s.points.length > 0);
  const m = {
    top: (hasTitle ? 28 : 12) + (hasLegend ? 18 : 0),
    right: 16,
    bottom: 40 + (xLabel ? 16 : 0),
    left: 52 + (yLabel ? 16 : 0),
  };
  const plotW = Math.max(1, w - m.left - m.right);
  const plotH = Math.max(1, h - m.top - m.bottom);
  const plot = { x0: m.left, y0: m.top, x1: m.left + plotW, y1: m.top + plotH };

  // ── background ──
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);

  // ── compute ticks + axis domains ──
  const xTickInfo = logX ? niceLogTicks(minX, maxX) : niceLinearTicks(minX, maxX, 6);
  const yTickInfo = logY ? niceLogTicks(minY, maxY) : niceLinearTicks(minY, maxY, 6);

  // For linear axes, expand the domain to the nice tick bounds so points don't
  // sit exactly on the frame; for log axes use the power-of-ten envelope.
  const domMinX = logX ? xTickInfo.niceMin : Math.min(minX, xTickInfo.ticks[0] ?? minX);
  const domMaxX = logX ? xTickInfo.niceMax : Math.max(maxX, xTickInfo.ticks.at(-1) ?? maxX);
  const domMinY = logY ? yTickInfo.niceMin : Math.min(minY, yTickInfo.ticks[0] ?? minY);
  const domMaxY = logY ? yTickInfo.niceMax : Math.max(maxY, yTickInfo.ticks.at(-1) ?? maxY);

  const sx = makeScale({ min: domMinX, max: domMaxX, pxMin: plot.x0, pxMax: plot.x1, log: logX });
  // y is inverted: data max → top (small pixel y).
  const sy = makeScale({ min: domMinY, max: domMaxY, pxMin: plot.y1, pxMax: plot.y0, log: logY });

  // ── gridlines + tick labels ──
  ctx.font = `11px ${FONT}`;
  ctx.lineWidth = 1;

  // vertical gridlines (x ticks)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xTickInfo.ticks) {
    if (t < domMinX || t > domMaxX) continue;
    const px = sx(t);
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    ctx.moveTo(px, plot.y0);
    ctx.lineTo(px, plot.y1);
    ctx.stroke();
    ctx.fillStyle = THEME.text;
    ctx.fillText(fmtNumber(t), px, plot.y1 + 6);
  }

  // horizontal gridlines (y ticks)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yTickInfo.ticks) {
    if (t < domMinY || t > domMaxY) continue;
    const py = sy(t);
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x0, py);
    ctx.lineTo(plot.x1, py);
    ctx.stroke();
    ctx.fillStyle = THEME.text;
    ctx.fillText(fmtNumber(t), plot.x0 - 8, py);
  }

  // ── axis lines (left + bottom frame) ──
  ctx.strokeStyle = THEME.axis;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(plot.x0, plot.y0);
  ctx.lineTo(plot.x0, plot.y1);
  ctx.lineTo(plot.x1, plot.y1);
  ctx.stroke();

  // ── clip to plotting area while drawing series so stray points stay inside ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x0, plot.y0, plotW, plotH);
  ctx.clip();

  for (const s of prepared) {
    if (s.points.length === 0) continue;
    // Sort by x so the polyline reads left-to-right regardless of input order.
    const pts = s.points.slice().sort((a, b) => a[0] - b[0]);

    // polyline
    if (pts.length >= 2) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const px = sx(pts[i][0]);
        const py = sy(pts[i][1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // small dots at each point (also covers the single-point case)
    ctx.fillStyle = s.color;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // ── axis labels ──
  ctx.fillStyle = THEME.text;
  ctx.font = `12px ${FONT}`;
  if (xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xLabel + (logX ? ' (log)' : ''), plot.x0 + plotW / 2, h - 6);
  }
  if (yLabel) {
    // rotated vertical label hugging the left edge
    ctx.save();
    ctx.translate(14, plot.y0 + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(yLabel + (logY ? ' (log)' : ''), 0, 0);
    ctx.restore();
  }

  // ── title ──
  if (title) {
    ctx.fillStyle = THEME.title;
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, m.left, 8);
  }

  // ── legend (top-right, single row of swatch + label entries) ──
  if (hasLegend) {
    const entries = prepared.filter((s) => s.points.length > 0);
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const swatch = 9;
    const gap = 6;
    const itemGap = 14;
    const legendY = hasTitle ? 16 : 14;
    // Measure total width, then right-align the legend row within the plot.
    let totalW = 0;
    for (const s of entries) totalW += swatch + gap + ctx.measureText(s.label).width + itemGap;
    let lx = Math.max(plot.x0, plot.x1 - totalW + itemGap);
    for (const s of entries) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, legendY - swatch / 2, swatch, swatch);
      lx += swatch + gap;
      ctx.fillStyle = THEME.text;
      ctx.fillText(s.label, lx, legendY);
      lx += ctx.measureText(s.label).width + itemGap;
    }
  }
}

// ── bar chart (bonus) ─────────────────────────────────────────────────────────
/**
 * Draw a simple/grouped vertical bar chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   categories?: string[],
 *   series?: Array<{ label?: string, color?: string, values: number[] }>,
 *   title?: string, xLabel?: string, yLabel?: string, logY?: boolean
 * }} config
 */
export function drawBarChart(canvas, config = {}) {
  const { ctx, w, h } = setupCanvas(canvas);
  const { title, xLabel, yLabel, logY = false } = config;
  const series = Array.isArray(config.series) ? config.series : [];
  const categories = Array.isArray(config.categories) ? config.categories : [];

  const prepared = series.map((s, i) => ({
    label: s && s.label != null ? String(s.label) : `series ${i + 1}`,
    color: (s && s.color) || THEME.series[i % THEME.series.length],
    values: Array.isArray(s && s.values) ? s.values : [],
  }));

  const nCats = Math.max(categories.length, ...prepared.map((s) => s.values.length), 0);
  if (nCats === 0 || prepared.length === 0) {
    drawEmpty(ctx, w, h, title);
    return;
  }

  // Determine the value extent. For a log axis we clamp the floor to the
  // smallest positive value so non-positive bars simply render at the baseline.
  let maxV = -Infinity;
  let minPos = Infinity;
  for (const s of prepared) {
    for (const v of s.values) {
      if (!isFiniteNum(v)) continue;
      if (v > maxV) maxV = v;
      if (v > 0 && v < minPos) minPos = v;
    }
  }
  if (!isFiniteNum(maxV) || maxV <= 0) {
    drawEmpty(ctx, w, h, title);
    return;
  }
  const baseV = logY ? (isFiniteNum(minPos) ? minPos : 1) : 0;

  // ── layout ──
  const hasTitle = !!title;
  const hasLegend = prepared.length > 1;
  const m = {
    top: (hasTitle ? 28 : 12) + (hasLegend ? 18 : 0),
    right: 16,
    bottom: 44 + (xLabel ? 16 : 0),
    left: 52 + (yLabel ? 16 : 0),
  };
  const plotW = Math.max(1, w - m.left - m.right);
  const plotH = Math.max(1, h - m.top - m.bottom);
  const plot = { x0: m.left, y0: m.top, x1: m.left + plotW, y1: m.top + plotH };

  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, w, h);

  // y scale + ticks
  const yTickInfo = logY ? niceLogTicks(baseV, maxV) : niceLinearTicks(0, maxV, 6);
  const domMinY = logY ? yTickInfo.niceMin : 0;
  const domMaxY = logY ? yTickInfo.niceMax : Math.max(maxV, yTickInfo.ticks.at(-1) ?? maxV);
  const sy = makeScale({ min: domMinY, max: domMaxY, pxMin: plot.y1, pxMax: plot.y0, log: logY });

  // horizontal gridlines + y tick labels
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yTickInfo.ticks) {
    if (t < domMinY || t > domMaxY) continue;
    const py = sy(t);
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x0, py);
    ctx.lineTo(plot.x1, py);
    ctx.stroke();
    ctx.fillStyle = THEME.text;
    ctx.fillText(fmtNumber(t), plot.x0 - 8, py);
  }

  // ── bars ──
  const groupW = plotW / nCats;
  const groupPad = groupW * 0.18;
  const innerW = groupW - groupPad * 2;
  const nSeries = prepared.length;
  const barW = innerW / nSeries;
  const baseY = sy(domMinY);

  for (let c = 0; c < nCats; c++) {
    const gx = plot.x0 + c * groupW + groupPad;
    for (let s = 0; s < nSeries; s++) {
      const v = prepared[s].values[c];
      if (!isFiniteNum(v) || (logY ? v <= 0 : v <= 0)) continue;
      const top = sy(v);
      const bx = gx + s * barW;
      const bh = Math.max(0, baseY - top);
      ctx.fillStyle = prepared[s].color;
      ctx.fillRect(bx, top, Math.max(1, barW - 1), bh);
    }
  }

  // ── category labels (x axis) ──
  ctx.fillStyle = THEME.text;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < nCats; c++) {
    const label = categories[c] != null ? String(categories[c]) : String(c + 1);
    const cx = plot.x0 + c * groupW + groupW / 2;
    ctx.fillText(label, cx, plot.y1 + 6);
  }

  // ── axis frame ──
  ctx.strokeStyle = THEME.axis;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(plot.x0, plot.y0);
  ctx.lineTo(plot.x0, plot.y1);
  ctx.lineTo(plot.x1, plot.y1);
  ctx.stroke();

  // ── axis labels ──
  ctx.fillStyle = THEME.text;
  ctx.font = `12px ${FONT}`;
  if (xLabel) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xLabel, plot.x0 + plotW / 2, h - 6);
  }
  if (yLabel) {
    ctx.save();
    ctx.translate(14, plot.y0 + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(yLabel + (logY ? ' (log)' : ''), 0, 0);
    ctx.restore();
  }

  // ── title ──
  if (title) {
    ctx.fillStyle = THEME.title;
    ctx.font = `600 14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, m.left, 8);
  }

  // ── legend ──
  if (hasLegend) {
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const swatch = 9;
    const gap = 6;
    const itemGap = 14;
    const legendY = hasTitle ? 16 : 14;
    let totalW = 0;
    for (const s of prepared) totalW += swatch + gap + ctx.measureText(s.label).width + itemGap;
    let lx = Math.max(plot.x0, plot.x1 - totalW + itemGap);
    for (const s of prepared) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, legendY - swatch / 2, swatch, swatch);
      lx += swatch + gap;
      ctx.fillStyle = THEME.text;
      ctx.fillText(s.label, lx, legendY);
      lx += ctx.measureText(s.label).width + itemGap;
    }
  }
}
