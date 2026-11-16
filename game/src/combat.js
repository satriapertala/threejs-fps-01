// Combat resolution: hitscan rays for bullets, a parabola + AOE for grenades. Every shooter
// (player or bot) goes through fireHitscan so damage, falloff, headshots and armor behave the
// same on both teams. Hitbox: a body capsule approximated as two boxes (head above 1.45 m).
import * as THREE from 'three';
import { currentWeapon } from './state.js';
import { damageAt } from './weapons.js';

const ray = new THREE.Ray();
const tmpDir = new THREE.Vector3();
const tmpHit = new THREE.Vector3();
const HEAD_Y = 1.42;

function rayBox(origin, dir, min, max) {
  // slab test; returns distance or Infinity
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < min[axis] || o > max[axis]) return Infinity;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : Infinity);
}

// Returns the nearest hit: { actor, headshot, distance, point } or { world, distance, point }.
export function traceShot(world, actors, shooter, origin, dir, maxRange) {
  let best = { distance: maxRange, actor: null, headshot: false, world: true, point: null };
  const wallDist = raycastWorld(world, origin, dir, maxRange);
  if (wallDist < best.distance) {
    best.distance = wallDist;
  }
  for (const actor of actors) {
    if (!actor.alive || actor === shooter) continue;
    const feet = actor.position;
    const r = 0.4;
    // body box
    tmpHit.set(
      Math.min(feet.x - r, feet.x + r), Math.min(feet.y, feet.y + HEAD_Y),
      Math.min(feet.z - r, feet.z + r),
    );
    const bodyMin = tmpHit;
    const bodyMax = new THREE.Vector3(feet.x + r, feet.y + HEAD_Y, feet.z + r);
    const dBody = rayBox(origin, dir, bodyMin, bodyMax);
    if (dBody < best.distance) {
      best = { distance: dBody, actor, headshot: false, world: false, point: null };
    }
    // head box (sits on top; taller when standing, lower when crouched)
    const headH = actor.height - 0.34;
    const headMin = new THREE.Vector3(feet.x - r, feet.y + headH, feet.z - r);
    const headMax = new THREE.Vector3(feet.x + r, feet.y + actor.height + 0.06, feet.z + r);
    const dHead = rayBox(origin, dir, headMin, headMax);
    if (dHead < best.distance) {
      best = { distance: dHead, actor, headshot: true, world: false, point: null };
    }
  }
  best.point = origin.clone().addScaledVector(dir, best.distance);
  return best;
}

function raycastWorld(world, origin, dir, maxRange) {
  ray.set(origin, dir);
  let nearest = maxRange;
  for (const collider of world.colliders) {
    const d = rayBox(origin, dir, collider.min, collider.max);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

// LOS between two actors' eye lines, used by bot vision. True when nothing blocks.
const eyeA = new THREE.Vector3();
const eyeB = new THREE.Vector3();
const losDir = new THREE.Vector3();
export function hasLineOfSight(world, actors, from, to) {
  eyeA.set(from.position.x, from.position.y + from.height - 0.2, from.position.z);
  eyeB.set(to.position.x, to.position.y + Math.min(1.5, to.height - 0.2), to.position.z);
  losDir.copy(eyeB).sub(eyeA);
  const dist = losDir.length();
  if (dist < 0.5) return true;
  losDir.divideScalar(dist);
  const wallDist = raycastWorld(world, eyeA, losDir, dist);
  return wallDist >= dist - 0.05;
}

// Fire one bullet: applies spread cone, traces, applies damage, returns an event for HUD/audio.
export function fireHitscan(world, actors, shooter, dirJittered, events) {
  const weapon = currentWeapon(shooter);
  tmpDir.copy(dirJittered);
  const eye = new THREE.Vector3(shooter.position.x, shooter.position.y + shooter.height - 0.14, shooter.position.z);
  const hit = traceShot(world, actors, shooter, eye, tmpDir, weapon.range);
  let damage = 0;
  let victim = null;
  if (hit.actor) {
    victim = hit.actor;
    damage = damageAt(weapon, hit.distance, hit.headshot);
    if (victim.armor > 0) {
      const absorbed = damage * 0.5;
      damage -= absorbed;
      victim.armor = Math.max(0, victim.armor - absorbed);
    }
    victim.health -= damage;
    events.push({ type: hit.headshot ? 'headshot' : 'hit', victim, shooter, damage });
    if (victim.health <= 0 && victim.alive) {
      victim.alive = false;
      victim.deaths += 1;
      shooter.kills += 1;
      events.push({ type: 'kill', victim, shooter, headshot: hit.headshot });
      if (victim.isPlayer) events.push({ type: 'playerdied' });
    }
  } else {
    events.push({ type: 'wallhit', point: hit.point, normal: null });
  }
  return hit;
}

// Grenades: simple ballistic arc, bounce once off the ground, explode on the fuse.
const gPos = new THREE.Vector3();
const gVel = new THREE.Vector3();
export function stepGrenade(grenade, dt, actors, world, events) {
  gPos.copy(grenade.position);
  gVel.copy(grenade.velocity);
  gVel.y -= 20 * dt;
  gPos.addScaledVector(gVel, dt);
  if (gPos.y < 0.12 && gVel.y < 0) {
    gPos.y = 0.12;
    gVel.y *= -0.45;
    gVel.x *= 0.7;
    gVel.z *= 0.7;
  }
  grenade.position.copy(gPos);
  grenade.velocity.copy(gVel);
  grenade.fuse -= dt;
  if (grenade.fuse <= 0) {
    explodeGrenade(grenade, actors, events);
    return true;
  }
  return false;
}

export function explodeGrenade(grenade, actors, events) {
  const weapon = grenade.weaponDef;
  for (const actor of actors) {
    if (!actor.alive) continue;
    const d = actor.position.distanceTo(grenade.position);
    if (d < weapon.radius) {
      const falloff = 1 - (d / weapon.radius) * 0.75;
      let dmg = weapon.damage * falloff;
      if (actor.armor > 0) { actor.armor = Math.max(0, actor.armor - dmg * 0.4); dmg *= 0.7; }
      actor.health -= dmg;
      if (actor.health <= 0 && actor.alive) {
        actor.alive = false;
        actor.deaths += 1;
        grenade.thrower.kills += 1;
        events.push({ type: 'kill', victim: actor, shooter: grenade.thrower, headshot: false });
      }
    }
  }
  events.push({ type: 'explosion', position: grenade.position.clone() });
}
