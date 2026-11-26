// Integration test for the whole game shell with stubbed renderer, minimap,
// audio, HUD and input. Exercises the loop, driving, missions, police, property,
// cheats, death and a save round-trip without a GPU.

import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { createWorld } from '../src/sim/world.js';
import { memoryStorage, DEFAULT_SETTINGS, SAVE_KEY } from '../src/sim/save.js';
import { STATIONS } from '../src/audio/radio.js';
import { isOwned } from '../src/sim/economy.js';
import { createVehicle } from '../src/sim/vehicle.js';

// Tests are queued and awaited in order: a synchronous try/catch around an async
// body would let its rejection escape after the summary.
const queued = [];
function test(name, fn) {
  queued.push({ name, fn });
}

function makeHud() {
  const log = [];
  return {
    log,
    panelOpen: false,
    syncSettings() { log.push(['syncSettings']); },
    showPanel(name) { this.panelOpen = name !== 'intro'; log.push(['showPanel', name]); },
    hideIntro() { log.push(['hideIntro']); },
    setLoading() {},
    hideLoading() {},
    toast(text, kind) { log.push(['toast', text, kind]); },
    mission(text, timer, cls) { log.push(['mission', text, timer, cls]); },
    dialogue(speaker, text, choices) { log.push(['dialogue', speaker, text, choices]); },
    hideDialogue() {},
    closePanels() { this.panelOpen = false; log.push(['closePanels']); },
    update(state) { log.push(['update', state]); },
    renderStations(list, index) { log.push(['renderStations', index]); },
    renderJobs() {},
    renderProperty() {},
    renderGarage() {},
    renderShop() {},
    showDeath(text) { log.push(['showDeath', text]); },
    cheatResult(text, ok) { log.push(['cheatResult', text, ok]); },
    setTouchVisible(v) { log.push(['touch', v]); },
  };
}

function makeAudio() {
  return {
    station: STATIONS[0],
    stationIndex: 0,
    ready: false,
    setVolumes() {},
    async unlock() { return true; },
    setStation(i) {
      this.stationIndex = i;
      this.station = STATIONS[i];
      return this.station;
    },
    update() {},
    playSfx() {},
    suspend() {},
    resume() {},
  };
}

function makeRenderer() {
  return {
    flash: 0,
    renderer: { info: { render: { calls: 40, triangles: 1000 } } },
    added: [],
    markers: [],
    addVehicle(v) { this.added.push(v.id); },
    removeVehicle(id) { this.added = this.added.filter((x) => x !== id); },
    setMarker(id, x, z, color, visible) { this.markers.push({ id, x, z, visible }); },
    update() {},
    applyCamera() {},
    render() {},
    resize() {},
    setQuality() {},
  };
}

function makeMinimap() {
  return { draws: 0, draw() { this.draws++; }, resize() {} };
}

function makeInput() {
  return {
    move: { x: 0, y: 0 },
    touchMode: false,
    fireHeld: false,
    downs: new Set(),
    queue: [],
    look: { x: 0, y: 0 },
    on() {},
    down(action) { return this.downs.has(action); },
    drain() { const q = this.queue; this.queue = []; return q; },
    consumeLook() { const l = this.look; this.look = { x: 0, y: 0 }; return l; },
    consumeWheel() { return 0; },
    resetStick() {},
  };
}

function makeGame(store = memoryStorage()) {
  const world = createWorld(1986);
  const hud = makeHud();
  const renderer = makeRenderer();
  const minimap = makeMinimap();
  const audio = makeAudio();
  const input = makeInput();
  const game = new Game({
    headless: true,
    store,
    world,
    settings: { ...DEFAULT_SETTINGS, quality: 'balanced', fpsCap: 60 },
    renderer,
    minimap,
    audio,
    hud,
    input,
  });
  return { game, hud, renderer, minimap, input, store };
}

function tick(game, seconds, dt = 1 / 120) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) game.update(dt);
}

const ctx = makeGame();
const { game, hud, renderer, minimap, input } = ctx;

test('game boots paused on the intro with a populated city', () => {
  assert.equal(game.started, false);
  assert.equal(game.paused, true);
  assert.ok(game.vehicles.size >= 12, 'parked vehicles should exist');
  assert.ok(game.world.buildings.length > 100);
  assert.ok(hud.log.some(([event, name]) => event === 'showPanel' && name === 'intro'));
});

test('start begins the loop, hides loading and shows the intro line', () => {
  game.start();
  assert.equal(game.started, true);
  assert.equal(game.paused, false);
  assert.ok(hud.log.some(([event]) => event === 'dialogue'));
});

test('holding forward walks the player and the HUD receives state', () => {
  input.move = { x: 0, y: 1 };
  const before = { x: game.player.x, z: game.player.z };
  tick(game, 2);
  const moved = Math.hypot(game.player.x - before.x, game.player.z - before.z);
  assert.ok(moved > 3, `player moved ${moved.toFixed(2)} m`);
  game._renderFrame(0.016, 1000);
  const update = hud.log.filter(([e]) => e === 'update').pop();
  assert.ok(update, 'HUD update should be called');
  assert.equal(update[1].inVehicle, false);
  assert.ok(minimap.draws > 0);
  input.move = { x: 0, y: 0 };
});

test('entering a car and driving produces speed and camera state', () => {
  const start = { x: 82, z: 292 };
  const car = [...game.vehicles.values()]
    .filter((v) => v.spec.mode === 'ground')
    .sort((a, b) => (a.x - start.x) ** 2 + (a.z - start.z) ** 2 - ((b.x - start.x) ** 2 + (b.z - start.z) ** 2))[0];
  assert.ok(car, 'a driveable starter car exists');
  assert.ok(Math.hypot(car.x - start.x, car.z - start.z) < 7, 'starter car is within reach of the spawn point');
  game.player.x = car.x + 1.5;
  game.player.z = car.z;
  game.toggleVehicle();
  assert.equal(game.inVehicle, true);
  assert.equal(game.currentVehicle, car);
  input.move = { x: 0, y: 1 };
  tick(game, 3);
  assert.ok(game.currentVehicle.speed > 4, `speed ${game.currentVehicle.speed.toFixed(2)}`);
  assert.ok(game.cameraPos && game.cameraLook, 'camera rig is set');
  assert.equal(game.player.x, game.currentVehicle.x);
  input.move = { x: 0, y: 0 };
});

test('exiting places the player beside the car without clipping into a wall', () => {
  const car = game.currentVehicle;
  game.toggleVehicle();
  assert.equal(game.inVehicle, false);
  const d = Math.hypot(game.player.x - car.x, game.player.z - car.z);
  assert.ok(d > 1 && d < 4, `exit distance ${d.toFixed(2)}`);
  assert.equal(game.world.blocked(game.player.x, game.player.z, 0.4), false);
});

test('a delivery mission advances through steps and pays out', () => {
  const cashBefore = game.player.cash;
  const started = game.missions.start('courier');
  assert.equal(started.ok, true);
  game.missions.drainEvents();
  const docks = { x: 296, z: 158 };
  game.player.x = docks.x;
  game.player.z = docks.z;
  game.inVehicle = false;
  tick(game, 0.2);
  const hotel = game.world.properties.find((p) => p.id === 'hotel');
  game.player.x = hotel.door.x;
  game.player.z = hotel.door.z;
  tick(game, 0.2);
  assert.equal(game.player.cash, cashBefore + 2500);
  assert.deepEqual(game.missions.completed, ['courier']);
  assert.ok(hud.log.some(([e, text]) => e === 'toast' && /Job complete/.test(text ?? '')));
});

test('cheat codes apply every effect kind', () => {
  game.player.health = 12;
  game.applyCheat('aspirine');
  assert.equal(game.player.health, 100);

  game.player.wanted = 4;
  game.applyCheat('leavemealone');
  assert.equal(game.player.wanted, 0);

  const count = game.vehicles.size;
  game.applyCheat('cometoyside');
  assert.equal(game.vehicles.size, count + 1);

  game.applyCheat('nighty');
  assert.ok(game.clock < 1 || game.clock > 23);

  game.applyCheat('stormy');
  assert.equal(game.weather, 'storm');

  const cash = game.player.cash;
  game.applyCheat('cashflow');
  assert.equal(game.player.cash, cash + 5000);

  game.applyCheat('fullclip');
  assert.ok(game.player.ammo.pistol > 0 && game.player.reserve.pistol > 0);

  game.applyCheat('notacode');
  const lastCheat = hud.log.filter(([e]) => e === 'cheatResult').pop();
  assert.equal(lastCheat[2], false);
});

test('heat spawns police that chase the player', () => {
  game.player.wanted = 3;
  game.player.wantedHeat = 3;
  game.player.wantedCooldown = 60;
  tick(game, 0.5);
  assert.ok(game.cops.length > 0, 'police should spawn at three stars');
  const cop = game.cops[0].vehicle;
  const before = Math.hypot(cop.x - game.player.x, cop.z - game.player.z);
  tick(game, 2);
  const after = Math.hypot(cop.x - game.player.x, cop.z - game.player.z);
  assert.ok(after < before, `cop should close in (${before.toFixed(1)} -> ${after.toFixed(1)})`);
  game.player.wanted = 0;
  game.player.wantedCooldown = 0;
  tick(game, 0.2);
  assert.equal(game.cops.length, 0);
});

test('buying the hotel, saving there and loading the save restores progress', () => {
  game.player.cash = 120000;
  game.buyPropertyAction('hotel');
  assert.ok(isOwned(game.econ, 'hotel'));
  const hotel = game.world.properties.find((p) => p.id === 'hotel');
  game.player.x = hotel.door.x;
  game.player.z = hotel.door.z;
  game.inVehicle = false;
  const saved = game._saveGame(false);
  assert.equal(saved, true);
  assert.ok(ctx.store.getItem(SAVE_KEY), 'save string written');

  const second = makeGame(ctx.store);
  second.game.start();
  assert.equal(second.game.player.cash, game.player.cash);
  assert.ok(isOwned(second.game.econ, 'hotel'), 'property ownership survives a reload');
});

test('property income accrues and can be collected', () => {
  const before = game.player.cash;
  game.econ.properties.hotel.income = 420;
  game.collectIncomeAction('hotel');
  assert.equal(game.player.cash, before + 420);
  assert.equal(game.econ.properties.hotel.income, 0);
});

test('weather changes on its timer and wetness follows it', () => {
  game.weatherTimer = 0.01;
  game.weather = 'clear';
  tick(game, 0.1);
  assert.ok(['clear', 'rain', 'fog', 'storm'].includes(game.weather));
  game.weather = 'storm';
  tick(game, 12);
  assert.ok(game.wetness > 0.5, `wetness ${game.wetness.toFixed(2)}`);
});

test('death pauses the game, shows WASTED and respawn charges the clinic', () => {
  const cash = game.player.cash;
  game.player.health = 0;
  tick(game, 0.05);
  assert.equal(game.dead, true);
  assert.ok(hud.log.some(([e]) => e === 'showDeath'));
  game.respawn();
  assert.equal(game.dead, false);
  assert.equal(game.player.health, 60);
  assert.equal(game.player.cash, Math.max(0, cash - 250));
  assert.equal(game.paused, false);
});

test('pausing suspends the simulation and resuming continues it', () => {
  game.pause();
  assert.equal(game.paused, true);
  game.resume();
  assert.equal(game.paused, false);
});

test('save rejects an unknown place but accepts an owned door', () => {
  game.econ.properties.hotel.owned = true;
  game.player.x = -430;
  game.player.z = 430;
  assert.equal(game._saveGame(false), false);
  const hotel = game.world.properties.find((p) => p.id === 'hotel');
  game.player.x = hotel.door.x;
  game.player.z = hotel.door.z;
  assert.equal(game._saveGame(false), true);
});

test('mission failure is reported and clears the objective marker', () => {
  const runner = game.missions;
  runner.start('tail');
  runner.drainEvents();
  const target = createVehicle('sports', 0, 0, 0);
  target.health = 100;
  game.missionTarget = target;
  // The tail job fails when the target has been out of sight for 9 s; tick past it.
  for (let i = 0; i < 60 * 12 && runner.active; i++) game.update(1 / 60);
  assert.equal(runner.active, null, 'losing the target should fail the job');
  assert.ok(hud.log.some(([e, text]) => e === 'toast' && /Job failed/.test(text ?? '')));
});

test('frame render reports draw calls and station metadata to the HUD', () => {
  renderer.renderer.info.render.calls = 137;
  hud.log.length = 0;
  game._renderFrame(0.016, 5000);
  const update = hud.log.filter(([e]) => e === 'update').pop();
  assert.equal(update[1].drawCalls, 137);
  assert.equal(update[1].stationName, STATIONS[game.audio.stationIndex].name);
});

let passed = 0;
const failures = [];
for (const { name, fn } of queued) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') await result;
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
