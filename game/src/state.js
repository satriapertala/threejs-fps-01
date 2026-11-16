// The sim-state single home: actors (player + bots), rounds, money, bomb, scores. Everything
// the fixed-step simulation reads and writes lives in this object; rendering only reads it.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { MAP } from './map.js';

export const TEAM = { T: 'T', CT: 'CT' };

function makeLoadout(kind) {
  return {
    rifle: kind === 'rifle',
    pistol: true,
    grenades: kind === 'full' ? 1 : 0,
    armor: kind === 'full',
  };
}

export function createActor(team, isPlayer, name, money = 800) {
  return {
    team,
    isPlayer,
    name,
    alive: true,
    health: 100,
    armor: 0,
    money,
    position: team === TEAM.T ? MAP.T_SPAWN.clone() : MAP.CT_SPAWN.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    onGround: true,
    crouching: false,
    height: 1.72,
    kills: 0,
    deaths: 0,
    weaponSlot: WEAPONS.rifle.slot,
    hasRifle: false,
    grenades: 0,
    reloading: 0,
    magAmmo: 0,
    reserveAmmo: 0,
    lastShotAt: -99,
    fireCooldown: 0,
    recoil: 0,
    // bot brain fields
    route: null,
    routeIndex: 0,
    target: null,
    reactionTimer: 0,
    fireTimer: 0,
    holdTimer: 0,
    lastHeardShot: null,
    deathTime: 0,
  };
}

export function armActor(actor) {
  if (actor.hasRifle) {
    actor.magAmmo = WEAPONS.rifle.magSize;
    actor.reserveAmmo = WEAPONS.rifle.reserveAmmo;
  } else {
    actor.magAmmo = WEAPONS.pistol.magSize;
    actor.reserveAmmo = WEAPONS.pistol.reserveAmmo;
  }
  actor.reloading = 0;
  actor.weaponSlot = actor.hasRifle ? WEAPONS.rifle.slot : WEAPONS.pistol.slot;
  actor.recoil = 0;
}

export function currentWeapon(actor) {
  return actor.weaponSlot === WEAPONS.rifle.slot && actor.hasRifle ? WEAPONS.rifle : WEAPONS.pistol;
}

// One match state object. phase: buy | live | planted | roundover | matchover
export function createGameState() {
  const state = {
    phase: 'buy',
    phaseTimer: 6,
    roundNumber: 1,
    scoreT: 0,
    scoreCT: 0,
    moneyAwardT: 0,
    bomb: {
      carrier: null,        // actor or null
      planted: false,
      site: null,           // 'A' | 'B'
      position: new THREE.Vector3(),
      timer: 0,
      planter: null,
      defuser: null,
      defuseProgress: 0,
      exploded: false,
      defused: false,
    },
    actors: [],
    killFeed: [],
    sounds: [],           // transient gunshot/grenade noise events bots react to
    playerIndex: 0,
    winnerText: '',
    matchTime: 0,
  };
  // Player is CT (the defender role the camera plays). Four bots a side.
  const player = createActor(TEAM.CT, true, 'YOU', 800);
  state.actors.push(player);
  for (let i = 0; i < 4; i++) state.actors.push(createActor(TEAM.CT, false, `CT-${i + 1}`));
  for (let i = 0; i < 5; i++) state.actors.push(createActor(TEAM.T, false, `T-${i + 1}`));
  return state;
}
