// Set at module evaluation: the inline watchdog in index.html shows the
// error overlay only if this flag is still unset (module failed to load).
globalThis.__flappyGameScriptLoaded = true;

// FlappyTurtleWeb entry point: builds the model/controller, mirrors
// model state with sprites every frame (like GameScene), and turns
// pointer/keyboard input into controller requests. WebGL is the
// primary renderer; if no WebGL context can be created (or the
// context is lost), the game falls back to Canvas 2D automatically.
//
// The iOS moving-gap feature is intentionally absent: see model.js.
// Launch options mirror LaunchConfig (?scene, ?seed, ?score, ?highscore,
// ?advance, ?freeze, ?mute, ?autopilot, ?isolated).
import {
  GameModel,
  GameConfig,
  viewportForAspect,
  fitViewport,
  SeededRandomSource,
  SystemRandomSource,
  InMemoryHighScoreStore,
  LocalStorageHighScoreStore,
  Autopilot,
} from './model.js';
import { FRAMES, ATLAS_SIZE, TURTLE_FRAMES } from './atlas.js';
import { WebGLRenderer } from './renderer.js';
import { createFallbackRenderer } from './fallback.js';
import { HUD, numberDigits } from './hud.js';
import { SoundPlayer } from './audio.js';

const SHARE_TEXT = Object.freeze({
  title: 'Flappy Turtle (iOS/Android) app',
  currentScoreCaption: "Wow, it's unbelievable, defeat my score, if you can",
  highScoreCaption: 'Can you defeat my score',
  currentScoreDescription: (score) => `I just scored ${score} in Flappy Turtle`,
  highScoreDescription: (score) => `My best score is ${score} in Flappy Turtle`,
  link: 'https://apps.facebook.com/flappyturtle',
});

function flag(value) {
  if (value === null || value === undefined) return false;
  return !['0', 'false', 'no'].includes(String(value).toLowerCase());
}

function parseLaunchConfig(params) {
  const scene = params.get('scene');
  return {
    scene: ['menu', 'ready', 'playing', 'paused', 'gameover'].includes(scene) ? scene : null,
    seed: params.has('seed') ? Number(params.get('seed')) : null,
    score: params.has('score') ? Number(params.get('score')) : null,
    highScore: params.has('highscore') ? Number(params.get('highscore')) : null,
    advance: params.has('advance') ? Number(params.get('advance')) : null,
    freeze: flag(params.get('freeze')),
    autopilot: flag(params.get('autopilot')),
    mute: flag(params.get('mute')),
    isolated: flag(params.get('isolated')),
    // ?renderer=2d forces the Canvas 2D fallback; anything else tries WebGL first.
    renderer: ['2d', 'canvas', 'canvas2d'].includes((params.get('renderer') || '').toLowerCase()) ? '2d' : 'webgl',
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        await img.decode();
      } catch {
        // decode() failure is non-fatal; the texture upload still works.
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

class GameController {
  constructor(model, sound, onReplay, onShare) {
    this.model = model;
    this.sound = sound;
    this.onReplay = onReplay;
    this.onShare = onShare;
    this.onModelEvent = null;
    model.onEvent = (event) => {
      if (event.type === 'scored') this.sound.play('pass');
      if (event.type === 'gameOver') this.sound.play('die');
      this.onModelEvent?.(event);
    };
  }

  handle(request) {
    const model = this.model;
    switch (request) {
      case 'jump':
        if (model.state !== 'play' && model.state !== 'wait') return;
        if (model.state === 'wait') model.play();
        model.jump();
        this.sound.play('jump');
        break;
      case 'pause':
        this.sound.play('click');
        if (model.state === 'play') model.pause();
        break;
      case 'resume':
        if (model.state === 'pause') model.resume();
        break;
      case 'replay':
        this.sound.play('click');
        if (model.state === 'finish') model.replay();
        this.onReplay?.();
        break;
      case 'newHighScore':
        this.sound.play('highScore');
        break;
      case 'start':
        this.sound.play('click');
        break;
      case 'shareCurrentScore':
        this.sound.play('click');
        this.onShare?.(SHARE_TEXT.title, SHARE_TEXT.currentScoreCaption, SHARE_TEXT.currentScoreDescription(model.currentScore), SHARE_TEXT.link);
        break;
      case 'shareHighScore':
        this.sound.play('click');
        this.onShare?.(SHARE_TEXT.title, SHARE_TEXT.highScoreCaption, SHARE_TEXT.highScoreDescription(model.highScore), SHARE_TEXT.link);
        break;
      default:
        break;
    }
  }
}

class GameApp {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    this.isFrozen = false;
    this.isAutopilotEnabled = false;
    this.flapTime = 0;
    this.lastTime = null;
    this.shakeTime = Infinity;
    this.flashTime = Infinity;
    this.binhTime = Infinity;
    this.trackedPointerId = null;
    this.selectedButton = null;
    this.isTouching = false;
    this.letterbox = { x: 0, y: 0, width: 0, height: 0, scale: 1 };
    this.viewport = viewportForAspect(GameConfig.maxDisplayAspect);
    this.lastStatus = '';
  }

  async boot() {
    const [atlasImage, bgImage, obstacleImage] = await Promise.all([
      loadImage('assets/game.png'),
      loadImage('assets/bg.jpg'),
      loadImage('assets/obstacle.png'),
    ]);
    this.images = { atlas: atlasImage, bg: bgImage, obstacle: obstacleImage };
    this.createRenderer();

    const cfg = this.config;
    const random = cfg.seed !== null && !Number.isNaN(cfg.seed)
      ? new SeededRandomSource(cfg.seed >>> 0)
      : new SystemRandomSource();
    const isolated = cfg.isolated || cfg.highScore !== null;
    const store = isolated
      ? new InMemoryHighScoreStore(cfg.highScore ?? 0)
      : new LocalStorageHighScoreStore();
    this.sound = new SoundPlayer({ muted: cfg.mute });
    const model = new GameModel({ random, store });
    this.model = model;
    this.controller = new GameController(
      model,
      this.sound,
      () => this.onReplay(),
      (title, caption, description, link) => this.share(title, caption, description, link),
    );
    this.controller.onModelEvent = (event) => {
      if (event.type === 'gameOver') this.onGameOver(event.isHighScore);
    };
    this.hud = new HUD(this.viewport.displayWidth, this.viewport.displayHeight);
    this.hud.onNewHighScore = () => this.controller.handle('newHighScore');
    this.hud.showBegin();
    this.applyLaunchConfig();
    this.resize();
    this.bindCanvasInput();
    this.bindGlobalInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  // WebGL first; if no context can be created, fall back to Canvas 2D
  // on the same canvas instead of showing a fatal error, so the game
  // still starts in browsers with WebGL disabled or blocklisted.
  createRenderer() {
    if (this.config.renderer === '2d') {
      this.installFallback();
      return;
    }
    try {
      const renderer = new WebGLRenderer(this.canvas);
      for (const [name, image] of Object.entries(this.images)) {
        renderer.addTexture(name, image);
      }
      this.renderer = renderer;
      this.rendererKind = 'webgl';
      this.canvas.dataset.renderer = 'webgl';
    } catch (err) {
      console.warn('WebGL unavailable, using Canvas 2D fallback.', err);
      this.installFallback();
    }
  }

  installFallback() {
    // Swaps in a fresh canvas if this one is locked to WebGL mode
    // (e.g. a WebGL context was created but proved unusable), so the
    // fallback can actually get a 2D context. The caller rebinds input
    // to this.canvas afterwards where needed.
    const { renderer, canvas } = createFallbackRenderer(this.canvas);
    this.canvas = canvas;
    for (const [name, image] of Object.entries(this.images)) {
      renderer.addTexture(name, image);
    }
    this.renderer = renderer;
    this.rendererKind = 'canvas2d';
    this.canvas.dataset.renderer = 'canvas2d';
  }

  // A canvas that lost its WebGL context is locked to WebGL mode, so a
  // 2D context cannot be taken from it. installFallback swaps in a
  // fresh canvas element and play continues with the fallback.
  switchToFallback() {
    if (this.rendererKind === 'canvas2d') return;
    console.warn('WebGL context lost, switching to Canvas 2D fallback.');
    this.installFallback();
    const error = document.getElementById('webgl-error');
    if (error) error.hidden = true;
    this.resize();
    this.bindCanvasInput();
  }

  applyLaunchConfig() {
    const cfg = this.config;
    const controller = this.controller;
    const model = this.model;
    const effectiveAdvance = (scene) => cfg.advance ?? (scene === 'playing' || scene === 'paused' ? 3.0 : 0);
    switch (cfg.scene) {
      case 'ready':
        this.hud.hideBegin();
        break;
      case 'playing':
      case 'paused': {
        this.hud.hideBegin();
        controller.handle('jump');
        Autopilot.run(controller, effectiveAdvance(cfg.scene));
        if (cfg.scene === 'paused') controller.handle('pause');
        break;
      }
      case 'gameover': {
        this.hud.hideBegin();
        if (effectiveAdvance('gameover') > 0) {
          controller.handle('jump');
          Autopilot.run(controller, effectiveAdvance('gameover'));
        }
        if (model.state === 'wait') model.play();
        if (cfg.score !== null) model.currentScore = cfg.score;
        if (model.state !== 'finish') model.gameOver();
        for (let i = 0; i < 90; i++) model.update(1 / 60);
        this.hud.completeFinishImmediately();
        break;
      }
      default:
        break;
    }
    if (cfg.score !== null && cfg.scene !== 'gameover') {
      model.currentScore = cfg.score;
    }
    this.hud.applyStateVisibility(model.state);
    this.isAutopilotEnabled = cfg.autopilot;
    this.isFrozen = cfg.freeze;
    if (cfg.freeze) {
      this.shakeTime = Infinity;
      this.flashTime = Infinity;
      this.binhTime = Infinity;
    }
  }

  onReplay() {
    this.hud.hideFinish();
    this.hud.hideBegin();
    this.shakeTime = Infinity;
    this.flashTime = Infinity;
    this.binhTime = Infinity;
    this.hud.applyStateVisibility(this.model.state);
  }

  onGameOver(isHighScore) {
    this.hud.showFinish({ isNewHighScore: isHighScore, score: this.model.currentScore, highScore: this.model.highScore });
    this.shakeTime = 0;
    this.flashTime = 0;
    this.binhTime = 0;
  }

  async share(title, caption, description, link) {
    const text = `${caption} — ${description}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: link });
        return;
      } catch {
        // Share sheet dismissed or unavailable: fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      this.showToast('Score copied to clipboard.');
    } catch {
      this.showToast(text);
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 3000);
  }

  resize() {
    const fit = fitViewport(window.innerWidth, window.innerHeight);
    this.viewport = {
      displayWidth: fit.displayWidth,
      displayHeight: fit.displayHeight,
      vectorMoveX: fit.vectorMoveX,
    };
    this.letterbox = fit.letterbox;
    if (this.hud) this.hud.layout(fit.displayWidth, GameConfig.designHeight);
    if (this.renderer) this.updateFrameGeometry(0, 0);
  }

  updateFrameGeometry(offsetX, offsetY) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { x, y, width, height } = this.letterbox;
    this.renderer.setFrame({
      canvasWidth: Math.round(window.innerWidth * dpr),
      canvasHeight: Math.round(window.innerHeight * dpr),
      // GL viewport origin is bottom-left; the letterbox is centred, so
      // the bottom offset equals the top offset in CSS pixels.
      rect: {
        x: Math.round(x * dpr),
        y: Math.round(y * dpr),
        width: Math.round(width * dpr),
        height: Math.round(height * dpr),
      },
      displayWidth: this.viewport.displayWidth,
      displayHeight: GameConfig.designHeight,
      offsetX,
      offsetY,
    });
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    // Boot succeeded and the loop is running: make sure no stale error
    // overlay (e.g. from the slow-load watchdog) covers the game.
    if (!this._overlayCleared) {
      this._overlayCleared = true;
      const error = document.getElementById('webgl-error');
      if (error) error.hidden = true;
    }
    let dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.2) dt = 1 / 60;
    if (!this.isFrozen) {
      if (this.isAutopilotEnabled && this.model.state === 'play' && Autopilot.shouldJump(this.model)) {
        this.controller.handle('jump');
      }
      this.model.update(dt);
      this.hud.update(dt);
      this.flapTime += dt;
      this.shakeTime += dt;
      this.flashTime += dt;
      this.binhTime += dt;
    }
    this.hud.applyStateVisibility(this.model.state);
    this.render();
    this.updateStatus();
  }

  drawAtlasSprite(sprite, tint = [1, 1, 1, 1]) {
    const frame = FRAMES[sprite.frame];
    const uv = this.renderer.uvForFrame(frame, ATLAS_SIZE.width, ATLAS_SIZE.height);
    this.renderer.drawQuad({
      tex: 'atlas',
      cx: sprite.cx,
      cy: sprite.cy,
      w: sprite.width,
      h: sprite.height,
      tint,
      ...uv,
    });
  }

  drawButton(button) {
    const pressed = this.hud.pressedButtonId === button.id;
    this.drawAtlasSprite({ frame: pressed ? button.selected : button.normal, cx: button.cx, cy: button.cy, width: button.width, height: button.height });
  }

  render() {
    const model = this.model;
    const hud = this.hud;
    const vectorMoveX = this.viewport.vectorMoveX;
    const displayW = this.viewport.displayWidth;
    const H = GameConfig.designHeight;
    let offsetX = 0;
    let offsetY = 0;
    if (this.shakeTime < 0.2) {
      offsetX = (Math.random() * 2 - 1) * 5;
      offsetY = (Math.random() * 2 - 1) * 5;
    }
    this.updateFrameGeometry(offsetX, offsetY);
    const r = this.renderer;
    r.begin();

    // Background (z 0), anchored left-centre at (0, H/2), size 1150x640.
    r.drawQuad({ tex: 'bg', cx: 575, cy: H / 2, w: 1150, h: 640 });
    // Stars and land: anchored left-centre, no vectorMove offset.
    for (const strip of model.stars) {
      const uv = r.uvForFrame(FRAMES['star.png'], ATLAS_SIZE.width, ATLAS_SIZE.height);
      r.drawQuad({ tex: 'atlas', cx: strip.position.x + 575, cy: strip.position.y, w: 1150, h: 185, ...uv });
    }
    for (const strip of model.lands) {
      const uv = r.uvForFrame(FRAMES['land.png'], ATLAS_SIZE.width, ATLAS_SIZE.height);
      r.drawQuad({ tex: 'atlas', cx: strip.position.x + 575, cy: strip.position.y, w: 1150, h: 50, ...uv });
    }
    // Obstacles: the pipe texture shows its top `height` rows. The top
    // pipe is flipped vertically, so its gap edge is the texture's top.
    for (const obstacle of model.obstacles) {
      const cx = obstacle.position.x + vectorMoveX;
      const fraction = obstacle.height / GameConfig.obstacleTextureHeight;
      if (obstacle.isFlipped) {
        r.drawQuad({
          tex: 'obstacle',
          cx,
          cy: H - obstacle.height / 2,
          w: GameConfig.obstacleWidth,
          h: obstacle.height,
          uLeft: 0,
          uRight: 1,
          vTop: fraction,
          vBottom: 0,
        });
      } else {
        r.drawQuad({
          tex: 'obstacle',
          cx,
          cy: GameConfig.landHeight + obstacle.height / 2,
          w: GameConfig.obstacleWidth,
          h: obstacle.height,
          uLeft: 0,
          uRight: 1,
          vTop: 0,
          vBottom: fraction,
        });
      }
    }
    // Turtle: flap frames cycle 0.2 s each; each frame keeps its own size.
    const frameName = TURTLE_FRAMES[Math.floor(this.flapTime / 0.2) % TURTLE_FRAMES.length];
    const turtleFrame = FRAMES[frameName];
    const turtleUV = r.uvForFrame(turtleFrame, ATLAS_SIZE.width, ATLAS_SIZE.height);
    r.drawQuad({
      tex: 'atlas',
      cx: model.turtle.position.x + vectorMoveX,
      cy: model.turtle.position.y,
      w: turtleFrame.w,
      h: turtleFrame.h,
      rotationDeg: model.turtle.rotation,
      ...turtleUV,
    });
    // Game-over effects: "binh" burst, then screen shake / white flash.
    if (this.binhTime < 0.1) {
      const uv = r.uvForFrame(FRAMES['binh.png'], ATLAS_SIZE.width, ATLAS_SIZE.height);
      r.drawQuad({
        tex: 'atlas',
        cx: model.turtle.position.x + vectorMoveX - 48,
        cy: model.turtle.position.y,
        w: 96,
        h: 90,
        rotationDeg: -model.turtle.rotation,
        tint: [1, 1, 1, 1 - this.binhTime / 0.1],
        ...uv,
      });
    }
    if (this.flashTime < 0.1) {
      const alpha = this.flashTime < 0.05 ? this.flashTime / 0.05 : 1 - (this.flashTime - 0.05) / 0.05;
      r.drawQuad({ tex: 'white', cx: displayW / 2, cy: H / 2, w: displayW, h: H, tint: [1, 1, 1, alpha] });
    }

    // HUD (top layer).
    if (hud.pauseVisible) {
      r.drawQuad({ tex: 'white', cx: displayW / 2, cy: H / 2, w: displayW, h: H, tint: [0, 0, 0, 180 / 255] });
      this.drawAtlasSprite(hud.pauseText);
    }
    if (hud.beginVisible) {
      this.drawAtlasSprite(hud.logo);
    }
    if (hud.instructionVisible) {
      this.drawAtlasSprite(hud.ready);
      this.drawAtlasSprite(hud.instruction);
    }
    if (hud.scoreVisible) {
      for (const digit of numberDigits(model.currentScore, displayW / 2, H - 50, 35, 1)) {
        this.drawAtlasSprite({ frame: digit.frame, cx: digit.x, cy: digit.y, width: digit.width, height: digit.height });
      }
    }
    if (hud.pauseButtonVisible) this.drawButton(hud.pauseButton);
    if (hud.playVisible) this.drawButton(hud.playButton);
    if (hud.shareHighScoreVisible) this.drawButton(hud.shareHighScoreButton);
    if (hud.finishVisible) {
      const oy = hud.finishOffsetY;
      this.drawAtlasSprite({ ...hud.gameOverText, cy: hud.gameOverText.cy + oy });
      this.drawAtlasSprite({ ...hud.board, cy: hud.board.cy + oy });
      for (const digit of hud.currentScoreDigits()) {
        this.drawAtlasSprite({ frame: digit.frame, cx: digit.x, cy: digit.y, width: digit.width, height: digit.height });
      }
      for (const digit of hud.highScoreDigits()) {
        this.drawAtlasSprite({ frame: digit.frame, cx: digit.x, cy: digit.y, width: digit.width, height: digit.height });
      }
      if (hud.newBadgeVisible) {
        this.drawAtlasSprite({
          frame: 'board/new.png',
          cx: hud.board.cx + hud.badgeRel.x,
          cy: hud.board.cy + oy + hud.badgeRel.y,
          width: 59,
          height: 28,
        });
      }
      this.drawButton({ ...hud.replayButton, cy: hud.replayButton.cy + oy });
      this.drawButton({ ...hud.shareScoreButton, cy: hud.shareScoreButton.cy + oy });
    }
    r.end();
  }

  updateStatus() {
    const model = this.model;
    const label = {
      wait: this.hud.beginVisible ? 'Menu. Flappy Turtle.' : 'Get ready. Tap or press Space to flap.',
      play: `Playing. Score ${model.currentScore}.`,
      pause: `Paused. Score ${model.currentScore}.`,
      finish: `Game over. Score ${model.currentScore}. Best ${model.highScore}.`,
    }[model.state];
    if (label !== this.lastStatus) {
      this.lastStatus = label;
      const status = document.getElementById('status');
      if (status) status.textContent = label;
      this.canvas.setAttribute('aria-label', label);
    }
    const hint = document.getElementById('hint');
    if (hint) {
      const text = {
        wait: this.hud.beginVisible ? 'Tap Play, or press Enter' : 'Click, tap, or press Space to flap',
        play: 'Space / click to flap · P to pause · M to mute',
        pause: 'Tap, or press P, to resume',
        finish: 'Press R, or tap Replay, to play again',
      }[model.state];
      if (hint.textContent !== text) hint.textContent = text;
    }
  }

  toDisplayCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const lb = this.letterbox;
    return {
      x: ((px - lb.x) / lb.scale),
      y: ((lb.y + lb.height - py) / lb.scale),
    };
  }

  effectiveButtonRect(button) {
    let cy = button.cy;
    if (this.hud.finishVisible && (button.id === 'ft.replay' || button.id === 'ft.shareScore')) {
      cy += this.hud.finishOffsetY;
    }
    return { ...button, cy };
  }

  hitButtonAt(x, y) {
    for (const button of this.hud.buttons) {
      if (!this.hud.isButtonVisible(button)) continue;
      const rect = this.effectiveButtonRect(button);
      if (Math.abs(x - rect.cx) <= rect.width / 2 && Math.abs(y - rect.cy) <= rect.height / 2) {
        return button;
      }
    }
    return null;
  }

  buttonAction(button) {
    switch (button.id) {
      case 'ft.pause':
        this.controller.handle('pause');
        break;
      case 'ft.play':
        this.controller.handle('start');
        this.hud.hideBegin();
        break;
      case 'ft.shareHighScore':
        this.controller.handle('shareHighScore');
        break;
      case 'ft.replay':
        this.controller.handle('replay');
        break;
      case 'ft.shareScore':
        this.controller.handle('shareCurrentScore');
        break;
      default:
        break;
    }
    this.hud.applyStateVisibility(this.model.state);
  }

  bindCanvasInput() {
    const canvas = this.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { x, y } = this.toDisplayCoords(e.clientX, e.clientY);
      const button = this.hitButtonAt(x, y);
      if (button) {
        this.trackedPointerId = e.pointerId;
        this.selectedButton = button;
        this.hud.pressedButtonId = button.id;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture is best-effort.
        }
        return;
      }
      if (this.hud.beginVisible) return;
      if (!this.isTouching) {
        this.isTouching = true;
        this.controller.handle('jump');
      }
      // The original resumes on any unclaimed touch (pause overlay tap).
      this.controller.handle('resume');
      this.hud.applyStateVisibility(this.model.state);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.trackedPointerId) return;
      const { x, y } = this.toDisplayCoords(e.clientX, e.clientY);
      const button = this.hitButtonAt(x, y);
      this.selectedButton = button;
      this.hud.pressedButtonId = button ? button.id : null;
    });
    const endPointer = (e, cancelled) => {
      if (e.pointerId === this.trackedPointerId) {
        const button = this.selectedButton;
        this.trackedPointerId = null;
        this.selectedButton = null;
        this.hud.pressedButtonId = null;
        if (!cancelled && button && this.hud.isButtonVisible(button)) {
          this.buttonAction(button);
        }
        return;
      }
      this.isTouching = false;
    };
    canvas.addEventListener('pointerup', (e) => endPointer(e, false));
    canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.switchToFallback();
    });
  }

  bindGlobalInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const state = this.model.state;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        if (this.hud.playVisible) {
          this.buttonAction(this.hud.playButton);
        } else if (state === 'pause') {
          this.controller.handle('resume');
        } else if (state === 'play' || state === 'wait') {
          this.controller.handle('jump');
        }
        this.hud.applyStateVisibility(this.model.state);
      } else if (e.code === 'Enter') {
        if (this.hud.playVisible) {
          this.buttonAction(this.hud.playButton);
        } else if (state === 'finish') {
          this.controller.handle('replay');
          this.hud.applyStateVisibility(this.model.state);
        } else if (state === 'pause') {
          this.controller.handle('resume');
          this.hud.applyStateVisibility(this.model.state);
        }
      } else if (e.code === 'KeyP' || e.code === 'Escape') {
        if (state === 'play') this.controller.handle('pause');
        else if (state === 'pause') this.controller.handle('resume');
        this.hud.applyStateVisibility(this.model.state);
      } else if (e.code === 'KeyR') {
        if (state === 'finish') {
          this.controller.handle('replay');
          this.hud.applyStateVisibility(this.model.state);
        }
      } else if (e.code === 'KeyM') {
        this.sound.isMuted = !this.sound.isMuted;
        this.showToast(this.sound.isMuted ? 'Sound off.' : 'Sound on.');
      }
    });

    window.addEventListener('resize', () => this.resize());
  }
}

function showFatal(message) {
  const error = document.getElementById('webgl-error');
  if (!error) return;
  const detail = document.getElementById('webgl-error-detail');
  if (detail) detail.textContent = message;
  error.hidden = false;
}

const retryButton = document.getElementById('retry-button');
if (retryButton) {
  retryButton.addEventListener('click', () => window.location.reload());
}

const canvas = document.getElementById('game');
const app = new GameApp(canvas, parseLaunchConfig(new URLSearchParams(window.location.search)));
app.boot().catch((err) => {
  console.error(err);
  showFatal(err.message || 'Flappy Turtle could not start.');
});

