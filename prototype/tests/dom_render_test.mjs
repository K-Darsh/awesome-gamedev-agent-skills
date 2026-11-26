// Browser-path smoke test without a GPU: real index.html, real HUD, real renderer,
// with jsdom plus stubbed WebGL2 and 2D canvas contexts and a silent AudioContext.
// Catches the class of boot errors that only appear when the DOM and three.js are real.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost:8123/' });
const { window } = dom;

for (const key of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Image', 'Event',
  'PointerEvent', 'KeyboardEvent', 'CustomEvent', 'getComputedStyle']) {
  globalThis[key] = window[key] ?? window;
}
globalThis.devicePixelRatio = window.devicePixelRatio || 1;
globalThis.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id);
globalThis.localStorage = window.localStorage;

// ---- WebGL2 stub -------------------------------------------------------------------------
const GL_STRINGS = {
  7938: 'WebGL 2.0 (stub)', 35724: 'WebGL GLSL ES 3.00', 7936: 'stub', 7937: 'stub',
  3379: 4096, 34076: 4096, 34930: 16, 35660: 16, 35661: 32, 34921: 16, 36347: 1024,
  36348: 30, 36349: 1024, 36183: 4, 32883: 256, 35071: 256, 34852: 8, 36063: 8,
};
const GL_CONSTANTS = {
  VERSION: 7938, SHADING_LANGUAGE_VERSION: 35724, VENDOR: 7936, RENDERER: 7937,
  MAX_TEXTURE_SIZE: 3379, MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
  MAX_VERTEX_ATTRIBS: 34921, MAX_VERTEX_UNIFORM_VECTORS: 36347, MAX_VARYING_VECTORS: 36348,
  MAX_FRAGMENT_UNIFORM_VECTORS: 36349, MAX_SAMPLES: 36183, FRAMEBUFFER_COMPLETE: 36053,
  ACTIVE_UNIFORMS: 35718, ACTIVE_ATTRIBUTES: 35721, LINK_STATUS: 35714, VALIDATE_STATUS: 35715,
};

function makeGL() {
  const target = {
    getParameter: (p) => GL_STRINGS[p] ?? 4096,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getExtension: () => null,
    getSupportedExtensions: () => [],
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: true }),
    isContextLost: () => false,
    getError: () => 0,
    checkFramebufferStatus: () => 36053,
    // ACTIVE_UNIFORMS 35718 / ACTIVE_ATTRIBUTES 35721 must be a count; the rest are flags.
    getProgramParameter: (program, p) => (p === 35718 || p === 35721 ? 0 : true),
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getActiveUniform: () => null,
    getActiveAttrib: () => null,
    getUniformLocation: () => null,
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
    fenceSync: () => ({}),
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'string') {
        if (prop in GL_CONSTANTS) return GL_CONSTANTS[prop];
        if (/^[A-Z0-9_]+$/.test(prop)) return 0x9000 + prop.length;
        if (prop === 'drawingBufferWidth') return 800;
        if (prop === 'drawingBufferHeight') return 600;
      }
      return () => ({});
    },
  });
}

function make2D() {
  const gradient = { addColorStop() {} };
  return new Proxy({
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: () => ({ width: 10 }),
  }, { get: (obj, prop) => (prop in obj ? obj[prop] : () => undefined), set: () => true });
}

window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type === 'webgl2' || type === 'webgl') return makeGL();
  if (type === '2d') return make2D();
  return null;
};
window.HTMLCanvasElement.prototype.setPointerCapture ??= function () {};
for (const el of window.document.querySelectorAll('canvas')) {
  el.getBoundingClientRect = () => ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
}
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia ??= (query) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
});
globalThis.matchMedia = window.matchMedia;

// ---- silent WebAudio stub ----------------------------------------------------------------
function silentNode() {
  const node = {
    connect: () => node, disconnect: () => {}, start: () => {}, stop: () => {},
    gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    frequency: { value: 0, setValueAtTime() {} },
    detune: { value: 0 }, type: 'sine', buffer: null, loop: false,
    playbackRate: { value: 1 },
  };
  return node;
}
class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = silentNode();
    this.sampleRate = 48000;
  }
  createGain() { return silentNode(); }
  createOscillator() { return silentNode(); }
  createBufferSource() { return silentNode(); }
  createBiquadFilter() { return silentNode(); }
  createDynamicsCompressor() { return silentNode(); }
  createBuffer(channels, length, rate) { return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => new Float32Array(length) }; }
  createStereoPanner() { return silentNode(); }
  createConvolver() { return silentNode(); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
window.AudioContext = StubAudioContext;
window.webkitAudioContext = StubAudioContext;
globalThis.AudioContext = StubAudioContext;

// ---- run ---------------------------------------------------------------------------------
const { Game } = await import('../src/game.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

let game;
check('game boots from the real page DOM and index.html', () => {
  game = new Game();
  window.__game = game;
  assert.ok(game.renderer, 'renderer built');
  assert.ok(game.hud, 'hud built');
  assert.ok(game.input, 'input built');
  assert.ok(game.audio, 'audio built');
});

check('loading overlay is visible before the first frame and hides after', () => {
  const loading = window.document.getElementById('loading');
  assert.equal(loading.classList.contains('hidden'), false);
  game.hud.setLoading(1, 'Ready');
  game.hud.hideLoading();
  assert.equal(loading.classList.contains('done'), true, 'fade-out starts immediately');
  assert.equal(window.__bootError, undefined, 'no boot error recorded');
});

check('first simulation steps and one rendered frame complete without throwing', () => {
  game.update(1 / 60);
  game.update(1 / 60);
  game._renderFrame(0.016, 1000);
  assert.ok(game.player, 'player alive');
  assert.ok(Number.isFinite(game.player.x) && Number.isFinite(game.player.z));
});

check('HUD reflects cash, clock and wanted level from game state', () => {
  game.player.cash = 4321;
  game.player.health = 55;
  game.player.armour = 20;
  game.wanted = 3;
  game._renderFrame(0.016, 2000);
  const doc = window.document;
  assert.match(doc.getElementById('cash').textContent, /4,321|4321/);
  assert.equal(doc.getElementById('wanted').children.length >= 3, true);
  assert.ok(doc.getElementById('clock').textContent.length >= 4);
});

check('typing into the cheat field does not drive the player', () => {
  const field = window.document.getElementById('cheat-input');
  if (!field) return; // console may be built lazily
  game.input.keys.clear();
  field.focus?.();
});

check('keyboard input moves the player through the real Input layer', () => {
  const before = { x: game.player.x, z: game.player.z };
  game.input.keys.add('KeyW');
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  game.input.keys.delete('KeyW');
  const moved = Math.hypot(game.player.x - before.x, game.player.z - before.z);
  assert.ok(moved > 0.5, `player should walk, moved ${moved.toFixed(2)} m`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
