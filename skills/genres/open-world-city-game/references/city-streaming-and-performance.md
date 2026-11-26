# City streaming and performance

Contents: the size maths · the grid and district contract · streaming cells · LOD ladder ·
draw-call and texture budgets · device tiers and frame pacing · measurement plan.

Read before generating a map or promising a frame rate. Every number here is a budget, not an
aspiration; the checker in `scripts/check_ship_budgets.py` enforces the content side.

## The size maths

Metres are the world unit. A 2 km × 2 km island is 4 km² of ground; at 80 m block pitch that is
25 × 25 blocks, 625 blocks, about 1,200 buildings and 50 km of road. That is already a vertical
slice bigger than most players will walk. GTA V's map is roughly 80 km²; Vice City's two islands
are around 10-15 km² of playable land. Do not start from those numbers.

```text
cellsPerEdge = ceil(mapSize / cellSize)            // 2000 / 250 = 8
buildings    = cellsPerEdge² × perCell             // 8² × 18 ≈ 1,150
roadKm       = roadLines × mapSize / 1000          // 26 × 2 km ≈ 52 km
triBudget    = visibleCells × perCellTriangles     // 9 × 22k ≈ 200k triangles on screen
```

Pick the map so the fastest vehicle can cross it in 90-120 s. At 64 m/s that is 5.8-7.7 km of
straight road; a 2 km map crossed diagonally at 2.8 km gives 44 s of flat-out driving, which feels
small. 3 km × 3 km with highways and a bridge loop is the sweet spot for a phone slice.

## World contract

Write these as constants in one file and import them everywhere. Two files disagreeing about road
width is the most common source of "cars on the pavement".

| Constant | Value | Why |
|---|---|---|
| `UNIT` | 1 m | matches art, physics and audio attenuation |
| `ROAD_HALF` | 7 | two 3.5 m lanes; one lane each way |
| `LANE_OFFSET` | 3.5 | traffic centres |
| `SIDEWALK_W` | 3 | ped loops and kerb clearance |
| `BLOCK_PITCH` | 80 | 66 m of building + 14 m of road |
| `SIGNAL_CYCLE` | 14 s green + 2.5 s amber | short enough to observe while testing |
| `CELL` | 250 m | streaming granularity, road lines never split a cell |
| `FOG_NEAR/FAR` | 120 / 900 | hides the streaming edge |
| `CLOCK` | 0-24 h, 1 game minute = 1 real second at default | 24 real minutes per day |

Roads run on a grid: lines at `-half + i · pitch`. Right-hand traffic means the +x direction uses
the lane at `z - 3.5` and the +z direction uses `x + 3.5`. Keep that convention in the lane
builder so traffic, AI and mission waypoints agree.

## Streaming cells

- Build content per cell: one merged mesh per material per cell, one collision mesh per cell, one
  prop instance list.
- Keep 3 × 3 cells resident around the camera (750 m reach at 250 m cells) and 5 × 5 for aircraft
  at altitude. Swap cells on a frame budget: at most one load per frame, off the main thread where
  the engine allows it.
- Unload behind the camera only when the player has moved two cells away, so a fast U-turn does not
  hit a hole.
- Streaming is not the same as culling: keep frustum culling and distance culling on top.

## LOD ladder

| Distance | Buildings | Vehicles | Pedestrians | Props |
|---|---|---|---|---|
| 0-60 m | full mesh, interior fake-outs | full mesh, 4 wheels, lights | skinned or 3-part rig | full |
| 60-180 m | one merged mesh, no interior | one mesh + wheels | 2 LODs, no fingers | full |
| 180-450 m | merged block silhouette | box + lights | billboard card | merged |
| 450-900 m | impostor/skyline card | none (culled) | none | none |

Two LODs per asset is enough on mobile. Autorun a script that reports triangle counts per LOD and
fails when a building's LOD1 exceeds 35 % of LOD0.

## Draw-call and texture budgets

Per frame, on a mid-range phone at 30 fps:

| Metric | Budget | Alarm |
|---|---|---|
| Draw calls | 120 | 220 |
| Triangles | 300k | 600k |
| Unique materials on screen | 24 | 45 |
| Texture memory | 220 MB | 400 MB |
| Skinned meshes | 12 | 24 |
| Realtime lights | 1 directional + 6 point/fake | 4 + 12 |
| Transparent overdraw (screen area) | 1.8× | 3× |
| Physics bodies awake | 90 | 200 |
| GC allocations in the update loop | 0 B/frame | 2 KB/frame |

Hitting those means: atlases per district, one material per vehicle paint via vertex colour or a
palette texture, instanced street props, pooled traffic and peds, decals baked into the road
texture, and a supply of fake lights (emissive quads) instead of real ones.

Textures: ASTC 4×4 to 6×6 for hero assets, 8×8 for props, power-of-two, mipmaps on, no read/write,
no runtime resizing. Ship per-device variants only when the memory saving is measured.

## Device tiers and frame pacing

| Tier | Example | Target | Resolution | Shadows | Traffic | Peds |
|---|---|---|---|---|---|---|
| Low | 4 GB RAM, 2020 mid-range | 30 fps | 0.75 scale | off, baked kerb | 16 | 20 |
| Mid | 2023 mid-range | 45-60 fps | 0.85-1.0 | low, 40 m | 32 | 40 |
| High | flagship 2025+ | 90-120 fps | 1.0 with dynamic scale | medium, 70 m | 48 | 60 |

Rules that keep it honest:

- Frame budget = 1000 / target ms. At 120 fps that is 8.3 ms for everything; a single shadow pass
  can eat it. High tier drops shadows to a blob plus a baked strip.
- Dynamic resolution from a 3-frame average of GPU time, clamped to 0.6-1.0. Never oscillate every
  frame; change by 0.05 and hold for 0.5 s.
- Simulate at a fixed step (1/120 s or 1/60 s) and render interpolated. Physics tied to frame rate
  makes handling differ between a cool and a hot phone.
- Cap hidden costs: no `GetComponent`/`find` in update, no string concatenation per frame, pooled
  particles, one coroutine scheduler.
- Measure with the platform's frame profiler (Android GPU Inspector, Unity Profiler, Unreal
  Insights), not by watching the counter. Log p50/p95 frame time and thermal state for a 10-minute
  drive and a 5-minute chase.

## Measurement plan

1. Cold start to drivable: under 8 s on mid tier; show a progress state, never a frozen splash.
2. Ten-minute drive through three districts: p95 frame time under 1.3 × budget, no hitch over 100 ms.
3. Chase with 6 police cars and 40 peds: same p95, zero GC spikes in the log.
4. Install size and first-run download size recorded from the Play Console report, not the build
   folder.
5. Battery and thermal: device warm after 10 minutes is expected; a frame-rate cliff is not.

Record numbers in the repo next to the build, and re-run after any content addition. A budget you
do not measure is a wish.
