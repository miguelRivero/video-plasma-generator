/*
  Export
  ======
  renderVideo    frame-accurate offline render at full resolution, t = i / fps.
                 Encodes with WebCodecs through Mediabunny to MP4 (H.264, or HEVC /
                 VP9 / AV1 when H.264 isn't available) or WebM, or writes a PNG
                 sequence into a folder. Slower or faster than real time doesn't
                 matter: every frame is rendered.
                 With Export > loop on, it renders exactly one seamless loop. It warms
                 up first, so the trails are already flowing at frame 0.
  LiveRecorder   records the live canvas in real time (MediaRecorder), including
                 your keyboard pushes. Resolution = preview resolution.
*/
(function (GW) {
  'use strict';

  const even = v => Math.max(2, Math.round(v) & ~1);
  // yield to the browser; message channels aren't throttled in background tabs like timers are
  const nextTick = () => new Promise(r => {
    if (!document.hidden) { setTimeout(r, 0); return; }
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  GW.download = download;

  /** what a render of the settings `S` will produce */
  GW.renderPlan = function (S, audio) {
    const fps = S.fps;
    const loopBars = GW.loopBars(S, audio), loopSec = loopBars * 240 / S.bpm;
    const duration = loopSec || (S.duration > 0 ? S.duration : audio ? audio.duration : 30);
    const N = Math.max(1, Math.round(duration * fps));
    // a loop gets N frames that close up exactly (a hair off the fps if the loop isn't a whole number of frames)
    const step = loopSec ? loopSec / N : 1 / fps;
    // loops warm up for whole loops, long enough for the trails to settle into the loop
    const half = 0.03 + 2.5 * S.trails * S.trails;
    const warm = loopSec ? N * Math.ceil(Math.max(6, 10 * half) / loopSec) : 0;
    return { fps, loopSec, loopBars, duration, N, step, warm };
  };

  // ------------------------------------------------------------------ offline render
  /**
   * @param app   the App (audio, canvas, progress display)
   * @param ui    { cancelled: bool, progress(done, total, info), status(text) }
   */
  GW.renderVideo = async function (app, ui) {
    const M = window.Mediabunny;
    const S = GW.clone(app.S);
    const W = even(S.width), H = even(S.height);
    const { fps, loopSec, loopBars, N, step, warm } = GW.renderPlan(S, app.audio);
    const sub = Math.max(1, S.motionBlur | 0);
    const base = `videoplasma_${W}x${H}_seed${S.seed}` + (loopSec ? `_loop${+loopSec.toFixed(2)}s_${S.bpm}bpm` : '');
    const abort = () => new DOMException('Render cancelled', 'AbortError');

    // 1. ask where to save first, while we still have the click's user activation
    let dir = null, stream = null, format = null;
    if (S.format === 'png') {
      if (!window.showDirectoryPicker) throw new Error('PNG sequences need Chrome or Edge (folder access).');
      dir = await window.showDirectoryPicker({ id: 'videoplasma-png', mode: 'readwrite' });
    } else {
      format = S.format === 'webm' ? new M.WebMOutputFormat() : new M.Mp4OutputFormat();
      if (window.showSaveFilePicker) {
        const ext = format.fileExtension;
        const handle = await window.showSaveFilePicker({
          id: 'videoplasma-video', suggestedName: base + ext,
          types: [{ description: 'Video', accept: { [format.mimeType]: [ext] } }],
        });
        stream = await handle.createWritable();
      }
    }

    // 2. pick a codec this browser can encode at this size
    let codec = null, audioCodec = null;
    const withAudio = S.withAudio && app.audio && !loopSec;
    if (format) {
      const prefs = (S.format === 'webm' ? ['vp9', 'av1', 'vp8'] : ['avc', 'hevc', 'vp9', 'av1'])
        .filter(c => format.getSupportedVideoCodecs().includes(c));
      codec = await M.getFirstEncodableVideoCodec(prefs, { width: W, height: H, bitrate: S.bitrate * 1e6 });
      if (!codec) {
        if (stream) await stream.abort();
        throw new Error(`This browser can't encode ${W}×${H} ${S.format.toUpperCase()} video. Try WebM, PNG sequence or a smaller size.`);
      }
      if (withAudio) {
        const ch = Math.min(2, app.audio.buffer.numberOfChannels), sr = app.audio.buffer.sampleRate;
        const aPrefs = format.getSupportedAudioCodecs().filter(c => ['aac', 'opus'].includes(c));
        audioCodec = await M.getFirstEncodableAudioCodec(aPrefs, { numberOfChannels: ch, sampleRate: sr, bitrate: 256e3 });
      }
    }

    // 3. a fresh engine at full resolution, drawing on the (temporarily enlarged) canvas
    app.useCanvasSize(W, H);
    const canvas = app.canvasEl;
    const engine = new GW.Engine({ width: W, height: H, outWidth: W, outHeight: H, settings: S, audio: app.audio });

    // 4. output container
    let output = null, vsrc = null, asrc = null, target = null;
    try {
      if (format) {
        target = stream ? new M.StreamTarget(stream, { chunked: true }) : new M.BufferTarget();
        output = new M.Output({ format, target });
        vsrc = new M.CanvasSource(canvas, {
          codec,
          quality: new M.Quality({ bitrate: Math.round(S.bitrate * 1e6) }),
          keyFrameInterval: Math.max(0.05, S.keyframe),
          latencyMode: 'quality',
        });
        output.addVideoTrack(vsrc, { frameRate: fps });
        if (audioCodec) {
          asrc = new M.AudioBufferSource({ codec: audioCodec, quality: new M.Quality({ bitrate: 256e3 }) });
          output.addAudioTrack(asrc);
        }
        try { output.setMetadataTags({ comment: 'video-plasma-generator settings ' + JSON.stringify(S) }); } catch (e) { /* optional */ }
        await output.start();
      }
    } catch (e) {
      engine.dispose();
      app.restoreCanvas();
      if (stream) { try { await stream.abort(); } catch (e2) { /* already closed */ } }
      throw e;
    }
    const codecNote = codec ? `${codec.toUpperCase()} in ${format.fileExtension}` : 'PNG sequence';

    // audio goes in 1 s chunks, just ahead of the video
    const ab = asrc && app.audio.buffer;
    let aPos = 0;
    const aEnd = ab ? Math.min(ab.length, Math.round((N / fps) * ab.sampleRate)) : 0;
    const feedAudio = async until => {
      if (!asrc) return;
      const stop = Math.min(aEnd, Math.round(until * ab.sampleRate));
      const chans = Math.min(2, ab.numberOfChannels);
      while (aPos < stop) {
        const len = Math.min(stop - aPos, ab.sampleRate);
        const chunk = new AudioBuffer({ length: len, numberOfChannels: chans, sampleRate: ab.sampleRate });
        for (let c = 0; c < chans; c++) chunk.copyToChannel(ab.getChannelData(c).subarray(aPos, aPos + len), c);
        await asrc.add(chunk);
        aPos += len;
      }
    };

    // 5. render every frame
    const t0 = performance.now();
    try {
      if (warm) ui.status(`Warming up the loop (${warm} frames)…`);
      for (let i = 0; i < warm; i++) {
        if (ui.cancelled) throw abort();
        engine.render(i * step, step, sub);
        if (i % 8 === 0) {
          ui.progress(0, N, null);
          await nextTick();
        }
      }
      ui.status(`Rendering ${N} frames at ${W}×${H} (${codecNote}${sub > 1 ? `, motion blur ×${sub}` : ''})` + (loopSec ? ` · seamless ${loopSec.toFixed(2)} s loop (${loopBars} bars)` : ''));
      const t1 = performance.now();
      for (let i = 0; i < N; i++) {
        if (ui.cancelled) throw abort();
        engine.render((warm + i) * step, step, sub);
        if (vsrc) {
          await feedAudio(i / fps + 1);
          await vsrc.add(i / fps, 1 / fps);
        } else {
          await writePng(dir, i, canvas);
        }
        if (i % 4 === 0 || i === N - 1) {
          const el = (performance.now() - t1) / 1000, rate = (i + 1) / el;
          ui.progress(i + 1, N, { fps: rate, eta: (N - i - 1) / rate });
          await nextTick();
        }
      }
      if (output) {
        await feedAudio(N / fps);
        ui.status('Finishing file…');
        await output.finalize();
        if (!stream) download(new Blob([target.buffer], { type: format.mimeType }), base + format.fileExtension);
      } else {
        await writeText(dir, base + '_settings.json', JSON.stringify(S, null, 2));
        await writeText(dir, 'convert_with_ffmpeg.txt', ffmpegHelp(fps));
      }
    } catch (e) {
      if (output && output.state !== 'finalized') { try { await output.cancel(); } catch (e2) { /* ignore */ } }
      if (stream) { try { await stream.abort(); } catch (e2) { /* already closed */ } }
      throw e;
    } finally {
      engine.dispose();
      app.restoreCanvas();
    }
    const secs = (performance.now() - t0) / 1000;
    return { frames: N, seconds: secs, codec: codecNote, loop: loopSec, name: dir ? dir.name : base + format.fileExtension, savedToDisk: !!(stream || dir) };
  };

  async function writePng(dir, i, canvas) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const fh = await dir.getFileHandle(`frame_${String(i).padStart(6, '0')}.png`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function writeText(dir, name, text) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  function ffmpegHelp(fps) {
    return [
      'Run these in the folder with the PNG frames.',
      '',
      'HAP (Resolume):',
      `  ffmpeg -framerate ${fps} -i frame_%06d.png -c:v hap -format hap plasma_hap.mov`,
      '',
      'ProRes 422 HQ:',
      `  ffmpeg -framerate ${fps} -i frame_%06d.png -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le plasma_prores.mov`,
      '',
      'H.264 (high quality):',
      `  ffmpeg -framerate ${fps} -i frame_%06d.png -c:v libx264 -crf 14 -preset slow -pix_fmt yuv420p plasma.mp4`,
      '',
    ].join('\n');
  }

  // ------------------------------------------------------------------ live recording
  class LiveRecorder {
    constructor(canvas, fps, bitrateMbps, audioEl) {
      const stream = canvas.captureStream(fps);
      if (audioEl && audioEl.captureStream) {
        try { audioEl.captureStream().getAudioTracks().forEach(tr => stream.addTrack(tr)); } catch (e) { /* no audio */ }
      }
      const types = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4',
        'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      this.mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: Math.round(bitrateMbps * 1e6) });
      this.chunks = [];
      this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    }

    start() { this.rec.start(1000); }

    stop() {
      return new Promise(res => {
        this.rec.onstop = () => {
          const type = this.mime.split(';')[0] || 'video/webm';
          const blob = new Blob(this.chunks, { type });
          const ext = type.includes('mp4') ? '.mp4' : '.webm';
          download(blob, `videoplasma_live_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${ext}`);
          res(blob);
        };
        this.rec.stop();
      });
    }
  }

  GW.LiveRecorder = LiveRecorder;
})(window.GW = window.GW || {});
