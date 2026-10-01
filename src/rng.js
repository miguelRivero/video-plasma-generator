/*
  Seeded random numbers.
  Everything random in the engine comes from these, so the same seed + settings
  always renders the same video.
*/
(function (GW) {
  'use strict';

  /** 32-bit integer hash of any number of integers. */
  function hash(...xs) {
    let h = 0x811c9dc5 | 0;
    for (const x of xs) {
      h = Math.imul(h ^ (x | 0), 0x01000193);
      h ^= h >>> 15;
      h = Math.imul(h, 0x2c1b3c6d);
      h ^= h >>> 12;
      h = Math.imul(h, 0x297a2d39);
      h ^= h >>> 15;
    }
    return h >>> 0;
  }

  class RNG {
    constructor(seed = 1) {
      this.s = hash(seed, 0x9e3779b9) || 1;
      this.spare = null;
    }

    /** uniform float in [0, 1) (mulberry32) */
    random() {
      let t = (this.s = (this.s + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    uniform(a, b) { return a + (b - a) * this.random(); }

    /** integer in [a, b), like numpy's integers(a, b) */
    int(a, b) { return b <= a ? a : a + Math.floor(this.random() * (b - a)); }

    normal(mu = 0, sigma = 1) {
      let z;
      if (this.spare !== null) {
        z = this.spare;
        this.spare = null;
      } else {
        const u = 1 - this.random(), v = this.random();
        const r = Math.sqrt(-2 * Math.log(u));
        z = r * Math.cos(2 * Math.PI * v);
        this.spare = r * Math.sin(2 * Math.PI * v);
      }
      return mu + sigma * z;
    }

    exponential(scale = 1) { return -Math.log(1 - this.random()) * scale; }

    pick(arr) { return arr[Math.floor(this.random() * arr.length)]; }

    weighted(items, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let r = this.random() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    }
  }

  GW.hash = hash;
  GW.RNG = RNG;
})(window.GW = window.GW || {});
