/*
  Audio analysis: finds the beat of a track, and how loud and how bassy it is.

  novelty   spectral flux on a 22.05 kHz mono STFT minus its 0.5 s moving average
            (the same onset curve as video-glitch-generator)
  tempo     autocorrelation of the novelty, weighted towards ~120 BPM
  beats     dynamic-programming beat tracker (Ellis 2007, the method behind
            librosa.beat.beat_track): the best chain of onsets about one beat apart,
            then smoothed so the beat clock runs evenly
  level     loudness 0..1 (RMS, 95th percentile = 1)
  kick      bass energy below ~150 Hz 0..1: fast attack, short release
*/
(function (GW) {
  'use strict';

  const SR = 22050, HOP = 512, WIN = 1024, FR = SR / HOP;

  function makeFFT(n) {
    const levels = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let j = 0, x = i; j < levels; j++, x >>= 1) r = (r << 1) | (x & 1);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    return function fft(re, im) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const tr = re[l] * cos[k] + im[l] * sin[k];
            const ti = im[l] * cos[k] - re[l] * sin[k];
            re[l] = re[j] - tr; im[l] = im[j] - ti;
            re[j] += tr; im[j] += ti;
          }
        }
      }
    };
  }

  /** numpy.convolve(x, ones(k)/k, mode='same') */
  function movingAverage(x, k) {
    const n = x.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
    const back = Math.ceil((k - 1) / 2), fwd = Math.floor((k - 1) / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - back), b = Math.min(n, i + fwd + 1);
      out[i] = (pre[b] - pre[a]) / k;
    }
    return out;
  }

  /** numpy.percentile with linear interpolation */
  function percentile(values, p) {
    if (!values.length) return 0;
    const s = Float64Array.from(values).sort();
    const pos = (p / 100) * (s.length - 1), i = Math.floor(pos), f = pos - i;
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
  }

  function normalise(x, ref) {
    const k = 1 / (ref + 1e-9);
    for (let i = 0; i < x.length; i++) x[i] = Math.min(1, Math.max(0, x[i] * k));
    return x;
  }

  /** value of a per-frame curve at time t (frames are centred on (i * HOP + WIN / 2) / SR) */
  function sample(curve, t) {
    const x = t * FR - WIN / (2 * HOP), n = curve.length;
    if (x <= 0) return curve[0];
    if (x >= n - 1) return curve[n - 1];
    const i = Math.floor(x), f = x - i;
    return curve[i] + (curve[i + 1] - curve[i]) * f;
  }

  class AudioAnalysis {
    constructor(buffer, mono) {
      this.buffer = buffer;          // original decoded AudioBuffer (used for export muxing)
      this.duration = buffer.duration;
      this._analyse(mono);
      this._track();
    }

    _analyse(x) {
      const n = Math.floor((x.length - WIN) / HOP) + 1;
      const fft = makeFFT(WIN), win = new Float32Array(WIN);
      for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1)); // np.hanning
      const re = new Float64Array(WIN), im = new Float64Array(WIN);
      const bins = WIN / 2 + 1, bassTop = Math.max(2, Math.round(150 / (SR / WIN)));
      let prev = new Float32Array(bins), mag = new Float32Array(bins);
      const flux = new Float32Array(n), fluxLow = new Float32Array(n), rms = new Float32Array(n), bass = new Float32Array(n);
      for (let f = 0; f < n; f++) {
        const o = f * HOP;
        let ss = 0;
        for (let i = 0; i < WIN; i++) { const v = x[o + i] * win[i]; re[i] = v; im[i] = 0; ss += v * v; }
        rms[f] = Math.sqrt(ss / WIN);
        fft(re, im);
        let fl = 0, flo = 0, bs = 0;
        for (let b = 0; b < bins; b++) {
          const lin = Math.hypot(re[b], im[b]);
          if (b >= 1 && b <= bassTop) bs += lin;
          const m = Math.log1p(lin);
          mag[b] = m;
          const d = m - prev[b];
          if (d > 0) { fl += d; if (b <= bassTop) flo += d; }
        }
        flux[f] = fl;
        fluxLow[f] = flo;
        bass[f] = bs;
        const t = prev; prev = mag; mag = t;
      }
      // onset curve: full-band flux plus the bass band on its own, so the beat locks onto
      // kicks rather than off-beat hats (both detrended, rectified and scaled to unit spread)
      const k5 = Math.max(1, Math.floor(0.5 * FR));
      const detrend = c => {
        const avg = movingAverage(c, k5), out = new Float32Array(n);
        let s = 0, s2 = 0;
        for (let i = 0; i < n; i++) { out[i] = Math.max(0, c[i] - avg[i]); s += out[i]; s2 += out[i] * out[i]; }
        const sd = Math.sqrt(Math.max(1e-12, s2 / n - (s / n) ** 2));
        for (let i = 0; i < n; i++) out[i] /= sd;
        return out;
      };
      const full = detrend(flux), low = detrend(fluxLow), nov = new Float32Array(n);
      for (let i = 0; i < n; i++) nov[i] = full[i] + 1.5 * low[i];
      this.novelty = nov;

      const env = movingAverage(rms, Math.max(1, Math.floor(0.25 * FR)));
      this.env = normalise(env, percentile(env, 95));

      const kick = new Float32Array(n), rel = Math.exp(-1 / (0.12 * FR));
      let k = 0;
      for (let i = 0; i < n; i++) { k = Math.max(bass[i], k * rel); kick[i] = k; }
      this.kick = normalise(kick, percentile(kick, 95));
      this.kickSlow = movingAverage(this.kick, Math.max(1, Math.floor(0.6 * FR)));
    }

    _track() {
      const nov = this.novelty, n = nov.length;
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) { s += nov[i]; s2 += nov[i] * nov[i]; }
      const sd = Math.sqrt(Math.max(1e-12, s2 / n - (s / n) ** 2));
      const on = Float32Array.from(nov, v => v / sd);

      // ---- tempo: autocorrelation, weighted by a log-normal prior around 120 BPM (1 octave wide)
      const lo = Math.max(2, Math.floor(60 * FR / 220)), hi = Math.min(n - 2, Math.ceil(60 * FR / 50));
      const ac = new Float64Array(hi + 2);
      for (let l = lo - 1; l <= hi + 1; l++) {
        let a = 0;
        for (let i = 0; i + l < n; i++) a += on[i] * on[i + l];
        ac[l] = a / (n - l);
      }
      let best = lo, bestScore = -Infinity;
      for (let l = lo; l <= hi; l++) {
        const bpm = 60 * FR / l, score = ac[l] * Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
        if (score > bestScore) { bestScore = score; best = l; }
      }
      const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], den = y0 - 2 * y1 + y2;
      const P = best + (den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0);
      this.tempo = 60 * FR / P;

      // ---- beats: dynamic programming over the onset curve
      const period = Math.max(2, Math.round(P));
      const gr = Math.ceil(3 * period / 32) + 1, local = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let a = 0;
        for (let j = -gr; j <= gr; j++) {
          const q = i + j;
          if (q >= 0 && q < n) a += on[q] * Math.exp(-0.5 * (j * 32 / period) ** 2);
        }
        local[i] = a;
      }
      const offs = [], txwt = [];
      for (let w = -2 * period; w <= -Math.round(period / 2); w++) { offs.push(w); txwt.push(-100 * Math.log(-w / period) ** 2); }
      const cum = new Float32Array(n), back = new Int32Array(n);
      let maxLocal = 0;
      for (let i = 0; i < n; i++) maxLocal = Math.max(maxLocal, local[i]);
      let first = true;
      for (let i = 0; i < n; i++) {
        let bv = -Infinity, bj = -1;
        for (let k = 0; k < offs.length; k++) {
          const j = i + offs[k], v = txwt[k] + (j >= 0 ? cum[j] : 0);
          if (v > bv) { bv = v; bj = j; }
        }
        cum[i] = local[i] + bv;
        if (first && local[i] < 0.01 * maxLocal) back[i] = -1;
        else { back[i] = bj; first = false; }
      }
      // the last beat: the latest strong local maximum of the cumulative score
      const peaks = [];
      for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) peaks.push(i);
      let beats = [];
      if (peaks.length) {
        const med = percentile(peaks.map(i => cum[i]), 50);
        let last = peaks[0];
        for (const i of peaks) if (cum[i] * 2 > med) last = i;
        beats.push(last);
        while (back[beats[beats.length - 1]] >= 0) beats.push(back[beats[beats.length - 1]]);
        beats.reverse();
        // drop weak beats at the start and the end
        const hann = [0, 0.5, 1, 0.5, 0], sm = beats.map((_, i) => {
          let a = 0;
          for (let j = -2; j <= 2; j++) { const q = i + j; if (q >= 0 && q < beats.length) a += local[beats[q]] * hann[j + 2]; }
          return a;
        });
        const thr = 0.5 * Math.sqrt(sm.reduce((a, v) => a + v * v, 0) / Math.max(1, sm.length));
        const valid = sm.map((v, i) => (v > thr ? i : -1)).filter(i => i >= 0);
        if (valid.length > 1) beats = beats.slice(valid[0], valid[valid.length - 1]);
      }

      let times = beats.map(f => (f * HOP + WIN / 2) / SR);
      if (times.length < 4) { // no clear beat: a steady grid at the estimated tempo
        times = [];
        for (let t = 0; t < this.duration; t += P / FR) times.push(t);
      }
      // even out the frame-sized jitter: local straight-line fit over +-4 beats
      const sm = times.map((_, i) => {
        const a = Math.max(0, i - 4), b = Math.min(times.length - 1, i + 4);
        let mx = 0, my = 0;
        for (let j = a; j <= b; j++) { mx += j; my += times[j]; }
        const m = b - a + 1;
        mx /= m; my /= m;
        let sxy = 0, sxx = 0;
        for (let j = a; j <= b; j++) { sxy += (j - mx) * (times[j] - my); sxx += (j - mx) ** 2; }
        return my + (sxx > 0 ? sxy / sxx : 0) * (i - mx);
      });
      for (let i = 1; i < sm.length; i++) if (sm[i] <= sm[i - 1]) sm[i] = sm[i - 1] + 1e-3;
      this.beatTimes = sm;
      this.beatGap = P / FR;
      if (sm.length >= 8) { // the tracked beats give a finer tempo than the autocorrelation lag
        this.beatGap = (sm[sm.length - 1] - sm[0]) / (sm.length - 1);
        this.tempo = 60 / this.beatGap;
      }
    }

    /** beats since the first tracked beat (fractional; negative before it) */
    beatAt(t) {
      const b = this.beatTimes, n = b.length;
      if (t <= b[0]) return (t - b[0]) / this.beatGap;
      if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / this.beatGap;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (b[mid] <= t) lo = mid; else hi = mid;
      }
      return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
    }

    levelAt(t) { return sample(this.env, t); }
    kickAt(t) { return sample(this.kick, t); }
    kickSlowAt(t) { return sample(this.kickSlow, t); }
  }

  /** Decode an audio File/Blob and analyse it. */
  GW.analyzeAudio = async function (file) {
    const bytes = await file.arrayBuffer();
    const decoder = new OfflineAudioContext(1, 1, 44100);
    const buffer = await decoder.decodeAudioData(bytes);
    const len = Math.max(1, Math.ceil(buffer.duration * SR));
    const off = new OfflineAudioContext(1, len, SR);   // resample + downmix to mono
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    if (mono.length < WIN * 8) throw new Error('Audio is too short to analyse');
    await new Promise(r => setTimeout(r, 0));
    return new AudioAnalysis(buffer, mono);
  };

  GW.AudioAnalysis = AudioAnalysis;
})(window.GW = window.GW || {});
