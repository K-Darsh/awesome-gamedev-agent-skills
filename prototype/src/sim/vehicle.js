// Arcade vehicle simulation shared by every drivable thing in the world.
// Pure maths: no DOM, no three.js, no globals. `stepVehicle` runs at a fixed
// timestep chosen by the caller (the game uses 1/120 s).

import { clamp, damp, moveTowards, wrapAngle } from './util.js';

const GRAVITY = 9.81;

/**
 * Grip and rolling-resistance multipliers per surface. `road` is the reference;
 * grass and sand punish speed, sidewalk is drivable but jumpy, water only floats boats.
 */
export const SURFACES = {
  road: { grip: 1, accel: 1, drag: 0 },
  sidewalk: { grip: 0.96, accel: 0.9, drag: 0.15 },
  grass: { grip: 0.7, accel: 0.6, drag: 0.5 },
  sand: { grip: 0.62, accel: 0.5, drag: 0.7 },
  dirt: { grip: 0.78, accel: 0.72, drag: 0.35 },
  water: { grip: 0.2, accel: 0.1, drag: 1.4 },
};

/** Handling specs in SI units: metres, seconds, radians. */
export const VEHICLE_SPECS = {
  sedan: {
    name: 'Regent Sedan', klass: 'Sedan', mode: 'ground', seats: 4,
    maxSpeed: 41, accel: 7.4, brake: 17, grip: 6.4, steer: 0.58, wheelbase: 2.85,
    length: 4.7, width: 1.9, height: 1.45, mass: 1450, health: 100, doors: 4,
    body: 'paint', r: 0.95,
  },
  sports: {
    name: 'Marquis GT', klass: 'Sports car', mode: 'ground', seats: 2,
    maxSpeed: 52, accel: 10.5, brake: 20, grip: 7.4, steer: 0.52, wheelbase: 2.65,
    length: 4.5, width: 1.95, height: 1.24, mass: 1320, health: 100,
    body: 'paint', spoiler: true, r: 0.95,
  },
  supercar: {
    name: 'Vice Venom', klass: 'Supercar', mode: 'ground', seats: 2,
    maxSpeed: 64, accel: 13.4, brake: 22, grip: 8.6, steer: 0.5, wheelbase: 2.7,
    length: 4.6, width: 2.0, height: 1.16, mass: 1380, health: 100,
    body: 'paint', spoiler: true, r: 1.0,
  },
  police: {
    name: 'VCPD Cruiser', klass: 'Police', mode: 'ground', seats: 4,
    maxSpeed: 49, accel: 10.2, brake: 20, grip: 7.6, steer: 0.55, wheelbase: 2.9,
    length: 4.9, width: 1.95, height: 1.5, mass: 1600, health: 140,
    body: 'police', r: 0.95,
  },
  bike: {
    name: 'Neon Katana', klass: 'Motorcycle', mode: 'ground', seats: 1,
    maxSpeed: 56, accel: 12.5, brake: 19, grip: 5.8, steer: 0.72, wheelbase: 1.45,
    length: 2.1, width: 0.75, height: 1.15, mass: 210, health: 55, lean: 0.55,
    body: 'paint', twoWheels: true, r: 0.5,
  },
  scooter: {
    name: 'Vespa 125', klass: 'Scooter', mode: 'ground', seats: 2,
    maxSpeed: 26, accel: 5.2, brake: 12, grip: 6.2, steer: 0.85, wheelbase: 1.3,
    length: 1.8, width: 0.7, height: 1.1, mass: 130, health: 40, lean: 0.4,
    body: 'paint', twoWheels: true, r: 0.45,
  },
  van: {
    name: 'Boxer Van', klass: 'Van', mode: 'ground', seats: 4,
    maxSpeed: 34, accel: 5.8, brake: 14, grip: 6.0, steer: 0.6, wheelbase: 3.2,
    length: 5.4, width: 2.1, height: 2.3, mass: 2200, health: 160,
    body: 'paint', r: 1.0,
  },
  boat: {
    name: 'Coastline 28', klass: 'Boat', mode: 'water', seats: 4,
    maxSpeed: 26, accel: 4.6, brake: 3.2, grip: 1.6, steer: 0.5, wheelbase: 5.2,
    length: 8.0, width: 2.6, height: 1.8, mass: 2600, health: 120,
    body: 'hull', r: 1.2,
  },
  helicopter: {
    name: 'Sea Sparrow', klass: 'Helicopter', mode: 'air', seats: 2,
    maxSpeed: 58, accel: 9, brake: 6, climb: 9, grip: 3, steer: 1, wheelbase: 5,
    length: 9, width: 2.2, height: 2.6, mass: 2400, health: 110,
    body: 'helo', r: 1.6,
  },
  plane: {
    name: 'Skimmer 182', klass: 'Aeroplane', mode: 'air', seats: 2,
    maxSpeed: 105, accel: 11, brake: 5, stallSpeed: 32, climb: 14, grip: 2, steer: 1,
    wheelbase: 6, length: 8.5, width: 3.2, height: 2.4, mass: 1500, health: 120,
    body: 'plane', r: 1.6,
  },
};

export const VEHICLE_TYPES = Object.keys(VEHICLE_SPECS);

let nextVehicleId = 1;

export function createVehicle(type, x, z, yaw = 0, options = {}) {
  const spec = VEHICLE_SPECS[type];
  if (!spec) throw new Error(`unknown vehicle type: ${type}`);
  return {
    id: options.id ?? nextVehicleId++,
    type, spec: { ...spec },
    x, z, y: spec.mode === 'air' ? (options.y ?? 0.6) : 0,
    yaw,
    vx: 0, vz: 0, vy: 0,
    speed: 0, lateral: 0,
    steer: 0, lean: 0, pitch: 0, roll: 0,
    wheelSpin: 0,
    health: spec.health,
    dead: false,
    occupied: false,
    color: options.color ?? null,
    nitro: 0,
    lastImpact: 0,
    events: [],
  };
}

function forward(yaw) {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

function right(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

function surfaceProps(env, x, z) {
  const name = env.surfaceAt(x, z);
  return { name, ...(SURFACES[name] ?? SURFACES.road) };
}

/**
 * Advance one vehicle by `dt`.
 * @param {object} v vehicle state (mutated)
 * @param {object} input {throttle -1..1, steer -1..1, handbrake, boost, pitch -1..1}
 * @param {number} dt seconds, ≤ 1/60 keeps the integrator stable
 * @param {object} env {surfaceAt, blocked, wetness, bounds}
 * @returns {{collision:number, inWater:boolean, airborne:boolean}}
 */
export function stepVehicle(v, input, dt, env = {}) {
  if (v.dead) return { collision: 0, inWater: false, airborne: false };
  const spec = v.spec;
  const wet = clamp(env.wetness ?? 0, 0, 1);
  const throttle = clamp(input.throttle ?? 0, -1, 1);
  const steerIn = clamp(input.steer ?? 0, -1, 1);
  const handbrake = !!input.handbrake;
  const surface = surfaceProps(env, v.x, v.z);
  const inWater = surface.name === 'water';

  if (spec.mode === 'water') return stepBoat(v, { throttle, steer: steerIn, handbrake }, dt, env, surface);
  if (spec.mode === 'air') return stepAir(v, { throttle, steer: steerIn, handbrake, pitch: clamp(input.pitch ?? 0, -1, 1) }, dt, env);
  return stepGround(v, { throttle, steer: steerIn, handbrake, boost: !!input.boost }, dt, env, surface, wet, inWater);
}

function stepGround(v, input, dt, env, surface, wet, inWater) {
  const spec = v.spec;
  const surfMul = inWater ? SURFACES.water : surface;
  const gripBase = spec.grip * surfMul.grip * (1 - 0.24 * wet);
  const events = { collision: 0, inWater, airborne: false };
  v.events = [];

  // --- longitudinal ---
  let f = forward(v.yaw);
  let vLong = v.vx * f.x + v.vz * f.z;
  const cap = spec.maxSpeed * (input.boost ? 1.08 : 1);
  if (input.throttle > 0.04) {
    vLong += input.throttle * spec.accel * surfMul.accel * dt;
  } else if (input.throttle < -0.04) {
    if (vLong > 0.6) vLong += input.throttle * spec.brake * surfMul.accel * dt;
    else vLong += input.throttle * spec.accel * 0.42 * surfMul.accel * dt;
  }
  if (input.handbrake) vLong = moveTowards(vLong, 0, spec.brake * 1.15 * dt);

  // Aerodynamic drag + rolling resistance. Drag dominates at the top end.
  const dragC = 0.45 / (cap * cap);
  vLong -= dragC * vLong * Math.abs(vLong) * dt;
  vLong -= surfMul.drag * 4.2 * Math.sign(vLong) * dt * (Math.abs(vLong) > 0.4 ? 1 : 0);
  vLong -= Math.sign(vLong) * 0.9 * dt * (Math.abs(vLong) > 0.15 ? 1 : 0);
  if (inWater) vLong -= 3.5 * vLong * dt;
  vLong = clamp(vLong, -cap * 0.38, cap);

  // --- steering ---
  const speedRatio = clamp(Math.abs(vLong) / cap, 0, 1);
  // Steering authority shrinks with speed so a 250 km/h supercar is not twitchy.
  const authority = 1 - 0.52 * speedRatio;
  v.steer = damp(v.steer, input.steer, 9, dt);
  const steerAngle = v.steer * spec.steer * authority;
  const turnBoost = input.handbrake ? 1.35 : 1;
  const yawRate = (vLong / spec.wheelbase) * Math.tan(steerAngle) * turnBoost;
  v.yaw = wrapAngle(v.yaw + yawRate * dt);

  // --- lateral slip: the engine sets the along-axis speed, the old velocity
  //     keeps its lateral component while the car rotates, and grip bleeds it off ---
  f = forward(v.yaw);
  const r = right(v.yaw);
  const carriedLat = v.vx * r.x + v.vz * r.z;
  let vLat = carriedLat;
  const grip = gripBase * (input.handbrake ? 0.24 : 1);
  vLat *= Math.exp(-grip * dt);
  if (input.handbrake) vLat -= yawRate * vLong * 0.16 * dt;

  v.vx = f.x * vLong + r.x * vLat;
  v.vz = f.z * vLong + r.z * vLat;
  v.speed = vLong;
  v.lateral = vLat;
  v.wheelSpin += (vLong / Math.max(spec.length * 0.32, 0.3)) * dt;
  const leanTarget = spec.lean ? clamp(-yawRate * Math.abs(vLong) * 0.03, -spec.lean, spec.lean) : 0;
  v.lean = damp(v.lean, leanTarget, 6, dt);

  // --- integrate with axis-separated collision so walls slide instead of sticking ---
  const radius = spec.r ?? 1;
  const nextX = v.x + v.vx * dt;
  const nextZ = v.z + v.vz * dt;
  const blockedX = env.blocked ? env.blocked(nextX, v.z, radius) : false;
  const blockedZ = env.blocked ? env.blocked(v.x, nextZ, radius) : false;
  const impact = Math.abs(vLong);
  if (blockedX && blockedZ) {
    if (env.blocked ? !env.blocked(v.x, v.z, radius) : false) {
      v.vx *= -0.22;
      v.vz *= -0.22;
      v.yaw += 0.05 * Math.sign(v.steer || 1);
      events.collision = impact;
    }
  } else {
    if (blockedX) {
      v.vx *= -0.18;
      events.collision = Math.max(events.collision, impact);
    } else {
      v.x = nextX;
    }
    if (blockedZ) {
      v.vz *= -0.18;
      events.collision = Math.max(events.collision, impact);
    } else {
      v.z = nextZ;
    }
  }

  if (events.collision > 9) {
    const dmg = (events.collision - 9) * (spec.twoWheels ? 3.2 : 1.9);
    v.health = Math.max(0, v.health - dmg);
    v.speed *= 0.45;
    if (v.health <= 0) v.dead = true;
  }
  v.occupied = true;
  return events;
}

function stepBoat(v, input, dt, env, surface) {
  const spec = v.spec;
  const onWater = surface.name === 'water';
  let f = forward(v.yaw);
  let vLong = v.vx * f.x + v.vz * f.z;
  const events = { collision: 0, inWater: onWater, airborne: false };

  if (input.throttle > 0.04) vLong += input.throttle * spec.accel * dt;
  else if (input.throttle < -0.04) vLong += input.throttle * spec.brake * 0.6 * dt;
  vLong -= 0.012 * vLong * Math.abs(vLong) * dt;
  vLong = clamp(vLong, -spec.maxSpeed * 0.4, spec.maxSpeed);

  const speedRatio = clamp(Math.abs(vLong) / spec.maxSpeed, 0, 1);
  v.steer = damp(v.steer, input.steer ?? 0, 4, dt);
  const yawRate = v.steer * spec.steer * (0.25 + speedRatio * 0.9) * Math.sign(vLong || 1);
  v.yaw = wrapAngle(v.yaw + yawRate * dt);

  f = forward(v.yaw);
  const r = right(v.yaw);
  let vLat = v.vx * r.x + v.vz * r.z;
  vLat *= Math.exp(-spec.grip * dt);
  v.vx = f.x * vLong + r.x * vLat;
  v.vz = f.z * vLong + r.z * vLat;
  v.speed = vLong;
  v.lateral = vLat;

  const nx = v.x + v.vx * dt;
  const nz = v.z + v.vz * dt;
  if (!onWater) {
    // Beaching: grind to a halt and let the game ask the player to reverse out.
    v.vx *= 0.55;
    v.vz *= 0.55;
    events.collision = Math.abs(vLong);
  } else if (env.blocked && env.blocked(nx, nz, spec.r)) {
    v.vx *= -0.15;
    v.vz *= -0.15;
    events.collision = Math.abs(vLong);
  } else {
    v.x = nx;
    v.z = nz;
  }
  // Ride height follows a slow swell so the camera bobs with the sea.
  const t = (env.clock ?? 0);
  v.y = Math.sin(t * 0.9 + v.x * 0.02) * 0.12;
  v.pitch = Math.sin(t * 0.7 + v.z * 0.03) * 0.03 + clamp(v.speed * 0.006, 0, 0.12);
  v.roll = clamp(-yawRate * v.speed * 0.01, -0.12, 0.12);
  return events;
}

function stepAir(v, input, dt, env) {
  const spec = v.spec;
  const events = { collision: 0, inWater: false, airborne: v.y > 2 };
  const isPlane = spec.mode === 'air' && spec.stallSpeed != null;
  let f = forward(v.yaw);
  let vLong = v.vx * f.x + v.vz * f.z;

  if (isPlane) {
    // Throttle is the only longitudinal control; the prop keeps pushing.
    const throttle = clamp(input.throttle, -0.2, 1);
    vLong += (throttle * spec.accel - 0.0009 * vLong * Math.abs(vLong)) * dt;
    v.stallSpeed = spec.stallSpeed;
    const stall = spec.stallSpeed;
    const liftRatio = clamp((vLong - stall * 0.75) / (stall * 0.75), 0, 1);
    v.pitch = damp(v.pitch, clamp(input.pitch, -1, 1) * 0.34, 2.4, dt);
    v.roll = damp(v.roll, clamp(input.steer, -1, 1) * 0.65, 3.0, dt);
    v.yaw = wrapAngle(v.yaw + (GRAVITY * Math.tan(v.roll)) / Math.max(vLong, 16) * dt);
    vLong = clamp(vLong, -4, spec.maxSpeed);
    v.vy = vLong * Math.sin(v.pitch) * 0.6 + (liftRatio - 1) * 9;
    v.y += v.vy * dt;
    if (v.y <= 0.55) {
      v.y = 0.55;
      v.vy = 0;
      vLong = moveTowards(vLong, 0, 2.4 * dt); // runway friction, not a speed multiplier
      v.pitch = damp(v.pitch, 0, 4, dt);
      v.roll = damp(v.roll, 0, 4, dt);
      events.airborne = false;
      if (Math.abs(input.pitch) > 0.6 && vLong < 4) events.collision = 6;
    }
    v.y = clamp(v.y, 0.55, 420);
  } else {
    // Helicopter: collective on throttle, cyclic tilt on pitch, pedals on steer.
    const climb = clamp(input.throttle, -1, 1) * spec.climb;
    v.vy = damp(v.vy, climb, 2.6, dt);
    v.y += v.vy * dt;
    if (v.y <= 1.1) {
      v.y = 1.1;
      v.vy = Math.max(0, v.vy);
    }
    v.y = clamp(v.y, 1.1, 380);
    const tilt = clamp(input.pitch, -1, 1) * 0.32;
    v.pitch = damp(v.pitch, tilt, 3, dt);
    v.roll = damp(v.roll, -clamp(input.steer, -1, 1) * 0.22, 3, dt);
    vLong += spec.accel * Math.sin(v.pitch) * dt - 0.35 * vLong * dt;
    vLong = clamp(vLong, -spec.maxSpeed * 0.5, spec.maxSpeed);
    v.yaw = wrapAngle(v.yaw - clamp(input.steer, -1, 1) * 1.25 * dt);
    // Rotor wash pushes the helicopter slightly downhill when stationary.
    if (Math.abs(vLong) < 0.5) v.vy = damp(v.vy, -0.4, 1.2, dt);
  }

  f = forward(v.yaw);
  const r = right(v.yaw);
  const lateralDrift = spec.mode === 'air' && isPlane ? 0.06 : 0.9;
  let vLat = v.vx * r.x + v.vz * r.z;
  vLat *= Math.exp(-2.2 * dt);
  v.vx = f.x * vLong + r.x * vLat * lateralDrift;
  v.vz = f.z * vLong + r.z * vLat * lateralDrift;

  const nx = v.x + v.vx * dt;
  const nz = v.z + v.vz * dt;
  if (env.blocked && env.blocked(nx, nz, spec.r * 0.8) && v.y < 6) {
    v.vx *= -0.2;
    v.vz *= -0.2;
    v.health = Math.max(0, v.health - 12);
    events.collision = Math.abs(vLong);
    if (v.health <= 0) v.dead = true;
  } else {
    v.x = nx;
    v.z = nz;
  }
  v.speed = vLong;
  v.airborne = v.y > 2.5;
  return events;
}

/** Ground height for the camera and for spawning: helicopters and planes must
 *  start on the tarmac, everyone else on the road surface at y=0. */
export function rideHeight(v) {
  if (v.spec.mode === 'air') return v.y;
  return v.y;
}

/** Where the follow camera sits, in world units, relative to the vehicle. */
export function cameraRig(v, mode = 'chase') {
  const spec = v.spec;
  const dist = mode === 'far' ? spec.length * 4.2 : spec.length * 3.0;
  const height = spec.mode === 'air' ? spec.length * 0.85 : Math.max(2.4, spec.height * 1.7);
  const f = forward(v.yaw);
  return {
    x: v.x - f.x * dist,
    y: v.y + height,
    z: v.z - f.z * dist,
    lookX: v.x + f.x * 6,
    lookY: v.y + spec.height * 0.6,
    lookZ: v.z + f.z * 6,
  };
}
