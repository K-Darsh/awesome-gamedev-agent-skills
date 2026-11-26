---
name: open-world-city-game
description: >
  Engine-agnostic open-world city game: plans and builds the GTA/Vice City loop with districts,
  streaming, arcade vehicle handling, traffic and sidewalk pedestrians, day-night, weather, radio,
  missions, property economy and saves, then ships it as an Android App Bundle with Play Asset
  Delivery and touch controls. Use for open-world crime sandboxes, drivable cities, Vice City-like
  requests, traffic or pedestrian AI, minimap and wanted systems, cheat consoles, or an APK/AAB size
  plan. Not for a single level's pacing (level-design), tyre-level racing simulation
  (physics-tuning), or shader work alone (shader-programming).
---

# Open-world city game

Owns the systems that make a city feel inhabited: districts and roads, vehicles, traffic,
pedestrians, time and weather, radio, missions, property and saves — plus the Android delivery plan
that keeps the install under Play's limits. Design targets are mobile-first (mid-range 30-60 fps,
high-end 90-120 fps at reduced resolution) and the same data structures run in a browser prototype,
Unity 6.3 LTS, Unreal 5.8, or a custom engine.

A full commercial open world is a multi-year team product. This skill's job is to make the first
playable city correct: one coherent map, one handling model, one traffic graph, one mission data
schema, one save file, and measured budgets. Scope to a vertical slice (about 2 km², 10 vehicles,
6 missions, 20 minutes of play) before promising a 9 GB world.

## When to use

- The request names GTA, Vice City, an open-world crime sandbox, a drivable city, or "traffic,
  pedestrians, radio, missions and property in one game".
- Adding or fixing one of the core loops: vehicle handling, traffic signals, sidewalk crowds,
  day-night or weather, minimap with pickups, wanted stars, cheat codes, safehouse saves.
- Planning the Android build: APK vs AAB, Play Asset Delivery, asset budgets, device tiers.

**When not to use:** a single linear level's blockout and pacing (`level-design`); tyre slip
curves and suspension for a racing simulator (`physics-tuning`); a shader or post effect on its own
(`shader-programming`); engine scene setup (use the detected engine skill — `godot-3d-essentials`,
`unity-csharp-scripting`, `unreal-cpp-gameplay`, or `threejs-scene-setup`).

## Workflow

1. **Write the one-page frame first.** Platform, minimum device, size ceiling, frame target,
   session length, content rating, offline requirement. Every later budget derives from it.
   A 9 GB install is not a free choice: Play caps a standard app at 200 MB base + 4 GB install-time
   asset packs + 4 GB fast-follow/on-demand (8 GB total), so either scope lower or enrol in Play's
   Level Up program. Read `references/android-play-delivery.md` before promising any size.
2. **Fix the world contract once** and write it into code constants: metres as the unit, +Y up,
   road centre lines on a grid, right-hand traffic, clock in hours 0-24, districts as a table with
   predicates. Read `references/city-streaming-and-performance.md` for the grid, block, streaming
   cell and LOD maths, and copy the district table pattern into the project's data format.
3. **Build handling before scenery.** A greybox plane, six vehicle classes and a chase camera are
   enough to tune. Use the arcade model in `references/vehicles-traffic-pedestrians.md`: targeted
   top speeds per class, speed-sensitive steering authority, lateral grip decay, handbrake slide,
   surface and wetness multipliers. Ask the user to drive each class for two minutes and report
   whether it understeers, spins or feels glued.
4. **Derive traffic and pedestrians from the same road graph.** Directed lane edges at ±3.5 m from
   the centre line, signals alternating per axis, gap-based car following, sidewalk perimeter loops
   for pedestrians. Never path a pedestrian across a live lane without a crossing rule.
5. **Make one clock the source of truth for atmosphere.** Sun angle from the hour, sky keys, fog
   distance, window emissive intensity, headlights and radio mood all read the same value. Weather
   is a modifier table (fog multiplier, rain count, wetness), not a second system.
   Read `references/atmosphere-and-radio.md`.
6. **Write missions as data with one interpreter.** Steps are `goto`, `deliver`, `tail`, `ram`,
   `checkpoints`, `escape`; each carries a radius, timer and fail rule. Branching is a choice event
   that swaps the mission record, not a second code path. Rewards and prices live in the same table
   as the mission. Read `references/missions-economy-saves.md`.
7. **Close the persistence loop early.** A versioned save with migration, a safehouse that writes
   it, and an integration test that reloads. Property income, garage contents, mission progress and
   settings all round-trip, or none of them do.
8. **Design touch before the HUD is pretty.** Left stick, right action cluster, drag-to-look,
   safe-area insets, 44 pt minimum targets, no hover-only affordance. The cheat console is a text
   field with code matching, not a hidden gesture. Read `references/touch-ui-and-cheats.md`.
9. **Budget and gate.** Fill in `assets/ship-budget.json`, run
   `python scripts/check_ship_budgets.py <manifest>.json`, and fix every `ERROR`. Then measure on
   device: frame time percentiles, draw calls, texture memory, install size and cold start.
10. **Ship as an App Bundle.** Base module under 200 MB, packs split by district/vehicle class,
    `targetSdk 36`, texture compression splits, background downloads and a resume path. Copy the
    Gradle files from `assets/play-asset-delivery/` and follow
    `references/android-play-delivery.md` for the compliance checklist.

## Patterns

### District table

Every zone is a predicate plus a style row. Generation, ambience and minimap labels all read it.

```js
const DISTRICTS = [
  { id: 'downtown', name: 'Neon Heights', test: (x, z) => Math.abs(x) <= 200 && Math.abs(z) <= 200,
    heights: [44, 118], palette: ['#8fa9bf', '#b6c4d1'], windows: 0.45, traffic: 0.9 },
  { id: 'beach', name: 'Vice Beach', test: (x, z) => z >= 238, heights: [7, 17],
    palette: ['#f3c9a3', '#f2a7b6'], windows: 0.3, traffic: 0.55 },
];
const districtAt = (x, z) => DISTRICTS.find((d) => d.test(x, z)) ?? DISTRICTS.at(-1);
```

### Lane graph

One directed edge per road direction per block. Store `{ a, b, dir, length, laneOffset }`; traffic
cars hold `{ edgeId, t, speed }` and never store world positions, so recycling a car is a data
change, not a respawn animation.

### Handling numbers that feel right

| Class | Top speed | 0-100 km/h | Steering | Notes |
|-------|-----------|------------|----------|-------|
| Sedan | 41 m/s (148 km/h) | 6.0 s | 0.58 rad | reference, forgiving |
| Sports | 52 m/s (187 km/h) | 4.2 s | 0.52 rad | more grip, less authority |
| Supercar | 64 m/s (230 km/h) | 3.3 s | 0.50 rad | the map must fit it |
| Motorcycle | 56 m/s | 3.6 s | 0.72 rad | lean, fragile |
| Scooter | 26 m/s | 9 s | 0.85 rad | city only |
| Boat | 26 m/s | — | 0.50 rad | water surface only |
| Helicopter | 58 m/s | — | yaw 1.25 rad/s | climb on collective |
| Plane | 105 m/s, stall 32 | — | bank-induced yaw | needs a runway |

### Mission step schema

```json
{ "id": "courier", "pay": 2500, "steps": [
  { "kind": "goto", "x": 296, "z": 158, "radius": 7, "label": "Collect the crate" },
  { "kind": "deliver", "x": 148, "z": 296, "radius": 8, "timeLimit": 240, "maxVehicleDamage": 45 }
] }
```

### Versioned save with migration

```js
const SAVE_VERSION = 2;
function migrate(s) {
  if (s.version < 2) { s.player.ammo = { pistol: Number(s.player.ammo) || 0 }; s.version = 2; }
  return s.version > SAVE_VERSION ? null : s;
}
```

## Gotchas

- **Parked car cannot move** → spawned overlapping a wall; the engine pushes it back each frame.
  Spawn on a lane, align yaw with the road, and assert a 3×3 clearance sample in world generation.
- **Cars drive on water or through the marina** → the surface query and the lane graph disagree.
  Make water a surface and bridges an explicit deck; a lane over water needs a deck mesh and a
  `road` surface, or no lane at all.
- **"We target 120 fps" then thermal throttling** → sustained frame rate on a phone is set by heat,
  not peak. Ship tiered presets, dynamic resolution, and treat 90-120 fps as a high-end mode with
  shadows and density reduced. Quote 30/60 as the guaranteed floor.
- **Traffic gridlocks at one junction** → two cars claim the same lane cell; the gap check only
  looks forward along the current edge. Include the next edge's queue, and cap the number of cars
  per cell rather than the global count.
- **Pedestrians walk through cars** → no crossing rule. Sidewalk loops plus explicit crossing edges
  that wait on the signal phase; never allow free 2D steering across the graph.
- **The city looks flat at noon** → one directional light and no ambient occlusion. Vary building
  mass, use emissive signs at night, and fake kerb shadow with a dark strip instead of extra lights.
- **Assets blow past the pack limit** → 4K textures and per-prop materials. Ship ASTC, atlas
  materials per district, and check the compressed download size in the Play Console report.
- **Phone users cannot type a cheat** → a cheat console behind a keyboard-only shortcut is
  unreachable. Expose it as a button plus text field, and accept codes without spaces or case.
- **Radio continues after app backgrounding** → audio focus is not released. Pause the context on
  `visibilitychange` and on Android audio-focus loss.
- **Save survives updates but not play** → schema migration ran but entity ids changed. Keep ids
  stable strings in content data, never array indices.
- **First install fails on Android 12** → target SDK too old or missing exported flags on the
  launcher activity. `targetSdk 36` for new uploads after 2026-08-31, explicit `android:exported`.

## Resources

- `references/modern-open-world-mechanics.md` — what Vice City and its sequels actually do, the
  modern-mechanic checklist, and sourced facts. Read when scoping features or arguing about parity.
- `references/city-streaming-and-performance.md` — city size maths, streaming cells, LOD, draw-call
  and texture budgets, device tiers, frame-pacing plan. Read before generating the map.
- `references/vehicles-traffic-pedestrians.md` — the handling model, surface/wetness effects, air
  and water modes, lane graph, signals, car following, pedestrian and police AI. Read before
  writing any movement code.
- `references/atmosphere-and-radio.md` — clock, sky keys, fog, weather table, emissive night city,
  audio buses, interactive music, procedural radio fallback. Read when building lighting or sound.
- `references/missions-economy-saves.md` — mission runtime, branching, fail economics, property
  catalogue and income maths, safehouse saves, offline storage. Read before designing quests.
- `references/touch-ui-and-cheats.md` — thumb zones, per-mode control layouts, safe areas, cheat
  console and code table, accessibility. Read before HUD work on a phone.
- `references/android-play-delivery.md` — verified Play size limits, App Bundle rules, Play Asset
  Delivery setup, background downloads, compliance checklist. Read before making any size promise.
- Copy `assets/ship-budget.json` as the project's content manifest, then run
  `python scripts/check_ship_budgets.py --help` and the checker; a pass has zero errors.
- `assets/play-asset-delivery/` holds the asset-pack Gradle module, manifest and settings snippets.

## Related skills

- `$performance-optimization`: measure first, then cut the bottleneck this skill's budgets name.
- `$game-ai`: perception, steering and behaviour trees for police and gang NPCs.
- `$save-systems`: versioning and corruption handling for the safehouse save.
- `$game-ui-ux`: HUD scaling, focus order and accessibility beyond the touch layout here.
- `$audio-design`: bus architecture and adaptive music theory under the radio system.
- `$procedural-gen` and `$level-design`: city fabric and street-level readability.
- `$rpg`: mission progression numbers when the game grows stats and equipment.

## Version notes

Last verified 2026-11-26.

- Play limits: base module 200 MB, feature module 200 MB, asset pack 1.5 GB, install-time total
  4 GB, fast-follow/on-demand total 4 GB (30 GB for Level Up and Android XR), 100 packs, 1 GB+
  apps need minSdk 21.
- New apps and updates must target Android 16 (API 36) since 2026-08-31; existing apps must target
  API 35 to stay discoverable. Wear/Automotive 35, TV/XR 34.
- Engine baselines: Unity 6.3 LTS, Unreal 5.8, three.js r187, Godot 4.7.
- Progression example uses 20 real minutes per in-game day; audio example uses WebAudio only.
