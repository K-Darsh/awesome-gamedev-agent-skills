# Modern open-world city mechanics

Contents: what Vice City established · what later GTA entries changed · the mechanic checklist ·
what does not survive mobile · sources and confidence.

Use this to scope a Vice City-like request without copying its limitations. The 2002 game is the
reference for structure (districts, radio, property, wanted level); the later entries are the
reference for feel (control standards, mission checkpoints, camera, accessibility). Neither is a
specification for a phone game.

## What Vice City established

- **Two islands plus a beach strip**, joined by bridges, with aircraft and boats as the only
  shortcuts. Districts read by palette, silhouette and music rather than by signs.
- **A radio dial inside the vehicle.** Stations carry genre identity, adverts and talk; the music
  is the atmosphere layer, not a menu. The Definitive Edition later moved selection to a wheel so
  driving never stops.
- **Property as progression.** Safehouses are save points and garages; businesses are mission
  chains that turn into passive income once the chain is finished. Community guides put the seven
  safehouses at roughly $41,500 total and all properties near $441,500, with the Vercetti Estate and
  Kaufman Cabs paying about $5,000 per collection cycle. Treat those numbers as pacing anchors, not
  canonical.
- **Missions as short, authored set pieces** with one vehicle gimmick each: follow at a distance,
  ram, deliver before a timer, fly a checkpoint course, survive a shootout.
- **Wanted stars** with a visible escalation: more stars, more police, harder escape.
- **Side economies**: hidden packages, rampages, taxi/ambulance/fire/vigilante jobs, stadium events,
  import lists. They teach the map and pay for the next property.
- **Cheat codes typed on a keyboard.** They are part of the identity and part of the nostalgia; a
  modern touch build needs an explicit console, not a hidden gesture.

## What later GTA entries changed

| Mechanic | Vice City (2002) | Modern baseline | What to adopt on mobile |
|---|---|---|---|
| Aiming | lock-on only | free aim plus soft lock, cover, weapon wheel | soft lock with generous assists, tap-to-fire, no cover system in v1 |
| Weapon/radio selection | cycling | radial wheels | wheel on long-press, never pause the simulation |
| Mission failure | restart from the contact | checkpoints mid-mission | checkpoint every step; retry within 10 s |
| Driving camera | fixed chase | speed-dependent, look-around, cinematic | chase plus drag-look that re-centres after ~2 s |
| Navigation | minimap only | minimap, GPS route, waypoint | minimap plus tap-to-waypoint; route line optional |
| Property | safehouse/garage/business | same, plus management | same, but income collectable from the phone menu |
| Story | linear chain per contact | branching with multiple endings | two-branch finale is enough to feel reactive |
| Save | save at property | autosave plus manual | autosave at owned property, manual save anywhere from menu |
| Accessibility | none | remapping, subtitles, colour-blind options | remap, subtitle size, no colour-only states |
| Traffic | density by district | density plus schedules | density by district and hour; no schedules |
| Weather | scripted | dynamic plus wet-road grip | dynamic with wetness feeding the physics |

## The mechanic checklist

Copy this table into the design doc and mark each row `v1`, `later`, or `cut`. A vertical slice
needs the bold rows only.

| Area | Mechanic | Priority | Cost |
|---|---|---|---|
| **World** | **district table, road grid, sidewalks, water, airport, docks, rail** | v1 | S |
| World | interior cells for shops and safehouses | later | M |
| World | hidden packages and unique jumps | later | S |
| **Vehicles** | **8-10 classes across car, bike, boat, helicopter, plane** | v1 | M |
| Vehicles | damage model per panel, wheels detaching | later | M |
| Vehicles | tuning shop: engine, grip, armour, nitro, paint | v1 | S |
| **Traffic** | **lane graph, signals, gap following, honking** | v1 | M |
| Traffic | schedules, buses, roadworks, congestion heat map | later | L |
| **Pedestrians** | **sidewalk loops, panic, crossing rules, no abusive barks** | v1 | M |
| Pedestrians | schedules, groups, phone calls, reactions to weather | later | L |
| **Combat** | **soft-lock shooting, melee, vehicle damage, wanted escalation** | v1 | M |
| Combat | cover, weapon crafting tree, stealth | later | L |
| **Atmosphere** | **clock, sun, sky keys, fog, rain, street lights** | v1 | S |
| Atmosphere | storms with lightning, heat haze, tides | later | M |
| **Audio** | **radio stations with identity, engine, siren, horn, UI** | v1 | M |
| Audio | licensed tracks, DJ chatter, dynamic adverts | later | L |
| **Missions** | **5-8 data-driven jobs, branching finale, checkpoints** | v1 | M |
| Missions | side jobs, races, property chains | later | L |
| **Economy** | **cash, 5-6 properties, income, garages, wardrobe** | v1 | M |
| Economy | businesses with staff and upgrades, stock market | later | L |
| **Meta** | **versioned save, settings, cheats, minimap, touch UI** | v1 | M |
| Meta | photo mode, replay, achievements, cloud saves | later | M |
| **Delivery** | **AAB, Play Asset Delivery, size and perf gates** | v1 | M |

`S` ≈ days, `M` ≈ weeks, `L` ≈ months for one experienced developer. Sum what you marked `v1`
before promising a date; the honest answer for everything here is a team, not a weekend.

## What does not survive mobile

- **Draw distance bragging.** A 1.5 km view is a PC/console feature. On a phone, fog at 500-900 m
  with a skybox that matches the fog colour reads the same and costs a fraction.
- **Hundreds of fully simulated cars.** Simulate 40-80 near the player and recycle the rest.
- **120 fps as a headline.** Sustained frame rate collapses under heat. Offer tiered presets and
  an adaptive resolution, and quote the floor.
- **Keyboard-only cheats.** Add the console to the pause menu and accept codes typed in a field.
- **Photoreal textures.** 4K maps blow the asset budget. Stylised 80s palette, emissive neon and
  good composition beat resolution on a 6-inch screen.
- **Voice-heavy story.** Every voiced line is localisation, download size and a recording budget.
  Text with strong speakers plus a few barks travels further.
- **A 9 GB install for a first release.** Play's standard ceiling is 8 GB across install-time plus
  fast-follow/on-demand packs; hitting 9 GB needs the Level Up program or a smaller scope. See
  `android-play-delivery.md`.

## Sources and confidence

Verified 2026-11-26.

- Play size limits and bundle rules: [Play Console help, app size](https://support.google.com/googleplay/android-developer/answer/9859372)
  and [Android game size guidance](https://developer.android.com/games/optimize/game-size).
- Target API requirements: [Play target API levels](https://developer.android.com/google/play/requirements/target-sdk).
- Vice City property/safehouse prices and asset income: community guides (Steam achievement guide,
  fan wikis). Approximate; treat as pacing evidence, not a source of truth.
- Definitive Edition control changes (radio wheel, weapon wheel, mission checkpoints): store pages
  and community documentation. Reasonable confidence, low precision.
- Modern GTA mechanics are described from the shipped games; no leaked or internal material is
  used, and none is needed. If a request depends on an unreleased title, say what is unknown.
