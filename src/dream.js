/*
  Dream engine: renders one frame at time t onto the p5 canvas (WEBGL).

  Pipeline, all on the GPU (shaders in src/shaders.js):
    light forms (p5 2D drawing, src/forms.js)
      -> dream: domain-warped liquid noise + plasma, symmetry, ripples,
         a looping palette, light and darkness, the forms bent into it
      -> trails: the last frame zoomed / turned / swirled and blended back in
      -> bloom: a blurred quarter-size copy
      -> film: halation, bloom, light leaks, exposure flicker, tone, grain,
         dust and scratches, gate weave, vignette

  The beat (src/rhythm.js) drives the pulses, the eased steps and the scene morphs.
  Same seed + settings + time = same frame: the exporter makes its own engine and
  steps t from 0 in exact 1/fps increments.
*/
(function (GW) {
  'use strict';

  const TAU = Math.PI * 2;
  const SYM = { none: 0, mirror: 1, quad: 2, kaleido: 3 };
  const TRAILS = { echo: 0, light: 1, expose: 2 };
  const PLASMA_RATES = [0.31, 0.23, 0.41, 0.19];  // radians per second at speed 1
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  let SH = null;
  function shaders() {
    if (!SH) {
      SH = {};
      for (const [k, src] of Object.entries(GW.SHADERS.frag)) SH[k] = createShader(GW.SHADERS.vert, src);
    }
    return SH;
  }

  function makeFB(w, h) {
    return createFramebuffer({
      width: w, height: h, density: 1, format: HALF_FLOAT,
      depth: false, antialias: false, textureFiltering: LINEAR,
    });
  }

  /** one full-screen plane with shader `sh`, into framebuffer `fb` (or onto the canvas when null) */
  function pass(fb, sh, u) {
    const run = () => {
      shader(sh);
      for (const k in u) sh.setUniform(k, u[k]);
      noStroke();
      plane(fb ? fb.width : width, fb ? fb.height : height);
    };
    if (fb) fb.draw(run);
    else { push(); resetMatrix(); run(); pop(); }
  }

  class Engine {
    /**
     * @param {object} o
     *   width, height        size of the canvas (it must already be this size)
     *   outWidth, outHeight  size of the final video (grain, dust and weave are sized for it)
     *   settings             the settings object (see settings.js); read live every frame
     *   audio                GW.AudioAnalysis or null
     */
    constructor(o) {
      this.W = o.width; this.H = o.height;
      this.outW = o.outWidth || o.width; this.outH = o.outHeight || o.height;
      this.S = o.settings;
      this.audio = o.audio || null;
      this.sh = shaders();
      const W = this.W, H = this.H;
      this.fbDream = makeFB(W, H);
      this.fbA = makeFB(W, H);
      this.fbB = makeFB(W, H);
      this.fbAcc = null;                                   // made on demand (motion blur)
      const qw = Math.max(2, Math.round(W / 4)), qh = Math.max(2, Math.round(H / 4));
      this.fbQ1 = makeFB(qw, qh);
      this.fbQ2 = makeFB(qw, qh);
      this.forms = this._graphics(Math.max(2, Math.round(W / 2)), Math.max(2, Math.round(H / 2)));
      this.blank = this._graphics(2, 2);
      this.blank.background(0);
      this.e = this._formEnv();
      this.rebuildLUT();
      this.reset(0);
    }

    _graphics(w, h) {
      const g = createGraphics(w, h);
      g.pixelDensity(1);
      document.body.appendChild(g.elt); // keep the hidden buffer out of #stage
      return g;
    }

    rebuildLUT() {
      const r = GW.makePaletteImage(this.S.palettes, this.lut);
      this.lut = r.img;
      this.rows = r.rows;
      this.gains = r.gains;
    }

    setAudio(audio) {
      this.audio = audio || null;
      this.rhythm.audio = this.audio;
      this.rhythm.retime();
    }

    /** start clean at time t (what an export does at t = 0) */
    reset(t = 0) {
      this.rhythm = new GW.Rhythm(this.S, this.audio);
      this.rhythm.reset(t);
      this.acc = { z: 0, hue: 0, spin: 0, turn: 0, dx: 0, dy: 0, p: [0, 0, 0, 0] };
      this.lastT = t;
      this.lastTau = null;
      this.hasPrev = false;
      this.R = null;
      if (typeof noiseSeed === 'function') noiseSeed(this.S.seed);
    }

    /** jumped in time (restart / the track looped) */
    seek(t) { this.reset(t); }

    /**
     * Render the frame at time t. `sub` > 1 averages that many sub-frames spread
     * over the next dt seconds (motion blur, used by renders).
     */
    render(t, dt, sub = 1) {
      if (t < this.lastT - 1e-6) this.seek(t);
      const n = Math.max(1, sub | 0);
      let img = null;
      for (let s = 0; s < n; s++) {
        const cur = this._step(n > 1 ? t + (s / n) * dt : t);
        if (n > 1) {
          if (!this.fbAcc) this.fbAcc = [makeFB(this.W, this.H), makeFB(this.W, this.H)];
          const dst = this.fbAcc[s & 1];
          pass(dst, this.sh.accum, { uAcc: this.fbAcc[(s + 1) & 1], uCur: cur, uW: 1 / (s + 1) });
          img = dst;
        } else {
          img = cur;
        }
      }
      this._film(t, img);
    }

    _step(t) {
      const S = this.S, sh = this.sh, rh = this.rhythm, A = this.acc;
      const dt = Math.max(0, t - this.lastT);
      const R = rh.at(t, dt);
      const dtau = this.lastTau === null ? 0 : Math.max(0, R.tau - this.lastTau);
      const L = rh.loop, W = this.W, H = this.H, aspect = W / H;
      const sym = SYM[S.symmetry] || 0, seg = Math.max(2, Math.round(S.segments));
      const order = sym === 3 ? seg : sym === 2 ? 2 : 1;   // the image repeats every TAU / order of spin
      const react = this.audio ? S.react : 0, lv = R.level - 0.5;

      // ---- everything that flows advances with rhythmic time (whole cycles per loop)
      A.z += S.speed * 0.25 * (1 + react * lv) * dtau;
      A.hue = (A.hue + rh.q(S.hueDrift, 1) * dtau) % 1;
      A.spin = (A.spin + rh.q(S.spin * 0.5, TAU / order) * dtau) % TAU;
      A.turn = (A.turn + rh.q(S.turn * 0.5, TAU) * dtau) % TAU;
      for (let i = 0; i < 4; i++) A.p[i] = (A.p[i] + rh.q(PLASMA_RATES[i] * (0.4 + 1.6 * S.speed), TAU) * dtau) % TAU;
      const dv = S.drift * 0.25, da = S.driftAngle * Math.PI / 180;
      A.dx += Math.cos(da) * dv * dtau;
      A.dy += Math.sin(da) * dv * dtau;
      let T, D;
      if (L) { // loops: noise time and drift go round circles that close after one loop
        const th = TAU * R.tau / L, rz = S.speed * 0.25 * L / TAU, rd = dv * L / TAU;
        T = [rz * Math.cos(th), rz * Math.sin(th)];
        D = [rd * Math.cos(th + da), rd * Math.sin(th + da)];
      } else {
        T = [A.z, 0];
        D = [A.dx, A.dy];
      }
      const spl = L ? S.loopBars * 4 / (S.stepBeats || 1) : 0;   // steps per loop
      const hueStep = spl ? Math.round(S.hueStep * spl) / spl : S.hueStep;

      // ---- light forms (p5 drawing)
      const form = GW.FORMS[S.form];
      const hasForms = !!form && S.form !== 'none' && S.formAmount > 0;
      if (hasForms) this._drawForms(form, R);

      // ---- the liquid
      const warp = Math.max(0, S.warp * R.warp * (1 + 0.8 * S.pulseWarp * R.pulse) * (1 + react * lv));
      const first = Object.keys(this.rows)[0];
      const palA = this.rows[R.palA] !== undefined ? R.palA : first, palB = this.rows[R.palB] !== undefined ? R.palB : palA;
      pass(this.fbDream, sh.dream, {
        uAspect: [aspect, 1],
        uNT: [T[0], T[1], 0.3 + 0.4 * S.detail, 0],
        uCam: [1 + 0.1 * S.pulseZoom * R.pulse, A.spin, D[0], D[1]],
        uField: [S.scale * R.scale, warp, clamp(S.plasma + R.plasma, 0, 1), S.ripples * (0.4 + 0.6 * R.pulse)],
        uPlasma: A.p,
        uRip: [GW.mod(TAU * R.tau / R.beatLen, TAU), 14, A.turn, 0],
        uSym: [sym, seg, 0, 0],
        uCol: [Math.max(0.05, S.cycles * R.cycles), GW.mod(A.hue + R.hue + hueStep * R.step, 1),
          clamp(S.darkness + R.dark, 0, 0.98), Math.max(0.01, S.softness)],
        uCol2: [S.glow * R.glow, R.morph, this.rows[palA], this.rows[palB]],
        uCol3: [this.gains[palA], this.gains[palB], 0, 0],
        uForm: [S.formAmount * (this.audio ? 0.7 + 0.6 * R.level : 1), S.liquify, hasForms ? 1 : 0, 0],
        uLUT: this.lut,
        uForms: hasForms ? this.forms : this.blank,
      });

      // ---- trails
      const prev = this.fbA, cur = this.fbB, still = dt === 0;  // paused: trails settle, nothing moves
      const half = 0.03 + 2.5 * S.trails * S.trails;            // seconds for a trail to fade to half
      const keep = S.trails > 0 ? Math.pow(0.5, (still ? 1 / 60 : dt) / half) : 0;
      const zoom = S.fbZoom * 0.5 * (1 + 2 * S.pulseZoom * R.pulse);
      pass(cur, sh.feedback, {
        uNew: this.fbDream, uPrev: prev, uAspect: [aspect, 1],
        uFb: [keep, still ? 1 : Math.exp(zoom * dt), still ? 0 : S.fbSpin * 0.6 * dt, TRAILS[S.trailMode] || 0],
        uFb2: [still ? 0 : S.swirl * 3 * dt, still ? 0 : S.fbHue * 1.5 * dt, 0, this.hasPrev ? 1 : 0],
      });
      this.fbA = cur;
      this.fbB = prev;

      this.lastT = t;
      this.lastTau = R.tau;
      this.hasPrev = true;
      this.R = R;
      return cur;
    }

    _drawForms(form, R) {
      const g = this.forms, e = this.e, S = this.S;
      Object.assign(e, {
        t: R.t, tau: R.tau, beat: R.beat, ph: R.ph, eph: R.eph, step: R.step, beatLen: R.beatLen,
        pulse: R.pulse, level: R.level, kick: R.kick,
        count: Math.max(1, Math.round(S.formCount)), size: S.formSize, loop: this.rhythm.loop,
      });
      g.push();
      g.background(0);
      g.fill(255);
      g.stroke(255);
      form.draw(g, e);
      g.pop();
      g.blendMode(BLEND);
      g.drawingContext.shadowBlur = 0;
    }

    _formEnv() {
      const self = this;
      return {
        cyc(rate) { return TAU * self.rhythm.q(rate, 1) * this.tau; },
        wander(i, speed = 0.05) {
          let u = speed * this.tau, v = 0;
          if (this.loop) {
            const th = TAU * this.tau / this.loop, r = speed * this.loop / TAU;
            u = r * Math.cos(th); v = r * Math.sin(th);
          }
          const x = noise(i * 7.31 + u, i * 3.17 + v, 0.5), y = noise(i * 7.31 + u, i * 3.17 + v, 9.5);
          return [clamp((x - 0.5) * 2.8, -1, 1), clamp((y - 0.5) * 2.8, -1, 1)];
        },
        rand(i) { return GW.hash(self.S.seed, 999, i) / 4294967296; },
        orb(g, x, y, r, b = 1) {
          const ctx = g.drawingContext, grd = ctx.createRadialGradient(x, y, 0, x, y, r);
          grd.addColorStop(0, `rgba(255,255,255,${b})`);
          grd.addColorStop(0.3, `rgba(255,255,255,${0.55 * b})`);
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        },
        glow(g, px) {
          const ctx = g.drawingContext;
          ctx.shadowBlur = Math.max(0, px);
          ctx.shadowColor = px > 0 ? 'rgba(255,255,255,0.9)' : 'transparent';
        },
      };
    }

    /** smooth noise of time, closing up when looping */
    _noiseT(t, rate, o) {
      const L = this.rhythm.loop;
      if (!L) return noise(o + rate * t, o * 0.37);
      const th = TAU * t / L, r = rate * L / TAU;
      return noise(o + r * Math.cos(th), o * 0.37 + r * Math.sin(th));
    }

    _film(t, img) {
      const S = this.S, sh = this.sh, R = this.R, W = this.W, H = this.H, ar = W / H;

      // bloom: quarter size, blurred twice
      const q1 = this.fbQ1, q2 = this.fbQ2, u = 0.0045;
      pass(q1, sh.down, { uTex: img, uTexel: [1 / W, 1 / H] });
      pass(q2, sh.blur, { uTex: q1, uDir: [u / ar, 0] });
      pass(q1, sh.blur, { uTex: q2, uDir: [0, u] });
      pass(q2, sh.blur, { uTex: q1, uDir: [2.6 * u / ar, 0] });
      pass(q1, sh.blur, { uTex: q2, uDir: [0, 2.6 * u] });

      // per film frame: weave, flicker, grain and dust seeds
      const fi = Math.floor(t * S.fps + 1e-6), fr = new GW.RNG(GW.hash(S.seed, 555, fi));
      const amp = 0.0035 * S.weave;                         // a fraction of the height
      const wx = ((this._noiseT(t, 1.1, 40) - 0.5) * 2.2 + (fr.random() - 0.5) * 0.7) * amp;
      const wy = ((this._noiseT(t, 1.1, 80) - 0.5) * 2.2 + (fr.random() - 0.5) * 0.7) * amp;
      const flicker = 1 + (fr.random() - 0.5) * 0.08 * S.flicker;
      const exposure = S.exposure * flicker * (1 + S.pulseLight * R.lightPulse);

      // light leak: drifts in now and then
      const leak = S.leaks * 1.5 * GW.smoother((this._noiseT(t, 0.045, 300) - 0.5) / 0.14);
      const warm = this._noiseT(t, 0.02, 340);
      const leakPos = [this._noiseT(t, 0.03, 310) * 1.8 - 0.4, this._noiseT(t, 0.03, 320) * 1.8 - 0.4];

      // scratches: each one runs for a while, drifting a little
      const sc = [0, 0, 0, 0];
      for (let j = 0; j < 2; j++) {
        const run = 30 + 20 * j, b = Math.floor(fi / run), r = new GW.RNG(GW.hash(S.seed, 556 + j, b));
        if (r.random() < 0.55 * S.dust) {
          sc[2 * j] = r.random() + (fi - b * run) * (r.random() - 0.5) * 0.0006;
          sc[2 * j + 1] = (0.35 + 0.65 * r.random()) * (0.6 + 0.4 * fr.random()) * Math.min(1, 1.5 * S.dust);
        }
      }

      pass(null, sh.film, {
        uImg: img, uBloom: q1,
        uAspect: [ar, 1], uOut: [this.outW, this.outH],
        uGate: [wx / ar, wy, 1 / (1 + 2.6 * amp), exposure],
        uGrain: [S.grain, S.grainSize, S.colorGrain, fr.random() * 500],
        uLight: [S.bloom, S.halation, S.vignette, S.fade],
        uTone: [S.contrast, S.saturation, S.dust, fr.random() * 500],
        uLeak: [leakPos[0], leakPos[1], 0.25 + 0.35 * this._noiseT(t, 0.04, 330), leak],
        uLeakCol: [1, 0.3 + 0.2 * warm, 0.12 + 0.25 * (1 - warm)],
        uScratch: sc,
      });
    }

    // ---------------------------------------------------------------- live controls
    push() { this.rhythm.push(1); }
    nextScene() { this.rhythm.nextScene(); }
    toPalette(name) { this.rhythm.toPalette(name); }
    align(downbeat) { this.rhythm.align(downbeat); }

    dispose() {
      for (const fb of [this.fbDream, this.fbA, this.fbB, this.fbQ1, this.fbQ2, ...(this.fbAcc || [])]) fb.remove();
      this.forms.remove();
      this.blank.remove();
    }
  }

  GW.Engine = Engine;
})(window.GW = window.GW || {});
