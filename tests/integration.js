// tests/integration.js — static integration check (no browser needed).
// Verifies: every relative import resolves to an existing file AND the named
// bindings it imports are actually exported there; and that the DOM element IDs
// the UI queries exist in the HTML pages.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let problems = [];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  const re = /export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  for (const mm of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of mm[1].split(',')) {
      const as = part.trim().split(/\s+as\s+/);
      const nm = (as[1] || as[0]).trim();
      if (nm) names.add(nm);
    }
  }
  return names;
}

const files = walk(path.join(root, 'js'));
const exportCache = {};
const getExports = (f) => (exportCache[f] ||= exportsOf(f));

let importsChecked = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const importRe = /import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const def = m[1];
    const named = m[2];
    const spec = m[3];
    if (!spec.startsWith('.')) continue; // skip bare/external
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) {
      problems.push(`${path.relative(root, file)}: import '${spec}' -> MISSING FILE`);
      continue;
    }
    const exps = getExports(target);
    if (named) {
      for (const part of named.split(',')) {
        const nm = part.trim().split(/\s+as\s+/)[0].trim();
        if (!nm) continue;
        importsChecked++;
        if (!exps.has(nm)) {
          problems.push(`${path.relative(root, file)}: imports {${nm}} from '${spec}' but it is NOT exported there`);
        }
      }
    }
    if (def) importsChecked++;
  }
}

function idsIn(html) {
  const s = fs.readFileSync(path.join(root, html), 'utf8');
  return new Set([...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}
const VIS_IDS = ['panel-scenario', 'panel-algos', 'panel-run', 'panel-stage', 'panel-metrics', 'panel-explain'];
for (const html of ['map.html', 'graph.html']) {
  const ids = idsIn(html);
  for (const id of VIS_IDS) if (!ids.has(id)) problems.push(`${html}: missing #${id} required by visualizer.js`);
}
const learnIds = idsIn('learn.html');
for (const id of ['learn-nav', 'learn-content']) if (!learnIds.has(id)) problems.push(`learn.html: missing #${id}`);

for (const html of ['index.html', 'map.html', 'graph.html', 'learn.html']) {
  const s = fs.readFileSync(path.join(root, html), 'utf8');
  for (const m of s.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const ref = m[1];
    if (ref.startsWith('http') || ref.startsWith('data:')) continue;
    if (!fs.existsSync(path.join(root, ref))) problems.push(`${html}: references missing ${ref}`);
  }
}

console.log(`Checked ${importsChecked} imports across ${files.length} modules + DOM ids.`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  x ' + p);
  process.exit(1);
} else {
  console.log('OK: all imports resolve to real exports; all required DOM ids present.');
}
