// Atlas frame rects from game.plist (TexturePacker format 2), sheet
// 2048x1024. Each rect is {x, y, w, h} with a top-left origin, as stored
// in the plist. The renderer converts to texture UVs.
export const ATLAS_SIZE = { width: 2048, height: 1024 };

export const FRAMES = Object.freeze({
  'binh.png': { x: 2, y: 2, w: 96, h: 90 },
  'board/fb-1.png': { x: 100, y: 2, w: 171, h: 89 },
  'board/fb-2.png': { x: 273, y: 2, w: 171, h: 89 },
  'board/game-logo.png': { x: 446, y: 2, w: 521, h: 128 },
  'board/instruction.png': { x: 969, y: 2, w: 353, h: 241 },
  'board/leader-1.png': { x: 1324, y: 2, w: 171, h: 89 },
  'board/leader-2.png': { x: 1497, y: 2, w: 171, h: 89 },
  'board/new.png': { x: 1670, y: 2, w: 59, h: 28 },
  'board/pause-1.png': { x: 1731, y: 2, w: 64, h: 66 },
  'board/pause-2.png': { x: 1797, y: 2, w: 64, h: 66 },
  'board/play-1.png': { x: 1863, y: 2, w: 171, h: 89 },
  'board/play-2.png': { x: 2, y: 245, w: 171, h: 89 },
  'board/score.png': { x: 175, y: 245, w: 419, h: 170 },
  'board/text-game-over.png': { x: 596, y: 245, w: 417, h: 45 },
  'board/text-pause.png': { x: 1015, y: 245, w: 356, h: 68 },
  'board/text-ready.png': { x: 1373, y: 245, w: 391, h: 69 },
  'land.png': { x: 2, y: 417, w: 1150, h: 50 },
  'number/0.png': { x: 1154, y: 417, w: 36, h: 54 },
  'number/1.png': { x: 1192, y: 417, w: 36, h: 54 },
  'number/2.png': { x: 1230, y: 417, w: 36, h: 54 },
  'number/3.png': { x: 1268, y: 417, w: 36, h: 54 },
  'number/4.png': { x: 1306, y: 417, w: 36, h: 54 },
  'number/5.png': { x: 1344, y: 417, w: 36, h: 54 },
  'number/6.png': { x: 1382, y: 417, w: 36, h: 54 },
  'number/7.png': { x: 1420, y: 417, w: 36, h: 54 },
  'number/8.png': { x: 1458, y: 417, w: 36, h: 54 },
  'number/9.png': { x: 1496, y: 417, w: 36, h: 54 },
  'shit.png': { x: 1534, y: 417, w: 50, h: 47 },
  'star.png': { x: 2, y: 473, w: 1150, h: 185 },
  'turtle-1.png': { x: 1154, y: 473, w: 95, h: 71 },
  'turtle-2.png': { x: 1251, y: 473, w: 93, h: 71 },
  'turtle-3.png': { x: 1346, y: 473, w: 95, h: 71 },
  'turtle-4.png': { x: 1443, y: 473, w: 93, h: 74 },
});

export const TURTLE_FRAMES = ['turtle-1.png', 'turtle-2.png', 'turtle-3.png', 'turtle-4.png'];
