# Flock & Flora · 飞羽守园

An original single-player browser game combining slingshot physics, destructible towers, plant defenses, and a shared ammunition supply. Defend eight terraced gardens against an insect army.

The interface is in Chinese. The demo supports desktop Chrome and mouse input.

## Play

- Choose a plant card, then click an empty planting slot.
- Choose a bird, drag a slingshot, and release to launch. Aiming pauses the whole battle.
- Break tower cores to cancel their future reinforcements, or save ammunition to rescue a threatened lane.
- Open **本关目标** to see the three star objectives. **声音与画面** controls volume, mute, and reduced screen shake.

Progress, best star scores, and settings are saved in this browser. The game continues with session-only progress when browser storage is unavailable.

## Run locally

Use Node.js 20 or later.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Open the local URL printed by Vite.

## Check and build

```sh
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

The production website is generated in `dist/`. It requires a static web server and has no backend or account system.

## Project

TypeScript, Phaser, Matter.js, and Vite power the game. The simulation advances independent physics worlds with one battle clock. Characters use original vector artwork, and sound effects are synthesized with Web Audio.

The test suite includes physics and timing regressions, campaign rules, storage fallback, and recorded legal simulation playthroughs for all eight levels. All eight levels also completed a continuous real-input Chrome playthrough, including final results and saved progress.

Human playtesting and enjoyment feedback are still pending. On the tested Apple M1 headless Chrome/Metal setup, the final level recorded a median frame interval of 33.4 ms. The 60 FPS performance target remains unmet.
