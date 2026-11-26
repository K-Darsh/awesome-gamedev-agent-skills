// Property ownership, passive income, vehicle upgrades, wardrobe and workshop crafting.
// The player's money is the only resource the whole loop leans on.

import { clamp } from './util.js';

export const VEHICLE_UPGRADES = {
  paint: { name: 'Respray', cost: 450, kind: 'cosmetic' },
  spoiler: { name: 'Rear spoiler', cost: 1200, kind: 'handling', grip: 0.35, topSpeed: -1 },
  engine: { name: 'Engine tune', cost: 3800, kind: 'performance', accel: 1.25, topSpeed: 1.18, grip: 0.1 },
  armour: { name: 'Armour plating', cost: 2500, kind: 'protection', health: 60 },
  nitro: { name: 'Nitro kit', cost: 2000, kind: 'performance', nitro: true },
  offroad: { name: 'Rally suspension', cost: 1600, kind: 'handling', surface: 0.25, grip: 0.15 },
};

export const WARDROBE = [
  { id: 'linen', name: 'Linen suit', price: 0, shirt: '#f2a7b6', pants: '#2d3a4f' },
  { id: 'bomber', name: 'Bomber jacket', price: 350, shirt: '#7a5cff', pants: '#1f2a36' },
  { id: 'hawaii', name: 'Hawaiian shirt', price: 300, shirt: '#4fb0c6', pants: '#e9e3d6' },
  { id: 'tracksuit', name: 'Tracksuit', price: 500, shirt: '#8ac926', pants: '#2d3a4f' },
  { id: 'night', name: 'Night shift', price: 900, shirt: '#1c1c22', pants: '#121218' },
];

export function createEconomy(world) {
  return {
    world,
    properties: Object.fromEntries(
      world.properties.map((p) => [p.id, { owned: false, income: 0, lastCollect: 0, upgrades: 0 }]),
    ),
    garage: [],
    incomeHours: 0,
    spent: 0,
    earned: 0,
  };
}

export function propertyDef(world, id) {
  return world.properties.find((p) => p.id === id) ?? null;
}

export function isOwned(econ, id) {
  return !!econ.properties[id]?.owned;
}

export function ownsKind(econ, kind) {
  return Object.entries(econ.properties).some(([id, st]) => st.owned && propertyDef(econ.world, id)?.kind === kind);
}

export function buyProperty(econ, player, id) {
  const def = propertyDef(econ.world, id);
  const state = econ.properties[id];
  if (!def || !state) return { ok: false, reason: 'unknown' };
  if (state.owned) return { ok: false, reason: 'owned' };
  if (player.cash < def.price) return { ok: false, reason: 'funds', short: def.price - player.cash };
  player.cash -= def.price;
  state.owned = true;
  state.income = 0;
  econ.spent += def.price;
  return { ok: true, property: def, price: def.price };
}

export function sellProperty(econ, player, id) {
  const def = propertyDef(econ.world, id);
  const state = econ.properties[id];
  if (!def || !state || !state.owned) return { ok: false, reason: 'not-owned' };
  const refund = Math.round(def.price * 0.55);
  state.owned = false;
  state.income = 0;
  player.cash += refund;
  return { ok: true, refund };
}

/** Income accrues while the player is away, capped at three in-game days. */
export function tickEconomy(econ, dt, hoursPerSecond = 1 / 60) {
  const hours = dt * hoursPerSecond;
  econ.incomeHours += hours;
  for (const [id, state] of Object.entries(econ.properties)) {
    if (!state.owned) continue;
    const def = propertyDef(econ.world, id);
    if (!def || !def.income) continue;
    const perHour = def.income / 24;
    state.income = clamp(state.income + perHour * hours, 0, def.income * 3);
  }
}

export function collectIncome(econ, player, id) {
  const state = econ.properties[id];
  const def = propertyDef(econ.world, id);
  if (!state || !def) return { ok: false, reason: 'unknown' };
  if (!state.owned) return { ok: false, reason: 'not-owned' };
  const amount = Math.floor(state.income);
  if (amount < 10) return { ok: false, reason: 'empty' };
  state.income = 0;
  player.cash += amount;
  econ.earned += amount;
  return { ok: true, amount };
}

export function canSaveAt(econ, x, z, radius = 12) {
  for (const [id, state] of Object.entries(econ.properties)) {
    if (!state.owned) continue;
    const def = propertyDef(econ.world, id);
    if (!def) continue;
    if (Math.hypot(def.door.x - x, def.door.z - z) < radius) return def;
  }
  return null;
}

export function garageSpace(econ) {
  return 10 - econ.garage.length;
}

export function storeVehicle(econ, vehicle) {
  if (garageSpace(econ) <= 0) return { ok: false, reason: 'full' };
  econ.garage.push({
    type: vehicle.type,
    color: vehicle.color,
    upgrades: [...(vehicle.upgrades ?? [])],
    health: vehicle.health,
    savedAt: Date.now(),
  });
  return { ok: true, stored: econ.garage.length };
}

export function vehicleWithUpgrades(type, upgrades = []) {
  return upgrades.filter((u) => VEHICLE_UPGRADES[u]);
}

export function applyUpgrade(vehicle, upgradeId) {
  const def = VEHICLE_UPGRADES[upgradeId];
  if (!def) return { ok: false, reason: 'unknown' };
  vehicle.upgrades = vehicle.upgrades ?? [];
  if (vehicle.upgrades.includes(upgradeId)) return { ok: false, reason: 'already' };
  vehicle.upgrades.push(upgradeId);
  const spec = vehicle.spec;
  if (def.grip) spec.grip += def.grip;
  if (def.accel) spec.accel *= def.accel;
  if (def.topSpeed) spec.maxSpeed *= def.topSpeed;
  if (def.health) {
    spec.health += def.health;
    vehicle.health = spec.health;
  }
  if (def.nitro) vehicle.nitro = 100;
  return { ok: true, upgrade: def };
}

export function buyUpgrade(econ, player, vehicle, upgradeId) {
  const def = VEHICLE_UPGRADES[upgradeId];
  if (!def) return { ok: false, reason: 'unknown' };
  if (!isOwned(econ, 'garage') && !isOwned(econ, 'workshop')) return { ok: false, reason: 'no-shop' };
  if (player.cash < def.cost) return { ok: false, reason: 'funds' };
  const res = applyUpgrade(vehicle, upgradeId);
  if (!res.ok) return res;
  player.cash -= def.cost;
  return { ok: true, upgrade: def };
}

export function buyOutfit(econ, player, outfitId) {
  const outfit = WARDROBE.find((o) => o.id === outfitId);
  if (!outfit) return { ok: false, reason: 'unknown' };
  if (!player.outfits.includes(outfit.name)) {
    if (player.cash < outfit.price) return { ok: false, reason: 'funds' };
    player.cash -= outfit.price;
    player.outfits.push(outfit.name);
  }
  player.outfit = outfit.name;
  player.shirt = outfit.shirt;
  player.pants = outfit.pants;
  return { ok: true, outfit };
}

export const PART_TYPES = ['scrap', 'springs', 'polymer'];

export function craftAttachment(player, recipe, ownedWorkshop) {
  if (!ownedWorkshop) return { ok: false, reason: 'workshop' };
  if (player.ownedAttachments[recipe.id]) return { ok: false, reason: 'owned' };
  if (player.cash < recipe.cost) return { ok: false, reason: 'funds' };
  for (const [part, qty] of Object.entries(recipe.parts)) {
    if ((player.parts[part] ?? 0) < qty) return { ok: false, reason: 'parts', part };
  }
  player.cash -= recipe.cost;
  for (const [part, qty] of Object.entries(recipe.parts)) player.parts[part] -= qty;
  player.ownedAttachments[recipe.id] = true;
  player.attachments = [...new Set([...(player.attachments ?? []), recipe.id])];
  return { ok: true, attachment: recipe };
}

export function addPart(player, part, qty = 1) {
  if (!PART_TYPES.includes(part)) return false;
  player.parts[part] = (player.parts[part] ?? 0) + qty;
  return true;
}

export function netWorth(econ, player) {
  let assets = 0;
  for (const [id, state] of Object.entries(econ.properties)) {
    if (!state.owned) continue;
    const def = propertyDef(econ.world, id);
    assets += def?.price ?? 0;
  }
  return player.cash + assets;
}

export function toSave(econ) {
  return {
    properties: Object.fromEntries(
      Object.entries(econ.properties).map(([id, s]) => [id, { owned: s.owned, income: s.income }]),
    ),
    garage: econ.garage.slice(0, 10),
    spent: econ.spent,
    earned: econ.earned,
  };
}

export function fromSave(econ, data) {
  if (!data) return econ;
  for (const [id, saved] of Object.entries(data.properties ?? {})) {
    if (!econ.properties[id]) continue;
    econ.properties[id].owned = !!saved.owned;
    econ.properties[id].income = Number.isFinite(saved.income) ? clamp(saved.income, 0, 1e7) : 0;
  }
  econ.garage = Array.isArray(data.garage) ? data.garage.slice(0, 10) : [];
  econ.spent = Number(data.spent) || 0;
  econ.earned = Number(data.earned) || 0;
  return econ;
}
