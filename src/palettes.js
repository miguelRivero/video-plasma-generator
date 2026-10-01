/*
  Palettes
  ========
  Each palette is a LOOP of colours: [position 0..1, '#rrggbb'] stops, and the
  last colour blends back into the first, so colours can keep cycling forever.
  The liquid walks round the loop (Colour > cycles) while the loop itself turns
  slowly (Colour > drift) and in steps with the beat (Colour > step per beat).
  How bright a spot is comes from the light / darkness mask, not from the palette.

  `weight` is how often a palette is picked when a scene changes.
  Add your own here, or in the GUI: Colour > Palettes > Edit colours > Duplicate.
*/
(function (GW) {
  'use strict';

  GW.PALETTES = {
    ember:       { on: true,  weight: 0.24, stops: [[0, '#b0102c'], [0.17, '#ff3b1d'], [0.34, '#ff8a1f'], [0.5, '#ffd27a'], [0.67, '#ff3f7f'], [0.84, '#8e1170']] },
    kodachrome:  { on: true,  weight: 0.16, stops: [[0, '#c4232b'], [0.2, '#f2a72e'], [0.42, '#f3e2b8'], [0.62, '#1b9a8a'], [0.82, '#2a3f9e']] },
    oil:         { on: true,  weight: 0.16, stops: [[0, '#3a1fd6'], [0.17, '#1fa8ff'], [0.34, '#17e0b0'], [0.5, '#d8ff4f'], [0.67, '#ff9a2e'], [0.84, '#ff2fa8']] },
    ultraviolet: { on: true,  weight: 0.14, stops: [[0, '#4a00e0'], [0.25, '#b300ff'], [0.5, '#ff2bd1'], [0.72, '#21d8ff'], [0.88, '#2c3cff']] },
    aurora:      { on: true,  weight: 0.12, stops: [[0, '#0d7a8c'], [0.25, '#2cf0b0'], [0.45, '#c2ff6b'], [0.65, '#7a4dff'], [0.85, '#2a5cff']] },
    nitrate:     { on: true,  weight: 0.10, stops: [[0, '#8a4a12'], [0.3, '#d9902e'], [0.55, '#f4d98c'], [0.75, '#9aa64a'], [0.9, '#b8642a']] },
    acid:        { on: false, weight: 0.10, stops: [[0, '#ff009d'], [0.17, '#ff7300'], [0.33, '#ffe500'], [0.5, '#32ff52'], [0.67, '#00ccff'], [0.83, '#7428ff']] },
    silver:      { on: false, weight: 0.06, stops: [[0, '#5a5852'], [0.5, '#f2eee4']] },
  };

  GW.hexToRgb = function (hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /** write one palette as 256 RGBA pixels into `out` at byte offset `o`, looping back to the first stop */
  GW.paletteRow = function (stops, out, o) {
    const s = stops.map(([p, c]) => [((+p % 1) + 1) % 1, GW.hexToRgb(c)]).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < 256; i++) {
      const x = (i + 0.5) / 256;
      let k = s.length - 1;                       // the stop at or before x (wrapping round)
      for (let j = 0; j < s.length; j++) if (s[j][0] <= x) k = j;
      const a = s[k], b = s[(k + 1) % s.length];
      let span = b[0] - a[0], f = x - a[0];
      if (span <= 0) span += 1;
      if (f < 0) f += 1;
      f = span > 0 ? Math.min(1, f / span) : 0;
      f = f * f * (3 - 2 * f);                    // ease between stops: no hard creases
      const q = o + i * 4;
      for (let c = 0; c < 3; c++) out[q + c] = a[1][c] + (b[1][c] - a[1][c]) * f;
      out[q + 3] = 255;
    }
  };

  /**
   * One p5.Image with a row per palette. rows[name] = the texture v of its row,
   * gains[name] = brightness correction so dark and light palettes sit at a similar level.
   */
  GW.makePaletteImage = function (palettes, reuse) {
    const names = Object.keys(palettes);
    const img = reuse && reuse.width === 256 && reuse.height === names.length ? reuse : createImage(256, names.length);
    img.loadPixels();
    const rows = {}, gains = {};
    names.forEach((n, r) => {
      const o = r * 256 * 4;
      GW.paletteRow(palettes[n].stops, img.pixels, o);
      let v = 0; // mean brightness (HSV value: saturated blues count as bright, as they look)
      for (let i = 0; i < 256; i++) v += Math.max(img.pixels[o + i * 4], img.pixels[o + i * 4 + 1], img.pixels[o + i * 4 + 2]);
      rows[n] = (r + 0.5) / names.length;
      gains[n] = Math.min(1.25, Math.max(0.75, 0.8 / Math.max(1e-3, v / 256 / 255)));
    });
    img.updatePixels();
    return { img, rows, gains };
  };
})(window.GW = window.GW || {});
