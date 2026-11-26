// World generation: heightmap + colour map on a wrapped grid, patchwork fields, river,
// roads, hills/mountain walls, the runway with apron/hangars, and the six target rings.
// Coordinates: x = east, z = north, y = up, all in feet. Heading 0 = +z (north), 90 deg = +x.

import { mulberry32, hash2, fbm, smoothstep } from './rng.js';

export const GW = 512; // grid width (power of two so x wraps with a mask)
export const GH = 1300; // grid height (z does not wrap, it clamps)
export const CELL = 40; // feet per cell
export const X0 = -10240;
export const Z0 = -4000;
export const GWM = GW - 1;
export const RWY_ALT = 12;
export const RW_HALF = 80; // runway half width, feet
export const RING_R = 160;
export const RING_COUNT = 6;

const RIVER_HW = 95;
const RING_AGL = [260, 300, 170, 380, 230, 330]; // ring #3 is the deliberately low one
const FIELD_COLORS = [
  [104, 158, 64], [128, 170, 72], [158, 176, 76], [212, 186, 86],
  [196, 154, 74], [146, 104, 64], [86, 138, 72], [172, 196, 98]
];

export function pack(r, g, b) {
  r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function packWater(r, g, b) {
  return ((254 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// Exact (not grid-quantised) runway paint, so markings stay crisp up close.
export function runwayColor(rw, x, z) {
  const dx = x - rw.x;
  const adx = dx < 0 ? -dx : dx;
  const dz = z - rw.z0;
  const len = rw.z1 - rw.z0;
  const dend = len - dz;
  if (adx > RW_HALF - 7) return pack(236, 236, 230);
  if (adx < 70 && ((dz > 24 && dz < 96) || (dend > 24 && dend < 96)) && (Math.floor((dx + 70) / 9) & 1) === 0) {
    return pack(240, 240, 236);
  }
  if (adx < 3.5 && dz > 160 && dend > 160 && (Math.floor(dz / 90) & 1) === 0) return pack(238, 238, 232);
  if (adx > 22 && adx < 44 && ((dz > 480 && dz < 600) || (dend > 480 && dend < 600))) return pack(232, 232, 226);
  const n = hash2(5, Math.floor(dz / 16), Math.floor(dx / 16)) * 8;
  return pack(58 + n, 60 + n, 66 + n);
}

export function createWorld(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const rwX = Math.round((rng() - 0.5) * 2200);
  const rz0 = 36000;
  const rz1 = 42500;
  const runway = { x: rwX, z0: rz0, z1: rz1, halfW: RW_HALF, alt: RWY_ALT };

  // --- ring plan (x, z first; altitude once the terrain exists) ---
  const rings = [];
  let px = 0;
  for (let i = 0; i < RING_COUNT; i++) {
    let x;
    let z;
    if (i === RING_COUNT - 1) {
      z = 32500;
      x = rwX + Math.round((rng() - 0.5) * 300);
    } else {
      z = 4500 + i * 5600 + Math.round((rng() - 0.5) * 700);
      x = px + (rng() - 0.5) * 4400;
      x = Math.max(-2800, Math.min(2800, x));
    }
    px = x;
    rings.push({ i: i, x: x, y: 0, z: z, r: RING_R, ang: 0 });
  }
  const pts = [{ x: 0, z: -4000 }, { x: 0, z: 0 }];
  for (let i = 0; i < rings.length; i++) pts.push({ x: rings[i].x, z: rings[i].z });
  pts.push({ x: rwX, z: rz0 });
  pts.push({ x: rwX, z: rz1 + 4000 });
  for (let i = 0; i < rings.length; i++) {
    const a = i === 0 ? pts[1] : rings[i - 1];
    const b = i === rings.length - 1 ? { x: rwX, z: rz0 } : rings[i + 1];
    rings[i].ang = Math.atan2(b.x - a.x, b.z - a.z);
  }

  function pathX(z) {
    if (z <= pts[0].z) return pts[0].x;
    for (let i = 1; i < pts.length; i++) {
      if (z <= pts[i].z) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = (z - a.z) / (b.z - a.z);
        return a.x + (b.x - a.x) * t;
      }
    }
    return pts[pts.length - 1].x;
  }

  function riverX(z) {
    const base = 1900 * Math.sin(z / 5200 + 1.3) + 700 * Math.sin(z / 1900 + 0.4);
    const w = smoothstep(30000, 37000, z);
    return base * (1 - w) + (rwX + 4300) * w;
  }

  // --- grid generation ---
  const hgt = new Float32Array(GW * GH);
  const col = new Uint32Array(GW * GH);

  for (let iz = 0; iz < GH; iz++) {
    const z = Z0 + (iz + 0.5) * CELL;
    const pX = pathX(z);
    const rX = riverX(z);
    const roadCx = 0.6 * pX + 900 * Math.sin(z / 2700 + 0.7) + 1300;
    for (let ix = 0; ix < GW; ix++) {
      const x = X0 + (ix + 0.5) * CELL;
      const i = iz * GW + ix;
      const ax = x < 0 ? -x : x;

      let h = 10 + fbm(seed + 7, x / 700, z / 700, 2) * 36;
      const big = fbm(seed, x / 5200, z / 5200, 4);
      h += Math.max(0, big - 0.54) * 2800 * (0.3 + 0.7 * smoothstep(900, 3200, Math.abs(x - pX)));
      if (ax > 5200) h += (ax - 5200) * 0.28 * (0.6 + 0.9 * fbm(seed + 3, x / 1300, z / 1300, 3));
      const rd = Math.abs(x - rX);
      h *= smoothstep(RIVER_HW, RIVER_HW + 520, rd);

      const dxr = Math.max(0, Math.abs(x - rwX) - RW_HALF);
      const dzr = Math.max(0, rz0 - z, z - rz1);
      const dr = Math.sqrt(dxr * dxr + dzr * dzr);
      h = RWY_ALT + (h - RWY_ALT) * smoothstep(260, 1400, dr);

      const zz = z - 350 * Math.sin(x / 1900);
      const rm = Math.abs(zz - Math.round(zz / 4600) * 4600);
      const road = dr > 500 && (Math.abs(x - roadCx) < 34 || rm < 30);
      const isWater = rd < RIVER_HW;

      let r;
      let g;
      let b;
      let water = false;
      if (road) {
        if (isWater) { h = 6; r = 150; g = 148; b = 140; } else { r = 116; g = 114; b = 110; }
      } else if (isWater) {
        r = 34; g = 98; b = 160; water = true;
      } else if (rd < RIVER_HW + 70) {
        r = 206; g = 192; b = 140;
      } else if (h > 900) {
        r = 238; g = 240; b = 248;
      } else if (h > 520) {
        const v = hash2(seed + 14, ix, iz) * 22;
        r = 118 + v; g = 114 + v; b = 108 + v;
      } else if (h > 260) {
        const v = hash2(seed + 15, ix, iz) * 22;
        r = 34 + v * 0.6; g = 84 + v; b = 46 + v * 0.6;
      } else {
        const u = x + 260 * Math.sin(z / 950);
        const v = z + 220 * Math.sin(x / 1150 + 1);
        const fi = Math.floor(u / 660);
        const fj = Math.floor(v / 520);
        const fh = hash2(seed + 11, fi, fj);
        if (hash2(seed + 13, fi, fj) < 0.2) {
          const cv = hash2(seed + 16, ix, iz);
          r = 30 + cv * 20; g = 82 + cv * 30; b = 42 + cv * 16;
          h += 6 + cv * 14; // canopy bumps
        } else {
          const c = FIELD_COLORS[Math.floor(fh * FIELD_COLORS.length)];
          const orient = hash2(seed + 12, fi, fj) < 0.5 ? u : v;
          const m = 0.93 + 0.1 * (Math.sin(orient / 34) * 0.5 + 0.5);
          r = c[0] * m; g = c[1] * m; b = c[2] * m;
        }
      }

      // farm buildings beside the main road
      if (!road && !water && h < 150 && dr > 600) {
        const od = Math.abs(x - roadCx);
        if (od > 70 && od < 150 && hash2(seed + 21, ix, iz) < 0.03) {
          r = 176; g = 64; b = 52; h += 9;
        }
      }

      // airfield: apron, taxiway, hangars
      const lx = x - rwX;
      const lz = z - rz0;
      if (lx > 100 && lx < 360 && lz > 800 && lz < 1700) { r = 92; g = 94; b = 100; }
      if (lx > 60 && lx < 360 && Math.abs(lz - 1250) < 40) { r = 88; g = 90; b = 96; }
      if (lx > 400 && lx < 520) {
        if (lz > 900 && lz < 1100) { r = 196; g = 72; b = 60; h = RWY_ALT + 30; }
        else if (lz > 1250 && lz < 1450) { r = 66; g = 108; b = 170; h = RWY_ALT + 30; }
      }
      // paint the runway rectangle itself into the grid too (far LOD)
      if (Math.abs(lx) < RW_HALF + 8 && lz > -8 && lz < rz1 - rz0 + 8) { r = 64; g = 66; b = 72; }

      hgt[i] = h;
      col[i] = water ? packWater(r, g, b) : pack(r, g, b);
    }
  }

  // baked slope lighting (sun from the west/south-west)
  for (let iz = 1; iz < GH - 1; iz++) {
    for (let ix = 0; ix < GW; ix++) {
      const i = iz * GW + ix;
      const c = col[i];
      if ((c >>> 24) === 254) continue;
      const hw = hgt[iz * GW + ((ix - 1) & GWM)];
      const he = hgt[iz * GW + ((ix + 1) & GWM)];
      const hs = hgt[(iz - 1) * GW + ix];
      const hn = hgt[(iz + 1) * GW + ix];
      let sh = 1 + (((he - hw) + (hn - hs) * 0.6) / CELL) * 0.6;
      sh = sh < 0.62 ? 0.62 : sh > 1.35 ? 1.35 : sh;
      col[i] = pack((c & 255) * sh, ((c >>> 8) & 255) * sh, ((c >>> 16) & 255) * sh);
    }
  }

  function heightAt(x, z) {
    const fx = (x - X0) / CELL - 0.5;
    const fz = (z - Z0) / CELL - 0.5;
    const ix = Math.floor(fx);
    let iz = Math.floor(fz);
    const tx = fx - ix;
    let tz = fz - iz;
    if (iz < 0) { iz = 0; tz = 0; } else if (iz > GH - 2) { iz = GH - 2; tz = 1; }
    const i0 = ix & GWM;
    const i1 = (ix + 1) & GWM;
    const r0 = iz * GW;
    const r1 = r0 + GW;
    const a = hgt[r0 + i0] + (hgt[r0 + i1] - hgt[r0 + i0]) * tx;
    const b = hgt[r1 + i0] + (hgt[r1 + i1] - hgt[r1 + i0]) * tx;
    return a + (b - a) * tz;
  }

  function onRunway(x, z, margin) {
    return Math.abs(x - rwX) <= RW_HALF + margin && z >= rz0 - margin && z <= rz1 + margin;
  }

  function surfaceAt(x, z) {
    if (onRunway(x, z, 0)) return 'runway';
    const ix = Math.floor((x - X0) / CELL) & GWM;
    let iz = Math.floor((z - Z0) / CELL);
    iz = iz < 0 ? 0 : iz > GH - 1 ? GH - 1 : iz;
    return (col[iz * GW + ix] >>> 24) === 254 ? 'water' : 'ground';
  }

  for (let i = 0; i < rings.length; i++) {
    rings[i].y = heightAt(rings[i].x, rings[i].z) + RING_AGL[i];
  }

  return {
    seed: seed,
    hgt: hgt,
    col: col,
    rings: rings,
    runway: runway,
    heightAt: heightAt,
    onRunway: onRunway,
    surfaceAt: surfaceAt,
    pathX: pathX,
    riverX: riverX
  };
}
