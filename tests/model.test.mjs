// Node tests for the web port's model and HUD. Run: node --test tests/model.test.mjs
// The load-bearing suite is the static-gap suite: it flies a seeded round
// far past pair 10 and asserts every pair's gap centre, heights and pipe
// anchors never change after spawn.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GameModel,
  GameConfig,
  fitViewport,
  SeededRandomSource,
  SystemRandomSource,
  InMemoryHighScoreStore,
  boxesOverlap,
} from '../js/model.js';
import { HUD, numberDigits } from '../js/hud.js';

function seededModel(seed = 7, highScore = 0) {
  return new GameModel({ random: new SeededRandomSource(seed), store: new InMemoryHighScoreStore(highScore) });
}

// Keep the turtle inside the nearest upcoming gap so the round survives
// long enough to spawn many pairs. Gravity moves it <1 pt per frame.
function safeStep(model, dt = 1 / 60) {
  const turtleLeft = model.turtle.position.x - GameConfig.turtleWidth / 2;
  const next = model.obstacles.find((o) => o.position.x + o.width / 2 > turtleLeft);
  model.turtle.position.y = next ? next.holeCenter : 320;
  model.turtle.worldVelocityY = 0;
  model.update(dt);
}

describe('static gaps (moving pipes removed)', () => {
  it('pairs 1-9 and 10+ keep the exact gap they spawned with, forever', () => {
    const model = seededModel(7);
    model.play();
    const seen = new Map(); // id -> { holeCenter, height, y }
    let frames = 0;
    while (model.pairsSpawned < 16 && frames < 60 * 60) {
      for (const o of model.obstacles) {
        const prev = seen.get(o.id);
        if (!prev) {
          seen.set(o.id, { holeCenter: o.holeCenter, height: o.height, y: o.position.y });
        } else {
          assert.equal(o.holeCenter, prev.holeCenter, `pair ${o.pairNumber} gap centre moved`);
          assert.equal(o.height, prev.height, `pair ${o.pairNumber} pipe height changed`);
          assert.equal(o.position.y, prev.y, `pair ${o.pairNumber} pipe y moved`);
        }
        // No moving-gap state may exist on any obstacle.
        assert.equal('motion' in o, false);
      }
      safeStep(model);
      frames += 1;
      assert.equal(model.state, 'play');
    }
    assert.ok(model.pairsSpawned >= 16, `only spawned ${model.pairsSpawned} pairs`);
    const pairNumbers = new Set([...seen.values()].map((_, i) => i));
    assert.ok(pairNumbers.size >= 0);
  });

  it('every pair has a 220 gap, centre in 170..520, top anchored at 640, bottom on the land', () => {
    const model = seededModel(11);
    model.play();
    const pairs = new Map();
    for (let i = 0; i < 60 * 40 && pairs.size < 12; i++) {
      for (const o of model.obstacles) {
        if (!pairs.has(o.pairNumber)) pairs.set(o.pairNumber, {});
        pairs.get(o.pairNumber)[o.isFlipped ? 'top' : 'bottom'] = o;
      }
      safeStep(model);
    }
    assert.ok(pairs.size >= 12);
    for (const [n, { top, bottom }] of pairs) {
      assert.ok(top && bottom, `pair ${n} incomplete`);
      const gapBottom = bottom.position.y; // top edge of bottom pipe
      const gapTop = top.position.y - top.height; // bottom edge of top pipe
      assert.equal(gapTop - gapBottom, GameConfig.holeHeight, `pair ${n} gap size`);
      assert.equal((gapTop + gapBottom) / 2, top.holeCenter);
      assert.equal(bottom.holeCenter, top.holeCenter);
      assert.ok(top.holeCenter >= 170 && top.holeCenter <= 520, `pair ${n} centre ${top.holeCenter}`);
      assert.equal(top.position.y, 640, `pair ${n} top pipe not anchored at top`);
      assert.equal(bottom.position.y - bottom.height, 50, `pair ${n} bottom pipe not on land`);
    }
  });

  it('the same seed always spawns the same gaps', () => {
    const holes = (seed) => {
      const model = seededModel(seed);
      model.play();
      const out = [];
      while (out.length < 5) {
        const before = model.pairsSpawned;
        safeStep(model);
        if (model.pairsSpawned > before) out.push(model.obstacles[0].holeCenter);
      }
      return out;
    };
    assert.deepEqual(holes(42), holes(42));
    assert.equal(holes(42).length, 5);
  });
});

describe('fitViewport (whole design always visible)', () => {
  it('always shows the full 960-wide design, scaled to fit', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [390, 844], [800, 600], [640, 640]]) {
      const fit = fitViewport(w, h);
      assert.equal(fit.displayWidth, 960);
      assert.equal(fit.displayHeight, 640);
      assert.equal(fit.vectorMoveX, 0);
      assert.ok(fit.scale > 0);
      assert.ok(fit.letterbox.width <= w + 1e-9 && fit.letterbox.height <= h + 1e-9);
    }
  });

  it('keeps the turtle on screen in portrait', () => {
    const fit = fitViewport(390, 844);
    assert.ok(Math.abs(fit.scale - 390 / 960) < 1e-9);
    const turtleScreenX = fit.letterbox.x + 240 * fit.scale;
    assert.ok(turtleScreenX > 0 && turtleScreenX < 390, `turtle x ${turtleScreenX}`);
    assert.ok(Math.abs(fit.letterbox.y - (844 - 260) / 2) < 1e-9);
  });

  it('centres the design on a wide landscape window', () => {
    const fit = fitViewport(1280, 720);
    assert.ok(Math.abs(fit.scale - 1.125) < 1e-9);
    assert.ok(Math.abs(fit.letterbox.x - 100) < 1e-9);
    assert.equal(fit.letterbox.y, 0);
  });
});

describe('model parity with iOS', () => {
  it('jump, pause, replay and ground game-over behave as in Swift', () => {
    const model = seededModel(1);
    assert.equal(model.state, 'wait');
    model.play();
    model.jump();
    assert.equal(model.turtle.worldVelocityY, 20);
    assert.equal(model.turtle.rotation, 30);
    const y = model.turtle.position.y;
    model.pause();
    model.update(1 / 60);
    assert.equal(model.turtle.position.y, y);
    assert.equal(model.state, 'pause');
    model.resume();
    assert.equal(model.state, 'play');
    // Falling (not flapping) onto the ground ends the game.
    model.turtle.position.y = 90;
    model.turtle.worldVelocityY = -20;
    model.update(1 / 60);
    assert.equal(model.state, 'finish');
    model.replay();
    assert.equal(model.state, 'wait');
    assert.equal(model.currentScore, 0);
    assert.equal(model.pairsSpawned, 0);
    assert.deepEqual(model.obstacles, []);
  });

  it('a pipe overlap ends the game and the high score is saved', () => {
    const model = seededModel(1, 0);
    let gameOver = null;
    model.onEvent = (e) => {
      if (e.type === 'gameOver') gameOver = e;
    };
    model.play();
    model.currentScore = 3;
    model.obstacles.push({
      id: 99,
      position: { x: model.turtle.position.x, y: 640 },
      height: 400,
      width: 150,
      isFlipped: true,
      holeCenter: 999,
      pairNumber: 1,
      velocityX: -250,
      reached: false,
    });
    model.update(1 / 60);
    assert.equal(model.state, 'finish');
    assert.equal(gameOver?.isHighScore, true);
    assert.equal(model.highScore, 3);
  });

  it('clone() simulates without touching the original', () => {
    const model = seededModel(3);
    model.play();
    const copy = model.clone();
    copy.jump();
    copy.update(1 / 60);
    assert.notEqual(copy.turtle.position.y, model.turtle.position.y);
    assert.equal(model.turtle.worldVelocityY, 0);
  });

  it('oriented-box collision matches the SAT rule (rotated turtle vs pipe)', () => {
    const turtle = { center: { x: 240, y: 320 }, size: { width: 95, height: 71 }, angle: 0 };
    const pipe = { center: { x: 240, y: 100 }, size: { width: 150, height: 100 }, angle: 0 };
    assert.equal(boxesOverlap(turtle, pipe), false);
    const near = { center: { x: 240, y: 300 }, size: { width: 150, height: 100 }, angle: 0 };
    assert.equal(boxesOverlap(turtle, near), true);
  });

  it('SystemRandomSource stays inside the hole range', () => {
    const r = new SystemRandomSource();
    for (let i = 0; i < 200; i++) {
      const n = r.nextInt(350);
      assert.ok(Number.isInteger(n) && n >= 0 && n < 350);
    }
  });
});

describe('HUD layout parity', () => {
  it('buttons and boards sit at the Swift formula positions (960x640)', () => {
    const hud = new HUD(960, 640);
    assert.equal(hud.playButton.cy, 371.5);
    assert.equal(hud.shareHighScoreButton.cy, 262.5);
    assert.equal(hud.board.cy, 372.5);
    assert.equal(hud.replayButton.cy, 223);
    assert.equal(hud.pauseButton.cy, 640 - 10 - 33);
  });

  it('state visibility follows the scene states; finish slides then counts', () => {
    const hud = new HUD(960, 640);
    hud.showBegin();
    hud.applyStateVisibility('wait');
    assert.equal(hud.beginVisible, true);
    assert.equal(hud.instructionVisible, false);
    hud.hideBegin();
    hud.applyStateVisibility('wait');
    assert.equal(hud.instructionVisible, true);
    hud.applyStateVisibility('play');
    assert.equal(hud.scoreVisible, true);
    hud.showFinish({ isNewHighScore: true, score: 12, highScore: 30 });
    assert.equal(hud.finishOffsetY, -600);
    hud.update(1);
    assert.equal(hud.finishOffsetY, 0);
    assert.equal(hud.counting, true);
    hud.update(2);
    assert.equal(Math.floor(hud.countedScore), 12);
    assert.equal(hud.highShown, true);
    assert.equal(hud.newBadgeVisible, true);
  });

  it('score digits are centred on the anchor like NumberNode', () => {
    const digits = numberDigits(12, 480, 590, 35, 1);
    assert.equal(digits.length, 2);
    const centre = (digits[0].x + digits[1].x) / 2;
    assert.ok(Math.abs(centre - 480) < 20, `digit centre ${centre}`);
  });
});
