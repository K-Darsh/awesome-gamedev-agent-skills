// Keyboard cheat console, modelled on the Vice City code entry but typed into an
// on-screen field (phones have no keyboard layout for cases like "ASPIRINE").
// Each code returns a plain effect descriptor; the game decides how to apply it.

export const CHEAT_CODES = [
  { code: 'ASPIRINE', classic: true, effect: 'health', label: 'Full health' },
  { code: 'LEAVEMEALONE', classic: true, effect: 'clearWanted', label: 'Clear wanted level' },
  { code: 'COMETOYSIDE', classic: true, effect: 'spawn', params: { type: 'supercar' }, label: 'Spawn a supercar' },
  { code: 'GRANDPRIX', classic: true, effect: 'spawn', params: { type: 'sports' }, label: 'Spawn a sports car' },
  { code: 'BIKEMI', classic: true, effect: 'spawn', params: { type: 'bike' }, label: 'Spawn a motorcycle' },
  { code: 'PANZER', classic: true, effect: 'spawn', params: { type: 'van', armoured: true }, label: 'Spawn an armoured van' },
  { code: 'SEAWAYS', classic: true, effect: 'spawn', params: { type: 'boat', water: true }, label: 'Spawn a boat at the marina' },
  { code: 'AIRSHIP', classic: true, effect: 'spawn', params: { type: 'helicopter' }, label: 'Spawn a helicopter' },
  { code: 'SKYHIGH', classic: true, effect: 'spawn', params: { type: 'plane', runway: true }, label: 'Spawn a plane on the runway' },
  { code: 'FULLCLIP', classic: true, effect: 'ammo', label: 'Top up all ammunition' },
  { code: 'BIGBANG', classic: true, effect: 'explode', label: 'Detonate nearby vehicles' },
  { code: 'NIGHTY', classic: true, effect: 'time', params: { hour: 0.5 }, label: 'Set the clock to midnight' },
  { code: 'DAYSUN', classic: true, effect: 'time', params: { hour: 11.5 }, label: 'Set the clock to midday' },
  { code: 'STORMY', effect: 'weather', params: { state: 'storm' }, label: 'Summon a storm' },
  { code: 'FOGGY', effect: 'weather', params: { state: 'fog' }, label: 'Roll in sea fog' },
  { code: 'CLEARSKY', effect: 'weather', params: { state: 'clear' }, label: 'Clear the sky' },
  { code: 'WANTED', effect: 'wanted', params: { stars: 3 }, label: 'Raise the wanted level' },
  { code: 'REPAIR', effect: 'repair', label: 'Repair the current vehicle' },
  { code: 'CASHFLOW', effect: 'cash', params: { amount: 5000 }, label: 'Add $5,000' },
  { code: 'SAVEME', effect: 'save', label: 'Save anywhere (developer code)' },
  { code: 'FASTLANE', effect: 'nitro', label: 'Refill nitro' },
  { code: 'PETSOUNDS', effect: 'pedsDance', label: 'Nearby pedestrians dance' },
];

const INDEX = new Map(CHEAT_CODES.map((c) => [c.code, c]));

/** Uppercase, trim, collapse spaces. Cheat matching ignores casing and spacing. */
export function normalizeCode(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function findCheat(text) {
  return INDEX.get(normalizeCode(text)) ?? null;
}

export function cheatList(filter = '') {
  const q = normalizeCode(filter);
  return CHEAT_CODES.filter((c) => !q || c.code.includes(q));
}

/**
 * Resolve a typed code to an effect the game can run.
 * @returns {{ok:boolean, cheat?:object, effect?:string, params?:object, reason?:string}}
 */
export function resolveCheat(text) {
  const cheat = findCheat(text);
  if (!cheat) return { ok: false, reason: 'unknown' };
  return { ok: true, cheat, effect: cheat.effect, params: cheat.params ?? {} };
}
