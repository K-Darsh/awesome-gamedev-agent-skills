// DOM-level checks for the HUD and input layer using jsdom. This is the part of
// the game that a pure-logic test cannot reach. jsdom is a dev-only dependency:
//   npm i --no-save jsdom

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('dom_test: install jsdom first (npm i --no-save jsdom)');
  process.exit(2);
}

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.performance = window.performance;
globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.setPointerCapture = function () {};
window.HTMLElement.prototype.releasePointerCapture = function () {};
window.Element.prototype.scrollIntoView = function () {};

const { HUD } = await import('../src/ui/hud.js');
const { Input } = await import('../src/ui/input.js');
const { DEFAULT_SETTINGS } = await import('../src/sim/save.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

const calls = [];
const settings = { ...DEFAULT_SETTINGS, showFps: true, minimap: true };
const world = { properties: [], pickups: [], water: [], airport: { runway: {} }, rail: {}, blocks: [], roads: [] };
const hud = new HUD(world, {
  settings,
  onStart: () => calls.push('start'),
  onPause: () => calls.push('pause'),
  onResume: () => calls.push('resume'),
  onSave: () => calls.push('save'),
  onRestart: () => calls.push('restart'),
  onRespawn: () => calls.push('respawn'),
  onOpenPanel: (name) => calls.push(`panel:${name}`),
  onCheat: (code) => calls.push(`cheat:${code}`),
  onChoice: (id) => calls.push(`choice:${id}`),
  onSettings: (s, key) => calls.push(`setting:${key}`),
  onTouchToggle: (visible) => calls.push(`touch:${visible}`),
});

const $ = (sel) => window.document.querySelector(sel);

test('HUD constructor renders the intro panel and five wanted stars', () => {
  assert.ok($('#panel-intro').classList.contains('hidden') === false);
  assert.equal($('#wanted').children.length, 5);
});

test('HUD update writes every readout', () => {
  hud.update({
    cash: 12345, health: 63, armor: 21, wanted: 3, clock: 21.5, weather: 'rain', district: 'Vice Beach',
    fps: 58, drawCalls: 214, inVehicle: true, speed: 118, nitro: 40, stationName: 'Neon 88',
    stationTagline: 'synthwave', weapon: 'SMG', ammo: 12, reverse: false, airborne: false,
  });
  assert.equal($('#cash').textContent, '$12,345');
  assert.equal($('#clock').textContent, '21:30');
  assert.equal($('#weather').textContent, 'RAIN');
  assert.equal($('#speed-value').textContent, '118');
  assert.equal($('#health-fill').style.width, '63%');
  assert.equal($('#armor-fill').style.width, '21%');
  assert.equal($('#radio-station').textContent, 'Neon 88');
  assert.equal($('#speedo').classList.contains('hidden'), false);
  assert.equal($('#crosshair').classList.contains('hidden'), true);
  const lit = Array.from($('#wanted').children).filter((s) => s.classList.contains('on')).length;
  assert.equal(lit, 3);
});

test('objective, dialogue choices and toasts appear and dismiss', () => {
  hud.mission('Deliver the crate to Ocean View Hotel', 'time left 210s');
  assert.equal($('#mission-panel').classList.contains('hidden'), false);
  assert.match($('#mission-text').textContent, /Deliver/);
  hud.dialogue('Rosa', 'Pick a route.', [{ id: 'marina', label: 'Boat' }, { id: 'ruiz', label: 'Plane' }]);
  assert.equal($('#subtitle-choices').children.length, 2);
  $('#subtitle-choices button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(calls.includes('choice:marina'));
  hud.toast('Test toast', 'good');
  assert.ok(Array.from($('#toasts').children).some((t) => t.textContent === 'Test toast'));
  hud.mission('');
  assert.equal($('#mission-panel').classList.contains('hidden'), true);
});

test('panel navigation and the cheat console work', () => {
  hud.showPanel('phone');
  assert.equal($('#panel-layer').classList.contains('hidden'), false);
  assert.equal($('#panel-phone').classList.contains('hidden'), false);
  hud.showPanel('cheats');
  assert.equal($('#panel-cheats').classList.contains('hidden'), false);
  const input = $('#cheat-input');
  input.value = 'aspirine';
  $('#cheat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.ok(calls.includes('cheat:aspirine'), 'submit should hand the code to the game');
  assert.equal(input.value, '');
  hud.cheatResult('ASPIRINE — Full health', true);
  assert.match($('#cheat-result').textContent, /ASPIRINE/);
  hud.closePanels();
  assert.equal($('#panel-layer').classList.contains('hidden'), true);
});

test('settings inputs push changes back to the game', () => {
  hud.showPanel('settings');
  const render = $('#set-render');
  render.value = '0.75';
  render.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(settings.renderScale, 0.75);
  assert.ok(calls.includes('setting:renderScale'));
  const fps = $('#set-fps');
  fps.value = '120';
  fps.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(settings.fpsCap, 120);
  const shadows = $('#set-shadows');
  shadows.checked = false;
  shadows.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(settings.shadows, false);
});

test('job, property, garage and shop lists render with working actions', () => {
  const offers = [{
    id: 'courier', title: 'Sunset Courier', contact: 'Rosa', pay: 2500,
    blurb: 'Move a crate.', steps: [], finale: false,
  }];
  hud.renderJobs(offers, null, (id) => calls.push(`job:${id}`));
  assert.equal($('#tab-jobs').querySelectorAll('.card').length, 1);
  $('#tab-jobs button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(calls.includes('job:courier'));

  hud.renderProperty(
    [{ id: 'hotel', name: 'Ocean View Hotel', kind: 'hotel', price: 48000, income: 900, blurb: 'Beach landmark.', door: { x: 0, z: 0 } },
     { id: 'garage', name: 'Marquis Motors', kind: 'garage', price: 65000, income: 700, blurb: 'Ten cars.', door: { x: 1, z: 1 } }],
    new Set(['garage']), 50000,
    { onBuy: (id) => calls.push(`buy:${id}`), onCollect: (id) => calls.push(`collect:${id}`), onSave: () => calls.push('save'), onShop: (id) => calls.push(`shop:${id}`) },
  );
  assert.equal($('#tab-property').querySelectorAll('.card').length, 2);
  const buttons = Array.from($('#tab-property').querySelectorAll('button'));
  buttons.find((b) => b.textContent === 'Collect income').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(calls.includes('collect:garage'));

  hud.renderGarage([{ type: 'sports', upgrades: ['engine'], health: 90 }], { onSpawnStored: (i) => calls.push(`spawn:${i}`) });
  assert.equal($('#tab-garage').querySelectorAll('.card').length, 1);

  hud.renderShop({ title: 'Marquis Motors', sub: 'Working on the Marquis GT', rows: [
    { label: 'Engine tune', sub: 'performance · $3,800', actionLabel: 'Buy', onAction: () => calls.push('upgrade') },
  ] });
  assert.equal($('#panel-shop').classList.contains('hidden'), false);
  $('#shop-body button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.ok(calls.includes('upgrade'));
});

test('keyboard input produces movement and one-shot actions', () => {
  const canvas = window.document.getElementById('game');
  const input = new Input(canvas);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyD' }));
  const move = input.move;
  assert.ok(move.y > 0.5 && move.x > 0.5, `move ${JSON.stringify(move)}`);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyE' }));
  assert.ok(input.drain().includes('enter'));
  assert.deepEqual(input.drain(), []);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyD' }));
  assert.equal(input.move.x, 0);
  assert.equal(input.down('sprint'), false);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  assert.equal(input.down('sprint'), true);
});

test('typed keys in a text field do not drive the player', () => {
  const input = new Input(window.document.getElementById('game'));
  const cheat = $('#cheat-input');
  const event = new window.KeyboardEvent('keydown', { code: 'KeyW', bubbles: true });
  cheat.dispatchEvent(event);
  assert.equal(input.move.y, 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
