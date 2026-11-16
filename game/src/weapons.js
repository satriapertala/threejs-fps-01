// Weapon definitions and per-weapon fire model. One table drives every gun: damage, fire rate,
// magazine, spread (base + movement penalty + jump penalty, reduced by crouch), recoil kick and
// the recovery that pulls the view back. Accuracy is a cone, so stopping to aim pays.
export const WEAPONS = {
  rifle: {
    name: 'VX-7 CARBINE',
    slot: 0,
    price: 2700,
    damage: 30,
    headMultiplier: 4,
    rpm: 600,
    magSize: 30,
    reserveAmmo: 90,
    reloadTime: 2.2,
    auto: true,
    baseSpread: 0.006,
    moveSpread: 0.028,
    airSpread: 0.05,
    crouchFactor: 0.6,
    recoilKick: 0.011,
    recoilRecover: 7.5,
    range: 90,
    falloffStart: 30,
    falloffMin: 0.7,
  },
  pistol: {
    name: 'P-9 SIDEARM',
    slot: 1,
    price: 0,
    damage: 26,
    headMultiplier: 4,
    rpm: 320,
    magSize: 12,
    reserveAmmo: 48,
    reloadTime: 1.6,
    auto: false,
    baseSpread: 0.008,
    moveSpread: 0.02,
    airSpread: 0.04,
    crouchFactor: 0.65,
    recoilKick: 0.009,
    recoilRecover: 9,
    range: 70,
    falloffStart: 22,
    falloffMin: 0.6,
  },
  grenade: {
    name: 'FRAG GRENADE',
    slot: 2,
    price: 300,
    damage: 95,
    radius: 6.5,
    fuse: 1.7,
    throwSpeed: 15,
  },
};

// Current cone half-angle (radians) for a shooter: grows with speed and air time, shrinks
// crouched. `recoil` is the accumulated view kick in radians added on top.
export function spreadFor(weapon, speed, airborne, crouching, recoil) {
  let s = weapon.baseSpread;
  const moveFactor = Math.min(1, speed / BODY_WALK_REF);
  s += weapon.moveSpread * moveFactor;
  if (airborne) s += weapon.airSpread;
  if (crouching) s *= weapon.crouchFactor;
  return s + recoil;
}

const BODY_WALK_REF = 5.4;

// Damage after distance falloff and the headshot multiplier.
export function damageAt(weapon, distance, headshot) {
  let dmg = weapon.damage;
  if (distance > weapon.falloffStart) {
    const t = Math.min(1, (distance - weapon.falloffStart) / (weapon.range - weapon.falloffStart));
    dmg *= 1 - (1 - weapon.falloffMin) * t;
  }
  return headshot ? dmg * weapon.headMultiplier : dmg;
}
