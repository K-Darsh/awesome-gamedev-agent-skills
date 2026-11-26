// Traffic and pedestrian simulation. Cars drive a lane graph with signal phases
// and car-following; pedestrians walk block perimeters (sidewalks) and scatter
// when they hear gunfire. Pure: no renderer, no DOM.

import { CITY } from './world.js';
import { clamp, dist2, makeRng, pick, randRange, wrapAngle } from './util.js';

const LANE_OFFSET = 3.5; // metres from the road centre line
const SIGNAL_CYCLE = 14; // seconds per phase (green + amber)

const TRAFFIC_TYPES = [
  { type: 'sedan', weight: 5, color: ['#c9c2b6', '#8d99a6', '#b05a5a', '#5f7f8c'] },
  { type: 'van', weight: 2, color: ['#d7d2c8', '#7a8c9a'] },
  { type: 'sports', weight: 1, color: ['#d94f70', '#3fa9c9', '#f0c040'] },
  { type: 'scooter', weight: 1, color: ['#8ad0c0', '#e0a0b0'] },
];

const DIRS = {
  E: { dx: 1, dz: 0, yaw: Math.PI / 2 },
  W: { dx: -1, dz: 0, yaw: -Math.PI / 2 },
  S: { dx: 0, dz: 1, yaw: 0 },
  N: { dx: 0, dz: -1, yaw: Math.PI },
};

function laneCentre(dir, fixed) {
  // Right-hand traffic: eastbound keeps to +z, southbound to -x.
  switch (dir) {
    case 'E': return { axis: 'x', fixed: fixed + LANE_OFFSET };
    case 'W': return { axis: 'x', fixed: fixed - LANE_OFFSET };
    case 'S': return { axis: 'z', fixed: fixed - LANE_OFFSET };
    case 'N': return { axis: 'z', fixed: fixed + LANE_OFFSET };
    default: throw new Error(dir);
  }
}

/** Build the directed lane graph from the street grid. */
export function createLaneNetwork() {
  const nodes = [];
  const index = new Map();
  const lines = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);
  const key = (i, j) => `${i},${j}`;
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      index.set(key(i, j), nodes.length);
      nodes.push({ id: nodes.length, i, j, x: lines[i], z: lines[j], phase: (i + j) % 2, out: [] });
    }
  }
  const edges = [];
  const addEdge = (ai, aj, bi, bj, dir) => {
    const a = nodes[index.get(key(ai, aj))];
    const b = nodes[index.get(key(bi, bj))];
    const lane = laneCentre(dir, dir === 'E' || dir === 'W' ? a.z : a.x);
    const length = CITY.pitch;
    const edge = {
      id: edges.length, a, b, dir, length,
      x0: lane.axis === 'x' ? a.x : lane.fixed,
      z0: lane.axis === 'x' ? lane.fixed : a.z,
      x1: lane.axis === 'x' ? b.x : lane.fixed,
      z1: lane.axis === 'x' ? lane.fixed : b.z,
      highway: false,
    };
    edges.push(edge);
    a.out.push(edge.id);
  };
  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines.length; j++) {
      if (i < lines.length - 1) {
        addEdge(i, j, i + 1, j, 'E');
        addEdge(i + 1, j, i, j, 'W');
      }
      if (j < lines.length - 1) {
        addEdge(i, j, i, j + 1, 'S');
        addEdge(i, j + 1, i, j, 'N');
      }
    }
  }
  return { nodes, edges, lines };
}

function edgePos(edge, t) {
  const k = clamp(t / edge.length, 0, 1);
  return { x: edge.x0 + (edge.x1 - edge.x0) * k, z: edge.z0 + (edge.z1 - edge.z0) * k };
}

function pickNextEdge(net, car, rng) {
  const options = net.nodes[car.nodeB].out;
  if (!options.length) return null;
  const straightDir = car.dir;
  const same = options.filter((id) => net.edges[id].dir === straightDir);
  const pool = same.length && rng() < 0.72 ? same : options.filter((id) => net.edges[id].dir !== opposite(straightDir));
  return pool.length ? net.edges[pick(rng, pool)] : net.edges[pick(rng, options)];
}

function opposite(dir) {
  return { E: 'W', W: 'E', S: 'N', N: 'S' }[dir];
}

export function createTraffic(world, count = 64, seed = 7) {
  const rng = makeRng(seed);
  const net = createLaneNetwork();
  const cars = [];
  for (let i = 0; i < count; i++) {
    const edge = net.edges[Math.floor(rng() * net.edges.length)];
    const p = edgePos(edge, rng() * edge.length * 0.8);
    const row = weightedTrafficType(rng);
    cars.push({
      id: i,
      type: row.type,
      color: pick(rng, row.color),
      x: p.x, z: p.z,
      yaw: DIRS[edge.dir].yaw,
      edgeId: edge.id,
      nodeB: edge.b.id,
      dir: edge.dir,
      t: rng() * edge.length * 0.8,
      speed: randRange(rng, 8, 13),
      cruise: randRange(rng, 9, 15),
      accelerator: 0,
      panic: 0,
      honk: 0,
      dead: false,
    });
  }
  return { cars, net, rng };
}

function weightedTrafficType(rng) {
  const total = TRAFFIC_TYPES.reduce((s, t) => s + t.weight, 0);
  let roll = rng() * total;
  for (const t of TRAFFIC_TYPES) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return TRAFFIC_TYPES[0];
}

/**
 * Step all traffic.
 * @param {object} traffic {cars, net, rng}
 * @param {number} dt
 * @param {object} ctx {time, player:{x,z}, world, playerVehicle}
 */
export function stepTraffic(traffic, dt, ctx) {
  const { cars, net, rng } = traffic;
  const time = ctx.time ?? 0;
  const player = ctx.player ?? { x: 0, z: 0 };

  // Spatial bucket for car-following (one bucket pass per step, no allocations in the hot loop).
  const buckets = new Map();
  const B = 24;
  for (const c of cars) {
    if (c.dead) continue;
    const k = `${Math.floor(c.x / B)},${Math.floor(c.z / B)}`;
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(c);
  }

  for (const car of cars) {
    if (car.dead) continue;
    const edge = net.edges[car.edgeId];
    car.t += car.speed * dt;

    // Recycle cars that wander far from the player so density stays around the action.
    const away = dist2(car.x, car.z, player.x, player.z);
    if (car.t >= edge.length - 0.01) {
      const next = pickNextEdge(net, car, rng);
      if (next) {
        car.edgeId = next.id;
        car.nodeB = next.b.id;
        car.dir = next.dir;
        car.t = 0;
      } else {
        car.t = edge.length;
      }
    }
    if (away > 420 * 420) {
      // Teleport the car onto a lane behind the player when out of sight range.
      const edgeNear = net.edges[Math.floor(rng() * net.edges.length)];
      car.edgeId = edgeNear.id;
      car.nodeB = edgeNear.b.id;
      car.dir = edgeNear.dir;
      car.t = 0;
      car.speed = car.cruise * 0.6;
    }

    const cur = net.edges[car.edgeId];
    const pos = edgePos(cur, car.t);
    car.x = pos.x;
    car.z = pos.z;

    // Signals: stop at the stop line when the light for this axis is red.
    const node = net.nodes[cur.b.id];
    const greenAxis = node.phase === 0 ? 'x' : 'z';
    const axis = cur.dir === 'E' || cur.dir === 'W' ? 'x' : 'z';
    const green = axis === greenAxis;
    const sincePhase = time % SIGNAL_CYCLE;
    const amber = sincePhase > SIGNAL_CYCLE - 2.5;
    const distToStop = cur.length - car.t - 3.5;
    const mustStop = !green && distToStop > -2 && distToStop < 16;
    const amberStop = green && amber && distToStop > 2 && distToStop < 10;

    // Car following: nearest car in the same direction within 18 m ahead.
    let gap = 99;
    const gx = Math.floor(car.x / B);
    const gz = Math.floor(car.z / B);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = buckets.get(`${gx + dx},${gz + dz}`);
        if (!list) continue;
        for (const other of list) {
          if (other === car) continue;
          const d = Math.hypot(other.x - car.x, other.z - car.z);
          if (d > 18 || d < 0.01) continue;
          const fwd = Math.sin(car.yaw) * (other.x - car.x) + Math.cos(car.yaw) * (other.z - car.z);
          if (fwd > 0) gap = Math.min(gap, d - 4.2);
        }
      }
    }

    // The player standing or driving in the lane is a reason to stop, not to clip through.
    if (ctx.playerVehicle && ctx.playerVehicle.y < 3) {
      const pv = ctx.playerVehicle;
      const d = Math.hypot(pv.x - car.x, pv.z - car.z);
      const fwd = Math.sin(car.yaw) * (pv.x - car.x) + Math.cos(car.yaw) * (pv.z - car.z);
      if (d < 16 && fwd > 0) gap = Math.min(gap, d - 4.5);
    }

    let target = car.cruise;
    if (mustStop || amberStop) target = Math.min(target, clamp(distToStop * 0.9, 0, car.cruise));
    if (gap < 99) target = Math.min(target, clamp(gap * 0.9, 0, car.cruise));
    if (gap < 3.5) target = 0;

    // Small rubber-band around the player to keep traffic flowing with the chase.
    const accel = target > car.speed ? 5.5 : 14;
    car.speed += clamp(target - car.speed, -accel * dt, accel * dt);
    car.speed = clamp(car.speed, 0, car.cruise * 1.15);
    car.accelerator = car.speed / Math.max(car.cruise, 1);

    // Honk when the player blocks a lane for a moment.
    if (ctx.playerVehicle && gap < 6 && car.speed < 0.5) {
      car.honk = Math.max(0, (car.honk ?? 0) - dt);
      if (car.honk <= 0) {
        car.honk = 2.5;
        car.honkedAt = time;
      }
    }
  }
  return traffic;
}

/** Remove a traffic car from the pool (destroyed or hijacked). */
export function killTrafficCar(traffic, car) {
  car.dead = true;
  const idx = traffic.cars.indexOf(car);
  if (idx >= 0) traffic.cars.splice(idx, 1);
}

// --- pedestrians ---------------------------------------------------------------

const PED_LOOKS = [
  { shirt: '#e26d5c', pants: '#2d3a4f', skin: '#e0ac7e' },
  { shirt: '#4fb0c6', pants: '#e9e3d6', skin: '#8d5524' },
  { shirt: '#f4d35e', pants: '#3a2f3d', skin: '#c68642' },
  { shirt: '#9b5de5', pants: '#1f2a36', skin: '#f1c27d' },
  { shirt: '#f7aef8', pants: '#425466', skin: '#6b4226' },
  { shirt: '#8ac926', pants: '#d9d9d9', skin: '#d9a066' },
];

export function createPedestrians(world, count = 170, seed = 31) {
  const rng = makeRng(seed);
  const peds = [];
  const blocks = world.blocks.filter((b) => b.buildings.length > 0);
  if (!blocks.length) return peds;
  for (let i = 0; i < count; i++) {
    const block = blocks[Math.floor(rng() * blocks.length)];
    const look = pick(rng, PED_LOOKS);
    const inset = CITY.sidewalk * 0.5;
    const w = block.x1 - block.x0 - inset * 2;
    const d = block.z1 - block.z0 - inset * 2;
    peds.push({
      id: i,
      x: block.x0 + inset + rng() * w,
      z: block.z0 + inset + rng() * d,
      block,
      w, d, inset,
      perim: 2 * (w + d),
      t: rng() * 2 * (w + d),
      dir: rng() < 0.5 ? 1 : -1,
      speed: randRange(rng, 1.15, 1.7),
      baseSpeed: 1.4,
      look,
      panic: 0,
      fleeX: 0, fleeZ: 0,
      bob: rng() * Math.PI * 2,
      dead: false,
      role: 'civilian',
      lastSpoke: -999,
    });
  }
  return peds;
}

function perimeterPoint(ped, t) {
  const { w, d, inset, block } = ped;
  let s = ((t % ped.perim) + ped.perim) % ped.perim;
  const x0 = block.x0 + inset;
  const z0 = block.z0 + inset;
  if (s < w) return { x: x0 + s, z: z0, yaw: 0 };
  s -= w;
  if (s < d) return { x: x0 + w, z: z0 + s, yaw: Math.PI / 2 };
  s -= d;
  if (s < w) return { x: x0 + w - s, z: z0 + d, yaw: Math.PI };
  s -= w;
  return { x: x0, z: z0 + d - s, yaw: -Math.PI / 2 };
}

export function stepPeds(peds, dt, ctx = {}) {
  for (const ped of peds) {
    if (ped.dead) continue;
    if (ped.panic > 0) {
      ped.panic = Math.max(0, ped.panic - dt);
      // Run in a straight line away from the shot, ignoring the sidewalk path briefly.
      ped.x += ped.fleeX * ped.baseSpeed * 1.9 * dt;
      ped.z += ped.fleeZ * ped.baseSpeed * 1.9 * dt;
      ped.bob += dt * 16;
      const back = perimeterPoint(ped, ped.t);
      ped.x += (back.x - ped.x) * Math.min(1, dt * 0.6);
      ped.z += (back.z - ped.z) * Math.min(1, dt * 0.6);
      continue;
    }
    ped.t += ped.baseSpeed * ped.dir * dt;
    ped.bob += dt * 6;
    const p = perimeterPoint(ped, ped.t);
    ped.x = p.x;
    ped.z = p.z;
    ped.yaw = p.yaw + (ped.dir > 0 ? 0 : Math.PI);
  }
  return peds;
}

/** Scatter pedestrians within `radius` of a loud event. */
export function panicAt(peds, x, z, radius = 42) {
  for (const ped of peds) {
    if (ped.dead) continue;
    const d2 = dist2(ped.x, ped.z, x, z);
    if (d2 > radius * radius) continue;
    const d = Math.sqrt(d2) || 1;
    ped.panic = Math.max(ped.panic, randRange(makeRng(Math.floor(x + z + ped.id)), 2.5, 5.5));
    ped.fleeX = (ped.x - x) / d;
    ped.fleeZ = (ped.z - z) / d;
  }
}

/** Nearest pedestrian to a point, for melee/roadkill/medic calls. */
export function nearestPed(peds, x, z, maxDist = 3) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const ped of peds) {
    if (ped.dead) continue;
    const d = dist2(ped.x, ped.z, x, z);
    if (d < bestD) { bestD = d; best = ped; }
  }
  return best;
}
