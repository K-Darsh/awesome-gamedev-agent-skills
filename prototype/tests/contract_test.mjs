// Static contract checks that do not need a browser: every DOM id the code
// looks up exists in index.html, every import resolves on disk, the vendored
// three.js exposes what the renderer uses, and every vehicle type builds.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

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

const html = readFileSync(join(root, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.html')) out.push(path);
  }
  return out;
}

const sources = walk(join(root, 'src')).concat([join(root, 'index.html')]);

test('every DOM id read by the game exists in index.html', () => {
  const referenced = new Map();
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      referenced.set(match[1], file);
    }
    for (const match of text.matchAll(/(?:\$|querySelector)\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) {
      referenced.set(match[1], file);
    }
  }
  const missing = [...referenced].filter(([id]) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `missing ids: ${missing.map(([id]) => id).join(', ')}`);
  assert.ok(referenced.size > 20, 'expected the HUD to look up many ids');
});

test('CSS hides touch controls until body.touch is set', () => {
  const css = readFileSync(join(root, 'styles.css'), 'utf8');
  assert.match(css, /#stick-zone[^}]*display:\s*none/);
  assert.match(css, /body\.touch\s+#stick-zone\s*\{\s*display:\s*block/);
  assert.match(css, /#buttons[^}]*display:\s*none/);
  assert.match(css, /body\.touch\s+#buttons\s*\{\s*display:\s*grid/);
});

test('every relative import resolves to a file', () => {
  const missing = [];
  for (const file of sources.filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]);
      try {
        statSync(target);
      } catch {
        missing.push(`${file} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('vendored three.js exposes every symbol the renderer imports', async () => {
  const THREE = await import('../vendor/three.module.js');
  const used = [
    'WebGLRenderer', 'Scene', 'PerspectiveCamera', 'Color', 'Fog', 'HemisphereLight', 'DirectionalLight',
    'AmbientLight', 'Object3D', 'InstancedMesh', 'Mesh', 'Group', 'BoxGeometry', 'PlaneGeometry',
    'CylinderGeometry', 'SphereGeometry', 'ConeGeometry', 'CapsuleGeometry', 'RingGeometry',
    'OctahedronGeometry', 'BufferGeometry', 'Float32BufferAttribute', 'BufferAttribute', 'Points',
    'PointsMaterial', 'Sprite', 'SpriteMaterial', 'MeshStandardMaterial', 'MeshBasicMaterial',
    'CanvasTexture', 'RepeatWrapping', 'DoubleSide', 'AdditiveBlending', 'PCFSoftShadowMap',
    'SRGBColorSpace', 'ACESFilmicToneMapping', 'DynamicDrawUsage',
  ];
  const missing = used.filter((name) => !(name in THREE));
  assert.deepEqual(missing, []);
});

test('all ten vehicle classes build meshes with the right number of wheels', async () => {
  const { VEHICLE_SPECS, VEHICLE_TYPES } = await import('../src/sim/vehicle.js');
  const { buildVehicle } = await import('../src/render/vehicles.js');
  assert.equal(VEHICLE_TYPES.length, 10);
  for (const type of VEHICLE_TYPES) {
    const { group, parts } = buildVehicle(type, VEHICLE_SPECS[type], '#ff0000');
    assert.ok(group.children.length > 0, `${type} produced an empty group`);
    if (type === 'bike' || type === 'scooter') assert.equal(parts.wheels.length, 2, type);
    else if (VEHICLE_SPECS[type].mode === 'ground') assert.equal(parts.wheels.length, 4, type);
    if (type === 'helicopter' || type === 'plane') assert.ok(parts.rotors.length >= 1, type);
  }
});

test('the renderer module loads without a DOM', async () => {
  const mod = await import('../src/render/scene.js');
  assert.equal(typeof mod.WorldRenderer, 'function');
  assert.ok(mod.WEATHER.storm.rain > mod.WEATHER.rain.rain);
});

test('audio and UI modules load and expose their classes', async () => {
  const audio = await import('../src/audio/radio.js');
  const hud = await import('../src/ui/hud.js');
  const input = await import('../src/ui/input.js');
  assert.equal(typeof audio.AudioEngine, 'function');
  assert.equal(audio.STATIONS.length, 5);
  assert.equal(typeof hud.HUD, 'function');
  assert.equal(typeof input.Input, 'function');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n${f.err.stack}`);
  process.exit(1);
}
