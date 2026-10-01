/*
  Settings panel (lil-gui). Every control writes straight into app.S and tells
  the app which key changed, so it can rebuild only what's needed.
*/
(function (GW) {
  'use strict';

  GW.buildGUI = function (app) {
    const S = app.S;
    const gui = new lil.GUI({ title: 'Plasma Dream Generator · ? = keys' });
    const on = key => () => app.changed(key);
    const btn = (folder, label, fn) => folder.add({ [label]: fn }, label);

    // ---------------------------------------------------------------- presets
    const fPre = gui.addFolder('Presets');
    const pre = { preset: 'Default' };
    fPre.add(pre, 'preset', Object.keys(GW.PRESETS)).name('built-in look').onChange(n => app.applyPreset(n));
    btn(fPre, 'Save preset (.json)', () => app.savePreset());
    btn(fPre, 'Load preset…', () => app.pickFile('.json,application/json', f => app.loadPresetFile(f)));
    btn(fPre, 'Reset look to defaults', () => app.applyPreset('Default'));

    // ---------------------------------------------------------------- output
    const fOut = gui.addFolder('Output');
    fOut.add(S, 'width', 64, 7680, 2).name('width (px)').onFinishChange(on('width'));
    fOut.add(S, 'height', 64, 4320, 2).name('height (px)').onFinishChange(on('height'));
    fOut.add(S, 'fps', [24, 25, 30, 50, 60]).onChange(on('fps'));
    fOut.add(S, 'previewScale', 0.25, 1, 0.05).name('preview scale').onFinishChange(on('previewScale'));

    // ---------------------------------------------------------------- rhythm
    const fRh = gui.addFolder('Rhythm');
    fRh.add(S, 'beats', { 'BPM / tap tempo': 'bpm', 'Audio file': 'audio' }).name('beats from').onChange(on('beats'));
    fRh.add(S, 'bpm', 40, 220, 0.1).name('bpm').onFinishChange(on('bpm'));
    btn(fRh, 'Tap tempo  [T]', () => app.tap());
    btn(fRh, 'Load audio…', () => app.pickFile('audio/*,.wav,.mp3,.aif,.aiff,.flac,.m4a', f => app.loadAudio(f)));
    btn(fRh, 'Remove audio', () => app.removeAudio());
    fRh.add(S, 'tempoMul', { '½ × detected': 0.5, 'detected': 1, '2 × detected': 2 }).name('audio tempo').onChange(on('tempoMul'));
    fRh.add(S, 'barOffset', 0, 3, 1).name('audio beat 1 at').onChange(on('barOffset'));
    fRh.add(S, 'pulseShape', { 'Soft kick': 'soft', 'Breathe': 'breathe', 'Pump (sidechain)': 'pump' }).name('pulse shape');
    fRh.add(S, 'accent', 0, 1, 0.01).name('bar accent');
    fRh.add(S, 'glide', 0, 1, 0.01).name('glide (step motion)');
    fRh.add(S, 'stepBeats', { 'every beat': 1, 'every 2 beats': 2, 'every bar': 4 }).name('step');
    fRh.add(S, 'pulseZoom', 0, 1, 0.01).name('pulse → breathing');
    fRh.add(S, 'pulseWarp', 0, 1, 0.01).name('pulse → ripple');
    fRh.add(S, 'pulseLight', 0, 0.5, 0.01).name('pulse → brightness');
    fRh.add(S, 'react', 0, 1.5, 0.01).name('audio reactivity');
    btn(fRh, 'Play / pause  [P]', () => app.togglePlay());
    btn(fRh, 'Restart  [R]', () => app.restart());

    // ---------------------------------------------------------------- motion
    const fMo = gui.addFolder('Motion');
    fMo.add(S, 'speed', 0, 1.5, 0.01).name('flow speed');
    fMo.add(S, 'scale', 0.3, 6, 0.01).name('scale');
    fMo.add(S, 'warp', 0, 2.5, 0.01).name('warp');
    fMo.add(S, 'detail', 0, 1, 0.01).name('detail');
    fMo.add(S, 'plasma', 0, 1, 0.01).name('plasma waves');
    fMo.add(S, 'ripples', 0, 1, 0.01).name('ripples');
    fMo.add(S, 'spin', -1, 1, 0.01).name('spin');
    fMo.add(S, 'drift', 0, 1, 0.01).name('drift');
    fMo.add(S, 'driftAngle', 0, 360, 1).name('drift direction (°)');
    fMo.add(S, 'symmetry', { 'None': 'none', 'Mirror': 'mirror', 'Quad mirror': 'quad', 'Kaleidoscope': 'kaleido' });
    fMo.add(S, 'segments', 2, 16, 1).name('kaleido segments');
    fMo.add(S, 'turn', -1, 1, 0.01).name('kaleido turn');

    // ---------------------------------------------------------------- colour
    const fCol = gui.addFolder('Colour');
    fCol.add(S, 'cycles', 0.1, 5, 0.01).name('colour cycles');
    fCol.add(S, 'hueDrift', -0.25, 0.25, 0.005).name('drift (turns / s)');
    fCol.add(S, 'hueStep', 0, 0.5, 0.005).name('step per beat');
    fCol.add(S, 'darkness', 0, 0.95, 0.01);
    fCol.add(S, 'softness', 0.01, 0.5, 0.01);
    fCol.add(S, 'glow', 0, 1.5, 0.01).name('glow');
    fCol.add(S, 'saturation', 0, 2, 0.01);

    const fPal = fCol.addFolder('Palettes');
    const ed = { name: Object.keys(S.palettes)[0] };
    function rebuildPalettes() {
      fPal.children.slice().forEach(c => c.destroy());
      const names = Object.keys(S.palettes);
      if (!S.palettes[ed.name]) ed.name = names[0];
      names.forEach((n, i) => fPal.add(S.palettes[n], 'on').name(`${i < 9 ? `[${i + 1}] ` : ''}${n}`).onChange(on('palettes')));

      const fEd = fPal.addFolder('Edit colours');
      fEd.add(ed, 'name', names).name('palette').onChange(() => { rebuildPalettes(); fPal.folders[0].open(); });
      const P = S.palettes[ed.name];
      fEd.add(P, 'weight', 0, 1, 0.01).name('how often').onChange(on('palettes'));
      P.stops.forEach((stop, i) => {
        fEd.addColor(stop, 1).name(`colour ${i + 1}`).onChange(on('paletteColors'));
        fEd.add(stop, 0, 0, 1, 0.01).name(`  at`).onChange(on('paletteColors'));
      });
      btn(fEd, '+ add a colour', () => {
        const s = P.stops, a = s[s.length - 1], b = s[0];
        const ca = GW.hexToRgb(a[1]), cb = GW.hexToRgb(b[1]);
        const mid = '#' + ca.map((v, j) => Math.round((v + cb[j]) / 2).toString(16).padStart(2, '0')).join('');
        s.push([+((a[0] + 1) / 2).toFixed(2), mid]);   // between the last colour and the loop back to the first
        rebuildPalettes(); fPal.folders[0].open(); app.changed('paletteColors');
      });
      btn(fEd, '− remove a colour', () => {
        if (P.stops.length > 2) P.stops.pop();
        rebuildPalettes(); fPal.folders[0].open(); app.changed('paletteColors');
      });
      btn(fEd, 'Duplicate palette', () => {
        let k = 2;
        while (S.palettes[`${ed.name.replace(/\d+$/, '')}${k}`]) k++;
        const nn = `${ed.name.replace(/\d+$/, '')}${k}`;
        S.palettes[nn] = GW.clone(P);
        ed.name = nn;
        rebuildPalettes(); fPal.folders[0].open(); app.changed('palettes');
      });
      btn(fEd, 'Reset colours', () => {
        if (GW.PALETTES[ed.name]) P.stops = GW.clone(GW.PALETTES[ed.name].stops);
        rebuildPalettes(); fPal.folders[0].open(); app.changed('paletteColors');
      });
      fEd.close();
    }
    rebuildPalettes();
    fPal.close();

    // ---------------------------------------------------------------- light forms
    const fForm = gui.addFolder('Light forms');
    const forms = {};
    for (const [key, f] of Object.entries(GW.FORMS)) forms[f.label || key] = key;
    fForm.add(S, 'form', forms);
    fForm.add(S, 'formAmount', 0, 1.5, 0.01).name('amount');
    fForm.add(S, 'liquify', 0, 1, 0.01);
    fForm.add(S, 'formCount', 1, 12, 1).name('count');
    fForm.add(S, 'formSize', 0.2, 3, 0.01).name('size');
    fForm.close();

    // ---------------------------------------------------------------- trails
    const fTr = gui.addFolder('Trails (feedback)');
    fTr.add(S, 'trails', 0, 1, 0.01).name('length');
    fTr.add(S, 'trailMode', { 'Echo': 'echo', 'Light trails': 'light', 'Double exposure': 'expose' }).name('mode');
    fTr.add(S, 'fbZoom', -1, 1, 0.01).name('zoom (tunnel)');
    fTr.add(S, 'fbSpin', -1, 1, 0.01).name('turn');
    fTr.add(S, 'swirl', 0, 1, 0.01);
    fTr.add(S, 'fbHue', -1, 1, 0.01).name('colour shift');
    fTr.close();

    // ---------------------------------------------------------------- film
    const fFilm = gui.addFolder('Film');
    fFilm.add(S, 'grain', 0, 1, 0.01);
    fFilm.add(S, 'grainSize', 0.5, 4, 0.01).name('grain size');
    fFilm.add(S, 'colorGrain', 0, 1, 0.01).name('colour grain');
    fFilm.add(S, 'weave', 0, 1, 0.01).name('gate weave');
    fFilm.add(S, 'flicker', 0, 1, 0.01);
    fFilm.add(S, 'halation', 0, 1.5, 0.01);
    fFilm.add(S, 'bloom', 0, 1.5, 0.01);
    fFilm.add(S, 'vignette', 0, 1, 0.01);
    fFilm.add(S, 'dust', 0, 1, 0.01).name('dust & scratches');
    fFilm.add(S, 'leaks', 0, 1, 0.01).name('light leaks');
    fFilm.add(S, 'exposure', 0.2, 3, 0.01);
    fFilm.add(S, 'contrast', 0.5, 2, 0.01);
    fFilm.add(S, 'fade', 0, 0.5, 0.01).name('faded blacks');
    fFilm.close();

    // ---------------------------------------------------------------- scenes
    const fSc = gui.addFolder('Scenes');
    const seedCtl = fSc.add(S, 'seed', 0, 9999, 1).onFinishChange(on('seed'));
    btn(fSc, 'New random seed', () => { S.seed = Math.floor(Math.random() * 10000); seedCtl.updateDisplay(); app.changed('seed'); });
    fSc.add(S, 'sceneBars', 0, 64, 1).name('new scene every (bars)').onFinishChange(on('sceneBars'));
    fSc.add(S, 'morphBeats', 0.25, 64, 0.25).name('morph length (beats)').onFinishChange(on('morphBeats'));
    fSc.add(S, 'variation', 0, 1, 0.01).onFinishChange(on('variation'));
    btn(fSc, 'Next scene  [X]', () => app.engine.nextScene());

    // ---------------------------------------------------------------- export
    const fExp = gui.addFolder('Export');
    fExp.add(S, 'duration', 0, 3600, 1).name('duration s (0 = auto)').onFinishChange(on('duration'));
    fExp.add(S, 'loopBars', 0, 64, 1).name('seamless loop (bars)').onFinishChange(on('loopBars'));
    fExp.add(S, 'format', { 'MP4 (H.264)': 'mp4', 'WebM (VP9)': 'webm', 'PNG sequence': 'png' });
    fExp.add(S, 'bitrate', 2, 200, 1).name('bitrate (Mbps)');
    fExp.add(S, 'keyframe', 0.1, 10, 0.1).name('keyframe every (s)');
    fExp.add(S, 'motionBlur', { 'off': 1, '2 sub-frames': 2, '4 sub-frames': 4, '8 sub-frames': 8 }).name('motion blur');
    fExp.add(S, 'withAudio').name('include audio');
    btn(fExp, '▶ Render video', () => app.exportVideo());
    const recCtl = btn(fExp, '● Record live', () => app.toggleRecord());
    btn(fExp, 'Snapshot PNG  [S]', () => app.snapshot());

    // everything stored on change
    gui.onFinishChange(() => GW.storeSettings(S));

    fOut.close();

    let hidden = false;
    return {
      gui,
      refresh() { gui.controllersRecursive().forEach(c => c.updateDisplay()); },
      rebuildPalettes,
      setRecording(onAir) { recCtl.name(onAir ? '■ Stop recording' : '● Record live'); },
      toggle() { hidden = !hidden; gui.show(!hidden); app.fit(); },
      visible() { return !hidden; },
    };
  };
})(window.GW = window.GW || {});
