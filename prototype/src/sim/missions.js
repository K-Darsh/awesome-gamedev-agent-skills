// Mission definitions and runtime. Missions are data: a list of steps with a
// radius, timer and fail rule. The runner emits events the game turns into
// markers, spawns, dialogue and payouts, which keeps it testable without a renderer.

import { dist2 } from './util.js';

const DOCK_PICKUP = { x: 296, z: 158 };
const AIRPORT_CHECKPOINTS = [
  { x: -376, z: -220, y: 0 },
  { x: -180, z: -120, y: 0 },
  { x: 120, z: 320, y: 0 },
  { x: 380, z: 404, y: 0 },
];
const MARINA_CHECKPOINTS = [
  { x: 392, z: 206, y: 0 },
  { x: 430, z: 330, y: 0 },
  { x: 240, z: 452, y: 0 },
  { x: 40, z: 452, y: 0 },
];

export function missionCatalog(world) {
  const hotel = world.properties.find((p) => p.id === 'hotel');
  const workshop = world.properties.find((p) => p.id === 'workshop');
  const resort = world.properties.find((p) => p.id === 'resort');
  return [
    {
      id: 'courier',
      title: 'Sunset Courier',
      contact: 'Rosa Marín',
      pay: 2500,
      blurb: 'A sealed crate needs to move from the docks to the beach before the sun goes down. No questions, no detours.',
      steps: [
        { kind: 'goto', x: DOCK_PICKUP.x, z: DOCK_PICKUP.z, radius: 7, label: 'Collect the sealed crate at Harbour Docks' },
        {
          kind: 'deliver', x: hotel.door.x, z: hotel.door.z, radius: 8, timeLimit: 240, maxVehicleDamage: 45,
          label: 'Deliver the crate to Ocean View Hotel', failOnDamage: 'The crate is cracked. Rosa will not pay for that.',
        },
      ],
    },
    {
      id: 'tail',
      title: 'Bad Signal',
      contact: 'Detective Ruiz',
      pay: 3200,
      blurb: 'A courier is moving evidence across town. Stay on him, stay unseen, then take the car.',
      steps: [
        {
          kind: 'tail', spawn: { x: 64, z: -24, type: 'sports', yaw: 1.35 }, keepMin: 12, keepMax: 48,
          duration: 40, label: 'Follow the grey coupe without being seen',
        },
        { kind: 'ram', label: 'Force the coupe to stop' },
      ],
    },
    {
      id: 'recover',
      title: 'Repo Run',
      contact: 'Marco Bell',
      pay: 4000,
      blurb: 'A Venom was towed to a lockup out in the cane fields. Bring it back to Rust & Chrome in one piece.',
      steps: [
        { kind: 'goto', x: -296, z: -312, radius: 9, requireVehicle: 'supercar', label: 'Take the Venom from the cane-field lockup' },
        {
          kind: 'deliver', x: workshop.door.x, z: workshop.door.z, radius: 9, timeLimit: 300, maxVehicleDamage: 60,
          requireVehicle: 'supercar', label: 'Drive the Venom to Rust & Chrome', failOnDamage: 'The Venom is wrecked. Marco wanted it clean.',
        },
      ],
    },
    {
      id: 'finale',
      title: 'High Tide',
      contact: 'The Marina',
      pay: 9000,
      blurb: 'Everything you built comes due tonight. Two ways out of the city; pick one and do not look back.',
      steps: [],
      finale: true,
    },
  ];
}

export function finaleBranches(world) {
  const resort = world.properties.find((p) => p.id === 'resort');
  return {
    marina: {
      id: 'marina',
      title: 'High Tide — The Marina Route',
      contact: 'Rosa Marín',
      pay: 9000,
      blurb: 'Rosa has a boat fuelled at the marina. Outrun the harbour patrol and disappear down the coast.',
      steps: [
        { kind: 'goto', x: resort.door.x, z: resort.door.z, radius: 8, label: 'Meet Rosa at Coral Bay Resort' },
        { kind: 'checkpoints', points: MARINA_CHECKPOINTS, radius: 14, timeLimit: 210, requireVehicle: 'boat', label: 'Run the coast in a boat', failOnTime: 'The patrol cut you off. Rosa got away; you did not.' },
      ],
    },
    ruiz: {
      id: 'ruiz',
      title: 'High Tide — The Airfield Route',
      contact: 'Detective Ruiz',
      pay: 9000,
      blurb: 'Ruiz left a plane fuelled at Escobar Airfield. Fly the evidence out and the case dies with it.',
      steps: [
        { kind: 'goto', x: -330, z: -150, radius: 10, label: 'Get to the airfield hangar' },
        { kind: 'checkpoints', points: AIRPORT_CHECKPOINTS, radius: 26, timeLimit: 240, requireVehicle: 'plane', label: 'Fly the route out of the city', failOnTime: 'The fuel ran out over the water. Ruiz is not coming.' },
      ],
    },
  };
}

const EVENT_COMPLETE = 'complete';

export class MissionRunner {
  constructor(world) {
    this.world = world;
    this.catalog = missionCatalog(world);
    this.branches = finaleBranches(world);
    this.active = null;
    this.completed = [];
    this.events = [];
    this.branch = null;
    this.failedAt = 0;
    this.clock = 0;
  }

  emit(type, payload = {}) {
    this.events.push({ type, ...payload });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  offers() {
    const list = [];
    for (const m of this.catalog) {
      if (m.finale) continue;
      if (this.completed.includes(m.id)) continue;
      list.push(m);
    }
    const baseDone = ['courier', 'tail', 'recover'].filter((id) => this.completed.includes(id)).length;
    if (baseDone >= 2 && !this.completed.includes('finale') && !this.active) {
      const finale = this.catalog.find((m) => m.id === 'finale');
      if (finale) list.push(finale);
    }
    return list;
  }

  start(id, ctx = {}) {
    if (this.active) return { ok: false, reason: 'busy' };
    let def = this.catalog.find((m) => m.id === id);
    if (!def) return { ok: false, reason: 'unknown' };
    if (def.finale) {
      const offered = this.offers().some((m) => m.id === 'finale');
      if (!offered) return { ok: false, reason: 'locked' };
      this.emit('chooseBranch', {
        options: [
          { id: 'marina', label: 'Meet Rosa at the marina' },
          { id: 'ruiz', label: 'Fly Ruiz out of the airfield' },
        ],
      });
      this.pendingBranch = true;
      return { ok: true, pending: true };
    }
    return this.begin(def, ctx);
  }

  chooseBranch(branchId, ctx = {}) {
    const branch = this.branches[branchId];
    if (!branch) return { ok: false, reason: 'unknown-branch' };
    this.branch = branchId;
    this.pendingBranch = false;
    return this.begin({ ...branch, finale: true }, ctx);
  }

  begin(def, ctx = {}) {
    this.active = {
      def,
      stepIndex: 0,
      elapsed: 0,
      stepElapsed: 0,
      exposure: 0,
      lostFor: 0,
      checkpointIndex: 0,
      targetSpawned: false,
      failed: false,
      carried: null,
    };
    this.emit('start', { mission: def });
    this.startStep(ctx);
    return { ok: true, mission: def };
  }

  startStep(ctx) {
    const a = this.active;
    const step = a.def.steps[a.stepIndex];
    if (!step) {
      this.finish();
      return;
    }
    a.stepElapsed = 0;
    a.exposure = 0;
    a.lostFor = 0;
    a.checkpointIndex = 0;
    if (step.kind === 'tail' && !a.targetSpawned) {
      a.targetSpawned = true;
      const { type, ...rest } = step.spawn;
      this.emit('spawnTarget', { ...rest, vehicleType: type, mission: a.def.id });
    }
    if (step.kind === 'goto' && step.requireVehicle === 'supercar') {
      this.emit('spawnTargetVehicle', { type: 'supercar', x: step.x - 6, z: step.z + 6, yaw: 0.8, id: 'mission-car' });
    }
    this.emit('step', { index: a.stepIndex, step, mission: a.def.id });
  }

  advance() {
    const a = this.active;
    if (!a) return;
    a.stepIndex += 1;
    if (a.stepIndex >= a.def.steps.length) this.finish();
    else this.startStep({});
  }

  finish() {
    const a = this.active;
    if (!a) return;
    this.completed.push(a.def.id);
    this.emit(EVENT_COMPLETE, { mission: a.def, pay: a.def.pay, branch: this.branch });
    this.active = null;
    this.pendingBranch = false;
  }

  fail(reason) {
    const a = this.active;
    if (!a) return;
    a.failed = true;
    this.emit('fail', { mission: a.def, reason });
    this.failedAt = this.clock;
    this.active = null;
    this.pendingBranch = false;
  }

  /** Current objective marker, or null. */
  marker() {
    const a = this.active;
    if (!a) return null;
    const step = a.def.steps[a.stepIndex];
    if (!step) return null;
    if (step.kind === 'checkpoints') {
      const p = step.points[a.checkpointIndex];
      return p ? { x: p.x, z: p.z, radius: step.radius ?? 12, label: `Checkpoint ${a.checkpointIndex + 1}/${step.points.length}` } : null;
    }
    if (step.kind === 'tail' || step.kind === 'ram') return { following: true, radius: 0, label: step.label };
    return { x: step.x, z: step.z, radius: step.radius ?? 6, label: step.label };
  }

  /**
   * @param {number} dt
   * @param {object} ctx {player, vehicle, target, wanted, onFoot}
   */
  update(dt, ctx) {
    this.clock += dt;
    const a = this.active;
    if (!a) return;
    a.elapsed += dt;
    a.stepElapsed += dt;
    const step = a.def.steps[a.stepIndex];
    if (!step) return;

    const player = ctx.player;
    const vehicle = ctx.vehicle;
    const px = vehicle ? vehicle.x : player.x;
    const pz = vehicle ? vehicle.z : player.z;
    const vehicleType = vehicle ? vehicle.type : null;

    if (step.timeLimit && a.stepElapsed > step.timeLimit) {
      this.fail(step.failOnTime ?? 'Out of time.');
      return;
    }
    if (step.maxVehicleDamage && vehicle && vehicle.spec.health - vehicle.health > step.maxVehicleDamage) {
      this.fail(step.failOnDamage ?? 'The vehicle took too much damage.');
      return;
    }
    if (step.requireVehicle && vehicleType !== step.requireVehicle && step.kind !== 'goto') {
      if (a.stepElapsed > 6) {
        this.fail(`You need the ${step.requireVehicle} for this leg.`);
        return;
      }
    }

    switch (step.kind) {
      case 'goto': {
        if (step.requireVehicle && vehicleType !== step.requireVehicle) return;
        if (dist2(px, pz, step.x, step.z) <= step.radius * step.radius) this.advance();
        break;
      }
      case 'deliver': {
        if (step.requireVehicle && vehicleType !== step.requireVehicle) return;
        if (dist2(px, pz, step.x, step.z) <= step.radius * step.radius) this.finish();
        break;
      }
      case 'tail': {
        const target = ctx.target;
        if (!target || target.dead) {
          const { type: respawnType, ...respawnRest } = step.spawn;
          this.emit('spawnTarget', { ...respawnRest, vehicleType: respawnType, mission: a.def.id, respawn: true });
          a.targetSpawned = false;
          return;
        }
        const d = Math.sqrt(dist2(px, pz, target.x, target.z));
        if (d < step.keepMin) {
          a.exposure += dt;
          if (a.exposure > 2.5) {
            this.fail('He spotted you. The courier is gone.');
            return;
          }
        } else {
          a.exposure = Math.max(0, a.exposure - dt * 0.6);
        }
        if (d > step.keepMax) {
          a.lostFor += dt;
          if (a.lostFor > 9) {
            this.fail('You lost him in traffic.');
            return;
          }
        } else {
          a.lostFor = Math.max(0, a.lostFor - dt);
        }
        this.emit('tailStatus', { distance: d, exposure: a.exposure, lostFor: a.lostFor, remaining: Math.max(0, step.duration - a.stepElapsed) });
        if (a.stepElapsed >= step.duration) this.advance();
        break;
      }
      case 'ram': {
        const target = ctx.target;
        if (!target) return;
        this.emit('ramStatus', { health: target.health });
        if (target.dead || target.health <= 0) this.advance();
        break;
      }
      case 'checkpoints': {
        if (step.requireVehicle && vehicleType !== step.requireVehicle) return;
        const point = step.points[a.checkpointIndex];
        if (!point) { this.finish(); return; }
        const flat = dist2(px, pz, point.x, point.z);
        const high = vehicle ? Math.abs((vehicle.y ?? 0) - (point.y ?? 0)) : 0;
        if (flat <= (step.radius ?? 12) ** 2 && high < 90) {
          a.checkpointIndex += 1;
          a.stepElapsed = Math.max(0, a.stepElapsed - 35); // checkpoint bonus time
          this.emit('checkpoint', { index: a.checkpointIndex, total: step.points.length });
          if (a.checkpointIndex >= step.points.length) this.finish();
        }
        break;
      }
      default:
        break;
    }
  }

  toSave() {
    return { completed: [...this.completed], branch: this.branch };
  }

  fromSave(data) {
    if (!data) return;
    this.completed = Array.isArray(data.completed) ? data.completed.filter((id) => typeof id === 'string') : [];
    this.branch = typeof data.branch === 'string' ? data.branch : null;
    this.active = null;
  }
}
