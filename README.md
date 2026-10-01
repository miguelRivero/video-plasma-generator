# Video Plasma Generator

Smooth, rhythmic, psychedelic visuals for LED walls and projections, in the browser:
liquid light that folds into itself, breathes on the beat and drifts through colour,
with an analogue film finish (grain, gate weave, halation, dust, light leaks).
One p5.js sketch with a live preview, a settings panel and a frame-accurate video exporter.
It's the sibling of [video-glitch-generator](https://github.com/miguelRivero/video-glitch-generator)
and keeps its controls, keys and export options.

The look is inspired by the live cinema of [Pedro Maia](https://www.pedromaia.net/about/)
(see [Where the look comes from](#where-the-look-comes-from)). It isn't affiliated with him.

> Processing.js was discontinued in 2018. Its successor is **p5.js**, which is what this uses.
> The sketch entry point is `src/sketch.js` (`setup()` / `draw()`). The picture is made by GLSL
> shaders in p5's WEBGL mode, and you can add light of your own with ordinary p5 drawing code
> (see [Add your own light form](#add-your-own-light-form)).

## Quick start

1. Open `index.html` in **Chrome or Edge**. Double-clicking works: everything is vendored, so no internet is needed at the venue.
   If your browser blocks something when opened from a file, serve the folder instead:
   `python -m http.server 8000`, then go to <http://localhost:8000>.
2. Set **Output → width / height** to your wall's exact resolution (default 1920×640).
3. Pick a look (**Presets → built-in look**). Set the tempo with **Rhythm → bpm**, tap it with `T`, or drop an audio track on the page.
4. **Export → ▶ Render video**. Chrome/Edge ask where to save and write straight to disk.

Drag and drop works too: drop an audio track or a preset `.json` anywhere on the page.

## Keys (live view)

| Key | Does |
|---|---|
| `Space` | push: an extra pulse, like a strong beat |
| `T` | tap tempo (the first tap of a series is beat 1, so tapping also lines up the bar) |
| `[` / `]` | tempo −1 / +1 BPM |
| `X` | morph to a new scene |
| `1`–`9` | morph to palette 1–9 (the order in Colour → Palettes) |
| `P` / `R` | play-pause (the track too) / restart from 0 |
| `S` | save a PNG snapshot |
| `G` / `H` | hide the settings panel / the info overlay |
| `Enter` | fullscreen |
| `?` | help |

Keys only affect the live view and **Record live**. **Render video** follows the BPM or the
audio track from 0, so the same seed and settings always give the same file.

## Rhythm: how it moves with the music

Everything moves with a musical clock:

| | |
|---|---|
| **Beats from** | **BPM / tap tempo**, or **Audio file**: the track is analysed and its beats tracked (onset curve weighted towards the kick, tempo by autocorrelation, then the dynamic-programming beat tracker behind `librosa.beat_track`). If it locks to half or double time, change **audio tempo**. If beat 1 of the bar is off, change **audio beat 1 at**. |
| **Pulse** | fires on every beat, a little stronger on beat 1 of the bar (**bar accent**). **Soft kick** has a smooth attack and a long decay. **Breathe** goes in and out with the peak on the beat. **Pump** ducks on the beat and swells back, like sidechain compression. |
| **Pulse →** | what the pulse does: the picture **breathes** (zooms in and out), the liquid **ripples**, the **brightness** lifts. |
| **Glide** | the key to the "smooth but rhythmic" feel. At 0 the liquid flows at a constant speed. Raise it and the flow, the colours, the drift and the ripples surge on each **step** (every beat, 2 beats or bar), then settle before the next one, while moving at the same average speed. |
| **Audio reactivity** | with a track loaded, loudness speeds up the flow and deepens the warp, and the pulses fade out in breakdowns that have no kick. |
| **Scenes** | every few bars (**Scenes → new scene every**) the look morphs into a new variation of itself: palette, warp, scale, colour cycling, darkness and glow change smoothly over **morph length** beats. They never cut. **variation** sets how far apart scenes are. |

With a track loaded, the preview clock follows the audio, so you can check the sync by ear.
Export duration is in seconds; `0` means *auto*: the track length, else 30 s.
Tick **Export → include audio** to mux the track into the render.

## The look

| Stage | Panel | What it does |
|---|---|---|
| Liquid | Motion | domain-warped 4D simplex noise (noise pushed around by noise), optionally mixed with plasma waves, mirrored or folded into a kaleidoscope, rippling outwards on the beat |
| Colour | Colour | looping palettes: the liquid walks round the palette's colours (**colour cycles**) while the palette turns (**drift**, **step per beat**). **darkness** and **softness** carve light out of black; **glow** burns the brightest parts towards white |
| Light forms | Light forms | light drawn with p5 (orbs, a ring per beat, a laser fan, a Lissajous trace), bent by the liquid (**liquify**) and coloured by the palette |
| Trails | Trails (feedback) | video feedback. The last frame is zoomed (**tunnel**), turned, swirled along the liquid's contours and colour-shifted, then blended back as an **echo**, as **light trails**, or as a **double exposure** |
| Film | Film | bloom, red-orange halation round highlights, light leaks, projector flicker, grain (strongest in the mid-tones, optionally coloured), dust and scratches, gate weave, vignette, faded blacks |

Brightness pulses are capped at 3 per second, and projector flicker at ±4%, to stay under the usual
photosensitivity thresholds. **Calm (no flicker)** turns both off.

## Seamless loops

Tick **Export → seamless loop** (BPM mode) and the render is one loop that closes up perfectly, for
VJ software that loops clips: its last frame leads straight into its first. Its length is
**Export → duration** in seconds, rounded to the nearest whole number of bars so the beat lines up
when it repeats (e.g. 16 s at 120 BPM is exactly 8 bars; at 128 BPM it becomes 16.88 s = 9 bars). A message and the info overlay show
the exact length.

Every motion is rounded to a whole number of repeats per loop: the noise travels round a circle in
4D, drift goes round a circle, and rotations and colour turns complete whole cycles. The exporter
first renders a warm-up of whole loops, so the trails are already flowing at frame 0, and only then
records. If the loop isn't a whole number of frames (e.g. 8 bars at 125 BPM = 15.36 s), it's spread
over the nearest whole number of frames, which is less than 0.1% off the tempo. The live preview
loops too, so you can watch the seam.

## Export

| Format | Notes |
|---|---|
| MP4 (H.264) | Best default. If the browser can't encode H.264 at your size it falls back to HEVC, VP9 or AV1 and tells you which it used when it finishes. |
| WebM (VP9) | Good quality, smaller files. |
| PNG sequence | Lossless frames written to a folder you pick (Chrome/Edge), plus a `convert_with_ffmpeg.txt` and the settings used. Use this for HAP/ProRes or huge walls. |

Every frame is rendered at full resolution at exactly `t = frame / fps`, so it doesn't matter if your
machine renders slower than real time. **motion blur** averages 2–8 sub-frames per frame, for even
smoother motion (renders only). The settings used are stored in the MP4's comment tag.

Browsers can't write HAP or ProRes. Convert with ffmpeg (HAP needs width and height to be multiples of 4):

```sh
# MP4 -> HAP for Resolume
ffmpeg -i videoplasma.mp4 -c:v hap -format hap plasma_hap.mov
# PNG sequence -> HAP
ffmpeg -framerate 30 -i frame_%06d.png -c:v hap -format hap plasma_hap.mov
# anything -> ProRes 422 HQ
ffmpeg -i videoplasma.mp4 -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le plasma_prores.mov
```

**Record live** captures the canvas in real time with MediaRecorder, including your keyboard pushes,
taps and scene changes. It records at the *preview* resolution (**Output → preview scale**).

## Presets

Everything is saved in your browser automatically, and **Presets → Save preset** writes it all to a
`.json` file you can load later or share. Built-in looks only change the look, never your output
size, tempo or export settings:

| Preset | |
|---|---|
| Default | ember, Kodachrome, oil, ultraviolet, aurora and nitrate scenes, light orbs, soft echo trails |
| Super 8 memory | silver and nitrate tones, heavy grain, weave, flicker, dust and leaks, faded blacks |
| Liquid kaleidoscope | 6-way kaleidoscope, laser fan, light trails streaming out of the centre |
| Oil slick | iridescent oil-on-water colours, strong warp, no forms |
| Solar burn | burning-film reds in deep black, a ring on every beat, double exposure, big halation and leaks |
| Night swim | aurora and ultraviolet, slow, breathing pulse, ripples, trails sinking towards the centre |
| Acid bloom | 8-way kaleidoscope, pump pulse, fast colour steps, Lissajous light trace |
| Calm (no flicker) | no brightness pulses or flicker, gentler motion |

## Add your own light form

Light forms live in `src/forms.js`. Draw **white on black** with normal p5 calls: brightness is all
that counts, and the palette, the liquid and the trails do the rest. Add an entry and it appears in
**Light forms → form**:

```js
bars: {
  label: 'Light bars (mine)',
  draw(g, e) {                         // g = a p5.Graphics, cleared to black; e = the clock
    g.noStroke();
    e.glow(g, g.height * 0.03);        // soft glow round what comes next
    for (let i = 0; i < e.count; i++) {
      const x = (i + 0.5) / e.count * g.width;
      const h = g.height * (0.3 + 0.5 * e.pulse) * (0.5 + 0.5 * Math.sin(e.cyc(0.1) + i));
      g.fill(255, 200);
      g.rect(x - 4, (g.height - h) / 2, 8, h);
    }
  },
},
```

`e.pulse` fires on every beat, `e.beat` / `e.ph` are the beat count and the position inside the beat,
`e.step` is the eased step count (Glide), `e.tau` is rhythmic time in seconds, `e.level` / `e.kick`
are the audio loudness and bass, and `e.count` / `e.size` are the panel settings. Helpers:
`e.cyc(rate)` (an angle turning `rate` times per second), `e.wander(i, speed)` (a smooth random
position in -1..1), `e.rand(i)` (a repeatable random number), `e.orb(g, x, y, r, brightness)`
(a soft ball of light) and `e.glow(g, px)`. Animate with these rather than `frameCount`, `millis()`
or `random()`: renders then come out the same every time, in time with the music, and loops close up.

Palettes live in `src/palettes.js`: a loop of `[position, '#rrggbb']` stops (the last colour blends back
into the first), plus a `weight` for how often scenes pick it. You can also edit, add, remove and
duplicate them in **Colour → Palettes → Edit colours**.

## Speed

Measured on an AMD Radeon 860M laptop GPU in Chrome, which is far below a desktop graphics card:

| | |
|---|---|
| live preview, 1920×640 | 60 fps |
| render 1 minute at 1920×640, 30 fps | ~21 s (~35 s with motion blur ×2) |
| render 1 minute at 1920×1080, 30 fps, motion blur ×2 | ~55 s |
| render 1 minute at 3840×1280, 30 fps, motion blur ×2 | ~2 min 10 s |

If the live preview stutters, lower **Output → preview scale**. Renders are always full size.

## Files

```
index.html          page + script order
style.css
src/sketch.js       p5 setup() / draw()
src/app.js          live preview, keys, tap tempo, audio loading, presets, HUD
src/gui.js          settings panel (lil-gui)
src/settings.js     defaults and built-in presets
src/engine.js       the engine: runs the GPU passes for one frame at time t
src/shaders.js      GLSL: liquid, trails, bloom, film
src/rhythm.js       beat clock, pulses, glide, scenes, loop maths
src/forms.js        light forms drawn with p5: add yours here
src/palettes.js     palettes: add yours here
src/audio.js        tempo, beat tracking, loudness and bass
src/exporter.js     offline render (WebCodecs), seamless loops, PNG sequence, live recording
src/rng.js          seeded random numbers
lib/                p5.js 2.3.4, lil-gui 0.21, Mediabunny 1.61 (+ their licences)
```

## Where the look comes from

[Pedro Maia](https://www.pedromaia.net/about/) is a Portuguese filmmaker based in Berlin. Since 2004
he has been developing "Live Cinema": manipulating 16mm and Super 8 film in real time with musicians
(Vessel, Shackleton, Andy Stott, Fennesz, Lee Ranaldo, Panda Bear and others). What the generator
borrows from his work:

| His work | Here |
|---|---|
| film manipulated "frame by frame using different sources of light like lasers, leds" ([Super 8 Series](https://www.pedromaia.net/super8series/)) | light forms, liquified into the image |
| "the material and physical qualities of the medium", "the beauty of its patina" ([About](https://www.pedromaia.net/about/)) | the film stage: grain, gate weave, flicker, halation, dust, scratches, light leaks, faded blacks |
| "the tension between light and darkness" ([About](https://www.pedromaia.net/about/)), "the space between light and shadow" ([Vessel](https://www.pedromaia.net/vessel/)) | darkness / softness / glow: light carved out of black |
| images that are "fluid and change without warning" ([Vessel](https://www.pedromaia.net/vessel/)) | domain-warped liquid, and scenes that morph rather than cut |
| "superposition film", "live video feedback" ([Archive](https://www.pedromaia.net/archive/), [Live](https://www.pedromaia.net/live/)) | trails: echo, light trails, double exposure |
| "warping and twisting visuals" with "trippy visual effects" ([MUTEK](https://barcelona.mutek.org/en/artists/scotch-rolex-shackleton-pedro-maia)) | warp, swirl, mirrors and kaleidoscope |
| "making visual music" ([Portuguese Soul interview](https://portuguesesoul.com/2020/09/07/pedro-maia-berlin/)), film loops played live with the music | the beat clock, glide, pulses, beat tracking and seamless loops |

## Credits and licences

[p5.js](https://p5js.org) (LGPL-2.1), [lil-gui](https://lil-gui.georgealways.com) (MIT) and
[Mediabunny](https://mediabunny.dev) (MPL-2.0) are vendored unmodified in `lib/`. The 4D simplex noise
in `src/shaders.js` is from [webgl-noise](https://github.com/stegu/webgl-noise) by Ian McEwan / Ashima
Arts and Stefan Gustavson (MIT, `lib/webgl-noise.LICENSE.txt`). The small GLSL hashes follow Dave
Hoskins' "Hash without Sine" (MIT), and domain warping follows
[Inigo Quilez's article](https://iquilezles.org/articles/warp/).
