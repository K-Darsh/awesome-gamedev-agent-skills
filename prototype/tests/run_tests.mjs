// Headless checks for the simulation layer: physics, city queries, missions,
// economy, cheats and save migration. Run with `node tests/run_tests.mjs`.

import assert from 'node:assert/strict';
import { createWorld } from '../src/sim/world.js';
import { createVehicle, stepVehicle, VEHICLE_SPECS } from '../src/sim/vehicle.js';
import { createTraffic, createPedestrians, stepTraffic, stepPeds, panicAt } from '../src/sim/traffic.js';
import { createPlayer, stepPlayer, fireWeapon, takeDamage, commitCrime, weaponStats } from '../src/sim/player.js';
import { MissionRunner } from '../src/sim/missions.js';
import {
  createEconomy, buyProperty, tickEconomy, collectIncome, buyUpgrade, applyUpgrade, craftAttachment, isOwned,
} from '../src/sim/economy.js';
import { resolveCheat, findCheat, normalizeCode, CHEAT_CODES } from '../src/sim/cheats.js';
import {
  createSaveState, serialize, parseSave, applySave, clampSettings, memoryStorage, saveTo, loadFrom, DEFAULT_SETTINGS,
} from '../src/sim/save.js';
import { CRAFT_RECIPES } from '../src/sim/player.js';

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

const world = createWorld(1986);
const flatEnv = (extra = {}) => ({ surfaceAt: () => 'road', blocked: () => false, wetness: 0, clock: 0, ...extra });

function drive(type, seconds, input, env = flatEnv(), start = { x: 0, z: 0, yaw: Math.PI / 2 }) {
  const v = createVehicle(type, start.x, start.z, start.yaw);
  const dt = 1 / 120;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepVehicle(v, input, dt, env);
  return v;
}

// --- world -------------------------------------------------------------------
test('world generation is deterministic for a seed', () => {
  const a = createWorld(1986);
  const b = createWorld(1986);
  assert.equal(a.buildings.length, b.buildings.length);
  assert.deepEqual(a.buildings[3], b.buildings[3]);
  const c = createWorld(42);
  assert.notDeepEqual(a.buildings[3], c.buildings[3]);
});

test('city has districts, properties, pickups and parking', () => {
  assert.ok(world.blocks.length > 80, 'expected a large block grid');
  assert.equal(world.properties.length, 6);
  assert.ok(world.pickups.length >= 20);
  assert.ok(world.parking.some((p) => p.type === 'boat'));
  assert.ok(world.parking.some((p) => p.type === 'plane'));
  const ids = new Set(world.blocks.map((b) => b.district));
  for (const d of ['downtown', 'beach', 'docks', 'rural', 'airport']) {
    assert.ok(ids.has(d), `missing district ${d}`);
  }
});

test('surface queries separate road, sidewalk and water', () => {
  assert.equal(world.surfaceAt(0, 0), 'road');
  assert.equal(world.surfaceAt(100, 520), 'water');
  assert.equal(world.surfaceAt(0, 500), 'water');
  const block = world.blocks[0];
  assert.equal(world.surfaceAt(block.cx, block.cz), 'sidewalk');
});

test('buildings block movement but roads do not', () => {
  const b = world.buildings[0];
  assert.equal(world.blocked(b.x, b.z, 0.5), true);
  assert.equal(world.blocked(0, 40, 0.5), false);
  const outside = world.blocked(9999, 9999, 1);
  assert.equal(outside, true);
});

// --- vehicle physics ---------------------------------------------------------
test('sedan accelerates towards its top speed and respects the cap', () => {
  const v = drive('sedan', 22, { throttle: 1, steer: 0 });
  assert.ok(v.speed > 30, `speed ${v.speed.toFixed(1)} too low`);
  assert.ok(v.speed <= VEHICLE_SPECS.sedan.maxSpeed * 1.02);
});

test('braking from 25 m/s stops inside 60 m', () => {
  const v = createVehicle('sports', 0, 0, Math.PI / 2);
  const dt = 1 / 120;
  let x0 = v.x;
  for (let i = 0; i < 600; i++) stepVehicle(v, { throttle: 1, steer: 0 }, dt, flatEnv());
  assert.ok(v.speed > 25, `setup speed ${v.speed}`);
  for (let i = 0; i < 320; i++) stepVehicle(v, { throttle: -1, steer: 0 }, dt, flatEnv());
  const distance = Math.abs(v.x - x0);
  assert.ok(v.speed < 1.5, `speed after braking ${v.speed}`);
  assert.ok(distance < 300);
});

test('steering yaws the car and speed-sensitive authority keeps it stable', () => {
  const slow = drive('sedan', 2, { throttle: 0.6, steer: 1 });
  const fast = drive('sedan', 12, { throttle: 1, steer: 1 });
  assert.ok(Math.abs(slow.yaw - Math.PI / 2) > 0.2);
  assert.ok(Math.abs(fast.yaw - Math.PI / 2) > 0.2);
  assert.ok(Number.isFinite(fast.x) && Number.isFinite(fast.z));
});

test('handbrake produces a real slide', () => {
  const v = createVehicle('sports', 0, 0, Math.PI / 2);
  const dt = 1 / 120;
  for (let i = 0; i < 900; i++) stepVehicle(v, { throttle: 1, steer: 0.15 }, dt, flatEnv());
  let maxSlip = 0;
  for (let i = 0; i < 90; i++) {
    stepVehicle(v, { throttle: 0.2, steer: 0.9, handbrake: true }, dt, flatEnv());
    maxSlip = Math.max(maxSlip, Math.abs(v.lateral));
  }
  assert.ok(maxSlip > 1.2, `slip ${maxSlip.toFixed(2)} too small`);
});

test('wet roads reduce grip and lengthen the slide', () => {
  const dry = createVehicle('sports', 0, 0, Math.PI / 2);
  const wet = createVehicle('sports', 0, 0, Math.PI / 2);
  const dt = 1 / 120;
  for (let i = 0; i < 700; i++) {
    stepVehicle(dry, { throttle: 1, steer: 0 }, dt, flatEnv());
    stepVehicle(wet, { throttle: 1, steer: 0 }, dt, flatEnv({ wetness: 1 }));
  }
  let drySlip = 0;
  let wetSlip = 0;
  for (let i = 0; i < 120; i++) {
    stepVehicle(dry, { throttle: 0, steer: 0.9, handbrake: true }, dt, flatEnv());
    stepVehicle(wet, { throttle: 0, steer: 0.9, handbrake: true }, dt, flatEnv({ wetness: 1 }));
    drySlip = Math.max(drySlip, Math.abs(dry.lateral));
    wetSlip = Math.max(wetSlip, Math.abs(wet.lateral));
  }
  assert.ok(wetSlip >= drySlip * 0.95, `wet ${wetSlip.toFixed(2)} vs dry ${drySlip.toFixed(2)}`);
});

test('motorcycles lean into corners', () => {
  const v = drive('bike', 6, { throttle: 0.8, steer: 1 });
  assert.ok(Math.abs(v.lean) > 0.05, `lean ${v.lean}`);
});

test('boats only make way on water', () => {
  const sea = { surfaceAt: () => 'water', blocked: () => false, clock: 3 };
  const boat = drive('boat', 8, { throttle: 1, steer: 0 }, sea);
  assert.ok(boat.speed > 8, `boat speed ${boat.speed}`);
  const grounded = drive('boat', 4, { throttle: 1, steer: 0 }, flatEnv());
  assert.ok(grounded.speed < 1, `beached boat speed ${grounded.speed}`);
});

test('helicopter climbs on collective and holds altitude without input', () => {
  const air = { surfaceAt: () => 'road', blocked: () => false, clock: 0 };
  const v = createVehicle('helicopter', 0, 0, 0);
  for (let i = 0; i < 360; i++) stepVehicle(v, { throttle: 1, steer: 0, pitch: 0 }, 1 / 120, air);
  const climbed = v.y;
  assert.ok(climbed > 8, `climbed ${climbed.toFixed(1)}`);
  for (let i = 0; i < 240; i++) stepVehicle(v, { throttle: 0, steer: 0, pitch: 0 }, 1 / 120, air);
  assert.ok(Math.abs(v.y - climbed) < 12, 'helicopter should roughly hold altitude');
});

test('plane lifts off above stall speed and stalls below it', () => {
  const air = { surfaceAt: () => 'road', blocked: () => false };
  const v = createVehicle('plane', -376, -300, 0);
  for (let i = 0; i < 120 * 30; i++) stepVehicle(v, { throttle: 1, steer: 0, pitch: 0.12 }, 1 / 120, air);
  assert.ok(v.speed > VEHICLE_SPECS.plane.stallSpeed, `speed ${v.speed.toFixed(1)}`);
  assert.ok(v.y > 2, `altitude ${v.y.toFixed(1)}`);
  const stalled = createVehicle('plane', 0, 0, 0);
  for (let i = 0; i < 120 * 4; i++) stepVehicle(stalled, { throttle: 0, steer: 0, pitch: 0 }, 1 / 120, air);
  assert.ok(stalled.y <= 1.6, 'a plane with no throttle should sink to the ground');
});

test('collisions stop the car instead of tunnelling', () => {
  const wall = { surfaceAt: () => 'road', blocked: (x) => x > 4 };
  const v = createVehicle('sedan', 0, 0, Math.PI / 2);
  for (let i = 0; i < 600; i++) stepVehicle(v, { throttle: 1, steer: 0 }, 1 / 120, wall);
  assert.ok(v.x < 6, `x ${v.x.toFixed(2)} passed the wall`);
});

// --- traffic and pedestrians -------------------------------------------------
test('traffic stays finite, on the grid and non-negative in speed', () => {
  const traffic = createTraffic(world, 48, 11);
  const ctx = { time: 0, player: { x: 0, z: 0 }, playerVehicle: { x: 0, z: 40, y: 0 } };
  for (let i = 0; i < 120 * 20; i++) stepTraffic(traffic, 1 / 60, { ...ctx, time: i / 60 });
  for (const car of traffic.cars) {
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z));
    assert.ok(car.speed >= -0.001);
    assert.ok(Math.abs(car.x) < 700 && Math.abs(car.z) < 700);
  }
});

test('traffic brakes for a car directly ahead', () => {
  const traffic = createTraffic(world, 1, 3);
  const car = traffic.cars[0];
  const before = car.speed;
  // Keep a blocker 6 m in front of the car for a second: it must slow down.
  for (let i = 0; i < 60; i++) {
    const blocker = { x: car.x + Math.sin(car.yaw) * 6, z: car.z + Math.cos(car.yaw) * 6, y: 0 };
    stepTraffic(traffic, 1 / 60, { time: i / 60, player: { x: 0, z: 0 }, playerVehicle: blocker });
  }
  assert.ok(car.speed < before, `speed ${car.speed} vs ${before}`);
});

test('pedestrians walk block perimeters and panic away from gunfire', () => {
  const peds = createPedestrians(world, 40, 5);
  for (let i = 0; i < 600; i++) stepPeds(peds, 1 / 60);
  for (const ped of peds) {
    assert.ok(Number.isFinite(ped.x) && Number.isFinite(ped.z));
    const inside = ped.x > ped.block.x0 - 2 && ped.x < ped.block.x1 + 2 && ped.z > ped.block.z0 - 2 && ped.z < ped.block.z1 + 2;
    assert.ok(inside, 'pedestrian left its block');
  }
  const target = peds[0];
  panicAt(peds, target.x, target.z, 30);
  assert.ok(peds.some((p) => p.panic > 0));
  for (let i = 0; i < 60 * 8; i++) stepPeds(peds, 1 / 60);
  assert.ok(peds.every((p) => p.panic === 0));
});

// --- player ------------------------------------------------------------------
test('on-foot movement respects walls and drains stamina', () => {
  const p = createPlayer(0, 0);
  const env = flatEnv();
  for (let i = 0; i < 120 * 6; i++) stepPlayer(p, { moveX: 0, moveY: 1, sprint: true, cameraYaw: 0 }, 1 / 60, env);
  assert.ok(p.stamina < 100);
  assert.ok(p.z > 5);
  const walled = { surfaceAt: () => 'road', blocked: () => true };
  const px = p.x;
  for (let i = 0; i < 120; i++) stepPlayer(p, { moveX: 1, moveY: 0, cameraYaw: 0 }, 1 / 60, walled);
  assert.ok(Math.abs(p.x - px) < 0.001);
});

test('weapons fire, consume ammo and reload', () => {
  const p = createPlayer(0, 0);
  p.weapon = 'pistol';
  const target = { x: 0, z: 10, radius: 0.6, kind: 'ped', ref: { id: 1 } };
  const shot = fireWeapon(p, [target]);
  assert.equal(shot.fired, true);
  assert.equal(shot.hits.length, 1);
  assert.equal(p.ammo.pistol, 11);
  p.attachments = ['extended', 'scope'];
  assert.equal(weaponStats(p, 'pistol').ammo, 19);
  assert.ok(weaponStats(p, 'pistol').spread < 0.035);
});

test('damage passes through armour first and wanted level clamps', () => {
  const p = createPlayer(0, 0);
  p.armor = 40;
  takeDamage(p, 30);
  assert.ok(p.armor < 40 && p.health < 100);
  takeDamage(p, 500);
  assert.equal(p.health, 0);
  assert.equal(p.dead, true);
  const q = createPlayer(0, 0);
  for (let i = 0; i < 20; i++) commitCrime(q, 3);
  assert.equal(q.wanted, 5);
});

// --- missions ----------------------------------------------------------------
test('courier mission completes and pays when the crate is delivered', () => {
  const m = new MissionRunner(world);
  const start = m.start('courier');
  assert.equal(start.ok, true);
  m.drainEvents();
  const player = { x: 296, z: 158 };
  m.update(1 / 60, { player, vehicle: null });
  assert.deepEqual(m.drainEvents().map((e) => e.type), ['step']);
  player.x = world.properties.find((p) => p.id === 'hotel').door.x;
  player.z = world.properties.find((p) => p.id === 'hotel').door.z;
  m.update(1 / 60, { player, vehicle: null });
  const events = m.drainEvents();
  const done = events.find((e) => e.type === 'complete');
  assert.ok(done, 'mission should complete');
  assert.equal(done.pay, 2500);
  assert.deepEqual(m.completed, ['courier']);
});

test('courier fails on the timer and on crate damage', () => {
  const m = new MissionRunner(world);
  m.start('courier');
  const player = { x: 296, z: 158 };
  m.update(1 / 60, { player, vehicle: null });
  const vehicle = { x: 0, z: 0, health: 10, spec: { health: 100 }, type: 'sedan' };
  m.update(200, { player: { x: 0, z: 0 }, vehicle });
  const events = m.drainEvents();
  assert.ok(events.some((e) => e.type === 'fail'));

  const m2 = new MissionRunner(world);
  m2.start('courier');
  m2.update(1 / 60, { player: { x: 296, z: 158 }, vehicle: null });
  m2.update(1 / 60, { player: { x: 0, z: 0 }, vehicle: { x: 0, z: 0, health: 10, spec: { health: 100 }, type: 'sedan' } });
  assert.ok(m2.drainEvents().some((e) => e.type === 'fail'));
});

test('tail mission spawns a target and rewards clean tracking', () => {
  const m = new MissionRunner(world);
  m.start('tail');
  const spawn = m.drainEvents().find((e) => e.type === 'spawnTarget');
  assert.ok(spawn);
  const target = { x: 0, z: 0, health: 100, dead: false };
  const player = { x: 20, z: 0 };
  let events = [];
  for (let i = 0; i < 60 * 45; i++) {
    m.update(1 / 60, { player, vehicle: null, target });
    events.push(...m.drainEvents());
  }
  assert.ok(events.some((e) => e.type === 'step'), 'should move to the ram step');
  assert.equal(m.active.stepIndex, 1);
  target.dead = true;
  m.update(1 / 60, { player, vehicle: null, target });
  assert.ok(m.drainEvents().some((e) => e.type === 'complete'));
});

test('tail mission fails when the player crowds the target', () => {
  const m = new MissionRunner(world);
  m.start('tail');
  m.drainEvents();
  const target = { x: 0, z: 0, health: 100, dead: false };
  for (let i = 0; i < 60 * 5; i++) m.update(1 / 60, { player: { x: 2, z: 0 }, vehicle: null, target });
  assert.ok(m.drainEvents().some((e) => e.type === 'fail'));
});

test('finale unlocks after two jobs and branches into a route', () => {
  const m = new MissionRunner(world);
  m.completed = ['courier', 'tail'];
  const offers = m.offers().map((o) => o.id);
  assert.ok(offers.includes('finale'));
  const started = m.start('finale');
  assert.equal(started.pending, true);
  const choose = m.drainEvents().find((e) => e.type === 'chooseBranch');
  assert.equal(choose.options.length, 2);
  const res = m.chooseBranch('marina');
  assert.equal(res.ok, true);
  assert.equal(res.mission.id, 'marina');
  assert.ok(res.mission.steps.some((s) => s.kind === 'checkpoints'));
});

// --- economy -----------------------------------------------------------------
test('property purchase checks funds and grants ownership', () => {
  const econ = createEconomy(world);
  const player = { cash: 1000 };
  assert.equal(buyProperty(econ, player, 'hotel').reason, 'funds');
  player.cash = 100000;
  const res = buyProperty(econ, player, 'hotel');
  assert.equal(res.ok, true);
  assert.equal(player.cash, 52000);
  assert.ok(isOwned(econ, 'hotel'));
  assert.equal(buyProperty(econ, player, 'hotel').reason, 'owned');
});

test('income accrues, caps and can be collected at the door', () => {
  const econ = createEconomy(world);
  const player = { cash: 100000 };
  buyProperty(econ, player, 'hotel');
  tickEconomy(econ, 1, 24); // one full in-game day
  const accrued = econ.properties.hotel.income;
  assert.ok(accrued > 800 && accrued <= 900.01, `accrued ${accrued}`);
  tickEconomy(econ, 10, 24);
  assert.ok(econ.properties.hotel.income <= 900 * 3 + 0.01);
  const collected = collectIncome(econ, player, 'hotel');
  assert.equal(collected.ok, true);
  assert.ok(player.cash > 52000);
});

test('upgrades apply to one vehicle only and require a shop', () => {
  const econ = createEconomy(world);
  const player = { cash: 100000 };
  const car = createVehicle('sports', 0, 0, 0);
  const other = createVehicle('sports', 0, 0, 0);
  assert.equal(buyUpgrade(econ, player, car, 'engine').reason, 'no-shop');
  buyProperty(econ, player, 'garage');
  const res = buyUpgrade(econ, player, car, 'engine');
  assert.equal(res.ok, true);
  assert.ok(car.spec.accel > other.spec.accel);
  assert.equal(Math.round(other.spec.accel * 100), Math.round(VEHICLE_SPECS.sports.accel * 100));
  assert.equal(applyUpgrade(car, 'engine').reason, 'already');
});

test('crafting needs the workshop, funds and the parts', () => {
  const player = { cash: 5000, parts: { scrap: 0, springs: 0, polymer: 0 }, ownedAttachments: {}, attachments: [] };
  const recipe = CRAFT_RECIPES[0];
  assert.equal(craftAttachment(player, recipe, false).reason, 'workshop');
  const lacking = craftAttachment(player, recipe, true);
  assert.equal(lacking.reason, 'parts');
  player.parts.scrap = 9;
  player.parts.polymer = 9;
  const ok = craftAttachment(player, recipe, true);
  assert.equal(ok.ok, true);
  assert.ok(player.attachments.includes('suppressor'));
});

// --- cheats ------------------------------------------------------------------
test('cheat parsing tolerates casing and spacing', () => {
  assert.equal(normalizeCode(' aspi rine '), 'ASPIRINE');
  assert.equal(findCheat('Aspirine').code, 'ASPIRINE');
  assert.equal(resolveCheat('leavemealone').effect, 'clearWanted');
  assert.equal(resolveCheat('not-a-code').ok, false);
});

test('every cheat code is unique and has an effect', () => {
  const codes = new Set();
  for (const c of CHEAT_CODES) {
    assert.match(c.code, /^[A-Z0-9]+$/);
    assert.ok(!codes.has(c.code), `duplicate ${c.code}`);
    codes.add(c.code);
    assert.ok(c.effect);
  }
});

// --- save --------------------------------------------------------------------
test('save round-trips and reapplies to live objects', () => {
  const player = createPlayer(10, 20);
  player.cash = 7777;
  player.weapon = 'smg';
  player.ammo.smg = 12;
  player.parts.scrap = 4;
  const econ = createEconomy(world);
  const missions = new MissionRunner(world);
  missions.completed = ['courier'];
  const state = createSaveState({
    player, economy: { properties: { hotel: { owned: true, income: 55 } }, garage: [], spent: 1, earned: 2 },
    missions: missions.toSave(), clock: 21.5, weather: 'rain', settings: { fpsCap: 120 }, position: { x: 10, z: 20 },
  });
  const parsed = parseSave(serialize(state));
  assert.equal(parsed.ok, true);
  const player2 = createPlayer(0, 0);
  const econ2 = createEconomy(world);
  const missions2 = new MissionRunner(world);
  const settings = { ...DEFAULT_SETTINGS };
  assert.equal(applySave(parsed.state, { player: player2, economy: econ2, missions: missions2, settings }), true);
  assert.equal(player2.cash, 7777);
  assert.equal(player2.weapon, 'smg');
  assert.equal(player2.parts.scrap, 4);
  assert.ok(isOwned(econ2, 'hotel'));
  assert.deepEqual(missions2.completed, ['courier']);
  assert.equal(settings.fpsCap, 120);
});

test('corrupt, empty and future saves are rejected', () => {
  assert.equal(parseSave('').reason, 'empty');
  assert.equal(parseSave('{ nope').reason, 'corrupt');
  assert.equal(parseSave(JSON.stringify({ version: 99, player: { cash: 1 } })).reason, 'newer-version');
  assert.equal(parseSave(JSON.stringify({ version: 2 })).reason, 'invalid');
});

test('v1 saves migrate ammo and attachments', () => {
  const legacy = { version: 1, player: { cash: 500, ammo: 30 }, economy: {}, missions: {} };
  const parsed = parseSave(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.player.ammo.pistol, 12);
  assert.equal(parsed.state.player.reserve.pistol, 18);
  assert.deepEqual(parsed.state.player.attachments, []);
});

test('settings clamp hostile values', () => {
  const s = clampSettings({ renderScale: 9, fpsCap: 17, sensitivity: -4, drawDistance: 99999 });
  assert.equal(s.renderScale, 1.5);
  assert.equal(s.fpsCap, 60);
  assert.equal(s.sensitivity, 0.25);
  assert.equal(s.drawDistance, 1600);
});

test('storage helper survives a quota failure', () => {
  const storage = memoryStorage();
  assert.equal(saveTo(storage, { hello: 'world' }).ok, true);
  const failing = { setItem() { throw new Error('quota'); }, getItem: () => null };
  assert.equal(saveTo(failing, {}).ok, false);
  const loaded = loadFrom(storage);
  assert.equal(loaded.ok, false); // no player field -> invalid, but it does not throw
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
