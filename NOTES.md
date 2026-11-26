# Skyhook Run: design notes

## What it is
An original arcade-sim courier flight game. Chase camera behind a banking prop plane; voxel-style ray-marched terrain (fields, forest patches, river with a bridge, roads, farms, hills, mountain walls), sun, clouds, six gold rings and a runway with markings, apron and hangars. Pure Canvas 2D, zero dependencies, zero network requests, synth audio only.

## Controls
Up/Down pitch (I inverts), Left/Right or A/D roll, W/S throttle, Space/B brakes, P/Esc pause, R restart, Enter/click start, M mute. Note: the brief listed W/S *and* Up/Down for throttle, but they also had to pitch; resolved as Up/Down = pitch, W/S = throttle.

## Rules
- **Rings**: six, in order. Each is a vertical disc facing the course; it counts when the plane's path crosses the disc plane within 1.08 x radius (160 ft) of the centre, from either side. Score 500 + up to 250 for accuracy. Each ring refuels +8%. Ring #3 is deliberately low (170 ft AGL).
- **Fuel**: 100 units, burns 0.10 + 0.55 x throttle per second. Empty = engine out; any ground impact then reports "Out of fuel".
- **Stall**: below ~62 kt lift fades, nose drops, sink rate grows. Banked turns also lose lift.
- **Crash**: terrain/river contact anywhere but the runway; on the runway if sink > 1320 fpm, wing low (>17 deg), nose down, tail strike, crooked (>24 deg off runway axis), or faster than 127 kt. Leaving the runway while rolling also crashes.
- **Landing**: a good touchdown switches to ground roll (steer with roll keys, brake with Space or idle throttle). With all 6 rings collected and speed < 5 kt the mission completes. Landing before all rings is allowed; you can take off again (rotate above ~66 kt).
- **Score** = rings + time bonus (10 per second under 300 s) + landing (1000 + smoothness up to 600 + centreline up to 300) + fuel (8 per %). Grades S/A/B/C at 9000/7500/6000.

## File map (game/)
- `index.html`: canvas shell
- `src/main.js`: boot, game loop, input to actions, audio hooks, `window.__skyhookRun()`
- `src/rng.js`: mulberry32, hash, value noise, fbm
- `src/terrain.js`: seeded world generation, height/colour grid, rings, runway paint
- `src/physics.js`: flight model, ground roll, contact/crash rules
- `src/mission.js`: state machine, ring detection, messages, scoring, demo orbit
- `src/render.js`: terrain ray-march, sky, sun, clouds, rings, shadow, aircraft sprite, fireball
- `src/hud.js`: compass strip, speed/altitude/VSI, throttle and fuel gauges, attitude indicator, warnings, toasts
- `src/screens.js`: title, pause, mission complete, crashed overlays and buttons
- `src/input.js`: keyboard/mouse; `src/audio.js`: WebAudio synth; `src/shots.js`: staged scenes

Root: `main.ts` (packaging), `serve.ts` (static server), `take-shots.mjs` + `shots.json` (screenshots).

## Run / retake screenshots
- `node serve.ts` then open http://localhost:8080 (ES modules need http, not file://).
- `node take-shots.mjs` writes `screenshots/1-flight.jpg`, `2-ring.jpg`, `3-landing.jpg`, `4-title.jpg` (JPEG quality steps down to stay under 256 KiB).
- Debug: `window.__skyhookRun()` returns `{screen, altitude, speed, heading, fuel, rings, score, player:{x,y,z}, seed, shot, frame}`; screen is one of title/playing/paused/complete/crashed.

## NOT verified (written without the ability to run shell commands)
- **No code has been executed at all**: not even a syntax check. Expect possible typos; first step is loading the page and reading the console.
- `main.ts` still awaits `vendor/makefun-game.ts` (provided by the competition kit, not in the repo yet) before it can be executed. `buildDossier` is synchronous and returns canonical JSON bytes (Uint8Array); main.ts writes them to `dossier.json`.
- Screenshots have not been taken; `screenshots/` is empty, so main.ts will fail until `node take-shots.mjs` has run.
- Performance of the terrain ray-march (780 columns x ~230 steps) is unmeasured. If it is slow, lower `MAXF` or raise `BS` in `render.js`.
- Visual tuning is blind: fog, ring size, sprite proportions, HUD overlap (PULL UP banner vs. toasts) and whether the runway reads from the flight shot need a look.
- Flight feel and balance (fuel, ring spacing, stall) are untested by play.
- `take-shots.mjs` starts serve.ts with `--experimental-strip-types`; drop the flag if the Node version rejects it.
- Fix pass 2: `stepPlane()` in `game/src/physics.js` was missing `return out;` on the airborne path, so `updateGame()` crashed on `res.crash` and froze the game on the first playing frame; added the return (found by live playthrough; audit of the other `game/src/` modules found no similar missing returns).

- Performance pass: the terrain ray-march in `game/src/render.js` was ~780 columns x ~235 samples at 14 fps in the headless run. Now `BS` 2->3 (buffer 520x567, same 1280x800 canvas, upscaled with smoothing), `MAXF` 16000->12000 and a coarser far step (`22 + 0.018 f`, ~130 samples per column). That is roughly 2.7x fewer terrain samples plus a ~2x smaller buffer to clear and upload, so the expected result is 30+ fps; terrain is slightly softer but fields, river, roads, runway, rings and clouds stay readable. Not re-measured (could not run it); if still under 30 fps raise `BS` to 4 (BW 390, HB 200, BH 425).

- Performance pass 2 (`game/src/render.js` only): `drawClouds()` was the suspected hot spot (up to ~1600 arc fills/frame). Each cloud is now pre-rendered once, lazily, to a small offscreen sprite (its puffs, same two-tone look) and drawn with one `drawImage` at its projected centre; the centre is projected once and off-screen or tiny clouds are skipped before any drawing; alpha uses `globalAlpha` (applied per cloud, not per puff). The far-to-near sort is kept (80 items, hoisted comparator, no per-frame closure). `drawSun()` reuses a radial gradient created once (drawn after `translate` to the sun), and the fog fill style string is precomputed. Terrain march, BS, MAXF, resolution, gameplay and HUD untouched. Not run or re-measured. If fps is still low, the remaining cost is most likely the per-frame `buf32.fill(0)` + `putImageData` + rotated upscale of the terrain buffer, not the clouds; measure that rather than guessing further.

- Performance pass 3 (`game/src/render.js` only): profiling by elimination showed the ray-march is cheap (fps stayed ~17 with it disabled) and the whole `renderer.draw()` costs the rest (60.5 fps with it disabled), so the expense is the per-frame `putImageData` + rotated, upscaled `drawImage` of the terrain buffer in software rendering. The terrain step (march, `putImageData`, rotated blit) now runs every 2nd frame into a transparent screen-sized cache canvas; other frames copy that cache 1:1 (no rotation or scaling) after sky and sun. Clouds, rings, beacon, shadow, plane and HUD still draw every frame, and the first frame always renders terrain. March, BS, MAXF, clouds, gameplay and HUD untouched. Not run or re-measured.
