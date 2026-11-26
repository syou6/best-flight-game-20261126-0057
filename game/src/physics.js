// Flight model: throttle/thrust/drag, pitch and roll with smoothing, banked turns,
// stall + sink, fuel burn, ground contact (landing vs crash) and ground roll.
// Units: feet, seconds, radians. speed is true airspeed in ft/s (1 kt = 1.6878 ft/s).

export const G = 32.2;
export const KT = 1.6878;
export const FT_PER_NM = 6076.1;
export const TAU = Math.PI * 2;

const VSTALL = 105; // ft/s (about 62 kt)
const TMAX = 40; // ft/s^2 at full throttle
const KD = 40 / (320 * 320); // drag so full throttle tops out near 190 kt

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

export function createPlane(world) {
  const r0 = world.rings[0];
  return {
    x: 0,
    y: world.heightAt(0, 0) + 700,
    z: 0,
    heading: Math.atan2(r0.x, r0.z),
    pitch: 0,
    roll: 0,
    speed: 245,
    throttle: 0.6,
    fuel: 100,
    sink: 0,
    vy: 0,
    agl: 700,
    pitchRate: 0,
    rollRate: 0,
    grounded: false,
    stalled: false,
    engineOut: false,
    warnTerrain: false,
    crashed: false,
    touch: null
  };
}

function groundHeading(h) {
  const d = Math.abs(angDiff(h, 0));
  return Math.min(d, Math.PI - d);
}

function contact(p, world) {
  const sinkRate = -p.vy;
  if (!world.onRunway(p.x, p.z, 0)) {
    return { crash: world.surfaceAt(p.x, p.z) === 'water' ? 'You flew into the river' : 'You flew into the terrain' };
  }
  let bad = null;
  if (sinkRate > 22) bad = 'Hard landing: sink rate ' + Math.round(sinkRate * 60) + ' fpm';
  else if (Math.abs(p.roll) > 0.3) bad = 'Touched down with a wing low';
  else if (p.pitch < -0.12) bad = 'Nosed into the runway';
  else if (p.pitch > 0.45) bad = 'Tail strike on touchdown';
  else if (groundHeading(p.heading) > 0.42) bad = 'Touched down crooked across the runway';
  else if (p.speed > 215) bad = 'Landed too fast (' + Math.round(p.speed / KT) + ' kt)';
  if (bad) return { crash: bad };
  p.grounded = true;
  p.touch = {
    sink: Math.max(0, sinkRate),
    speed: p.speed,
    offset: p.x - world.runway.x,
    pitch: p.pitch,
    roll: p.roll,
    z: p.z
  };
  p.vy = 0;
  p.sink = 0;
  return { touchdown: true };
}

// inp: { pitch: -1..1 (+ nose up), roll: -1..1 (+ right), throttle: -1..1, brake: bool }
export function stepPlane(p, inp, dt, world) {
  const out = { crash: null, touchdown: false };
  p.throttle = clamp(p.throttle + inp.throttle * 0.5 * dt, 0, 1);

  if (p.fuel > 0) {
    p.fuel -= (0.1 + 0.55 * p.throttle) * dt;
    if (p.fuel <= 0) p.fuel = 0;
  }
  p.engineOut = p.fuel <= 0;
  const thrust = p.engineOut ? 0 : p.throttle * TMAX;
  const V = p.speed;

  if (p.grounded) {
    stepGround(p, inp, dt, world, thrust, out);
    return out;
  }

  // attitude
  p.pitchRate += (inp.pitch * 0.9 - p.pitchRate) * Math.min(1, dt * 6);
  p.pitch += p.pitchRate * dt;
  if (inp.pitch === 0) p.pitch -= p.pitch * Math.min(1, dt * 0.25);
  p.rollRate += (inp.roll * 1.8 - p.rollRate) * Math.min(1, dt * 7);
  p.roll += p.rollRate * dt;
  if (inp.roll === 0) p.roll -= p.roll * Math.min(1, dt * 0.45);
  p.roll = clamp(p.roll, -1.15, 1.15);

  // lift fraction: 1 above stall speed, falling to 0 near 55 ft/s
  const lf = clamp((V - 55) / (VSTALL - 55), 0, 1);
  p.stalled = V < VSTALL * 0.92;
  if (p.stalled) p.pitch -= (1 - lf) * 0.8 * dt + 0.05 * dt;
  p.pitch = clamp(p.pitch, -1.25, 1.25);

  // speed
  let nv = V + (thrust - KD * V * V - G * 0.8 * Math.sin(p.pitch)) * dt;
  if (nv < 0) nv = 0;
  p.speed = nv;

  // heading from bank
  const turn = (G * Math.tan(p.roll) * 1.6) / Math.max(nv, 100) * (0.5 + 0.5 * lf);
  p.heading += turn * dt;
  if (p.heading > TAU) p.heading -= TAU;
  else if (p.heading < 0) p.heading += TAU;

  // sink: stall, banked-turn lift loss, ceiling
  const sinkTarget = (1 - lf) * 160 + 38 * (1 - Math.cos(p.roll)) + Math.max(0, p.y - 4200) * 0.05;
  p.sink += (sinkTarget - p.sink) * Math.min(1, dt * 2.2);

  const vy = nv * Math.sin(p.pitch) - p.sink;
  const vh = nv * Math.cos(p.pitch);
  p.vy = vy;
  p.x += Math.sin(p.heading) * vh * dt;
  p.z += Math.cos(p.heading) * vh * dt;
  p.y += vy * dt;

  const gnd = world.heightAt(p.x, p.z);
  p.agl = p.y - gnd;

  // terrain look-ahead for the PULL UP warning
  const look = 3;
  const ahead = Math.max(gnd, world.heightAt(p.x + Math.sin(p.heading) * vh * look, p.z + Math.cos(p.heading) * vh * look));
  p.warnTerrain = p.y + vy * look < ahead + 60 && p.agl < 900 && !world.onRunway(p.x, p.z, 500);

  if (p.y <= gnd) {
    p.y = gnd;
    const res = contact(p, world);
    if (res.crash) out.crash = res.crash;
    if (res.touchdown) out.touchdown = true;
  }
  return out;
}

function stepGround(p, inp, dt, world, thrust, out) {
  const V = p.speed;
  const gnd = world.heightAt(p.x, p.z);
  p.y = gnd;
  p.agl = 0;
  p.vy = 0;
  p.sink = 0;
  p.stalled = false;
  p.warnTerrain = false;
  const pitchTarget = inp.pitch > 0 && V > 95 ? inp.pitch * 0.3 : 0;
  p.pitch += (pitchTarget - p.pitch) * Math.min(1, dt * 3);
  p.roll -= p.roll * Math.min(1, dt * 4);
  p.rollRate = 0;
  p.heading += inp.roll * 0.5 * dt * clamp(V / 50, 0, 1);
  const decel = inp.brake ? 26 : p.throttle < 0.05 ? 10 : 5;
  let nv = V + (thrust - KD * V * V - (V > 0 ? decel : 0)) * dt;
  if (nv < 0) nv = 0;
  p.speed = nv;
  p.x += Math.sin(p.heading) * nv * dt;
  p.z += Math.cos(p.heading) * nv * dt;

  if (!world.onRunway(p.x, p.z, 0)) {
    out.crash = nv > 6 ? 'Ran off the runway at ' + Math.round(nv / KT) + ' kt' : null;
    if (!out.crash) p.speed = 0;
    return;
  }
  // rotate and lift off again if the pilot wants to
  if (nv > 112 && p.pitch > 0.07) {
    p.grounded = false;
    p.vy = nv * Math.sin(p.pitch);
    p.y = gnd + 0.5;
  }
}
