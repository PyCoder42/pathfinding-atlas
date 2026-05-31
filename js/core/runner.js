// runner.js
// Bridges the algorithm registry to the rest of the app:
//   - getAux:    run (and cache) an algorithm's preprocessing for a graph
//   - makeQuery: instantiate a query generator with aux data injected
//   - benchmark: drain a query as fast as possible and time it
//
// Preprocessing (CH / CCH / ALT) is cached on the graph object keyed by the
// algorithm id, so switching between "animate" and "benchmark" doesn't pay for
// it twice, and a benchmark across many random queries reuses it.

export function getAux(algo, graph) {
  if (!algo.preprocess) return { aux: null, ms: 0, cached: false };
  if (!graph._auxCache) graph._auxCache = {};
  if (graph._auxCache[algo.id]) {
    return { ...graph._auxCache[algo.id], cached: true };
  }
  const t0 = performance.now();
  let aux;
  const maybe = algo.preprocess(graph, {});
  if (maybe && typeof maybe.next === 'function') {
    // preprocess is a generator (yields progress); drain to its return value
    let r = maybe.next();
    while (!r.done) r = maybe.next();
    aux = r.value;
  } else {
    aux = maybe;
  }
  const ms = performance.now() - t0;
  const entry = { aux, ms };
  graph._auxCache[algo.id] = entry;
  return { ...entry, cached: false };
}

// Clear cached preprocessing (e.g. after the graph's weights/metric change).
export function clearAux(graph) {
  graph._auxCache = {};
}

export function makeQuery(algo, graph, start, goal, extraOpts = {}) {
  const opts = { ...extraOpts };
  if (algo.preprocess) {
    const { aux } = getAux(algo, graph);
    opts[algo.optsKey] = aux;
  }
  return algo.run(graph, start, goal, opts);
}

// Drain a generator, returning its final Result value.
export function drain(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

// Benchmark a single query. `repeats` runs are timed and the best (fastest) is
// reported to reduce GC/JIT noise. Preprocessing time is reported separately.
export function benchmark(algo, graph, start, goal, extraOpts = {}, repeats = 1) {
  const opts = { ...extraOpts };
  let preprocessMs = 0;
  if (algo.preprocess) {
    const a = getAux(algo, graph);
    preprocessMs = a.cached ? 0 : a.ms;
    opts[algo.optsKey] = a.aux;
  }
  let result = null;
  let queryMs = Infinity;
  for (let i = 0; i < repeats; i++) {
    const gen = algo.run(graph, start, goal, opts);
    const t0 = performance.now();
    result = drain(gen);
    const dt = performance.now() - t0;
    if (dt < queryMs) queryMs = dt;
  }
  return { result, queryMs, preprocessMs };
}
