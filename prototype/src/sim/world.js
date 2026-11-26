// Procedural Vice-style city: districts, street grid, blocks, buildings, props,
// water, airport, rail, pickups and purchasable properties.
// Deterministic for a seed, and pure enough to unit-test in Node.

import { clamp, dist2, makeRng, pick, randInt, randRange } from './util.js';

export const CITY = {
  half: 480,
  pitch: 80,
  roadHalf: 7,
  sidewalk: 3.2,
  blocks: 12,
};

const ROAD_LINES = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);

const DISTRICTS = [
  { id: 'downtown', name: 'Neon Heights', tone: '#7fb2d8', test: (x, z) => Math.abs(x) <= 200 && Math.abs(z) <= 200 },
  { id: 'airport', name: 'Escobar Airfield', tone: '#b9c6b0', test: (x, z) => x <= -252 && z <= -110 },
  { id: 'rural', name: 'Cane Fields', tone: '#9dbb6a', test: (x, z) => z <= -262 },
  { id: 'beach', name: 'Vice Beach', tone: '#f4c7a1', test: (x, z) => z >= 238 && z < 470 },
  { id: 'docks', name: 'Harbour Docks', tone: '#8fa2b4', test: (x, z) => x >= 250 && z >= 20 && z < 240 },
  { id: 'havana', name: 'Little Havana', tone: '#d9a066', test: (x, z) => x <= -100 && z > 30 && z < 240 },
  { id: 'midtown', name: 'Midtown', tone: '#c2b3a4', test: () => true },
];

const STYLES = {
  downtown: { heights: [44, 118], counts: [1, 3], palette: ['#8fa9bf', '#b6c4d1', '#7d93a8', '#a8bccb', '#6c8296'], windowLit: 0.5, trim: '#5ee1ff' },
  beach: { heights: [7, 17], counts: [2, 4], palette: ['#f3c9a3', '#f2a7b6', '#a9e0d6', '#f7e2a0', '#e8b7c8', '#cfe7d5'], windowLit: 0.28, trim: '#ff7ac2' },
  havana: { heights: [9, 21], counts: [3, 5], palette: ['#d9a066', '#c98c6b', '#e0c088', '#c7a17a', '#b97f5c'], windowLit: 0.3, trim: '#ffb347' },
  docks: { heights: [7, 15], counts: [1, 2], palette: ['#8a94a0', '#6f7d8a', '#a8562f', '#5d6a75', '#7d8b96'], windowLit: 0.16, trim: '#ff9a3d' },
  rural: { heights: [3.5, 7.5], counts: [1, 2], palette: ['#c8b28a', '#b4916b', '#d9c3a0', '#a88a64'], windowLit: 0.2, trim: '#ffd27a' },
  airport: { heights: [8, 14], counts: [1, 2], palette: ['#c9d4dd', '#aebcc7', '#9fb0bd'], windowLit: 0.2, trim: '#9fd8ff' },
  midtown: { heights: [12, 34], counts: [2, 4], palette: ['#b8a99a', '#cfc0ad', '#9aa8b2', '#c4a894', '#a99884'], windowLit: 0.34, trim: '#8fe3c8' },
};

const PROPERTY_DEFS = [
  { id: 'hotel', name: 'Ocean View Hotel', kind: 'hotel', price: 48000, income: 900, blurb: 'A pastel landmark on the beach strip. Rest, save and watch the sunset from the roof.' },
  { id: 'resort', name: 'Coral Bay Resort', kind: 'resort', price: 85000, income: 1500, blurb: 'Private cabanas, a marina berth and the best ocean view in the city.' },
  { id: 'garage', name: 'Marquis Motors', kind: 'garage', price: 65000, income: 700, blurb: 'Ten-car garage with paint booth, spoiler rack and a wheel dyno.' },
  { id: 'workshop', name: 'Rust & Chrome', kind: 'workshop', price: 55000, income: 640, blurb: 'Armour plating, weapon bench and parts storage for crafting.' },
  { id: 'clothes', name: 'Neon Threads', kind: 'clothes', price: 30000, income: 320, blurb: 'Linen suits, bomber jackets and a wardrobe you can change into.' },
  { id: 'safehouse', name: 'Bayview Safehouse', kind: 'safehouse', price: 25000, income: 0, blurb: 'Cheap, quiet and yours. Park a car, save the game, lie low.' },
];

const PICKUP_TYPES = ['health', 'armor', 'scrap', 'weapon'];

export function createWorld(seed = 1986) {
  const rng = makeRng(seed);
  const districtByBlock = [];

  // --- water and special zones -------------------------------------------------
  const water = [
    { id: 'ocean', x0: -900, z0: 455, x1: 900, z1: 1100, name: 'Atlantic' },
    { id: 'marina', x0: 320, z0: 112, x1: 480, z1: 248, name: 'Coral Marina' },
    { id: 'inlet', x0: 400, z0: 248, x1: 480, z1: 456, name: 'Harbour Channel' },
  ];
  const airport = { x0: -452, z0: -392, x1: -300, z1: -136, runway: { x: -376, z0: -380, z1: -150, width: 46 } };
  const rail = { z: -448, x0: -480, x1: 480, station: { x: -40, z: -436, w: 34, d: 14 } };

  const inRect = (r, x, z, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
  const waterAt = (x, z) => water.find((w) => inRect(w, x, z)) ?? null;
  const inAirport = (x, z) => inRect(airport, x, z);

  function districtAt(x, z) {
    for (const d of DISTRICTS) if (d.test(x, z)) return d;
    return DISTRICTS[DISTRICTS.length - 1];
  }

  // --- street grid -------------------------------------------------------------
  const roads = [];
  for (let i = 0; i < ROAD_LINES.length; i++) {
    const line = ROAD_LINES[i];
    roads.push({ axis: 'z', at: line, from: -CITY.half, to: CITY.half, lanes: 2, highway: i === 0 || i === ROAD_LINES.length - 1 });
    roads.push({ axis: 'x', at: line, from: -CITY.half, to: CITY.half, lanes: 2, highway: i === 0 || i === ROAD_LINES.length - 1 });
  }
  // The outermost grid lines are the ring highway; the beach front is a wide avenue.
  for (const r of roads) {
    if (Math.abs(r.at) >= CITY.half) {
      r.highway = true;
      r.lanes = 4;
    }
  }

  const blocks = [];
  const buildings = [];
  const props = [];
  const intersections = [];
  const parking = [];

  const blocksPer = CITY.blocks;
  const halfBlock = CITY.pitch / 2 - CITY.roadHalf;

  for (let bz = 0; bz < blocksPer; bz++) {
    for (let bx = 0; bx < blocksPer; bx++) {
      const cx = -CITY.half + CITY.roadHalf + halfBlock + bx * CITY.pitch;
      const cz = -CITY.half + CITY.roadHalf + halfBlock + bz * CITY.pitch;
      const x0 = cx - halfBlock;
      const x1 = cx + halfBlock;
      const z0 = cz - halfBlock;
      const z1 = cz + halfBlock;

      if (waterAt(cx, cz) || inAirport(cx, cz)) {
        districtByBlock.push(inAirport(cx, cz) ? 'airport' : 'water');
        continue;
      }

      const district = districtAt(cx, cz);
      const style = STYLES[district.id];
      const block = { id: blocks.length, bx, bz, cx, cz, x0, z0, x1, z1, district: district.id, buildings: [] };

      const inner = CITY.sidewalk + 1.4;
      const usableW = x1 - x0 - inner * 2;
      const usableD = z1 - z0 - inner * 2;
      const [cMin, cMax] = style.counts;
      const count = randInt(rng, cMin, cMax);
      const cols = count >= 3 ? 2 : 1;
      const rows = Math.ceil(count / cols);
      const cellW = usableW / cols;
      const cellD = usableD / rows;
      let placed = 0;

      for (let r = 0; r < rows && placed < count; r++) {
        for (let c = 0; c < cols && placed < count; c++) {
          if (district.id === 'rural' && rng() < 0.45) continue; // fields
          const pad = randRange(rng, 0.8, 3.0);
          const w = Math.max(6, cellW - pad * 2);
          const d = Math.max(6, cellD - pad * 2);
          const bxc = x0 + inner + cellW * (c + 0.5);
          const bzc = z0 + inner + cellD * (r + 0.5);
          const h = randRange(rng, style.heights[0], style.heights[1]) * (district.id === 'downtown' ? randRange(rng, 0.7, 1.25) : 1);
          const color = pick(rng, style.palette);
          const b = {
            id: buildings.length,
            x: bxc, z: bzc, w, d, h,
            color,
            trim: style.trim,
            lit: style.windowLit * randRange(rng, 0.7, 1.35),
            district: district.id,
            roof: district.id === 'docks' ? 'flat' : district.id === 'beach' ? 'step' : rng() < 0.25 ? 'setback' : 'flat',
          };
          buildings.push(b);
          block.buildings.push(b.id);
          placed++;
        }
      }

      blocks.push(block);
      districtByBlock.push(district.id);

      // Palms on the beach and in Havana, trees in the cane fields.
      if (district.id === 'beach' || district.id === 'havana') {
        const n = district.id === 'beach' ? 5 : 2;
        for (let i = 0; i < n; i++) {
          props.push({
            type: 'palm',
            x: randRange(rng, x0 + 1.5, x1 - 1.5),
            z: randRange(rng, z0 + 1.5, z1 - 1.5),
            h: randRange(rng, 7, 12),
            solid: false,
          });
        }
      }
      if (district.id === 'rural') {
        for (let i = 0; i < 3; i++) {
          props.push({ type: 'tree', x: randRange(rng, x0, x1), z: randRange(rng, z0, z1), h: randRange(rng, 4, 8), solid: false });
        }
      }
      if (district.id === 'docks' && rng() < 0.5) {
        props.push({ type: 'crate', x: randRange(rng, x0, x1), z: randRange(rng, z0, z1), solid: true, r: 1.4 });
      }
    }
  }

  // --- street furniture along every kerb --------------------------------------
  for (const line of ROAD_LINES) {
    for (let t = -CITY.half + 16; t <= CITY.half - 16; t += 34) {
      for (const axis of ['x', 'z']) {
        const x = axis === 'x' ? line + CITY.roadHalf + 1.2 : t;
        const z = axis === 'x' ? t : line + CITY.roadHalf + 1.2;
        if (waterAt(x, z) || inAirport(x, z)) continue;
        props.push({ type: 'streetlight', x, z, solid: false });
      }
    }
  }
  for (let i = 0; i < ROAD_LINES.length; i++) {
    for (let j = 0; j < ROAD_LINES.length; j++) {
      const x = ROAD_LINES[i];
      const z = ROAD_LINES[j];
      if (waterAt(x, z)) continue;
      intersections.push({ x, z, i, j, phase: (i + j) % 2 });
    }
  }

  // --- landmarks, properties, docks, airport, rail -----------------------------
  const properties = PROPERTY_DEFS.map((def, i) => {
    // Spread properties over distinct districts so buying one is a real trip.
    const spots = [
      [148, 296], [-168, 136], [32, 232], [268, 92], [-96, 72], [-296, -300],
    ];
    const [x, z] = spots[i % spots.length];
    const b = {
      id: buildings.length,
      x, z, w: 22, d: 18, h: def.kind === 'resort' ? 26 : def.kind === 'hotel' ? 32 : 14,
      color: def.kind === 'hotel' ? '#f2a7b6' : def.kind === 'resort' ? '#a9e0d6' : def.kind === 'garage' ? '#7d93a8' : def.kind === 'workshop' ? '#8a6a52' : def.kind === 'clothes' ? '#e0c088' : '#cfc0ad',
      trim: def.kind === 'hotel' ? '#ff7ac2' : '#5ee1ff',
      lit: 0.55, district: districtAt(x, z).id, roof: 'step', landmark: true, property: def.id,
    };
    buildings.push(b);
    return {
      ...def,
      x, z,
      door: { x: x + (x < 0 ? 14 : -14), z: z + 12 },
      owned: false,
      incomeAccrued: 0,
      missionDone: false,
    };
  });

  // Landmarks are hand-placed, so clear the block buildings they would intersect.
  const landmarks = buildings.filter((b) => b.landmark);
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (b.landmark) continue;
    const clash = landmarks.some(
      (l) => Math.abs(b.x - l.x) < (b.w + l.w) / 2 + 2.5 && Math.abs(b.z - l.z) < (b.d + l.d) / 2 + 2.5,
    );
    if (clash) buildings.splice(i, 1);
  }

  // Docks: cranes and container stacks along the marina edge.
  for (let i = 0; i < 8; i++) {
    props.push({ type: 'crane', x: 300 + i * 6, z: 120 + (i % 3) * 26, solid: true, r: 3, h: 26 });
  }
  // Airport hangars + tower, outside the runway footprint.
  props.push({ type: 'tower', x: -310, z: -120, solid: true, r: 4, h: 24 });
  props.push({ type: 'hangar', x: -300, z: -300, solid: true, r: 9, h: 12 });
  props.push({ type: 'hangar', x: -300, z: -220, solid: true, r: 9, h: 12 });

  // Rail station canopy and a level crossing barrier.
  props.push({ type: 'station', x: rail.station.x, z: rail.station.z, solid: true, r: 12, h: 9 });

  // --- vehicles parked around the map -----------------------------------------
  const parked = [
    { type: 'supercar', x: 120, z: 300, yaw: Math.PI },
    { type: 'sports', x: 40, z: 244, yaw: 0.2 },
    { type: 'sedan', x: -150, z: 244, yaw: -0.4 },
    { type: 'bike', x: 12, z: 240, yaw: 0.8 },
    { type: 'scooter', x: 20, z: 240, yaw: 1.4 },
    { type: 'van', x: -132, z: 132, yaw: 2.2 },
    { type: 'police', x: -260, z: 60, yaw: 0 },
    { type: 'sports', x: 292, z: 96, yaw: 1.2 },
    { type: 'boat', x: 380, z: 190, yaw: 0.6 },
    { type: 'boat', x: 420, z: 210, yaw: 1.4 },
    { type: 'helicopter', x: -330, z: -120, yaw: 0.4 },
    { type: 'plane', x: -376, z: -200, yaw: 0 },
  ];
  for (const p of parked) parking.push({ ...p, occupied: false });

  // --- pickups ----------------------------------------------------------------
  const pickups = [];
  const pickupSpots = [];
  for (let i = 0; i < 46; i++) {
    for (let tries = 0; tries < 12; tries++) {
      const x = randRange(rng, -CITY.half + 20, CITY.half - 20);
      const z = randRange(rng, -CITY.half + 20, CITY.half - 20);
      if (waterAt(x, z) || inAirport(x, z)) continue;
      if (pickupSpots.some((s) => dist2(s.x, s.z, x, z) < 60 * 60)) continue;
      pickupSpots.push({ x, z });
      const type = i % 11 === 0 ? 'weapon' : PICKUP_TYPES[randInt(rng, 0, 2)];
      pickups.push({
        id: pickups.length,
        type,
        weapon: type === 'weapon' ? (i % 2 ? 'smg' : 'pistol') : null,
        x, z, active: true, respawnAt: 0,
      });
      break;
    }
  }

  // --- fast lookups -----------------------------------------------------------
  const gridSize = 48;
  const gridHalf = 1000;
  const gridDim = Math.ceil((gridHalf * 2) / gridSize);
  const buildingGrid = new Map();
  const propGrid = new Map();
  const cellKey = (x, z) => {
    const gx = Math.floor((x + gridHalf) / gridSize);
    const gz = Math.floor((z + gridHalf) / gridSize);
    return gx * 4096 + gz;
  };
  const addToGrid = (grid, x, z, item) => {
    const key = cellKey(x, z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(item);
  };
  for (const b of buildings) addToGrid(buildingGrid, b.x, b.z, b);
  for (const p of props) if (p.solid) addToGrid(propGrid, p.x, p.z, p);

  const nearbyCells = (grid, x, z, radius, out) => {
    out.length = 0;
    const r = Math.ceil(radius / gridSize);
    const gx = Math.floor((x + gridHalf) / gridSize);
    const gz = Math.floor((z + gridHalf) / gridSize);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = grid.get((gx + dx) * 4096 + (gz + dz));
        if (list) out.push(...list);
      }
    }
    return out;
  };

  // Two scratch buffers: surfaceAt() calls blocked() while iterating buildings.
  const scratchB = [];
  const scratchP = [];
  const nearBuildings = (x, z, radius = 60) => nearbyCells(buildingGrid, x, z, radius, scratchB);
  const nearProps = (x, z, radius = 40) => nearbyCells(propGrid, x, z, radius, scratchP);

  function onRoad(x, z) {
    if (Math.abs(x) > CITY.half + 8 || Math.abs(z) > CITY.half + 8) return false;
    for (const line of ROAD_LINES) {
      if (Math.abs(x - line) <= CITY.roadHalf || Math.abs(z - line) <= CITY.roadHalf) return true;
    }
    return false;
  }

  function surfaceAt(x, z) {
    if (waterAt(x, z)) {
      // Streets crossing the marina or the inlet carry a bridge deck.
      if (onRoad(x, z)) return 'road';
      return 'water';
    }
    if (inAirport(x, z)) return 'road';
    if (onRoad(x, z)) return 'road';
    if (z > 430 && z < 460) return 'sand';
    for (const b of nearBuildings(x, z, 60)) {
      if (x > b.x - b.w / 2 - CITY.sidewalk && x < b.x + b.w / 2 + CITY.sidewalk && z > b.z - b.d / 2 - CITY.sidewalk && z < b.z + b.d / 2 + CITY.sidewalk) return 'sidewalk';
    }
    const d = districtAt(x, z).id;
    if (d === 'rural') return 'grass';
    if (d === 'docks') return 'dirt';
    return 'sidewalk';
  }

  function blocked(x, z, r = 0.4) {
    if (x < -CITY.half - 120 || x > CITY.half + 120 || z < -CITY.half - 120 || z > 470) return true;
    for (const b of nearBuildings(x, z, 80)) {
      if (x > b.x - b.w / 2 - r && x < b.x + b.w / 2 + r && z > b.z - b.d / 2 - r && z < b.z + b.d / 2 + r) return true;
    }
    for (const p of nearProps(x, z, 40)) {
      if (!p.r) continue;
      if (dist2(x, z, p.x, p.z) < (p.r + r) * (p.r + r)) return true;
    }
    return false;
  }

  function nearestRoad(x, z) {
    let best = { axis: 'x', at: 0, dist: Infinity };
    for (const line of ROAD_LINES) {
      const dx = Math.abs(x - line);
      const dz = Math.abs(z - line);
      if (dz < best.dist) best = { axis: 'x', at: line, dist: dz };
      if (dx < best.dist) best = { axis: 'z', at: line, dist: dx };
    }
    return best;
  }

  function randomRoadPoint(rng2 = rng) {
    for (let i = 0; i < 200; i++) {
      const x = randRange(rng2, -CITY.half + 10, CITY.half - 10);
      const z = randRange(rng2, -CITY.half + 10, CITY.half - 10);
      if (onRoad(x, z) && !waterAt(x, z) && !inAirport(x, z) && !blocked(x, z, 1.2)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  // Park every ground vehicle on a lane, aligned with the road. A car left
  // nose-first against a wall cannot be driven out, and one parked across a
  // lane is a traffic jam the player cannot clear.
  const VEHICLE_BOX = {
    sedan: [1.9, 4.7], sports: [1.95, 4.5], supercar: [2.0, 4.6], police: [1.95, 4.9],
    bike: [0.75, 2.1], scooter: [0.7, 1.8], van: [2.1, 5.4],
  };
  const fits = (x, z, yaw, len, wid) => {
    const f = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    for (const a of [-len / 2, 0, len / 2]) {
      for (const b of [-wid / 2, 0, wid / 2]) {
        if (blocked(x + f.x * a + r.x * b, z + f.z * a + r.z * b, 0.35)) return false;
      }
    }
    return true;
  };
  for (const spot of parking) {
    if (!VEHICLE_BOX[spot.type]) continue;
    const [wid, len] = VEHICLE_BOX[spot.type];
    const road = nearestRoad(spot.x, spot.z);
    const alongX = road.axis === 'x';
    const yaws = alongX ? [Math.PI / 2, -Math.PI / 2] : [0, Math.PI];
    const lanes = alongX
      ? [{ x: spot.x, z: road.at - 4 }, { x: spot.x, z: road.at + 4 }]
      : [{ x: road.at - 4, z: spot.z }, { x: road.at + 4, z: spot.z }];
    let placed = false;
    for (const lane of lanes) {
      for (const yaw of yaws) {
        if (waterAt(lane.x, lane.z)) continue;
        if (!fits(lane.x, lane.z, yaw, len, wid)) continue;
        spot.x = lane.x;
        spot.z = lane.z;
        spot.yaw = yaw;
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      const point = randomRoadPoint();
      spot.x = point.x;
      spot.z = point.z;
      const fallback = nearestRoad(point.x, point.z);
      spot.yaw = fallback.axis === 'x' ? Math.PI / 2 : 0;
    }
  }

  const world = {
    seed,
    size: CITY.half * 2,
    city: CITY,
    roads, blocks, buildings, props, intersections, parking, pickups, properties,
    water, airport, rail, districts: DISTRICTS,
    districtAt, surfaceAt, blocked, onRoad, nearestRoad, waterAt, inAirport, randomRoadPoint,
    nearBuildings, nearProps,
    bounds: { x0: -CITY.half, z0: -CITY.half, x1: CITY.half, z1: CITY.half },
  };
  return world;
}

/** Paved area check used by the radio DJ and by mission routing. */
export function roadKind(world, x, z) {
  if (!world.onRoad(x, z)) return null;
  const r = world.nearestRoad(x, z);
  return r.dist <= CITY.roadHalf ? 'street' : 'pavement';
}

export function propertyAt(world, x, z, radius = 9) {
  for (const p of world.properties) if (dist2(x, z, p.door.x, p.door.z) < radius * radius) return p;
  return null;
}

export function clampToCity(x, z) {
  return { x: clamp(x, -CITY.half + 8, CITY.half - 8), z: clamp(z, -CITY.half + 8, 450) };
}
