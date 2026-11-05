// Tests for renderer selection and the Canvas 2D fallback. Run:
//   node --test tests/renderer.test.mjs
// These cover the WebGL-unavailable defect: the game must try every
// WebGL context mode before giving up, and must draw sprites upright,
// correctly rotated, and correctly flipped for pipes when WebGL is
// absent and the Canvas 2D renderer runs instead.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLRenderer, createWebGLContext, findWorkingWebGLMode, validateWebGLContext } from '../js/renderer.js';
import { Canvas2DRenderer, swapCanvasFor2D, createFallbackRenderer } from '../js/fallback.js';

// --- Mock WebGL context -------------------------------------------------
function mockGL({ compileOk = true, lost = false, error = 0 } = {}) {
  const nums = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, ARRAY_BUFFER: 3, FLOAT: 4,
    DEPTH_TEST: 5, BLEND: 6, SRC_ALPHA: 7, ONE_MINUS_SRC_ALPHA: 8,
    TEXTURE_2D: 9, RGBA: 10, UNSIGNED_BYTE: 11, CLAMP_TO_EDGE: 12,
    LINEAR: 13, DYNAMIC_DRAW: 14, TRIANGLE_STRIP: 15, COLOR_BUFFER_BIT: 16,
    LINK_STATUS: 17, COMPILE_STATUS: 18, TEXTURE_WRAP_S: 19, TEXTURE_WRAP_T: 20,
    TEXTURE_MIN_FILTER: 21, TEXTURE_MAG_FILTER: 22, UNPACK_FLIP_Y_WEBGL: 23,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 24,
  };
  let nextId = 1;
  return {
    ...nums,
    createProgram: () => ({}), attachShader: () => {}, createShader: () => ({}),
    shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => compileOk, getShaderInfoLog: () => (compileOk ? '' : 'bad shader'),
    linkProgram: () => {}, getProgramParameter: () => compileOk, getProgramInfoLog: () => '',
    useProgram: () => {}, getAttribLocation: () => 0, getUniformLocation: () => ({}),
    createBuffer: () => ({}), bindBuffer: () => {}, enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {}, disable: () => {}, enable: () => {}, blendFunc: () => {},
    uniform1i: () => {}, createTexture: () => ({ id: nextId++ }),
    bindTexture: () => {}, texImage2D: () => {}, texParameteri: () => {}, pixelStorei: () => {},
    uniformMatrix3fv: () => {}, viewport: () => {}, clearColor: () => {}, clear: () => {},
    uniform4fv: () => {}, bufferData: () => {}, drawArrays: () => {},
    getError: () => error, isContextLost: () => lost,
    getExtension: () => ({ loseContext: () => {} }),
  };
}

describe('WebGL context attempts', () => {
  it('tries webgl, then webgl2, then experimental-webgl', () => {
    const seen = [];
    const gl = mockGL();
    const canvas = {
      width: 0, height: 0,
      getContext: (mode) => {
        seen.push(mode);
        return mode === 'webgl2' ? gl : null;
      },
    };
    const found = createWebGLContext(canvas);
    assert.equal(found.mode, 'webgl2');
    assert.equal(found.gl, gl);
    assert.deepEqual(seen.slice(0, 2), ['webgl', 'webgl2']);
  });

  it('returns null only after every mode fails', () => {
    const seen = [];
    const canvas = {
      width: 0, height: 0,
      getContext: (mode) => {
        seen.push(mode);
        return null;
      },
    };
    assert.equal(createWebGLContext(canvas), null);
    assert.ok(seen.includes('webgl'));
    assert.ok(seen.includes('webgl2'));
    assert.ok(seen.includes('experimental-webgl'));
  });

  it('WebGLRenderer throws a diagnostic error when no context exists', () => {
    const canvas = { width: 0, height: 0, getContext: () => null };
    assert.throws(() => new WebGLRenderer(canvas), /webgl2/);
  });

  it('WebGLRenderer accepts a webgl2 context', () => {
    const canvas = { width: 0, height: 0, getContext: () => mockGL() };
    const renderer = new WebGLRenderer(canvas);
    assert.equal(renderer.textures.has('white'), true);
  });
});

// --- Mock 2D context with real transform composition ---------------------
// CTM as [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f.
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const IDENTITY = [1, 0, 0, 1, 0, 0];

class MockCtx {
  constructor() {
    this.ctm = [...IDENTITY];
    this.stack = [];
    this.draws = [];
    this.fills = [];
    this.clips = [];
    this.globalAlpha = 1;
    this.fillStyle = '';
    this.imageSmoothingEnabled = true;
    this.saves = 0;
    this.restores = 0;
  }
  apply(x, y) {
    const [a, b, c, d, e, f] = this.ctm;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  setTransform(a, b, c, d, e, f) { this.ctm = [a, b, c, d, e, f]; }
  save() { this.stack.push([...this.ctm]); this.saves += 1; }
  restore() { this.ctm = this.stack.pop() ?? [...IDENTITY]; this.restores += 1; }
  translate(x, y) { this.ctm = multiply(this.ctm, [1, 0, 0, 1, x, y]); }
  rotate(a) {
    const cos = Math.cos(a), sin = Math.sin(a);
    this.ctm = multiply(this.ctm, [cos, sin, -sin, cos, 0, 0]);
  }
  scale(x, y) { this.ctm = multiply(this.ctm, [x, 0, 0, y, 0, 0]); }
  beginPath() {}
  rect(x, y, w, h) { this.clips.push([x, y, w, h]); }
  clip() {}
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    this.draws.push({ img, sx, sy, sw, sh, dx, dy, dw, dh, ctm: [...this.ctm], globalAlpha: this.globalAlpha });
  }
  fillRect(x, y, w, h) {
    this.fills.push({ x, y, w, h, ctm: [...this.ctm], fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }
}

function mockCanvas2d() {
  const ctx = new MockCtx();
  return {
    canvas: { width: 960, height: 640, getContext: (kind) => (kind === '2d' ? ctx : null), dataset: {} },
    ctx,
  };
}

function fullFrameCtx(displayWidth = 960) {
  const { canvas, ctx } = mockCanvas2d();
  const renderer = new Canvas2DRenderer(canvas);
  renderer.setFrame({
    canvasWidth: 960, canvasHeight: 640,
    rect: { x: 0, y: 0, width: 960, height: 640 },
    displayWidth, displayHeight: 640,
  });
  renderer.begin();
  return { canvas, ctx, renderer };
}

const approx = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function deviceCorners(draw) {
  // Device positions of the image's top-left and bottom-right corners,
  // composing the recorded CTM with the destination rect.
  const [a, b, c, d, e, f] = draw.ctm;
  const at = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  return { topLeft: at(draw.dx, draw.dy), bottomRight: at(draw.dx + draw.dw, draw.dy + draw.dh) };
}

describe('Canvas2DRenderer fallback', () => {
  it('throws when the 2d context is unavailable', () => {
    const canvas = { width: 0, height: 0, getContext: () => null, dataset: {} };
    assert.throws(() => new Canvas2DRenderer(canvas), /Canvas 2D/);
  });

  it('shares uvForFrame with the WebGL renderer', () => {
    const glCanvas = { width: 0, height: 0, getContext: () => mockGL() };
    const webgl = new WebGLRenderer(glCanvas);
    const { renderer } = fullFrameCtx();
    const frame = { x: 1154, y: 473, w: 95, h: 71 };
    assert.deepEqual(renderer.uvForFrame(frame, 2048, 1024), webgl.uvForFrame(frame, 2048, 1024));
  });

  it('draws an atlas sprite upright in display coordinates', () => {
    const { ctx, renderer } = fullFrameCtx();
    renderer.addTexture('atlas', { naturalWidth: 2048, naturalHeight: 1024 });
    const uv = renderer.uvForFrame({ x: 1154, y: 473, w: 95, h: 71 }, 2048, 1024);
    renderer.drawQuad({ tex: 'atlas', cx: 240, cy: 320, w: 95, h: 71, ...uv });
    assert.equal(ctx.draws.length, 1);
    const { topLeft, bottomRight } = deviceCorners(ctx.draws[0]);
    assert.ok(approx(topLeft[0], 192.5) && approx(topLeft[1], 284.5), `top-left ${topLeft}`);
    assert.ok(approx(bottomRight[0], 287.5) && approx(bottomRight[1], 355.5), `bottom-right ${bottomRight}`);
    // Source rect is the atlas frame, top row first.
    assert.equal(ctx.draws[0].sx, 1154);
    assert.equal(ctx.draws[0].sy, 473);
    assert.equal(ctx.draws[0].sw, 95);
    assert.equal(ctx.draws[0].sh, 71);
  });

  it('rotates the turtle counter-clockwise like the WebGL renderer', () => {
    const { ctx, renderer } = fullFrameCtx();
    renderer.addTexture('atlas', { naturalWidth: 2048, naturalHeight: 1024 });
    const uv = renderer.uvForFrame({ x: 1154, y: 473, w: 95, h: 71 }, 2048, 1024);
    renderer.drawQuad({ tex: 'atlas', cx: 240, cy: 320, w: 95, h: 71, rotationDeg: 30, ...uv });
    const { topLeft } = deviceCorners(ctx.draws[0]);
    // (-47.5, +35.5) rotated +30deg in y-up coords, then y-flipped to device.
    assert.ok(approx(topLeft[0], 181.11, 0.1), `x ${topLeft[0]}`);
    assert.ok(approx(topLeft[1], 313.01, 0.1), `y ${topLeft[1]}`);
  });

  it('draws the flipped top pipe with the texture top at the gap edge', () => {
    const { ctx, renderer } = fullFrameCtx();
    renderer.addTexture('obstacle', { naturalWidth: 150, naturalHeight: 500 });
    // Top pipe: height 360, cy 460, flipped (vTop > vBottom).
    renderer.drawQuad({ tex: 'obstacle', cx: 500, cy: 460, w: 150, h: 360, uLeft: 0, uRight: 1, vTop: 0.72, vBottom: 0 });
    const { topLeft, bottomRight } = deviceCorners(ctx.draws[0]);
    // Image top row lands at the gap edge (display y 280 -> device 360).
    assert.ok(approx(topLeft[0], 425) && approx(topLeft[1], 360), `top-left ${topLeft}`);
    assert.ok(approx(bottomRight[0], 575) && approx(bottomRight[1], 0), `bottom-right ${bottomRight}`);
    assert.equal(ctx.draws[0].sy, 0);
    assert.equal(ctx.draws[0].sh, 360);
  });

  it('draws the bottom pipe with the texture top at its top edge', () => {
    const { ctx, renderer } = fullFrameCtx();
    renderer.addTexture('obstacle', { naturalWidth: 150, naturalHeight: 500 });
    renderer.drawQuad({ tex: 'obstacle', cx: 500, cy: 55, w: 150, h: 10, uLeft: 0, uRight: 1, vTop: 0, vBottom: 0.02 });
    const { topLeft, bottomRight } = deviceCorners(ctx.draws[0]);
    assert.ok(approx(topLeft[0], 425) && approx(topLeft[1], 580), `top-left ${topLeft}`);
    assert.ok(approx(bottomRight[0], 575) && approx(bottomRight[1], 590), `bottom-right ${bottomRight}`);
  });

  it('applies tint alpha to sprites and solid quads', () => {
    const { ctx, renderer } = fullFrameCtx();
    renderer.addTexture('atlas', { naturalWidth: 2048, naturalHeight: 1024 });
    const uv = renderer.uvForFrame({ x: 1154, y: 473, w: 95, h: 71 }, 2048, 1024);
    renderer.drawQuad({ tex: 'atlas', cx: 240, cy: 320, w: 95, h: 71, tint: [1, 1, 1, 0.25], ...uv });
    assert.equal(ctx.draws[0].globalAlpha, 0.25);
    renderer.drawQuad({ tex: 'white', cx: 480, cy: 320, w: 960, h: 640, tint: [0, 0, 0, 0.5] });
    // begin() also fills black to clear; the white quad is the last fill.
    assert.equal(ctx.fills.at(-1).fillStyle, 'rgba(0, 0, 0, 0.5)');
  });

  it('clips drawing to the letterbox', () => {
    const { canvas, ctx } = mockCanvas2d();
    const renderer = new Canvas2DRenderer(canvas);
    renderer.setFrame({
      canvasWidth: 960, canvasHeight: 640,
      rect: { x: 120, y: 80, width: 720, height: 480 },
      displayWidth: 960, displayHeight: 640,
    });
    renderer.begin();
    // Device rect: y measured from the top, so 640 - 80 - 480 = 80.
    assert.deepEqual(ctx.clips.at(-1), [120, 80, 720, 480]);
    renderer.end();
    assert.equal(ctx.saves, ctx.restores);
  });
});

describe('WebGL probe validation (offscreen canvas)', () => {
  it('returns null when no canvas can be created', () => {
    assert.equal(findWorkingWebGLMode(() => null), null);
  });

  it('returns null when every mode returns no context', () => {
    assert.equal(findWorkingWebGLMode(() => ({ getContext: () => null })), null);
  });

  it('returns webgl when the first mode validates', () => {
    let created = 0;
    const mode = findWorkingWebGLMode(() => {
      created += 1;
      return { getContext: () => mockGL() };
    });
    assert.equal(mode, 'webgl');
    assert.equal(created, 1);
  });

  it('skips a mode whose shaders fail and returns the next working mode', () => {
    let created = 0;
    const mode = findWorkingWebGLMode(() => {
      created += 1;
      return {
        getContext: (m) => (m === 'webgl' ? mockGL({ compileOk: false }) : mockGL()),
      };
    });
    assert.equal(mode, 'webgl2');
    assert.ok(created > 1, 'the probe must use a fresh canvas per attempt');
  });

  it('validateWebGLContext rejects a lost context', () => {
    assert.equal(validateWebGLContext(mockGL({ lost: true })), false);
    assert.equal(validateWebGLContext(mockGL({ error: 1282 })), false);
    assert.equal(validateWebGLContext(mockGL()), true);
  });
});

// --- Fake DOM canvas for the swap tests ----------------------------------
function makeFakeCanvas(twoD, doc) {
  const canvas = {
    id: 'game',
    tabIndex: 0,
    width: 300,
    height: 150,
    dataset: {},
    attrs: { role: 'application', 'aria-label': 'Flappy Turtle' },
    replacedWith: null,
    ownerDocument: doc,
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    replaceWith(other) { this.replacedWith = other; },
    getContext(kind) { return kind === '2d' ? twoD : null; },
  };
  return canvas;
}

describe('fallback canvas swap (WebGL-locked canvas)', () => {
  it('swapCanvasFor2D copies identity onto a fresh canvas', () => {
    const doc = { created: [], createElement: (tag) => {
      const c = makeFakeCanvas({}, doc);
      c.tag = tag;
      doc.created.push(c);
      return c;
    } };
    const old = makeFakeCanvas({}, doc);
    const replacement = swapCanvasFor2D(old);
    assert.equal(replacement.id, 'game');
    assert.equal(replacement.tabIndex, 0);
    assert.equal(replacement.getAttribute('role'), 'application');
    assert.equal(replacement.getAttribute('aria-label'), 'Flappy Turtle');
    assert.equal(old.replacedWith, replacement);
    assert.equal(replacement.ownerDocument, doc);
  });

  it('createFallbackRenderer recovers from a WebGL-locked canvas', () => {
    const ctx2d = {};
    const doc = { createElement: () => makeFakeCanvas(ctx2d, doc) };
    const locked = makeFakeCanvas(null, doc);
    locked.getContext = (kind) => (kind === '2d' ? null : mockGL());
    const { renderer, canvas } = createFallbackRenderer(locked);
    assert.ok(renderer instanceof Canvas2DRenderer);
    assert.equal(renderer.ctx, ctx2d);
    assert.notEqual(canvas, locked);
    assert.equal(locked.replacedWith, canvas);
  });

  it('createFallbackRenderer keeps the original canvas when 2d works', () => {
    const ctx2d = {};
    const doc = { createElement: () => { throw new Error('must not swap'); } };
    const canvas = makeFakeCanvas(ctx2d, doc);
    const { renderer, canvas: kept } = createFallbackRenderer(canvas);
    assert.equal(kept, canvas);
    assert.equal(renderer.ctx, ctx2d);
    assert.equal(canvas.replacedWith, null);
  });
});

describe('WebGL state survives a canvas resize', () => {
  it('begin() re-applies program and attributes after the size change resets them', () => {
    const gl = mockGL();
    const state = { program: null, attribs: new Set(), pointers: 0, draws: [] };
    let attribCounter = 0;
    gl.getAttribLocation = () => attribCounter++;
    gl.useProgram = (p) => { state.program = p; };
    gl.enableVertexAttribArray = (i) => { state.attribs.add(i); };
    gl.vertexAttribPointer = () => { state.pointers += 1; };
    gl.drawArrays = () => {
      state.draws.push({ programBound: state.program !== null, attribs: state.attribs.size, pointers: state.pointers });
    };
    gl.__reset = () => { state.program = null; state.attribs.clear(); state.pointers = 0; };
    let widthValue = 300;
    const canvas = {
      height: 150,
      dataset: {},
      getContext: () => gl,
    };
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => widthValue,
      set: (v) => {
        if (v !== widthValue) { widthValue = v; gl.__reset(); }
      },
    });
    const renderer = new WebGLRenderer(canvas);
    renderer.addTexture('atlas', {});
    const drawOnce = (canvasWidth) => {
      renderer.setFrame({
        canvasWidth, canvasHeight: 640,
        rect: { x: 0, y: 0, width: canvasWidth, height: 640 },
        displayWidth: 960, displayHeight: 640,
      });
      renderer.begin();
      renderer.drawQuad({ tex: 'atlas', cx: 480, cy: 320, w: 10, h: 10 });
    };
    drawOnce(960);
    drawOnce(800);
    assert.equal(state.draws.length, 2);
    for (const draw of state.draws) {
      assert.equal(draw.programBound, true, 'program must be bound at draw time even after resize');
      assert.equal(draw.attribs, 2, 'both vertex attributes must be enabled at draw time');
      assert.ok(draw.pointers >= 2, 'attribute pointers must be set at draw time');
    }
  });
});
