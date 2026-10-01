/*
  GLSL for the dream engine (src/dream.js). Kept as strings so the page also
  works when opened straight from disk (file://), where shader files can't be fetched.

    DREAM     the liquid: domain-warped 4D simplex noise + plasma waves, symmetry,
              ripples, a looping palette, light and darkness, the light forms
    FEEDBACK  trails: last frame zoomed, turned, swirled, hue-shifted, blended back in
    DOWN      quarter-size copy for the bloom
    BLUR      9-tap gaussian (one direction per pass)
    ACCUM     running average of sub-frames (motion blur in renders)
    FILM      bloom, halation, light leaks, exposure, tone, grain, dust, scratches,
              gate weave, vignette

  Every pass draws one full-screen plane; vTexCoord (0,0) is the top-left corner.
*/
(function (GW) {
  'use strict';

  const VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

  // 4D simplex noise: Ian McEwan, Ashima Arts / Stefan Gustavson, MIT licence
  // (lib/webgl-noise.LICENSE.txt). https://github.com/stegu/webgl-noise
  const NOISE4D = `
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
float permute(float x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

float snoise(vec4 v) {
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
        i.w + vec4(i1.w, i2.w, i3.w, 1.0))
      + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
      + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
      + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));
  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
               + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}`;

  // small hashes (after Dave Hoskins' "hash without sine")
  const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}`;

  const DREAM = `
precision highp float;
varying vec2 vTexCoord;

uniform vec2 uAspect;     // (width / height, 1)
uniform vec4 uNT;         // xy: noise time (moves on a line, or round a circle for loops), z: detail
uniform vec4 uCam;        // x: zoom (breathing), y: spin, zw: drift
uniform vec4 uField;      // x: scale, y: warp, z: plasma, w: ripples
uniform vec4 uPlasma;     // phases of the four plasma waves
uniform vec4 uRip;        // x: ripple phase, y: ripple frequency, z: kaleidoscope turn
uniform vec4 uSym;        // x: 0 none, 1 mirror, 2 quad mirror, 3 kaleidoscope; y: segments
uniform vec4 uCol;        // x: colour cycles, y: colour phase, z: darkness, w: softness
uniform vec4 uCol2;       // x: glow, y: palette morph 0..1, z: palette row A, w: palette row B
uniform vec4 uCol3;       // xy: brightness gains of palettes A and B
uniform vec4 uForm;       // x: amount, y: liquify, z: 1 if a form is drawn
uniform sampler2D uLUT;
uniform sampler2D uForms;

#define TAU 6.283185307179586
${NOISE4D}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// fractal noise; the time coordinates scale up per octave so fine detail churns faster
float fbm(vec2 p, vec2 T) {
  vec4 q = vec4(p, T);
  float s = 0.0, a = 1.0, n = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(q);
    n += a;
    a *= uNT.z;
    q.xy = mat2(1.6, 1.2, -1.2, 1.6) * q.xy + vec2(1.7, 9.2);
    q.zw = q.zw * 1.3 + 0.7;
  }
  return s / n;
}

// two octaves only: the big, slow shapes of light
float fbm2(vec2 p, vec2 T) {
  vec4 q = vec4(p, T);
  float s = snoise(q);
  q.xy = mat2(1.6, 1.2, -1.2, 1.6) * q.xy + vec2(1.7, 9.2);
  q.zw = q.zw * 1.3 + 0.7;
  return (s + 0.5 * snoise(q)) / 1.5;
}

vec3 pal(float x) {
  float u = fract(x);
  return mix(texture2D(uLUT, vec2(u, uCol2.z)).rgb * uCol3.x, texture2D(uLUT, vec2(u, uCol2.w)).rgb * uCol3.y, uCol2.y);
}

void main() {
  vec2 p = (vTexCoord - 0.5) * uAspect;           // centred, the height spans -0.5..0.5
  p = rot(uCam.y) * p / uCam.x;                   // spin + breathing zoom

  float r = length(p);                            // ripples running outwards
  p += p / max(r, 1e-3) * (0.022 * uField.w) * sin(r * uRip.y - uRip.x);

  if (uSym.x > 0.5) {                             // mirrors / kaleidoscope
    if (uSym.x < 1.5) p.x = abs(p.x);
    else if (uSym.x < 2.5) p = abs(p);
    else {
      float seg = TAU / uSym.y;
      float a = mod(atan(p.y, p.x), seg);
      p = length(p) * vec2(cos(abs(a - 0.5 * seg)), sin(abs(a - 0.5 * seg)));
    }
  }
  vec2 pf = p;                                    // where the light forms are looked up
  p = rot(uRip.z) * p;                            // turn the kaleidoscope

  // domain warping: noise pushed around by noise pushed around by noise
  vec2 q = p * uField.x + uCam.zw;
  vec2 T = uNT.xy;
  float W = 2.2 * uField.y;
  vec2 a = vec2(fbm(q, T), fbm(q + vec2(5.2, 1.3), T + 1.7));
  vec2 b = vec2(fbm(q + W * a + vec2(1.7, 9.2), T * 1.25 + 3.1),
                fbm(q + W * a + vec2(8.3, 2.8), T * 1.25 + 5.3));
  vec2 w = q + W * b;
  float v = fbm(w, T * 0.8 + 7.9);

  // plasma: interfering sine waves, bent by the same liquid
  float pl = sin(w.x * 2.1 + uPlasma.x) + sin(w.y * 2.9 - uPlasma.y)
           + sin((w.x + w.y) * 1.6 + uPlasma.z)
           + sin(length(w - 0.8 * vec2(cos(uPlasma.w), sin(uPlasma.z))) * 3.7 - uPlasma.w);
  float d = clamp(0.5 + 1.25 * v, 0.0, 1.0);          // the fine, marbled "emulsion"
  d = mix(d, 0.5 + 0.125 * pl, uField.z);

  // light and darkness: big slow shapes of light, with the marbling at their edges
  float lt = 0.5 + 1.5 * fbm2(q * 0.75 + 0.5 * W * b, T * 0.6 + 2.3) + 0.45 * (d - 0.5);
  float L = smoothstep(uCol.z - uCol.w, uCol.z + uCol.w, lt);
  float hot = smoothstep(0.55, 1.05, lt) * smoothstep(0.35, 0.95, d) * uCol2.x;
  float idx = uCol.x * (d + 1.2 * a.x - 0.8 * b.y) + uCol.y;

  vec3 c = pal(idx) * L * (1.0 + hot) + 0.2 * hot * hot;

  // light forms, liquified by the warp: added light, white-hot in the middle
  vec2 fuv = pf / uAspect + 0.5 + b * (0.15 * uForm.y) / uAspect;
  float fm = uForm.z * texture2D(uForms, fuv).r * uForm.x;
  c += pal(idx + 0.33) * (1.3 * fm) + 0.5 * fm * fm * fm;
  gl_FragColor = vec4(c, 1.0);
}`;

  const FEEDBACK = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uNew;
uniform sampler2D uPrev;
uniform vec2 uAspect;
uniform vec4 uFb;    // x: how much of the last frame stays, y: zoom, z: rotation, w: 0 echo, 1 light, 2 expose
uniform vec4 uFb2;   // x: swirl, y: hue turn (radians), w: 1 if there is a last frame

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hueTurn(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  vec2 uv = vTexCoord;
  vec3 nw = texture2D(uNew, uv).rgb;
  vec2 p = rot(-uFb.z) * ((uv - 0.5) * uAspect) / uFb.y;

  // swirl: slide the old frame along the contours of the new one
  vec2 e = vec2(0.004 / uAspect.x, 0.004);
  float gx = luma(texture2D(uNew, uv + vec2(e.x, 0.0)).rgb) - luma(texture2D(uNew, uv - vec2(e.x, 0.0)).rgb);
  float gy = luma(texture2D(uNew, uv + vec2(0.0, e.y)).rgb) - luma(texture2D(uNew, uv - vec2(0.0, e.y)).rgb);
  vec2 uz = p / uAspect + 0.5;
  vec2 uv2 = clamp(uz + vec2(-gy, gx) * uFb2.x / uAspect, 0.0, 1.0);

  vec3 pr = max(hueTurn(texture2D(uPrev, uv2).rgb, uFb2.y), 0.0);
  if (uFb.y < 1.0) {   // zooming out: black comes in from beyond the edges
    vec2 inside = smoothstep(0.0, 0.01, uz) * smoothstep(0.0, 0.01, 1.0 - uz);
    pr *= inside.x * inside.y;
  }

  float f = uFb.x * uFb2.w;
  vec3 o;
  if (uFb.w < 0.5) o = mix(nw, pr, f);                                    // echo
  else if (uFb.w < 1.5) o = max(nw, pr * f);                              // light trails
  else o = nw + pr * (0.45 * f) * (1.0 - clamp(nw, 0.0, 1.0));            // double exposure (screen)
  gl_FragColor = vec4(o, 1.0);
}`;

  const DOWN = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTex;
uniform vec2 uTexel;   // one source pixel in uv
void main() {
  vec3 c = texture2D(uTex, vTexCoord + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(uTex, vTexCoord + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(uTex, vTexCoord + uTexel * vec2(-1.0, 1.0)).rgb
         + texture2D(uTex, vTexCoord + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(0.25 * c, 1.0);
}`;

  const BLUR = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uTex;
uniform vec2 uDir;     // tap spacing in uv
void main() {
  vec3 c = texture2D(uTex, vTexCoord).rgb * 0.2270270270;
  c += texture2D(uTex, vTexCoord + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vTexCoord - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(uTex, vTexCoord + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(uTex, vTexCoord - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

  const ACCUM = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uAcc;
uniform sampler2D uCur;
uniform float uW;      // weight of the new sub-frame
void main() {
  gl_FragColor = vec4(mix(texture2D(uAcc, vTexCoord).rgb, texture2D(uCur, vTexCoord).rgb, uW), 1.0);
}`;

  const FILM = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uImg;
uniform sampler2D uBloom;
uniform vec2 uAspect;
uniform vec2 uOut;        // output size in pixels (grain and dust are sized in output pixels)
uniform vec4 uGate;       // xy: weave offset (uv), z: overscan, w: exposure (incl. flicker and pulses)
uniform vec4 uGrain;      // x: amount, y: size (px), z: colour grain, w: frame seed
uniform vec4 uLight;      // x: bloom, y: halation, z: vignette, w: fade
uniform vec4 uTone;       // x: contrast, y: saturation, z: dust, w: frame seed
uniform vec4 uLeak;       // xy: position (uv), z: radius, w: strength
uniform vec3 uLeakCol;
uniform vec4 uScratch;    // x, y: position and strength of scratch 1; z, w: scratch 2
${HASH}

float vnoise(vec2 p, float s) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + s), b = hash12(i + vec2(1.0, 0.0) + s);
  float c = hash12(i + vec2(0.0, 1.0) + s), d = hash12(i + vec2(1.0, 1.0) + s);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 shoulder(vec3 x) {   // linear up to 0.7, then rolls off softly towards 1
  return mix(x, 0.7 + 0.3 * (1.0 - exp(-(x - 0.7) / 0.3)), step(0.7, x));
}

float scratch(float x, float s, float px) {
  float wob = 0.0007 * sin(vTexCoord.y * 21.0 + x * 57.0);
  return smoothstep(1.3 * px, 0.0, abs(vTexCoord.x - x - wob) * uOut.x) * s;
}

void main() {
  vec2 uv = 0.5 + (vTexCoord - 0.5) * uGate.z + uGate.xy;   // gate weave (slight overscan hides the edges)
  vec3 c = texture2D(uImg, uv).rgb;
  vec3 bl = texture2D(uBloom, uv).rgb;

  c += bl * (uLight.x * smoothstep(0.2, 0.9, dot(bl, vec3(0.3, 0.5, 0.2))));  // bloom round the highlights
  c += max(bl - 0.42, 0.0) * vec3(1.0, 0.33, 0.12) * (2.2 * uLight.y);   // halation: red-orange fringes
  vec2 dl = (vTexCoord - uLeak.xy) * uAspect;                            // light leak
  c += uLeakCol * (uLeak.w * exp(-dot(dl, dl) / max(1e-4, uLeak.z * uLeak.z)));

  c = shoulder(max(c * uGate.w, 0.0));                                   // exposure, highlight roll-off
  c = clamp(0.47 + (c - 0.47) * uTone.x, 0.0, 1.0);                      // contrast
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uTone.y), 0.0);                                // saturation
  c = c * (1.0 - uLight.w) + uLight.w * vec3(0.11, 0.09, 0.10);          // faded, milky blacks

  // dust and scratches
  float px = uOut.y / 1080.0;
  float dust = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 h = hash32(vec2(uTone.w, float(i) * 7.13 + 1.0));
    if (h.z < 0.3 * uTone.z) {
      vec3 h2 = hash32(vec2(float(i) * 3.7 + 11.0, uTone.w));
      vec2 dp = (vTexCoord - h.xy) * uOut;
      dp.x *= 1.0 + 3.0 * step(0.8, h2.y);
      float rad = (0.8 + 4.0 * h2.x * h2.x) * px;
      dust += smoothstep(rad, 0.3 * rad, length(dp)) * (h2.z < 0.75 ? -1.0 : 1.0);
    }
  }
  float sc = scratch(uScratch.x, uScratch.y, px) + scratch(uScratch.z, uScratch.w, px);
  c = c * (1.0 + 0.85 * min(dust, 0.0)) + 0.55 * max(dust, 0.0) + 0.5 * sc;

  // grain, strongest in the mid-tones
  vec2 gp = vTexCoord * uOut / max(0.5, uGrain.y * px);
  float gm = vnoise(gp, uGrain.w) - 0.5;
  vec3 gc = vec3(vnoise(gp + 31.7, uGrain.w + 3.1), vnoise(gp + 57.3, uGrain.w + 5.7), vnoise(gp + 83.1, uGrain.w + 8.3)) - 0.5;
  c += mix(vec3(gm), gc, uGrain.z) * (uGrain.x * 0.24 * (0.3 + 2.8 * l * (1.0 - l)));

  vec2 vv = (vTexCoord - 0.5) * 2.0;                                     // vignette
  c *= 1.0 - uLight.z * 0.85 * smoothstep(0.45, 1.45, length(vv));
  c += (hash12(gl_FragCoord.xy + uGrain.w) - 0.5) / 255.0;               // dither
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  GW.SHADERS = {
    vert: VERT,
    frag: { dream: DREAM, feedback: FEEDBACK, down: DOWN, blur: BLUR, accum: ACCUM, film: FILM },
  };
})(window.GW = window.GW || {});
