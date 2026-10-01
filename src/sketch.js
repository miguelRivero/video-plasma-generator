/*
  p5.js entry point.
  The look lives in src/engine.js + src/shaders.js (the GPU pipeline), the timing in
  src/rhythm.js, and the light you can paint with p5 drawing code in src/forms.js.
*/
let app;

function setup() {
  pixelDensity(1);
  createCanvas(960, 320, WEBGL);
  frameRate(60);
  app = new GW.App();
  app.setup();
  window.app = app; // handy in the browser console
}

function draw() {
  app.tick(deltaTime);
}
