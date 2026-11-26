// Round rotating minimap: streets, water, properties, pickups, objectives and
// the wanted-level chase. Canvas 2D, redrawn at a capped rate.

import { CITY } from '../sim/world.js';

const MAP_RANGE = 130; // metres from edge to edge

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext('2d');
    this.accum = 0;
    this.roads = [];
    const lines = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);
    for (const line of lines) {
      this.roads.push({ axis: 'x', at: line });
      this.roads.push({ axis: 'z', at: line });
    }
  }

  resize(size) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.size = size;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** world → minimap pixels, rotated so the player faces up. */
  _project(x, z, player, scale) {
    const dx = x - player.x;
    const dz = z - player.z;
    const c = Math.cos(player.yaw);
    const s = Math.sin(player.yaw);
    // Rotate by -yaw: forward (sin,cos) becomes screen-up.
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    return { x: this.size / 2 + rx * scale, y: this.size / 2 - rz * scale };
  }

  draw(dt, state) {
    this.accum += dt;
    if (this.accum < 0.06) return;
    this.accum = 0;
    const ctx = this.ctx;
    const size = this.size;
    if (!size) return;
    const { player, traffic, pickups, properties, mission, waypoint, cops, ownedIds } = state;
    const scale = size / MAP_RANGE;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#101a24';
    ctx.fillRect(0, 0, size, size);

    // Water
    ctx.fillStyle = '#123f52';
    for (const w of this.world.water) {
      const pts = [
        this._project(w.x0, w.z0, player, scale),
        this._project(w.x1, w.z0, player, scale),
        this._project(w.x1, w.z1, player, scale),
        this._project(w.x0, w.z1, player, scale),
      ];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Streets
    ctx.strokeStyle = '#5d6b78';
    ctx.lineWidth = Math.max(1.5, CITY.roadHalf * 2 * scale);
    for (const r of this.roads) {
      const from = r.axis === 'x' ? this._project(r.at, -CITY.half, player, scale) : this._project(-CITY.half, r.at, player, scale);
      const to = r.axis === 'x' ? this._project(r.at, CITY.half, player, scale) : this._project(CITY.half, r.at, player, scale);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Airfield
    const runway = this.world.airport.runway;
    ctx.strokeStyle = '#8b96a1';
    ctx.lineWidth = 3;
    const r0 = this._project(runway.x, runway.z0, player, scale);
    const r1 = this._project(runway.x, runway.z1, player, scale);
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y);
    ctx.lineTo(r1.x, r1.y);
    ctx.stroke();

    // Traffic
    ctx.fillStyle = '#e8d8a8';
    for (const car of traffic?.cars ?? []) {
      const p = this._project(car.x, car.z, player, scale);
      ctx.fillRect(p.x - 1.1, p.y - 1.1, 2.2, 2.2);
    }

    // Pickups: health cross and armour shield, the reason this minimap exists.
    for (const pickup of pickups ?? []) {
      if (!pickup.active) continue;
      if (pickup.type !== 'health' && pickup.type !== 'armor') continue;
      const p = this._project(pickup.x, pickup.z, player, scale);
      if (Math.hypot(p.x - size / 2, p.y - size / 2) > size / 2 - 6) continue;
      if (pickup.type === 'health') {
        ctx.fillStyle = '#36d97f';
        ctx.fillRect(p.x - 3, p.y - 1, 6, 2);
        ctx.fillRect(p.x - 1, p.y - 3, 2, 6);
      } else {
        ctx.fillStyle = '#4aa8ff';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 3.4);
        ctx.lineTo(p.x + 3.2, p.y - 1);
        ctx.lineTo(p.x + 2.2, p.y + 3.2);
        ctx.lineTo(p.x - 2.2, p.y + 3.2);
        ctx.lineTo(p.x - 3.2, p.y - 1);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Properties: cyan house, green when owned.
    for (const prop of properties ?? []) {
      const p = this._project(prop.door.x, prop.door.z, player, scale);
      const owned = ownedIds?.has(prop.id);
      ctx.fillStyle = owned ? '#57e08a' : '#5ee1ff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4);
      ctx.lineTo(p.x + 4, p.y);
      ctx.lineTo(p.x, p.y + 4);
      ctx.lineTo(p.x - 4, p.y);
      ctx.closePath();
      ctx.fill();
    }

    // Police
    for (const cop of cops ?? []) {
      const p = this._project(cop.x, cop.z, player, scale);
      ctx.fillStyle = Math.sin(performance.now() * 0.012) > 0 ? '#3b6bff' : '#ff3b56';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Waypoint
    if (waypoint) {
      const p = this._project(waypoint.x, waypoint.z, player, scale);
      const clamped = this._clampToEdge(p, size);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(clamped.x, clamped.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Mission marker (star)
    if (mission) {
      const p = this._project(mission.x, mission.z, player, scale);
      const clamped = this._clampToEdge(p, size);
      drawStar(ctx, clamped.x, clamped.y, 6, '#ffd166');
    }

    ctx.restore();

    // Player arrow, always centred and pointing up.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0c1218';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ring + compass north tick.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    const north = this._project(player.x, player.z + 100, player, scale);
    const ang = Math.atan2(north.y - size / 2, north.x - size / 2);
    ctx.fillStyle = '#ff7a9c';
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(ang) * (size / 2 - 7), size / 2 + Math.sin(ang) * (size / 2 - 7), 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  _clampToEdge(p, size) {
    const cx = size / 2;
    const cy = size / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    const max = size / 2 - 9;
    if (d <= max) return p;
    return { x: cx + (dx / d) * max, y: cy + (dy / d) * max };
  }
}

function drawStar(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
