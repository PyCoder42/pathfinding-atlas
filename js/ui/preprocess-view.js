// preprocess-view.js — animate the Contraction Hierarchies / Customizable CH
// PREPROCESSING phase (not just the query). It runs the algorithm's preprocess
// generator, then replays the result as a "reveal": nodes light up in
// contraction order (least → most important, cool → hot) and the shortcut edges
// each contraction introduced fade in. This makes the otherwise-invisible
// hierarchy and its shortcuts tangible.
//
//   const pv = createPreprocessView(renderer);
//   pv.run('contraction-hierarchies', { onInfo, onDone, duration });
//   pv.clear();

import { byId } from '../algorithms/index.js';

export function createPreprocessView(renderer) {
  let raf = null;

  function drainPreprocess(algo, graph) {
    const gen = algo.preprocess(graph, {});
    let r = gen.next();
    let guard = 0;
    while (!r.done && guard++ < 5_000_000) r = gen.next();
    return r.value;
  }

  return {
    get running() {
      return raf !== null;
    },

    run(algoId, { onInfo, onDone, duration = 2600 } = {}) {
      this.stop();
      const algo = byId[algoId];
      const g = renderer.graph;
      if (!algo || !algo.preprocess || !g) {
        if (onDone) onDone(null);
        return;
      }
      if (onInfo) onInfo('Preprocessing — contracting nodes & adding shortcuts…');

      // Run preprocessing to completion and cache it so a subsequent query reuses it.
      const chData = drainPreprocess(algo, g);
      g._auxCache = g._auxCache || {};
      g._auxCache[algo.id] = { aux: chData, ms: 0 };

      const rank = chData.rank;
      let maxRank = 1;
      for (let i = 0; i < rank.length; i++) if (rank[i] > maxRank) maxRank = rank[i];

      // Collect shortcut edges with the contraction level that created them.
      const seen = new Set();
      const shortcuts = [];
      if (chData.mid) {
        for (const [key, v] of chData.mid) {
          const ci = key.indexOf(',');
          const a = +key.slice(0, ci);
          const b = +key.slice(ci + 1);
          const uk = a < b ? a + '_' + b : b + '_' + a;
          if (seen.has(uk)) continue;
          seen.add(uk);
          shortcuts.push({ u: a, v: b, level: rank[v] >= 0 ? rank[v] : 0 });
        }
      }
      shortcuts.sort((p, q) => p.level - q.level);

      renderer.resetSearch();
      const shown = [];
      let si = 0;
      const t0 = performance.now();

      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / duration);
        const curRank = t * maxRank;
        while (si < shortcuts.length && shortcuts[si].level <= curRank) shown.push(shortcuts[si++]);
        renderer.setAnnotations({ shortcuts: shown, rank, maxRank, revealRank: curRank });
        renderer.render();
        if (onInfo) onInfo(`Building hierarchy… ${Math.round(t * 100)}%  ·  ${shown.length} shortcuts`);
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          raf = null;
          if (onInfo) onInfo(`Hierarchy ready — ${shortcuts.length} shortcuts across ${maxRank + 1} levels. Run a query to see the upward search.`);
          if (onDone) onDone(chData);
        }
      };
      raf = requestAnimationFrame(step);
    },

    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },

    clear() {
      this.stop();
      renderer.setAnnotations(null);
      renderer.render();
    },
  };
}
