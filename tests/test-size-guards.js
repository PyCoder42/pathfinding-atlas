// tests/test-size-guards.js — the SOFT size guards (node ceilings for the heavy
// algorithms) can be toggled off so a power user can force them onto big graphs,
// WITHOUT changing the default guards-on behaviour the other suites rely on, and
// WITHOUT ever bypassing the hard applicability guards (grid/diagonal/negative).
//   node tests/test-size-guards.js
import {
  safeFor, setIgnoreSizeLimits, getIgnoreSizeLimits, exceedsSizeLimit, sizeGuardFor,
} from '../js/algorithms/index.js';
import { generateRandomGraph } from '../js/generators/random-graph.js';

let fails = 0;
const check = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fails++; } };

// A graph comfortably past CH/CCH's 16k node ceiling.
const { graph: big } = generateRandomGraph(20000, { seed: 7 });
check(big.n > 16000, `graph should exceed the CH limit, got n=${big.n}`);

// Default: guards ON.
check(getIgnoreSizeLimits() === false, 'guards default to ON');
check(sizeGuardFor('contraction-hierarchies') !== null, 'CH has a size guard');
check(sizeGuardFor('dijkstra') === null, 'Dijkstra has no size guard');
check(exceedsSizeLimit('contraction-hierarchies', big) === true, 'CH exceeds the limit on the big graph');
check(safeFor('contraction-hierarchies', big).ok === false, 'CH is blocked by default on the big graph');
check(safeFor('contraction-hierarchies', big).sizeLimited === true, 'the block is flagged sizeLimited');
check(safeFor('dijkstra', big).ok === true, 'Dijkstra (no guard) is always allowed');

// Override ON: soft size guards are bypassed.
setIgnoreSizeLimits(true);
check(getIgnoreSizeLimits() === true, 'override flips on');
check(safeFor('contraction-hierarchies', big).ok === true, 'CH is allowed with the override on');
check(safeFor('customizable-ch', big).ok === true, 'CCH is allowed with the override on');
check(exceedsSizeLimit('contraction-hierarchies', big) === true, 'exceedsSizeLimit() ignores the override (still true)');

// Hard guards (applicability/correctness) must STILL apply under the override.
check(safeFor('jps', big).ok === false, 'JPS still needs a diagonal grid (hard guard) under the override');

// Reset so this file leaves the shared module flag clean for any other consumer.
setIgnoreSizeLimits(false);
check(safeFor('contraction-hierarchies', big).ok === false, 'resetting the flag restores the guard');

console.log(fails ? `FAIL ${fails}` : 'ALL_PASS');
process.exit(fails ? 1 : 0);
