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
const CAM_BACK = 105;
const CAM_UP = 21;
const PLANE_K = 1.35; // chase-view sprite scale
const PLANE_Y = 514; // sprite centre on screen; its tail stays above the bottom HUD (y 640+)
const FOG_R = 214;
const FOG_G = 226;
const FOG_B = 236;
const SUN_AZ = 0.25;
const SUN_EL = 0.2;

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
const SKY_CLIP_Y = 40; // sky drawn only above local y = this (terrain covers the rest)
const CLOUD_MAX_PX = 480; // max on-screen size (px, longest side) of a drawn cloud sprite

function makeClouds(seed) {
  const rng = mulberry32(seed * 131 + 5);
  const list = [];
  for (let i = 0; i < 52; i++) {
    const c = { x: (rng() - 0.5) * 18000, y: 1800 + rng() * 1700, z: 500 + rng() * 47000, puffs: [], f: 0 };
    const n = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      c.puffs.push({ ox: (rng() - 0.5) * 1200, oy: rng() * 170, oz: (rng() - 0.5) * 300, r: 260 + rng() * 340 });
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

// static plane geometry, built once (no per-frame arrays)
const WING = [[-14, -14], [-126, -10], [-131, 7], [-14, 15]];
const WING_TIP = [[-112, -11], [-126, -10], [-131, 7], [-114, 8]];
const FUSE = [[-13, -44], [13, -44], [19, -6], [10, 62], [-10, 62], [-19, -6]];
const STAB = [[-9, 52], [-58, 57], [-61, 70], [-9, 71]];
const FIN = [[-5, 68], [5, 68], [3, 8], [-3, 8]];
const FIN_RED = [[-4.6, 66], [4.6, 66], [3.5, 28], [-3.5, 28]];
let fuseGrad = null;
let fuseGradCtx = null;

// Aircraft seen from behind and slightly above, centred on (x, y), banked by `roll`.
export function drawPlaneSprite(ctx, x, y, roll, throttle, clock, grounded) {
  if (!fuseGrad || fuseGradCtx !== ctx) {
    fuseGrad = ctx.createLinearGradient(-19, 0, 19, 0);
    fuseGrad.addColorStop(0, '#c4701a');
    fuseGrad.addColorStop(0.5, '#ffb52e');
    fuseGrad.addColorStop(1, '#c4701a');
    fuseGradCtx = ctx;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);
  ctx.scale(PLANE_K, PLANE_K);
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
  poly(ctx, WING, '#f2ede0', false);
  poly(ctx, WING, '#f2ede0', true);
  poly(ctx, WING_TIP, '#d5352f', false);
  poly(ctx, WING_TIP, '#d5352f', true);

  // fuselage
  poly(ctx, FUSE, fuseGrad, false);
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
  poly(ctx, STAB, '#e9e3d3', false);
  poly(ctx, STAB, '#e9e3d3', true);
  poly(ctx, FIN, '#f2a516', false);
  poly(ctx, FIN_RED, '#d5352f', false);
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

  const FOG_CSS = 'rgb(' + FOG_R + ',' + FOG_G + ',' + FOG_B + ')';
  function mk(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    return cv;
  }

  // ---- static sky, pre-rendered once (see the panorama below) ----
  const SKY_HALF_W = 790; // half-width needed to cover the 1280x800 screen at any roll

  // Sun glow at half resolution (smooth gradient; baked into the panorama, scaled 2x once).
  const sunSpr = mk(380, 380);
  (function () {
    const g = sunSpr.getContext('2d');
    const sg = g.createRadialGradient(190, 190, 5, 190, 190, 190);
    sg.addColorStop(0, 'rgba(255,250,224,1)');
    sg.addColorStop(0.1, 'rgba(255,240,180,0.8)');
    sg.addColorStop(0.35, 'rgba(255,224,150,0.32)');
    sg.addColorStop(1, 'rgba(255,224,150,0)');
    g.fillStyle = sg;
    g.fillRect(0, 0, 380, 380);
  })();

  // Two layers of distant mountain silhouettes, fading into the horizon haze. Each ridge is baked once into a
  // strip that is exactly one full turn of heading wide (frequencies are whole cycles per turn, so it tiles
  // seamlessly); per frame only a scrolled slice is blitted. Strip rows map to local y = row - RIDGE_TOP.
  const RIDGE_TOP = 156;
  const RIDGE_H = 163; // rows -> y = -156 .. +6
  function buildRidge(par, base, amp, k, n1, n2, n3, topY, topColor) {
    const P = 2 * Math.PI * FOCAL * par; // pixels per full turn of heading
    const W = Math.round(P);
    const cv = mk(W, RIDGE_H);
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, RIDGE_TOP + topY, 0, RIDGE_TOP + 6);
    gr.addColorStop(0, topColor);
    gr.addColorStop(1, FOG_CSS);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-4, RIDGE_H);
    for (let x = -4; x <= W + 4; x += 4) {
      const th = (x / W) * 2 * Math.PI; // u * freq == th * n for freq = n / (FOCAL * par)
      const h = base + amp * (0.55 * Math.abs(Math.sin(th * n1 + k)) + 0.3 * Math.abs(Math.sin(th * n2 + 2.1 * k)) + 0.15 * Math.sin(th * n3 + k));
      g.lineTo(x, RIDGE_TOP - h);
    }
    g.lineTo(W + 4, RIDGE_H);
    g.closePath();
    g.fill();
    return { cv: cv, W: W, P: P, par: par };
  }
  const ridgeFar = buildRidge(1, 30, 120, 1.7, 4, 11, 28, -150, 'rgb(142,170,214)');
  const ridgeNear = buildRidge(0.94, 14, 80, 4.1, 4, 10, 27, -110, 'rgb(92,128,180)');

  // ---- sky panorama: gradient + sun glow/disc + far ridge baked into ONE opaque canvas, a full turn wide ----
  // Panorama x <-> heading (x = heading / 2pi * W), rows map to local y = row - PAN_T. Per frame: one 1:1 slice.
  const PAN_T = 600; // rows above the horizon
  const PAN_B = 200; // rows below it
  const SKY_TOP_CSS = '#0a3490';
  const panW = ridgeFar.W;
  const panorama = mk(panW, PAN_T + PAN_B);
  (function () {
    const g = panorama.getContext('2d');
    const sg = g.createLinearGradient(0, PAN_T - 560, 0, PAN_T);
    sg.addColorStop(0, SKY_TOP_CSS);
    sg.addColorStop(0.3, '#1c5fc4');
    sg.addColorStop(0.62, '#4a96de');
    sg.addColorStop(0.84, '#9ccdf0');
    sg.addColorStop(0.94, '#f6dfb8');
    sg.addColorStop(1, FOG_CSS);
    g.fillStyle = sg;
    g.fillRect(0, 0, panW, PAN_T + PAN_B);
    // sun (drawn at three x offsets so its glow wraps across the seam)
    const sunX = (SUN_AZ / (2 * Math.PI)) * panW;
    const sunY = PAN_T - FOCAL * Math.tan(SUN_EL);
    for (let k = -1; k <= 1; k++) {
      const x = sunX + k * panW;
      g.drawImage(sunSpr, x - 380, sunY - 380, 760, 760);
      g.fillStyle = '#fffbe6';
      g.beginPath();
      g.arc(x, sunY, 38, 0, Math.PI * 2);
      g.fill();
    }
    g.drawImage(ridgeFar.cv, 0, PAN_T - RIDGE_TOP);
  })();

  // Blit rows [srcY, srcY+srcH) of a one-turn-wide strip, scrolled by heading, 1:1, to local y = dstY.
  // Wraps with a second blit at the seam.
  function blitSlice(g, cv, W, srcY, srcH, dstY) {
    const sw = SKY_HALF_W * 2;
    let u0 = Math.round((cam.heading / (2 * Math.PI)) * W - SKY_HALF_W) % W;
    if (u0 < 0) u0 += W;
    const first = Math.min(sw, W - u0);
    g.drawImage(cv, u0, srcY, first, srcH, -SKY_HALF_W, dstY, first, srcH);
    if (first < sw) {
      g.drawImage(cv, 0, srcY, sw - first, srcH, -SKY_HALF_W + first, dstY, sw - first, srcH);
    }
  }

  // Draws into g, which must already have translate(CX,CY) rotate(-roll) translate(0,shift) applied.
  function drawSky(g) {
    const yTop = Math.floor(-cam.shift - 790);
    // rows below the horizon are fully covered by the terrain layer: clip just under it
    const yBot = Math.min(Math.ceil(-cam.shift + 790), SKY_CLIP_Y);
    if (yTop < -PAN_T) {
      g.fillStyle = SKY_TOP_CSS;
      g.fillRect(-SKY_HALF_W, yTop, SKY_HALF_W * 2, -PAN_T - yTop);
    }
    if (yBot > PAN_B) {
      g.fillStyle = FOG_CSS;
      g.fillRect(-SKY_HALF_W, PAN_B, SKY_HALF_W * 2, yBot - PAN_B);
    }
    const a = Math.max(yTop, -PAN_T);
    const b = Math.min(yBot, PAN_B);
    if (b > a) blitSlice(g, panorama, panW, a + PAN_T, b - a, a);
    blitSlice(g, ridgeNear.cv, ridgeNear.W, 0, RIDGE_H, -RIDGE_TOP);
  }

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
    // soft radial puffs: a bluish underside layer, then a white body that fades out at its edge
    for (let k = 0; k < c.puffs.length; k++) {
      const pf = c.puffs[k];
      const px = pf.ox * CK - x0;
      const py = -pf.oy * CK - y0;
      const r = pf.r * CK;
      const gs = g.createRadialGradient(px, py + r * 0.25, 0, px, py + r * 0.25, r);
      gs.addColorStop(0, 'rgba(160,184,216,0.8)');
      gs.addColorStop(0.65, 'rgba(172,194,224,0.45)');
      gs.addColorStop(1, 'rgba(172,194,224,0)');
      g.fillStyle = gs;
      g.beginPath();
      g.arc(px, py + r * 0.25, r, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < c.puffs.length; k++) {
      const pf = c.puffs[k];
      const px = pf.ox * CK - x0;
      const py = -pf.oy * CK - y0;
      const r = pf.r * CK;
      const gw = g.createRadialGradient(px, py - r * 0.06, 0, px, py - r * 0.06, r * 0.95);
      gw.addColorStop(0, 'rgba(255,255,255,0.98)');
      gw.addColorStop(0.55, 'rgba(255,255,255,0.86)');
      gw.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gw;
      g.beginPath();
      g.arc(px, py - r * 0.06, r * 0.95, 0, Math.PI * 2);
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

  // Draws into g with its base (DPR) transform only (screen space).
  function drawClouds(g) {
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
      if (!c.spr) {
        // cheap pre-cull before building the sprite
        if (c.rad * sc < 2 || q.x < -c.rad * sc || q.x > SCREEN_W + c.rad * sc || q.y < -c.rad * sc || q.y > SCREEN_H + c.rad * sc) continue;
        buildCloudSprite(c);
      }
      let m = sc / CK;
      // cap the drawn size (huge near clouds cost a lot of blended pixels and read the same smaller)
      const big = Math.max(c.sw, c.sh) * m;
      if (big > CLOUD_MAX_PX) m *= CLOUD_MAX_PX / big;
      const er = c.rad * CK * m; // on-screen bounding radius of what is actually drawn
      if (er < 2 || q.x < -er || q.x > SCREEN_W + er || q.y < -er || q.y > SCREEN_H + er) continue;
      g.globalAlpha = clamp(1.15 - c.f / 21000, 0.15, 0.95);
      g.save();
      g.translate(q.x, q.y);
      g.rotate(-cam.roll);
      g.drawImage(c.spr, c.sx0 * m, c.sy0 * m, c.sw * m, c.sh * m);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // precomputed unit-circle tables per segment count (no per-frame allocation)
  const RING_NS = [14, 20, 28];
  const RCS = {};
  RING_NS.forEach(function (n) {
    const c = new Float64Array(n + 1);
    const s = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) {
      c[k] = Math.cos((k / n) * Math.PI * 2);
      s[k] = Math.sin((k / n) * Math.PI * 2);
    }
    RCS[n] = { c: c, s: s };
  });

  // Projects the ring outline and builds it as the current canvas path (no intermediate arrays).
  // Returns true when every point is in front of the camera (closed loop).
  function ringPath(r, N) {
    const rx = Math.cos(r.ang);
    const rz = -Math.sin(r.ang);
    const tab = RCS[N];
    let whole = true;
    let pen = false;
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const lx = tab.c[k] * r.r;
      const q = project(r.x + rx * lx, r.y + tab.s[k] * r.r, r.z + rz * lx);
      if (!q) { whole = false; pen = false; continue; }
      if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
    }
    if (whole) ctx.closePath();
    return whole;
  }

  function drawRings(game, clock) {
    for (let i = RING_COUNT - 1; i >= game.rings; i--) {
      const r = game.world.rings[i];
      const c = project(r.x, r.y, r.z);
      if (!c || c.f > 17000) continue;
      const cf = c.f;
      const isNext = i === game.rings;
      const lw = clamp((19 * FOCAL) / cf, 3.5, 44) * (isNext ? 1 + 0.1 * Math.sin(clock * 6) : 0.8);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'miter';
      if (isNext) {
        // vertical light beam above the next ring, readable from far away
        const top = project(r.x, r.y + r.r, r.z);
        if (top) {
          const tx = top.x;
          const ty = top.y;
          const hi = project(r.x, r.y + r.r + 1800, r.z);
          if (hi) {
            ctx.strokeStyle = 'rgba(255,224,90,0.4)';
            ctx.lineWidth = clamp((26 * FOCAL) / cf, 3, 22);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(hi.x, hi.y);
            ctx.stroke();
          }
        }
        // outline is built once and stroked several times
        const whole = ringPath(r, 28);
        // interior tint only while the ring is small on screen (a huge translucent fill is pure overdraw)
        if (whole && (r.r * FOCAL) / cf < 220) {
          ctx.fillStyle = 'rgba(255,220,90,0.14)';
          ctx.fill();
        }
        // one soft halo pass (replaces the two wide glow passes)
        ctx.strokeStyle = 'rgba(255,200,46,0.2)';
        ctx.lineWidth = lw * 3;
        ctx.stroke();
        ctx.strokeStyle = '#ffd62e';
        ctx.lineWidth = lw;
        ctx.stroke();
        ctx.strokeStyle = '#fff0a0';
        ctx.lineWidth = Math.max(1.5, lw * 0.5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,248,0.9)';
        ctx.lineWidth = Math.max(1, lw * 0.18);
        ctx.stroke();
      } else {
        ctx.globalAlpha = clamp(1.1 - cf / 15000, 0.3, 1);
        ringPath(r, cf > 7000 ? 14 : cf > 3500 ? 20 : 28);
        if (cf < 7000) {
          ctx.strokeStyle = 'rgba(111,224,255,0.2)';
          ctx.lineWidth = lw * 2.4;
          ctx.stroke();
        }
        ctx.strokeStyle = '#6fe0ff';
        ctx.lineWidth = lw;
        ctx.stroke();
        if (cf < 9000) {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = Math.max(1, lw * 0.25);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // star glow baked once: opaque-ish core out to 1/7 of the radius, fading to nothing at the edge
  const starGlow = mk(64, 64);
  (function () {
    const g = starGlow.getContext('2d');
    const sg = g.createRadialGradient(32, 32, 32 * 0.4 / 2.8, 32, 32, 32);
    sg.addColorStop(0, 'rgba(255,220,80,0.6)');
    sg.addColorStop(1, 'rgba(255,220,80,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(32, 32, 32, 0, Math.PI * 2);
    g.fill();
  })();

  function starShape(R, rot) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = rot + (k * Math.PI) / 5 - Math.PI / 2;
      const rr = k % 2 === 0 ? R : R * 0.45;
      if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  // Bonus stars: small glowing gold discs with a star on them; sparkles burst where one was collected.
  function drawStars(game, clock) {
    const list = game.world.stars;
    for (let i = 0; i < list.length; i++) {
      if (game.starGot[i]) continue;
      const s = list[i];
      const q = project(s.x, s.y, s.z);
      if (!q || q.f > 9000) continue;
      const R = clamp((s.r * FOCAL) / q.f, 6, 48) * (1 + 0.08 * Math.sin(clock * 5 + i));
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(-cam.roll);
      ctx.drawImage(starGlow, -R * 2.8, -R * 2.8, R * 5.6, R * 5.6);
      ctx.fillStyle = '#ffcf26';
      ctx.strokeStyle = 'rgba(120,70,0,0.85)';
      ctx.lineWidth = Math.max(1.5, R * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff6c2';
      starShape(R * 0.78, Math.sin(clock * 2 + i) * 0.25);
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < game.sparks.length; i++) {
      const sp = game.sparks[i];
      const q = project(sp.x, sp.y, sp.z);
      if (!q) continue;
      const k = sp.t / 0.8;
      const sc = FOCAL / q.f;
      const R = clamp((60 + 300 * k) * sc, 6, 180);
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(-cam.roll);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#fff2a0';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, R * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      for (let j = 0; j < 8; j++) {
        const a = (j * Math.PI) / 4 + k * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
        ctx.lineTo(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15);
        ctx.stroke();
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
    ctx.strokeStyle = on ? 'rgba(120,255,200,0.55)' : 'rgba(120,220,255,0.3)';
    ctx.lineCap = 'butt';
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

    // Static layers (sky, terrain, clouds): rendered only every 2nd frame into a transparent screen-sized cache;
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
      drawSky(tctx);
      tctx.drawImage(off, (-BW * BS) / 2, -HB * BS, BW * BS, BH * BS);
      tctx.setTransform(baseT);
      drawClouds(tctx);
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      terrainValid = true;
    }
    frameNo++;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tcache, 0, 0);
    ctx.restore();

    drawRunwayBeacon(game);
    drawRings(game, clock);
    drawStars(game, clock);

    if (game.screen === 'crashed') {
      const q = project(plane.x, plane.y + 8, plane.z);
      drawFireball(ctx, q ? q.x : CX, q ? q.y : 560, game.crashT, clock);
      return;
    }
    drawShadow(plane);
    const sx = CX + clamp(cam.yaw * FOCAL * 0.9, -170, 170);
    const sy = PLANE_Y - clamp((plane.pitch - cam.pitch) * FOCAL * 0.4, -26, 26);
    drawPlaneSprite(ctx, sx, sy, plane.roll - cam.roll, plane.throttle, clock, plane.grounded);
  }

  return { draw: draw, updateCamera: updateCamera, project: project, cam: cam };
}
