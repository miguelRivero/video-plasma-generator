/*
  Rhythm: the musical clock everything moves to.

    beat    beats since the start: the BPM grid, or the beats tracked in a loaded track
    pulse   0..1 envelope that fires on every beat (accented on beat 1 of the bar)
    tau     "rhythmic time" in seconds. It keeps pace with the clock on average, but
            with Glide > 0 it surges on each step and settles before the next one, so
            everything that flows (liquid, colours, drift, ripples) moves in time.
    scene   the current variation of the look. Scenes change every few bars and
            morph smoothly into each other, never cut.

  Loops: with Export > loop on, rates are rounded so that every motion repeats a
  whole number of times per loop and the clip closes up perfectly.
*/
(function (GW) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, f) => a + (b - a) * f;
  const mod = (a, n) => ((a % n) + n) % n;
  const smoother = x => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  GW.smoother = smoother;
  GW.mod = mod;

  // pulse shapes over one beat (ph 0..1). The attack takes ~15% of a beat so hits stay
  // smooth, and every shape ends where the next beat starts (no jump on the beat line).
  const TAIL = Math.exp(-0.85 / 0.3);
  const soft = ph => (ph < 0.15 ? smoother(ph / 0.15) : (Math.exp(-(ph - 0.15) / 0.3) - TAIL) / (1 - TAIL));
  const ENV = {
    soft,                                          // quick smooth attack, long decay: a kick
    breathe: ph => 0.5 + 0.5 * Math.cos(TAU * ph), // in and out, peak on the beat
    pump: ph => 1 - soft(ph),                      // ducks on the beat and swells back (sidechain)
  };

  // how far a step has moved at phase ph when the speed follows the pulse (0..1)
  const RAMP = {};
  for (const [name, f] of Object.entries(ENV)) {
    const N = 512, r = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) r[i + 1] = r[i] + f((i + 0.5) / N);
    for (let i = 0; i <= N; i++) r[i] /= r[N];
    RAMP[name] = r;
  }
  function ramp(shape, ph) {
    const r = RAMP[shape], x = ph * 512, i = Math.min(511, Math.floor(x)), f = x - i;
    return r[i] + (r[i + 1] - r[i]) * f;
  }

  // scene values that morph (multipliers / offsets on the settings)
  const NUM = ['warp', 'scale', 'plasma', 'cycles', 'hue', 'dark', 'glow'];

  class Rhythm {
    constructor(S, audio) {
      this.S = S;
      this.audio = audio || null;
      this.overrides = new Map();   // live: scenes replaced from the keyboard
      this.morphs = new Map();
      this.retime();
      this.reset(0);
    }

    /** beats source / tempo / loop / palettes changed */
    retime() {
      const S = this.S;
      this.mode = S.beats === 'audio' && this.audio && this.audio.beatTimes.length > 1 ? 'audio' : 'bpm';
      this.clearScenes();
    }

    clearScenes() {
      this.cache = new Map();
      const pals = Object.entries(this.S.palettes).filter(([, p]) => p.on && p.weight > 0);
      const use = pals.length ? pals : Object.entries(this.S.palettes);
      this.names = use.map(([n]) => n);
      this.weights = use.map(([, p]) => Math.max(1e-6, p.weight));
    }

    /** start clean at time t */
    reset(t) {
      this.beatAcc = this.mode === 'bpm' ? t * this.S.bpm / 60 : 0;
      this.offset = 0;              // live tap-tempo alignment, in beats
      this.pushed = 0;
      this.overrides.clear();
      this.morphs.clear();
      this.state = null;
    }

    /** loop length in seconds (0 = not looping) */
    get loop() {
      const S = this.S;
      return S.loopBars > 0 && this.mode === 'bpm' ? S.loopBars * 240 / S.bpm : 0;
    }

    /** `rate` rounded so it repeats a whole number of times per loop (period = one repeat) */
    q(rate, period = 1) {
      const L = this.loop;
      return L ? Math.round(rate * L / period) * period / L : rate;
    }

    /** the clock at time t (dt = time since the previous call) */
    at(t, dt) {
      const S = this.S, A = this.audio;
      dt = Math.max(0, dt);
      let beat, beatLen;
      if (this.mode === 'audio') {
        const m = S.tempoMul || 1;
        beat = A.beatAt(t) * m - S.barOffset;
        beatLen = 60 / (A.tempo * m);
      } else {
        this.beatAcc += dt * S.bpm / 60;
        beat = this.beatAcc + this.offset;
        beatLen = 60 / S.bpm;
      }
      const shape = ENV[S.pulseShape] ? S.pulseShape : 'soft', env = ENV[shape];
      const k = Math.floor(beat), ph = beat - k;
      // beat 1 of the bar is stronger; the accent hands over to the next beat's during the second half
      const acc = j => (mod(j, 4) === 0 ? 1 : 1 - 0.7 * S.accent);
      const accent = lerp(acc(k), acc(k + 1), smoother((ph - 0.5) * 2));
      const level = A ? A.levelAt(t) : 0.5;
      const kick = A ? A.kickAt(t) : env(ph);

      let pulse = env(ph) * accent;
      if (A && this.mode === 'audio') pulse *= 1 - S.react + S.react * clamp01(1.4 * A.kickSlowAt(t)); // fades in breakdowns
      this.pushed *= Math.pow(0.5, dt / 0.15);
      pulse = Math.max(pulse, this.pushed);

      // brightness pulses: at most 3 per second (photosensitivity)
      let div = 1;
      while (1 / (beatLen * div) > 3) div *= 2;
      const lb = beat / div, lightPulse = Math.max(env(lb - Math.floor(lb)), this.pushed);

      // steps: with Glide the flow surges on each step and settles before the next
      const sb = S.stepBeats || 1, st = beat / sb, sk = Math.floor(st), sf = st - sk;
      const step = sk + lerp(sf, ramp(shape, sf), S.glide);
      const tau = step * sb * beatLen;
      const eph = lerp(ph, ramp(shape, ph), S.glide);

      this.state = { t, beat, k, ph, eph, beatLen, pulse, lightPulse, accent, step, tau, level, kick };
      return Object.assign(this.state, this._sceneAt(beat));
    }

    _sceneAt(beat) {
      const S = this.S, never = !(S.sceneBars > 0);
      const SB = Math.max(1, Math.round(S.sceneBars)) * 4;
      const LB = this.loop ? S.loopBars * 4 : 0;
      const b = LB ? mod(beat, LB) : beat;
      const n = LB ? Math.max(1, Math.ceil(LB / SB - 1e-9)) : 0;
      let idx = never ? 0 : Math.floor(b / SB);
      if (LB) idx = Math.min(idx, n - 1);
      const prev = never ? 0 : LB ? (idx - 1 + n) % n : idx - 1;
      const mo = this.morphs.get(idx);
      const from = mo ? mo.from : this.scene(prev), to = this.scene(idx);
      const mb = Math.max(0.25, Math.min(SB, S.morphBeats));
      const into = mo ? beat - mo.b0 : never ? mb : b - idx * SB;
      const f = smoother(into / mb);
      const P = { sceneIndex: idx, morph: f, palA: from.pal, palB: to.pal };
      for (const key of NUM) P[key] = lerp(from[key], to[key], f);
      return P;
    }

    /** the values of scene i (repeatable from the seed) */
    scene(i) {
      if (this.overrides.has(i)) return this.overrides.get(i);
      let s = this.cache.get(i);
      if (!s) {
        const firstPal = j => new GW.RNG(GW.hash(this.S.seed, 4242, j)).weighted(this.names, this.weights);
        s = this._make(new GW.RNG(GW.hash(this.S.seed, 4242, i)), firstPal(i - 1));
        this.cache.set(i, s);
      }
      return s;
    }

    _make(r, avoid) {
      const v = this.S.variation;
      let names = this.names, weights = this.weights;
      if (avoid && names.length > 1) {
        const keep = names.map(n => n !== avoid);
        names = names.filter((_, j) => keep[j]);
        weights = weights.filter((_, j) => keep[j]);
      }
      return {
        pal: r.weighted(names, weights),
        warp: lerp(1, r.uniform(0.55, 1.6), v),
        scale: lerp(1, r.uniform(0.65, 1.6), v),
        plasma: r.uniform(-0.2, 0.3) * v,
        cycles: lerp(1, r.uniform(0.6, 1.8), v),
        hue: r.uniform(-0.5, 0.5) * v,
        dark: r.uniform(-0.12, 0.12) * v,
        glow: lerp(1, r.uniform(0.6, 1.5), v),
      };
    }

    _snapshot() {
      const st = this.state, o = { pal: st.morph < 0.5 ? st.palA : st.palB };
      for (const k of NUM) o[k] = st[k];
      return o;
    }

    // ---------------------------------------------------------------- live controls
    /** an extra pulse, like a strong beat */
    push(s = 1) { this.pushed = Math.max(this.pushed, s); }

    /** morph to a new random scene now */
    nextScene() {
      if (!this.state) return;
      const cur = this._snapshot(), i = this.state.sceneIndex;
      this.overrides.set(i, this._make(new GW.RNG((Math.random() * 4294967296) >>> 0), cur.pal));
      this.morphs.set(i, { from: cur, b0: this.state.beat });
    }

    /** morph to palette `name` now */
    toPalette(name) {
      if (!this.state) return;
      const cur = this._snapshot(), i = this.state.sceneIndex;
      this.overrides.set(i, Object.assign({}, this.scene(i), { pal: name }));
      this.morphs.set(i, { from: cur, b0: this.state.beat });
    }

    /** tap tempo: put a beat (or beat 1 of a bar) right now */
    align(downbeat) {
      if (this.mode !== 'bpm' || !this.state) return;
      const b = this.state.beat, target = downbeat ? Math.round(b / 4) * 4 : Math.round(b);
      this.offset += target - b;
    }
  }

  GW.Rhythm = Rhythm;
})(window.GW = window.GW || {});
