// Visual proxies for the actors, the bomb and grenades: simple blocky figures in team colours
// (attackers warm, defenders cold), a blinking charge at the planted site, grenade spheres.
// Created once per slot and reused every frame — nothing is allocated in the hot loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { BODY } from './physics.js';

function figure(bodyColor, headColor) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(headColor), roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.34, 0.44), bodyMat);
  body.position.y = 0.67;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), headMat);
  head.position.y = 1.56;
  head.castShadow = true;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.86), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline) }));
  gun.position.set(0.24, 1.18, 0.28);
  group.add(body, head, gun);
  return { group, body, head, gun };
}

export function createEntities(scene) {
  const figureGroup = new THREE.Group();
  scene.add(figureGroup);

  const playerFig = figure(PALETTE.ink, PALETTE.muted);
  const ctFigs = [];
  const tFigs = [];
  for (let i = 0; i < 4; i++) {
    const f = figure('#5f7f9e', PALETTE.muted);
    ctFigs.push(f);
    figureGroup.add(f.group);
  }
  for (let i = 0; i < 5; i++) {
    const f = figure('#9e6a3c', PALETTE.accent);
    tFigs.push(f);
    figureGroup.add(f.group);
  }
  figureGroup.add(playerFig.group);
  playerFig.group.visible = false; // first person: only the shadowless proxy off

  // bomb: a small box with a blinking accent lamp
  const bomb = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.24, 0.34),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline) }),
  );
  bomb.visible = false;
  scene.add(bomb);
  const bombLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent) }),
  );
  bombLamp.visible = false;
  scene.add(bombLamp);

  // dropped bomb marker (not planted yet, lying where the carrier fell)
  const grenadeGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5 });

  const liveGrenades = [];
  function spawnGrenade(origin, dir, thrower) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.set(origin.x, origin.y + 1.4, origin.z).addScaledVector(dir, 0.6);
    scene.add(mesh);
    const def = { mesh, position: mesh.position, velocity: dir.clone().multiplyScalar(15).setY(dir.y * 15 + 3.2), fuse: 1.7, thrower, weaponDef: { radius: 6.5, damage: 95 } };
    liveGrenades.push(def);
    return def;
  }
  function removeGrenade(g) {
    scene.remove(g.mesh);
    const i = liveGrenades.indexOf(g);
    if (i !== -1) liveGrenades.splice(i, 1);
  }

  let blink = 0;
  function sync(state, grenades) {
    blink += 0.05;
    let ci = 0;
    let ti = 0;
    for (const actor of state.actors) {
      if (actor.isPlayer) continue;
      const fig = actor.team === 'CT' ? ctFigs[ci++] : tFigs[ti++];
      if (!fig) continue;
      fig.group.visible = actor.alive;
      if (!actor.alive) continue;
      fig.group.position.set(actor.position.x, actor.position.y, actor.position.z);
      fig.group.rotation.y = actor.yaw + Math.PI; // figures' local +Z is their front
      const crouchScale = actor.height / BODY.HEIGHT;
      fig.body.scale.y = crouchScale;
      fig.head.position.y = 1.56 * crouchScale;
    }
    // bomb states
    bomb.visible = state.bomb.planted;
    bombLamp.visible = state.bomb.planted;
    if (state.bomb.planted) {
      bomb.position.set(state.bomb.position.x, state.bomb.position.y + 0.12, state.bomb.position.z);
      bomb.rotation.y = Math.sin(state.bomb.site === 'A' ? 1.2 : 2.1);
      bombLamp.position.set(state.bomb.position.x, state.bomb.position.y + 0.3, state.bomb.position.z);
      bombLamp.material.emissiveIntensity = (Math.sin(blink * 3) + 1.2) * (state.bomb.timer < 10 ? 2.4 : 1);
    }
    // live grenade meshes follow their physics bodies
    for (const g of liveGrenades) g.mesh.position.copy(g.position);
  }

  return { sync, spawnGrenade, removeGrenade, playerFig, updateBomb() {} };
}
