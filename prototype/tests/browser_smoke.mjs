// Optional end-to-end smoke test in a real browser. Needs two dev-only packages:
//   npm i --no-save puppeteer-core @sparticuz/chromium
// Then serve the folder and point BASE_URL at it:
//   python3 -m http.server 8123 --bind 0.0.0.0
//   BASE_URL=http://127.0.0.1:8123 node tests/browser_smoke.mjs
// It drives the intro, walks, enters a car, drives, types a cheat, cycles the
// clock and writes screenshots to tests/artifacts/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8123';
const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, 'artifacts');
mkdirSync(artifacts, { recursive: true });

let chromium;
let puppeteer;
try {
  chromium = (await import('@sparticuz/chromium')).default;
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.error('browser_smoke: install puppeteer-core and @sparticuz/chromium first (see the header).');
  process.exit(2);
}

const errors = [];
const logs = [];
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  const text = msg.text();
  logs.push(`${msg.type()}: ${text}`);
  if (msg.type() === 'error') errors.push(`console: ${text}`);
});

const shot = async (name) => {
  await page.screenshot({ path: join(artifacts, `${name}.png`) });
  console.log(`shot ${name}`);
};

const state = () => page.evaluate(() => {
  const g = window.__game;
  return {
    started: g?.started,
    paused: g?.paused,
    player: g ? { x: +g.player.x.toFixed(1), z: +g.player.z.toFixed(1), cash: g.player.cash } : null,
    inVehicle: g?.inVehicle,
    speed: g?.currentVehicle ? +g.currentVehicle.speed.toFixed(1) : 0,
    vehicles: g?.vehicles.size,
    fps: g ? +(1000 / g.frameTime).toFixed(1) : 0,
    drawCalls: g?.renderer.renderer.info.render.calls ?? 0,
    triangles: g?.renderer.renderer.info.render.triangles ?? 0,
    wanted: g?.player.wanted,
    weeds: !!g,
  };
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForFunction(() => !!window.__game, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot('01-title');

  await page.click('[data-do="start"]');
  await new Promise((r) => setTimeout(r, 2500));
  const running = await state();
  console.log('after start:', running);
  await shot('02-gameplay');

  // Walk forward for a second.
  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.up('KeyW');

  // Put the player beside the starter car, then enter it.
  await page.evaluate(() => {
    const g = window.__game;
    const car = [...g.vehicles.values()].find((v) => v.type === 'sports');
    if (car) { g.player.x = car.x + 2; g.player.z = car.z; }
  });
  await page.keyboard.press('KeyE');
  await new Promise((r) => setTimeout(r, 400));
  const inCar = await state();
  console.log('entered vehicle:', inCar);

  await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 2200));
  const driving = await state();
  console.log('driving:', driving);
  await shot('03-driving');
  await page.keyboard.up('KeyW');

  // Night pass.
  await page.evaluate(() => { window.__game.clock = 21.6; window.__game.weather = 'rain'; });
  await new Promise((r) => setTimeout(r, 1200));
  await shot('04-night-rain');

  // Cheat console.
  await page.evaluate(() => window.__game.openPanel('cheats'));
  await new Promise((r) => setTimeout(r, 300));
  await page.type('#cheat-input', 'aspirine');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 400));
  const cheatResult = await page.evaluate(() => document.getElementById('cheat-result').textContent);
  console.log('cheat result:', cheatResult);
  await shot('05-cheats');
  await page.evaluate(() => window.__game.hud.closePanels());

  // Phone panel to prove missions and property render.
  await page.evaluate(() => window.__game.openPanel('phone'));
  await new Promise((r) => setTimeout(r, 400));
  const jobCards = await page.evaluate(() => document.querySelectorAll('#tab-jobs .card').length);
  console.log('job cards:', jobCards);
  await shot('06-phone');
  await page.evaluate(() => window.__game.hud.closePanels());

  // Aerial pass: spawn the helicopter via cheat and climb.
  await page.evaluate(() => {
    const g = window.__game;
    g.applyCheat('AIRSHIP');
    const heli = [...g.vehicles.values()].find((v) => v.type === 'helicopter');
    if (heli) { g.player.x = heli.x; g.player.z = heli.z; g.enterVehicle(heli); }
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.down('Space');
  await new Promise((r) => setTimeout(r, 1800));
  await page.keyboard.up('Space');
  const flying = await page.evaluate(() => {
    const g = window.__game;
    return { type: g.currentVehicle?.type, y: g.currentVehicle?.y ?? 0, speed: g.currentVehicle?.speed ?? 0 };
  });
  console.log('flying:', flying);
  await shot('07-helicopter');

  const final = await state();
  console.log('final:', final);
  writeFileSync(join(artifacts, 'smoke.json'), JSON.stringify({ final, driving, flying, cheatResult, jobCards, errors, logs: logs.slice(-40) }, null, 2));

  if (!final.started) throw new Error('game did not start');
  if (!driving.inVehicle || driving.speed < 4) throw new Error(`car did not drive (speed ${driving.speed})`);
  if (!cheatResult.includes('ASPIRINE')) throw new Error('cheat console did not accept a code');
  if (jobCards < 1) throw new Error('phone did not list jobs');
  if (!(flying.y > 3)) throw new Error(`helicopter did not climb (y ${flying.y})`);
  if (final.drawCalls <= 0) throw new Error('renderer drew nothing');
  if (errors.length) throw new Error(`browser reported ${errors.length} error(s):\n${errors.join('\n')}`);
  console.log('\nbrowser smoke test passed');
} catch (err) {
  console.error('\nbrowser smoke test FAILED:', err.message);
  try { await shot('99-failure'); } catch { /* ignore */ }
  console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
