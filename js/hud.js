// HUD layout and state: a port of HUDNode (Swift/SpriteKit). Every
// position is computed with the original formulas against the display
// size (not the 960 design width). The renderer draws the sprites; this
// module only decides which sprites are visible, where, and in which
// pressed/counting/slide state.
import { FRAMES } from './atlas.js';
import { GameConfig } from './model.js';

export function frameSize(name) {
  const f = FRAMES[name];
  return { width: f.w, height: f.h };
}

// Digit layout: port of NumberNode.show. Returns digit sprites centred
// at (x, anchorY) with the whole row centred on anchorX.
export function numberDigits(value, anchorX, anchorY, spacing, digitScale) {
  const digits = [];
  let posX = 0;
  let newPosX = 0;
  for (const ch of String(value)) {
    posX += spacing;
    const frame = `number/${ch}.png`;
    const size = frameSize(frame);
    digits.push({ frame, x: posX, y: 0, width: size.width * digitScale, height: size.height * digitScale });
    newPosX = posX + size.width / 2;
  }
  const nodeX = anchorX - newPosX / 2;
  return digits.map((d) => ({ ...d, x: nodeX + d.x, y: anchorY }));
}

export class HUD {
  constructor(displayWidth, displayHeight) {
    this.onNewHighScore = null;
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.buttons = [];
    this.beginVisible = false;
    this.instructionVisible = false;
    this.pauseVisible = false;
    this.finishVisible = false;
    this.mainVisible = false;
    this.scoreVisible = false;
    this.pauseButtonVisible = false;
    this.playVisible = false;
    this.shareHighScoreVisible = false;
    this.replayVisible = false;
    this.shareScoreVisible = false;
    this.newBadgeVisible = false;
    this.highShown = false;
    this.finishOffsetY = 0;
    this.slideTime = 0;
    this.counting = false;
    this.countedScore = 0;
    this.isNewHighScore = false;
    this.finalScore = 0;
    this.finalHighScore = 0;
    this.pressedButtonId = null;
    this.layout(displayWidth, displayHeight);
    this.hideMain();
    this.hideBegin();
    this.hideInstruction();
    this.hidePause();
    this.hideFinish();
  }

  layout(width, height) {
    this.displayWidth = width;
    this.displayHeight = height;
    const size = width;
    const h = height;
    const button = (id, normal, selected, cx, cy) => {
      const s = frameSize(normal);
      return { id, normal, selected, cx, cy, width: s.width, height: s.height };
    };
    const pausePadding = 10;
    const pauseSize = frameSize('board/pause-1.png');
    const pauseButton = button(
      'ft.pause',
      'board/pause-1.png',
      'board/pause-2.png',
      pausePadding + pauseSize.width / 2,
      h - pausePadding - pauseSize.height / 2,
    );
    const logoSize = frameSize('board/game-logo.png');
    const playSize = frameSize('board/play-1.png');
    const shareSize = frameSize('board/fb-1.png');
    const padding = 20;
    let mainY = 500;
    const logo = { frame: 'board/game-logo.png', cx: size / 2, cy: mainY, width: logoSize.width, height: logoSize.height };
    mainY -= logoSize.height / 2 + padding;
    mainY -= playSize.height / 2;
    const playButton = button('ft.play', 'board/play-1.png', 'board/play-2.png', size / 2, mainY);
    mainY -= playSize.height / 2 + padding;
    mainY -= shareSize.height / 2;
    const shareHighScoreButton = button('ft.shareHighScore', 'board/fb-1.png', 'board/fb-2.png', size / 2, mainY);

    const readySize = frameSize('board/text-ready.png');
    const instructionSize = frameSize('board/instruction.png');
    let instructionY = 500;
    const ready = { frame: 'board/text-ready.png', cx: size / 2, cy: instructionY, width: readySize.width, height: readySize.height };
    instructionY -= readySize.height / 2 + padding;
    instructionY -= instructionSize.height / 2;
    const instruction = { frame: 'board/instruction.png', cx: size / 2, cy: instructionY, width: instructionSize.width, height: instructionSize.height };

    const pauseTextSize = frameSize('board/text-pause.png');
    const pauseText = { frame: 'board/text-pause.png', cx: size / 2, cy: h / 2, width: pauseTextSize.width, height: pauseTextSize.height };

    const boardSize = frameSize('board/score.png');
    const gameOverSize = frameSize('board/text-game-over.png');
    let finishY = 500;
    const gameOverText = { frame: 'board/text-game-over.png', cx: size / 2, cy: finishY, width: gameOverSize.width, height: gameOverSize.height };
    finishY -= gameOverSize.height / 2 + padding;
    finishY -= boardSize.height / 2;
    const board = { frame: 'board/score.png', cx: size / 2, cy: finishY, width: boardSize.width, height: boardSize.height };
    finishY -= boardSize.height / 2 + padding;
    finishY -= playSize.height / 2;
    const replayButton = button('ft.replay', 'board/play-1.png', 'board/play-2.png', size / 2 - 100, finishY);
    const shareScoreButton = button('ft.shareScore', 'board/fb-1.png', 'board/fb-2.png', size / 2 + 100, finishY);

    const boardPoint = (x, y) => ({ x: x - boardSize.width / 2, y: y - boardSize.height / 2 });
    const badgeRel = boardPoint(boardSize.width - 160, 72);
    const currentRel = boardPoint(boardSize.width - 90, 105);
    const highRel = boardPoint(boardSize.width - 90, 42);

    this.logo = logo;
    this.ready = ready;
    this.instruction = instruction;
    this.pauseText = pauseText;
    this.gameOverText = gameOverText;
    this.board = board;
    this.badgeRel = badgeRel;
    this.currentRel = currentRel;
    this.highRel = highRel;
    // Registration order matches SpriteButton registration in GameScene:
    // pause, play, share-high, replay, share-score. Hit-testing uses it.
    this.buttons = [pauseButton, playButton, shareHighScoreButton, replayButton, shareScoreButton];
    this.pauseButton = pauseButton;
    this.playButton = playButton;
    this.shareHighScoreButton = shareHighScoreButton;
    this.replayButton = replayButton;
    this.shareScoreButton = shareScoreButton;
  }

  buttonById(id) {
    return this.buttons.find((b) => b.id === id);
  }

  isButtonVisible(button) {
    switch (button.id) {
      case 'ft.pause':
        return this.pauseButtonVisible;
      case 'ft.play':
        return this.playVisible;
      case 'ft.shareHighScore':
        return this.shareHighScoreVisible;
      case 'ft.replay':
        return this.replayVisible;
      case 'ft.shareScore':
        return this.shareScoreVisible;
      default:
        return false;
    }
  }

  hitButton(x, y) {
    for (const button of this.buttons) {
      if (!this.isButtonVisible(button)) continue;
      if (Math.abs(x - button.cx) <= button.width / 2 && Math.abs(y - button.cy) <= button.height / 2) {
        return button;
      }
    }
    return null;
  }

  showMain() {
    this.mainVisible = true;
    this.pauseButtonVisible = true;
    this.scoreVisible = true;
  }
  hideMain() {
    this.mainVisible = false;
    this.pauseButtonVisible = false;
    this.scoreVisible = false;
  }
  showBegin() {
    this.beginVisible = true;
    this.playVisible = true;
    this.shareHighScoreVisible = true;
  }
  hideBegin() {
    this.beginVisible = false;
    this.playVisible = false;
    this.shareHighScoreVisible = false;
  }
  showInstruction() {
    this.instructionVisible = true;
  }
  hideInstruction() {
    this.instructionVisible = false;
  }
  showPause() {
    this.pauseVisible = true;
  }
  hidePause() {
    this.pauseVisible = false;
  }

  applyStateVisibility(state) {
    switch (state) {
      case 'play':
        this.hidePause();
        this.hideInstruction();
        this.showMain();
        break;
      case 'pause':
        this.showPause();
        this.hideInstruction();
        this.showMain();
        break;
      case 'wait':
        this.hidePause();
        if (!this.beginVisible) this.showInstruction();
        this.hideMain();
        break;
      case 'finish':
        this.hidePause();
        this.hideInstruction();
        this.hideMain();
        break;
      default:
        break;
    }
  }

  showFinish({ isNewHighScore, score, highScore, animated = true }) {
    this.isNewHighScore = isNewHighScore;
    this.finalScore = score;
    this.finalHighScore = highScore;
    this.finishVisible = true;
    this.replayVisible = true;
    this.shareScoreVisible = true;
    this.newBadgeVisible = false;
    this.highShown = false;
    if (!animated) {
      this.finishOffsetY = 0;
      this.countedScore = score;
      this.counting = false;
      this.showHighScore();
      return;
    }
    this.finishOffsetY = -600;
    this.slideTime = 0;
    this.counting = false;
    this.countedScore = 0;
  }

  hideFinish() {
    this.finishVisible = false;
    this.newBadgeVisible = false;
    this.highShown = false;
    this.replayVisible = false;
    this.shareScoreVisible = false;
    this.finishOffsetY = 0;
    this.slideTime = 0;
    this.counting = false;
    this.countedScore = 0;
  }

  completeFinishImmediately() {
    if (!this.finishVisible) return;
    this.finishOffsetY = 0;
    this.slideTime = 1;
    this.counting = false;
    this.countedScore = this.finalScore;
    this.showHighScore();
  }

  showHighScore() {
    if (this.isNewHighScore) {
      this.onNewHighScore?.();
      this.newBadgeVisible = true;
    }
    this.highShown = true;
  }

  // Finish slide (1 s) then score count-up at 10/s, as in HUDNode.
  update(dt) {
    if (!this.finishVisible) return;
    if (this.slideTime < 1) {
      this.slideTime = Math.min(1, this.slideTime + dt);
      this.finishOffsetY = this.slideTime >= 1 ? 0 : -600 * (1 - this.slideTime);
      if (this.slideTime >= 1) this.counting = true;
      return;
    }
    if (!this.counting) return;
    this.countedScore += GameConfig.scoreCountVelocity * dt;
    if (this.countedScore > this.finalScore) {
      this.countedScore = this.finalScore;
      this.counting = false;
      this.showHighScore();
    }
  }

  currentScoreDigits() {
    const value = this.finishVisible ? Math.floor(this.countedScore) : 0;
    return numberDigits(value, this.board.cx + this.currentRel.x, this.board.cy + this.finishOffsetY + this.currentRel.y, 26, 0.5);
  }

  highScoreDigits() {
    if (!this.highShown) return [];
    return numberDigits(this.finalHighScore, this.board.cx + this.highRel.x, this.board.cy + this.finishOffsetY + this.highRel.y, 26, 0.5);
  }
}
