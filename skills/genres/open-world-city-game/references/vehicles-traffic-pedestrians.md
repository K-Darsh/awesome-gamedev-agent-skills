# Vehicles, traffic and pedestrians

Contents: the arcade handling model · surfaces, damage and modes · vehicle class table
· the lane graph and signals · car following · pedestrians · police · collision and line of sight.

Read before writing movement code. The model below is the one that produced the playable
prototype: it is stable at a fixed 1/120 s step, it never explodes when reversed into a wall, and it
turns a phone-sized city into something you can drift a sedan around.

## The arcade handling model

Work in the car's local frame. `forward(yaw) = (sin yaw, cos yaw)`, `right(yaw) = (cos yaw, -sin yaw)`.

```js
// one fixed step, dt = 1/120
const speed = Math.hypot(v.vx, v.vz);
const fwd = { x: Math.sin(v.yaw), z: Math.cos(v.yaw) };
const rgt = { x: Math.cos(v.yaw), z: -Math.sin(v.yaw) };
let vLong = v.vx * fwd.x + v.vz * fwd.z;   // read once
let vLat  = v.vx * rgt.x + v.vz * rgt.z;

const throttle = input.move.y;             // -1 reverse/brake ... +1
const steer = input.move.x;
vLong += throttle * spec.accel * dt;
if (Math.abs(throttle) < 0.05) vLong *= Math.exp(-spec.roll * dt);   // coast
vLong -= Math.sign(vLong) * spec.drag * (vLong / spec.maxSpeed) ** 2 * dt;
vLong = clamp(vLong, -spec.reverse, spec.maxSpeed * (v.wet ? 0.94 : 1));

// steering authority falls with speed, so low-speed parking is easy
const authority = 1 - 0.52 * Math.min(1, speed / spec.maxSpeed);
const turn = steer * spec.steer * authority * dt * (vLong < 0 ? -1 : 1);
v.yaw += turn * Math.min(1, 0.25 + speed / 12);

vLat *= Math.exp(-spec.grip * dt);         // lateral slip dies exponentially
vLat += turn * vLong * 0.35;               // the turn bends the velocity vector

v.vx = fwd.x * vLong + rgt.x * vLat;
v.vz = fwd.z * vLong + rgt.z * vLat;
```

Class defaults that work: `accel 10.5`, `maxSpeed 52`, `reverse 12`, `roll 0.35`, `drag 1.6`,
`steer 0.62`, `grip 6.5` for a sports car. Handbrake sets `grip 1.4` and adds 0.55 to `turn` so the
rear steps out. Motorcycles use `grip 9`, `steer 0.85` and lean for visuals only; they are not a
separate physics mode.

Three rules that keep it from breaking:

1. Read `vLong`/`vLat` once at the start, write the velocity once at the end. Interleaving engine
   and slip writes is what produces NaN or a car that slides sideways at 100 km/h.
2. Apply ground friction as an absolute value, not a multiplier, when off-road: `vLong *= 0.985`
   per 8 ms silently caps top speed.
3. Clamp `speed` before using it in the steering term and clamp the yaw delta, so a frame spike
   cannot spin the car.

## Surfaces, damage and modes

The world answers `surfaceAt(x, z)` with `road | sidewalk | grass | sand | dirt | water`. Multiply
`accel` and `maxSpeed` per surface: grass 0.72/0.55, sand 0.60/0.45, dirt 0.75/0.62, sidewalk
0.9/0.85. Wetness (0-1) lowers grip: `grip × (1 - 0.42 · wet)`, and raises braking distance.

Collision is axis-separated and costs the player speed rather than position: on a blocked x, zero
`vx` and keep 40 % of it as a bounce; same for z. Health drops with impact speed above 6 m/s.
Above 100 % damage the car smokes, above 130 % it catches fire, and 3 s later it explodes — with a
wanted-level penalty if anyone is inside.

Air vehicles are a separate mode: helicopter yaw on the right stick, climb on a vertical axis, pitch
and bank tied to velocity; plane yaw comes from bank angle with a stall speed below which gravity
wins. Do not reuse the car steering. Boats use the car model on the water surface with `grip 1.8`,
wider turn radius and a wake particle.

## Vehicle classes

| Class | accel | maxSpeed | reverse | steer | grip | Mass feel |
|---|---|---|---|---|---|---|
| Sedan | 9.5 | 41 | 11 | 0.58 | 6.0 | reference |
| Sports | 10.5 | 52 | 12 | 0.62 | 6.5 | best all-rounder |
| Supercar | 13.5 | 64 | 12 | 0.58 | 8.0 | needs long roads |
| Police | 11.0 | 50 | 12 | 0.60 | 6.8 | heavier, ram-proof |
| Van | 7.0 | 36 | 9 | 0.50 | 4.8 | slow, stable, cover |
| Motorcycle | 11.5 | 56 | 0 | 0.85 | 9.0 | fragile, no reverse |
| Scooter | 4.5 | 26 | 0 | 0.95 | 7.0 | turn radius of a moped |
| Boat | 7.0 | 26 | 6 | 0.50 | 1.8 | water only |
| Helicopter | 9.0 | 58 | 8 | yaw 1.25 rad/s | — | climb-based |
| Plane | 16.0 | 105 | 0 | bank 1.1 | — | stall 32 m/s |

Every class also carries `r` (collision radius) and `height` for camera and pickups. A two-wheeler
must skip the four-wheel body branch in the mesh builder, or every bike ships with two invisible
wheels — a bug that survives into screenshots.

## The lane graph

```text
for each road line: build two directed edges per segment
  edge = { id, ax, az, bx, bz, dir, len, lane: 3.5, next: [], prev: [] }
  +x edge runs at z - 3.5, +z edge runs at x + 3.5
at each intersection: connect incoming to outgoing with a turn table
  right turn always allowed, straight when the light is green, left only with a gap
```

Traffic cars store `{ edgeId, t (0-1), speed, desiredSpeed, colourIndex }` and derive their world
transform from the edge. Recycling a car is then free: pick a far cell, pick an edge, set `t = 0`,
reset speed. Never search for a free body at runtime; keep a fixed pool of 40-80.

Signals: phase `(i + j) % 2` on the block indices, 14 s green plus 2.5 s amber. One rule fixes half
the traffic bugs: a car may only enter an intersection when the *next* edge has room for it. Query
`edgeOccupancy(next)` for a 6 m gap.

## Car following

IDM is overkill on a phone; a gap model tuned for 60 Hz is enough:

```js
const gap = distanceToLead(edge, t) - 6;             // bumper to bumper
const desired = Math.min(edge.speedLimit, car.desiredSpeed);
const tooClose = gap < 8 + car.speed * 0.9;
const target = tooClose ? Math.max(0, (gap - 4) / (8 + car.speed * 0.9)) * desired : desired;
car.speed += clamp(target - car.speed, -9 * dt, 4.5 * dt);
```

Add 0.4-1.2 s of reaction delay per driver, a horn when blocked for 3 s, and a lane-change rule
only on straight edges with a clear 20 m gap. Rubber-banding for police: cap their desired speed at
`playerSpeed + 6 m/s` while 40-120 m away and let them close, so a chase ends.

## Pedestrians

- Sidewalk loops are closed polygons inset 1.5 m from the kerb. A ped stores `{ loopId, t, speed,
  panic, state }`.
- Crossing edges exist only at junctions and only when the parallel signal is green; a ped waiting
  at a kerb plays an idle, then walks at 1.35 m/s.
- Panic: gunshot or a car within 1.2 m sets `panic = 4-8 s`, doubles walk speed, and redirects to
  the nearest exit edge. Panic must not path through traffic.
- Barks are short, in-character, and never abusive, sexual or slurring — this is a content rule,
  not a preference. A street full of insults fails a Play content rating and offends players.
  Write 20 neutral lines per district (`"Watch it, pal."`, `"Nice ride."`) and pick by context.
- Rendering: three parts (body, head, legs) at 3-6k triangles, one shared atlas per district, 60
  units max, animated by a sine bob and a two-frame leg swing. Full skeletal crowd animation is a
  later milestone, not a v1 requirement.

## Police

Wanted level 0-6. Types by level: 1-2 cruisers and foot patrol, 3-4 interceptors plus roadblocks,
5-6 the same with a helicopter and faster pursuit. Heat rises on witnessed crimes
(`severity × min(1.6, 0.55 + 0.18 · witnesses)`), decays 0.55/s after 12 + 5 · stars seconds out of
sight. Suppressed weapons multiply heat by 0.25.

Chase behaviour: pursue by lane graph while far, switch to direct steering with obstacle avoidance
under 30 m, ram when the heading aligns, and disengage when the line of sight has been broken for
20 s. Spawn police off-screen on the road edge nearest the player's heading, never in front of the
camera.

## Collision and line of sight

- Player and vehicles collide with buildings, props and each other through a 2D circle-vs-AABB test
  per axis; no full 3D physics engine is needed for a city of boxes.
- Bullets use a segment vs AABB sweep plus a capsule test for characters. Do not raycast against
  merged city meshes per bullet; keep a coarse cell grid of colliders.
- Line of sight for AI is a segment against the same grid, sampled at 4 m.
- Every query must be budgeted: 40 cars × 1 forward query + 60 peds × 1 crossing query per frame is
  fine; 400 per frame is not.
