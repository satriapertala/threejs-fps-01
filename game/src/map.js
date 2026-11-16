// SECTOR 9: an abandoned fuel-processing plant reclaimed by a private security detail.
// One map, built from boxes. Every box registers as a movement collider, a bullet stopper and
// (optionally) a bot navigation blocker. Coordinates: X east, Z south, Y up. The map is roughly
// 64 m east-west and 48 m north-south. Two bomb sites: SITE A to the west, SITE B to the east.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  BOUND: 64,
  T_SPAWN: new THREE.Vector3(-26, 0, -20),
  CT_SPAWN: new THREE.Vector3(26, 0, 20),
  SITE_A: new THREE.Vector3(-20, 0, 14),
  SITE_B: new THREE.Vector3(22, 0, -14),
};

// The route graph the bots walk. Each node is a named point; routes are node id sequences.
export const NODES = [
  { id: 'tspawn', pos: [-26, -20] }, { id: 'tlobby', pos: [-26, -6] },
  { id: 'amid', pos: [-12, 2] }, { id: 'asite', pos: [-20, 14] },
  { id: 'ahall', pos: [-24, 6] }, { id: 'mid', pos: [0, 0] },
  { id: 'midn', pos: [0, -14] }, { id: 'mids', pos: [0, 16] },
  { id: 'bmid', pos: [12, -2] }, { id: 'bsite', pos: [22, -14] },
  { id: 'bhall', pos: [24, -4] }, { id: 'ctspawn', pos: [26, 20] },
  { id: 'ctlobby', pos: [16, 16] }, { id: 'bconn', pos: [14, 10] },
  { id: 'aconn', pos: [-14, 12] },
];

// Hand-authored adjacency (symmetric). Bots run Dijkstra over this.
export const EDGES = [
  ['tspawn', 'tlobby'], ['tlobby', 'amid'], ['tlobby', 'ahall'], ['amid', 'asite'],
  ['amid', 'mid'], ['ahall', 'asite'], ['ahall', 'aconn'], ['aconn', 'asite'],
  ['aconn', 'mids'], ['mid', 'midn'], ['mid', 'mids'], ['midn', 'bmid'],
  ['midn', 'bsite'], ['bmid', 'bhall'], ['bhall', 'bsite'], ['bmid', 'bconn'],
  ['bconn', 'mids'], ['bconn', 'bsite'], ['mids', 'ctlobby'], ['ctlobby', 'ctspawn'],
  ['ctlobby', 'aconn'], ['ctlobby', 'bconn'], ['mid', 'amid'], ['mid', 'bmid'],
];

export const ROUTES = {
  t: {
    rushA: ['tspawn', 'tlobby', 'amid', 'asite'],
    rushB: ['tspawn', 'tlobby', 'amid', 'mid', 'midn', 'bsite'],
    flankA: ['tspawn', 'tlobby', 'ahall', 'asite'],
    midSplit: ['tspawn', 'tlobby', 'amid', 'mid', 'mids', 'bconn', 'bsite'],
  },
  ct: {
    holdA: ['ctspawn', 'ctlobby', 'aconn', 'asite'],
    holdB: ['ctspawn', 'ctlobby', 'bconn', 'bsite'],
    midPick: ['ctspawn', 'ctlobby', 'mids', 'mid', 'midn', 'bmid'],
    rotateA: ['ctspawn', 'ctlobby', 'aconn', 'ahall', 'asite'],
  },
};

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.4 : 0.9,
      metalness: name === 'muted' ? 0.35 : 0.02,
    });
  }
  // Recycled geometries: one unit box scaled per block, so no per-block allocation of new
  // geometry data and the GPU holds a single vertex buffer for the whole map.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(unitBox, materials[material]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter walls (the plant yard, walled off).
  box(64, 0.5, 52, 0, -0.25, 0, 'ink');
  box(64, 5, 1, 0, 2.5, -26, 'surface');
  box(64, 5, 1, 0, 2.5, 26, 'surface');
  box(1, 5, 52, -32, 2.5, 0, 'surface');
  box(1, 5, 52, 32, 2.5, 0, 'surface');

  // SITE A (west): a drained holding tank ringed by low blast walls.
  box(10, 1.2, 10, -20, 0.6, 14, 'hairline');
  box(3, 1.0, 1, -16, 0.5, 9, 'hairline');
  box(1, 1.0, 4, -25, 0.5, 8, 'hairline');
  box(2.2, 3.4, 2.2, -23, 1.7, 17, 'hairline'); // tank pillar
  box(2.2, 3.4, 2.2, -17, 1.7, 18, 'hairline');

  // SITE B (east): pump hall with a raised manifold the defuse stands on.
  box(9, 0.7, 9, 22, 0.35, -14, 'surface');
  box(1.2, 2.6, 8, 26.5, 1.3, -14, 'muted');
  box(8, 2.6, 1.2, 22, 1.3, -18.5, 'muted');
  box(1.6, 1.1, 1.6, 19, 0.55, -11, 'hairline');

  // Mid corridor: long sightline with a hard corner.
  box(1.4, 3.6, 10, -2.5, 1.8, -8, 'surface');
  box(1.4, 3.6, 10, 2.5, 1.8, 8, 'surface');
  box(5, 2.6, 1.4, 0, 1.3, -18, 'surface');   // mid wall block
  box(5, 2.6, 1.4, 0, 1.3, 18, 'surface');

  // T-side approach to A: crates to crouch behind.
  box(2, 1.1, 2, -18, 0.55, -4, 'hairline');
  box(2, 1.1, 2, -15, 0.55, -1, 'hairline');
  box(1.2, 2.2, 1.2, -8, 1.1, 4, 'hairline');

  // CT-side connectors: pipes and barrels.
  box(1.6, 1.4, 1.6, 14, 0.7, 12, 'muted');
  box(1.6, 1.4, 1.6, 16, 0.7, 14, 'muted');
  box(1.2, 2.2, 1.2, 10, 1.1, -8, 'muted');
  box(2.4, 1.1, 1.4, 8, 0.55, 2, 'hairline');
  box(1.2, 2.4, 1.2, -12, 1.2, 10, 'muted');
  box(2.4, 1.0, 1.4, 18, 0.5, -6, 'hairline');
  box(1.6, 2.4, 1.6, -10, 1.2, -16, 'muted');
  box(1.6, 2.4, 1.6, 12, 1.2, 18, 'muted');

  // T spawn shed and CT spawn kiosk (spawn cover).
  box(6, 3, 4, -26, 1.5, -22, 'surface');
  box(6, 3, 4, 26, 1.5, 22, 'surface');

  // Hazard stripes at each site, painted thin accent boxes (visual only, no collider).
  const stripeMat = materials.accent;
  for (const [sx, sz] of [[-20, 9.2], [22, -9.4]]) {
    const stripe = new THREE.Mesh(unitBox, stripeMat);
    stripe.scale.set(6, 0.06, 0.5);
    stripe.position.set(sx, 0.03, sz);
    group.add(stripe);
  }

  return { colliders, shootables, group };
}

// Shortest path between nodes over EDGES (Dijkstra, few nodes, run only when a route is picked).
export function findRoute(fromId, toId) {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  const adj = new Map(NODES.map((n) => [n.id, []]));
  for (const [a, b] of EDGES) {
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const dist = new Map(NODES.map((n) => [n.id, Infinity]));
  const prev = new Map();
  dist.set(fromId, 0);
  const open = [...NODES.map((n) => n.id)];
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[best])) best = i;
    const cur = open.splice(best, 1)[0];
    if (cur === toId) break;
    for (const next of adj.get(cur)) {
      const d = dist.get(cur) + Math.hypot(
        byId.get(next).pos[0] - byId.get(cur).pos[0],
        byId.get(next).pos[1] - byId.get(cur).pos[1],
      );
      if (d < dist.get(next)) { dist.set(next, d); prev.set(next, cur); }
    }
  }
  const path = [];
  let at = toId;
  while (at !== undefined) { path.unshift(at); at = prev.get(at); }
  return path[0] === fromId ? path : [fromId, toId];
}

export function nodePos(id) {
  const n = NODES.find((m) => m.id === id);
  return new THREE.Vector3(n.pos[0], 0, n.pos[1]);
}
