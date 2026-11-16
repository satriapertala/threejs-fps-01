// Rounds, money and win conditions. Buy phase (frozen, buy menu open), live phase, planted
// phase (bomb ticking), round over with money awards, then the next round. First team to 5
// rounds wins the match. Ts win by elimination, bomb explosion, or time expiring while they
// hold numbers; CTs win by elimination or defusing.
import * as THREE from 'three';
import { TEAM, armActor } from './state.js';
import { MAP } from './map.js';

export const MATCH_TARGET = 5;
export const ROUND_TIME = 100;
export const BOMB_TIME = 40;
export const DEFUSE_TIME = 7;
export const BUY_TIME = 7;

const REWARD_WIN = 3250;
const REWARD_LOSS = [1400, 1900, 2400, 2900, 3400];
const MAX_MONEY = 16000;

// routes are bound by main.js to avoid an import cycle with bots.js
let ROUTES_FOR_T = null;
let ROUTES_FOR_CT = null;
export function bindRoutes(t, ct) {
  ROUTES_FOR_T = t;
  ROUTES_FOR_CT = ct;
}

const spawnJitter = new THREE.Vector3();

export function startRound(state, random) {
  state.phase = 'buy';
  state.phaseTimer = BUY_TIME;
  state.roundTime = ROUND_TIME;
  state.bomb.planted = false;
  state.bomb.exploded = false;
  state.bomb.defused = false;
  state.bomb.site = null;
  state.bomb.defuser = null;
  state.bomb.defuseProgress = 0;
  state.bomb.carrier = null;
  state.bomb.timer = 0;
  state.sounds.length = 0;
  state.winnerText = '';
  for (const actor of state.actors) {
    actor.alive = true;
    actor.health = 100;
    actor.crouching = false;
    actor.velocity.set(0, 0, 0);
    actor.recoil = 0;
    actor.reloading = 0;
    spawnJitter.set((random() - 0.5) * 4, 0, (random() - 0.5) * 4);
    actor.position.copy(actor.team === TEAM.T ? MAP.T_SPAWN : MAP.CT_SPAWN).add(spawnJitter);
    actor.yaw = actor.team === TEAM.T ? Math.PI / 2 : -Math.PI / 2;
    armActor(actor);
  }
  assignRoutes(state, random);
}

export function assignRoutes(state, random) {
  const tRoutes = ['rushA', 'rushB', 'flankA', 'midSplit'];
  const ctRoutes = ['holdA', 'holdB', 'midPick'];
  let ti = 0;
  let ci = 0;
  let carrierAssigned = false;
  for (const actor of state.actors) {
    actor.bombRush = false;
    actor.assignedSite = null;
    actor.lastHeardShot = null;
    actor.target = null;
    actor.routeGoal = null;
    if (!actor.alive) continue;
    if (actor.team === TEAM.T) {
      const key = tRoutes[ti % tRoutes.length];
      ti += 1;
      actor.route = ROUTES_FOR_T[key] ?? null;
      actor.routeIndex = 0;
      actor.assignedSite = (key === 'rushB' || key === 'midSplit') ? 'B' : 'A';
      actor.routeGoal = actor.assignedSite;
      if (!carrierAssigned) {
        state.bomb.carrier = actor;
        carrierAssigned = true;
      }
    } else if (!actor.isPlayer) {
      const key = ctRoutes[ci % ctRoutes.length];
      ci += 1;
      actor.route = ROUTES_FOR_CT[key] ?? null;
      actor.routeIndex = 0;
    }
  }
}

function alive(state, team) {
  let n = 0;
  for (const a of state.actors) if (a.alive && a.team === team) n += 1;
  return n;
}

// Called when a round ends: award money, bump score, set winnerText, phase roundover.
export function endRound(state, winner, reason) {
  state.phase = 'roundover';
  state.phaseTimer = 4.5;
  if (winner === TEAM.T) state.scoreT += 1;
  else state.scoreCT += 1;
  state.winnerText = `${winner === TEAM.T ? 'ATTACKERS WIN' : 'DEFENDERS WIN'} — ${reason}`;
  const lossCount = { T: 0, CT: 0 };
  for (const a of state.actors) {
    if (a.alive && a.killsAwardedRound) {}
  }
  for (const a of state.actors) {
    const winnerSide = a.team === winner;
    const lossIndex = Math.min(4, lossCount[a.team]);
    if (!winnerSide) lossCount[a.team] += 1;
    const reward = winnerSide ? REWARD_WIN : REWARD_LOSS[lossIndex];
    a.money = Math.min(MAX_MONEY, a.money + reward);
  }
}

// Per-tick round logic (phase timers, bomb fuse, elimination checks). Returns nothing;
// mutates phase. `events` receives round events for HUD/audio.
export function stepRounds(state, dt, events) {
  if (state.phase === 'buy') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      state.phase = 'live';
      state.roundTime = ROUND_TIME;
      events.push({ type: 'roundstart' });
    }
    return;
  }
  if (state.phase === 'roundover') {
    state.phaseTimer -= dt;
    if (state.scoreT >= MATCH_TARGET || state.scoreCT >= MATCH_TARGET) {
      state.phase = 'matchover';
      state.winnerText = state.scoreT >= MATCH_TARGET
        ? 'ATTACKERS TAKE SECTOR 9' : 'SECTOR 9 HELD — DEFENDERS WIN';
    } else if (state.phaseTimer <= 0) {
      startRound(state, state.random);
    }
    return;
  }
  if (state.phase === 'matchover') return;

  // live or planted
  if (state.phase === 'live') {
    state.roundTime -= dt;
    const tAlive = alive(state, TEAM.T);
    const ctAlive = alive(state, TEAM.CT);
    if (ctAlive === 0) { endRound(state, TEAM.T, 'defenders eliminated'); return; }
    if (tAlive === 0 && !state.bomb.planted) { endRound(state, TEAM.CT, 'attackers eliminated'); return; }
    if (state.roundTime <= 0) { endRound(state, TEAM.CT, 'time expired'); return; }
  }
  if (state.phase === 'planted') {
    state.bomb.timer -= dt;
    if (state.bomb.defused) { endRound(state, TEAM.CT, 'bomb defused'); return; }
    if (state.bomb.timer <= 0) {
      state.bomb.exploded = true;
      events.push({ type: 'bomboom', position: state.bomb.position.clone() });
      endRound(state, TEAM.T, 'bomb detonated');
      return;
    }
    // after plant, CTs can still win only by defusing; elimination of T no longer counts
    if (alive(state, TEAM.CT) === 0 && !state.bomb.defused) return; // bomb decides
  }
}

// Kill reward bookkeeping: called from combat when a kill lands.
export function creditKill(killer) {
  killer.money = Math.min(MAX_MONEY, killer.money + REWARD_KILL_VALUE);
}
const REWARD_KILL_VALUE = 300;
