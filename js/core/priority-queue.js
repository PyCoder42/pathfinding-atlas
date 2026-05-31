// priority-queue.js
// A binary min-heap used by Dijkstra, A*, and friends.
//
// We use the "lazy deletion" convention: instead of a decrease-key operation
// (which complicates the heap), algorithms simply push a node again with its
// improved priority. When a node is popped, the algorithm checks whether the
// popped distance is stale (greater than the best known distance) and, if so,
// skips it. This keeps the heap simple and is the standard approach used in
// production routing code.

export class MinHeap {
  constructor() {
    this._p = []; // priorities (parallel array)
    this._v = []; // values
  }

  get size() {
    return this._v.length;
  }

  isEmpty() {
    return this._v.length === 0;
  }

  clear() {
    this._p.length = 0;
    this._v.length = 0;
  }

  push(value, priority) {
    const p = this._p;
    const v = this._v;
    let i = v.length;
    p.push(priority);
    v.push(value);
    // sift up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      this._swap(parent, i);
      i = parent;
    }
  }

  pop() {
    const p = this._p;
    const v = this._v;
    const n = v.length;
    if (n === 0) return undefined;
    const top = v[0];
    const last = n - 1;
    if (last === 0) {
      p.pop();
      v.pop();
      return top;
    }
    p[0] = p[last];
    v[0] = v[last];
    p.pop();
    v.pop();
    // sift down
    let i = 0;
    const size = v.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < size && p[l] < p[smallest]) smallest = l;
      if (r < size && p[r] < p[smallest]) smallest = r;
      if (smallest === i) break;
      this._swap(smallest, i);
      i = smallest;
    }
    return top;
  }

  peek() {
    return this._v[0];
  }

  peekPriority() {
    return this._p[0];
  }

  _swap(a, b) {
    const p = this._p;
    const v = this._v;
    const tp = p[a];
    p[a] = p[b];
    p[b] = tp;
    const tv = v[a];
    v[a] = v[b];
    v[b] = tv;
  }
}
