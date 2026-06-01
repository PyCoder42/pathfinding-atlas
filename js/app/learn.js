// learn.js — renders the Learn page: long-form articles, per-algorithm
// deep-dives (from EXPLANATIONS), and the glossary. Hash-routed.

import { ARTICLES, GLOSSARY } from '../content/articles.js';
import { EXPLANATIONS as EXPL_BASE } from '../content/explanations.js';
import { EXPLANATIONS_EXTRA } from '../content/explanations-extra.js';
const EXPLANATIONS = { ...EXPL_BASE, ...EXPLANATIONS_EXTRA };
import { ALGORITHMS } from '../algorithms/index.js';
import { renderMarkdown } from '../ui/md.js';
import { el, clear } from '../ui/dom.js';

const navEl = document.getElementById('learn-nav');
const contentEl = document.getElementById('learn-content');

const CAT_ORDER = ['Overview', 'Foundations', 'Techniques', 'Preprocessing', 'Reference'];

function buildNav() {
  clear(navEl);
  // articles grouped by category
  const byCat = {};
  for (const a of ARTICLES) (byCat[a.category] ||= []).push(a);
  const cats = Object.keys(byCat).sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const cat of cats) {
    navEl.append(el('div', { class: 'nav-group' }, cat));
    for (const a of byCat[cat]) {
      navEl.append(el('a', { href: `#${a.id}`, 'data-id': a.id }, a.title));
    }
  }
  // algorithm deep-dives
  navEl.append(el('div', { class: 'nav-group' }, 'Algorithm deep-dives'));
  for (const algo of ALGORITHMS) {
    navEl.append(
      el('a', { href: `#algo-${algo.id}`, 'data-id': `algo-${algo.id}` }, [
        el('span', { class: 'swatch', style: { background: algo.color } }),
        algo.name,
      ])
    );
  }
  // glossary
  navEl.append(el('div', { class: 'nav-group' }, 'Reference'));
  navEl.append(el('a', { href: '#glossary', 'data-id': 'glossary' }, 'Glossary'));
}

function setActive(id) {
  navEl.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-id') === id);
  });
}

function tryBox(text) {
  return el('div', { class: 'try-box' }, [
    el('span', {}, text),
    el('a', { class: 'btn small primary', href: 'map.html' }, '🗺️ Try on the Map'),
    el('a', { class: 'btn small', href: 'graph.html' }, '🕸️ Try on Graphs'),
  ]);
}

function renderArticle(a) {
  clear(contentEl);
  const div = el('div', { html: renderMarkdown(a.body) });
  contentEl.append(div);
  contentEl.append(tryBox('See these ideas in motion:'));
  contentEl.scrollTop = 0;
  window.scrollTo(0, 0);
}

function renderAlgo(id) {
  const algo = ALGORITHMS.find((x) => x.id === id);
  const ex = EXPLANATIONS[id];
  clear(contentEl);
  if (!algo || !ex) {
    contentEl.append(el('p', {}, 'Not found.'));
    return;
  }
  const parts = [];
  parts.push(`# ${algo.name}`);
  parts.push(`*${ex.tagline}*`);
  parts.push('');
  parts.push(ex.summary);
  parts.push('');
  parts.push('## How it works');
  for (const p of ex.howItWorks) parts.push(p + '\n');
  parts.push('## Complexity');
  for (const [k, v] of Object.entries(ex.complexity)) parts.push(`- **${k}:** ${v}`);
  parts.push('');
  parts.push('## Optimality');
  parts.push(ex.optimal);
  parts.push('');
  parts.push('## Pros');
  for (const p of ex.pros) parts.push(`- ${p}`);
  parts.push('');
  parts.push('## Cons');
  for (const c of ex.cons) parts.push(`- ${c}`);
  parts.push('');
  parts.push('## When to use it');
  parts.push(ex.whenToUse);
  parts.push('');
  parts.push('## Pseudocode');
  parts.push('```');
  parts.push(ex.pseudocode);
  parts.push('```');
  parts.push('');
  parts.push('## Connection to the Veritasium video');
  parts.push(ex.veritasium);

  contentEl.append(el('div', { html: renderMarkdown(parts.join('\n')) }));
  contentEl.append(tryBox(`Watch ${algo.short} run:`));
  window.scrollTo(0, 0);
}

function renderGlossary() {
  clear(contentEl);
  contentEl.append(el('h1', {}, 'Glossary'));
  contentEl.append(el('p', { class: 'muted' }, 'The vocabulary of shortest-path search, in one sentence each.'));
  for (const g of GLOSSARY) {
    contentEl.append(el('div', { class: 'glossary-item' }, [el('b', {}, g.term + ' — '), g.def]));
  }
  window.scrollTo(0, 0);
}

function route() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (!hash) {
    location.hash = ARTICLES[0].id;
    return;
  }
  setActive(hash);
  if (hash === 'glossary') return renderGlossary();
  if (hash.startsWith('algo-')) return renderAlgo(hash.slice(5));
  const art = ARTICLES.find((a) => a.id === hash);
  if (art) return renderArticle(art);
  // fallback
  renderArticle(ARTICLES[0]);
}

buildNav();
window.addEventListener('hashchange', route);
route();
