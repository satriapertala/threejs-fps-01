// Shared movement: acceleration, friction, gravity, crouch and jump, resolved as a box against
// the world's colliders one axis at a time, so a wall never swallows a body. Used by the player
// and by the bots, so both teams obey the same physics.
import * as THREE from 'three';

export const BODY = {
  RADIUS: 0.36,
  HEIGHT: 1.72,
  CROUCH_HEIGHT: 1.16,
  EYE: 1.58,
  CROUCH_EYE: 1.0,
  WALK: 5.4,
  CROUCH_SPEED: 2.5,
  ACCEL: 44,
  AIR_ACCEL: 9,
  FRICTION: 10,
  GRAVITY: 20,
  JUMP: 6.4,
};

const probe = new THREE.Box3();

function overlaps(colliders, x, y, z, height, lift) {
  probe.min.set(x - BODY.RADIUS, y + lift, z - BODY.RADIUS);
  probe.max.set(x + BODY.RADIUS, y + height - lift, z + BODY.RADIUS);
  for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
  return false;
}

// steps: per-axis move and slide. Mutates the body's position/velocity in place.
export function moveBody(body, wishX, wishZ, dt, colliders, crouching, jumping) {
  const targetHeight = crouching ? BODY.CROUCH_HEIGHT : BODY.HEIGHT;
  if (targetHeight > body.height) {
    // stand up only when there is headroom
    if (!overlaps(colliders, body.position.x, body.position.y, body.position.z, targetHeight, 0.02)) {
      body.height = targetHeight;
    }
  } else {
    body.height = targetHeight;
  }

  const speed = (crouching ? BODY.CROUCH_SPEED : BODY.WALK);
  const len = Math.hypot(wishX, wishZ);
  let ax = 0;
  let az = 0;
  if (len > 0.001) {
    ax = (wishX / len) * speed;
    az = (wishZ / len) * speed;
  }

  const accel = body.onGround ? BODY.ACCEL : BODY.AIR_ACCEL;
  body.velocity.x += (ax - body.velocity.x) * Math.min(1, accel * dt);
  body.velocity.z += (az - body.velocity.z) * Math.min(1, accel * dt);
  if (len < 0.001 && body.onGround) {
    const f = Math.max(0, 1 - BODY.FRICTION * dt);
    body.velocity.x *= f;
    body.velocity.z *= f;
  }
  if (jumping && body.onGround) {
    body.velocity.y = BODY.JUMP;
    body.onGround = false;
  }
  body.velocity.y -= BODY.GRAVITY * dt;

  const p = body.position;
  const nx = p.x + body.velocity.x * dt;
  if (!overlaps(colliders, nx, p.y, p.z, body.height, 0.04)) p.x = nx;
  else body.velocity.x = 0;
  const nz = p.z + body.velocity.z * dt;
  if (!overlaps(colliders, p.x, p.y, nz, body.height, 0.04)) p.z = nz;
  else body.velocity.z = 0;
  const ny = p.y + body.velocity.y * dt;
  if (!overlaps(colliders, p.x, ny, p.z, body.height, 0.06)) {
    p.y = ny;
    body.onGround = false;
  } else {
    if (body.velocity.y < 0) body.onGround = true;
    body.velocity.y = 0;
  }
  // floor safety: never fall through the ground slab
  if (p.y < 0) { p.y = 0; body.velocity.y = 0; body.onGround = true; }
}
