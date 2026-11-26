# best-flight-game-20261126-0057

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/syou6/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/syou6/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

**Skyhook Run** is an original courier-pilot flight game in pure Canvas 2D, with no dependencies and no network requests. You fly a small orange prop plane in a chase view over patchwork fields, a winding river, roads, hills and a distant mountain wall. Thread six gold rings in order, then bring the package home by landing on the runway. Bank, pitch and throttle all matter: stall below 62 kt, burn fuel, dodge terrain (PULL UP!), and set the plane down gently, wings level, on the centreline for the best score. The world is generated from a seed, so the same seed gives the same map. Sound is synthesised live with WebAudio.

## Run it

```
node serve.ts
```

Play at http://localhost:8080 (use `node serve.ts --port 9000` for another port).

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Packages `game/` and `screenshots/` and writes `dossier.json`. Retake screenshots with `node take-shots.mjs`.

## Controls

| Key | Action |
| --- | --- |
| Up / Down | Pitch nose up / down (`I` inverts) |
| Left / Right or A / D | Bank (roll) to turn |
| W / S | Throttle up / down |
| Space or B | Wheel brakes (on the runway) |
| P or Esc | Pause |
| R | Restart |
| Enter or click | Start / confirm |
| M | Mute |

Staged scenes for screenshots: `?shot=title|flight|ring|landed|crashed&seed=1`.

Entered on [make.fun](https://make.fun/?ref=1hdgtg6e&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards
