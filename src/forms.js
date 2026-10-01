/*
  Light forms
  ===========
  Pedro Maia paints on film with light (lasers, LEDs, torches), frame by frame.
  These are the digital version: light drawn with ordinary p5.js calls, then bent
  by the liquid, coloured by the palette and smeared by the trails.

  Draw WHITE on BLACK: only brightness counts, the palette does the colour.
  Add an entry to GW.FORMS and it shows up in Light forms > form.

    draw(g, e)   g is a p5.Graphics (2D, half the output size, cleared to black)

  `e` holds:
    e.t, e.tau      time in seconds; tau is "rhythmic time" (surges on each step with Glide)
    e.beat          beats since the start; e.ph = position inside the beat (0..1),
                    e.eph = the same with Glide's easing, e.step = eased step count
    e.pulse         0..1, fires on every beat (accented on beat 1 of each bar)
    e.level, e.kick audio loudness and bass, 0..1 (0.5 and the pulse without audio)
    e.count, e.size the Light forms > count and size settings
    e.cyc(rate)     an angle that turns `rate` times per second (rounded so loops close)
    e.wander(i, speed)  a smooth random position [x, y] in -1..1 for item i (loops too)
    e.rand(i)       repeatable random number 0..1
    e.orb(g, x, y, r, brightness)  a soft ball of light
    e.glow(g, px)   glow around the next shapes and lines (0 turns it off)

  Animate with e.tau / e.beat / e.cyc rather than frameCount or millis(), so a
  render comes out the same every time, in time with the music, and loops close up.
*/
(function (GW) {
  'use strict';

  const TAU = Math.PI * 2;

  GW.FORMS = {
    none: { label: 'None', draw() {} },

    // -------------------------------------------------------------- LEDs dragged across the frame
    orbs: {
      label: 'Light orbs',
      draw(g, e) {
        const W = g.width, H = g.height;
        g.blendMode(ADD);                       // overlapping light adds up
        for (let i = 0; i < e.count; i++) {
          const [x, y] = e.wander(i, 0.06 + 0.04 * e.rand(i));
          const r = H * (0.08 + 0.14 * e.rand(i + 50)) * e.size * (1 + 0.45 * e.pulse);
          const b = 0.5 + 0.5 * Math.sin(e.cyc(0.05 + 0.05 * e.rand(i + 9)) + TAU * e.rand(i + 20));
          e.orb(g, W * (0.5 + 0.46 * x), H * (0.5 + 0.42 * y), r, 0.35 + 0.65 * b);
        }
      },
    },

    // -------------------------------------------------------------- a ring born on every beat
    ripples: {
      label: 'Ripples (one per beat)',
      draw(g, e) {
        const W = g.width, H = g.height, n = e.count + 1, far = Math.hypot(W, H) * 0.5;
        g.noFill();
        e.glow(g, H * 0.03);
        for (let j = 0; j < n; j++) {
          const age = (j + e.eph) / n;          // 0 = just born, 1 = gone
          g.stroke(255, 255 * (1 - age) ** 1.4);
          g.strokeWeight(H * 0.012 * e.size * (1 + 2 * (1 - age) * e.pulse));
          g.circle(W / 2, H / 2, 2 * far * age);
        }
      },
    },

    // -------------------------------------------------------------- laser lines that glide a notch per step
    lasers: {
      label: 'Laser fan',
      draw(g, e) {
        const W = g.width, H = g.height, n = e.count, len = Math.hypot(W, H);
        g.translate(W / 2, H / 2);
        g.rotate((Math.PI / n) * e.step + e.cyc(0.01));
        e.glow(g, H * 0.04);
        g.stroke(255, 170 + 85 * e.pulse);
        g.strokeWeight(Math.max(1, H * 0.006 * e.size * (1 + e.pulse)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI;
          g.line(-Math.cos(a) * len, -Math.sin(a) * len, Math.cos(a) * len, Math.sin(a) * len);
        }
      },
    },

    // -------------------------------------------------------------- an oscilloscope light trace
    trace: {
      label: 'Light trace (Lissajous)',
      draw(g, e) {
        const W = g.width, H = g.height;
        const fx = 1 + (e.count % 4), fy = fx + 1;   // count picks the figure: 1:2, 2:3, 3:4, 4:5
        const d = e.cyc(0.03), s = 1 + 0.12 * e.pulse;
        g.noFill();
        e.glow(g, H * 0.035);
        g.stroke(255, 225);
        g.strokeWeight(Math.max(1, H * 0.008 * e.size * (1 + 0.8 * e.pulse)));
        g.beginShape();
        for (let i = 0; i <= 480; i++) {
          const a = (i / 480) * TAU;
          g.vertex(W / 2 + Math.sin(fx * a + d) * W * 0.36 * s, H / 2 + Math.sin(fy * a) * H * 0.38 * s);
        }
        g.endShape();
      },
    },
  };
})(window.GW = window.GW || {});
