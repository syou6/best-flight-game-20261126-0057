// Mission rules: screens/state machine, ring detection, messages, scoring, landing result.

import { createPlane, stepPlane, KT } from './physics.js';
import { RING_COUNT, STAR_COUNT } from './terrain.js';

const BEST_KEY = 'skyhook-run-best';
export const STAR_BONUS = 150;
const STAR_PICK = 95; // pickup radius, feet

// Ring combo: rings (and stars) collected in a row without a miss raise the ring bonus multiplier.
export function comboMult(g) {
  return g.streak >= 2 ? 1.5 : g.streak === 1 ? 1.25 : 1;
}

export function multText(m) {
  return 'x' + (m === 1 ? '1.0' : String(m));
}

export function newGame(world, persist) {
  const g = {
    world: world,
    seed: world.seed,
    persist: !!persist,
    screen: 'title',
    frozen: false,
    clock: 0,
    best: 0,
    events: []
  };
  if (g.persist) {
    try {
      g.best = parseInt(window.localStorage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch (e) {
      g.best = 0;
    }
  }
  resetFlight(g);
  return g;
}

export function resetFlight(g) {
  g.plane = createPlane(g.world);
  g.t = 0;
  g.rings = 0;
  g.ringScore = 0;
  g.stars = 0;
  g.starGot = [];
  for (let i = 0; i < STAR_COUNT; i++) g.starGot.push(false);
  g.starScore = 0;
  g.streak = 0;
  g.sparks = [];
  g.score = 0;
  g.messages = [];
  g.crashReason = '';
  g.crashT = 0;
  g.result = null;
  g.flags = { low: false, critical: false, engine: false };
}

export function startFlight(g) {
  resetFlight(g);
  g.screen = 'playing';
  pushMessage(g, 'FLY THROUGH THE GOLD RING', 'info', 4);
}

export function pushMessage(g, text, kind, life) {
  g.messages.push({ text: text, kind: kind, life: life, max: life });
  if (g.messages.length > 4) g.messages.shift();
}

// Gentle orbit used behind the title screen: pure function of time, so it is deterministic.
export function demoPose(g, t) {
  const p = g.plane;
  const R = 2600;
  const w = 200 / R;
  const psi = t * w;
  p.x = 640 - R * Math.cos(psi);
  p.z = 6500 + R * Math.sin(psi);
  p.y = 720;
  p.heading = psi;
  p.roll = 0.3;
  p.pitch = 0.02;
  p.speed = 220;
  p.throttle = 0.55;
  p.agl = p.y - g.world.heightAt(p.x, p.z);
  p.grounded = false;
}

export function updateGame(g, inp, dt) {
  g.clock += dt;
  for (let i = g.messages.length - 1; i >= 0; i--) {
    g.messages[i].life -= dt;
    if (g.messages[i].life <= 0) g.messages.splice(i, 1);
  }
  for (let i = g.sparks.length - 1; i >= 0; i--) {
    g.sparks[i].t += dt;
    if (g.sparks[i].t > 0.8) g.sparks.splice(i, 1);
  }
  if (g.screen === 'title') {
    demoPose(g, g.clock + 5);
    return;
  }
  if (g.screen === 'crashed') {
    g.crashT += dt;
    return;
  }
  if (g.screen !== 'playing') return;

  const p = g.plane;
  g.t += dt;
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  const res = stepPlane(p, inp, dt, g.world);
  checkRing(g, px, py, pz);
  checkStars(g, px, py, pz);
  g.score = g.ringScore + g.starScore;

  if (res.crash) {
    crash(g, p.engineOut ? 'Out of fuel - the engine quit. ' + res.crash : res.crash);
    return;
  }
  if (res.touchdown && g.rings < RING_COUNT) {
    pushMessage(g, 'RUNWAY CONTACT - COLLECT ALL RINGS FIRST', 'warn', 3);
  }
  if (p.fuel < 20 && !g.flags.low) {
    g.flags.low = true;
    pushMessage(g, 'LOW FUEL', 'warn', 3);
  }
  if (p.fuel < 8 && !g.flags.critical) {
    g.flags.critical = true;
    pushMessage(g, 'FUEL CRITICAL', 'bad', 3);
  }
  if (p.engineOut && !p.grounded && !g.flags.engine) {
    g.flags.engine = true;
    pushMessage(g, 'ENGINE OUT - GLIDE TO THE RUNWAY', 'bad', 4);
  }
  if (p.grounded) {
    if (g.rings >= RING_COUNT && p.speed < 8) {
      finishMission(g);
    } else if (p.engineOut && p.speed < 3) {
      crash(g, 'Out of fuel on the ground with rings still to fly');
    }
  }
}

function checkRing(g, px, py, pz) {
  if (g.rings >= RING_COUNT) return;
  const p = g.plane;
  const r = g.world.rings[g.rings];
  const nx = Math.sin(r.ang);
  const nz = Math.cos(r.ang);
  const s0 = (px - r.x) * nx + (pz - r.z) * nz;
  const s1 = (p.x - r.x) * nx + (p.z - r.z) * nz;
  if ((s0 < 0 && s1 >= 0) || (s0 > 0 && s1 <= 0)) {
    const t = s0 / (s0 - s1);
    const ix = px + (p.x - px) * t;
    const iy = py + 5 + (p.y - py) * t;
    const iz = pz + (p.z - pz) * t;
    const d = Math.sqrt((ix - r.x) * (ix - r.x) + (iy - r.y) * (iy - r.y) + (iz - r.z) * (iz - r.z));
    if (d <= r.r * 1.08) {
      const mult = comboMult(g);
      const bonus = Math.round((500 + Math.max(0, Math.round((1 - d / r.r) * 250))) * mult);
      g.ringScore += bonus;
      g.streak++;
      g.rings++;
      p.fuel = Math.min(100, p.fuel + 8);
      if (p.fuel > 0) p.engineOut = false;
      g.flags.engine = false;
      g.events.push({ type: 'ring', n: g.rings });
      const tag = d < r.r * 0.35 ? 'BULLSEYE  ' : '';
      pushMessage(g, tag + 'RING ' + g.rings + '/' + RING_COUNT + '   +' + bonus + ' ' + multText(mult) + '   +8 FUEL', 'ring', 3);
      if (g.rings >= RING_COUNT) pushMessage(g, 'ALL RINGS! LAND ON THE RUNWAY', 'good', 5);
    } else if (g.missNote !== g.rings) {
      g.missNote = g.rings;
      const hadCombo = g.streak > 0;
      g.streak = 0;
      pushMessage(g, 'MISSED RING ' + (g.rings + 1) + ' - TURN BACK' + (hadCombo ? '  (COMBO LOST)' : ''), 'warn', 3);
    }
  }
}

// Bonus stars: collected when the plane's path this frame passes within STAR_PICK of one.
function checkStars(g, px, py, pz) {
  const p = g.plane;
  const stars = g.world.stars;
  const ay = py + 5;
  const dx = p.x - px;
  const dy = p.y - py;
  const dz = p.z - pz;
  const len2 = dx * dx + dy * dy + dz * dz;
  for (let i = 0; i < stars.length; i++) {
    if (g.starGot[i]) continue;
    const s = stars[i];
    let t = len2 > 1e-6 ? ((s.x - px) * dx + (s.y - ay) * dy + (s.z - pz) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = px + dx * t - s.x;
    const qy = ay + dy * t - s.y;
    const qz = pz + dz * t - s.z;
    if (qx * qx + qy * qy + qz * qz > STAR_PICK * STAR_PICK) continue;
    g.starGot[i] = true;
    g.stars++;
    g.starScore += STAR_BONUS;
    g.streak++; // a star keeps the combo alive and counts as a link in the chain
    p.fuel = Math.min(100, p.fuel + 2);
    if (p.fuel > 0) p.engineOut = false;
    g.flags.engine = false;
    g.sparks.push({ x: s.x, y: s.y, z: s.z, t: 0 });
    g.events.push({ type: 'star', n: g.stars });
    pushMessage(g, 'STAR ' + g.stars + '/' + STAR_COUNT + '   +' + STAR_BONUS + '   +2 FUEL', 'ring', 2.6);
  }
}

function crash(g, reason) {
  g.screen = 'crashed';
  g.crashReason = reason;
  g.crashT = 0;
  g.plane.crashed = true;
  g.plane.speed = 0;
  g.score = g.ringScore + g.starScore;
  g.events.push({ type: 'crash' });
}

export function finishMission(g) {
  const p = g.plane;
  const td = p.touch || { sink: 8, speed: 120, offset: 0 };
  const timeBonus = Math.max(0, Math.round((300 - g.t) * 10));
  const smooth = Math.round(Math.max(0, (20 - td.sink) / 20) * 600);
  const center = Math.round(Math.max(0, 1 - Math.abs(td.offset) / 70) * 300);
  const landing = 1000 + smooth + center;
  const fuelBonus = Math.round(p.fuel) * 8;
  const total = g.ringScore + g.starScore + timeBonus + landing + fuelBonus;
  const grade = total >= 9000 ? 'S' : total >= 7500 ? 'A' : total >= 6000 ? 'B' : 'C';
  const newBest = total > g.best;
  g.result = {
    rings: g.rings,
    ringScore: g.ringScore,
    stars: g.stars,
    starScore: g.starScore,
    timeBonus: timeBonus,
    landing: landing,
    smooth: smooth,
    center: center,
    fuelBonus: fuelBonus,
    total: total,
    grade: grade,
    time: g.t,
    fuel: p.fuel,
    sinkFpm: Math.round(td.sink * 60),
    offset: td.offset,
    touchKt: Math.round(td.speed / KT),
    newBest: newBest
  };
  g.score = total;
  if (newBest) {
    g.best = total;
    if (g.persist) {
      try {
        window.localStorage.setItem(BEST_KEY, String(total));
      } catch (e) {
        /* storage unavailable: ignore */
      }
    }
  }
  g.screen = 'complete';
  g.events.push({ type: 'land' });
}

export function targetOf(g) {
  if (g.rings < RING_COUNT) {
    const r = g.world.rings[g.rings];
    return { x: r.x, y: r.y, z: r.z, label: 'RING ' + (g.rings + 1), isRing: true };
  }
  const rw = g.world.runway;
  return { x: rw.x, y: rw.alt + 60, z: rw.z0 + 300, label: 'RUNWAY', isRing: false };
}
