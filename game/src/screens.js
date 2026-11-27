// Full-screen overlays: title, pause, mission complete, crashed, plus clickable buttons.

import { roundRect, text, fmtTime } from './hud.js';

const SANS = '"Segoe UI","Helvetica Neue",Arial,sans-serif';

export function getButtons(screen) {
  if (screen === 'title') return [{ id: 'start', label: 'START FLIGHT', x: 480, y: 664, w: 320, h: 72 }];
  if (screen === 'paused') {
    return [
      { id: 'resume', label: 'RESUME', x: 490, y: 400, w: 300, h: 62 },
      { id: 'restart', label: 'RESTART', x: 490, y: 480, w: 300, h: 62 }
    ];
  }
  if (screen === 'complete') return [{ id: 'restart', label: 'FLY AGAIN', x: 916, y: 574, w: 260, h: 62 }];
  if (screen === 'crashed') return [{ id: 'restart', label: 'TRY AGAIN', x: 490, y: 520, w: 300, h: 62 }];
  return [];
}

export function hitButton(screen, x, y) {
  const list = getButtons(screen);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
  }
  return null;
}

function drawButtons(ctx, screen, mouse, clock) {
  const list = getButtons(screen);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const hot = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    const pulse = screen === 'title' ? 0.5 + 0.5 * Math.sin(clock * 3) : 0;
    ctx.save();
    ctx.shadowColor = 'rgba(255,190,40,' + (0.35 + 0.35 * pulse).toFixed(2) + ')';
    ctx.shadowBlur = hot ? 28 : 18;
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, hot ? '#ffd86a' : '#ffbf3a');
    g.addColorStop(1, hot ? '#ff9f1c' : '#f08a10');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(60,30,0,0.8)';
    roundRect(ctx, b.x, b.y, b.w, b.h, 16);
    ctx.stroke();
    text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 11, 30, '#2a1500', 'center', false);
  }
}

function wrap(ctx, s, maxW) {
  const words = s.split(' ');
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + ' ' + words[i] : words[i];
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = words[i];
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function bigTitle(ctx, s, x, y, size, c0, c1) {
  ctx.save();
  ctx.font = 'italic 900 ' + size + 'px ' + SANS;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgba(8,14,34,0.92)';
  ctx.strokeText(s, x + 3, y + 5);
  ctx.strokeText(s, x, y);
  const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function dim(ctx, a) {
  ctx.fillStyle = 'rgba(4,10,24,' + a + ')';
  ctx.fillRect(0, 0, 1280, 800);
}

export function drawTitle(ctx, g, mouse) {
  const top = ctx.createLinearGradient(0, 0, 0, 330);
  top.addColorStop(0, 'rgba(4,12,32,0.72)');
  top.addColorStop(1, 'rgba(4,12,32,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, 1280, 330);
  bigTitle(ctx, 'SKYHOOK RUN', 640, 138, 118, '#ffffff', '#ffc23a');
  text(ctx, 'COURIER PILOT  ·  6 GOLD RINGS  ·  5 STARS  ·  1 RUNWAY', 640, 190, 26, '#e6f6ff', 'center', false);

  // controls panel
  roundRect(ctx, 44, 262, 380, 316, 14);
  ctx.fillStyle = 'rgba(6,14,28,0.56)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,200,255,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, 'CONTROLS', 68, 300, 22, '#8fdcff', 'left', false);
  const rows = [
    ['UP / DOWN', 'Pitch nose up / down'],
    ['LEFT / RIGHT  or  A / D', 'Bank to turn'],
    ['W / S', 'Throttle up / down'],
    ['SPACE / B', 'Wheel brakes'],
    ['P', 'Pause'],
    ['R', 'Restart'],
    ['I  /  M', 'Invert pitch  /  mute']
  ];
  for (let i = 0; i < rows.length; i++) {
    text(ctx, rows[i][0], 68, 338 + i * 34, 17, '#ffe08a', 'left', true);
    text(ctx, rows[i][1], 68, 338 + i * 34 + 17, 15, '#dff3ff', 'left', false);
  }

  // mission panel
  roundRect(ctx, 836, 262, 400, 316, 14);
  ctx.fillStyle = 'rgba(6,14,28,0.56)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,200,255,0.6)';
  ctx.stroke();
  text(ctx, 'MISSION', 860, 300, 22, '#8fdcff', 'left', false);
  const lines = [
    'Fly through the 6 gold rings in order.',
    'Chain rings for a x1.25 / x1.5 combo.',
    'Grab the 5 gold stars: +150 each.',
    'Then land on the runway: wings level,',
    'nose straight, gentle sink rate.',
    'Score = rings+stars+time+landing+fuel.',
    'Rings refuel you. Below 62 kt you stall.'
  ];
  for (let i = 0; i < lines.length; i++) text(ctx, lines[i], 860, 338 + i * 30, 17, '#eaf6ff', 'left', false);
  if (g.best > 0) text(ctx, 'BEST SCORE  ' + g.best, 860, 556, 18, '#ffd23a', 'left', true);

  drawButtons(ctx, 'title', mouse, g.clock);
  text(ctx, 'or press ENTER', 640, 766, 16, 'rgba(235,248,255,0.8)', 'center', false);
}

export function drawPause(ctx, mouse, clock) {
  dim(ctx, 0.55);
  bigTitle(ctx, 'PAUSED', 640, 340, 96, '#ffffff', '#9fd8ff');
  drawButtons(ctx, 'paused', mouse, clock);
  text(ctx, 'P to resume  ·  R to restart', 640, 590, 18, '#dff3ff', 'center', false);
}

function row(ctx, label, value, x, y, w, color) {
  text(ctx, label, x, y, 20, '#b9d4e6', 'left', false);
  text(ctx, value, x + w, y, 22, color || '#ffffff', 'right', true);
}

export function drawComplete(ctx, g, mouse) {
  const r = g.result;
  // narrow panel anchored right, so the runway and the aircraft stay visible on the left
  const x = 826;
  const y = 60;
  const w = 440;
  const h = 600;
  ctx.fillStyle = 'rgba(4,10,24,0.2)';
  ctx.fillRect(0, 0, 1280, 800);
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = 'rgba(6,16,32,0.86)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(120,255,190,0.8)';
  ctx.stroke();
  bigTitle(ctx, 'MISSION COMPLETE', x + w / 2, y + 66, 36, '#eafff4', '#58f0a0');
  text(ctx, 'Package delivered. Smooth landing, pilot.', x + w / 2, y + 98, 17, '#cfeee0', 'center', false);

  // grade badge
  ctx.beginPath();
  ctx.arc(x + 72, y + 176, 46, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,200,60,0.18)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffd23a';
  ctx.stroke();
  text(ctx, r.grade, x + 72, y + 197, 56, '#ffd23a', 'center', false);
  text(ctx, 'GRADE', x + 72, y + 244, 13, '#9fb8c8', 'center', false);

  const rx = x + 148;
  const rw = w - 148 - 28;
  row(ctx, 'Rings ' + r.rings + '/6', '+' + r.ringScore, rx, y + 146, rw);
  row(ctx, 'Stars ' + r.stars + '/5', '+' + r.starScore, rx, y + 176, rw);
  row(ctx, 'Time ' + fmtTime(r.time), '+' + r.timeBonus, rx, y + 206, rw);
  row(ctx, 'Landing', '+' + r.landing, rx, y + 236, rw);
  row(ctx, 'Fuel left ' + Math.round(r.fuel) + '%', '+' + r.fuelBonus, rx, y + 266, rw);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 30, y + 288);
  ctx.lineTo(x + w - 30, y + 288);
  ctx.stroke();
  text(ctx, 'TOTAL SCORE', x + 30, y + 334, 20, '#8fdcff', 'left', false);
  text(ctx, String(r.total), x + w - 30, y + 338, 48, '#ffffff', 'right', true);
  if (r.newBest) text(ctx, 'NEW BEST!', x + w - 30, y + 368, 20, '#ffd23a', 'right', true);

  text(ctx, 'TOUCHDOWN', x + 30, y + 410, 14, '#8fdcff', 'left', false);
  text(ctx, 'Sink rate ' + r.sinkFpm + ' fpm   ·   ' + r.touchKt + ' kt', x + 30, y + 436, 16, '#dff3ff', 'left', false);
  text(ctx, Math.abs(Math.round(r.offset)) + ' ft off centreline', x + 30, y + 460, 16, '#dff3ff', 'left', false);
  text(ctx, 'Seed ' + g.seed + '  ·  press R or ENTER to fly again', x + 30, y + 490, 14, '#9fb8c8', 'left', false);
  drawButtons(ctx, 'complete', mouse, g.clock);
}

export function drawCrashed(ctx, g, mouse) {
  ctx.fillStyle = 'rgba(70,6,4,0.38)';
  ctx.fillRect(0, 0, 1280, 800);
  const x = 340;
  const y = 130;
  const w = 600;
  const h = 480;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = 'rgba(20,6,8,0.88)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,90,70,0.85)';
  ctx.stroke();
  bigTitle(ctx, 'CRASHED', x + w / 2, y + 100, 92, '#ffe2dc', '#ff4a3a');
  ctx.font = 'bold 22px ' + SANS;
  const lines = wrap(ctx, g.crashReason, w - 80);
  for (let i = 0; i < lines.length && i < 3; i++) {
    text(ctx, lines[i], x + w / 2, y + 160 + i * 30, 22, '#ffd6cf', 'center', false);
  }
  text(ctx, 'Rings ' + g.rings + '/6   ·   Time ' + fmtTime(g.t) + '   ·   Score ' + g.score, x + w / 2, y + 290, 20, '#ffffff', 'center', true);
  text(ctx, 'Tip: ease the nose up early, keep speed above 62 kt.', x + w / 2, y + 330, 17, '#c9a8a2', 'center', false);
  text(ctx, 'press R or ENTER to retry', x + w / 2, y + 440, 16, '#c9a8a2', 'center', false);
  drawButtons(ctx, 'crashed', mouse, g.clock);
}
