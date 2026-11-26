// Cockpit instruments drawn over the chase view: compass strip, airspeed, altitude, vertical speed,
// throttle and fuel gauges, artificial horizon, target marker, warnings and message toasts.

import { angDiff, clamp, KT, FT_PER_NM, TAU } from './physics.js';
import { RING_COUNT } from './terrain.js';
import { targetOf } from './mission.js';

const MONO = '"Consolas","Menlo","DejaVu Sans Mono","Courier New",monospace';
const SANS = '"Segoe UI","Helvetica Neue",Arial,sans-serif';
const DEG = 180 / Math.PI;

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, s, x, y, size, color, align, mono) {
  ctx.font = 'bold ' + size + 'px ' + (mono ? MONO : SANS);
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function panel(ctx, x, y, w, h) {
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = 'rgba(6,14,28,0.68)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(110,200,255,0.55)';
  ctx.stroke();
}

function pad(n, len) {
  let s = String(Math.max(0, Math.round(n)));
  while (s.length < len) s = '0' + s;
  return s;
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return pad(m, 2) + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

function bar(ctx, x, y, w, h, frac, color) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  if (frac > 0.01) {
    roundRect(ctx, x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawCompass(ctx, hdgDeg, relTargetDeg) {
  const x0 = 390;
  const w = 500;
  const y0 = 18;
  const h = 46;
  const cx = x0 + w / 2;
  const ppd = 5.4;
  panel(ctx, x0, y0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + 2, y0, w - 4, h);
  ctx.clip();
  const lo = Math.floor(hdgDeg - 48);
  const hi = Math.ceil(hdgDeg + 48);
  for (let a = lo; a <= hi; a++) {
    if (a % 5 !== 0) continue;
    const x = cx + (a - hdgDeg) * ppd;
    const big = a % 15 === 0;
    ctx.strokeStyle = 'rgba(190,230,255,0.85)';
    ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y0 + h);
    ctx.lineTo(x, y0 + h - (big ? 14 : 8));
    ctx.stroke();
    if (a % 30 === 0) {
      const n = ((a % 360) + 360) % 360;
      const lab = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : pad(n / 10, 2);
      text(ctx, lab, x, y0 + 21, n % 90 === 0 ? 20 : 15, n % 90 === 0 ? '#ffd23a' : '#dff3ff', 'center', false);
    }
  }
  const tx = cx + clamp(relTargetDeg, -46, 46) * ppd;
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.moveTo(tx, y0 + h - 15);
  ctx.lineTo(tx + 7, y0 + h - 7);
  ctx.lineTo(tx, y0 + h + 1);
  ctx.lineTo(tx - 7, y0 + h - 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath();
  ctx.moveTo(cx, y0 + 4);
  ctx.lineTo(cx - 7, y0 - 5);
  ctx.lineTo(cx + 7, y0 - 5);
  ctx.closePath();
  ctx.fill();
  panel(ctx, cx - 46, y0 + h + 6, 92, 30);
  text(ctx, pad(hdgDeg, 3) + '°', cx, y0 + h + 29, 22, '#eaf8ff', 'center', true);
}

function drawHorizon(ctx, cx, cy, R, pitch, roll) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  const off = pitch * DEG * 2.3;
  const sky = ctx.createLinearGradient(0, -R * 2 + off, 0, off);
  sky.addColorStop(0, '#1f63c8');
  sky.addColorStop(1, '#68b4f0');
  ctx.fillStyle = sky;
  ctx.fillRect(-R * 2, -R * 3 + off, R * 4, R * 3);
  const gnd = ctx.createLinearGradient(0, off, 0, off + R * 2);
  gnd.addColorStop(0, '#a56f35');
  gnd.addColorStop(1, '#5b3a1b');
  ctx.fillStyle = gnd;
  ctx.fillRect(-R * 2, off, R * 4, R * 3);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-R * 2, off);
  ctx.lineTo(R * 2, off);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let d = -30; d <= 30; d += 5) {
    if (d === 0) continue;
    const y = off - d * 2.3;
    const half = d % 10 === 0 ? 24 : 12;
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(half, y);
    ctx.stroke();
    if (d % 10 === 0) text(ctx, String(Math.abs(d)), half + 12, y + 4, 11, '#ffffff', 'center', true);
  }
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.moveTo(0, -R + 4);
  ctx.lineTo(-7, -R + 17);
  ctx.lineTo(7, -R + 17);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // fixed bezel, roll ticks and aircraft symbol
  ctx.save();
  ctx.shadowColor = 'rgba(110,210,255,0.9)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#8fdcff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 2, 0, TAU);
  ctx.stroke();
  ctx.restore();
  const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  for (let i = 0; i < ticks.length; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ticks[i] / DEG);
    ctx.beginPath();
    ctx.moveTo(0, -R + 1);
    ctx.lineTo(0, -R + (ticks[i] % 30 === 0 ? 11 : 6));
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = '#ff9a1f';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy);
  ctx.lineTo(cx - 16, cy);
  ctx.lineTo(cx - 16, cy + 8);
  ctx.moveTo(cx + 46, cy);
  ctx.lineTo(cx + 16, cy);
  ctx.lineTo(cx + 16, cy + 8);
  ctx.stroke();
  ctx.fillStyle = '#ff9a1f';
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, TAU);
  ctx.fill();
  ctx.lineCap = 'butt';
}

function drawTargetMarker(ctx, g, rend, tgt, rb, dist, distText) {
  const q = rend.project(tgt.x, tgt.y, tgt.z);
  const p = g.plane;
  if (q && q.x > 70 && q.x < 1210 && q.y > 130 && q.y < 640 && Math.abs(rb) < 1.3) {
    const x = q.x;
    const y = q.y;
    ctx.strokeStyle = '#ffd23a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 17);
    ctx.lineTo(x + 17, y);
    ctx.lineTo(x, y + 17);
    ctx.lineTo(x - 17, y);
    ctx.closePath();
    ctx.stroke();
    text(ctx, tgt.label + '  ' + distText, x, y - 26, 16, '#ffe9a0', 'center', true);
    return;
  }
  if (p.grounded) return;
  const left = rb < 0;
  const x = left ? 44 : 1236;
  const y = 330;
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.moveTo(x + (left ? -16 : 16), y);
  ctx.lineTo(x + (left ? 14 : -14), y - 22);
  ctx.lineTo(x + (left ? 14 : -14), y + 22);
  ctx.closePath();
  ctx.fill();
  text(ctx, tgt.label, left ? 66 : 1214, y + 6, 16, '#ffe9a0', left ? 'left' : 'right', true);
}

function drawWarnings(ctx, g, clock) {
  const p = g.plane;
  const items = [];
  if (g.screen === 'playing' || g.screen === 'paused') {
    if (p.warnTerrain) items.push({ t: 'PULL UP', c: '#ff3b30', big: true });
    if (p.stalled && !p.grounded) items.push({ t: 'STALL', c: '#ff9a1f', big: false });
    if (p.engineOut && !p.grounded) items.push({ t: 'ENGINE OUT', c: '#ff3b30', big: false });
    else if (p.fuel < 20) items.push({ t: 'LOW FUEL', c: '#ffb020', big: false });
  }
  let y = 142;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const a = 0.6 + 0.4 * Math.sin(clock * 14);
    ctx.save();
    ctx.globalAlpha = it.big ? a : 0.92;
    const w = it.big ? 250 : 190;
    const h = it.big ? 58 : 38;
    roundRect(ctx, 640 - w / 2, y, w, h, 10);
    ctx.fillStyle = 'rgba(40,6,6,0.78)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = it.c;
    ctx.stroke();
    text(ctx, it.t, 640, y + (it.big ? 41 : 27), it.big ? 36 : 22, it.c, 'center', false);
    ctx.restore();
    y += h + 8;
  }
  return y;
}

function drawMessages(ctx, g, startY) {
  let y = Math.max(startY + 18, 176);
  for (let i = g.messages.length - 1; i >= 0; i--) {
    const m = g.messages[i];
    const a = clamp(m.life / 0.6, 0, 1);
    const age = m.max - m.life;
    const slide = (1 - clamp(age / 0.25, 0, 1)) * 14;
    const col = m.kind === 'ring' ? '#ffd23a' : m.kind === 'good' ? '#7dffb0' : m.kind === 'warn' ? '#ffb020' : m.kind === 'bad' ? '#ff6a5a' : '#eaf8ff';
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 26px ' + SANS;
    const w = ctx.measureText(m.text).width + 44;
    roundRect(ctx, 640 - w / 2, y - 28 - slide, w, 40, 10);
    ctx.fillStyle = 'rgba(6,14,28,0.72)';
    ctx.fill();
    text(ctx, m.text, 640, y - slide, 26, col, 'center', false);
    ctx.restore();
    y += 48;
  }
}

export function drawHUD(ctx, g, rend) {
  const p = g.plane;
  const clock = g.clock;
  const hdgRad = ((p.heading % TAU) + TAU) % TAU;
  const hdgDeg = hdgRad * DEG;
  const tgt = targetOf(g);
  const dx = tgt.x - p.x;
  const dz = tgt.z - p.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const rb = angDiff(Math.atan2(dx, dz), p.heading);
  const distText = dist > 3000 ? (dist / FT_PER_NM).toFixed(1) + ' NM' : Math.round(dist) + ' FT';
  const kt = p.speed / KT;
  const vsi = p.vy * 60;

  // floating top bar (score/rings, time, compass) is hidden under the mission-complete overlay
  if (g.screen !== 'complete') {
  // top-left: score + ring progress
  panel(ctx, 24, 18, 300, 92);
  text(ctx, 'SCORE', 42, 44, 14, '#8fdcff', 'left', false);
  text(ctx, pad(g.score, 5), 42, 84, 38, '#ffffff', 'left', true);
  for (let i = 0; i < RING_COUNT; i++) {
    const x = 200 + i * 20;
    ctx.beginPath();
    ctx.arc(x, 56, 7, 0, TAU);
    if (i < g.rings) { ctx.fillStyle = '#ffd23a'; ctx.fill(); } else { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  text(ctx, 'RINGS ' + g.rings + '/' + RING_COUNT, 200, 90, 15, '#dff3ff', 'left', true);

  // top-right: timer
  panel(ctx, 956, 18, 300, 92);
  text(ctx, 'TIME', 974, 44, 14, '#8fdcff', 'left', false);
  text(ctx, fmtTime(g.t), 974, 84, 38, '#ffffff', 'left', true);
  text(ctx, 'BEST ' + pad(g.best, 5), 1238, 44, 13, '#9fb8c8', 'right', true);

  drawCompass(ctx, hdgDeg, angDiff(Math.atan2(dx, dz), hdgRad) * DEG);
  }

  // bottom-left cluster: airspeed, throttle, fuel
  panel(ctx, 150, 676, 400, 112);
  text(ctx, 'AIRSPEED', 168, 702, 13, '#8fdcff', 'left', false);
  text(ctx, pad(kt, 3), 168, 750, 50, p.stalled ? '#ff6a5a' : '#ffffff', 'left', true);
  text(ctx, 'KT', 290, 750, 18, '#9fd8f5', 'left', false);
  text(ctx, p.stalled ? 'STALL' : p.grounded ? 'ON GROUND' : 'FLYING', 168, 776, 13, p.stalled ? '#ff6a5a' : '#8fb4c8', 'left', true);
  text(ctx, 'THROTTLE ' + Math.round(p.throttle * 100) + '%', 340, 704, 13, '#8fdcff', 'left', true);
  bar(ctx, 340, 712, 190, 14, p.throttle, '#59d8ff');
  const fuelCol = p.fuel < 20 ? (Math.floor(clock * 4) % 2 === 0 ? '#ff3b30' : '#ffb020') : '#7dffb0';
  text(ctx, 'FUEL ' + Math.round(p.fuel) + '%', 340, 754, 13, '#8fdcff', 'left', true);
  bar(ctx, 340, 762, 190, 14, p.fuel / 100, fuelCol);

  // bottom-right cluster: altitude, vertical speed, heading, target
  panel(ctx, 730, 676, 400, 112);
  text(ctx, 'ALTITUDE', 748, 702, 13, '#8fdcff', 'left', false);
  text(ctx, pad(p.y, 4), 748, 750, 50, '#ffffff', 'left', true);
  text(ctx, 'FT', 898, 750, 18, '#9fd8f5', 'left', false);
  text(ctx, 'AGL ' + pad(Math.max(0, p.agl), 4) + '  VS ' + (vsi >= 0 ? '+' : '-') + pad(Math.abs(vsi), 4), 748, 776, 13, '#8fb4c8', 'left', true);
  text(ctx, 'HDG ' + pad(hdgDeg, 3) + '°', 1000, 704, 15, '#eaf8ff', 'left', true);
  text(ctx, tgt.label, 960, 738, 15, '#ffd23a', 'left', true);
  text(ctx, distText, 960, 764, 22, '#ffe9a0', 'left', true);

  drawHorizon(ctx, 640, 714, 74, p.pitch, p.roll);

  if (g.screen === 'playing' || g.screen === 'paused' || g.screen === 'complete') drawTargetMarker(ctx, g, rend, tgt, rb, dist, distText);
  const wy = drawWarnings(ctx, g, clock);
  drawMessages(ctx, g, wy);

  if (g.screen === 'playing' && g.t < 9) {
    text(ctx, 'UP/DOWN pitch   LEFT/RIGHT or A/D roll   W/S throttle   SPACE brake   P pause', 640, 650, 15, 'rgba(235,248,255,0.85)', 'center', false);
  }
}
