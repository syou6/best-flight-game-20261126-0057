// Pseudo-3D renderer: voxel-style terrain ray-march into a low-res buffer, sky + sun + clouds,
// projected rings / runway beacon, ground shadow, and the chase-view aircraft sprite.
// The terrain buffer is drawn rotated by the camera roll, so everything stays consistent.

import { GW, GH, CELL, X0, Z0, GWM, RW_HALF, RING_COUNT, runwayColor } from './terrain.js';
import { mulberry32 } from './rng.js';
import { angDiff, clamp } from './physics.js';

export const SCREEN_W = 1280;
export const SCREEN_H = 800;
const CX = 640;
const CY = 340;
const FOCAL = 914; // 70 degree horizontal field of view over 1280 px
const BS = 3; // buffer pixel -> screen pixel scale
const BW = 520; // terrain buffer width (oversized so roll rotation never shows edges)
const HB = 267; // buffer rows above the horizon
const BH = 567; // buffer rows in total
const FB = FOCAL / BS;
const MAXF = 12000;
const CAM_BACK = 130;
const CAM_UP = 34;
const FOG_R = 200;
const FOG_G = 224;
const FOG_B = 240;
const SUN_AZ = 0.75;
const SUN_EL = 0.5;

// march distances and fog, shared by every column
const FS = [];
const FOG = [];
(function buildSteps() {
  let f = 30;
  while (f < MAXF) {
    FS.push(f);
    const t = f / MAXF;
    FOG.push(0.03 + 0.97 * Math.pow(Math.max(0, (t - 0.45) / 0.55), 1.5));
    f += 22 + f * 0.018;
  }
})();
const NS = FS.length;
const IFB = FS.map(function (f) { return FB / f; });

const CK = 0.2; // cloud sprite scale (sprite px per world unit)

function makeClouds(seed) {
  const rng = mulberry32(seed * 131 + 5);
  const list = [];
  for (let i = 0; i < 80; i++) {
    const c = { x: (rng() - 0.5) * 18000, y: 1700 + rng() * 1700, z: 500 + rng() * 47000, puffs: [], f: 0 };
    const n = 6 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      c.puffs.push({ ox: (rng() - 0.5) * 900, oy: rng() * 150, oz: (rng() - 0.5) * 300, r: 180 + rng() * 260 });
    }
    list.push(c);
  }
  return list;
}

function poly(ctx, pts, fill, mirror) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = mirror ? -pts[i][0] : pts[i][0];
    if (i === 0) ctx.moveTo(x, pts[i][1]);
    else ctx.lineTo(x, pts[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

// Aircraft seen from behind and slightly above, centred on (x, y), banked by `roll`.
export function drawPlaneSprite(ctx, x, y, roll, throttle, clock, grounded) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(16,22,38,0.92)';

  // propeller disc
  ctx.fillStyle = 'rgba(214,228,242,' + (0.14 + 0.12 * throttle).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(0, -52, 40, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(30,36,52,0.4)';
  const a = clock * 40;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.lineTo(Math.cos(a + k * Math.PI) * 38, -52 + Math.sin(a + k * Math.PI) * 14);
    ctx.stroke();
  }
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = 'rgba(16,22,38,0.92)';

  if (grounded) {
    ctx.fillStyle = '#1b1f2a';
    ctx.beginPath();
    ctx.ellipse(-30, 22, 7, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(30, 22, 7, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // wings (far side of the fuselage)
  const wing = [[-14, -14], [-126, -10], [-131, 7], [-14, 15]];
  poly(ctx, wing, '#f2ede0', false);
  poly(ctx, wing, '#f2ede0', true);
  const tip = [[-112, -11], [-126, -10], [-131, 7], [-114, 8]];
  poly(ctx, tip, '#d5352f', false);
  poly(ctx, tip, '#d5352f', true);

  // fuselage
  const grad = ctx.createLinearGradient(-19, 0, 19, 0);
  grad.addColorStop(0, '#c4701a');
  grad.addColorStop(0.5, '#ffb52e');
  grad.addColorStop(1, '#c4701a');
  poly(ctx, [[-13, -44], [13, -44], [19, -6], [10, 62], [-10, 62], [-19, -6]], grad, false);
  ctx.fillStyle = '#cdd5de';
  ctx.beginPath();
  ctx.ellipse(0, -44, 13, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d5352f';
  ctx.beginPath();
  ctx.arc(0, -47, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#27456b';
  ctx.beginPath();
  ctx.ellipse(0, -16, 8, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(190,225,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-2, -20, 3, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // tailplane and fin (nearest to the camera)
  const stab = [[-9, 52], [-58, 57], [-61, 70], [-9, 71]];
  poly(ctx, stab, '#e9e3d3', false);
  poly(ctx, stab, '#e9e3d3', true);
  poly(ctx, [[-5, 68], [5, 68], [3, 8], [-3, 8]], '#f2a516', false);
  poly(ctx, [[-4.6, 66], [4.6, 66], [3.5, 28], [-3.5, 28]], '#d5352f', false);
  ctx.restore();
}

export function drawFireball(ctx, x, y, t, clock) {
  const grow = Math.min(t, 1.6);
  for (let i = 0; i < 9; i++) {
    const ang = i * 2.399;
    const d = (20 + 50 * grow) * (0.3 + (i % 4) * 0.25);
    const px = x + Math.cos(ang) * d;
    const py = y + Math.sin(ang) * d * 0.55 - grow * 30 * (i % 3);
    const r = 24 + 26 * grow + (i % 3) * 10;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(40,36,36,0.78)' : i % 3 === 1 ? 'rgba(255,128,32,0.88)' : 'rgba(255,214,90,0.9)';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = 'rgba(30,28,30,' + (0.55 - k * 0.07).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(x + Math.sin(clock * 0.8 + k) * 14, y - 70 - k * 46 * (0.4 + grow * 0.5), 30 + k * 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createRenderer(ctx, world) {
  const off = document.createElement('canvas');
  off.width = BW;
  off.height = BH;
  const octx = off.getContext('2d');
  const img = octx.createImageData(BW, BH);
  const buf32 = new Uint32Array(img.data.buffer);
  const clouds = makeClouds(world.seed);
  let tcache = null;
  let tctx = null;
  let terrainValid = false;
  let frameNo = 0;

  const skyGrad = ctx.createLinearGradient(0, -1500, 0, 0);
  skyGrad.addColorStop(0, '#2c68cf');
  skyGrad.addColorStop(0.55, '#66aae6');
  skyGrad.addColorStop(0.9, '#b8dcf3');
  skyGrad.addColorStop(1, 'rgb(' + FOG_R + ',' + FOG_G + ',' + FOG_B + ')');

  const FOG_CSS = 'rgb(' + FOG_R + ',' + FOG_G + ',' + FOG_B + ')';
  const sunGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, 230);
  sunGrad.addColorStop(0, 'rgba(255,248,214,0.95)');
  sunGrad.addColorStop(0.18, 'rgba(255,236,170,0.5)');
  sunGrad.addColorStop(1, 'rgba(255,236,170,0)');

  const cam = {
    x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0,
    sin: 0, cos: 1, cr: 1, sr: 0, shift: 0, yaw: 0
  };
  const P = { x: 0, y: 0, f: 0 };

  function updateCamera(plane, dt, snap) {
    const k = snap ? 1 : Math.min(1, dt * 4);
    cam.heading += angDiff(plane.heading, cam.heading) * k;
    const kp = snap ? 1 : Math.min(1, dt * 5);
    cam.pitch += (clamp(plane.pitch * 0.55, -0.25, 0.25) - cam.pitch) * kp;
    cam.roll += (clamp(plane.roll * 0.42, -0.42, 0.42) - cam.roll) * kp;
    cam.yaw = angDiff(plane.heading, cam.heading);
    cam.sin = Math.sin(cam.heading);
    cam.cos = Math.cos(cam.heading);
    cam.x = plane.x - cam.sin * CAM_BACK;
    cam.z = plane.z - cam.cos * CAM_BACK;
    cam.y = Math.max(plane.y + CAM_UP, world.heightAt(cam.x, cam.z) + 8);
    cam.cr = Math.cos(cam.roll);
    cam.sr = Math.sin(cam.roll);
    cam.shift = FOCAL * Math.tan(cam.pitch);
  }

  // world point -> screen (includes roll). Returns a shared object or null if behind the camera.
  function project(wx, wy, wz) {
    const dx = wx - cam.x;
    const dz = wz - cam.z;
    const f = dx * cam.sin + dz * cam.cos;
    if (f < 8) return null;
    const r = dx * cam.cos - dz * cam.sin;
    const xr = (FOCAL * r) / f;
    const yr = cam.shift - (FOCAL * (wy - cam.y)) / f;
    P.x = CX + xr * cam.cr + yr * cam.sr;
    P.y = CY - xr * cam.sr + yr * cam.cr;
    P.f = f;
    return P;
  }

  function renderTerrain(clock) {
    buf32.fill(0);
    const hgt = world.hgt;
    const col = world.col;
    const rw = world.runway;
    const rx0 = rw.x - RW_HALF;
    const rx1 = rw.x + RW_HALF;
    const rz0 = rw.z0;
    const rz1 = rw.z1;
    const camX = cam.x;
    const camY = cam.y;
    const camZ = cam.z;
    const inv = 1 / CELL;
    for (let c = 0; c < BW; c++) {
      const tn = (c + 0.5 - BW / 2) / FB;
      const ux = cam.sin + tn * cam.cos;
      const uz = cam.cos - tn * cam.sin;
      let yb = BH;
      for (let s = 0; s < NS; s++) {
        const f = FS[s];
        const xx = camX + f * ux;
        const zz = camZ + f * uz;
        const fx = (xx - X0) * inv - 0.5;
        const fz = (zz - Z0) * inv - 0.5;
        const ixf = Math.floor(fx);
        let iz = Math.floor(fz);
        const tx = fx - ixf;
        let tz = fz - iz;
        if (iz < 0) { iz = 0; tz = 0; } else if (iz > GH - 2) { iz = GH - 2; tz = 1; }
        const i0 = ixf & GWM;
        const i1 = (ixf + 1) & GWM;
        const r0 = iz * GW;
        const r1 = r0 + GW;
        const h0 = hgt[r0 + i0] + (hgt[r0 + i1] - hgt[r0 + i0]) * tx;
        const h1 = hgt[r1 + i0] + (hgt[r1 + i1] - hgt[r1 + i0]) * tx;
        const h = h0 + (h1 - h0) * tz;
        const ys = HB + (camY - h) * IFB[s];
        if (ys < yb) {
          let y0 = Math.ceil(ys);
          if (y0 < 0) y0 = 0;
          if (y0 < yb) {
            let cc = col[(tz > 0.5 ? r1 : r0) + (tx > 0.5 ? i1 : i0)];
            if (xx > rx0 && xx < rx1 && zz > rz0 && zz < rz1) cc = runwayColor(rw, xx, zz);
            let r = cc & 255;
            let g = (cc >>> 8) & 255;
            let b = (cc >>> 16) & 255;
            if ((cc >>> 24) === 254) {
              const sh = (Math.sin(xx * 0.013 + clock * 1.4) + Math.sin(zz * 0.021 - clock * 1.1)) * 7;
              r += sh; g += sh * 1.2; b += sh * 0.8;
              if (r < 0) r = 0; else if (r > 255) r = 255;
              if (g < 0) g = 0; else if (g > 255) g = 255;
              if (b < 0) b = 0; else if (b > 255) b = 255;
            }
            const k = FOG[s];
            r += (FOG_R - r) * k;
            g += (FOG_G - g) * k;
            b += (FOG_B - b) * k;
            const pix = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
            for (let y = y0; y < yb; y++) buf32[y * BW + c] = pix;
            yb = y0;
            if (yb <= 0) break;
          }
        }
      }
    }
  }

  function drawSun() {
    const da = angDiff(SUN_AZ, cam.heading);
    if (Math.abs(da) > 1.25) return;
    const sx = FOCAL * Math.tan(da);
    const sy = -(FOCAL * Math.tan(SUN_EL)) / Math.cos(da);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.fillStyle = sunGrad;
    ctx.fillRect(-240, -240, 480, 480);
    ctx.fillStyle = '#fffbe6';
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Pre-render one cloud (all puffs, same two-tone look) to a small sprite, once. Sprite px = world unit * CK.
  function buildCloudSprite(c) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < c.puffs.length; k++) {
      const pf = c.puffs[k];
      const px = pf.ox * CK;
      const py = -pf.oy * CK;
      const r = pf.r * CK;
      if (px - r < x0) x0 = px - r;
      if (px + r > x1) x1 = px + r;
      if (py - r < y0) y0 = py - r;
      if (py + r * 1.3 > y1) y1 = py + r * 1.3;
    }
    x0 = Math.floor(x0) - 1;
    y0 = Math.floor(y0) - 1;
    const w = Math.ceil(x1 - x0) + 2;
    const h = Math.ceil(y1 - y0) + 2;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    for (let k = 0; k < c.puffs.length; k++) {
      const pf = c.puffs[k];
      const px = pf.ox * CK - x0;
      const py = -pf.oy * CK - y0;
      const r = pf.r * CK;
      g.fillStyle = 'rgba(176,196,222,0.9)';
      g.beginPath();
      g.arc(px, py + r * 0.28, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,1)';
      g.beginPath();
      g.arc(px, py - r * 0.06, r * 0.94, 0, Math.PI * 2);
      g.fill();
    }
    c.spr = cv;
    c.sx0 = x0;
    c.sy0 = y0;
    c.sw = w;
    c.sh = h;
    c.rad = Math.max(-x0, x0 + w, -y0, y0 + h) / CK;
  }

  function cloudCmp(a, b) { return b.f - a.f; }

  function drawClouds() {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const dx = c.x - cam.x;
      const dz = c.z - cam.z;
      c.f = dx * cam.sin + dz * cam.cos;
    }
    clouds.sort(cloudCmp);
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      if (c.f < 600 || c.f > 21000) continue;
      const q = project(c.x, c.y, c.z);
      if (!q) continue;
      const sc = FOCAL / q.f; // screen px per world unit
      const er = c.rad * sc;
      if (er < 2 || q.x < -er || q.x > SCREEN_W + er || q.y < -er || q.y > SCREEN_H + er) continue;
      if (!c.spr) buildCloudSprite(c);
      const m = sc / CK;
      ctx.globalAlpha = clamp(1.15 - c.f / 21000, 0.15, 0.95);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(-cam.roll);
      ctx.drawImage(c.spr, c.sx0 * m, c.sy0 * m, c.sw * m, c.sh * m);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function ringPath(r, N) {
    const rx = Math.cos(r.ang);
    const rz = -Math.sin(r.ang);
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const th = (k / N) * Math.PI * 2;
      const lx = Math.cos(th) * r.r;
      const q = project(r.x + rx * lx, r.y + Math.sin(th) * r.r, r.z + rz * lx);
      pts.push(q ? { x: q.x, y: q.y, f: q.f } : null);
    }
    return pts;
  }

  function strokePts(pts) {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      if (!q) { pen = false; continue; }
      if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  function drawRings(game, clock) {
    for (let i = RING_COUNT - 1; i >= game.rings; i--) {
      const r = game.world.rings[i];
      const c = project(r.x, r.y, r.z);
      if (!c || c.f > 17000) continue;
      const cf = c.f;
      const isNext = i === game.rings;
      const pts = ringPath(r, 28);
      const lw = clamp((11 * FOCAL) / cf, 2.2, 28) * (isNext ? 1 + 0.12 * Math.sin(clock * 6) : 0.8);
      ctx.save();
      ctx.lineCap = 'round';
      if (isNext) {
        let whole = true;
        for (let k = 0; k < pts.length; k++) if (!pts[k]) whole = false;
        if (whole) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,214,70,0.10)';
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,200,40,0.28)';
        ctx.lineWidth = lw * 2.4;
        strokePts(pts);
        ctx.strokeStyle = '#ffd23a';
        ctx.lineWidth = lw;
        strokePts(pts);
        ctx.strokeStyle = 'rgba(255,255,230,0.85)';
        ctx.lineWidth = Math.max(1, lw * 0.28);
        strokePts(pts);
      } else {
        ctx.globalAlpha = clamp(1.1 - cf / 15000, 0.3, 1);
        ctx.strokeStyle = '#6fe0ff';
        ctx.lineWidth = lw;
        strokePts(pts);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = Math.max(1, lw * 0.25);
        strokePts(pts);
      }
      ctx.restore();
    }
  }

  function drawRunwayBeacon(game) {
    const rw = game.world.runway;
    const a = project(rw.x, rw.alt, rw.z0 + 30);
    if (!a || a.f > 20000) return;
    const ax = a.x;
    const ay = a.y;
    const b = project(rw.x, rw.alt + 1400, rw.z0 + 30);
    if (!b) return;
    const bx = b.x;
    const by = b.y;
    const on = game.rings >= RING_COUNT;
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, on ? 'rgba(120,255,200,0.9)' : 'rgba(120,220,255,0.45)');
    g.addColorStop(1, 'rgba(120,255,220,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = on ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function drawShadow(plane) {
    const gh = world.heightAt(plane.x, plane.z);
    const q = project(plane.x, gh + 0.5, plane.z);
    if (!q) return;
    const w = (34 * FOCAL) / q.f;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(cam.roll);
    ctx.fillStyle = 'rgba(10,20,10,' + clamp(0.38 - plane.agl / 3500, 0.1, 0.38).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5, Math.max(2, w * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(game) {
    const plane = game.plane;
    const clock = game.clock;

    const baseT = ctx.getTransform();
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-cam.roll);
    ctx.translate(0, cam.shift);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-1700, -1500, 3400, 1500);
    ctx.fillStyle = FOG_CSS;
    ctx.fillRect(-1700, 0, 3400, 1700);
    drawSun();
    ctx.restore();

    // Terrain layer: march + blit only every 2nd frame into a transparent screen-sized cache;
    // other frames just copy the cache 1:1. The very first frame always renders.
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    if (!tcache || tcache.width !== cw || tcache.height !== ch) {
      tcache = document.createElement('canvas');
      tcache.width = cw;
      tcache.height = ch;
      tctx = tcache.getContext('2d');
      terrainValid = false;
    }
    if (!terrainValid || (frameNo & 1) === 0) {
      renderTerrain(clock);
      octx.putImageData(img, 0, 0);
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, cw, ch);
      tctx.setTransform(baseT);
      tctx.translate(CX, CY);
      tctx.rotate(-cam.roll);
      tctx.translate(0, cam.shift);
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(off, (-BW * BS) / 2, -HB * BS, BW * BS, BH * BS);
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      terrainValid = true;
    }
    frameNo++;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tcache, 0, 0);
    ctx.restore();

    drawClouds();
    drawRunwayBeacon(game);
    drawRings(game, clock);

    if (game.screen === 'crashed') {
      const q = project(plane.x, plane.y + 8, plane.z);
      drawFireball(ctx, q ? q.x : CX, q ? q.y : 560, game.crashT, clock);
      return;
    }
    drawShadow(plane);
    const sx = CX + clamp(cam.yaw * FOCAL * 0.9, -170, 170);
    const sy = 566 - clamp((plane.pitch - cam.pitch) * FOCAL * 0.4, -70, 70);
    drawPlaneSprite(ctx, sx, sy, plane.roll - cam.roll, plane.throttle, clock, plane.grounded);
  }

  return { draw: draw, updateCamera: updateCamera, project: project, cam: cam };
}
