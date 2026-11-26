// On-foot player: movement, stamina, weapons, damage and the wanted system.
// Deliberately free of DOM and rendering code.

import { clamp, damp, dampAngle, dist2, moveTowards } from './util.js';

export const WEAPONS = {
  fists: { name: 'Fists', damage: 12, rate: 0.55, range: 2.4, spread: 0, ammo: Infinity, melee: true },
  pistol: { name: 'Pistol', damage: 26, rate: 0.34, range: 85, spread: 0.035, ammo: 12, reserve: 96, reload: 1.15 },
  smg: { name: 'SMG', damage: 14, rate: 0.085, range: 65, spread: 0.075, ammo: 30, reserve: 180, reload: 1.7 },
  shotgun: { name: 'Shotgun', damage: 58, rate: 0.85, range: 26, spread: 0.14, pellets: 6, ammo: 6, reserve: 36, reload: 2.1 },
};

/** Craftable attachments. Each one changes a real number in WEAPONS usage. */
export const ATTACHMENTS = {
  suppressor: { name: 'Suppressor', slot: 'muzzle', effect: 'Shots do not raise the wanted level from a distance.', wantedMul: 0.25 },
  extended: { name: 'Extended magazine', slot: 'mag', effect: '+60% magazine size.', magMul: 1.6 },
  scope: { name: 'Reflex sight', slot: 'optic', effect: 'Halves weapon spread.', spreadMul: 0.5 },
  grip: { name: 'Foregrip', slot: 'grip', effect: '-30% recoil climb.', recoilMul: 0.7 },
};

export const CRAFT_RECIPES = [
  { id: 'suppressor', name: 'Suppressor', cost: 900, parts: { scrap: 4, polymer: 2 }, requires: 'workshop' },
  { id: 'extended', name: 'Extended magazine', cost: 650, parts: { scrap: 3, springs: 2 }, requires: 'workshop' },
  { id: 'scope', name: 'Reflex sight', cost: 750, parts: { polymer: 3, springs: 3 }, requires: 'workshop' },
  { id: 'grip', name: 'Foregrip', cost: 500, parts: { scrap: 2, polymer: 2 }, requires: 'workshop' },
];

export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;

export function createPlayer(x = 0, z = 0) {
  return {
    x, z, y: 0, yaw: 0,
    vx: 0, vz: 0,
    health: MAX_HEALTH,
    armor: 0,
    stamina: 100,
    cash: 1500,
    weapon: 'fists',
    ammo: { pistol: 12, smg: 0, shotgun: 0 },
    reserve: { pistol: 96, smg: 0, shotgun: 0 },
    attachments: [],
    parts: { scrap: 0, springs: 0, polymer: 0 },
    ownedAttachments: {},
    inventory: { package: 0, evidence: 0 },
    wanted: 0,
    wantedHeat: 0,
    wantedCooldown: 0,
    cooldown: 0,
    reloading: 0,
    recoil: 0,
    sprinting: false,
    walking: false,
    bob: 0,
    dead: false,
    lastHurtAt: -99,
    stars: 0,
    outfits: ['Linen suit'],
    outfit: 'Linen suit',
    skin: '#e0ac7e',
    shirt: '#f2a7b6',
    pants: '#2d3a4f',
  };
}

/**
 * Advance the on-foot player.
 * @param {object} p player state (mutated)
 * @param {object} input {moveX -1..1, moveY -1..1, sprint, jump, cameraYaw, crouch}
 * @param {number} dt
 * @param {object} env {blocked(x,z,r), surfaceAt(x,z)}
 */
export function stepPlayer(p, input, dt, env) {
  if (p.dead) return;
  const cameraYaw = input.cameraYaw ?? 0;

  // Camera-relative movement: moveY pushes away from the camera.
  const mx = clamp(input.moveX ?? 0, -1, 1);
  const my = clamp(input.moveY ?? 0, -1, 1);
  const len = Math.hypot(mx, my);
  const speedBase = input.crouch ? 1.6 : input.sprint && p.stamina > 1 ? 7.4 : 3.0;
  if (len > 0.02) {
    const norm = len > 1 ? 1 / len : 1;
    const dirX = Math.sin(cameraYaw) * my + Math.cos(cameraYaw) * mx * norm;
    const dirZ = Math.cos(cameraYaw) * my - Math.sin(cameraYaw) * mx * norm;
    const surface = env.surfaceAt ? env.surfaceAt(p.x, p.z) : 'road';
    const surfaceMul = surface === 'sand' ? 0.7 : surface === 'grass' ? 0.85 : 1;
    const targetVx = dirX * speedBase * surfaceMul;
    const targetVz = dirZ * speedBase * surfaceMul;
    p.vx = damp(p.vx, targetVx, 12, dt);
    p.vz = damp(p.vz, targetVz, 12, dt);
    p.yaw = dampAngle(p.yaw, Math.atan2(dirX, dirZ), 14, dt);
    p.walking = true;
    p.bob += dt * (input.sprint ? 13 : 8);
  } else {
    p.vx = damp(p.vx, 0, 16, dt);
    p.vz = damp(p.vz, 0, 16, dt);
    p.walking = false;
  }

  p.sprinting = !!(input.sprint && len > 0.1 && p.stamina > 1);
  p.stamina = clamp(p.stamina + (p.sprinting ? -12 : 9) * dt, 0, 100);

  const nx = p.x + p.vx * dt;
  const nz = p.z + p.vz * dt;
  const r = 0.42;
  if (!env.blocked || !env.blocked(nx, p.z, r)) p.x = nx;
  else p.vx = 0;
  if (!env.blocked || !env.blocked(p.x, nz, r)) p.z = nz;
  else p.vz = 0;

  p.cooldown = Math.max(0, p.cooldown - dt);
  p.reloading = Math.max(0, p.reloading - dt);
  p.recoil = damp(p.recoil, 0, 9, dt);

  tickWanted(p, dt);
}

/** Heat only cools once the player has been unseen for a while. Used on foot and in vehicles. */
export function tickWanted(p, dt) {
  p.wantedCooldown = Math.max(0, (p.wantedCooldown ?? 0) - dt);
  if (p.wanted > 0 && p.wantedCooldown <= 0) {
    p.wantedHeat = Math.max(0, (p.wantedHeat ?? 0) - dt * 0.55);
    if (p.wantedHeat <= 0.02) {
      p.wanted = 0;
      p.wantedHeat = 0;
    }
  }
}

export function weaponStats(p, weaponId = p.weapon) {
  const base = WEAPONS[weaponId] ?? WEAPONS.fists;
  const mods = p.attachments ?? [];
  const has = (id) => mods.includes(id);
  const stats = { ...base };
  if (has('extended')) stats.ammo = Math.round((base.ammo ?? 0) * ATTACHMENTS.extended.magMul);
  if (has('scope')) stats.spread = (base.spread ?? 0) * ATTACHMENTS.scope.spreadMul;
  if (has('grip')) stats.recoilMul = ATTACHMENTS.grip.recoilMul;
  if (has('suppressor')) stats.wantedMul = ATTACHMENTS.suppressor.wantedMul;
  return stats;
}

export function canShoot(p) {
  return p.cooldown <= 0 && p.reloading <= 0 && !p.dead;
}

/**
 * Fire the current weapon. Returns a hit descriptor or null.
 * Targets: [{x, z, radius, kind:'ped'|'car'|'copter', ref}]
 */
export function fireWeapon(p, targets, rangeModifier = 1, aimAssist = 0) {
  const stats = weaponStats(p);
  if (!canShoot(p)) return { fired: false, reason: p.reloading > 0 ? 'reloading' : 'cooldown' };
  const reserve = p.reserve[p.weapon] ?? 0;
  if (!stats.melee && reserve <= 0 && (p.ammo[p.weapon] ?? 0) <= 0) return { fired: false, reason: 'empty' };
  p.cooldown = stats.rate;
  if (!stats.melee) {
    p.ammo[p.weapon] = Math.max(0, (p.ammo[p.weapon] ?? 0) - 1);
    p.reserve[p.weapon] = reserve;
    p.recoil = Math.min(1, p.recoil + 0.22 * (stats.recoilMul ?? 1));
    if ((p.ammo[p.weapon] ?? 0) <= 0 && reserve > 0) p.reloading = stats.reload ?? 1.2;
  }

  const spread = (stats.spread ?? 0) * (1 + p.recoil * 0.7);
  const range = (stats.range ?? 2) * rangeModifier;
  const originX = p.x;
  const originZ = p.z;
  const aimYaw = p.yaw;
  let best = null;
  for (const t of targets) {
    if (t.dead) continue;
    const dx = t.x - originX;
    const dz = t.z - originZ;
    const dist = Math.hypot(dx, dz);
    if (dist > range || dist < 0.001) continue;
    const angle = Math.abs(angleDiff(Math.atan2(dx, dz), aimYaw));
    const tolerance = Math.atan2(t.radius ?? 0.5, dist) + spread * 2 + aimAssist;
    if (angle <= tolerance && (!best || dist < best.dist)) best = { target: t, dist, dx, dz, angle };
  }
  const pellets = stats.pellets ?? 1;
  const hits = [];
  for (let i = 0; i < pellets; i++) {
    if (best) {
      const hit = { ...best, damage: stats.damage / (pellets > 1 ? 1 : 1), kind: best.target.kind, ref: best.target.ref };
      hits.push(hit);
      if (pellets > 1 && Math.random() > 0.55) break;
    }
  }
  p.lastShotAt = (p.lastShotAt ?? 0) + 1;
  return {
    fired: true,
    hits,
    damage: stats.damage,
    loud: !stats.melee && !(stats.wantedMul && stats.wantedMul < 1),
    suppressed: !!stats.wantedMul && stats.wantedMul < 1,
    spread,
    range,
    melee: !!stats.melee,
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function reload(p) {
  const stats = weaponStats(p);
  if (stats.melee || p.reloading > 0) return false;
  const reserve = p.reserve[p.weapon] ?? 0;
  if ((p.ammo[p.weapon] ?? 0) >= stats.ammo || reserve <= 0) return false;
  p.reloading = stats.reload ?? 1.2;
  p.pendingReload = { weapon: p.weapon, magSize: stats.ammo };
  return true;
}

/** Called by the game loop when the reload timer finishes. */
export function finishReload(p) {
  const pending = p.pendingReload;
  if (!pending) return;
  const stats = weaponStats(p, pending.weapon);
  const need = stats.ammo - (p.ammo[pending.weapon] ?? 0);
  const take = Math.min(need, p.reserve[pending.weapon] ?? 0);
  p.ammo[pending.weapon] = (p.ammo[pending.weapon] ?? 0) + take;
  p.reserve[pending.weapon] = Math.max(0, (p.reserve[pending.weapon] ?? 0) - take);
  p.pendingReload = null;
}

export function giveWeapon(p, id, ammo = 30) {
  if (!WEAPONS[id] || WEAPONS[id].melee) return;
  p.weapon = id;
  p.ammo[id] = Math.min(WEAPONS[id].ammo, (p.ammo[id] ?? 0) + ammo);
  p.reserve[id] = (p.reserve[id] ?? 0) + ammo * 2;
}

export function takeDamage(p, amount, source = 'unknown') {
  if (p.dead) return;
  let remaining = amount;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, remaining * 0.62);
    p.armor -= absorbed;
    remaining -= absorbed;
  }
  p.health = Math.max(0, p.health - remaining);
  p.lastHurtAt = 0;
  if (p.health <= 0) p.dead = true;
  return { source, remaining };
}

export function heal(p, amount) {
  p.health = Math.min(MAX_HEALTH, p.health + amount);
  if (p.health > 0) p.dead = false;
}

export function addArmor(p, amount) {
  p.armor = Math.min(MAX_ARMOR, p.armor + amount);
}

/** Raise wanted level from a crime; `severity` 1 = bump, 2 = a kill, 3 = cop. */
export function commitCrime(p, severity = 1, witnesses = 1) {
  const gain = severity * Math.min(1.6, 0.55 + witnesses * 0.18);
  p.wantedHeat = clamp(p.wantedHeat + gain, 0, 6);
  p.wanted = clamp(Math.ceil(p.wantedHeat), 0, 5);
  p.wantedCooldown = 12 + p.wanted * 5;
  return p.wanted;
}

export function nearestTarget(targets, x, z, maxDist = 30) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const t of targets) {
    if (t.dead) continue;
    const d = dist2(t.x, t.z, x, z);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

export function enterRange(a, x, z, r) {
  return dist2(a.x, a.z, x, z) <= r * r;
}

export function movePlayerTo(p, x, z) {
  p.x = x;
  p.z = z;
  p.vx = 0;
  p.vz = 0;
}

export function healAtSafehouse(p) {
  heal(p, MAX_HEALTH);
  p.stamina = 100;
}
