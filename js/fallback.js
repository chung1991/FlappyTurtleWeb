// Replace a canvas with a fresh element carrying the same identity
// (id, tab order, role, label). Needed because a canvas that has
// yielded a WebGL context — even a broken one — is locked to WebGL
// mode and `getContext('2d')` on it returns null forever.
export function swapCanvasFor2D(oldCanvas) {
  const doc = oldCanvas.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  const replacement = doc.createElement('canvas');
  replacement.id = oldCanvas.id;
  replacement.tabIndex = oldCanvas.tabIndex;
  replacement.setAttribute('role', oldCanvas.getAttribute?.('role') || 'application');
  const label = oldCanvas.getAttribute?.('aria-label');
  if (label) replacement.setAttribute('aria-label', label);
  if (typeof oldCanvas.replaceWith === 'function') {
    oldCanvas.replaceWith(replacement);
  } else {
    oldCanvas.parentNode?.replaceChild(replacement, oldCanvas);
  }
  return replacement;
}

// Build a Canvas 2D renderer for `canvas`, swapping in a fresh canvas
// first if this one is locked to WebGL mode. Returns { renderer, canvas }
// so the caller can rebind input to the element actually on screen.
// Throws only if no fresh canvas yields a 2D context either.
export function createFallbackRenderer(canvas) {
  try {
    return { renderer: new Canvas2DRenderer(canvas), canvas };
  } catch {
    const replacement = swapCanvasFor2D(canvas);
    return { renderer: new Canvas2DRenderer(replacement), canvas: replacement };
  }
}

// Canvas 2D fallback renderer. Same drawQuad API as WebGLRenderer, so
// the game can run in browsers where no WebGL context can be created
// (GPU blocklisted, WebGL disabled, context lost). WebGL stays the
// primary renderer; this is only used when WebGL is unavailable.
//
// Display coordinates are y-up (origin bottom-left), as in the WebGL
// renderer. The base transform maps them onto the canvas (y-down) and
// into the letterbox: device = (rect.x + x*s, top + (H - y)*s).
// Sprites are drawn with an extra scale(1, -1) so the image's top row
// lands at the top edge of the quad; a flipped pipe (vTop > vBottom)
// skips that flip so its texture top lands at the gap edge.
export class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) {
      throw new Error('Canvas 2D is not available in this browser.');
    }
    this.images = new Map();
    this.fullWidth = 0;
    this.fullHeight = 0;
    this.rect = { x: 0, y: 0, width: 0, height: 0 };
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  addTexture(name, image) {
    this.images.set(name, image);
    return image;
  }

  // `rect` is the letterbox in device pixels, measured from the
  // bottom-left (same convention as the WebGL renderer).
  setFrame({ canvasWidth, canvasHeight, rect, displayWidth, displayHeight, offsetX = 0, offsetY = 0 }) {
    if (this.canvas.width !== canvasWidth) this.canvas.width = canvasWidth;
    if (this.canvas.height !== canvasHeight) this.canvas.height = canvasHeight;
    this.fullWidth = canvasWidth;
    this.fullHeight = canvasHeight;
    this.rect = rect;
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.fullWidth, this.fullHeight);
    // Clip to the letterbox (y measured from the top in 2D coordinates).
    const top = this.fullHeight - this.rect.y - this.rect.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.rect.x, top, this.rect.width, this.rect.height);
    ctx.clip();
    // Base transform into display coordinates (y-up).
    const s = this.rect.width / this.displayWidth;
    ctx.setTransform(
      s, 0, 0, -s,
      this.rect.x + this.offsetX * s,
      top + this.displayHeight * s - this.offsetY * s,
    );
    ctx.imageSmoothingEnabled = true;
  }

  end() {
    this.ctx.restore();
  }

  // vTop/vBottom are measured from the top row of the source image.
  drawQuad({ tex, cx, cy, w, h, rotationDeg = 0, uLeft = 0, uRight = 1, vTop = 0, vBottom = 1, tint = [1, 1, 1, 1] }) {
    const ctx = this.ctx;
    if (!ctx || w <= 0 || h <= 0) return;
    const rad = (rotationDeg * Math.PI) / 180;
    if (tex === 'white') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.fillStyle = `rgba(${Math.round(tint[0] * 255)}, ${Math.round(tint[1] * 255)}, ${Math.round(tint[2] * 255)}, ${tint[3]})`;
      ctx.globalAlpha = 1;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }
    const image = this.images.get(tex);
    if (!image) return;
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const sx = uLeft * iw;
    const sw = (uRight - uLeft) * iw;
    const sy = Math.min(vTop, vBottom) * ih;
    const sh = Math.abs(vBottom - vTop) * ih;
    // A flipped pipe carries vTop > vBottom: its texture top belongs at
    // the quad's bottom edge, so skip the upright-image flip.
    const flipped = vTop > vBottom;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.scale(1, flipped ? 1 : -1);
    ctx.globalAlpha = tint[3];
    ctx.drawImage(image, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  uvForFrame(frame, sheetWidth, sheetHeight) {
    return {
      uLeft: frame.x / sheetWidth,
      uRight: (frame.x + frame.w) / sheetWidth,
      vTop: frame.y / sheetHeight,
      vBottom: (frame.y + frame.h) / sheetHeight,
    };
  }
}
