# Neon Coast — production plan

What it would take to turn this slice into a shippable single-player open-world game, and what the
honest limits are. Numbers are planning figures for a small team, not a contract.

## What exists today

| Area | In the slice | Production gap |
|---|---|---|
| World | 2.4 km² island, 3 districts, rural strip, airport, marina, rail, 26 road lines | 6-9 districts, interiors, tunnels, 3× area |
| Vehicles | 8 ground classes, 2 boats, helicopter, plane, 6 upgrades | damage panels, tuning parts per class, 40-60 unique models |
| Traffic | lane graph, signals, gap following, 40 cars | schedules, congestion, buses, roadworks |
| Pedestrians | sidewalk loops, crossing, panic, 60 peds | schedules, groups, reactions, 30-40 models |
| Police | 6 wanted levels, pursuit, roadblocks, helicopter | SWAT, boats, air pursuit, escape logic polish |
| Combat | hitscan pistol/SMG, vehicle damage, wanted heat | weapon variety, cover, melee, crafting tree |
| Atmosphere | clock, 4 weather states, emissive night, 5 stations | licensed or fully produced music, 9 stations, storms |
| Missions | 5 jobs + branching finale, checkpoints | 40-60 missions, side jobs, property chains |
| Economy | 6 properties, income, garage, wardrobe | 10-12 properties, staff, stock, business missions |
| Meta | save v2, 22 cheats, settings, touch HUD | cloud export, photo mode, achievements |
| Build | browser bundle, 2.1 MB vendored three | Android AAB, PAD packs, iOS/desktop ports |

## Size arithmetic (read this before promising 9 GB)

Play's standard App Bundle ceiling is **8 GB**: a 200 MB base module, up to 4 GB of install-time
asset packs, and up to 4 GB of fast-follow/on-demand packs. A single asset pack caps at 1.5 GB, and
no more than 100 packs are allowed. Apps over 1 GB need `minSdk 21+`; APKs over 100 MB cannot ship
at all. 30 GB of downloadable packs exists only for titles enrolled in Play's **Level Up** program
(and Android XR).

So a 9 GB game is possible only by enrolling in Level Up or by changing the target. The three
routes:

1. **Level Up, 9 GB** — verify eligibility with the Play account team before design lock. Budget
   9 GB across ~8 packs of 1.0-1.2 GB, keep the base under 200 MB so the download starts fast.
2. **Standard, 4-6 GB** — districts 1-3 installed (≈1.6 GB), districts 4-6 fast-follow (≈1.4 GB),
   airport and interiors on-demand (≈1.2 GB), audio at 96 kbps (≈250 MB). This is the recommended
   scope for a first release.
3. **Streamed assets** — not allowed as a substitute for packs for core content, and a bad fit for
   an offline game. Keep it off the roadmap.

The manifest in `skills/genres/open-world-city-game/assets/ship-budget.json` is the working
example; `scripts/check_ship_budgets.py` fails a plan that breaks any limit or budget.

## Frame budget

| Tier | Device | Target | Resolution | Shadows | Traffic / peds |
|---|---|---|---|---|---|
| Low | 4 GB, 2020 mid-range | 30 fps | 0.75 scale | off | 16 / 20 |
| Mid | 2023 mid-range | 45-60 fps | adaptive 0.8-1.0 | low, 40 m | 32 / 40 |
| High | 2025 flagship | 90-120 fps | adaptive 1.0 | medium, 70 m | 48 / 60 |

Claiming 90-120 fps means the high tier only, sustained, with dynamic resolution and reduced
density. The mid tier is the one that decides reviews.

## Content budget for v1

| Content | Count | Notes |
|---|---|---|
| Districts | 6 | downtown, beach, docks, airport, hills, rural |
| Missions | 24 | 4 story acts × 5 + 4 property chains |
| Side jobs | 6 | taxi, delivery, vigilante, races, stunt jumps, packages |
| Vehicles | 34 | 18 cars, 6 bikes, 4 boats, 3 helicopters, 2 planes, 1 novelty |
| Properties | 10 | 4 safehouses, 6 income |
| Weapons | 9 | 3 melee, 4 firearms, 2 throwables, crafting from parts |
| Radio stations | 7 | 5 licensed-or-produced, 2 talk |
| Pedestrian models | 24 | 4 per district |
| Hidden collectibles | 60 | packages + stunt jumps |

At roughly 6-9 GB compressed depending on audio and texture choices — hence the Level Up question.

## Milestones

| Phase | Weeks | Exit criteria |
|---|---|---|
| 1. Slice hardening | 1-3 | this prototype on 3 real phones, p95 frame time inside budget, no crash in 30 min |
| 2. Driving and city feel | 4-10 | 8 vehicle classes tuned by playtest, 3 districts art-passed, minimap and GPS |
| 3. Living city | 11-16 | traffic across 6 districts, 24 ped models, police escalation, no gridlock in a 20 min soak |
| 4. Story and economy | 17-26 | 24 missions, 10 properties, save migration tests, full audio pass |
| 5. Android delivery | 27-32 | AAB, PAD packs, 3 device tiers, store listing, content rating, data safety |
| 6. Beta and launch | 33-38 | 200-player closed test, crash-free rate above 99.5 %, size report reviewed |

One experienced generalist plus an artist cannot hold phase 3-4; plan for 4-6 people (engine,
gameplay/AI, art, audio, QA part-time) or cut phases 3 and 4 by half.

## Risks

- **Thermal throttling** makes a 120 fps promise age badly. Ship tiers, measure, publish the floor.
- **Traffic AI** is the most common source of "the city is fake" reviews. Budget two iterations
  after the first playable, not one.
- **Content cost** dominates: 34 vehicles and 24 missions is more work than every system here.
- **Licensed music** cannot be assumed; a synth or commissioned score is the safe default, and real
  vehicles cannot use real badges without licences.
- **Store review**: crime themes need an honest content rating; no real brands, no loot boxes, no
  data collection that the Data Safety form does not declare.
- **The 9 GB target** is an account-level question, not an engineering one. Resolve it before
  producing 9 GB of assets nobody can download.

## Next actions

1. Open the slice on an Android phone over the LAN and record p50/p95 frame time and a thermal
   trace for a 10-minute drive.
2. Replace primitive pedestrians with 4 rigged models and measure the crowd cost before modelling 24.
3. Turn the five missions into data files and add the mission editor loop (edit, reload, replay).
4. Fill the manifest for the six-district scope and run the budget checker; fix what it rejects
   before producing art.
