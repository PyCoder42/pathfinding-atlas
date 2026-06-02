// tests/browser-check.js — REAL browser verification via headless Chromium.
// Loads every page, captures console/page errors, and drives actual runs, the
// Leaflet map, the editor, preprocessing, and benchmark. Run:
//   node tests/browser-check.js              (defaults to http://localhost:8011)
//   node tests/browser-check.js https://pycoder42.github.io/pathfinding-atlas
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:8011';
const OUT = process.argv[3] || '/tmp/browser.json';
const report = { base: BASE, pages: {}, RESULT: 'PASS' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickText = (page, sel, text) =>
  page.evaluate((sel, text) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(text));
    if (b) { b.click(); return true; }
    return false;
  }, sel, text);

async function newPage(browser, key) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const rec = { consoleErrors: [], pageErrors: [], tileAborts: 0, checks: {} };
  report.pages[key] = rec;
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 200)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    // Leaflet cancels in-flight tile requests when the view changes (fitBounds /
    // zoom) — those abort, which is normal, not an error.
    if (/tile\.openstreetmap\.org/.test(u)) rec.tileAborts++;
    else rec.pageErrors.push('REQFAIL ' + u.slice(0, 120));
  });
  return [page, rec];
}

// Count distinct non-transparent colors drawn on a canvas — proof the search
// actually rendered. Works for the dark base renderer and the transparent
// Leaflet overlay alike.
const drewColors = (page, sel) => page.evaluate((s) => {
  const c = document.querySelector(s);
  if (!c) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 160) if (d[i + 3] > 0) set.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
  return set.size;
}, sel);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

try {
  // ── index ──
  {
    const [page, rec] = await newPage(browser, 'index');
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    rec.checks.pills = await page.evaluate(() => document.querySelectorAll('.algo-pill').length);
    rec.checks.cards = await page.evaluate(() => document.querySelectorAll('.card').length);
    rec.checks.steps = await page.evaluate(() => document.querySelectorAll('.story .step').length);
    rec.checks.mapsBadges = await page.evaluate(() => document.querySelectorAll('.algo-pill .badge-maps').length);
    rec.checks.countWord = await page.evaluate(() => (document.querySelector('#algo-count') || {}).textContent || '');
    await page.close();
  }

  // ── map (Leaflet/OSM) ──
  {
    const [page, rec] = await newPage(browser, 'map');
    await page.goto(`${BASE}/map.html`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('.algo-row', { timeout: 10000 });
    await page.waitForFunction(() => !!document.querySelector('.leaflet-host'), { timeout: 8000 }).catch(() => {});
    await sleep(3500); // let tiles load
    rec.checks.expectedAlgoCount = await page.evaluate(async () => (await import('/js/algorithms/index.js')).ALGORITHMS.length);
    rec.checks.algoRows = await page.evaluate(() => document.querySelectorAll('.algo-row').length);
    rec.checks.hasLeaflet = await page.evaluate(() => !!window.L && !!document.querySelector('.leaflet-host'));
    rec.checks.tilesLoaded = await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).length);
    rec.checks.attribution = await page.evaluate(() => /OpenStreetMap/.test(document.querySelector('.leaflet-control-attribution')?.textContent || ''));
    rec.checks.optNote = await page.evaluate(() => !!document.querySelector('.opt-note'));
    rec.checks.cityOptions = await page.evaluate(() => document.querySelectorAll('#panel-scenario select')[1]?.options.length || 0);
    // run a visualization (single A* over the tiles)
    await clickText(page, '#panel-run button', 'Play');
    await page.waitForFunction(() => /Done/.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    await sleep(400);
    rec.checks.overlayDrew = await drewColors(page, '.leaflet-overlay-canvas');
    rec.checks.metricsFilled = await page.evaluate(() =>
      [...document.querySelectorAll('.metrics tbody td')].filter((td) => td.textContent.trim() && td.textContent.trim() !== '—').length);
    rec.checks.toolButtons = await page.evaluate(() => document.querySelectorAll('.tools .btn').length);
    // benchmark mode
    await clickText(page, '.seg-btn', 'Benchmark');
    await clickText(page, '.bench-opts button', 'Run benchmark');
    await page.waitForFunction(() => /done|Benchmark done/i.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 20000 }).catch(() => {});
    rec.checks.benchHasTimes = await page.evaluate(() => /ms|µs/.test(document.querySelector('#panel-metrics').textContent || ''));
    await page.screenshot({ path: '/tmp/shot-map.png' });
    await page.close();
  }

  // ── graph (domain tabs + maze + editor + preprocess) ──
  {
    const [page, rec] = await newPage(browser, 'graph');
    await page.goto(`${BASE}/graph.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('.algo-row', { timeout: 10000 });
    rec.checks.domainTabs = await page.evaluate(() => document.querySelectorAll('.domain-tabs .seg-btn').length);
    rec.checks.recommendedHeader = await page.evaluate(() => !!document.querySelector('.algo-group-title'));
    rec.checks.canvasDrew = await drewColors(page, '.viz-canvas');
    // run on the default maze
    await clickText(page, '#panel-run button', 'Play');
    await page.waitForFunction(() => /Done/.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    rec.checks.metricsFilled = await page.evaluate(() =>
      [...document.querySelectorAll('.metrics tbody td')].filter((td) => td.textContent.trim() && td.textContent.trim() !== '—').length);
    // switch to Weighted tab → scenarios + algorithm grouping change
    await clickText(page, '.domain-tabs .seg-btn', 'Weighted');
    await sleep(1200);
    rec.checks.weightedActive = await page.evaluate(() => /Weighted/.test(document.querySelector('.domain-tabs .seg-btn.active')?.textContent || ''));
    rec.checks.bfsDemoted = await page.evaluate(() => {
      const det = [...document.querySelectorAll('.algo-collapsible')].find((d) => /shortest path here/i.test(d.querySelector('summary')?.textContent || ''));
      return !!det && [...det.querySelectorAll('.algo-name')].some((s) => s.textContent === 'BFS');
    });
    // editor (back on a grid): switch to unweighted uniform grid for the editor
    await clickText(page, '.domain-tabs .seg-btn', 'Unweighted');
    await sleep(600);
    await page.select('#panel-scenario select', 'grid').catch(() => {});
    await sleep(600);
    await clickText(page, '.tools .btn', 'Edit');
    await page.waitForFunction(() => {
      const s = document.querySelector('.tool-strip');
      return s && getComputedStyle(s).display !== 'none' && s.querySelectorAll('.chip').length > 0;
    }, { timeout: 6000 }).catch(() => {});
    rec.checks.editToolStrip = await page.evaluate(() => {
      const s = document.querySelector('.tool-strip');
      return s && getComputedStyle(s).display !== 'none' && s.querySelectorAll('.chip').length;
    });
    await clickText(page, '.tools .btn', 'Edit'); // toggle off
    await sleep(300);
    // focus CH then preprocess (CH is available + optimal on the small grid)
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('.algo-name')].find((x) => x.textContent.trim() === 'CH');
      if (link) link.click();
    });
    await sleep(200);
    await clickText(page, '.tools .btn', 'Preprocess');
    await page.waitForFunction(() => /hierarch|Preprocess|shortcut|%/i.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 9000 }).catch(() => {});
    await sleep(1500);
    rec.checks.preprocessStatus = await page.evaluate(() => (document.querySelector('.status') || {}).textContent || '');
    await page.screenshot({ path: '/tmp/shot-graph.png' });
    await page.close();
  }

  // ── learn ──
  {
    const [page, rec] = await newPage(browser, 'learn');
    await page.goto(`${BASE}/learn.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('.learn-nav a', { timeout: 10000 });
    rec.checks.navLinks = await page.evaluate(() => document.querySelectorAll('.learn-nav a').length);
    rec.checks.contentChars = await page.evaluate(() => (document.querySelector('.learn-content') || {}).textContent.length);
    await page.evaluate(() => { location.hash = '#algo-jps'; });
    await sleep(200);
    rec.checks.jpsDeepDive = await page.evaluate(() => /Jump Point/i.test((document.querySelector('.learn-content') || {}).textContent || ''));
    await page.evaluate(() => { location.hash = '#complexity-cheatsheet'; });
    await sleep(200);
    rec.checks.cheatsheetTable = await page.evaluate(() => !!document.querySelector('.learn-content .md-table'));
    await page.close();
  }
} finally {
  await browser.close();
}

// pass/fail: no console/page errors anywhere (tile aborts excluded) + key checks
let fail = false;
const why = [];
for (const [k, rec] of Object.entries(report.pages)) {
  if (rec.consoleErrors.length || rec.pageErrors.length) { fail = true; why.push(`${k}: errors ${JSON.stringify([...rec.consoleErrors, ...rec.pageErrors].slice(0, 4))}`); }
}
const i = report.pages.index?.checks || {};
const m = report.pages.map?.checks || {};
const g = report.pages.graph?.checks || {};
const l = report.pages.learn?.checks || {};
const need = (cond, msg) => { if (!cond) { fail = true; why.push(msg); } };
need(i.pills >= 14 && i.cards === 3 && i.steps === 4 && i.mapsBadges >= 2 && /^[A-Z]/.test(i.countWord), `index checks ${JSON.stringify(i)}`);
need(m.algoRows === m.expectedAlgoCount && m.hasLeaflet && m.tilesLoaded > 4 && m.attribution && m.optNote && m.overlayDrew > 8 && m.metricsFilled >= 4 && m.toolButtons >= 4 && m.benchHasTimes, `map checks ${JSON.stringify(m)}`);
need(g.domainTabs === 2 && g.recommendedHeader && g.canvasDrew > 5 && g.metricsFilled >= 8 && g.weightedActive && g.bfsDemoted && g.editToolStrip && /hierarch|Preprocess|shortcut|%/i.test(g.preprocessStatus || ''), `graph checks ${JSON.stringify(g)}`);
need(l.navLinks >= 18 && l.contentChars > 800 && l.jpsDeepDive && l.cheatsheetTable, `learn checks ${JSON.stringify(l)}`);
report.RESULT = fail ? 'FAIL' : 'PASS';
report.why = why;

writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(report.RESULT);
if (why.length) for (const w of why) console.log('  ✗', w);
process.exit(fail ? 1 : 0);
