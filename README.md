# Flappy Turtle Web

A web port of the native iOS game in `../FlappyTurtle`, built with HTML5
and raw WebGL (no libraries, no build step). It keeps the original's
physics, tuning, layout, art, and sounds.

## Run

Serve this folder over HTTP (ES modules do not load from `file://`):

```bash
python3 -m http.server 8765 --directory FlappyTurtleWeb
```

Then open <http://127.0.0.1:8765/> in a browser with WebGL.

## Rendering

WebGL is tried first (`webgl`, then `webgl2`, then
`experimental-webgl`, each with a full and a minimal attribute set).
Before the game canvas is touched, each mode is validated on a
throwaway canvas (shaders compile, a texture uploads, no error, no
context loss): a canvas that yields a WebGL context is locked to
WebGL mode, so probing the game canvas itself would strand the
fallback. If no mode validates — WebGL disabled, GPU blocklisted,
broken context — the game falls back to a Canvas 2D renderer with
the same sprites and layout, on a fresh canvas if the game canvas
is already WebGL-locked, instead of failing to start. A lost
context mid-game swaps to the fallback the same way. The active
renderer is recorded on the canvas as `data-renderer` (`webgl` or
`canvas2d`). Force the fallback for testing with
`?renderer=2d`.

## Controls

- Click / tap the game, or press Space / ↑ / W: flap (from "Get ready"
  this also starts the round).
- P or Esc: pause / resume. Tap anywhere while paused to resume.
- Enter: Play from the title screen, Replay on the game-over screen.
- R: replay after game over. M: mute / unmute.
- Share buttons copy the score text (or open the system share sheet
  where the browser supports it).

## What changed from the iOS build

**Moving pipes were removed.** On iOS, from the 10th pipe pair of a
round, the gap moved up and down at 50 pt/s inside a 180 pt band
(`GapMotion` in `Entities.swift`, `GameConfig.movingGapFromPair = 10`).
This web build has no gap motion at all: every pair — 1st, 10th, 20th —
keeps the gap centre it spawned with (220 pt gap, centre in 170…520)
for its whole life, exactly as pairs 1–9 behaved on iOS. There is no
`GapMotion` type, no moving-gap constant, and no vertical pipe motion
in `js/model.js`; the autopilot's rollout look-ahead, which only
existed for moving gaps, is gone with it. The high score is kept in
`localStorage` instead of `UserDefaults`, and sharing uses the Web
Share API with a clipboard fallback instead of the iOS share sheet.

Everything else is ported 1:1: the Box2D-style turtle step (including
the 3.14 rotation conversion used for collisions), the SAT collision
test, obstacle spawn timing and geometry, the scrolling land/star
strips, the flap animation, the HUD positions and finish slide/count-up,
and the split-Mix64 seeded random source (so `?seed=` reproduces the
same layouts as the iOS `-ft-seed` hook).

## Layout

| Path | What it is |
|---|---|
| [index.html](index.html) | Page shell: canvas, hint, status, and error overlay |
| [style.css](style.css) | Full-viewport black stage, hint/toast styling |
| [js/game.js](js/game.js) | Boot, frame loop, input, controller, WebGL draw list |
| [js/model.js](js/model.js) | Pure game model: physics, spawning, collision, autopilot |
| [js/renderer.js](js/renderer.js) | Raw WebGL sprite renderer (textured quads) |
| [js/fallback.js](js/fallback.js) | Canvas 2D renderer used when WebGL is unavailable |
| [js/hud.js](js/hud.js) | HUD layout and state (title, ready, pause, game over) |
| [js/atlas.js](js/atlas.js) | Atlas frame rects from `game.plist` |
| [js/audio.js](js/audio.js) | Sound pools for the original `.wav` effects |
| [assets/](assets) | Original art (`game.png`, `bg.jpg`, `obstacle.png`) and sounds |
| [tests/model.test.mjs](tests/model.test.mjs) | Node tests, including the static-gap suite |

## Launch options (debug / screenshots)

These mirror the iOS `-ft-` launch arguments, as URL query parameters:

```
?scene=menu|ready|playing|paused|gameover
?seed=7&advance=3&freeze=1&mute=1&autopilot=1
?score=12&highscore=30
```

`?scene=playing` runs 3 seconds of autopilot by default (or
`?advance=` seconds); `?freeze=1` stops simulation for a stable
screenshot. `?autopilot=1` lets the bot fly during live play.

## Tests

```bash
node --test tests/model.test.mjs
```

The static-gap suite flies a seeded round past pair 16 and asserts
that no pair's gap centre, pipe height, or pipe anchor ever changes
after spawn.

## Third-party assets

The source code is released under the MIT License (see
`../FlappyTurtle/LICENSE`). The bundled art and sounds — the original
game's assets in `assets/` — are not covered by it and remain under
their owners' terms, as in the original repository.
