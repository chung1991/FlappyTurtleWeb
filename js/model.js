// Pure game model: a 1:1 port of GameModel / Entities / Collision /
// RandomSource from the iOS (Swift/SpriteKit) FlappyTurtle, with one
// deliberate difference: the moving-gap feature is REMOVED. In the iOS
// build, pipe pairs from the 10th on moved their gap up and down
// (GapMotion, 50 pt/s, 180 pt band). This web build has no GapMotion at
// all: every pair keeps the gap centre it spawned with for its whole
// life, exactly like pairs 1-9 did on iOS. There is no vertical pipe
// motion anywhere in this file, and no constant or branch for it.
//
// No DOM or WebGL here, so the rules stay unit-testable in Node.

export const GameConfig = Object.freeze({
  designWidth: 960,
  designHeight: 640,
  maxDisplayAspect: 1.5,
  holeHeight: 220,
  holeMin: 170,
  holeMax: 520,
  obstacleSpawnInterval: 2.0,
  obstacleVelocity: -250,
  starVelocity: -20,
  landHeight: 50,
  scoreCountVelocity: 10,
  ptmRatio: 32,
  gravity: -70,
  jumpVelocity: 20,
  maxTranslationPerStep: 2,
  collisionTolerance: 0.02,
  jumpRotation: 30,
  minRotation: -90,
  spinAccelRate: 13,
  spinBaseRate: 150,
  maxSpinVelocity: -500,
  turtleWidth: 95,
  turtleHeight: 71,
  obstacleWidth: 150,
  obstacleTextureHeight: 500,
  landWidth: 1150,
  landHeight: 50,
  starWidth: 1150,
  starHeight: 185,
});

export function groundY() {
  return GameConfig.turtleHeight / 2 + GameConfig.landHeight;
}

// Display geometry, as in Viewport (Swift): fixed 640 height, aspect
// capped at 1.5, gameplay layers centred with vectorMove.
export function viewportForAspect(aspect) {
  const height = GameConfig.designHeight;
  const width = height * aspect;
  return {
    displayWidth: width,
    displayHeight: height,
    vectorMoveX: (width - GameConfig.designWidth) / 2,
  };
}

// Scale the WHOLE 960x640 design to fit the window, centred with black
// bars. Never shrink the visible width below the design: the old
// aspect-capped viewport cropped the playfield on narrow windows, and
// in portrait the turtle (x=240) slid entirely off-screen, making the
// game unplayable. The iOS build always rendered at the 1.5 aspect
// (960 wide); this keeps that rendering on every window shape.
export function fitViewport(winW, winH) {
  const displayWidth = GameConfig.designWidth;
  const displayHeight = GameConfig.designHeight;
  const scale = Math.min(winW / displayWidth, winH / displayHeight);
  const rectW = displayWidth * scale;
  const rectH = displayHeight * scale;
  return {
    displayWidth,
    displayHeight,
    vectorMoveX: 0,
    scale,
    letterbox: {
      x: (winW - rectW) / 2,
      y: (winH - rectH) / 2,
      width: rectW,
      height: rectH,
      scale,
    },
  };
}

// SplitMix64, identical to SeededRandomSource (Swift). BigInt keeps the
// UInt64 wrap-around semantics exact.
export class SeededRandomSource {
  constructor(seed) {
    this.state = BigInt(seed) & 0xffffffffffffffffn;
  }
  next() {
    const mask = 0xffffffffffffffffn;
    this.state = (this.state + 0x9e3779b97f4a7c15n) & mask;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return z ^ (z >> 31n);
  }
  nextInt(upperBound) {
    return Number(this.next() % BigInt(upperBound));
  }
}

export class SystemRandomSource {
  nextInt(upperBound) {
    return Math.floor(Math.random() * upperBound);
  }
}

export class InMemoryHighScoreStore {
  constructor(value = 0) {
    this.value = value;
  }
  load() {
    return this.value;
  }
  save(score) {
    this.value = score;
  }
}

export class LocalStorageHighScoreStore {
  constructor(key = 'flappyTurtle.highScore') {
    this.key = key;
  }
  load() {
    try {
      return Number(globalThis.localStorage?.getItem(this.key) ?? 0) || 0;
    } catch {
      return 0;
    }
  }
  save(score) {
    try {
      globalThis.localStorage?.setItem(this.key, String(score));
    } catch {
      // Private mode / unavailable storage: high score just doesn't persist.
    }
  }
}

function orientedBoxVertices(center, size, angle) {
  const hx = size.width / 2;
  const hy = size.height / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x, y]) => ({
    x: center.x + c * x - s * y,
    y: center.y + s * x + c * y,
  }));
}

// Port of Collision.overlaps: separating-axis test over both boxes'
// edge normals with Box2D's polygon skin tolerance.
export function boxesOverlap(a, b, tolerance = GameConfig.collisionTolerance) {
  const va = orientedBoxVertices(a.center, a.size, a.angle);
  const vb = orientedBoxVertices(b.center, b.size, b.angle);
  return maxSeparation(va, vb) <= tolerance && maxSeparation(vb, va) <= tolerance;
}

function maxSeparation(poly, other) {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const v1 = poly[i];
    const v2 = poly[(i + 1) % poly.length];
    const ex = v2.x - v1.x;
    const ey = v2.y - v1.y;
    const length = Math.hypot(ex, ey);
    const nx = ey / length;
    const ny = -ex / length;
    let s = Infinity;
    for (const p of other) {
      s = Math.min(s, nx * (p.x - v1.x) + ny * (p.y - v1.y));
    }
    best = Math.max(best, s);
  }
  return best;
}

export function turtleBox(turtle) {
  return {
    center: { ...turtle.position },
    size: { width: GameConfig.turtleWidth, height: GameConfig.turtleHeight },
    // Utils::b2Interact converts with 3.14, not pi; keep it for parity.
    angle: (turtle.rotation * 3.14) / 180,
  };
}

export function obstacleCollisionBox(obstacle) {
  return {
    center: { x: obstacle.position.x, y: obstacle.position.y - obstacle.height / 2 },
    size: { width: GameConfig.obstacleWidth, height: obstacle.height },
    angle: 0,
  };
}

function newTurtle() {
  return {
    position: { x: GameConfig.designWidth / 4, y: GameConfig.designHeight / 2 },
    rotation: 0,
    rotationVelocity: 0,
    spinVelocity: -100,
    spinAccel: 0,
    worldVelocityY: 0,
  };
}

export class GameModel {
  constructor({ random = new SystemRandomSource(), store = new LocalStorageHighScoreStore() } = {}) {
    this.random = random;
    this.store = store;
    this.highScore = store.load();
    this.state = 'wait';
    this.turtle = newTurtle();
    this.obstacles = [];
    this.lands = [];
    this.stars = [];
    this.currentScore = 0;
    this.spawnTimer = -1;
    this.nextId = 0;
    this.pairsSpawned = 0;
    this.onEvent = null;
    this.wait();
  }

  // Independent copy for look-ahead (the autopilot). Own random source
  // and store, emits no events, so simulating never affects the game.
  clone() {
    const copy = new GameModel({
      random: new SeededRandomSource(0),
      store: new InMemoryHighScoreStore(this.highScore),
    });
    copy.state = this.state;
    copy.turtle = structuredClone(this.turtle);
    copy.obstacles = structuredClone(this.obstacles);
    copy.lands = structuredClone(this.lands);
    copy.stars = structuredClone(this.stars);
    copy.currentScore = this.currentScore;
    copy.spawnTimer = this.spawnTimer;
    copy.nextId = this.nextId;
    copy.pairsSpawned = this.pairsSpawned;
    copy.onEvent = null;
    return copy;
  }

  wait() {
    this.state = 'wait';
    this.pairsSpawned = 0;
    this.turtle = newTurtle();
    this.createEnvironment();
  }

  play() {
    this.state = 'play';
    this.spawnTimer = GameConfig.obstacleSpawnInterval;
  }

  replay() {
    this.obstacles = [];
    this.lands = [];
    this.stars = [];
    this.currentScore = 0;
    this.wait();
  }

  pause() {
    this.state = 'pause';
  }

  resume() {
    this.state = 'play';
  }

  jump() {
    if (this.turtle.position.y >= GameConfig.designHeight) return;
    this.turtle.worldVelocityY = GameConfig.jumpVelocity;
    this.turtle.rotation = GameConfig.jumpRotation;
    this.turtle.spinVelocity = 0;
    this.turtle.spinAccel = -1;
  }

  gameOver() {
    this.turtle.rotationVelocity = 0;
    this.turtle.rotation = GameConfig.minRotation;
    this.state = 'finish';
    this.onEvent?.({ type: 'gameOver', isHighScore: this.saveHighScore() });
  }

  update(dt) {
    if (this.state === 'pause') return;

    if (this.state !== 'finish') {
      this.scroll(this.lands, GameConfig.obstacleVelocity, GameConfig.landWidth, GameConfig.landHeight / 2, dt);
      this.scroll(
        this.stars,
        GameConfig.starVelocity,
        GameConfig.starWidth,
        GameConfig.designHeight - GameConfig.starHeight / 2,
        dt,
      );
    }

    if (this.state !== 'wait') {
      this.stepTurtle(dt);
    }

    if (this.state !== 'play') return;

    this.spawnTimer -= dt;
    if (this.spawnTimer < 0) {
      this.spawnTimer = GameConfig.obstacleSpawnInterval;
      this.createObstacles();
    }

    let reachedCount = 0;
    for (const obstacle of this.obstacles) {
      // No gap motion: an obstacle's y/height never change after spawn.
      obstacle.position.x += obstacle.velocityX * dt;
      if (obstacle.position.x < -(obstacle.width / 2)) {
        obstacle.velocityX = 0;
      }
      if (obstacle.position.x < this.turtle.position.x && !obstacle.reached) {
        obstacle.reached = true;
        reachedCount += 1;
      }
    }
    if (reachedCount === 2) {
      this.currentScore += 1;
      this.onEvent?.({ type: 'scored', score: this.currentScore });
    }
    this.obstacles = this.obstacles.filter((o) => o.velocityX !== 0);

    if (this.turtle.position.y <= groundY()) {
      this.gameOver();
      return;
    }
    const box = turtleBox(this.turtle);
    if (this.obstacles.some((o) => boxesOverlap(box, obstacleCollisionBox(o)))) {
      this.gameOver();
    }
  }

  stepTurtle(dt) {
    const ptm = GameConfig.ptmRatio;
    const turtle = this.turtle;
    let worldY = turtle.position.y / ptm;
    let v = turtle.worldVelocityY + dt * GameConfig.gravity;
    const translation = dt * v;
    const maxT = GameConfig.maxTranslationPerStep;
    if (translation * translation > maxT * maxT) {
      v *= maxT / Math.abs(translation);
    }
    worldY += dt * v;
    turtle.worldVelocityY = v;

    turtle.rotation += turtle.rotationVelocity * dt;
    turtle.spinAccel += dt * GameConfig.spinAccelRate;
    let rotationToSub = dt * GameConfig.spinBaseRate;
    if (turtle.spinAccel > 0) {
      rotationToSub *= turtle.spinAccel;
    }
    turtle.spinVelocity = Math.max(turtle.spinVelocity - rotationToSub, GameConfig.maxSpinVelocity);
    turtle.rotationVelocity = turtle.spinVelocity;
    if (turtle.rotation < GameConfig.minRotation) {
      turtle.rotation = GameConfig.minRotation;
    }

    turtle.position.y = Math.max(worldY * ptm, groundY());
  }

  scroll(strips, velocity, width, y, dt) {
    for (const strip of strips) {
      strip.position.x += velocity * dt;
    }
    const first = strips[0];
    if (!first) return;
    if (!first.passHead) {
      if (first.position.x < 0) {
        strips.push({ id: this.makeId(), position: { x: first.position.x + width, y }, passHead: false });
        strips[0].passHead = true;
      }
    } else if (first.position.x < -width) {
      strips.shift();
    }
  }

  createObstacles() {
    const hole = this.random.nextInt(GameConfig.holeMax - GameConfig.holeMin) + GameConfig.holeMin;
    const halfHole = GameConfig.holeHeight / 2;
    const upHeight = GameConfig.designHeight - (hole + halfHole);
    const downHeight = hole - halfHole - GameConfig.landHeight;
    const x = GameConfig.designWidth + GameConfig.obstacleWidth / 2;
    this.pairsSpawned += 1;
    // Gap centre is fixed at spawn: holeCenter never changes afterwards.
    this.obstacles.push({
      id: this.makeId(),
      position: { x, y: GameConfig.designHeight },
      height: upHeight,
      width: GameConfig.obstacleWidth,
      isFlipped: true,
      holeCenter: hole,
      pairNumber: this.pairsSpawned,
      velocityX: GameConfig.obstacleVelocity,
      reached: false,
    });
    this.obstacles.push({
      id: this.makeId(),
      position: { x, y: GameConfig.landHeight + downHeight },
      height: downHeight,
      width: GameConfig.obstacleWidth,
      isFlipped: false,
      holeCenter: hole,
      pairNumber: this.pairsSpawned,
      velocityX: GameConfig.obstacleVelocity,
      reached: false,
    });
  }

  createEnvironment() {
    this.lands.push({
      id: this.makeId(),
      position: { x: 0, y: GameConfig.landHeight / 2 },
      passHead: false,
    });
    this.stars.push({
      id: this.makeId(),
      position: { x: 0, y: GameConfig.designHeight - GameConfig.starHeight / 2 },
      passHead: false,
    });
  }

  saveHighScore() {
    if (this.currentScore <= this.highScore) return false;
    this.highScore = this.currentScore;
    this.store.save(this.highScore);
    return true;
  }

  makeId() {
    this.nextId += 1;
    return this.nextId;
  }
}

// Deterministic bot, used only for the ?autopilot / ?advance launch
// options (reaching a mid-game state) — never in normal play. The
// rollout look-ahead the iOS bot needed for moving gaps is gone with
// them: with static gaps the plain rule below is the whole policy.
export const Autopilot = {
  margin: 30,
  shouldJump(model) {
    const turtle = model.turtle;
    if (turtle.worldVelocityY > 0) return false;
    const turtleLeft = turtle.position.x - GameConfig.turtleWidth / 2;
    const next = model.obstacles.find((o) => o.position.x + o.width / 2 > turtleLeft);
    if (!next) {
      return turtle.position.y < GameConfig.designHeight / 2 - Autopilot.margin;
    }
    return turtle.position.y < next.holeCenter - Autopilot.margin;
  },
  run(controller, seconds) {
    const dt = 1 / 60;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps && controller.model.state === 'play'; i++) {
      if (Autopilot.shouldJump(controller.model)) {
        controller.handle('jump');
      }
      controller.model.update(dt);
    }
  },
};
