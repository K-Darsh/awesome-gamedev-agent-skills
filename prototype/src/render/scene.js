// three.js scene for the city: instanced buildings, roads, props, water, traffic,
// pedestrians, pickups, weather and a time-of-day lighting rig.
// Rendering only; all gameplay state comes from src/sim.

import * as THREE from '../../vendor/three.module.js';
import { buildVehicle, updateVehicleVisual, VEHICLE_PAINTS } from './vehicles.js';
import { CITY } from '../sim/world.js';

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function windowTexture(litRatio = 0.35) {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#232a33';
    ctx.fillRect(0, 0, w, h);
    const cols = 8;
    const rows = 10;
    const cw = w / cols;
    const ch = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const lit = Math.random() < litRatio;
        ctx.fillStyle = lit ? (Math.random() < 0.3 ? '#ffd9a0' : '#ffe9c4') : '#141a21';
        ctx.fillRect(x * cw + cw * 0.2, y * ch + ch * 0.18, cw * 0.6, ch * 0.52);
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function signTexture(text, color = '#ff5fbf') {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = 'bold 74px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillText(text, w / 2, h / 2 + 4);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  });
}

const SKY_KEYS = [
  { h: 0, sky: '#070a1b', fog: '#0b1022', hemi: 0.16, sun: 0.02, tint: '#2a3d7a' },
  { h: 5, sky: '#14203f', fog: '#1a2647', hemi: 0.28, sun: 0.08, tint: '#5b4b8a' },
  { h: 6.5, sky: '#f2a17a', fog: '#f0b9a0', hemi: 0.55, sun: 0.7, tint: '#ffb27a' },
  { h: 9, sky: '#7db9e8', fog: '#a9cfe8', hemi: 0.85, sun: 1.15, tint: '#cfe8ff' },
  { h: 13, sky: '#63aee0', fog: '#a8cfe4', hemi: 0.95, sun: 1.3, tint: '#e0f2ff' },
  { h: 17.5, sky: '#e8825f', fog: '#e6a184', hemi: 0.7, sun: 0.85, tint: '#ffbf8a' },
  { h: 19, sky: '#7b3f78', fog: '#8b4d7d', hemi: 0.45, sun: 0.25, tint: '#ff7ac2' },
  { h: 21, sky: '#1a1230', fog: '#241a3f', hemi: 0.26, sun: 0.05, tint: '#6a4bb0' },
  { h: 24, sky: '#070a1b', fog: '#0b1022', hemi: 0.16, sun: 0.02, tint: '#2a3d7a' },
];

const WEATHER = {
  clear: { fogMul: 1, rain: 0, wet: 0, tint: '#ffffff', cloud: 0.12 },
  rain: { fogMul: 0.62, rain: 4200, wet: 0.75, tint: '#b9c6d4', cloud: 0.55 },
  storm: { fogMul: 0.45, rain: 8000, wet: 1, tint: '#7d8aa0', cloud: 0.85 },
  fog: { fogMul: 0.34, rain: 0, wet: 0.35, tint: '#d8dde4', cloud: 0.7 },
};

function lerpKey(a, b, t) {
  return {
    sky: '#' + tmpColor.set(a.sky).lerp(new THREE.Color(b.sky), t).getHexString(),
    fog: '#' + tmpColor.set(a.fog).lerp(new THREE.Color(b.fog), t).getHexString(),
    hemi: a.hemi + (b.hemi - a.hemi) * t,
    sun: a.sun + (b.sun - a.sun) * t,
    tint: a.tint,
  };
}

export class WorldRenderer {
  constructor(canvas, world, settings) {
    this.world = world;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 2000);
    this.scene.background = new THREE.Color('#0b1022');
    this.scene.fog = new THREE.Fog('#0b1022', 90, settings.drawDistance);

    this.hemi = new THREE.HemisphereLight('#cfe8ff', '#2a2a33', 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff2d0', 1.2);
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 1; sc.far = 520;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight('#4a5878', 0.35);
    this.scene.add(this.ambient);

    this.vehicleVisuals = new Map();
    this.playerVisual = null;
    this.markers = [];
    this.buildingMaterials = [];
    this.streetGlow = null;
    this.rain = null;
    this.stars = null;
    this.sunSprite = null;
    this.moonSprite = null;
    this.trafficMeshes = null;
    this.pedMeshes = null;
    this.pickupMeshes = new Map();
    this.flash = 0;
    this.weatherKey = 'clear';
    this.time = 0;

    this._buildSky();
    this._buildGround();
    this._buildRoads();
    this._buildBuildings();
    this._buildProps();
    this._buildWater();
    this._buildPickups();
    this._buildTraffic();
    this._buildPeds();
    this.resize();
  }

  _buildSky() {
    const starGeo = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < 700; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.05);
      const r = 900;
      positions.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r + 120, Math.sin(phi) * Math.sin(theta) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.2, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.material.userData.baseOpacity = 0.85;
    this.scene.add(this.stars);

    const disc = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,238,196,1)');
      g.addColorStop(0.45, 'rgba(255,190,120,0.55)');
      g.addColorStop(1, 'rgba(255,150,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.set(240, 240, 1);
    this.scene.add(this.sunSprite);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, color: '#cfe0ff', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.moonSprite.scale.set(110, 110, 1);
    this.scene.add(this.moonSprite);
  }

  _buildGround() {
    const groundMat = new THREE.MeshStandardMaterial({ color: '#66714f', roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, 300);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const sandMat = new THREE.MeshStandardMaterial({ color: '#d9c08a', roughness: 1 });
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(1400, 40), sandMat);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, 0.01, 440);
    beach.receiveShadow = true;
    this.scene.add(beach);

    const lotMat = new THREE.MeshStandardMaterial({ color: '#9a9a94', roughness: 0.92 });
    const lotGeo = new THREE.BoxGeometry(1, 0.16, 1);
    const blocks = this.world.blocks;
    const lots = new THREE.InstancedMesh(lotGeo, lotMat, blocks.length);
    const grassMat = new THREE.MeshStandardMaterial({ color: '#6f8a4a', roughness: 1 });
    const grassLots = new THREE.InstancedMesh(lotGeo, grassMat, blocks.length);
    let li = 0;
    let gi = 0;
    for (const b of blocks) {
      dummy.position.set(b.cx, 0.06, b.cz);
      dummy.scale.set(b.x1 - b.x0, 1, b.z1 - b.z0);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      if (b.district === 'rural') {
        grassLots.setMatrixAt(gi++, dummy.matrix);
      } else {
        lots.setMatrixAt(li++, dummy.matrix);
      }
    }
    lots.count = li;
    grassLots.count = gi;
    lots.receiveShadow = true;
    grassLots.receiveShadow = true;
    this.scene.add(lots, grassLots);
  }

  _buildRoads() {
    const roadMat = new THREE.MeshStandardMaterial({ color: '#2a2d35', roughness: 0.62, metalness: 0.05 });
    this.roadMaterial = roadMat;
    const lines = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);
    const roadGeo = new THREE.BoxGeometry(1, 0.06, 1);
    const count = lines.length * 2;
    const roads = new THREE.InstancedMesh(roadGeo, roadMat, count);
    let i = 0;
    for (const line of lines) {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(line, 0.055, 0);
      dummy.scale.set(CITY.roadHalf * 2, 1, CITY.half * 2);
      dummy.updateMatrix();
      roads.setMatrixAt(i++, dummy.matrix);
      dummy.position.set(0, 0.055, line);
      dummy.scale.set(CITY.half * 2, 1, CITY.roadHalf * 2);
      dummy.updateMatrix();
      roads.setMatrixAt(i++, dummy.matrix);
    }
    roads.receiveShadow = true;
    this.scene.add(roads);

    // Lane dashes: cheap, readable, and they sell the speed.
    const dashMat = new THREE.MeshBasicMaterial({ color: '#d8d3c0' });
    const dashGeo = new THREE.BoxGeometry(0.16, 0.02, 2.6);
    const dashesPerLine = Math.floor((CITY.half * 2) / 9);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashesPerLine * 2 * lines.length);
    let d = 0;
    for (const line of lines) {
      for (let k = 0; k < dashesPerLine; k++) {
        const t = -CITY.half + 4.5 + k * 9;
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(line, 0.09, t);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dashes.setMatrixAt(d++, dummy.matrix);
        dummy.position.set(t, 0.09, line);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.updateMatrix();
        dashes.setMatrixAt(d++, dummy.matrix);
      }
    }
    this.scene.add(dashes);
  }

  _buildBuildings() {
    const boxes = this.world.buildings.filter((b) => !b.landmark);
    const classes = [
      { key: 'low', filter: (b) => b.h < 18, repeat: [2, 2] },
      { key: 'mid', filter: (b) => b.h >= 18 && b.h < 46, repeat: [3, 4] },
      { key: 'high', filter: (b) => b.h >= 46, repeat: [4, 8] },
    ];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (const cls of classes) {
      const subset = boxes.filter(cls.filter);
      if (!subset.length) continue;
      const tex = windowTexture(cls.key === 'high' ? 0.45 : 0.3);
      tex.repeat.set(cls.repeat[0], cls.repeat[1]);
      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: tex,
        emissive: new THREE.Color('#ffcf87'),
        emissiveMap: tex,
        emissiveIntensity: 0.05,
        roughness: 0.72,
        metalness: 0.12,
      });
      this.buildingMaterials.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, subset.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      subset.forEach((b, idx) => {
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        mesh.setColorAt(idx, tmpColor.set(b.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
    }

    // Landmarks get a sign so buying property is discoverable from the street.
    for (const b of this.world.buildings.filter((x) => x.landmark)) {
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.55, metalness: 0.2 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const prop = this.world.properties.find((p) => p.id === b.property);
      if (prop) {
        const signMat = new THREE.MeshBasicMaterial({ map: signTexture(prop.name.toUpperCase().slice(0, 18), '#5ee1ff'), transparent: true });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(20, b.w * 0.9), 5), signMat);
        sign.position.set(b.x, Math.min(b.h - 2, 12), b.z + b.d / 2 + 0.1);
        this.scene.add(sign);
        const glow = new THREE.PointLight('#5ee1ff', 12, 30, 2);
        glow.position.set(b.x, 8, b.z + b.d / 2 + 2);
        this.scene.add(glow);
      }
    }

    // Neon hoardings on the skyline.
    const words = ['VICE', 'NEON 88', 'OCEAN', 'CLUB 86', 'MARINA', 'SUNSET'];
    for (let i = 0; i < 14; i++) {
      const b = boxes[Math.floor((i * 97) % boxes.length)];
      if (!b) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: signTexture(words[i % words.length], i % 2 ? '#ff5fbf' : '#5ee1ff'),
        transparent: true,
        opacity: 0.95,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.6), mat);
      sign.position.set(b.x + b.w / 2 + 0.2, Math.min(b.h - 3, 12 + (i % 3) * 6), b.z);
      sign.rotation.y = Math.PI / 2;
      this.scene.add(sign);
    }
  }

  _buildProps() {
    const palms = this.world.props.filter((p) => p.type === 'palm');
    const trees = this.world.props.filter((p) => p.type === 'tree');
    const lamps = this.world.props.filter((p) => p.type === 'streetlight');
    const others = this.world.props.filter((p) => !['palm', 'tree', 'streetlight'].includes(p.type));

    const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.9, side: THREE.DoubleSide });
    const palmTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.34, 1, 6), trunkMat, Math.max(1, palms.length));
    const palmLeaf = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 1.4, 7), leafMat, Math.max(1, palms.length));
    palms.forEach((p, i) => {
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.scale.set(1, p.h, 1);
      dummy.rotation.set(0, 0, 0.03);
      dummy.updateMatrix();
      palmTrunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.h + 0.5, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.updateMatrix();
      palmLeaf.setMatrixAt(i, dummy.matrix);
    });
    palmTrunk.castShadow = true;
    palmLeaf.castShadow = true;
    this.scene.add(palmTrunk, palmLeaf);

    const treeTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.4, 1, 5), trunkMat, Math.max(1, trees.length));
    const treeLeaf = new THREE.InstancedMesh(new THREE.SphereGeometry(2.6, 7, 5), leafMat, Math.max(1, trees.length));
    trees.forEach((p, i) => {
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.scale.set(1, p.h, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      treeTrunk.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, p.h + 1.4, p.z);
      dummy.scale.set(1, 0.8, 1);
      dummy.updateMatrix();
      treeLeaf.setMatrixAt(i, dummy.matrix);
    });
    treeTrunk.castShadow = true;
    treeLeaf.castShadow = true;
    this.scene.add(treeTrunk, treeLeaf);

    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.6, roughness: 0.5 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffd98a', emissiveIntensity: 1.4 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 5), poleMat, Math.max(1, lamps.length));
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 6, 5), bulbMat, Math.max(1, lamps.length));
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glows = new THREE.InstancedMesh(new THREE.CircleGeometry(5.5, 12), glowMat, Math.max(1, lamps.length));
    lamps.forEach((p, i) => {
      dummy.position.set(p.x, 3.5, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 7.05, p.z);
      dummy.updateMatrix();
      bulbs.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 0.12, p.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      glows.setMatrixAt(i, dummy.matrix);
    });
    this.streetGlow = glowMat;
    this.scene.add(poles, bulbs, glows);

    const crateMat = new THREE.MeshStandardMaterial({ color: '#a8562f', roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#7d8b96', metalness: 0.55, roughness: 0.45 });
    const crates = others.filter((p) => p.type === 'crate');
    const crane = others.filter((p) => p.type === 'crane');
    const hangars = others.filter((p) => p.type === 'hangar');
    const towers = others.filter((p) => p.type === 'tower');
    const stations = others.filter((p) => p.type === 'station');

    const crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), crateMat, Math.max(1, crates.length));
    crates.forEach((p, i) => {
      dummy.position.set(p.x, 1.2, p.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, i * 0.8, 0);
      dummy.updateMatrix();
      crateMesh.setMatrixAt(i, dummy.matrix);
    });
    this.scene.add(crateMesh);

    for (const p of crane) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, p.h, 1.2), metalMat);
      leg.position.set(p.x, p.h / 2, p.z);
      leg.castShadow = true;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 18), metalMat);
      arm.position.set(p.x, p.h - 1, p.z + 6);
      arm.castShadow = true;
      this.scene.add(leg, arm);
    }
    for (const p of hangars) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(26, p.h, 18), metalMat);
      hall.position.set(p.x, p.h / 2, p.z);
      hall.castShadow = true;
      this.scene.add(hall);
    }
    for (const p of towers) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, p.h, 8), metalMat);
      shaft.position.set(p.x, p.h / 2, p.z);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), new THREE.MeshStandardMaterial({ color: '#cfe8f5', emissive: '#8fd8ff', emissiveIntensity: 0.4 }));
      cab.position.set(p.x, p.h + 1, p.z);
      this.scene.add(shaft, cab);
    }
    for (const p of stations) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(p.r * 2, p.h, 16), new THREE.MeshStandardMaterial({ color: '#c9b28a', roughness: 0.8 }));
      hall.position.set(p.x, p.h / 2, p.z);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(p.r * 2.2, 0.6, 17.5), new THREE.MeshStandardMaterial({ color: '#8a3f3f', roughness: 0.8 }));
      roof.position.set(p.x, p.h + 0.3, p.z);
      this.scene.add(hall, roof);
    }

    // Rail bed and sleepers.
    const railMat = new THREE.MeshStandardMaterial({ color: '#8a8f98', metalness: 0.8, roughness: 0.35 });
    for (const dz of [-0.8, 0.8]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(CITY.half * 2, 0.16, 0.16), railMat);
      rail.position.set(0, 0.2, this.world.rail.z + dz);
      this.scene.add(rail);
    }
    const sleeperMat = new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 });
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 3.2), sleeperMat, 160);
    for (let i = 0; i < 160; i++) {
      dummy.position.set(-CITY.half + i * 6, 0.14, this.world.rail.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      sleepers.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(sleepers);

    // Runway surface + centre line.
    const runway = new THREE.Mesh(new THREE.BoxGeometry(this.world.airport.runway.width, 0.08, this.world.airport.runway.z1 - this.world.airport.runway.z0), new THREE.MeshStandardMaterial({ color: '#23262c', roughness: 0.7 }));
    runway.position.set(this.world.airport.runway.x, 0.07, (this.world.airport.runway.z0 + this.world.airport.runway.z1) / 2);
    runway.receiveShadow = true;
    this.scene.add(runway);
    const centreMat = new THREE.MeshBasicMaterial({ color: '#e8e4d4' });
    for (let i = 0; i < 18; i++) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 6), centreMat);
      dash.position.set(this.world.airport.runway.x, 0.12, this.world.airport.runway.z0 + 6 + i * 12);
      this.scene.add(dash);
    }
  }

  _buildWater() {
    const waterMat = new THREE.MeshStandardMaterial({ color: '#186b7c', metalness: 0.65, roughness: 0.14, transparent: true, opacity: 0.94 });
    this.waterMaterial = waterMat;
    for (const w of this.world.water) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0), waterMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((w.x0 + w.x1) / 2, 0.02, (w.z0 + w.z1) / 2);
      this.scene.add(plane);
    }
    // Bridges: every street that crosses a water rectangle gets a deck.
    const bridgeMat = new THREE.MeshStandardMaterial({ color: '#3a3d45', roughness: 0.7 });
    const lines = Array.from({ length: CITY.blocks + 1 }, (_, i) => -CITY.half + i * CITY.pitch);
    for (const w of this.world.water) {
      for (const line of lines) {
        if (line > w.x0 && line < w.x1) {
          const deck = new THREE.Mesh(new THREE.BoxGeometry(CITY.roadHalf * 2, 0.5, w.z1 - w.z0), bridgeMat);
          deck.position.set(line, 0.26, (w.z0 + w.z1) / 2);
          deck.receiveShadow = true;
          this.scene.add(deck);
        }
        if (line > w.z0 && line < w.z1) {
          const deck = new THREE.Mesh(new THREE.BoxGeometry(w.x1 - w.x0, 0.5, CITY.roadHalf * 2), bridgeMat);
          deck.position.set((w.x0 + w.x1) / 2, 0.26, line);
          deck.receiveShadow = true;
          this.scene.add(deck);
        }
      }
    }
  }

  _buildPickups() {
    const colors = { health: '#36d97f', armor: '#4aa8ff', scrap: '#ff9a3d', weapon: '#ff4d6d' };
    const geo = new THREE.OctahedronGeometry(0.75, 0);
    for (const pickup of this.world.pickups) {
      const mat = new THREE.MeshStandardMaterial({ color: colors[pickup.type] ?? '#ffffff', emissive: colors[pickup.type] ?? '#ffffff', emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pickup.x, 1.2, pickup.z);
      this.scene.add(mesh);
      const ringMat = new THREE.MeshBasicMaterial({ color: colors[pickup.type] ?? '#ffffff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 20), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pickup.x, 0.12, pickup.z);
      this.scene.add(ring);
      this.pickupMeshes.set(pickup.id, { mesh, ring });
    }
  }

  _buildTraffic() {
    const max = 96;
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.4, roughness: 0.4 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#10161d', metalness: 0.8, roughness: 0.2 });
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.9, 4.4), bodyMat, max);
    const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.65, 2.1), cabinMat, max);
    body.castShadow = true;
    body.count = 0;
    cabin.count = 0;
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cabin.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) body.setColorAt(i, tmpColor.set('#c9c2b6'));
    this.scene.add(body, cabin);
    this.trafficMeshes = { body, cabin, max };
  }

  _buildPeds() {
    const max = 220;
    const torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.26, 0.7, 3, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), max);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 7, 5), new THREE.MeshStandardMaterial({ color: '#e0ac7e', roughness: 0.8 }), max);
    torso.castShadow = true;
    torso.count = 0;
    head.count = 0;
    torso.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    head.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < max; i++) torso.setColorAt(i, tmpColor.set('#e26d5c'));
    this.scene.add(torso, head);
    this.pedMeshes = { torso, head, max };
  }

  /** Add a vehicle actor with a full procedural mesh. */
  addVehicle(state, isPlayer = false) {
    const visual = buildVehicle(state.type, state.spec, state.color ?? VEHICLE_PAINTS[state.id % VEHICLE_PAINTS.length]);
    visual.group.position.set(state.x, state.y ?? 0, state.z);
    this.scene.add(visual.group);
    this.vehicleVisuals.set(state.id, visual);
    if (isPlayer) this.playerVisual = visual;
    return visual;
  }

  removeVehicle(id) {
    const visual = this.vehicleVisuals.get(id);
    if (!visual) return;
    this.scene.remove(visual.group);
    this.vehicleVisuals.delete(id);
  }

  setMarker(id, x, z, color = '#5ee1ff', visible = true) {
    let marker = this.markers.find((m) => m.id === id);
    if (!marker) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      beam.position.y = 13;
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.1, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.16;
      group.add(beam, ring);
      this.scene.add(group);
      marker = { id, group, beam, ring };
      this.markers.push(marker);
    }
    marker.group.position.set(x, 0, z);
    marker.group.visible = visible;
    marker.beam.material.color.set(color);
    marker.ring.material.color.set(color);
    return marker;
  }

  update(dt, frame) {
    this.time += dt;
    const { hour, weather, camera, player, traffic, peds, pickups } = frame;

    // --- lighting / sky ---
    let a = SKY_KEYS[0];
    let b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (hour >= SKY_KEYS[i].h && hour <= SKY_KEYS[i + 1].h) {
        a = SKY_KEYS[i];
        b = SKY_KEYS[i + 1];
        break;
      }
    }
    const t = (hour - a.h) / Math.max(0.0001, b.h - a.h);
    const mix = lerpKey(a, b, Math.max(0, Math.min(1, t)));
    const wx = WEATHER[weather] ?? WEATHER.clear;
    const tint = new THREE.Color(mix.sky).lerp(new THREE.Color(wx.tint), 0.25);
    this.scene.background.set(tint);
    this.scene.fog.color.set(mix.fog);
    this.scene.fog.far = Math.max(160, this.settings.drawDistance * wx.fogMul);
    this.scene.fog.near = Math.min(this.scene.fog.far * 0.5, this.settings.drawDistance * 0.06);
    this.hemi.intensity = mix.hemi * (1 - wx.cloud * 0.25);
    this.ambient.intensity = 0.18 + mix.sun * 0.18;
    this.sun.intensity = mix.sun * (1 - wx.cloud * 0.55) + this.flash;
    this.renderer.toneMappingExposure = 0.95 + mix.sun * 0.12 + this.flash * 0.5;

    const sunAngle = ((hour - 6) / 12) * Math.PI;
    const sunX = Math.cos(sunAngle) * 700;
    const sunY = Math.sin(sunAngle) * 620;
    this.sun.position.set(player.x + sunX * 0.35, Math.max(-40, sunY), player.z - 260);
    this.sun.target.position.set(player.x, 0, player.z);
    this.sunSprite.position.set(player.x + sunX, Math.max(-30, sunY), player.z - 700);
    this.sunSprite.visible = sunY > -40;
    this.moonSprite.position.set(player.x - sunX, Math.max(-30, -sunY * 0.8), player.z + 650);
    this.moonSprite.visible = sunY < 40;
    this.stars.material.opacity = Math.max(0, 1 - (mix.sun + 0.4)) * 0.9;
    this.stars.position.set(player.x, 0, player.z);

    const night = hour < 6 || hour > 19;
    for (const mat of this.buildingMaterials) mat.emissiveIntensity = night ? 0.85 : 0.04;
    if (this.streetGlow) this.streetGlow.opacity = night ? 0.2 : 0;
    this.waterMaterial.color.set(night ? '#0b3b4a' : '#186b7c');
    this.waterMaterial.roughness = 0.1 + (weather === 'rain' || weather === 'storm' ? 0.05 : 0);
    if (this.roadMaterial) {
      const wet = wx.wet;
      this.roadMaterial.color.set(night ? '#1b1e25' : '#2a2d35');
      this.roadMaterial.roughness = 0.62 - wet * 0.42;
      this.roadMaterial.metalness = 0.05 + wet * 0.35;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.4);

    // --- vehicles ---
    for (const [id, visual] of this.vehicleVisuals) {
      const state = frame.vehicles?.get(id);
      if (!state) continue;
      updateVehicleVisual(visual, state, dt, night, id === frame.playerVehicleId);
    }

    // --- traffic ---
    const tm = this.trafficMeshes;
    if (tm && traffic) {
      const n = Math.min(traffic.cars.length, tm.max);
      for (let i = 0; i < n; i++) {
        const car = traffic.cars[i];
        const scale = car.type === 'van' ? 1.25 : car.type === 'scooter' ? 0.55 : car.type === 'sports' ? 0.92 : 1;
        dummy.position.set(car.x, 0.55 * scale, car.z);
        dummy.rotation.set(0, car.yaw, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        tm.body.setMatrixAt(i, dummy.matrix);
        tm.body.setColorAt(i, tmpColor.set(car.color));
        dummy.position.y = 1.02 * scale;
        dummy.updateMatrix();
        tm.cabin.setMatrixAt(i, dummy.matrix);
      }
      tm.body.count = n;
      tm.cabin.count = n;
      tm.body.instanceMatrix.needsUpdate = true;
      tm.cabin.instanceMatrix.needsUpdate = true;
      if (tm.body.instanceColor) tm.body.instanceColor.needsUpdate = true;
    }

    // --- pedestrians ---
    const pm = this.pedMeshes;
    if (pm && peds) {
      const near = peds.filter((p) => Math.abs(p.x - player.x) < 220 && Math.abs(p.z - player.z) < 220).slice(0, pm.max);
      for (let i = 0; i < near.length; i++) {
        const ped = near[i];
        const bob = ped.panic > 0 ? Math.abs(Math.sin(ped.bob * 2)) * 0.12 : Math.abs(Math.sin(ped.bob)) * 0.05;
        dummy.position.set(ped.x, 1.0 + bob, ped.z);
        dummy.rotation.set(0, (ped.yaw ?? 0), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        pm.torso.setMatrixAt(i, dummy.matrix);
        pm.torso.setColorAt(i, tmpColor.set(ped.look.shirt));
        dummy.position.y = 1.68 + bob;
        dummy.updateMatrix();
        pm.head.setMatrixAt(i, dummy.matrix);
        pm.head.setColorAt(i, tmpColor.set(ped.look.skin));
      }
      pm.torso.count = near.length;
      pm.head.count = near.length;
      pm.torso.instanceMatrix.needsUpdate = true;
      pm.head.instanceMatrix.needsUpdate = true;
      if (pm.torso.instanceColor) pm.torso.instanceColor.needsUpdate = true;
      if (pm.head.instanceColor) pm.head.instanceColor.needsUpdate = true;
    }

    // --- pickups ---
    if (pickups) {
      for (const pickup of pickups) {
        const entry = this.pickupMeshes.get(pickup.id);
        if (!entry) continue;
        entry.mesh.visible = pickup.active;
        entry.ring.visible = pickup.active;
        if (pickup.active) {
          entry.mesh.rotation.y += dt * 1.8;
          entry.mesh.position.y = 1.2 + Math.sin(this.time * 2 + pickup.id) * 0.16;
          entry.ring.material.opacity = 0.25 + Math.sin(this.time * 3 + pickup.id) * 0.12;
        }
      }
    }

    // --- weather ---
    this._updateRain(dt, frame, wx);
    if (weather === 'storm' && Math.random() < dt * 0.35) this.flash = 0.9 + Math.random() * 0.8;

    // --- markers ---
    for (const m of this.markers) {
      if (!m.group.visible) continue;
      m.ring.rotation.z += dt * 0.8;
      m.beam.material.opacity = 0.16 + Math.sin(this.time * 2.4) * 0.05;
    }

    this.camera.updateMatrixWorld();
  }

  _updateRain(dt, frame, wx) {
    if (!this.rain && wx.rain > 0) {
      const count = 9000;
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 90;
        positions[i * 3 + 1] = Math.random() * 40;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 90;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#bcd4e6', size: 0.16, transparent: true, opacity: 0.55, depthWrite: false }));
      this.rain.frustumCulled = false;
      this.scene.add(this.rain);
      this.rainPositions = positions;
    }
    if (!this.rain) return;
    this.rain.visible = wx.rain > 0;
    if (!this.rain.visible) return;
    this.rain.material.opacity = wx.rain > 5000 ? 0.7 : 0.45;
    const active = Math.min(this.rainPositions.length / 3, wx.rain);
    const positions = this.rainPositions;
    for (let i = 0; i < active; i++) {
      positions[i * 3 + 1] -= dt * 55;
      if (positions[i * 3 + 1] < 0) {
        positions[i * 3 + 1] = 38;
        positions[i * 3] = (Math.random() - 0.5) * 90;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 90;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.position.set(frame.camera.x, 0, frame.camera.z);
  }

  resize(width = window.innerWidth, height = window.innerHeight) {
    const scale = this.settings.renderScale ?? 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(settings) {
    this.settings = settings;
    this.renderer.shadowMap.enabled = settings.shadows;
    this.sun.castShadow = settings.shadows;
    this.scene.fog.far = settings.drawDistance;
    this.resize();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  applyCamera(cam, look, fov = 62) {
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.lookAt(look.x, look.y, look.z);
    if (Math.abs(this.camera.fov - fov) > 0.4) {
      this.camera.fov += (fov - this.camera.fov) * 0.08;
      this.camera.updateProjectionMatrix();
    }
  }
}

export { WEATHER };
