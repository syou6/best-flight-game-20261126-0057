// Boot + game loop: builds the world, wires input/audio, runs update -> render every frame,
// and exposes window.__skyhookRun() for automated verification.

import { createWorld } from './terrain.js';
import { newGame, startFlight, updateGame } from './mission.js';
import { createRenderer } from './render.js';
import { drawHUD } from './hud.js';
import { drawTitle, drawPause, drawComplete, drawCrashed, hitButton } from './screens.js';
import { createInput } from './input.js';
import { initAudio, setEngine, chime, fanfare, crashSound, beep, toggleMute, suspendAudio, resumeAudio } from './audio.js';
import { parseShot, stageShot } from './shots.js';
import { KT, TAU } from './physics.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const parsed = parseShot(window.location.search);
const staged = !!parsed.shot;

const world = createWorld(parsed.seed);
const game = newGame(world, !staged);
const renderer = createRenderer(ctx, world);
const input = createInput(canvas);

let frame = 0;
let last = 0;
let warnTimer = 0;

if (staged) {
  input.locked = true;
  stageShot(game, renderer, parsed.shot);
} else {
  updateGame(game, { pitch: 0, roll: 0, throttle: 0, brake: false }, 0);
  renderer.updateCamera(game.plane, 0, true);
}

function begin() {
  initAudio();
  resumeAudio();
  startFlight(game);
  renderer.updateCamera(game.plane, 0, true);
}

function restart() {
  initAudio();
  resumeAudio();
  startFlight(game);
  renderer.updateCamera(game.plane, 0, true);
}

function doAction(a) {
  const s = game.screen;
  if (a === 'mute') {
    toggleMute();
  } else if (a === 'invert') {
    input.invert = !input.invert;
  } else if (a === 'pause') {
    if (s === 'playing') {
      game.screen = 'paused';
      setEngine(false, 0, 0);
      suspendAudio();
    } else if (s === 'paused') {
      game.screen = 'playing';
      resumeAudio();
    }
  } else if (a === 'restart') {
    if (s === 'title') begin(); else restart();
  } else if (a === 'enter') {
    if (s === 'title') begin();
    else if (s === 'complete' || s === 'crashed') restart();
    else if (s === 'paused') doAction('pause');
  }
}

function doButton(id) {
  if (id === 'start') begin();
  else if (id === 'resume') doAction('pause');
  else if (id === 'restart') restart();
}

function drainEvents() {
  for (let i = 0; i < game.events.length; i++) {
    const e = game.events[i];
    if (e.type === 'ring') chime(e.n);
    else if (e.type === 'star') chime(3 + e.n);
    else if (e.type === 'land') fanfare();
    else if (e.type === 'crash') crashSound();
  }
  game.events.length = 0;
}

function step(dt) {
  const acts = input.takeActions();
  for (let i = 0; i < acts.length; i++) doAction(acts[i]);
  const clicks = input.takeClicks();
  for (let i = 0; i < clicks.length; i++) {
    const id = hitButton(game.screen, clicks[i].x, clicks[i].y);
    if (id) doButton(id);
  }

  const axes = game.screen === 'playing' ? input.axes() : { pitch: 0, roll: 0, throttle: 0, brake: false };
  if (game.screen !== 'paused') updateGame(game, axes, dt);
  renderer.updateCamera(game.plane, dt, false);

  const p = game.plane;
  const flying = game.screen === 'playing';
  setEngine(flying && !p.engineOut, p.throttle, p.speed);
  if (flying) {
    warnTimer -= dt;
    if ((p.warnTerrain || (p.stalled && !p.grounded)) && warnTimer <= 0) {
      beep();
      warnTimer = 0.55;
    }
  }
  drainEvents();
}

function render() {
  renderer.draw(game);
  const s = game.screen;
  if (s !== 'title') drawHUD(ctx, game, renderer);
  if (s === 'title') drawTitle(ctx, game, input.mouse);
  else if (s === 'paused') drawPause(ctx, input.mouse, game.clock);
  else if (s === 'complete') drawComplete(ctx, game, input.mouse);
  else if (s === 'crashed') drawCrashed(ctx, game, input.mouse);
}

function tick(ts) {
  const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
  last = ts;
  if (!game.frozen) step(dt);
  render();
  frame++;
  window.requestAnimationFrame(tick);
}

document.addEventListener('visibilitychange', function () {
  if (document.hidden && game.screen === 'playing' && !game.frozen) doAction('pause');
});

window.__skyhookRun = function skyhookRun() {
  const p = game.plane;
  return {
    screen: game.screen,
    altitude: Math.round(p.y),
    speed: Math.round(p.speed / KT),
    heading: Math.round((((p.heading % TAU) + TAU) % TAU) * (180 / Math.PI)),
    fuel: Math.round(p.fuel * 10) / 10,
    rings: game.rings,
    score: game.score,
    player: { x: p.x, y: p.y, z: p.z },
    seed: game.seed,
    shot: parsed.shot || null,
    frame: frame
  };
};

canvas.focus();
window.requestAnimationFrame(function (ts) {
  last = ts;
  tick(ts);
});
