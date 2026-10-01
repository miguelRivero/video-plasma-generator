/*
  Settings, defaults and built-in presets.
  Every knob in the GUI is a key here. Presets only list what they change.
*/
(function (GW) {
  'use strict';

  GW.DEFAULTS = {
    // output
    width: 1920,          // match your LED wall / projector
    height: 640,
    fps: 30,
    previewScale: 1,      // live preview resolution (renders are always full size)

    // rhythm
    beats: 'bpm',         // 'bpm' (BPM / tap tempo) | 'audio' (beats tracked in the loaded track)
    bpm: 120,
    tempoMul: 1,          // audio: 0.5 / 1 / 2 times the detected tempo
    barOffset: 0,         // audio: which tracked beat is beat 1 of a bar (0..3)
    pulseShape: 'soft',   // 'soft' (kick) | 'breathe' | 'pump' (sidechain)
    accent: 0.5,          // how much stronger beat 1 of each bar is
    glide: 0.65,          // 0 = flow at constant speed, 1 = surge on each step and settle before the next
    stepBeats: 1,         // a step every 1, 2 or 4 beats
    pulseZoom: 0.4,       // the picture breathes in and out with the pulse
    pulseWarp: 0.3,       // the liquid ripples harder on the pulse
    pulseLight: 0.12,     // brightness pulse (at most 3 per second)
    react: 0.7,           // audio: how much loudness and bass push the motion

    // motion
    speed: 0.35,          // how fast the liquid churns
    scale: 0.9,           // zoom into the liquid (bigger = smaller, busier forms)
    warp: 1,              // how far the liquid folds into itself
    detail: 0.5,          // fine detail in the liquid
    plasma: 0.25,         // mix in plasma waves (interference bands)
    ripples: 0.3,         // rings running outwards on the beat
    spin: 0.04,           // rotation of the whole picture
    drift: 0.12,          // the liquid flows across the frame...
    driftAngle: 200,      // ...in this direction (degrees)
    symmetry: 'none',     // 'none' | 'mirror' | 'quad' | 'kaleido'
    segments: 6,          // kaleidoscope segments
    turn: 0.1,            // kaleidoscope turning

    // colour
    palettes: null,       // see palettes.js; edited colours are stored here
    cycles: 1.2,          // how many times the palette repeats across the liquid
    hueDrift: 0.02,       // the palette turns this many times per second...
    hueStep: 0.05,        // ...plus this much on every step
    darkness: 0.46,       // how much of the frame stays dark
    softness: 0.18,       // soft or hard edges between light and dark
    glow: 0.4,            // the brightest parts burn towards white
    saturation: 1.1,

    // light forms (forms.js)
    form: 'orbs',
    formAmount: 0.7,
    liquify: 0.5,         // how much the liquid bends the forms
    formCount: 5,
    formSize: 1,

    // trails (video feedback)
    trails: 0.35,         // how long trails last
    trailMode: 'echo',    // 'echo' | 'light' (light trails) | 'expose' (double exposure)
    fbZoom: 0.12,         // trails zoom in (+) or out (-) like a tunnel
    fbSpin: 0.05,         // trails turn
    swirl: 0.3,           // trails slide along the contours of the liquid
    fbHue: 0.1,           // trails shift colour as they fade

    // film
    grain: 0.35,
    grainSize: 1.5,       // in pixels at 1080p
    colorGrain: 0.35,
    weave: 0.35,          // gate weave: the frame wobbles like film in a projector
    flicker: 0.3,         // projector exposure flicker (kept below +-4%)
    halation: 0.5,        // red-orange glow round the highlights
    bloom: 0.35,
    vignette: 0.45,
    dust: 0.25,           // dust and scratches
    leaks: 0.3,           // light leaks drifting in now and then
    exposure: 1,
    contrast: 1.05,
    fade: 0.04,           // milky, lifted blacks

    // scenes
    seed: 1,
    sceneBars: 8,         // a new scene every N bars (0 = never)
    morphBeats: 8,        // how long the morph takes
    variation: 0.6,       // how different scenes are from each other

    // export
    duration: 0,          // seconds, 0 = the audio length, else 30
    loop: false,          // render a seamless loop, `duration` long rounded to whole bars (BPM only)
    format: 'mp4',        // 'mp4' | 'webm' | 'png'
    bitrate: 40,          // Mbps
    keyframe: 1,          // seconds between keyframes (smaller = snappier scrubbing in a VJ app)
    motionBlur: 2,        // sub-frames averaged per rendered frame (1 = off)
    withAudio: false,     // mux the loaded audio into the export
  };

  // keys a built-in preset never touches (your wall size, export options...)
  GW.OUTPUT_KEYS = ['width', 'height', 'fps', 'previewScale', 'duration', 'loop', 'format', 'bitrate', 'keyframe', 'motionBlur', 'withAudio'];
  // keys a built-in preset keeps unless it sets them (so a loaded track / your tempo stays in use)
  GW.KEEP_UNLESS_SET = ['beats', 'bpm', 'tempoMul', 'barOffset'];

  // `only` = the palettes the preset uses (others get switched off)
  GW.PRESETS = {
    'Default': {},
    'Super 8 memory': {
      only: ['silver', 'nitrate'], speed: 0.25, warp: 0.8, darkness: 0.5, saturation: 0.6,
      grain: 0.8, grainSize: 2.2, colorGrain: 0.15, weave: 0.85, flicker: 0.8, dust: 0.75, leaks: 0.55,
      halation: 0.35, vignette: 0.7, fade: 0.12, trails: 0.45, pulseLight: 0.08,
    },
    'Liquid kaleidoscope': {
      only: ['oil', 'ultraviolet', 'acid'], symmetry: 'kaleido', segments: 6, turn: 0.15, glow: 0.3,
      form: 'lasers', formCount: 3, trailMode: 'light', trails: 0.5, fbZoom: 0.45, glide: 0.8, hueStep: 0.08,
    },
    'Oil slick': {
      only: ['oil', 'aurora'], warp: 1.4, darkness: 0.32, cycles: 1.5, plasma: 0.15, speed: 0.25,
      glow: 0.3, saturation: 1.25, form: 'none', trails: 0.2, fbZoom: 0.05,
    },
    'Solar burn': {
      only: ['ember', 'kodachrome'], darkness: 0.58, halation: 0.8, bloom: 0.45, leaks: 0.7, exposure: 0.95,
      form: 'ripples', formCount: 4, trailMode: 'expose', trails: 0.45, fbZoom: 0.35,
    },
    'Night swim': {
      only: ['aurora', 'ultraviolet'], speed: 0.2, ripples: 0.6, pulseShape: 'breathe', glide: 0.4,
      darkness: 0.5, form: 'ripples', trails: 0.6, fbZoom: -0.2,
    },
    'Acid bloom': {
      only: ['acid', 'ultraviolet', 'oil'], symmetry: 'kaleido', segments: 8, pulseShape: 'pump',
      cycles: 2, hueStep: 0.12, saturation: 1.3, form: 'trace', trailMode: 'light', fbZoom: 0.6, fbSpin: 0.3,
    },
    'Calm (no flicker)': {
      pulseLight: 0, flicker: 0, pulseZoom: 0.15, pulseWarp: 0.15, glide: 0.3, speed: 0.2,
      hueStep: 0, dust: 0.1, weave: 0.15,
    },
  };

  const clone = o => JSON.parse(JSON.stringify(o));
  GW.clone = clone;

  GW.defaultPalettes = () => clone(GW.PALETTES);

  GW.defaults = function () {
    const d = clone(GW.DEFAULTS);
    d.palettes = GW.defaultPalettes();
    return d;
  };

  /** deep-merge `src` into `dst` (objects merge, everything else replaces) */
  function merge(dst, src) {
    for (const [k, v] of Object.entries(src || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
      else dst[k] = clone(v);
    }
    return dst;
  }
  GW.merge = merge;

  /**
   * Build a full settings object from a preset.
   * keepFrom: current settings whose output/export keys should be kept.
   */
  GW.fromPreset = function (preset, keepFrom) {
    const S = GW.defaults();
    const { only, ...rest } = preset || {};
    merge(S, rest);
    if (Array.isArray(only)) for (const [name, p] of Object.entries(S.palettes)) p.on = only.includes(name);
    if (keepFrom) {
      for (const k of GW.OUTPUT_KEYS) S[k] = keepFrom[k];
      for (const k of GW.KEEP_UNLESS_SET) if (!(k in rest)) S[k] = keepFrom[k];
    }
    return S;
  };

  /** copy every value of `src` into the existing object `S` (so GUI bindings stay valid) */
  GW.assignSettings = function (S, src) {
    for (const k of Object.keys(S)) if (!(k in src)) delete S[k];
    for (const [k, v] of Object.entries(src)) S[k] = v;
    return S;
  };

  const STORE = 'videoplasma.settings.v1';

  GW.loadStoredSettings = function () {
    const S = GW.defaults();
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) merge(S, JSON.parse(raw));
    } catch (e) { /* storage blocked or corrupt: use defaults */ }
    if (!GW.FORMS[S.form]) S.form = 'orbs';
    if (S.beats === 'audio') S.beats = 'bpm'; // tracks aren't remembered between sessions
    return S;
  };

  let saveTimer = 0;
  GW.storeSettings = function (S) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ }
    }, 300);
  };
})(window.GW = window.GW || {});
