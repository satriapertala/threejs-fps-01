// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The sim owns match state (state.js), rounds (rounds.js), bots (bots.js) and combat
// (combat.js); the render pass below only reads that state and draws it.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it,
// then sets window.__shotReady (used by the screenshot harness).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, MAP, NODES, ROUTES, nodePos } from './map.js';
import { createInput } from './input.js';
import { moveBody, BODY } from './physics.js';
import { createGameState, TEAM, currentWeapon, armActor } from './state.js';
import { WEAPONS, spreadFor } from './weapons.js';
import { fireHitscan, hasLineOfSight, stepGrenade, traceShot } from './combat.js';
import { createBotDirector, updateBots, startReload, plantBomb } from './bots.js';
import { startRound, stepRounds, bindRoutes, endRound, DEFUSE_TIME, MATCH_TARGET } from './rounds.js';
import { createHud } from './hud.js';
import { createEntities } from './entities.js';
import { mulberry32 } from './random.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

// ---------------------------------------------------------------- scene (render-only setup)
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 50, 130);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// dusk sun + warm sodium fill so the palette reads at a glance
const sun = new THREE.DirectionalLight(0xdce4ee, 2.0);
sun.position.set(-18, 52, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x4a5868, 0x2a2f36, 2.2));
const midFill = new THREE.PointLight(0xbcd0e4, 26, 34, 1.5);
midFill.position.set(0, 6.5, 2);
scene.add(midFill);
const sodium = new THREE.PointLight(0xe89322, 90, 30, 1.4);
sodium.position.set(-20, 4.4, 14);
scene.add(sodium);
const sodium2 = new THREE.PointLight(0xe89322, 90, 30, 1.4);
sodium2.position.set(22, 4.4, -14);
scene.add(sodium2);

const world = createMap(scene);
const entities = createEntities(scene);
const hud = createHud();

// ---------------------------------------------------------------- sim state
const state = createGameState();
state.random = random;
const director = createBotDirector(1);
bindRoutes(ROUTES.t, ROUTES.ct);
startRound(state, random);

const player = state.actors[0]; // the player is actors[0]
const input = createInput(renderer.domElement, onLockChange, {
  switchWeapon(slot) { if (slot === WEAPONS.rifle.slot && player.hasRifle) player.weaponSlot = slot; else if (slot === WEAPONS.pistol.slot) player.weaponSlot = slot; else if (slot === WEAPONS.grenade.slot && player.grenades > 0) player.weaponSlot = slot; },
  throwGrenade() { tryThrowGrenade(); },
  toggleBuy() { hud.toggleBuy(); },
  interact() {}, // defuse is hold-E, polled
  reload() { startReload(player); },
});

const viewDir = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const grenades = []; // live grenade objects { mesh, position, velocity, fuse, thrower, weaponDef }
const events = [];   // per-tick sim events, drained by the HUD/audio pass
let accumulator = 0;
let lastTime = performance.now();
let bombMeshPlanted = false;
let frozen = shot !== null;
let started = false;
let roundResult = null;

hud.setBuyHandlers({
  rifle() { tryBuy(WEAPONS.rifle.price, () => { player.hasRifle = true; armActor(player); }); },
  armor() { tryBuy(1000, () => { player.armor = 100; }); },
  grenade() { tryBuy(WEAPONS.grenade.price, () => { player.grenades += 1; }); },
  ammo() { tryBuy(200, () => { player.reserveAmmo = currentWeapon(player).reserveAmmo; }); },
});

function tryBuy(price, apply) {
  if (state.phase !== 'buy' || player.money < price) return;
  player.money -= price;
  apply();
  hud.refreshBuy(player);
}

function onLockChange(locked) {
  if (!locked && started && state.phase !== 'matchover') hud.showOverlay('paused');
}

hud.onPlay(() => {
  if (shot) return;
  started = true;
  if (state.phase === 'matchover') {
    restartMatch();
  }
  hud.hideOverlay();
  input.requestLock();
});

function restartMatch() {
  state.scoreT = 0;
  state.scoreCT = 0;
  state.roundNumber = 1;
  for (const a of state.actors) { a.money = 800; a.hasRifle = false; a.grenades = 0; a.kills = 0; a.deaths = 0; }
  startRound(state, random);
  roundResult = null;
  frozen = false;
}

// ---------------------------------------------------------------- player sim
function simPlayer(dt) {
  if (!player.alive) { observeDeadEye(dt); return; }
  const look = input.takeLook();
  player.yaw -= look.x * 0.0023;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - look.y * 0.0023));

  const weapon = currentWeapon(player);
  // the buy phase and the round-over freeze lock movement but keep the view live
  const lockedPhase = state.phase === 'buy' || state.phase === 'roundover' || state.phase === 'matchover';
  if (!input.state.locked || frozen || lockedPhase) {
    moveBody(player, 0, 0, dt, world.colliders, false, false);
    player.recoil = Math.max(0, player.recoil - weapon.recoilRecover * dt);
    tryDefuse(dt);
    return;
  }

  const forward = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
  const strafe = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const wishX = -sin * forward + cos * strafe;
  const wishZ = -cos * forward - sin * strafe;
  const crouching = input.down('ControlLeft') || input.down('ControlRight');
  const walking = input.down('ShiftLeft');
  player.crouching = crouching;
  moveBody(player, wishX * (walking ? 0.45 : 1), wishZ * (walking ? 0.45 : 1), dt, world.colliders, crouching, input.down('Space'));

  // firing: automatic weapons hold the trigger, the sidearm needs a fresh click
  const interval = 60 / weapon.rpm;
  if (input.state.firing && !player.reloading && player.weaponSlot !== WEAPONS.grenade.slot) {
    const ready = weapon.auto ? player.fireCooldown <= 0 : player.fireCooldown <= -0.12;
    if (ready && player.magAmmo > 0) {
      firePlayer(weapon);
      player.fireCooldown = interval;
    }
  }
  player.fireCooldown -= dt;
  if (player.fireCooldown < -interval) player.fireCooldown = -interval;

  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) finishReload(player);
  }
  player.recoil = Math.max(0, player.recoil - weapon.recoilRecover * dt);
  tryDefuse(dt);
}

// view kick: recoil pitches the camera up a little each shot, recovering over time
function firePlayer(weapon) {
  player.magAmmo -= 1;
  player.lastShotAt = state.matchTime;
  player.recoil = Math.min(0.055, player.recoil + weapon.recoilKick * 3.2);
  const speed = Math.hypot(player.velocity.x, player.velocity.z);
  const spread = spreadFor(weapon, speed, !player.onGround, player.crouching, player.recoil * 0.4);
  viewDir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  shotDir.copy(viewDir);
  shotDir.x += (random() - 0.5) * 2 * spread;
  shotDir.y += (random() - 0.5) * 2 * spread;
  shotDir.z += (random() - 0.5) * 2 * spread;
  shotDir.normalize();
  fireHitscan(world, state.actors, player, shotDir, events);
  events.push({ type: 'shot', shooter: player, position: player.position.clone(), team: player.team });
  if (player.magAmmo <= 0) startReload(player);
}

function finishReload(actor) {
  const weapon = currentWeapon(actor);
  const need = weapon.magSize - actor.magAmmo;
  const take = Math.min(need, actor.reserveAmmo);
  actor.magAmmo += take;
  actor.reserveAmmo -= take;
  actor.reloading = 0;
}

function tryDefuse(dt) {
  const bomb = state.bomb;
  if (!bomb.planted || bomb.defused) { hud.setProgress(0, ''); bombMeshPlanted && entities.updateBomb(bomb); return; }
  const near = player.position.distanceTo(bomb.position) < 2.2 && input.down('KeyE');
  if (near) {
    bomb.defuseProgress += dt / DEFUSE_TIME;
    if (bomb.defuseProgress >= 1) {
      bomb.defused = true;
      player.money += 300;
      events.push({ type: 'defused' });
    }
    hud.setProgress(bomb.defuseProgress, 'DEFUSING — HOLD E');
  } else {
    hud.setProgress(0, '');
  }
}

function tryThrowGrenade() {
  if (player.grenades <= 0 || !player.alive || state.phase === 'buy') return;
  player.grenades -= 1;
  viewDir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  const mesh = entities.spawnGrenade(player.position, viewDir, player);
  grenades.push(mesh);
  if (player.grenades === 0) player.weaponSlot = player.hasRifle ? 0 : 1;
}

// bomb carrier death drops the bomb on the ground; another T picks it up by walking near.
function stepBombCarry() {
  const bomb = state.bomb;
  if (bomb.planted) return;
  if (bomb.carrier && !bomb.carrier.alive) {
    bomb.carrier = null;
    bomb.dropped = true;
    bomb.position.copy(carrierDeathPos);
  }
  if (bomb.dropped && !bomb.carrier) {
    for (const a of state.actors) {
      if (a.alive && a.team === TEAM.T && a.position.distanceTo(bomb.position) < 1.8) {
        bomb.carrier = a;
        bomb.dropped = false;
        break;
      }
    }
  }
}
let carrierDeathPos = new THREE.Vector3();

// dead player spectates from above the map center
function observeDeadEye(dt) {
  hud.setProgress(0, '');
}

// ---------------------------------------------------------------- sim tick
function simulate(dt) {
  state.matchTime += dt;
  events.length = 0;

  simPlayer(dt);
  stepBombCarry();
  updateBots(state, world, director, dt, events, random);
  stepRounds(state, dt, events);

  // grenade fuses
  for (let i = grenades.length - 1; i >= 0; i--) {
    if (stepGrenade(grenades[i], dt, state.actors, world, events)) {
      entities.removeGrenade(grenades[i]);
      grenades.splice(i, 1);
    }
  }

  // sounds decay: bots read them on the tick they were emitted
  if (state.sounds.length) state.sounds.length = 0;
  for (const e of events) {
    if (e.type === 'shot' || e.type === 'explosion') state.sounds.push(e);
  }

  // carrier death bookkeeping
  for (const e of events) {
    if (e.type === 'kill') {
      if (e.victim === state.bomb.carrier) carrierDeathPos.copy(e.victim.position);
      state.killFeed.unshift({ killer: e.shooter.name, victim: e.victim.name, headshot: e.headshot, t: state.matchTime });
      if (state.killFeed.length > 4) state.killFeed.pop();
    }
    if (e.type === 'bomboom') {
      // the detonation damages anyone near the site too
      for (const a of state.actors) {
        if (!a.alive) continue;
        const d = a.position.distanceTo(e.position);
        if (d < 14) { a.health -= (14 - d) * 12; if (a.health <= 0) { a.alive = false; a.deaths += 1; } }
      }
    }
  }
}

// ---------------------------------------------------------------- render pass (reads sim state)
function render() {
  // camera follows the player's eyes (or an overhead view while dead)
  if (player.alive) {
    const eyeY = player.position.y + (player.crouching ? BODY.CROUCH_EYE : BODY.EYE);
    camera.position.set(player.position.x, eyeY, player.position.z);
    const recoilPitch = player.pitch + player.recoil;
    camera.rotation.set(recoilPitch, player.yaw, 0, 'YXZ');
  } else {
    camera.position.set(state.bomb.position.x, 22, state.bomb.position.z + 18);
    camera.lookAt(state.bomb.position.x, 0, state.bomb.position.z);
  }
  entities.sync(state, grenades, random);
  renderer.render(scene, camera);
}

// HUD push (cheap DOM writes only when values change — inside hud.js)
function pushHud() {
  hud.setHealth(player.health, player.armor, player.alive);
  hud.setAmmo(player.magAmmo, player.reserveAmmo, currentWeapon(player).name);
  hud.setMoney(player.money);
  hud.setScore(state.scoreT, state.scoreCT, state.roundNumber);
  hud.setTimer(state.phase === 'planted' ? state.bomb.timer : (state.phase === 'buy' ? state.phaseTimer : state.roundTime), state.phase);
  hud.setKillFeed(state.killFeed);
  hud.setCrosshairSpread(spreadFor(currentWeapon(player), Math.hypot(player.velocity.x, player.velocity.z), !player.onGround, player.crouching, player.recoil));
  hud.setBanner(state.winnerText, state.phase);
  hud.refreshBuy(player);
  hud.tick();
  drainEvents();
  if (state.phase === 'matchover' && !hud.matchShown) { hud.matchShown = true; hud.showOverlay('matchover'); }
  if (state.phase !== 'matchover') hud.matchShown = false;
}

function drainEvents() {
  for (const e of events) {
    if (e.type === 'hit' && e.shooter === player) hud.hitMarker(e.headshot);
    else if (e.type === 'headshot' && e.shooter === player) hud.hitMarker(true);
    if (e.type === 'playerdied') hud.showOverlay('dead');
    if (e.type === 'bombplant') hud.flashBanner('CHARGE PLANTED — SITE ' + e.site);
    if (e.type === 'defused') hud.flashBanner('CHARGE DEFUSED');
    if (e.type === 'explosion') hud.flashBanner('');
  }
}

// ---------------------------------------------------------------- main loop
function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  if (!frozen && started) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps === 5) accumulator = 0;
  }
  pushHud();
  render();
}
requestAnimationFrame(frame);

// Place an actor on the camera's sight line: `ahead` metres forward, `side` metres right.
function stageLine(player, ahead, side, team) {
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw);
  const rz = -Math.sin(player.yaw);
  const actor = state.actors.find((a) => a.team === team && !a.isPlayer && a.alive && !a.staged);
  if (!actor) return;
  actor.staged = true;
  actor.position.set(player.position.x + fx * ahead + rx * side, 0, player.position.z + fz * ahead + rz * side);
  // face the camera
  actor.yaw = Math.atan2(-(player.position.x - actor.position.x), -(player.position.z - actor.position.z));
}

// Deterministic capture support (used to take the entry's screenshots): ?shot=start|play|buy|end
// stages a frame synchronously, renders it and resolves window.__shotReady. No timers, so a
// browser screenshot taken right after load already has the staged frame.
if (shot) {
  started = true;
  if (shot === 'play' || shot === 'buy' || shot === 'end') {
    state.phase = 'live';
    state.roundTime = 78;
    state.phaseTimer = 0;
    for (let i = 0; i < 900; i++) simulate(FIXED_STEP); // let the bots walk their routes
    player.alive = true;
    player.health = 100;
    player.armor = 100;
    player.hasRifle = true;
    player.grenades = 1;
    player.weaponSlot = 0;
    armActor(player);
    player.magAmmo = 27;
    player.reserveAmmo = 90;
    state.scoreT = 1;
    state.scoreCT = 2;
    state.roundNumber = 4;
    for (const a of state.actors) { a.target = null; a.reactionTimer = 99; a.staged = false; }
    state.killFeed = [
      { killer: 'CT-2', victim: 'T-4', headshot: true },
      { killer: 'YOU', victim: 'T-2', headshot: false },
    ];
  }
  if (shot === 'play') {
    state.phase = 'live';
    state.roundTime = 61;
    // Stage a firefight: the camera looks down the mid-south lane, two attackers stand in it
    // at 7 m and 11 m (the closer one crouched behind the low wall), two teammates flank.
    player.position.set(9.0, 0, 8.0);
    player.yaw = 0.5;
    player.pitch = -0.03;
    player.crouching = false;
    stageLine(player, 5.5, 2.2, 'T');
    stageLine(player, 9.0, -1.8, 'T');
    stageLine(player, -2.4, 1.8, 'CT');
    stageLine(player, -3.4, -2.2, 'CT');
  } else if (shot === 'end') {
    state.phase = 'planted';
    state.bomb.planted = true;
    state.bomb.site = 'A';
    state.bomb.position.set(-20, 0.6, 14);
    state.bomb.timer = 13;
    state.bomb.carrier = null;
    player.position.set(-13.4, 0, 19.6);
    player.yaw = 0.55;
    player.pitch = -0.14;
    player.crouching = false;
  } else if (shot === 'buy') {
    state.phase = 'buy';
    state.phaseTimer = 5;
    player.position.set(24, 0, 15);
    player.yaw = Math.PI * 0.9;
    player.money = 4350;
    hud.showOverlay('none');
    hud.toggleBuy();
  }
  if (shot !== 'start') hud.showOverlay('none');
  render();
  pushHud();
  hud.tick();
  // a second render settles the shadow map for the staged frame
  render();
  window.__shotReady = Promise.resolve(true);
}
