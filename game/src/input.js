// Keyboard + mouse input. Keys are polled for flight axes; one-shot actions are queued.

const LOGICAL_W = 1280;
const LOGICAL_H = 800;

export function createInput(canvas) {
  const down = {};
  const actions = [];
  const clicks = [];
  const mouse = { x: -1, y: -1 };
  const api = { locked: false, invert: false, mouse: mouse };

  const ACTION_KEYS = {
    KeyP: 'pause',
    Escape: 'pause',
    KeyR: 'restart',
    Enter: 'enter',
    KeyM: 'mute',
    KeyI: 'invert'
  };
  const BLOCK = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, PageUp: 1, PageDown: 1
  };

  window.addEventListener('keydown', function (e) {
    if (api.locked) return;
    if (BLOCK[e.code]) e.preventDefault();
    if (e.repeat) return;
    down[e.code] = true;
    const a = ACTION_KEYS[e.code];
    if (a) actions.push(a);
  });
  window.addEventListener('keyup', function (e) {
    down[e.code] = false;
  });
  window.addEventListener('blur', function () {
    for (const k in down) down[k] = false;
  });

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * LOGICAL_W) / r.width,
      y: ((e.clientY - r.top) * LOGICAL_H) / r.height
    };
  }
  canvas.addEventListener('mousemove', function (e) {
    const p = toLogical(e);
    mouse.x = p.x;
    mouse.y = p.y;
  });
  canvas.addEventListener('mouseleave', function () {
    mouse.x = -1;
    mouse.y = -1;
  });
  canvas.addEventListener('click', function (e) {
    if (api.locked) return;
    clicks.push(toLogical(e));
  });

  function axis(pos, neg) {
    return (down[pos] ? 1 : 0) - (down[neg] ? 1 : 0);
  }

  api.axes = function axes() {
    if (api.locked) return { pitch: 0, roll: 0, throttle: 0, brake: false };
    const pitch = axis('ArrowUp', 'ArrowDown') * (api.invert ? -1 : 1);
    const roll = axis('ArrowRight', 'ArrowLeft') + axis('KeyD', 'KeyA');
    const throttle = axis('KeyW', 'KeyS') + axis('PageUp', 'PageDown');
    return {
      pitch: pitch,
      roll: Math.max(-1, Math.min(1, roll)),
      throttle: Math.max(-1, Math.min(1, throttle)),
      brake: !!(down.Space || down.KeyB)
    };
  };
  api.takeActions = function takeActions() {
    return actions.splice(0, actions.length);
  };
  api.takeClicks = function takeClicks() {
    return clicks.splice(0, clicks.length);
  };
  return api;
}
