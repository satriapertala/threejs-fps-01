// Bot brains. Each bot walks waypoints (a route from the map graph), stops at named hold
// points, reacts to what it sees (a reaction delay before it fires) and what it hears
// (gunshots pull nearby bots toward the sound). Difficulty scales reaction time and aim.
import * as THREE from 'three';
import { TEAM } from './state.js';
import { currentWeapon } from './state.js';
import { hasLineOfSight, fireHitscan } from './combat.js';
import { spreadFor } from './weapons.js';
import { moveBody, BODY } from './physics.js';
import { findRoute, nodePos, ROUTES, MAP } from './map.js';

const DIFFICULTY = {
  0: { reaction: 0.55, aimJitter: 0.030, viewDist: 42, burst: 4 },
  1: { reaction: 0.38, aimJitter: 0.020, viewDist: 48, burst: 5 },
  2: { reaction: 0.26, aimJitter: 0.012, viewDist: 55, burst: 6 },
};

const tmpDir = new THREE.Vector3();
const jitterDir = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const toNode = new THREE.Vector3();

export function createBotDirector(difficulty) {
  const diff = DIFFICULTY[Math.max(0, Math.min(2, difficulty))];
  return { diff };
}

// Per-tick bot update. `state` is the match state, `world` the map colliders.
export function updateBots(state, world, director, dt, events, random) {
  const diff = director.diff;
  for (const bot of state.actors) {
    if (bot.isPlayer || !bot.alive) continue;
    botBrain(state, world, bot, diff, dt, events, random);
  }
}

function botBrain(state, world, bot, diff, dt, events, random) {
  // 1. Perception: visible enemies, heard shots.
  let visible = null;
  let bestDist = diff.viewDist;
  for (const other of state.actors) {
    if (!other.alive || other.team === bot.team) continue;
    const d = other.position.distanceTo(bot.position);
    if (d > bestDist) continue;
    if (!hasLineOfSight(world, state.actors, bot, other)) continue;
    // roughly in front (bots have a wide 160-degree field of view)
    toTarget.copy(other.position).sub(bot.position).setY(0).normalize();
    const facing = tmpDir.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (facing.dot(toTarget) > -0.28 || d < 4) {
      bestDist = d;
      visible = other;
    }
  }
  if (visible) {
    if (bot.target !== visible) {
      bot.target = visible;
      bot.reactionTimer = diff.reaction * (0.7 + random() * 0.6);
    }
  } else if (bot.target) {
    bot.holdTimer += dt;
    if (bot.holdTimer > 1.4) { bot.target = null; bot.holdTimer = 0; }
  }

  // heard a gunshot recently: face the sound, and if close enough divert toward it
  if (state.sounds.length) {
    for (const sound of state.sounds) {
      if (sound.team === bot.team) continue;
      const d = bot.position.distanceTo(sound.position);
      if (d < 34) bot.lastHeardShot = { position: sound.position.clone(), age: 0 };
    }
  }

  // 2. Objective: Ts carry/plant the bomb; CTs drift toward the planted site.
  if (state.bomb.planted && bot.team === TEAM.CT) {
    const sitePos = state.bomb.position;
    if (!bot.bombRush) {
      bot.route = routeToNearest(bot, sitePos);
      bot.routeIndex = 0;
      bot.bombRush = true;
    }
  }
  if (bot.team === TEAM.T && state.bomb.carrier === bot && !state.bomb.planted) {
    // carrier pushes the assigned site
    if (!bot.assignedSite) bot.assignedSite = random() < 0.5 ? 'A' : 'B';
    const site = bot.assignedSite === 'A' ? MAP.SITE_A : MAP.SITE_B;
    if (!bot.route || bot.routeGoal !== bot.assignedSite) {
      bot.route = routeToNearest(bot, site);
      bot.routeIndex = 0;
      bot.routeGoal = bot.assignedSite;
    }
    if (bot.position.distanceTo(site) < 2.6) {
      bot.plantTimer = (bot.plantTimer ?? 3.2) - dt;
      if (bot.plantTimer <= 0) { plantBomb(state, bot, events); return; }
      moveBody(bot, 0, 0, dt, world.colliders, true, false); // crouch while planting
      return;
    }
  }

  // 3. Combat: face target, fire after the reaction delay, with aim jitter per shot.
  if (bot.target && bot.reactionTimer > 0) bot.reactionTimer -= dt;
  if (bot.target && bot.reactionTimer <= 0) {
    aimAt(bot, bot.target, dt, diff, random);
    bot.fireTimer -= dt;
    const weapon = currentWeapon(bot);
    const interval = 60 / weapon.rpm;
    if (bot.fireTimer <= 0 && bot.magAmmo > 0 && !bot.reloading) {
      bot.fireTimer = interval * (weapon.auto ? (random() < 0.5 ? 1 : 2.4) : 2.2);
      botShoot(state, world, bot, diff, events, random);
    }
    // stop to shoot when engaging
    moveBody(bot, 0, 0, dt, world.colliders, false, false);
    if (bot.magAmmo <= 0 && !bot.reloading) startReload(bot);
    return;
  }

  // 4. Move along route (or toward the last heard shot), holding at nodes briefly.
  const goal = pickGoal(bot, dt);
  if (goal) {
    toNode.copy(goal).sub(bot.position).setY(0);
    const dist = toNode.length();
    if (dist < 1.6) {
      bot.routeIndex += 1;
      bot.holdTimer = random() < 0.35 ? 0.8 + random() : 0;
    } else {
      const crouch = dist > 12 && random() < 0.02; // occasionally crouch-walk a long stretch
      moveBody(bot, toNode.x, toNode.z, dt, world.colliders, crouch && bot.holdTimer > 0 ? true : false, false);
      bot.yaw = Math.atan2(-toNode.x, -toNode.z);
    }
  } else {
    moveBody(bot, 0, 0, dt, world.colliders, false, false);
  }
  if (bot.magAmmo < currentWeapon(bot).magSize * 0.35 && !bot.reloading) startReload(bot);
}

function pickGoal(bot, dt) {
  if (bot.lastHeardShot && bot.lastHeardShot.age < 6 && !bot.target) {
    bot.lastHeardShot.age += dt;
    return bot.lastHeardShot.position;
  }
  if (bot.holdTimer > 0) { bot.holdTimer -= dt; return null; }
  if (!bot.route || bot.routeIndex >= bot.route.length) {
    // route finished: hold ground (bots keep their angle and watch the lane)
    return null;
  }
  return nodePos(bot.route[bot.routeIndex]);
}

function aimAt(bot, target, dt, diff, random) {
  toTarget.set(
    target.position.x - bot.position.x,
    target.position.y + target.height * 0.6 - (bot.position.y + bot.height * 0.8),
    target.position.z - bot.position.z,
  ).normalize();
  bot.aimDir = bot.aimDir || new THREE.Vector3();
  bot.aimDir.lerp(toTarget, Math.min(1, 9 * dt));
  bot.aimDir.normalize();
  // yaw in the camera's convention: forward is (-sin yaw, 0, -cos yaw)
  bot.yaw = Math.atan2(-bot.aimDir.x, -bot.aimDir.z);
  bot.pitch = Math.asin(bot.aimDir.y);
}

function botShoot(state, world, bot, diff, events, random) {
  const weapon = currentWeapon(bot);
  jitterDir.copy(bot.aimDir);
  jitterDir.x += (random() - 0.5) * 2 * diff.aimJitter;
  jitterDir.y += (random() - 0.5) * 2 * diff.aimJitter;
  jitterDir.z += (random() - 0.5) * 2 * diff.aimJitter;
  jitterDir.normalize();
  const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
  const spread = spreadFor(weapon, speed, !bot.onGround, bot.crouching, bot.recoil);
  jitterDir.x += (random() - 0.5) * 2 * spread;
  jitterDir.y += (random() - 0.5) * 2 * spread;
  jitterDir.normalize();
  bot.magAmmo -= 1;
  bot.recoil = Math.min(0.06, bot.recoil + weapon.recoilKick);
  fireHitscan(world, state.actors, bot, jitterDir, events);
  events.push({ type: 'shot', shooter: bot, position: bot.position.clone(), team: bot.team });
}

export function startReload(bot) {
  bot.reloading = currentWeapon(bot).reloadTime;
}

// Route to whichever graph node is nearest the world point, then onward (used for reacting
// to sound and rushing the planted bomb).
function routeToNearest(bot, point) {
  let nearestNode = null;
  let bestD = Infinity;
  for (const node of ROUTES.t ? [] : []) {} // (nodes live in map.js; iterate via findRoute)
  const ids = ['tspawn', 'tlobby', 'amid', 'asite', 'ahall', 'aconn', 'mid', 'midn', 'mids',
    'bmid', 'bconn', 'bhall', 'bsite', 'ctspawn', 'ctlobby'];
  for (const id of ids) {
    const p = nodePos(id);
    const d = p.distanceTo(point);
    if (d < bestD) { bestD = d; nearestNode = id; }
  }
  let fromNode = ids[0];
  bestD = Infinity;
  for (const id of ids) {
    const p = nodePos(id);
    const d = p.distanceTo(bot.position);
    if (d < bestD) { bestD = d; fromNode = id; }
  }
  return findRoute(fromNode, nearestNode);
}

export function plantBomb(state, bot, events) {
  if (state.bomb.planted || state.bomb.carrier !== bot) return;
  state.bomb.planted = true;
  state.bomb.site = bot.assignedSite || 'A';
  state.bomb.position.copy(bot.position);
  state.bomb.timer = 40;
  state.bomb.planter = bot;
  state.bomb.carrier = null;
  state.phase = 'planted';
  bot.money += 300;
  events.push({ type: 'bombplant', position: bot.position.clone(), site: state.bomb.site });
}
