// playback.js
// Drives one or more algorithm generators with requestAnimationFrame so the
// search animates. Multiple "tracks" advance in lockstep, which is exactly what
// the side-by-side "race" comparison needs. Each track owns its own generator
// and callbacks; the renderer's cheap applyEvent() runs per step while the
// expensive render() runs once per frame.

export class Playback {
  // tracks: [{ gen, onEvent(ev), onFrame(), onDone(result) }]
  constructor() {
    this.tracks = [];
    this.playing = false;
    this._raf = null;
    this._accum = 0;
    this.speed = 12;          // steps per frame (per track)
    this.onAllDone = null;
    this.onTick = null;       // called each frame after stepping (e.g. progress UI)
    this._doneCount = 0;
  }

  load(tracks) {
    this.stop();
    this.tracks = tracks.map((t) => ({ ...t, done: false, steps: 0 }));
    this._doneCount = 0;
    this._accum = 0;
  }

  get finished() {
    return this.tracks.length > 0 && this._doneCount >= this.tracks.length;
  }

  setSpeed(stepsPerFrame) {
    this.speed = Math.max(0.05, stepsPerFrame);
  }

  play() {
    if (this.playing || this.finished) return;
    this.playing = true;
    const loop = () => {
      if (!this.playing) return;
      this._frame(this.speed);
      if (this.finished) {
        this.playing = false;
        if (this.onAllDone) this.onAllDone();
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  // Advance every track by exactly one step (for the "Step" button).
  stepOnce() {
    this.pause();
    this._frame(1, true);
    if (this.finished && this.onAllDone) this.onAllDone();
  }

  // Internal: advance all active tracks by `count` steps (accumulated for
  // fractional/slow speeds), then render each once.
  _frame(count, exact = false) {
    let steps;
    if (exact) {
      steps = Math.max(1, Math.round(count));
    } else {
      this._accum += count;
      steps = Math.floor(this._accum);
      this._accum -= steps;
      if (steps <= 0) {
        // still render so hover/markers stay responsive
        for (const t of this.tracks) if (!t.done && t.onFrame) t.onFrame();
        if (this.onTick) this.onTick();
        return;
      }
    }
    for (const t of this.tracks) {
      if (t.done) continue;
      for (let i = 0; i < steps; i++) {
        const r = t.gen.next();
        if (r.done) {
          t.done = true;
          this._doneCount++;
          if (t.onDone) t.onDone(r.value);
          break;
        }
        t.steps++;
        if (t.onEvent) t.onEvent(r.value);
      }
      if (t.onFrame) t.onFrame();
    }
    if (this.onTick) this.onTick();
  }

  // Drain everything immediately (no animation) and render the final state.
  skipToEnd() {
    this.pause();
    for (const t of this.tracks) {
      if (t.done) continue;
      let r = t.gen.next();
      while (!r.done) {
        t.steps++;
        if (t.onEvent) t.onEvent(r.value);
        r = t.gen.next();
      }
      t.done = true;
      this._doneCount++;
      if (t.onDone) t.onDone(r.value);
      if (t.onFrame) t.onFrame();
    }
    if (this.onTick) this.onTick();
    if (this.finished && this.onAllDone) this.onAllDone();
  }

  stop() {
    this.pause();
    this.tracks = [];
    this._doneCount = 0;
    this._accum = 0;
  }
}
