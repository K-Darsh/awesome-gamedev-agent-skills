// Procedural vehicle meshes. Every vehicle is built from primitives so the
// repository carries no binary art. Swap this module for glTF loading in a
// production build; the game only needs `group`, `parts` and the update call.

import * as THREE from '../../vendor/three.module.js';

const PAINTS = ['#e23f5a', '#f2c14e', '#3fa9c9', '#8ac926', '#c084fc', '#f4f1ea', '#2b2b33', '#f28fb0'];

const paintCache = new Map();
const glass = new THREE.MeshStandardMaterial({ color: '#0d1a24', metalness: 0.9, roughness: 0.15, transparent: true, opacity: 0.82 });
const tyre = new THREE.MeshStandardMaterial({ color: '#121215', roughness: 0.95 });
const chrome = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.95, roughness: 0.22 });
const headMat = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#ffe9a8', emissiveIntensity: 1.6 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#7a1020', emissive: '#ff2b45', emissiveIntensity: 1.2 });
const policeBlue = new THREE.MeshStandardMaterial({ color: '#2b5cff', emissive: '#2b5cff', emissiveIntensity: 2 });
const policeRed = new THREE.MeshStandardMaterial({ color: '#ff2b45', emissive: '#ff2b45', emissiveIntensity: 2 });

function paint(color) {
  const key = color ?? PAINTS[0];
  if (!paintCache.has(key)) {
    paintCache.set(key, new THREE.MeshStandardMaterial({ color: key, metalness: 0.45, roughness: 0.32 }));
  }
  return paintCache.get(key);
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function wheel(radius = 0.36, width = 0.3) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), tyre);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  return mesh;
}

/** Build the visual for a vehicle type. Returns {group, parts}. */
export function buildVehicle(type, spec, color) {
  const group = new THREE.Group();
  const parts = { wheels: [], rotors: [], lights: [], spin: 0 };
  const body = paint(color ?? PAINTS[Math.floor(Math.random() * PAINTS.length)]);
  const len = spec.length;
  const wid = spec.width;
  const hgt = spec.height;

  const addWheels = (r = 0.36, w = 0.3, zFront = len * 0.32, zBack = -len * 0.3) => {
    for (const [sx, z] of [[1, zFront], [-1, zFront], [1, zBack], [-1, zBack]]) {
      const wl = wheel(r, w);
      wl.position.set(sx * (wid / 2 - w * 0.1), r, z);
      group.add(wl);
      parts.wheels.push(wl);
    }
  };

  if (!spec.twoWheels && (spec.body === 'paint' || spec.body === 'police')) {
    const chase = type === 'sports' || type === 'supercar';
    group.add(box(wid, hgt * (chase ? 0.34 : 0.42), len, body, 0, hgt * (chase ? 0.4 : 0.45), 0));
    const cabin = box(wid * 0.8, hgt * (chase ? 0.3 : 0.36), len * (chase ? 0.38 : 0.44), glass, 0, hgt * (chase ? 0.68 : 0.78), -len * 0.04);
    group.add(cabin);
    if (chase) {
      group.add(box(wid * 0.95, 0.05, 0.28, chrome, 0, hgt * 0.62, -len * 0.44));
      group.add(box(wid * 0.9, 0.04, 0.22, body, 0, hgt * 0.72, -len * 0.42));
      group.add(box(wid + 0.12, 0.05, 0.3, body, 0, hgt * 0.3, -len * 0.42));
    }
    if (type === 'police') {
      const bar = new THREE.Group();
      bar.add(box(0.5, 0.14, 0.3, policeBlue, -0.32, hgt * 1.02, 0));
      bar.add(box(0.5, 0.14, 0.3, policeRed, 0.32, hgt * 1.02, 0));
      group.add(bar);
      parts.lightbar = bar;
      const stripe = box(wid + 0.02, 0.2, len * 0.5, paint('#f4f1ea'), 0, hgt * 0.44, 0);
      group.add(stripe);
    }
    addWheels(chase ? 0.34 : 0.37, 0.3);
  } else if (spec.twoWheels) {
    group.add(box(wid * 0.45, hgt * 0.42, len * 0.8, body, 0, hgt * 0.55, 0));
    group.add(box(wid * 0.5, hgt * 0.22, len * 0.3, glass, 0, hgt * 0.86, -len * 0.1));
    group.add(box(wid * 0.35, 0.05, 0.5, chrome, 0, hgt * 0.72, len * 0.42));
    const w1 = wheel(0.34, 0.16);
    w1.position.set(0, 0.34, len * 0.42);
    const w2 = wheel(0.34, 0.16);
    w2.position.set(0, 0.34, -len * 0.42);
    group.add(w1, w2);
    parts.wheels.push(w1, w2);
  } else if (spec.body === 'hull') {
    group.add(box(wid, hgt * 0.38, len, body, 0, hgt * 0.22, 0));
    group.add(box(wid * 0.55, hgt * 0.3, len * 0.34, paint('#f4f1ea'), 0, hgt * 0.5, -len * 0.1));
    // Bow: a cone laid along +z to break the box silhouette.
    const bow = new THREE.Mesh(new THREE.ConeGeometry(wid * 0.5, len * 0.3, 4), body);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, hgt * 0.24, len * 0.6);
    group.add(bow);
    group.add(box(0.1, 1.6, 0.1, chrome, 0, hgt * 1.2, -len * 0.3));
  } else if (spec.body === 'helo') {
    const hull = new THREE.Mesh(new THREE.SphereGeometry(wid * 0.72, 12, 10), body);
    hull.scale.set(1, 0.8, 1.6);
    hull.position.y = hgt * 0.5;
    group.add(hull);
    group.add(box(0.35, 0.35, len * 0.8, body, 0, hgt * 0.55, -len * 0.45));
    group.add(box(0.1, 0.9, 0.55, body, 0, hgt * 0.95, -len * 0.8));
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(wid * 4.2, 0.04, 0.3), chrome);
    rotor.position.y = hgt * 1.0;
    group.add(rotor);
    parts.rotors.push({ mesh: rotor, axis: 'y', speed: 26 });
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.16), chrome);
    tailRotor.position.set(0.2, hgt * 0.95, -len * 0.82);
    group.add(tailRotor);
    parts.rotors.push({ mesh: tailRotor, axis: 'x', speed: 30 });
    group.add(box(wid * 1.6, 0.06, 0.3, chrome, 0, 0.2, 0));
  } else if (spec.body === 'plane') {
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(wid * 0.28, len * 0.7, 6, 10), body);
    fus.rotation.x = Math.PI / 2;
    fus.position.y = hgt * 0.55;
    group.add(fus);
    group.add(box(wid * 3.4, 0.12, 1.1, body, 0, hgt * 0.58, -len * 0.05));
    group.add(box(0.12, 0.7, 1.2, body, 0, hgt * 0.95, -len * 0.44));
    group.add(box(2.4, 0.1, 0.7, body, 0, hgt * 0.72, -len * 0.42));
    const prop = new THREE.Mesh(new THREE.BoxGeometry(wid * 3.0, 0.08, 0.12), chrome);
    prop.position.set(0, hgt * 0.55, len * 0.5);
    group.add(prop);
    parts.rotors.push({ mesh: prop, axis: 'z', speed: 40 });
    group.add(box(wid * 0.4, 0.35, 0.6, glass, 0, hgt * 0.82, len * 0.12));
    for (const sx of [-1, 1]) {
      const strut = box(0.08, 0.5, 0.08, chrome, sx * wid * 0.9, 0.3, 0);
      group.add(strut);
    }
  }

  // Lights: emissive lamps plus two forward beams that fade in at night.
  const front = Math.max(0.5, len * (spec.body === 'plane' ? 0.5 : 0.45));
  for (const sx of [-1, 1]) {
    const lamp = box(0.18, 0.12, 0.06, headMat, sx * wid * 0.32, hgt * 0.42, front);
    group.add(lamp);
    parts.lights.push(lamp);
    const tail = box(0.16, 0.1, 0.05, tailMat, sx * wid * 0.32, hgt * 0.42, -front);
    group.add(tail);
    parts.lights.push(tail);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const sx of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 8, 1, true), beamMat);
    beam.rotation.x = Math.PI / 2;
    beam.rotation.z = sx * 0.06;
    beam.position.set(sx * wid * 0.3, hgt * 0.42, front + 6.4);
    beam.material.side = THREE.DoubleSide;
    group.add(beam);
  }
  parts.beamMaterial = beamMat;
  group.userData.type = type;
  return { group, parts };
}

/** Animate running gear, lights and lean for one frame. */
export function updateVehicleVisual(visual, state, dt, isNight, isPlayer) {
  const { group, parts } = visual;
  group.position.set(state.x, state.y ?? 0, state.z);
  group.rotation.set(0, state.yaw, 0);
  if (state.spec.twoWheels) group.rotation.z = state.lean ?? 0;
  if (state.spec.mode === 'air') {
    group.rotation.x = -(state.pitch ?? 0);
    group.rotation.z = -(state.roll ?? 0);
  } else if (state.spec.mode === 'water') {
    group.rotation.x = state.pitch ?? 0;
    group.rotation.z = state.roll ?? 0;
  }
  const spin = state.wheelSpin ?? 0;
  for (const w of parts.wheels) w.rotation.x = spin;
  for (const rotor of parts.rotors) {
    if (rotor.axis === 'y') rotor.mesh.rotation.y += rotor.speed * dt;
    else if (rotor.axis === 'x') rotor.mesh.rotation.x += rotor.speed * dt;
    else rotor.mesh.rotation.z += rotor.speed * dt;
  }
  if (parts.beamMaterial) parts.beamMaterial.opacity = isNight ? 0.18 : 0;
  if (parts.lightbar) {
    const t = performance.now() * 0.008;
    parts.lightbar.children[0].visible = Math.sin(t) > 0;
    parts.lightbar.children[1].visible = Math.sin(t) <= 0;
  }
  group.visible = !state.dead || isPlayer;
}

export function disposeVehicle(visual) {
  visual.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (o.material !== glass && o.material !== tyre && o.material !== chrome) o.material.dispose?.();
    }
  });
}

export const VEHICLE_PAINTS = PAINTS;
