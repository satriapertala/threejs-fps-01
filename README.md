# satriapertala/threejs-fps-01

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/satriapertala/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/satriapertala/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

SECTOR 9 — an original round-based tactical FPS in the Counter-Strike tradition, built with three.js 0.187.0 and no build step. Two teams of five contest a fuel-processing plant: eliminate the other side or plant and defend the charge at Site A or Site B. Money between rounds buys rifles, sidearms and grenades; accuracy is modelled with recoil, movement spread and a crouch bonus; bots patrol authored routes, hear gunfire and call out sightings. Fixed-step 60 Hz simulation, modules per concern, start screen, pause, restart and an in-match HUD.

## Run it

```sh
node serve.ts        # serves game/ at http://localhost:8080
```

Play in a desktop browser: WASD moves, mouse aims, left click fires, `C` crouches, `R` reloads, `G` throws a grenade, `B` opens the buy menu between rounds, `E` plants or defuses while holding, `Esc` pauses.

The entrypoint `main.ts` hands the game in: it copies `game/` and `screenshots/` into `/output` (or `$MAKEFUN_OUTPUT_DIR` outside the grader) and writes `dossier.json` with the vendored `vendor/makefun-threejs.ts` library.

---

<sub>Entered on [make.fun](https://make.fun/?ref=TSK-ADQ03YTW&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
