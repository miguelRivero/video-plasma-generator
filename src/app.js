/*
  App: the live preview. Owns the settings, the live engine, the loaded track,
  keyboard shortcuts, HUD and hands renders off to the exporter.
*/
(function (GW) {
  'use strict';

  const even = v => Math.max(2, Math.round(v) & ~1);
  const fmtTime = s => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), r = s - m * 60;
    return m ? `${m}:${r.toFixed(0).padStart(2, '0')}` : `${r.toFixed(1)} s`;
  };
  GW.fmtTime = fmtTime;

  class App {
    constructor() {
      this.S = GW.loadStoredSettings();
      this.t = 0;
      this.playing = true;
      this.frameMs = 0;
      this.fps = 60;
      this.audio = null; this.audioEl = null; this.audioName = '';
      this.exporting = false;
      this.recorder = null;
      this.hudOn = true;
      this.taps = [];
      this._hudTick = 0;
    }

    setup() {
      this.buildEngine();
      this.gui = GW.buildGUI(this);
      this.fit();
      this.bindKeys();
      this.bindDrop();
      window.addEventListener('resize', () => this.fit());
      document.getElementById('help-close').onclick = () => this.toggleHelp(false);
      document.getElementById('progress-cancel').onclick = () => { if (this.ui) this.ui.cancelled = true; };
      this.toast('? shows the keyboard shortcuts', 4000);
    }

    // ------------------------------------------------------------------ engine
    workSize() {
      const k = this.S.previewScale;
      return [even(this.S.width * k), even(this.S.height * k)];
    }

    buildEngine() {
      const [W, H] = this.workSize();
      if (this.engine) this.engine.dispose();
      this.useCanvasSize(W, H);
      this.engine = new GW.Engine({
        width: W, height: H, outWidth: even(this.S.width), outHeight: even(this.S.height),
        settings: this.S, audio: this.audio,
      });
      this.engine.seek(this.t);
    }

    /** resize the p5 canvas (renders use it at full size) */
    useCanvasSize(W, H) {
      if (width !== W || height !== H) resizeCanvas(W, H);
      this.canvasEl = drawingContext.canvas;
      const stage = document.getElementById('stage');
      if (this.canvasEl.parentElement !== stage) stage.appendChild(this.canvasEl);
      this.fit();
    }

    /** back to the preview after a render */
    restoreCanvas() { this.buildEngine(); }

    tick(dtMs) {
      if (this.exporting) return;
      let dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (this.audioEl) {
        if (this.audioEl.paused) dt = 0;
        this.t = this.audioEl.currentTime;
      } else if (this.playing) {
        this.t += dt;
      } else {
        dt = 0;
      }
      const a = performance.now();
      this.engine.render(this.t, dt);
      const ms = performance.now() - a;
      this.frameMs = this.frameMs * 0.9 + ms * 0.1;
      if (dtMs > 0) this.fps = this.fps * 0.9 + (1000 / dtMs) * 0.1;
      if (++this._hudTick % 6 === 0) this.updateHUD();
    }

    /** a setting changed in the GUI */
    changed(key) {
      const E = this.engine;
      switch (key) {
        case 'width': case 'height': case 'previewScale':
          this.buildEngine(); break;
        case 'seed':
          E.reset(this.t); break;
        case 'beats':
          if (this.S.beats === 'audio' && !this.audio) this.toast('Load an audio file: Rhythm > Load audio… (BPM until then)');
          E.rhythm.retime(); break;
        case 'bpm':
          E.rhythm.retime(); this.loopNote(); break;
        case 'tempoMul': case 'barOffset':
          E.rhythm.retime(); break;
        case 'loop': case 'duration':
          E.rhythm.retime(); this.loopNote(); break;
        case 'palettes':
          E.rebuildLUT(); E.rhythm.clearScenes(); break;
        case 'paletteColors':
          E.rebuildLUT(); break;
        case 'sceneBars': case 'morphBeats': case 'variation':
          E.rhythm.clearScenes(); break;
        default: break;
      }
      GW.storeSettings(this.S);
      this.updateHUD();
    }

    // ------------------------------------------------------------------ audio
    async loadAudio(file) {
      this.toast(`Analysing ${file.name}…`, 0);
      let a;
      try {
        a = await GW.analyzeAudio(file);
      } catch (e) {
        this.toast('Audio: ' + e.message, 8000);
        return;
      }
      this.removeAudio(true);
      const el = new Audio(URL.createObjectURL(file));
      el.loop = true;
      this.audio = a; this.audioEl = el; this.audioName = file.name;
      this.S.beats = 'audio';
      this.S.bpm = Math.round(a.tempo * 10) / 10;
      this.gui.refresh();
      this.t = 0;
      this.engine.setAudio(a);
      this.engine.reset(0);
      try { await el.play(); this.playing = true; } catch (e) { this.playing = false; }
      this.toast(`${file.name}: ${a.tempo.toFixed(1)} BPM, ${a.beatTimes.length} beats in ${fmtTime(a.duration)}` + (this.playing ? '' : ' · press P to play'), 6000);
    }

    removeAudio(quiet) {
      if (!this.audioEl) return;
      this.audioEl.pause();
      URL.revokeObjectURL(this.audioEl.src);
      this.audio = null; this.audioEl = null; this.audioName = '';
      if (this.S.beats === 'audio') this.S.beats = 'bpm';
      this.engine.setAudio(null);
      if (this.gui) this.gui.refresh();
      if (!quiet) this.toast('Audio removed');
    }

    togglePlay() {
      const a = this.audioEl;
      if (a) {
        this.playing = a.paused;
        if (a.paused) a.play().catch(() => {}); else a.pause();
      } else {
        this.playing = !this.playing;
      }
      this.toast(this.playing ? 'Play' : 'Pause', 800);
    }

    restart() {
      this.t = 0;
      if (this.audioEl) this.audioEl.currentTime = 0;
      this.engine.reset(0);
      this.toast('Restart', 800);
    }

    /** tap tempo: the first tap of a series is beat 1 */
    tap() {
      if (this.engine.rhythm.mode === 'audio') { this.toast('The beat comes from the audio track (Rhythm > beats from)'); return; }
      const now = performance.now() / 1000, T = this.taps;
      if (T.length && now - T[T.length - 1] > 2) T.length = 0;
      T.push(now);
      if (T.length > 8) T.shift();
      if (T.length >= 2) {
        const bpm = 60 * (T.length - 1) / (T[T.length - 1] - T[0]);
        this.S.bpm = Math.min(220, Math.max(40, Math.round(bpm * 10) / 10));
        this.gui.refresh();
        this.engine.rhythm.retime();
        GW.storeSettings(this.S);
      }
      this.engine.align(T.length === 1);
      this.toast(T.length >= 2 ? `Tap: ${this.S.bpm} BPM` : 'Tap: beat 1', 900);
    }

    /** say how long the seamless loop really is (the duration rounded to whole bars) */
    loopNote() {
      const S = this.S;
      if (!S.loop) return;
      const bars = GW.loopBars(S, this.audio);
      if (!bars) { this.toast('Seamless loops follow the BPM, not the audio track (Rhythm > beats from)', 5000); return; }
      const asked = S.duration > 0 ? S.duration : this.audio ? this.audio.duration : 30, secs = bars * 240 / S.bpm;
      this.toast(`Seamless loop: ${secs.toFixed(2)} s = ${bars} bar${bars > 1 ? 's' : ''} at ${S.bpm} BPM`
        + (Math.abs(secs - asked) > 0.005 ? ` (the nearest whole bars to ${+asked.toFixed(2)} s)` : ''), 6000);
    }

    nudgeBpm(d) {
      this.S.bpm = Math.min(220, Math.max(40, Math.round((this.S.bpm + d) * 10) / 10));
      this.gui.refresh();
      this.changed('bpm');
      this.toast(`${this.S.bpm} BPM`, 700);
    }

    // ------------------------------------------------------------------ presets
    applyPreset(name) {
      const next = GW.fromPreset(GW.PRESETS[name] || {}, this.S);
      this.replaceSettings(next);
      this.toast(`Preset: ${name}`);
    }

    replaceSettings(next) {
      GW.assignSettings(this.S, next);
      if (this.S.beats === 'audio' && !this.audio) this.S.beats = 'bpm';
      this.gui.rebuildPalettes();
      this.gui.refresh();
      this.buildEngine();
      GW.storeSettings(this.S);
    }

    savePreset() {
      const blob = new Blob([JSON.stringify(this.S, null, 2)], { type: 'application/json' });
      GW.download(blob, `videoplasma_preset_seed${this.S.seed}.json`);
    }

    async loadPresetFile(file) {
      try {
        const json = JSON.parse(await file.text());
        this.replaceSettings(GW.merge(GW.defaults(), json));
        this.toast(`Loaded ${file.name}`);
      } catch (e) {
        this.toast('Could not read preset: ' + e.message, 6000);
      }
    }

    // ------------------------------------------------------------------ files
    pickFile(accept, cb) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
      inp.click();
    }

    routeFile(file) {
      const n = file.name.toLowerCase();
      if (file.type.startsWith('audio/') || /\.(wav|mp3|aiff?|flac|ogg|m4a|aac)$/.test(n)) this.loadAudio(file);
      else if (n.endsWith('.json')) this.loadPresetFile(file);
      else this.toast('Drop an audio file or a preset .json');
    }

    bindDrop() {
      window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
      window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
      window.addEventListener('drop', e => {
        e.preventDefault();
        document.body.classList.remove('dropping');
        for (const f of e.dataTransfer.files) this.routeFile(f);
      });
    }

    // ------------------------------------------------------------------ output
    snapshot() {
      this.canvasEl.toBlob(b => GW.download(b, `videoplasma_seed${this.S.seed}_t${this.t.toFixed(2)}.png`), 'image/png');
    }

    async toggleRecord() {
      if (this.recorder) {
        const r = this.recorder;
        this.recorder = null;
        this.gui.setRecording(false);
        await r.stop();
        this.toast('Recording saved');
        return;
      }
      try {
        this.recorder = new GW.LiveRecorder(this.canvasEl, this.S.fps, this.S.bitrate, this.S.withAudio ? this.audioEl : null);
        this.recorder.start();
        this.gui.setRecording(true);
        const [W, H] = this.workSize();
        this.toast(`Recording ${W}×${H} live · click again to stop`, 4000);
      } catch (e) {
        this.recorder = null;
        this.toast('Recording not supported here: ' + e.message, 6000);
      }
    }

    async exportVideo() {
      if (this.exporting) return;
      if (this.recorder) await this.toggleRecord();
      const ui = this.ui = {
        cancelled: false,
        progress: (done, total, info) => this.showProgress(done, total, info),
        status: text => { document.getElementById('progress-status').textContent = text; },
      };
      const wasPlaying = this.playing;
      if (this.audioEl) this.audioEl.pause();
      this.exporting = true;
      document.getElementById('progress').hidden = false;
      ui.status('Preparing…');
      this.showProgress(0, 1, null);
      try {
        const r = await GW.renderVideo(this, ui);
        this.toast(`Done: ${r.frames} frames in ${fmtTime(r.seconds)} · ${r.codec}` + (r.loop ? ' · seamless loop' : '')
          + (r.savedToDisk ? ` → ${r.name}` : ' · downloaded'), 10000);
      } catch (e) {
        if (e.name === 'AbortError') this.toast(ui.cancelled ? 'Render cancelled' : 'Cancelled');
        else { console.error(e); this.toast('Export failed: ' + e.message, 12000); }
      } finally {
        this.exporting = false;
        this.ui = null;
        document.getElementById('progress').hidden = true;
        if (wasPlaying && this.audioEl) this.audioEl.play().catch(() => {});
      }
    }

    showProgress(done, total, info) {
      document.getElementById('progress-bar').style.width = (100 * done / total).toFixed(1) + '%';
      document.getElementById('progress-info').textContent = info
        ? `${done} / ${total} frames · ${info.fps.toFixed(1)} fps · ${fmtTime(info.eta)} left`
        : '';
    }

    // ------------------------------------------------------------------ UI bits
    fit() {
      const c = this.canvasEl;
      if (!c) return;
      // leave room for the settings panel while it's showing
      const panel = this.gui && this.gui.visible() ? this.gui.gui.domElement : null;
      const room = panel && window.innerWidth > 700 ? panel.offsetWidth + 16 : 0;
      document.getElementById('stage').style.right = room + 'px';
      const s = Math.min((window.innerWidth - room) / c.width, window.innerHeight / c.height);
      c.style.width = Math.floor(c.width * s) + 'px';
      c.style.height = Math.floor(c.height * s) + 'px';
    }

    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }

    toggleHelp(force) {
      const el = document.getElementById('help');
      el.hidden = force === undefined ? !el.hidden : !force;
    }

    toast(text, ms = 2500) {
      const el = document.getElementById('toast');
      el.textContent = text;
      el.classList.add('on');
      clearTimeout(this._toastTimer);
      if (ms > 0) this._toastTimer = setTimeout(() => el.classList.remove('on'), ms);
    }

    updateHUD() {
      const el = document.getElementById('hud');
      el.hidden = !this.hudOn;
      if (!this.hudOn || !this.engine || !this.engine.R) return;
      const S = this.S, E = this.engine, R = E.R, rh = E.rhythm, [W, H] = this.workSize();
      const tempo = rh.mode === 'audio' ? `${(this.audio.tempo * S.tempoMul).toFixed(1)} BPM (tracked)`
        : `${S.bpm} BPM` + (S.beats === 'audio' ? ' (no track yet)' : '');
      const scene = R.palA === R.palB || R.morph >= 1 ? R.palB : `${R.palA} → ${R.palB} ${Math.round(100 * R.morph)}%`;
      const L = rh.loop, LB = rh.loopBars;
      const lines = [
        `${fmtTime(this.t)}${this.playing ? '' : ' · paused'} · ${this.fps.toFixed(0)} fps · ${this.frameMs.toFixed(1)} ms/frame`,
        `preview ${W}×${H} of ${even(S.width)}×${even(S.height)} · ${tempo}`,
        `bar ${Math.floor(R.beat / 4) + 1} beat ${GW.mod(R.k, 4) + 1} · scene ${R.sceneIndex + 1}: ${scene}`
          + (L ? ` · loop ${(GW.mod(R.beat, LB * 4) * R.beatLen).toFixed(1)} / ${L.toFixed(2)} s (${LB} bars)` : S.loop ? ' · loop off (audio beats)' : ''),
      ];
      if (this.audio) lines.push(`audio: ${this.audioName} · ${fmtTime(this.audio.duration)}`);
      if (this.recorder) lines.push('● REC');
      el.textContent = lines.join('\n');
    }

    bindKeys() {
      window.addEventListener('keydown', e => {
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (this.exporting) {
          if (e.key === 'Escape' && this.ui) this.ui.cancelled = true;
          return;
        }
        const E = this.engine, k = e.key;
        switch (k.length === 1 ? k.toLowerCase() : k) {
          case ' ': E.push(); e.preventDefault(); break;
          case 't': this.tap(); break;
          case '[': this.nudgeBpm(-1); break;
          case ']': this.nudgeBpm(1); break;
          case 'x': E.nextScene(); break;
          case 'p': this.togglePlay(); break;
          case 'r': this.restart(); break;
          case 'g': this.gui.toggle(); break;
          case 'h': this.hudOn = !this.hudOn; this.updateHUD(); break;
          case '?': case '/': this.toggleHelp(); break;
          case 's': this.snapshot(); break;
          case 'Enter': this.toggleFullscreen(); break;
          case 'Escape': this.toggleHelp(false); break;
          default:
            if (/^[1-9]$/.test(k)) {
              const name = Object.keys(this.S.palettes)[+k - 1];
              if (name) { E.toPalette(name); this.toast(`Palette: ${name}`, 900); }
            }
        }
      });
    }
  }

  GW.App = App;
})(window.GW = window.GW || {});
