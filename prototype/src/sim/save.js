// Versioned save data. The browser stores the string in localStorage; the same
// serializer also works for a native shell (write the JSON to app storage).

import { WEAPONS } from './player.js';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'neon-coast-save-v2';
export const SETTINGS_KEY = 'neon-coast-settings-v1';

export const DEFAULT_SETTINGS = {
  renderScale: 1,
  shadows: true,
  drawDistance: 900,
  fpsCap: 60,
  sensitivity: 1,
  joystickSize: 1,
  minimap: true,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  quality: 'auto',
  showFps: false,
  invertLook: false,
  language: 'en',
};

export function clampSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(input && typeof input === 'object' ? input : {}) };
  s.renderScale = Math.min(1.5, Math.max(0.5, Number(s.renderScale) || 1));
  s.drawDistance = Math.min(1600, Math.max(300, Number(s.drawDistance) || 900));
  s.fpsCap = [30, 60, 90, 120, 144].includes(Number(s.fpsCap)) ? Number(s.fpsCap) : 60;
  s.sensitivity = Math.min(2.5, Math.max(0.25, Number(s.sensitivity) || 1));
  s.joystickSize = Math.min(1.6, Math.max(0.7, Number(s.joystickSize) || 1));
  s.musicVolume = Math.min(1, Math.max(0, Number(s.musicVolume)));
  s.sfxVolume = Math.min(1, Math.max(0, Number(s.sfxVolume)));
  s.shadows = !!s.shadows;
  s.minimap = !!s.minimap;
  s.showFps = !!s.showFps;
  return s;
}

export function createSaveState({ player, economy, missions, clock = 8.5, weather = 'clear', settings = {}, position = { x: 0, z: 0 }, seed = 1986 }) {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed,
    clock,
    weather,
    position: { x: position.x, z: position.z },
    player: {
      cash: player.cash,
      health: player.health,
      armor: player.armor,
      stamina: player.stamina,
      weapon: player.weapon,
      ammo: { ...player.ammo },
      reserve: { ...player.reserve },
      parts: { ...player.parts },
      ownedAttachments: { ...player.ownedAttachments },
      attachments: [...(player.attachments ?? [])],
      outfits: [...player.outfits],
      outfit: player.outfit,
      shirt: player.shirt,
      pants: player.pants,
      wanted: player.wanted,
      inventory: { ...player.inventory },
    },
    economy,
    missions,
    settings,
  };
}

export function serialize(state) {
  return JSON.stringify(state);
}

export function migrate(state) {
  if (!state || typeof state !== 'object') return null;
  let s = { ...state };
  if (!s.version || s.version < 2) {
    // v1 stored ammo as a single number and had no attachments.
    s.player = s.player ?? {};
    const legacyAmmo = Number(s.player.ammo) || 0;
    s.player.ammo = { pistol: Math.min(weaponMag('pistol'), legacyAmmo), smg: 0, shotgun: 0 };
    s.player.reserve = { pistol: Math.max(0, legacyAmmo - weaponMag('pistol')), smg: 0, shotgun: 0 };
    s.player.parts = { scrap: 0, springs: 0, polymer: 0 };
    s.player.ownedAttachments = {};
    s.player.attachments = [];
    s.player.outfits = s.player.outfits ?? ['Linen suit'];
    s.player.outfit = s.player.outfit ?? 'Linen suit';
    s.version = 2;
  }
  return s;
}

function weaponMag(id) {
  const w = WEAPONS[id];
  return Number.isFinite(w?.ammo) ? w.ammo : 0;
}

export function parseSave(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  const migrated = migrate(parsed);
  if (!migrated) return { ok: false, reason: 'corrupt' };
  if (migrated.version > SAVE_VERSION) return { ok: false, reason: 'newer-version', state: migrated };
  const state = migrated;
  if (!state.player || typeof state.player.cash !== 'number') return { ok: false, reason: 'invalid' };
  return { ok: true, state };
}

/** Apply a parsed save over live game objects. Never trusts missing fields. */
export function applySave(state, { player, economy, missions, settings }) {
  if (!state?.player) return false;
  const p = state.player;
  player.cash = Number(p.cash) || 0;
  player.health = Math.min(100, Math.max(1, Number(p.health) || 100));
  player.armor = Math.min(100, Math.max(0, Number(p.armor) || 0));
  player.stamina = Math.min(100, Math.max(0, Number(p.stamina) || 100));
  player.weapon = WEAPONS[p.weapon] ? p.weapon : 'pistol';
  player.ammo = { ...player.ammo, ...(p.ammo ?? {}) };
  player.reserve = { ...player.reserve, ...(p.reserve ?? {}) };
  player.parts = { ...player.parts, ...(p.parts ?? {}) };
  player.ownedAttachments = { ...(p.ownedAttachments ?? {}) };
  player.attachments = Array.isArray(p.attachments) ? p.attachments : [];
  player.outfits = Array.isArray(p.outfits) && p.outfits.length ? p.outfits : ['Linen suit'];
  player.outfit = p.outfit ?? 'Linen suit';
  player.shirt = p.shirt ?? player.shirt;
  player.pants = p.pants ?? player.pants;
  player.wanted = Math.min(5, Math.max(0, Number(p.wanted) || 0));
  player.inventory = { package: 0, evidence: 0, ...(p.inventory ?? {}) };
  player.dead = false;
  if (economy && state.economy) {
    for (const [id, saved] of Object.entries(state.economy.properties ?? {})) {
      const target = economy.properties[id];
      if (!target) continue;
      target.owned = !!saved.owned;
      target.income = Number(saved.income) || 0;
    }
    economy.garage = Array.isArray(state.economy.garage) ? state.economy.garage.slice(0, 10) : [];
    economy.spent = Number(state.economy.spent) || 0;
    economy.earned = Number(state.economy.earned) || 0;
  }
  if (missions && state.missions) missions.fromSave(state.missions);
  if (settings && state.settings) Object.assign(settings, clampSettings(state.settings));
  return true;
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

export function saveTo(storage, state) {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  }
}

export function loadFrom(storage) {
  const raw = storage.getItem(SAVE_KEY);
  return parseSave(raw);
}
