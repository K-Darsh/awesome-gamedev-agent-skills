# Neon Coast — playable vertical slice

A GTA: Vice City–style open-world prototype in three.js: one 2.4 km² island with three districts, a
rural strip, an airport, a marina and a rail line. Runs entirely offline in a browser (desktop or
phone), saves to local storage, and boots in about a second.

**This is not an APK and not the 9 GB game.** It is the playable slice that proves the systems: map,
driving, traffic, pedestrians, police, weather, missions, property, garage, cheats, saves. The
production path to a shipped Android build — including the size arithmetic that rules out a 9 GB
install — is in [`docs/production-plan.md`](docs/production-plan.md).

## Run it

```bash
cd prototype
python3 -m http.server 8123 --bind 0.0.0.0
# open http://localhost:8123
```

Any static server works; ES modules need HTTP, not `file://`. three.js r187 is vendored in
`vendor/`, so the page has no external requests.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move / steer | WASD or arrows | left stick |
| Look / aim | mouse drag | drag right half |
| Enter / exit vehicle | E | car button |
| Fire | F | fire button |
| Sprint / handbrake | Shift / Space | buttons |
| Jump | Space | jump button |
| Radio | Q | radio button |
| Cheat console | C | pause menu → codes |
| Settings | G | gear button |
| Help | H | ? button |

## What works

- **Map** — procedural island: downtown towers, beach strip, docks, airport with runway, marina,
  cane fields, highway ring, bridges, railway with stations, hidden pickups. Minimap with roads,
  water, pickups, owned properties, waypoint and mission marker.
- **Driving** — eight ground classes plus boats, a helicopter and a plane; speed-sensitive steering,
  lateral grip, handbrake slides, surface and wetness grip, damage, explosions, wheels that spin.
- **Traffic and peds** — lane graph with signals, gap following, honking; pedestrians on sidewalk
  loops who cross at lights and panic at gunfire; no abusive barks.
- **Police** — six wanted levels, witness-weighted heat, cruisers that pursue by road, roadblocks,
  helicopter at high heat, decay when out of sight.
- **Atmosphere** — 24-minute day, sunrise-through-night sky keys, fog, rain, storms with lightning,
  wet roads, emissive night city, five radio stations with a synth fallback and station idents.
- **Missions** — five data-driven jobs (courier, tail, repo, finale with two branches) with
  checkpoints, timers, damage limits, fail and retry.
- **Economy** — six property types with income, in-person collection, garages, six vehicle
  upgrades, wardrobe, weapon crafting.
- **Meta** — versioned save with migration, safehouse save points, 22 cheat codes typed into an
  on-screen console, settings for quality, resolution scale, volume and control layout.

## Tests

```bash
cd prototype
node tests/run_tests.mjs        # 36 simulation checks
node tests/contract_test.mjs    # 7 static wiring checks
node tests/integration_test.mjs # 16 full-loop checks with stub renderer
node tests/dom_test.mjs         # 8 HUD/input checks (needs jsdom, install --no-save)
```

`tests/browser_smoke.mjs` drives a real Chromium for screenshots; it needs a machine with a GPU
stack (`BASE_URL=… node tests/browser_smoke.mjs`). It cannot run in a headless container without
`libnss3`.

## Known gaps

- No GL context in the build container, so rendering was verified by contract tests and stub
  injection, not by eye. The first thing to check on a real device is the console and the frame
  time on the beach at night.
- Art is primitive geometry with flat colours: no textures, no skinned characters, no licensed
  music. Those are content production, not code.
- Traffic and pedestrians are simulated only within 160 m; distant roads are empty by design.
- No interior cells, no swimming, no aircraft autopilot, no controller remapping beyond the
  keyboard map.
