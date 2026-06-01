// tests/browser-check.js — REAL browser verification via headless Chromium.
// Loads every page, captures console/page errors, and drives actual runs,
// the editor, preprocessing, and benchmark. Run: node tests/browser-check.js
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

const BASE = process.argv[2] || 'http://localhost:8011';
const OUT = process.argv[3] || '/tmp/browser.json';
const report = { base: BASE, pages: {}, RESULT: 'PASS' };

const clickText = (page, sel, text) =>
  page.evaluate((sel, text) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(text));
    if (b) { b.click(); return true; }
    return false;
  }, sel, text);

async function newPage(browser, key) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const rec = { consoleErrors: [], pageErrors: [], checks: {} };
  report.pages[key] = rec;
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e).slice(0, 200)));
  page.on('requestfailed', (r) => rec.pageErrors.push('REQFAIL ' + r.url().slice(0, 120)));
  return [page, rec];
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

try {
  // ── index ──
  {
    const [page, rec] = await newPage(browser, 'index');
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    rec.checks.pills = await page.evaluate(() => document.querySelectorAll('.algo-pill').length);
    rec.checks.cards = await page.evaluate(() => document.querySelectorAll('.card').length);
    await page.screenshot({ path: '/tmp/shot-index.png' });
    await page.close();
  }

  // ── map ──
  {
    const [page, rec] = await newPage(browser, 'map');
    await page.goto(`${BASE}/map.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('.algo-row', { timeout: 10000 });
    rec.checks.algoRows = await page.evaluate(() => document.querySelectorAll('.algo-row').length);
    rec.checks.cityOptions = await page.evaluate(() => document.querySelectorAll('#panel-scenario select option').length);
    rec.checks.canvasDrew = await page.evaluate(() => {
      const c = document.querySelector('.viz-canvas');
      if (!c) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const s = new Set(); for (let i = 0; i < d.length; i += 320) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
      return s.size;
    });
    // run a visualization
    await clickText(page, '#panel-run button', 'Play');
    await page.waitForFunction(() => /Done/.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    rec.checks.metricsFilled = await page.evaluate(() =>
      [...document.querySelectorAll('.metrics tbody td')].filter((td) => td.textContent.trim() && td.textContent.trim() !== '—').length);
    rec.checks.status = await page.evaluate(() => (document.querySelector('.status') || {}).textContent || '');
    // tools present
    rec.checks.toolButtons = await page.evaluate(() => document.querySelectorAll('.tools .btn').length);
    // benchmark mode
    await clickText(page, '.seg-btn', 'Benchmark');
    await clickText(page, '.bench-opts button', 'Run benchmark');
    await page.waitForFunction(() => /done|Benchmark done/i.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 20000 }).catch(() => {});
    rec.checks.benchHasTimes = await page.evaluate(() => /ms|µs/.test(document.querySelector('#panel-metrics').textContent || ''));
    await page.screenshot({ path: '/tmp/shot-map.png' });
    await page.close();
  }

  // ── graph (maze) + editor + preprocess ──
  {
    const [page, rec] = await newPage(browser, 'graph');
    await page.goto(`${BASE}/graph.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('.algo-row', { timeout: 10000 });
    rec.checks.canvasDrew = await page.evaluate(() => {
      const c = document.querySelector('.viz-canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const s = new Set(); for (let i = 0; i < d.length; i += 320) s.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
      return s.size;
    });
    // run
    await clickText(page, '#panel-run button', 'Play');
    await page.waitForFunction(() => /Done/.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 15000 }).catch(() => {});
    rec.checks.metricsFilled = await page.evaluate(() =>
      [...document.querySelectorAll('.metrics tbody td')].filter((td) => td.textContent.trim() && td.textContent.trim() !== '—').length);
    // editor: click Edit, expect tool strip visible (onEdit is async → wait)
    await clickText(page, '.tools .btn', 'Edit');
    await page.waitForFunction(() => {
      const s = document.querySelector('.tool-strip');
      return s && getComputedStyle(s).display !== 'none' && s.querySelectorAll('.chip').length > 0;
    }, { timeout: 6000 }).catch(() => {});
    rec.checks.editToolStrip = await page.evaluate(() => {
      const s = document.querySelector('.tool-strip');
      return s && getComputedStyle(s).display !== 'none' && s.querySelectorAll('.chip').length;
    });
    // actually paint a wall: drag on the canvas
    rec.checks.editPaints = await page.evaluate(() => {
      const c = document.querySelector('.viz-canvas');
      const r = c.getBoundingClientRect();
      const fire = (type, x, y) => c.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y }));
      fire('mousedown', 60, 60); fire('mousemove', 120, 90); window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    });
    await clickText(page, '.tools .btn', 'Edit'); // toggle off
    await new Promise((r) => setTimeout(r, 300));
    // focus CH then preprocess
    await page.evaluate(() => {
      const link = [...document.querySelectorAll('.algo-name')].find((x) => x.textContent.trim() === 'CH');
      if (link) link.click();
    });
    await new Promise((r) => setTimeout(r, 200));
    await clickText(page, '.tools .btn', 'Preprocess');
    await page.waitForFunction(() => /hierarch|Preprocess|shortcut|%/i.test((document.querySelector('.status') || {}).textContent || ''), { timeout: 9000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
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
    // open an algo deep-dive + the cheatsheet table
    await page.evaluate(() => { location.hash = '#algo-jps'; });
    await new Promise((r) => setTimeout(r, 200));
    rec.checks.jpsDeepDive = await page.evaluate(() => /Jump Point/i.test((document.querySelector('.learn-content') || {}).textContent || ''));
    await page.evaluate(() => { location.hash = '#complexity-cheatsheet'; });
    await new Promise((r) => setTimeout(r, 200));
    rec.checks.cheatsheetTable = await page.evaluate(() => !!document.querySelector('.learn-content .md-table'));
    await page.screenshot({ path: '/tmp/shot-learn.png' });
    await page.close();
  }
} finally {
  await browser.close();
}

// determine pass/fail: no console/page errors anywhere + key checks truthy
let fail = false;
for (const [k, rec] of Object.entries(report.pages)) {
  if (rec.consoleErrors.length || rec.pageErrors.length) fail = true;
}
const m = report.pages.map?.checks || {};
const g = report.pages.graph?.checks || {};
const l = report.pages.learn?.checks || {};
if (!(m.algoRows === 13 && m.canvasDrew > 30 && m.metricsFilled >= 12 && m.benchHasTimes && m.toolButtons >= 4)) fail = true;
if (!(g.canvasDrew > 5 && g.metricsFilled >= 8 && g.editToolStrip && /hierarch|Preprocess|shortcut|%/i.test(g.preprocessStatus || ''))) fail = true;
if (!(l.navLinks >= 18 && l.contentChars > 800 && l.jpsDeepDive && l.cheatsheetTable)) fail = true;
report.RESULT = fail ? 'FAIL' : 'PASS';

writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(report.RESULT);
process.exit(fail ? 1 : 0);
