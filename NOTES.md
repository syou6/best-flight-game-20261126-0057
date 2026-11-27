# Skyhook Run: design notes

## What it is
An original arcade-sim courier flight game. Chase camera behind a banking prop plane; voxel-style ray-marched terrain (fields, forest patches, river with a bridge, roads, farms, hills, mountain walls), sun, clouds, six gold rings and a runway with markings, apron and hangars. Pure Canvas 2D, zero dependencies, zero network requests, synth audio only.

## Controls
Up/Down pitch (I inverts), Left/Right or A/D roll, W/S throttle, Space/B brakes, P/Esc pause, R restart, Enter/click start, M mute. Note: the brief listed W/S *and* Up/Down for throttle, but they also had to pitch; resolved as Up/Down = pitch, W/S = throttle.

## Rules
- **Rings**: six, in order. Each is a vertical disc facing the course; it counts when the plane's path crosses the disc plane within 1.08 x radius (160 ft) of the centre, from either side. Score 500 + up to 250 for accuracy. Each ring refuels +8%. Ring #3 is deliberately low (170 ft AGL).
- **Bonus stars** (added after blind round 3): five golden stars, one between each pair of consecutive rings, placed from the world seed (`world.stars`, off the direct line by 280-700 ft, 115-400 ft above ground). Flying within 95 ft of one collects it: +150 points, +2% fuel, a sparkle, and a chime. Stars may be collected in any order and are optional.
- **Combo**: each ring or star collected in a row adds one link to a streak; the ring bonus is multiplied by x1.0 (streak 0), x1.25 (streak 1), x1.5 (streak 2+, cap). Missing a ring (flying past it, "MISSED RING") resets the streak; collecting a star never breaks it. The multiplier shows in the ring toast and on the HUD (`COMBO x1.25`).
- **Fuel**: 100 units, burns 0.10 + 0.55 x throttle per second. Empty = engine out; any ground impact then reports "Out of fuel".
- **Stall**: below ~62 kt lift fades, nose drops, sink rate grows. Banked turns also lose lift.
- **Crash**: terrain/river contact anywhere but the runway; on the runway if sink > 1320 fpm, wing low (>17 deg), nose down, tail strike, crooked (>24 deg off runway axis), or faster than 127 kt. Leaving the runway while rolling also crashes.
- **Landing**: a good touchdown switches to ground roll (steer with roll keys, brake with Space or idle throttle). With all 6 rings collected and speed < 5 kt the mission completes. Landing before all rings is allowed; you can take off again (rotate above ~66 kt).
- **Score** = rings (with combo) + stars + time bonus (10 per second under 300 s) + landing (1000 + smoothness up to 600 + centreline up to 300) + fuel (8 per %). Grades S/A/B/C at 9000/7500/6000.

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

## Round-3 response (visual richness + depth), written without running anything
Why: the entry dropped sharply in blind round 3. Screenshots showed noisy blocky terrain, a washed-out sky, a small plane and ring, a flat runway slab, and a MISSION COMPLETE panel covering half the frame; the game was also thin (6 rings + landing).
- **Sky** (`render.js`): sky gradient re-spanned to 560 px above the horizon so the deep blue is actually visible, warm glow band at the horizon, larger sun halo (`SUN_EL` lowered so the sun is on screen), two layered mountain-silhouette ridges drawn after the sun and before terrain (parallax with heading, fading into the fog colour).
- **Terrain** (`terrain.js`): kept `BS` 3 and the every-2nd-frame cache (a finer buffer would raise the fill cost that earlier perf passes fought). Instead: per-cell hash noise on hills, rock and forest replaced by smooth fbm; canopy bumps smoothed (they made noisy slope lighting); field palette more saturated with similar values; slope shading range narrowed (0.7-1.28); a 1.2x saturation boost in the lighting pass; strong blue river (20,100,196); darker, wider roads (88 ft) so they read at thumbnail size.
- **Aircraft/camera**: sprite scaled x1.35 (`PLANE_K`), `CAM_BACK` 130 -> 105, `CAM_UP` 34 -> 21, sprite centre at y 514 with the pitch wobble limited to +-26 px so the tail stays above the bottom HUD (instrument top at y 640).
- **Rings**: band ~1.7x thicker with three glow passes and brighter gold; the next ring has a vertical light beam; the HUD target diamond is ~1.7x bigger with glow and a pulse.
- **Runway/airfield**: brighter asphalt, white edge lines, threshold bars, 60 ft centreline dashes, aiming-point blocks and touchdown-zone pairs; brighter apron and taxiway, three taller coloured hangars.
- **Clouds**: 80 -> 52, larger radial-gradient puffs (soft edges).
- **Gameplay**: bonus stars and combo (see Rules). `g.stars`, `g.starGot[]`, `g.starScore`, `g.streak`, `g.sparks` live in the game state; stars appear on the HUD (`STARS n/5`), the title text and the mission-complete breakdown. Rings, physics, fuel burn and grade thresholds are unchanged, so totals can now exceed the old maximum.
- **Screens/shots**: MISSION COMPLETE panel is 440 px wide anchored right (runway and plane visible at left); title panels slightly smaller and more transparent; `?shot=flight` poses the plane ~1000 ft short of ring 5 (`rings[4]`) with 2 stars, combo x1.5 and the toast; `?shot=ring` is 480 ft out (was 340) so the plane is not dwarfed.
- **Still unverified**: all of the above is unrun. Check the console first, then the bottom-HUD clearance of the plane, whether the runway shows in the flight shot (it sits ~10 000 ft beyond ring 5, inside `MAXF` 12000 only when the plane is that close), star reachability, and fps with the larger sky/cloud gradients.
