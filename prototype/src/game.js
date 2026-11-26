// Neon Coast — game shell: fixed-step simulation, third-person camera, vehicle
// entry/exit, missions, police, property, shops, cheats, saves, radio and HUD.
// Rendering lives in src/render, rules in src/sim, input in src/ui.

import { createWorld, propertyAt, CITY } from './sim/world.js';
import { createVehicle, stepVehicle, VEHICLE_SPECS } from './sim/vehicle.js';
import { createTraffic, stepTraffic, createPedestrians, stepPeds, panicAt } from './sim/traffic.js';
import {
  createPlayer, stepPlayer, fireWeapon, giveWeapon, takeDamage, heal, addArmor, commitCrime,
  reload, finishReload, weaponStats, WEAPONS, CRAFT_RECIPES, tickWanted,
} from './sim/player.js';
import { MissionRunner } from './sim/missions.js';
import {
  createEconomy, buyProperty, tickEconomy, collectIncome, canSaveAt, isOwned, ownsKind,
  buyUpgrade, craftAttachment, buyOutfit, storeVehicle, WARDROBE, VEHICLE_UPGRADES, propertyDef,
} from './sim/economy.js';
import { resolveCheat } from './sim/cheats.js';
import {
  DEFAULT_SETTINGS, clampSettings, createSaveState, saveTo, loadFrom, applySave, SETTINGS_KEY, memoryStorage,
} from './sim/save.js';
import { WorldRenderer, WEATHER } from './render/scene.js';
import { Minimap } from './render/minimap.js';
import { AudioEngine, STATIONS } from './audio/radio.js';
import { HUD } from './ui/hud.js';
import { Input } from './ui/input.js';
import { angleDelta, clamp, damp, dampAngle, formatMoney, makeRng } from './sim/util.js';

const DAY_SECONDS = 1200; // 20 real minutes per in-game day
const SIM_STEP = 1 / 120;

function storage() {
  try {
    const test = '__nc__';
    window.localStorage.setItem(test, '1');
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

export class Game {
  /**
   * @param {object} [options] injection points for tests: store, world, settings,
   * renderer, minimap, audio, hud, input, headless.
   */
  constructor(options = {}) {
    this.headless = !!options.headless;
    this.onFirstFrame = options.onFirstFrame ?? null;
    this._firstFrameDone = false;
    this.store = options.store ?? storage();
    this.settings = clampSettings(options.settings ?? this._loadSettings());
    this.world = options.world ?? createWorld(1986);
    this.player = createPlayer(82, 292);
    this.player.weapon = 'pistol';
    this.player.ammo.pistol = 12;
    this.player.cash = 1500;
    this.econ = createEconomy(this.world);
    this.missions = new MissionRunner(this.world);
    this.vehicles = new Map();
    this.cops = [];
    this.missionTarget = null;
    this.missionMarker = null;
    this.clock = 8.4;
    this.weather = 'clear';
    this.wetness = 0;
    this.weatherTimer = 150;
    this.weatherTransition = 0;
    this.inVehicle = false;
    this.currentVehicle = null;
    this.camYaw = Math.PI;
    this.camPitch = 0.24;
    this.camDist = 6.4;
    this.camFreeLook = 0;
    this.paused = true;
    this.started = false;
    this.dead = false;
    this.waypoint = null;
    this.lastHud = 0;
    this.lastMinimap = 0;
    this.frameTime = 16.7;
    this.fpsSamples = [];
    this.adaptTimer = 0;
    this.autosaveTimer = 0;
    this.rainSfxTimer = 0;
    this.drownedFor = 0;
    this.damageTimer = 0;
    this.toastCooldown = new Map();
    this.rng = makeRng(99);
    this.hoverProperty = null;
    this.time = 0;
    this.cameraShake = 0;
    this.traffic = createTraffic(this.world, 64, 11);
    this.peds = createPedestrians(this.world, 180, 5);
    const doc = typeof document !== 'undefined' ? document : null;
    const canvas = options.canvas ?? doc?.getElementById('game') ?? null;
    this.renderer = options.renderer ?? new WorldRenderer(canvas, this.world, this.settings);
    this.minimapCanvas = options.minimapCanvas ?? doc?.getElementById('minimap') ?? null;
    this.minimap = options.minimap ?? new Minimap(this.minimapCanvas, this.world);
    if (!options.minimap && this.minimapCanvas) {
      const width = this.minimapCanvas.getBoundingClientRect?.().width || 180;
      this.minimap.resize(Math.round(width));
    }
    this.audio = options.audio ?? new AudioEngine();
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    this.hud = options.hud ?? new HUD(this.world, this._hudHandlers());
    this.input = options.input ?? new Input(canvas);
    this._spawnParked();
    this._bindInput();
    this._bindWindow();
    this.hud.syncSettings();
    this.hud.showPanel('intro');
    if (!this.headless) this.hud.setLoading(0.2, 'Building the city…');
    if (!options.minimap) this._updateMinimapSize();
    if (!options.renderer) this.renderer.resize();
    this._last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._acc = 0;
  }

  _loadSettings() {
    try {
      const raw = this.store.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _saveSettings() {
    try {
      this.store.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode: settings just do not persist */
    }
  }

  _hudHandlers() {
    return {
      settings: this.settings,
      onStart: () => this.start(),
      onResume: () => this.resume(),
      onPause: () => this.pause(),
      onSave: () => this.saveGame(),
      onRestart: () => {
        window.location.href = window.location.pathname;
      },
      onRespawn: () => this.respawn(),
      onOpenPanel: (name) => this.openPanel(name),
      onCheat: (code) => this.applyCheat(code),
      onChoice: (id) => this.chooseBranch(id),
      onSettings: (settings, key) => this.applySettings(settings, key),
      onTouchToggle: (visible) => {
        this.settings.touchControls = visible;
        this._saveSettings();
      },
    };
  }

  _spawnParked() {
    for (const spot of this.world.parking) {
      const v = createVehicle(spot.type, spot.x, spot.z, spot.yaw);
      v.parkedAt = spot;
      v.color = v.color ?? null;
      this.vehicles.set(v.id, v);
      this.renderer.addVehicle(v);
    }
    // A sports car on the lane beside the start, so the first lesson is "press enter".
    const starter = createVehicle('sports', 76, 292, Math.PI);
    this.vehicles.set(starter.id, starter);
    this.renderer.addVehicle(starter);
  }

  _bindInput() {
    this.input.on('fire-held', () => this.audio.unlock());
    if (this.headless || typeof window === 'undefined') return;
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    this.input.on('pause', () => this.togglePause());
    this.input.on('phone', () => this.openPanel('phone'));
    this.input.on('cheat', () => this.openPanel('cheats'));
    this.input.on('radio', () => this.openPanel('radio'));
    this.input.on('help', () => this.openPanel('help'));
    this.input.on('settings', () => this.openPanel('settings'));
    this.input.on('map', () => this.openPanel('phone'));
  }

  _bindWindow() {
    if (this.headless || typeof window === 'undefined') return;
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this._updateMinimapSize();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause(true);
      }
    });
  }

  _updateMinimapSize() {
    const size = this.minimapCanvas.getBoundingClientRect().width || 180;
    this.minimap.resize(Math.round(size));
  }

  start() {
    const loaded = loadFrom(this.store);
    if (loaded.ok) {
      applySave(loaded.state, {
        player: this.player,
        economy: this.econ,
        missions: this.missions,
        settings: this.settings,
      });
      this.clock = Number(loaded.state.clock) || 8.4;
      if (loaded.state.position) {
        this.player.x = loaded.state.position.x;
        this.player.z = loaded.state.position.z;
      }
      this.weather = WEATHER[loaded.state.weather] ? loaded.state.weather : 'clear';
      this.hud.syncSettings();
      this.hud.toast('Save loaded. Welcome back.', 'good');
    } else {
      this.hud.toast('Welcome to Neon Coast. Press JOBS to take work.', 'good', 5200);
      this.hud.dialogue('Rosa Marín', 'You made it. The city is yours if you can keep it. Take a job when you are ready.');
    }
    this.paused = false;
    this.started = true;
    this._last = performance.now();
    this.hud.hideLoading();
    Promise.resolve(this.audio.unlock()).then(() => {
      this.audio.setStation(0);
      this.hud.renderStations(STATIONS, 0, (i) => this.setStation(i));
    });
  }

  pause(fromHidden = false) {
    if (!this.started) return;
    this.paused = true;
    this.input.resetStick();
    this.audio.suspend();
    if (!fromHidden) this.hud.showPanel('pause');
  }

  resume() {
    this.paused = false;
    this._last = performance.now();
    this.audio.resume();
  }

  togglePause() {
    if (!this.started) return;
    if (this.paused) {
      this.hud.closePanels();
      this.resume();
    } else {
      this.pause();
    }
  }

  openPanel(name) {
    if (!this.started) return;
    if (name === 'phone') this._renderPhone();
    if (name === 'radio') {
      this.hud.showPanel('radio');
      this.hud.renderStations(STATIONS, this.audio.stationIndex, (i) => this.setStation(i));
      return;
    }
    this.hud.showPanel(name);
    this.paused = true;
    this.audio.suspend();
  }

  applySettings(settings, key) {
    // Mutate in place: the HUD holds a reference to this settings object.
    const clamped = clampSettings(settings);
    for (const k of Object.keys(clamped)) settings[k] = clamped[k];
    this.settings = settings;
    this._saveSettings();
    this.renderer.setQuality(this.settings);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    if (key === 'joystickSize') {
      document.documentElement.style.setProperty('--stick-scale', String(this.settings.joystickSize));
    }
    if (key === 'quality') this._applyQualityPreset(this.settings.quality);
    this.hud.syncSettings();
  }

  _applyQualityPreset(preset) {
    const presets = {
      performance: { renderScale: 0.7, shadows: false, drawDistance: 520 },
      balanced: { renderScale: 1, shadows: true, drawDistance: 900 },
      quality: { renderScale: 1.25, shadows: true, drawDistance: 1400 },
    };
    const p = presets[preset];
    if (!p) return;
    Object.assign(this.settings, p);
    this.renderer.setQuality(this.settings);
    this.hud.syncSettings();
    this._saveSettings();
  }

  // --- loop ------------------------------------------------------------------

  run() {
    const loop = (now) => {
      const delta = Math.min(0.25, (now - this._last) / 1000);
      this._last = now;
      this.frameTime = this.frameTime * 0.9 + delta * 1000 * 0.1;
      if (this.started && !this.paused) {
        this._acc = Math.min(this._acc + delta, 0.2);
        let steps = 0;
        while (this._acc >= SIM_STEP && steps < 12) {
          this.update(SIM_STEP);
          this._acc -= SIM_STEP;
          steps++;
        }
      }
      this._renderFrame(delta, now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  update(dt) {
    this.time += dt;
    this.clock = (this.clock + (dt * 24) / DAY_SECONDS) % 24;
    this._updateWeather(dt);
    this._drainActions();
    const look = this.input.consumeLook();
    const sens = this.settings.sensitivity;
    if (look.x || look.y) {
      this.camYaw -= look.x * 0.0032 * sens;
      this.camPitch = clamp(this.camPitch + look.y * 0.0022 * sens, -0.15, 0.95);
      this.camFreeLook = 2.2;
    }
    this.camFreeLook = Math.max(0, this.camFreeLook - dt);
    const wheel = this.input.consumeWheel();
    if (wheel) this.camDist = clamp(this.camDist + wheel * 0.8, 3.4, 14);

    if (this.inVehicle && this.currentVehicle) this._updateDriving(dt);
    else this._updateOnFoot(dt);

    this._updateTrafficAndPeds(dt);
    this._updatePolice(dt);
    this._updateMissionVehicle(dt);
    this._updateMissions(dt);
    this._updatePickups(dt);
    this._updateProperties(dt);
    this._updatePlayerState(dt);
    tickEconomy(this.econ, dt, 1 / 60);
    this._updateCamera(dt);
    this.audio.update(dt, {
      speed: this.inVehicle ? this.currentVehicle.speed : Math.hypot(this.player.vx, this.player.vz),
      inVehicle: this.inVehicle,
      wanted: this.player.wanted,
      intensity: this.missions.active ? 0.5 : 0,
    });

    if (this.settings.quality === 'auto' || this.settings.fpsCap) this._adaptQuality(dt);
    this._maybeAutosave(dt);
  }

  _drainActions() {
    for (const action of this.input.drain()) {
      switch (action) {
        case 'enter':
          if (this.paused) break;
          this.toggleVehicle();
          break;
        case 'reload':
          if (this.inVehicle) this.cycleRadio();
          else if (reload(this.player)) this.audio.playSfx('reload');
          break;
        case 'radio':
          this.cycleRadio();
          break;
        case 'weapon1': this.selectWeapon('pistol'); break;
        case 'weapon2': this.selectWeapon('smg'); break;
        case 'weapon3': this.selectWeapon('shotgun'); break;
        case 'pause': this.togglePause(); break;
        case 'phone': this.openPanel('phone'); break;
        case 'cheat': this.openPanel('cheats'); break;
        case 'map': this.openPanel('phone'); break;
        case 'help': this.openPanel('help'); break;
        case 'settings': this.openPanel('settings'); break;
        default: break;
      }
    }
  }

  _updateOnFoot(dt) {
    const move = this.input.move;
    const sprint = this.input.down('sprint');
    this.player.y = 0;
    stepPlayer(this.player, {
      moveX: move.x,
      moveY: move.y,
      sprint,
      crouch: this.input.down('jump') && !this.input.down('fire'),
      cameraYaw: this.camYaw,
    }, dt, this.world);

    if (this.player.reloading <= 0 && this.player.pendingReload) finishReload(this.player);
    if (this.player.pendingReload && this.player.reloading <= 0) finishReload(this.player);

    const firing = this.input.down('fire') && this.input.touchMode ? true : this.input.down('fire');
    if (firing && this.player.weapon !== 'fists') {
      this.player.yaw = this.camYaw;
      this._fire();
    }
    const target = this._nearestEnterable();
    this.canEnter = !!target;
  }

  _fire() {
    const p = this.player;
    const stats = weaponStats(p);
    if (p.cooldown > 0 || p.reloading > 0) return;
    const targets = [];
    for (const ped of this.peds) {
      if (ped.dead || ped.stumble > 0) continue;
      const d = Math.hypot(ped.x - p.x, ped.z - p.z);
      if (d < (stats.range ?? 3)) targets.push({ x: ped.x, z: ped.z, radius: 0.55, kind: 'ped', ref: ped, dead: false });
    }
    for (const v of this.vehicles.values()) {
      const near = Math.hypot(v.x - p.x, v.z - p.z);
      if (near > 80) continue;
      targets.push({ x: v.x, z: v.z, radius: v.spec.r * 1.5, kind: 'car', ref: v, dead: v.dead });
    }
    if (this.missionTarget) {
      targets.push({ x: this.missionTarget.x, z: this.missionTarget.z, radius: 2.2, kind: 'car', ref: this.missionTarget, dead: this.missionTarget.dead });
    }
    const shot = fireWeapon(p, targets, 1, 0.02);
    if (!shot.fired) {
      if (shot.reason === 'empty') {
        this.audio.playSfx('empty');
        this.toast('Out of ammunition. R to reload.', 'bad', 1800);
      }
      return;
    }
    this.audio.playSfx(shot.suppressed ? 'suppressed' : 'gunshot');
    panicAt(this.peds, p.x, p.z, shot.suppressed ? 16 : 46);
    this.cameraShake = Math.max(this.cameraShake ?? 0, shot.melee ? 0.1 : 0.22);

    for (const hit of shot.hits) {
      if (hit.kind === 'ped') {
        hit.ref.stumble = 1.8;
        hit.ref.panic = Math.max(hit.ref.panic, 5);
        commitCrime(p, 1, 2);
        this.audio.playSfx('wanted');
        this.toast('That was a civilian. Heat is rising.', 'bad', 1800);
      } else if (hit.kind === 'car') {
        const v = hit.ref;
        v.health = Math.max(0, v.health - shot.damage);
        if (v.health <= 0) this._explodeVehicle(v);
        commitCrime(p, 1, 1);
      }
    }
  }

  _explodeVehicle(v) {
    v.dead = true;
    this.audio.playSfx('explosion');
    this.renderer.flash = 0.8;
    this.cameraShake = 1.2;
    const d = Math.hypot(v.x - this.player.x, v.z - this.player.z);
    if (d < 9) takeDamage(this.player, 55 - d * 4);
    for (const other of this.vehicles.values()) {
      if (other === v) continue;
      if (Math.hypot(other.x - v.x, other.z - v.z) < 7) other.health = Math.max(0, other.health - 60);
    }
    commitCrime(this.player, 2, 2);
    if (this.missionTarget === v) this.missionTarget.dead = true;
    setTimeout(() => {
      this.renderer.removeVehicle(v.id);
      this.vehicles.delete(v.id);
    }, 4000);
  }

  _updateDriving(dt) {
    const v = this.currentVehicle;
    const move = this.input.move;
    let throttle = move.y;
    let steer = move.x;
    let pitch = 0;
    let handbrake = this.input.down('jump');
    if (v.spec.mode === 'air') {
      if (this.world.surfaceAt(v.x, v.z) === 'water') this.drownedFor += dt;
      if (v.spec.stallSpeed != null) {
        // Aeroplane: forward is throttle, stick pitches, stick sideways banks.
        throttle = handbrake ? 0 : 1;
        pitch = move.y;
        steer = move.x;
      } else {
        pitch = move.y;
        throttle = this.input.down('jump') ? 1 : this.input.down('sprint') ? -1 : 0;
        steer = move.x;
        handbrake = false;
      }
    }
    const env = {
      surfaceAt: (x, z) => this.world.surfaceAt(x, z),
      blocked: (x, z, r) => this.world.blocked(x, z, r),
      wetness: this.wetness,
      clock: this.time,
    };
    if (v.nitro > 0 && this.input.down('sprint') && v.spec.mode === 'ground') {
      v.nitro = Math.max(0, v.nitro - dt * 22);
      throttle = Math.max(throttle, 0.6);
      v.spec.maxSpeed = (v.baseMaxSpeed ?? v.spec.maxSpeed) * 1.12;
    } else if (v.spec.mode === 'ground') {
      v.spec.maxSpeed = v.baseMaxSpeed ?? v.spec.maxSpeed;
    }
    this.player.x = v.x;
    this.player.z = v.z;
    this.player.y = v.y ?? 0;
    this.player.yaw = v.yaw;
    const events = stepVehicle(v, { throttle, steer, handbrake, pitch, boost: false }, dt, env);
    tickWanted(this.player, dt);
    if (events.collision > 8) {
      this.audio.playSfx(events.collision > 18 ? 'explosion' : 'crash');
      this.cameraShake = Math.min(1, events.collision / 30);
      if (this.currentVehicle.health <= 0) this._wreckCurrentVehicle();
    }
    if (events.inWater && v.spec.mode === 'ground') {
      this.drownedFor += dt;
      if (this.drownedFor > 1.6) {
        this.toast('The car is sinking. Get out!', 'bad', 2200);
        takeDamage(this.player, 18);
        this.exitVehicle(true);
        this.drownedFor = 0;
      }
    } else {
      this.drownedFor = Math.max(0, this.drownedFor - dt);
    }
    if (v.spec.mode !== 'air' && this.player.weapon && this.input.down('fire')) {
      this.player.yaw = v.yaw;
      this._fireFromVehicle(v);
    }
    if (v.spec.mode === 'ground' && Math.abs(v.speed) > 6) {
      for (const ped of this.peds) {
        if (ped.dead || ped.stumble > 0) continue;
        if (Math.hypot(ped.x - v.x, ped.z - v.z) < 2.2) {
          ped.stumble = 1.9;
          ped.panic = 6;
          commitCrime(this.player, 1, 2);
          this.toast('Careful — pedestrians are dodging you.', '', 1600);
        }
      }
    }
    if (this.input.touchMode) {
      // Touch fire is a held button too; handled above through input.down('fire').
    }
  }

  _fireFromVehicle(v) {
    const p = this.player;
    const stats = weaponStats(p);
    if (p.cooldown > 0) return;
    const targets = [];
    for (const car of this.traffic.cars) {
      targets.push({ x: car.x, z: car.z, radius: 1.4, kind: 'traffic', ref: car, dead: car.dead });
    }
    for (const cop of this.cops) {
      targets.push({ x: cop.vehicle.x, z: cop.vehicle.z, radius: 1.6, kind: 'car', ref: cop.vehicle, dead: cop.vehicle.dead });
    }
    for (const ped of this.peds) {
      targets.push({ x: ped.x, z: ped.z, radius: 0.5, kind: 'ped', ref: ped, dead: ped.dead });
    }
    p.rangeModifier = 0.8;
    const shot = fireWeapon(p, targets, 0.8, 0.01);
    if (!shot.fired) return;
    this.audio.playSfx(shot.suppressed ? 'suppressed' : 'gunshot');
    panicAt(this.peds, v.x, v.z, 40);
    this.cameraShake = 0.2;
    for (const hit of shot.hits) {
      if (hit.kind === 'ped') {
        hit.ref.stumble = 1.6;
        commitCrime(p, 1, 2);
      } else if (hit.kind === 'traffic') {
        hit.ref.speed = Math.max(0, hit.ref.speed - 6);
        hit.ref.panic = 4;
        commitCrime(p, 1, 1);
      } else if (hit.kind === 'car') {
        hit.ref.health = Math.max(0, hit.ref.health - shot.damage);
        if (hit.ref.health <= 0) this._explodeVehicle(hit.ref);
      }
    }
    void stats;
  }

  _wreckCurrentVehicle() {
    this.toast('The vehicle is wrecked.', 'bad');
    this.audio.playSfx('explosion');
    takeDamage(this.player, 30);
    this.exitVehicle(true);
  }

  _updatePlayerState(dt) {
    if (this.player.reloading <= 0 && this.player.pendingReload) finishReload(this.player);
    this.player.lastHurtAt = (this.player.lastHurtAt ?? 0) + dt;
    if (this.player.health <= 0 && !this.dead) {
      this.dead = true;
      this.pause(true);
      this.audio.playSfx('fail');
      this.hud.showDeath('You wake up outside the hospital. The bill is $250.');
    }
    if (this.player.wanted >= 2 && Math.random() < dt * 0.4) this.audio.playSfx('wanted');
    // Health slowly regenerates below 25 so a bad chase is survivable.
    if (this.player.health > 0 && this.player.health < 25) heal(this.player, dt * 1.2);
    if (this.damageTimer > 0) this.damageTimer = Math.max(0, this.damageTimer - dt);
  }

  _updateCamera(dt) {
    const target = this.inVehicle ? this.currentVehicle : this.player;
    if (this.inVehicle && this.camFreeLook <= 0) {
      this.camYaw = dampAngle(this.camYaw, target.yaw, 3.4, dt);
    } else if (!this.inVehicle && this.camFreeLook <= 0 && this.player.walking) {
      // Walking eases the camera behind the player instead of snapping it.
      this.camYaw = dampAngle(this.camYaw, this.player.yaw, 1.5, dt);
    }
    const height = this.inVehicle
      ? Math.max(2.6, target.spec.height * 1.5) + this.camPitch * 6
      : 1.9 + this.camPitch * 5;
    const dist = this.inVehicle
      ? Math.max(6.4, target.spec.length * 2.1) + this.camPitch * 4
      : this.camDist;
    const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    let cx = target.x - f.x * dist;
    let cz = target.z - f.z * dist;
    let cy = (target.y ?? 0) + height;
    // Keep the camera out of buildings by lifting it when the boom intersects one.
    if (this.world.blocked(cx, cz, 0.8)) {
      cy += 6;
      cx = target.x;
      cz = target.z;
    }
    const shake = this.cameraShake ?? 0;
    if (shake > 0.001) {
      cx += (Math.random() - 0.5) * shake * 0.5;
      cy += (Math.random() - 0.5) * shake * 0.5;
      this.cameraShake = Math.max(0, shake - dt * 2.2);
    }
    this.cameraPos = { x: cx, y: cy, z: cz };
    this.cameraLook = {
      x: target.x + f.x * 4,
      y: (target.y ?? 0) + (this.inVehicle ? target.spec.height * 0.7 : 1.5),
      z: target.z + f.z * 4,
    };
    this.cameraYaw = this.camYaw;
  }

  _updateTrafficAndPeds(dt) {
    const ctx = {
      time: this.time,
      player: { x: this.player.x, z: this.player.z },
      playerVehicle: this.inVehicle ? this.currentVehicle : null,
    };
    stepTraffic(this.traffic, dt, ctx);
    stepPeds(this.peds, dt, ctx);
    for (const ped of this.peds) {
      if (ped.stumble > 0) ped.stumble = Math.max(0, ped.stumble - dt);
      if (ped.dead) continue;
      if (this.input.down('fire') && ped.panic === 0 && Math.random() < 0.0002) panicAt(this.peds, this.player.x, this.player.z, 20);
    }
    if (this.inVehicle && this.currentVehicle.spec.mode === 'ground') {
      for (const car of this.traffic.cars) {
        if (car.speed > 4 && Math.hypot(car.x - this.currentVehicle.x, car.z - this.currentVehicle.z) < 2.6) {
          if (this.currentVehicle.lastImpactAt === undefined || this.time - this.currentVehicle.lastImpactAt > 0.5) {
            this.currentVehicle.lastImpactAt = this.time;
            takeDamage(this.player, 4);
            this.cameraShake = Math.max(this.cameraShake ?? 0, 0.25);
            this.audio.playSfx('crash');
            car.speed *= 0.3;
          }
        }
      }
    }
  }

  _updateMissions(dt) {
    if (this.missions.pendingBranch) return;
    const ctx = {
      player: { x: this.player.x, z: this.player.z },
      vehicle: this.inVehicle ? this.currentVehicle : null,
      target: this.missionTarget,
      wanted: this.player.wanted,
    };
    this.missions.update(dt, ctx);
    for (const event of this.missions.drainEvents()) this._handleMissionEvent(event);
    const marker = this.missions.marker();
    if (marker && !marker.following) {
      this.renderer.setMarker('mission', marker.x, marker.z, '#ffd166', true);
      this.missionMarker = marker;
    } else if (marker && marker.following && this.missionTarget) {
      this.renderer.setMarker('mission', this.missionTarget.x, this.missionTarget.z, '#ffd166', true);
      this.missionMarker = marker;
    } else {
      this.renderer.setMarker('mission', 0, 0, '#ffd166', false);
      this.missionMarker = null;
    }
    if (this.missionMarker) {
      const timer = this.missions.active?.def?.steps?.[this.missions.active.stepIndex]?.timeLimit
        ? `time left ${Math.max(0, Math.ceil(this.missions.active.def.steps[this.missions.active.stepIndex].timeLimit - this.missions.active.stepElapsed))}s`
        : this.missions.active?.def?.id === 'tail' ? `stay 12–48 m back` : '';
      let gap = '';
      if (this.missionMarker.following && this.missionTarget) {
        gap = `gap ${Math.round(Math.hypot(this.missionTarget.x - this.player.x, this.missionTarget.z - this.player.z))} m`;
      }
      this.hud.mission(this.missionMarker.label, [timer, gap].filter(Boolean).join(' · '));
    } else {
      this.hud.mission('');
    }
  }

  _handleMissionEvent(event) {
    switch (event.type) {
      case 'start':
        this.hud.toast(`Job started: ${event.mission.title}`, 'good');
        break;
      case 'step':
        this.hud.toast(event.step.label, '', 3600);
        break;
      case 'spawnTarget': {
        this._despawnMissionTarget();
        const v = createVehicle(event.vehicleType ?? 'sports', event.x, event.z, event.yaw ?? 0);
        v.health = 140;
        this.vehicles.set(v.id, v);
        this.renderer.addVehicle(v);
        this.missionTarget = v;
        this.missionVehicleAI = { waypoint: this._randomMissionWaypoint(), stuck: 0 };
        break;
      }
      case 'spawnTargetVehicle': {
        const v = createVehicle(event.type, event.x, event.z, event.yaw ?? 0);
        this.vehicles.set(v.id, v);
        this.renderer.addVehicle(v);
        break;
      }
      case 'tailStatus':
        this.hud.mission('Follow the coupe without being seen', `${Math.ceil(event.remaining)}s · gap ${Math.round(event.distance)} m`);
        if (event.exposure > 1.2) this.hud.mission('Back off — he is getting suspicious', `${Math.ceil(event.remaining)}s`, 'fail');
        break;
      case 'ramStatus':
        this.hud.mission('Force the coupe to stop', `target integrity ${Math.max(0, Math.round(event.health))}%`);
        break;
      case 'checkpoint':
        this.toast(`Checkpoint ${event.index}/${event.total}`, 'good', 1600);
        break;
      case 'complete':
        this.player.cash += event.pay;
        this.audio.playSfx('success');
        this.hud.mission('');
        this.hud.toast(`Job complete: ${event.mission.title} · +${formatMoney(event.pay)}`, 'good', 5000);
        this.hud.dialogue(event.mission.contact, 'Clean work. The money is on its way. There is more where that came from.');
        this.renderer.setMarker('mission', 0, 0, '#ffd166', false);
        this._despawnMissionTarget();
        this._saveGame(true);
        break;
      case 'fail':
        this.audio.playSfx('fail');
        this.hud.mission('');
        this.hud.toast(`Job failed: ${event.reason}`, 'bad', 5000);
        this.renderer.setMarker('mission', 0, 0, '#ffd166', false);
        this._despawnMissionTarget();
        break;
      case 'chooseBranch':
        this.hud.dialogue('The Marina', 'Two ways out tonight. Rosa has a boat; Ruiz has a plane. Pick one and commit.', event.options);
        break;
      default:
        break;
    }
  }

  _despawnMissionTarget() {
    if (!this.missionTarget) return;
    this.renderer.removeVehicle(this.missionTarget.id);
    this.vehicles.delete(this.missionTarget.id);
    this.missionTarget = null;
  }

  _randomMissionWaypoint() {
    const lines = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);
    const x = lines[Math.floor(this.rng() * lines.length)];
    const z = lines[Math.floor(this.rng() * lines.length)];
    return { x, z };
  }

  _updateMissionVehicle(dt) {
    const target = this.missionTarget;
    if (!target || target.dead) return;
    const ai = this.missionVehicleAI ?? (this.missionVehicleAI = { waypoint: this._randomMissionWaypoint() });
    if (!ai.waypoint || Math.hypot(ai.waypoint.x - target.x, ai.waypoint.z - target.z) < 12) {
      ai.waypoint = this._randomMissionWaypoint();
    }
    const desired = Math.atan2(ai.waypoint.x - target.x, ai.waypoint.z - target.z);
    const diff = angleDelta(target.yaw, desired);
    const input = { throttle: 0.55, steer: clamp(diff * 1.6, -1, 1), handbrake: false };
    const env = {
      surfaceAt: (x, z) => this.world.surfaceAt(x, z),
      blocked: (x, z, r) => this.world.blocked(x, z, r),
      wetness: this.wetness,
    };
    stepVehicle(target, input, dt, env);
    if (target.health <= 0 && !target.dead) {
      target.dead = true;
      this._explodeVehicle(target);
    }
    void ai;
  }

  _updatePolice(dt) {
    const wanted = this.player.wanted;
    if (wanted >= 2) {
      const desiredCops = Math.min(4, wanted - 1);
      if (this.cops.length < desiredCops) this._spawnCop();
    }
    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      const v = cop.vehicle;
      const dist = Math.hypot(v.x - this.player.x, v.z - this.player.z);
      if (wanted === 0 || dist > 340 || v.dead) {
        this.renderer.removeVehicle(v.id);
        this.vehicles.delete(v.id);
        this.cops.splice(i, 1);
        continue;
      }
      const desired = Math.atan2(this.player.x - v.x, this.player.z - v.z);
      const diff = angleDelta(v.yaw, desired);
      const input = {
        throttle: dist > 10 ? 1 : 0.2,
        steer: clamp(diff * 1.8, -1, 1),
        handbrake: false,
      };
      stepVehicle(v, input, dt, {
        surfaceAt: (x, z) => this.world.surfaceAt(x, z),
        blocked: (x, z, r) => this.world.blocked(x, z, r),
        wetness: this.wetness,
      });
      if (dist < 3.2) {
        cop.hitTimer = (cop.hitTimer ?? 0) - dt;
        if (cop.hitTimer <= 0) {
          cop.hitTimer = 1.1;
          takeDamage(this.player, 6);
          this.cameraShake = Math.max(this.cameraShake ?? 0, 0.3);
          this.damageTimer = 1;
          if (this.inVehicle && this.currentVehicle) {
            this.currentVehicle.health = Math.max(0, this.currentVehicle.health - 4);
          }
        }
      }
    }
  }

  _spawnCop() {
    const angle = this.rng() * Math.PI * 2;
    const dist = 150 + this.rng() * 40;
    const x = clamp(this.player.x + Math.cos(angle) * dist, -CITY.half + 20, CITY.half - 20);
    const z = clamp(this.player.z + Math.sin(angle) * dist, -CITY.half + 20, CITY.half - 20);
    const v = createVehicle('police', x, z, Math.atan2(this.player.x - x, this.player.z - z));
    this.vehicles.set(v.id, v);
    this.renderer.addVehicle(v);
    this.cops.push({ vehicle: v, hitTimer: 1 });
    this.audio.playSfx('wanted');
  }

  _updatePickups(dt) {
    for (const pickup of this.world.pickups) {
      if (!pickup.active) {
        pickup.respawnAt -= dt;
        if (pickup.respawnAt <= 0) pickup.active = true;
        continue;
      }
      if (Math.hypot(pickup.x - this.player.x, pickup.z - this.player.z) > 2.2) continue;
      if (this.inVehicle) continue;
      pickup.active = false;
      pickup.respawnAt = 75;
      switch (pickup.type) {
        case 'health':
          heal(this.player, 40);
          this.audio.playSfx('health');
          this.hud.toast('Health +40', 'good', 1400);
          break;
        case 'armor':
          addArmor(this.player, 35);
          this.audio.playSfx('pickup');
          this.hud.toast('Armour +35', 'good', 1400);
          break;
        case 'scrap':
          this.player.parts.scrap += 2;
          this.player.parts.springs += Math.random() < 0.4 ? 1 : 0;
          this.player.parts.polymer += Math.random() < 0.3 ? 1 : 0;
          this.audio.playSfx('pickup');
          this.hud.toast('Parts collected', '', 1200);
          break;
        case 'weapon':
          giveWeapon(this.player, pickup.weapon ?? 'pistol', 24);
          this.audio.playSfx('pickup');
          this.hud.toast(`Picked up ${pickup.weapon ?? 'pistol'}`, 'good', 1600);
          break;
        default:
          break;
      }
    }
  }

  _updateProperties(dt) {
    const prop = propertyAt(this.world, this.player.x, this.player.z, 9);
    if (prop) {
      if (this.hoverProperty !== prop) {
        this.hoverProperty = prop;
        const owned = isOwned(this.econ, prop.id);
        if (owned) {
          const income = Math.floor(this.econ.properties[prop.id].income);
          this.toast(`${prop.name} · yours${income > 10 ? ` · ${formatMoney(income)} ready` : ''}`, 'good', 2600);
        } else {
          this.toast(`${prop.name} · ${formatMoney(prop.price)} · open JOBS > Property`, '', 3000);
        }
      }
    } else if (this.hoverProperty) {
      this.hoverProperty = null;
    }
    this.econNearby = prop;
    if (this.econNearby && isOwned(this.econ, this.econNearby.id) && this.inVehicle && this.currentVehicle.speed < 1) {
      // Standing still at a garage you own offers to store the car.
      this.canStoreHere = this.econNearby.kind === 'garage' || this.econNearby.kind === 'safehouse';
    } else {
      this.canStoreHere = false;
    }
    void dt;
  }

  _updateWeather(dt) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 180 + this.rng() * 180;
      const roll = this.rng();
      const next = roll < 0.5 ? 'clear' : roll < 0.76 ? 'rain' : roll < 0.9 ? 'fog' : 'storm';
      if (next !== this.weather) {
        this.weather = next;
        this.hud.toast(`Weather turning: ${next}`, '', 3200);
        if (next === 'storm') this.audio.playSfx('thunder');
      }
    }
    this.wetness = damp(this.wetness, WEATHER[this.weather]?.wet ?? 0, 0.25, dt);
  }

  _adaptQuality(dt) {
    this.adaptTimer += dt;
    if (this.adaptTimer < 2) return;
    this.adaptTimer = 0;
    const targetMs = 1000 / Math.min(this.settings.fpsCap, 120);
    const over = this.frameTime > targetMs * 1.35;
    const under = this.frameTime < targetMs * 0.72;
    if (this.settings.quality === 'auto') {
      if (over && this.settings.renderScale > 0.62) {
        this.settings.renderScale = Math.round((this.settings.renderScale - 0.08) * 20) / 20;
        this.renderer.setQuality(this.settings);
        this.hud.syncSettings();
      } else if (under && this.settings.renderScale < 1.05) {
        this.settings.renderScale = Math.round((this.settings.renderScale + 0.04) * 20) / 20;
        this.renderer.setQuality(this.settings);
        this.hud.syncSettings();
      }
    }
  }

  _maybeAutosave(dt) {
    this.autosaveTimer += dt;
    if (this.autosaveTimer < 120) return;
    this.autosaveTimer = 0;
    if (this.econNearby && isOwned(this.econ, this.econNearby.id)) this._saveGame(true);
  }

  // --- vehicle entry/exit ------------------------------------------------------

  _nearestEnterable() {
    let best = null;
    let bestD = 49; // 7 m squared
    for (const v of this.vehicles.values()) {
      if (v.dead) continue;
      if (v.spec.mode === 'water' && this.player.y > 1) continue;
      const d = (v.x - this.player.x) ** 2 + (v.z - this.player.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  toggleVehicle() {
    if (this.inVehicle) this.exitVehicle();
    else {
      const v = this._nearestEnterable();
      if (!v) {
        this.toast('No vehicle in reach.', '', 1500);
        return;
      }
      this.enterVehicle(v);
    }
  }

  enterVehicle(v) {
    if (v.dead) {
      this.toast('That vehicle is wrecked.', 'bad', 1600);
      return;
    }
    this.inVehicle = true;
    this.currentVehicle = v;
    v.baseMaxSpeed = v.baseMaxSpeed ?? v.spec.maxSpeed;
    v.occupied = true;
    this.player.x = v.x;
    this.player.z = v.z;
    this.camYaw = v.yaw;
    this.audio.playSfx('ui_click');
    if (v.spec.mode === 'water') this.toast(`${v.spec.name} — throttle with the stick, steer with A/D.`, '', 2800);
    else if (v.spec.body === 'plane') this.toast(`${v.spec.name} — full throttle and pull up gently.`, '', 3000);
    else if (v.spec.body === 'helo') this.toast(`${v.spec.name} — JUMP climbs, BRAKE descends.`, '', 3000);
    else this.toast(v.spec.name, '', 1600);
  }

  exitVehicle(force = false) {
    const v = this.currentVehicle;
    if (!v) return;
    const side = { x: Math.cos(v.yaw) * 2.4, z: -Math.sin(v.yaw) * 2.4 };
    let x = v.x + side.x;
    let z = v.z + side.z;
    if (this.world.blocked(x, z, 0.5)) {
      x = v.x - side.x;
      z = v.z - side.z;
    }
    if (this.world.blocked(x, z, 0.5) && !force) {
      this.toast('No room to get out here.', '', 1600);
      return;
    }
    this.inVehicle = false;
    v.occupied = false;
    this.currentVehicle = null;
    this.player.x = x;
    this.player.z = z;
    this.player.vx = 0;
    this.player.vz = 0;
    this.drownedFor = 0;
  }

  _renderPhone() {
    const offers = this.missions.offers();
    this.hud.renderJobs(offers, this.missions.active?.def ?? null, (id) => {
      const res = this.missions.start(id);
      if (!res.ok) {
        this.toast('You cannot start that job yet.', 'bad');
        return;
      }
      this.hud.closePanels();
      this.resume();
      if (!res.pending) this.hud.toast(`Job started: ${res.mission.title}`, 'good');
    });
    const ownedIds = new Set(Object.entries(this.econ.properties).filter(([, s]) => s.owned).map(([id]) => id));
    this.hud.renderProperty(this.world.properties, ownedIds, this.player.cash, {
      onBuy: (id) => this.buyPropertyAction(id),
      onCollect: (id) => this.collectIncomeAction(id),
      onSave: () => this.saveGame(),
      onShop: (id) => this.openShop(id),
    });
    this.hud.renderGarage(this.econ.garage, {
      onSpawnStored: (index) => this.bringOutStored(index),
    });
  }

  buyPropertyAction(id) {
    const result = buyProperty(this.econ, this.player, id);
    if (!result.ok) {
      this.toast(result.reason === 'funds' ? `Need ${formatMoney(result.short)} more.` : 'Cannot buy that.', 'bad');
      return;
    }
    this.audio.playSfx('money');
    this.toast(`Bought ${result.property.name}. ${result.property.income ? 'Income starts now.' : 'You can save here.'}`, 'good', 4200);
    if (result.property.kind === 'garage' || result.property.kind === 'workshop') {
      this.hud.dialogue('Marco Bell', 'Keys are yours. Bring me a car worth tuning and we will make it loud.');
    }
    this._saveGame(true);
    this._renderPhone();
  }

  collectIncomeAction(id) {
    const result = collectIncome(this.econ, this.player, id);
    if (!result.ok) {
      this.toast(result.reason === 'empty' ? 'Nothing collected yet. Come back later.' : 'Cannot collect here.', '', 2200);
      return;
    }
    this.audio.playSfx('money');
    this.toast(`Collected ${formatMoney(result.amount)}`, 'good');
    this._renderPhone();
  }

  openShop(propertyId) {
    const def = propertyDef(this.world, propertyId);
    if (!def) return;
    if (def.kind === 'garage' || def.kind === 'workshop') {
      const v = this.currentVehicle;
      if (!v) {
        this.toast('Sit in a vehicle to buy upgrades.', '', 2200);
        return;
      }
      this._renderGarageShop(def, v);
      return;
    }
    if (def.kind === 'clothes') {
      const rows = WARDROBE.map((outfit) => ({
        label: outfit.name,
        sub: this.player.outfits.includes(outfit.name) ? 'Owned' : formatMoney(outfit.price),
        actionLabel: this.player.outfit === outfit.name ? 'Wearing' : 'Wear',
        disabled: this.player.outfit === outfit.name || (!this.player.outfits.includes(outfit.name) && this.player.cash < outfit.price),
        primary: true,
        onAction: () => {
          const res = buyOutfit(this.econ, this.player, outfit.id);
          if (!res.ok) this.toast('Not enough cash.', 'bad');
          else {
            this.audio.playSfx('pickup');
            this.toast(`Wearing ${outfit.name}`, 'good');
            this.openShop(propertyId);
          }
        },
      }));
      this.hud.renderShop({ title: 'Neon Threads', sub: 'Wardrobe · changes your on-foot look', rows });
      return;
    }
    // Hotel / resort: rest and save.
    this.hud.renderShop({
      title: def.name,
      sub: 'Rest until morning, then save your progress.',
      rows: [{
        label: 'Sleep until 07:00',
        sub: `Wetness of the night clears. Cash ${formatMoney(this.player.cash)}.`,
        actionLabel: 'Sleep & save',
        primary: true,
        onAction: () => {
          this.clock = 7;
          heal(this.player, 100);
          this.player.stamina = 100;
          this.audio.playSfx('save');
          this._saveGame(true);
          this.toast('Slept until morning. Game saved.', 'good');
          this.hud.closePanels();
          this.resume();
        },
      }],
    });
  }

  _renderGarageShop(def, v) {
    const rows = Object.entries(VEHICLE_UPGRADES).map(([id, up]) => ({
      label: up.name,
      sub: `${up.kind} · ${formatMoney(up.cost)}${v.upgrades?.includes(id) ? ' · fitted' : ''}`,
      actionLabel: v.upgrades?.includes(id) ? 'Fitted' : 'Buy',
      disabled: v.upgrades?.includes(id) || this.player.cash < up.cost,
      primary: true,
      onAction: () => {
        const res = buyUpgrade(this.econ, this.player, v, id);
        if (!res.ok) this.toast('Cannot fit that here.', 'bad');
        else {
          this.audio.playSfx('money');
          this.toast(`${up.name} fitted to the ${v.spec.name}.`, 'good');
          this._renderGarageShop(def, v);
        }
      },
    }));
    if (def.kind === 'workshop') {
      for (const recipe of CRAFT_RECIPES) {
        const owned = !!this.player.ownedAttachments[recipe.id];
        rows.push({
          label: `Craft ${recipe.name}`,
          sub: `${formatMoney(recipe.cost)} · ${Object.entries(recipe.parts).map(([k, q]) => `${q} ${k}`).join(', ')}`,
          actionLabel: owned ? 'Owned' : 'Craft',
          disabled: owned || this.player.cash < recipe.cost,
          onAction: () => {
            const res = craftAttachment(this.player, recipe, ownsKind(this.econ, 'workshop'));
            if (!res.ok) {
              this.toast(res.reason === 'parts' ? `Missing ${res.part}.` : 'Cannot craft that yet.', 'bad');
              return;
            }
            this.audio.playSfx('pickup');
            this.toast(`${recipe.name} crafted.`, 'good');
            this._renderGarageShop(def, v);
          },
        });
      }
    }
    if (def.kind === 'garage') {
      rows.push({
        label: 'Store this vehicle',
        sub: `${this.econ.garage.length}/10 spaces used`,
        actionLabel: 'Store',
        disabled: this.econ.garage.length >= 10,
        onAction: () => {
          const res = storeVehicle(this.econ, v);
          if (!res.ok) this.toast('The garage is full.', 'bad');
          else {
            this.audio.playSfx('save');
            this.toast('Vehicle stored.', 'good');
            this.hud.closePanels();
            this._renderGarageShop(def, v);
          }
        },
      });
    }
    this.hud.renderShop({ title: `${def.name}`, sub: `Working on the ${v.spec.name}`, rows });
  }

  bringOutStored(index) {
    const saved = this.econ.garage[index];
    if (!saved) return;
    const prop = this.world.properties.find((p) => p.kind === 'garage' && isOwned(this.econ, p.id));
    const x = prop ? prop.door.x : this.player.x + 4;
    const z = prop ? prop.door.z + 4 : this.player.z + 4;
    const v = createVehicle(saved.type, x, z, 0);
    for (const upgrade of saved.upgrades ?? []) {
      const def = VEHICLE_UPGRADES[upgrade];
      if (!def) continue;
      v.upgrades = [...(v.upgrades ?? []), upgrade];
      if (def.grip) v.spec.grip += def.grip;
      if (def.accel) v.spec.accel *= def.accel;
      if (def.topSpeed) v.spec.maxSpeed *= def.topSpeed;
      if (def.health) v.spec.health += def.health;
      if (def.nitro) v.nitro = 100;
    }
    this.econ.garage.splice(index, 1);
    this.vehicles.set(v.id, v);
    this.renderer.addVehicle(v);
    this.toast(`${v.spec.name} is outside.`, 'good');
    this.hud.closePanels();
    this.resume();
  }

  chooseBranch(id) {
    const res = this.missions.chooseBranch(id);
    if (!res.ok) return;
    this.hud.closePanels();
    this.resume();
    this.hud.toast(`${res.mission.title}`, 'good', 4000);
  }

  selectWeapon(id) {
    const weapon = WEAPONS[id];
    if (!weapon) return;
    if (!weapon.melee && (this.player.reserve[id] ?? 0) + (this.player.ammo[id] ?? 0) <= 0) {
      this.toast(`No ${weapon.name.toLowerCase()} ammunition yet.`, '', 1800);
      return;
    }
    this.player.weapon = id;
    this.audio.playSfx('ui_click');
    this.toast(weapon.name, '', 1200);
  }

  setStation(index) {
    const station = this.audio.setStation(index);
    this.hud.toast(`${station.name} — ${station.tagline}`, '', 2600);
    if (this.audio.ready) this.hud.renderStations(STATIONS, this.audio.stationIndex, (i) => this.setStation(i));
  }

  cycleRadio() {
    this.setStation((this.audio.stationIndex + 1) % STATIONS.length);
  }

  toast(text, kind = '', ms = 2600) {
    const now = performance.now();
    const last = this.toastCooldown.get(text) ?? 0;
    if (now - last < 900) return;
    this.toastCooldown.set(text, now);
    this.hud.toast(text, kind, ms);
  }

  // --- cheats -----------------------------------------------------------------

  applyCheat(raw) {
    const res = resolveCheat(raw);
    if (!res.ok) {
      this.hud.cheatResult(`"${raw.trim()}" is not a code. Try ASPIRINE.`, false);
      this.audio.playSfx('empty');
      return;
    }
    const { cheat, effect, params } = res;
    switch (effect) {
      case 'health':
        heal(this.player, 100);
        this.player.stamina = 100;
        this.toast('Health restored.', 'cheat');
        break;
      case 'clearWanted':
        this.player.wanted = 0;
        this.player.wantedHeat = 0;
        this.player.wantedCooldown = 0;
        this.toast('Heat cleared.', 'cheat');
        break;
      case 'spawn': {
        let type = params.type;
        let x = this.player.x + Math.sin(this.camYaw) * -6;
        let z = this.player.z + Math.cos(this.camYaw) * -6;
        if (params.water) {
          const marina = this.world.water.find((w) => w.id === 'marina');
          x = (marina.x0 + marina.x1) / 2;
          z = (marina.z0 + marina.z1) / 2;
        }
        if (params.runway) {
          x = this.world.airport.runway.x;
          z = this.world.airport.runway.z1 - 30;
          type = 'plane';
        }
        if (this.world.blocked(x, z, 2)) {
          x = this.player.x;
          z = this.player.z;
        }
        const v = createVehicle(type, x, z, this.camYaw + Math.PI);
        if (params.armoured) {
          v.spec.health += 120;
          v.health = v.spec.health;
        }
        this.vehicles.set(v.id, v);
        this.renderer.addVehicle(v);
        this.toast(`${cheat.label}`, 'cheat');
        break;
      }
      case 'ammo':
        for (const id of ['pistol', 'smg', 'shotgun']) {
          if (!WEAPONS[id]) continue;
          this.player.ammo[id] = WEAPONS[id].ammo;
          this.player.reserve[id] = WEAPONS[id].reserve ?? 90;
        }
        this.toast('Ammunition topped up.', 'cheat');
        break;
      case 'explode': {
        let blown = 0;
        for (const v of Array.from(this.vehicles.values())) {
          if (Math.hypot(v.x - this.player.x, v.z - this.player.z) < 26 && v !== this.currentVehicle) {
            this._explodeVehicle(v);
            blown++;
          }
        }
        this.toast(blown ? `Detonated ${blown} vehicle(s).` : 'Nothing close enough to blow up.', 'cheat');
        break;
      }
      case 'time':
        this.clock = params.hour;
        this.toast(`Clock set to ${String(Math.floor(params.hour)).padStart(2, '0')}:00.`, 'cheat');
        break;
      case 'weather':
        this.weather = params.state;
        this.weatherTimer = 240;
        this.toast(`Weather: ${params.state}.`, 'cheat');
        break;
      case 'wanted':
        this.player.wanted = Math.min(5, params.stars ?? 3);
        this.player.wantedHeat = this.player.wanted;
        this.player.wantedCooldown = 30;
        this.toast('Wanted level raised.', 'cheat');
        break;
      case 'repair':
        if (this.inVehicle && this.currentVehicle) {
          this.currentVehicle.health = this.currentVehicle.spec.health;
          this.toast('Vehicle repaired.', 'cheat');
        } else this.toast('Get in a vehicle first.', 'cheat');
        break;
      case 'cash':
        this.player.cash += params.amount ?? 0;
        this.toast(`+${formatMoney(params.amount ?? 0)}`, 'cheat');
        break;
      case 'save':
        this._saveGame(true);
        this.toast('Saved anywhere (developer code).', 'cheat');
        break;
      case 'nitro':
        if (this.inVehicle && this.currentVehicle) {
          this.currentVehicle.nitro = 100;
          this.toast('Nitro refilled.', 'cheat');
        }
        break;
      case 'pedsDance':
        for (const ped of this.peds) ped.bob += 2;
        this.toast('The street starts to move.', 'cheat');
        break;
      default:
        this.toast('That code does nothing yet.', 'cheat');
        break;
    }
    this.hud.cheatResult(`${cheat.code} — ${cheat.label}`, true);
    this.audio.playSfx('money');
  }

  // --- saving -----------------------------------------------------------------

  _saveGame(force = false) {
    const near = canSaveAt(this.econ, this.player.x, this.player.z, 12);
    if (!force && !near) {
      this.hud.toast('Save at a property you own.', 'bad', 2600);
      return false;
    }
    const state = createSaveState({
      player: this.player,
      economy: {
        properties: Object.fromEntries(Object.entries(this.econ.properties).map(([id, s]) => [id, { owned: s.owned, income: s.income }])),
        garage: this.econ.garage,
        spent: this.econ.spent,
        earned: this.econ.earned,
      },
      missions: this.missions.toSave(),
      clock: this.clock,
      weather: this.weather,
      settings: this.settings,
      position: { x: this.player.x, z: this.player.z },
    });
    const res = saveTo(this.store, state);
    if (!res.ok) {
      this.hud.toast('Save failed on this device.', 'bad');
      return false;
    }
    this.audio.playSfx('save');
    const note = typeof document !== 'undefined' ? document.getElementById('save-note') : null;
    if (note) note.textContent = `Saved at ${new Date().toLocaleTimeString()}.`;
    return true;
  }

  saveGame() {
    if (this._saveGame(false)) {
      this.hud.toast('Game saved.', 'good');
      this.hud.closePanels();
      this.resume();
    }
  }

  respawn() {
    this.dead = false;
    this.player.dead = false;
    this.player.health = 60;
    this.player.armor = 0;
    this.player.wanted = 0;
    this.player.wantedHeat = 0;
    this.player.cash = Math.max(0, this.player.cash - 250);
    const hotel = this.world.properties.find((p) => p.kind === 'hotel');
    this.player.x = hotel.door.x + 6;
    this.player.z = hotel.door.z + 6;
    this.inVehicle = false;
    this.currentVehicle = null;
    this.resume();
    this.toast('Patched up at the clinic. $250 poorer.', '', 3200);
  }

  // --- frame ------------------------------------------------------------------

  _renderFrame(delta, now) {
    const trafficLite = { cars: this.traffic.cars };
    const frame = {
      hour: this.clock,
      weather: this.weather,
      camera: this.cameraPos ?? { x: this.player.x, y: 8, z: this.player.z + 10 },
      player: { x: this.player.x, z: this.player.z },
      vehicles: this.vehicles,
      playerVehicleId: this.currentVehicle?.id,
      traffic: trafficLite,
      peds: this.peds,
      pickups: this.world.pickups,
    };
    this.renderer.update(delta, frame);
    if (this.cameraPos) this.renderer.applyCamera(this.cameraPos, this.cameraLook, this.inVehicle ? 68 : 62);
    this.renderer.render();
    if (!this._firstFrameDone) {
      this._firstFrameDone = true;
      this.onFirstFrame?.();
    }

    this.minimap.draw(delta, {
      player: { x: this.player.x, z: this.player.z, yaw: this.camYaw },
      traffic: trafficLite,
      pickups: this.world.pickups,
      properties: this.world.properties,
      ownedIds: new Set(Object.entries(this.econ.properties).filter(([, s]) => s.owned).map(([id]) => id)),
      mission: this.missionMarker && !this.missionMarker.following ? this.missionMarker : (this.missionTarget ? { x: this.missionTarget.x, z: this.missionTarget.z } : null),
      waypoint: this.waypoint,
      cops: this.cops.map((c) => c.vehicle),
    });

    if (now - this.lastHud > 66) {
      this.lastHud = now;
      const district = this.world.districtAt(this.player.x, this.player.z).name;
      const weapon = weaponStats(this.player);
      this.hud.update({
        cash: this.player.cash,
        health: this.player.health,
        armor: this.player.armor,
        wanted: this.player.wanted,
        clock: this.clock,
        weather: this.weather,
        district,
        fps: 1000 / this.frameTime,
        drawCalls: this.renderer.renderer.info.render.calls,
        inVehicle: this.inVehicle,
        speed: this.inVehicle ? Math.abs(this.currentVehicle.speed) * 3.6 : 0,
        reverse: this.inVehicle ? this.currentVehicle.speed < -0.4 : false,
        airborne: this.inVehicle ? this.currentVehicle.spec.mode === 'air' : false,
        nitro: this.currentVehicle?.nitro ?? 0,
        stationName: this.audio.station.name,
        stationTagline: this.audio.station.tagline,
        weapon: weapon.name,
        ammo: this.player.ammo[this.player.weapon] ?? weapon.ammo,
        canEnter: !this.inVehicle,
      });
    }
    if (!this.headless && this.input.touchMode !== document.body.classList.contains('touch')) {
      this.hud.setTouchVisible(this.input.touchMode);
    }
  }
}

