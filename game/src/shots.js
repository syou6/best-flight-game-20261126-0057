// Staged screenshots: ?shot=title|flight|ring|landed|crashed (&seed=N).
// Each scene drops the game into a real, frozen state (inputs locked, animation clock held).

import { resetFlight, finishMission, pushMessage, demoPose } from './mission.js';

export function parseShot(search) {
  const q = new URLSearchParams(search);
  const seed = parseInt(q.get('seed') || '1', 10);
  return { shot: q.get('shot'), seed: Number.isFinite(seed) ? seed : 1 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// returns true if the scene name was recognised
export function stageShot(game, renderer, shot) {
  const w = game.world;
  const rw = w.runway;
  resetFlight(game);
  game.frozen = true;
  const p = game.plane;
  let ok = true;

  if (shot === 'title') {
    game.screen = 'title';
    game.clock = 5;
    demoPose(game, game.clock + 5);
  } else if (shot === 'flight') {
    const a = w.rings[3];
    const b = w.rings[4];
    game.screen = 'playing';
    game.clock = 3.2;
    game.rings = 4;
    game.ringScore = 2870;
    game.score = 2870;
    game.t = 121.4;
    p.x = lerp(a.x, b.x, 0.55);
    p.z = lerp(a.z, b.z, 0.55);
    p.heading = Math.atan2(b.x - p.x, b.z - p.z);
    p.y = Math.max(lerp(a.y, b.y, 0.55), w.heightAt(p.x, p.z) + 300) + 10;
    p.pitch = 0.03;
    p.roll = 0.2;
    p.speed = 246;
    p.throttle = 0.62;
    p.fuel = 41;
    p.vy = 6;
    p.agl = p.y - w.heightAt(p.x, p.z);
    pushMessage(game, 'RING 4/6   +712   +8 FUEL', 'ring', 3.2);
  } else if (shot === 'ring') {
    const r = w.rings[2];
    game.screen = 'playing';
    game.clock = 2.4;
    game.rings = 2;
    game.ringScore = 1340;
    game.score = 1340;
    game.t = 84.6;
    p.heading = r.ang;
    p.x = r.x - Math.sin(r.ang) * 340;
    p.z = r.z - Math.cos(r.ang) * 340;
    p.y = r.y - 18;
    p.pitch = 0.02;
    p.roll = 0.1;
    p.speed = 252;
    p.throttle = 0.64;
    p.fuel = 62;
    p.agl = p.y - w.heightAt(p.x, p.z);
    pushMessage(game, 'RING 2/6   +684   +8 FUEL', 'ring', 3.2);
  } else if (shot === 'landed') {
    game.clock = 4;
    game.rings = 6;
    game.ringScore = 3980;
    game.t = 171.4;
    p.x = rw.x + 4;
    p.z = rw.z0 + 600;
    p.y = rw.alt;
    p.heading = 0;
    p.pitch = 0;
    p.roll = 0;
    p.speed = 0;
    p.throttle = 0;
    p.fuel = 37.6;
    p.grounded = true;
    p.agl = 0;
    p.touch = { sink: 5.4, speed: 138, offset: 9, pitch: 0.06, roll: 0, z: rw.z0 + 160 };
    finishMission(game);
    game.events.length = 0;
  } else if (shot === 'crashed') {
    const r = w.rings[1];
    game.screen = 'crashed';
    game.clock = 6;
    game.rings = 2;
    game.ringScore = 1340;
    game.score = 1340;
    game.t = 63.8;
    p.heading = r.ang + 0.25;
    p.x = r.x + 500 + Math.sin(p.heading) * 1400;
    p.z = r.z + Math.cos(p.heading) * 1400;
    p.y = w.heightAt(p.x, p.z);
    p.pitch = -0.45;
    p.speed = 0;
    p.crashed = true;
    p.agl = 0;
    game.crashReason = 'You flew into the terrain';
    game.crashT = 1.2;
  } else {
    ok = false;
    game.screen = 'title';
    demoPose(game, 10);
  }

  renderer.updateCamera(p, 0, true);
  return ok;
}
