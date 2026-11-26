# Missions, economy and saves

Contents: mission runtime · step kinds and fail rules · branching · retry and checkpoint economics
· property catalogue and income maths · garages and upgrades · safehouse saves · save schema,
versioning and offline storage.

Read before designing quests or pricing anything. The three systems are coupled: a mission pays
into the economy, the economy gates the next mission's vehicle, and the save file must hold both.

## Mission runtime

One runner, one active mission, a queue of steps. Missions are data; the runner is ~200 lines.

```js
{ id: 'tail', contact: 'ruiz', pay: 3200, fail: { time: 240, maxVehicleDamage: 45 },
  steps: [
    { kind: 'goto', x: 296, z: 158, radius: 7 },
    { kind: 'tail', target: 'courier', min: 12, max: 48, exposure: 2.5, lose: 9 },
    { kind: 'deliver', x: 148, z: 296, radius: 8 }
  ],
  branch: null }
```

Runner contract: `start(id)`, `update(dt)`, `onEvent(e)`, `abort(reason)`; it emits
`{ type: 'objective' | 'step' | 'fail' | 'complete', ... }` and the HUD renders from those events.
Never let the mission read the HUD, and never let the HUD own objective text.

## Step kinds

| Kind | Completes when | Fails when |
|---|---|---|
| `goto` | player within radius | timer expires |
| `deliver` | vehicle or cargo within radius, speed < 2 m/s | vehicle destroyed, timer |
| `tail` | distance kept in band for `exposure` s | target lost for `lose` s, too close |
| `ram` | target health below threshold | target escapes |
| `checkpoints` | ordered rings hit | timer, wrong order beyond a 20 m grace |
| `escape` | wanted level reaches 0 | police damage kills the player |
| `survive` | timer | health reaches 0 |

Add `onEnter` hooks for dialogue and spawns, and `hint` strings that the HUD shows only after 20 s
of no progress. Environment-led guidance beats arrows: a flare, a marker, a unique car plate.

## Branching

Branch on a single decision event, not on a tangle of flags:

```js
{ id: 'finale', requires: { missions: 2 }, branch: {
    a: { id: 'finale_marina', pay: 9000, vehicle: 'boat' },
    b: { id: 'finale_ruiz',   pay: 9000, vehicle: 'plane' } } }
```

The save stores `missions.completed[]` and `missions.branch`. The other branch stays playable in a
new game plus or a second ending; do not delete content the player did not see, just mark it.

## Retry and checkpoint economics

- Checkpoint every step. Retry restarts from the last checkpoint, charges a small fee
  (2-5 % of pay) and refunds 35 s of the timer.
- A failed mission must never take more than 10 s to retry: fail screen, reason, retry button.
- Death is not a fail screen only: it is a hospital respawn, a cash charge, weapons kept unless the
  design says otherwise. Decide once and write it in the doc.
- Pay should scale with risk, not with distance. A 4-minute delivery pays about as much as a
  3-minute chase; a finale pays 2-3× a base job.

## Property catalogue

| Type | Price band | Income / game day | Gate | Player value |
|---|---|---|---|---|
| Safehouse | 8-12k | — | none | save point, garage, wardrobe |
| Hotel | 25k | 250-450 | buy + 2 jobs | save point near a district |
| Resort | 60k | 600-900 | 3 jobs | save, garage, spawn point |
| Garage | 30k | 350-500 | 1 job | 10 slots, tuning |
| Workshop | 45k | 500-700 | 2 jobs | performance parts, respray |
| Clothes shop | 20k | 200-300 | 1 job | wardrobe, discounts |
| Nightclub | 90k | 1,200-1,800 | 4 jobs | late-game income, music |

Income accrues per game hour at `income / 24`, capped at 3 game days, and is collected in person
at the property (a 2 s interaction) or from the phone menu once the player owns three properties.
Buying refunds 55 % on sale. A player should afford the first safehouse after 3-4 jobs and a hotel
after 8-10; if the curve is steeper, the fun arrives after the session ends.

Do not gate income behind a real-time timer. A phone player who returns after a day should find
capped income, not a debt.

## Garages and upgrades

Ten slots, one car per slot, keyed by vehicle id and a `tuning` record. Upgrades require the
property type that sells them: engine (+25 % accel, +18 % top speed), grip (+15 %), armour (+60
health), nitro (100 units, 3 s burn), paint and rim cosmetics. Store upgrades as ids, not multipliers,
so balance changes apply retroactively.

## Safehouse saves

- Saving is only allowed at an owned door or a hotel room (and from the pause menu once the player
  owns two properties, as a quality-of-life unlock).
- The save stores: version, timestamp, seed, clock, weather, position, player stats, economy,
  missions, settings. Autosave on mission complete and on entering an owned property; a manual save
  writes the same record.
- Write atomically: serialise to a temp key, then swap, or use two alternating slots. A half-written
  save on a phone that dies at 4 % battery is the classic data-loss bug.

## Save schema and migration

```json
{ "version": 2, "savedAt": 1764200000000, "seed": 1986, "clock": 21.4, "weather": "rain",
  "position": { "x": 82, "z": 292 }, "player": { "health": 100, "armour": 0, "cash": 1500,
  "weapons": { "pistol": 24 }, "wardrobe": ["tee"] },
  "economy": { "properties": ["hotel"], "garage": [], "spent": 25000, "earned": 800 },
  "missions": { "completed": ["courier"], "branch": null },
  "settings": { "quality": "mid", "volume": 0.7 } }
```

Parse results: `empty | corrupt | newer-version | invalid`. Never crash on a newer save; show
"this save was made by a newer version" and keep it untouched. Migrations are pure functions
`v1 → v2 → ...` with a test per step and a fixture per version in the repo.

Offline-first: store to the platform's local database or file (SQLite on Android, IndexedDB or
localStorage in a browser), never require a network round trip to play or save. If the player asks
for a cloud copy, export a JSON file and let them upload it to their own storage; do not silently
sync anything that a store's data-safety declaration would have to disclose.
