// Staged screenshots: ?shot=title|flight|ring|landed|crashed (&seed=N).
// Each scene drops the game into a real, frozen state (inputs locked, animation clock held).

import { resetFlight, finishMission, pushMessage, demoPose } from './mission.js';

export function parseShot(search) {
  const q = new URLSearchParams(search);
  const seed = parseInt(q.get('seed') || '1', 10);
  return { shot: q.get('shot'), seed: Number.isFinite(seed) ? seed : 1 };
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
    // ~1000 ft short of ring 5 (rings[4]), ~110 ft below it, so the ring fills about a third of the frame
    // and sits above the aircraft, with the runway far ahead
    const a = w.rings[4];
    game.screen = 'playing';
    game.clock = 3.2;
    game.rings = 4;
    game.ringScore = 3420;
    game.stars = 2;
    game.starGot[0] = true;
    game.starGot[1] = true;
    game.starScore = 300;
    game.streak = 6;
    game.score = 3720;
    game.t = 121.4;
    p.heading = a.ang;
    p.x = a.x - Math.sin(a.ang) * 1000;
    p.z = a.z - Math.cos(a.ang) * 1000;
    p.y = Math.max(a.y - 110, w.heightAt(p.x, p.z) + 150);
    p.pitch = 0.03;
    p.roll = 0.12;
    p.speed = 246;
    p.throttle = 0.62;
    p.fuel = 41;
    p.vy = 6;
    p.agl = p.y - w.heightAt(p.x, p.z);
    pushMessage(game, 'RING 4/6   +712 x1.5   +8 FUEL', 'ring', 3.2);
  } else if (shot === 'ring') {
    const r = w.rings[2];
    game.screen = 'playing';
    game.clock = 2.4;
    game.rings = 2;
    game.ringScore = 1340;
    game.streak = 1; // HUD combo x1.25, matching the staged toast below
    game.score = 1340;
    game.t = 84.6;
    p.heading = r.ang;
    p.x = r.x - Math.sin(r.ang) * 480;
    p.z = r.z - Math.cos(r.ang) * 480;
    p.y = r.y - 18;
    p.pitch = 0.02;
    p.roll = 0.1;
    p.speed = 252;
    p.throttle = 0.64;
    p.fuel = 62;
    p.agl = p.y - w.heightAt(p.x, p.z);
    pushMessage(game, 'RING 2/6   +684 x1.25   +8 FUEL', 'ring', 3.2);
  } else if (shot === 'landed') {
    game.clock = 4;
    game.rings = 6;
    game.ringScore = 3980;
    game.stars = 3;
    game.starGot[0] = true;
    game.starGot[2] = true;
    game.starGot[3] = true;
    game.starScore = 450;
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
