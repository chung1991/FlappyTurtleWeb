// Raw WebGL sprite renderer (no library). One textured quad per draw,
// orthographic projection in display points with y up, matching the
// SpriteKit scene coordinates the iOS game used (origin bottom-left).
//
// Texture coordinates use the unflipped upload convention: v is measured
// from the top row of the source image (v = pixelY / imageHeight), so a
// frame rect taken straight from game.plist maps without flipping.

// Try every context mode (and a minimal attribute set) before giving
// up: some browsers/GPUs only answer one mode, and a context that
// returns null leaves the canvas free for the next attempt. Returns
// { gl, mode } or null.
export const WEBGL_MODES = ['webgl', 'webgl2', 'experimental-webgl'];

export const WEBGL_ATTRIBUTE_SETS = [
  {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  },
  {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
    failIfMajorPerformanceCaveat: false,
  },
];

export function createWebGLContext(canvas, modes = WEBGL_MODES) {
  for (const attrs of WEBGL_ATTRIBUTE_SETS) {
    for (const mode of modes) {
      let gl = null;
      try {
        gl = canvas.getContext(mode, attrs);
      } catch {
        gl = null;
      }
      if (gl) return { gl, mode };
    }
  }
  return null;
}

// Compile and link the sprite shader program on any GL context.
// Throws on compile/link failure, so callers can tell a broken
// context apart from a merely absent one.
export function createShaderProgram(gl) {
  const vs = `
      attribute vec2 aPos;
      attribute vec2 aUV;
      uniform mat3 uProj;
      varying vec2 vUV;
      void main() {
        vUV = aUV;
        vec3 p = uProj * vec3(aPos, 1.0);
        gl_Position = vec4(p.xy, 0.0, 1.0);
      }`;
  const fs = `
      precision mediump float;
      uniform sampler2D uTex;
      uniform vec4 uTint;
      varying vec2 vUV;
      void main() {
        gl_FragColor = texture2D(uTex, vUV) * uTint;
      }`;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

// True only if a context can actually compile the game's shaders,
// upload a texture, and report no error and no context loss. Used on
// throwaway canvases so a broken context never locks the game canvas
// to WebGL mode before the fallback can be tried.
export function validateWebGLContext(gl) {
  try {
    createShaderProgram(gl);
    if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return false;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    if (typeof gl.getError === 'function' && gl.getError() !== 0) return false;
    return true;
  } catch {
    return false;
  } finally {
    try {
      gl.getExtension?.('WEBGL_lose_context')?.loseContext();
    } catch {
      // Releasing a probe context is best-effort.
    }
  }
}

// First WebGL mode that validates on a fresh offscreen canvas, or
// null. Never touches the game canvas: once a canvas yields a WebGL
// context it is locked to WebGL, so probing the game canvas itself
// would make the Canvas 2D fallback impossible afterwards.
export function findWorkingWebGLMode(
  createCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null),
) {
  for (const mode of WEBGL_MODES) {
    for (const attrs of WEBGL_ATTRIBUTE_SETS) {
      let canvas = null;
      try {
        canvas = createCanvas();
      } catch {
        canvas = null;
      }
      if (!canvas) continue;
      let gl = null;
      try {
        gl = canvas.getContext(mode, attrs);
      } catch {
        gl = null;
      }
      if (gl && validateWebGLContext(gl)) return mode;
    }
  }
  return null;
}

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    // In a browser, validate on throwaway canvases first and open the
    // game canvas with the mode that proved workable. Opening the game
    // canvas with a broken mode would lock it to WebGL and strand the
    // Canvas 2D fallback. (No `document` in Node/tests: skip the probe
    // and open the supplied canvas directly, as before.)
    let modes = WEBGL_MODES;
    if (typeof document !== 'undefined') {
      const working = findWorkingWebGLMode();
      if (!working) {
        throw new Error(
          `WebGL is not available in this browser (tried ${WEBGL_MODES.join(', ')}).`,
        );
      }
      modes = [working, ...WEBGL_MODES.filter((m) => m !== working)];
    }
    const found = createWebGLContext(canvas, modes);
    if (!found) {
      throw new Error(
        `WebGL is not available in this browser (tried ${WEBGL_MODES.join(', ')}).`,
      );
    }
    this.gl = found.gl;
    this.contextMode = found.mode;
    this.textures = new Map();
    this.projection = new Float32Array(9);
    this.initGL();
  }

  // Re-apply all program/attribute/blend state. Called from initGL
  // and from begin() every frame: resizing a WebGL canvas can reset
  // GL state, and re-applying it here makes a resize harmless instead
  // of silently blanking every later draw.
  applyProgramState() {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 16, 8);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.uTex, 0);
    gl.uniformMatrix3fv(this.uProj, false, this.projection);
  }

  initGL() {
    const gl = this.gl;
    const program = createShaderProgram(gl);
    this.program = program;
    this.aPos = gl.getAttribLocation(program, 'aPos');
    this.aUV = gl.getAttribLocation(program, 'aUV');
    this.uProj = gl.getUniformLocation(program, 'uProj');
    this.uTex = gl.getUniformLocation(program, 'uTex');
    this.uTint = gl.getUniformLocation(program, 'uTint');

    this.buffer = gl.createBuffer();
    this.applyProgramState();

    // 1x1 opaque white texture, used for solid-colour quads (shadow, flash).
    const white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.setTextureParams();
    this.textures.set('white', white);
  }

  setTextureParams() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  addTexture(name, image) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.setTextureParams();
    this.textures.set(name, texture);
    return texture;
  }

  // Letterbox: `rect` is the play area in device pixels, measured from the
  // bottom-left (GL convention). `displayWidth/Height` are the design
  // points the projection maps. `offset` shifts every sprite (screen shake).
  setFrame({ canvasWidth, canvasHeight, rect, displayWidth, displayHeight, offsetX = 0, offsetY = 0 }) {
    const gl = this.gl;
    if (this.canvas.width !== canvasWidth) this.canvas.width = canvasWidth;
    if (this.canvas.height !== canvasHeight) this.canvas.height = canvasHeight;
    this.fullWidth = canvasWidth;
    this.fullHeight = canvasHeight;
    this.rect = rect;
    const w = displayWidth;
    const h = displayHeight;
    // Column-major mat3: clip = (2x/w - 1 + 2*ox/w, 2y/h - 1 + 2*oy/h).
    this.projection.set([
      2 / w, 0, 0,
      0, 2 / h, 0,
      -1 + (2 * offsetX) / w, -1 + (2 * offsetY) / h, 1,
    ]);
    gl.uniformMatrix3fv(this.uProj, false, this.projection);
  }

  begin() {
    const gl = this.gl;
    this.applyProgramState();
    gl.viewport(0, 0, this.fullWidth, this.fullHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(this.rect.x, this.rect.y, this.rect.width, this.rect.height);
  }

  // No-op: kept so the frame loop can treat both renderers alike.
  end() {}

  // vTop/vBottom are measured from the top row of the source image.
  drawQuad({ tex, cx, cy, w, h, rotationDeg = 0, uLeft = 0, uRight = 1, vTop = 0, vBottom = 1, tint = [1, 1, 1, 1] }) {
    const gl = this.gl;
    const texture = this.textures.get(tex);
    if (!texture || w <= 0 || h <= 0) return;
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = w / 2;
    const hh = h / 2;
    // TRIANGLE_STRIP order: bottom-left, bottom-right, top-left, top-right.
    const corners = [
      [-hw, -hh, uLeft, vBottom],
      [hw, -hh, uRight, vBottom],
      [-hw, hh, uLeft, vTop],
      [hw, hh, uRight, vTop],
    ];
    const data = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const [lx, ly, u, v] = corners[i];
      data[i * 4] = cx + cos * lx - sin * ly;
      data[i * 4 + 1] = cy + sin * lx + cos * ly;
      data[i * 4 + 2] = u;
      data[i * 4 + 3] = v;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4fv(this.uTint, tint);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
