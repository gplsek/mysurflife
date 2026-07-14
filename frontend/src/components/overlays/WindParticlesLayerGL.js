/**
 * WindParticlesLayerGL.js — GPU wind particle layer (Phase C,
 * notes/WIND_TILES_EXECUTION_PLAN.md).
 *
 * Re-implementation of the mapbox/webgl-wind technique (MIT, Agafonkin):
 * particle positions live in an RGBA8 texture, advected in a fragment shader
 * from the per-hour uv.png textures served by /api/tiles/wind. Two hours are
 * bound at once and the shader lerps between them (u_tMix), so timeline
 * playback morphs continuously instead of popping.
 *
 * Particle coordinates are equirectangular [0,1]² (matching uv.png layout:
 * lon −180..180 → x, lat 90..−90 → y). The draw pass converts to Web
 * Mercator using the current Leaflet view uniforms, so pan/zoom only updates
 * uniforms — particle state survives.
 *
 * Colors come exclusively from design/ramps.js (no color literals here).
 */
import { sampleRamp } from '../../design/ramps';
import { TILE_API_BASE } from './WindTileLayer';

const UV_SCALE_MS = 40.0;      // must match backend overlay_tiles.UV_SCALE_MS
const RAMP_MAX_KTS = UV_SCALE_MS * 1.94384;
const DEFAULT_PARTICLES = 10000;
const MOBILE_MAX_PARTICLES = 5000;
const FADE_OPACITY = 0.96;     // trail persistence per frame
const SPEED_FACTOR = 0.25;     // advection speed tuning
const DROP_RATE = 0.003;       // base respawn probability per frame
const DROP_RATE_BUMP = 0.01;   // extra respawn for fast particles
const TEXTURE_LRU_MAX = 6;

export function windUVUrl({ model, run, hour }) {
  return `${TILE_API_BASE}/api/tiles/wind/${model}/${run}/${hour}/uv.png`;
}

export function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

export function clampParticleCount(n) {
  const cap = isMobileViewport() ? MOBILE_MAX_PARTICLES : 50000;
  return Math.max(1000, Math.min(cap, n || DEFAULT_PARTICLES));
}

// --------------------------------------------------------------------------
// Shaders (GLSL ES 1.0)
// --------------------------------------------------------------------------

const QUAD_VERT = `
precision mediump float;
attribute vec2 a_pos;
varying vec2 v_tex_pos;
void main() {
  v_tex_pos = a_pos;
  gl_Position = vec4(1.0 - 2.0 * a_pos, 0.0, 1.0);
}`;

const SCREEN_FRAG = `
precision mediump float;
uniform sampler2D u_screen;
uniform float u_opacity;
varying vec2 v_tex_pos;
void main() {
  vec4 color = texture2D(u_screen, 1.0 - v_tex_pos);
  // floor() trick from webgl-wind: guarantees trails fully decay to zero
  gl_FragColor = vec4(floor(255.0 * color * u_opacity) / 255.0);
}`;

const UPDATE_FRAG = `
precision highp float;
uniform sampler2D u_particles;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform float u_t_mix;
uniform float u_rand_seed;
uniform float u_speed_factor;
uniform float u_drop_rate;
uniform float u_drop_rate_bump;
uniform vec4 u_spawn_bounds;   // equirect x0, y0, x1, y1 of current view
varying vec2 v_tex_pos;

const float PI = 3.14159265359;

vec2 windAt(vec2 pos) {
  vec2 w0 = texture2D(u_wind0, pos).rg;
  vec2 w1 = texture2D(u_wind1, pos).rg;
  vec2 enc = mix(w0, w1, u_t_mix);
  return (enc * 2.0 - 1.0);   // normalized -1..1 (× UV_SCALE m/s)
}

float rand(const vec2 co) {
  const vec3 rand_constants = vec3(12.9898, 78.233, 4375.85453);
  float t = dot(rand_constants.xy, co);
  return fract(sin(t) * (rand_constants.z + t));
}

void main() {
  vec4 color = texture2D(u_particles, v_tex_pos);
  vec2 pos = vec2(
    color.r / 255.0 + color.b,
    color.g / 255.0 + color.a);

  vec2 velocity = windAt(pos);
  float speed_t = length(velocity);

  // Equirect distortion: a meter of eastward wind covers more longitude
  // near the poles. lat = 90 - y*180.
  float lat = 90.0 - pos.y * 180.0;
  float coslat = max(0.05, cos(radians(lat)));

  vec2 offset = vec2(velocity.x / coslat, -velocity.y) * 0.0001 * u_speed_factor;
  pos = pos + offset;
  pos.x = fract(1.0 + pos.x);          // wrap longitude
  pos.y = clamp(pos.y, 0.0, 1.0);      // clamp latitude

  // Respawn: probabilistic drop, biased for fast particles; respawn inside
  // the current view so zoomed-in maps stay dense.
  vec2 seed = (pos + v_tex_pos) * u_rand_seed;
  float drop = step(1.0 - u_drop_rate - speed_t * u_drop_rate_bump, rand(seed));
  vec2 random_pos = vec2(
    mix(u_spawn_bounds.x, u_spawn_bounds.z, rand(seed + 1.3)),
    mix(u_spawn_bounds.y, u_spawn_bounds.w, rand(seed + 2.1)));
  pos = mix(pos, random_pos, drop);

  gl_FragColor = vec4(
    fract(pos * 255.0),
    floor(pos * 255.0) / 255.0);
}`;

const DRAW_VERT = `
precision highp float;
attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particles_res;
uniform vec2 u_view_min;      // mercator top-left of view
uniform vec2 u_view_size;     // mercator extent of view
uniform float u_view_center_x;
uniform float u_point_size;
varying vec2 v_particle_pos;

const float PI = 3.14159265359;

void main() {
  vec4 color = texture2D(u_particles, vec2(
    fract(a_index / u_particles_res),
    floor(a_index / u_particles_res) / u_particles_res));
  vec2 pos = vec2(
    color.r / 255.0 + color.b,
    color.g / 255.0 + color.a);
  v_particle_pos = pos;

  // equirect -> web mercator world coords [0,1]
  float lat = 90.0 - pos.y * 180.0;
  float lat_clamped = clamp(lat, -85.05, 85.05);
  float merc_y = 0.5 - log(tan(PI * 0.25 + radians(lat_clamped) * 0.5)) / (2.0 * PI);
  float merc_x = pos.x;

  // wrap to the world copy nearest the view center
  merc_x = merc_x + floor(u_view_center_x - merc_x + 0.5);

  vec2 rel = vec2(
    (merc_x - u_view_min.x) / u_view_size.x,
    (merc_y - u_view_min.y) / u_view_size.y);

  gl_PointSize = u_point_size;
  gl_Position = vec4(rel.x * 2.0 - 1.0, 1.0 - rel.y * 2.0, 0.0, 1.0);
}`;

const DRAW_FRAG = `
precision mediump float;
uniform sampler2D u_wind0;
uniform sampler2D u_wind1;
uniform float u_t_mix;
uniform sampler2D u_color_ramp;
uniform float u_white_mix;
varying vec2 v_particle_pos;

void main() {
  vec2 w0 = texture2D(u_wind0, v_particle_pos).rg;
  vec2 w1 = texture2D(u_wind1, v_particle_pos).rg;
  vec2 velocity = mix(w0, w1, u_t_mix) * 2.0 - 1.0;
  float speed_t = clamp(length(velocity), 0.0, 1.0);

  vec4 ramp = texture2D(u_color_ramp, vec2(speed_t, 0.5));
  vec3 tinted = mix(ramp.rgb, vec3(1.0), u_white_mix);
  gl_FragColor = vec4(tinted, 0.9);
}`;

// --------------------------------------------------------------------------
// Minimal GL helpers
// --------------------------------------------------------------------------

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  const wrapper = { program };
  const numAttrs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < numAttrs; i++) {
    const attr = gl.getActiveAttrib(program, i);
    wrapper[attr.name] = gl.getAttribLocation(program, attr.name);
  }
  const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < numUniforms; i++) {
    const uniform = gl.getActiveUniform(program, i);
    wrapper[uniform.name] = gl.getUniformLocation(program, uniform.name);
  }
  return wrapper;
}

function createTexture(gl, filter, data, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (data instanceof Uint8Array) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function bindTexture(gl, texture, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function createBuffer(gl, data) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function bindAttribute(gl, buffer, attribute, numComponents) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, numComponents, gl.FLOAT, false, 0, 0);
}

function bindFramebuffer(gl, framebuffer, texture) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  if (texture) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  }
}

function mercatorY(lat) {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

function buildColorRamp() {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const kts = (i / 255) * RAMP_MAX_KTS;
    const { r, g, b } = sampleRamp('wind_speed', kts);
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

// --------------------------------------------------------------------------
// Controller
// --------------------------------------------------------------------------

export class WindParticlesGL {
  constructor(map, { numParticles = DEFAULT_PARTICLES, onUnsupported } = {}) {
    this.map = map;
    this.frame = null;          // { model, run }
    this.hour0 = null;
    this.hour1 = null;
    this.tMix = 0;
    this.visible = true;
    this.destroyed = false;
    this.uvTextures = new Map();   // hour -> WebGLTexture
    this.uvOrder = [];
    this.uvLoading = new Set();
    this.rafId = null;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '401';
    map.getContainer().appendChild(canvas);
    this.canvas = canvas;

    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false })
      || canvas.getContext('experimental-webgl', { antialias: false });
    if (!gl) {
      canvas.remove();
      this.unsupported = true;
      if (onUnsupported) onUnsupported();
      return;
    }
    this.gl = gl;

    this.quadBuffer = createBuffer(gl, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    this.screenProgram = createProgram(gl, QUAD_VERT, SCREEN_FRAG);
    this.updateProgram = createProgram(gl, QUAD_VERT, UPDATE_FRAG);
    this.drawProgram = createProgram(gl, DRAW_VERT, DRAW_FRAG);
    this.framebuffer = gl.createFramebuffer();
    this.colorRampTexture = createTexture(gl, gl.LINEAR, buildColorRamp(), 256, 1);

    this.setNumParticles(clampParticleCount(numParticles));
    this._resize();

    this._onMove = () => { /* uniforms read per-frame; nothing to do */ };
    this._onMoveStart = () => this._clearTrails();
    this._onResize = () => this._resize();
    map.on('movestart zoomstart', this._onMoveStart);
    map.on('resize', this._onResize);

    this._loop = this._loop.bind(this);
    this.rafId = requestAnimationFrame(this._loop);
  }

  // ---- public API ---------------------------------------------------------

  setRun(model, run) {
    if (this.frame && (this.frame.model !== model || this.frame.run !== run)) {
      // new model run: all cached textures are stale
      for (const tex of this.uvTextures.values()) this.gl.deleteTexture(tex);
      this.uvTextures.clear();
      this.uvOrder = [];
    }
    this.frame = { model, run };
  }

  /**
   * Position the layer in forecast time. hour0/hour1 are adjacent manifest
   * hours; mix ∈ [0,1) crossfades between them. Textures load lazily —
   * until both are ready the layer holds the last complete state.
   */
  setTime(hour0, hour1, mix = 0) {
    this.hour0 = hour0;
    this.hour1 = hour1 == null ? hour0 : hour1;
    this.tMix = mix;
    this._ensureTexture(this.hour0);
    this._ensureTexture(this.hour1);
  }

  setNumParticles(count) {
    const gl = this.gl;
    if (!gl) return;
    const res = Math.ceil(Math.sqrt(clampParticleCount(count)));
    this.particleRes = res;
    this.numParticles = res * res;

    const state = new Uint8Array(this.numParticles * 4);
    for (let i = 0; i < state.length; i++) state[i] = Math.floor(Math.random() * 256);
    if (this.particleStateTexture0) gl.deleteTexture(this.particleStateTexture0);
    if (this.particleStateTexture1) gl.deleteTexture(this.particleStateTexture1);
    this.particleStateTexture0 = createTexture(gl, gl.NEAREST, state, res, res);
    this.particleStateTexture1 = createTexture(gl, gl.NEAREST, state, res, res);

    const indices = new Float32Array(this.numParticles);
    for (let i = 0; i < this.numParticles; i++) indices[i] = i;
    if (this.particleIndexBuffer) gl.deleteBuffer(this.particleIndexBuffer);
    this.particleIndexBuffer = createBuffer(gl, indices);
  }

  setVisible(visible) {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
    if (visible) this._clearTrails();
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.map.off('movestart zoomstart', this._onMoveStart);
    this.map.off('resize', this._onResize);
    if (this.gl) {
      for (const tex of this.uvTextures.values()) this.gl.deleteTexture(tex);
    }
    this.canvas.remove();
  }

  // ---- internals ----------------------------------------------------------

  _uvKey(hour) {
    return `${this.frame.model}/${this.frame.run}/${hour}`;
  }

  _ensureTexture(hour) {
    if (hour == null || !this.frame || !this.gl) return;
    const key = this._uvKey(hour);
    if (this.uvTextures.has(key) || this.uvLoading.has(key)) return;
    this.uvLoading.add(key);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.uvLoading.delete(key);
      if (this.destroyed || !this.frame || this._uvKey(hour) !== key) return;
      const tex = createTexture(this.gl, this.gl.LINEAR, img);
      this.uvTextures.set(key, tex);
      this.uvOrder.push(key);
      while (this.uvOrder.length > TEXTURE_LRU_MAX) {
        const evict = this.uvOrder.shift();
        if (evict !== this._uvKey(this.hour0) && evict !== this._uvKey(this.hour1)) {
          const t = this.uvTextures.get(evict);
          if (t) this.gl.deleteTexture(t);
          this.uvTextures.delete(evict);
        } else {
          this.uvOrder.push(evict);
          break;
        }
      }
    };
    img.onerror = () => this.uvLoading.delete(key);
    img.src = windUVUrl({ ...this.frame, hour });
  }

  _currentTextures() {
    if (!this.frame || this.hour0 == null) return null;
    const t0 = this.uvTextures.get(this._uvKey(this.hour0));
    const t1 = this.uvTextures.get(this._uvKey(this.hour1));
    if (t0 && t1) return { t0, t1, mix: this.tMix };
    if (t0) return { t0, t1: t0, mix: 0 };
    return null;
  }

  _resize() {
    const size = this.map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = size.x * dpr;
    this.canvas.height = size.y * dpr;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    this.dpr = dpr;
    this._createScreenTextures();
  }

  _createScreenTextures() {
    const gl = this.gl;
    if (!gl) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const empty = new Uint8Array(w * h * 4);
    if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture);
    if (this.screenTexture) gl.deleteTexture(this.screenTexture);
    this.backgroundTexture = createTexture(gl, gl.NEAREST, empty, w, h);
    this.screenTexture = createTexture(gl, gl.NEAREST, empty, w, h);
  }

  _clearTrails() {
    this._createScreenTextures();
  }

  _viewUniforms() {
    const bounds = this.map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const minX = (west + 180) / 360;
    const maxX = (east + 180) / 360;
    const minY = mercatorY(bounds.getNorth());
    const maxY = mercatorY(bounds.getSouth());
    return {
      viewMin: [minX, minY],
      viewSize: [Math.max(1e-9, maxX - minX), Math.max(1e-9, maxY - minY)],
      viewCenterX: (minX + maxX) / 2,
      // spawn bounds in equirect particle space (x == lon fraction)
      spawn: [
        Math.max(0, minX - 0.05),
        Math.max(0, (90 - bounds.getNorth()) / 180 - 0.05),
        Math.min(1, maxX + 0.05),
        Math.min(1, (90 - bounds.getSouth()) / 180 + 0.05),
      ],
    };
  }

  _loop() {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this._loop);
    if (!this.visible || !this.gl) return;
    const winds = this._currentTextures();
    if (!winds) return;

    const gl = this.gl;
    const view = this._viewUniforms();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    bindTexture(gl, winds.t0, 0);
    bindTexture(gl, winds.t1, 5);
    bindTexture(gl, this.particleStateTexture0, 1);

    this._drawScreen(winds, view);
    this._updateParticles(winds, view);
  }

  _drawScreen(winds, view) {
    const gl = this.gl;
    bindFramebuffer(gl, this.framebuffer, this.screenTexture);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    this._drawTexture(this.backgroundTexture, FADE_OPACITY);
    this._drawParticles(winds, view);

    bindFramebuffer(gl, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._drawTexture(this.screenTexture, 1.0);
    gl.disable(gl.BLEND);

    const temp = this.backgroundTexture;
    this.backgroundTexture = this.screenTexture;
    this.screenTexture = temp;
  }

  _drawTexture(texture, opacity) {
    const gl = this.gl;
    const program = this.screenProgram;
    gl.useProgram(program.program);
    bindAttribute(gl, this.quadBuffer, program.a_pos, 2);
    bindTexture(gl, texture, 2);
    gl.uniform1i(program.u_screen, 2);
    gl.uniform1f(program.u_opacity, opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  _drawParticles(winds, view) {
    const gl = this.gl;
    const program = this.drawProgram;
    gl.useProgram(program.program);

    bindAttribute(gl, this.particleIndexBuffer, program.a_index, 1);
    bindTexture(gl, this.colorRampTexture, 3);

    gl.uniform1i(program.u_wind0, 0);
    gl.uniform1i(program.u_wind1, 5);
    gl.uniform1f(program.u_t_mix, winds.mix);
    gl.uniform1i(program.u_particles, 1);
    gl.uniform1i(program.u_color_ramp, 3);
    gl.uniform1f(program.u_particles_res, this.particleRes);
    gl.uniform2f(program.u_view_min, view.viewMin[0], view.viewMin[1]);
    gl.uniform2f(program.u_view_size, view.viewSize[0], view.viewSize[1]);
    gl.uniform1f(program.u_view_center_x, view.viewCenterX);
    gl.uniform1f(program.u_point_size, 1.6 * this.dpr);
    gl.uniform1f(program.u_white_mix, 0.55);

    gl.drawArrays(gl.POINTS, 0, this.numParticles);
  }

  _updateParticles(winds, view) {
    const gl = this.gl;
    bindFramebuffer(gl, this.framebuffer, this.particleStateTexture1);
    gl.viewport(0, 0, this.particleRes, this.particleRes);

    const program = this.updateProgram;
    gl.useProgram(program.program);
    bindAttribute(gl, this.quadBuffer, program.a_pos, 2);

    gl.uniform1i(program.u_wind0, 0);
    gl.uniform1i(program.u_wind1, 5);
    gl.uniform1f(program.u_t_mix, winds.mix);
    gl.uniform1i(program.u_particles, 1);
    gl.uniform1f(program.u_rand_seed, Math.random());
    gl.uniform1f(program.u_speed_factor, SPEED_FACTOR * UV_SCALE_MS);
    gl.uniform1f(program.u_drop_rate, DROP_RATE);
    gl.uniform1f(program.u_drop_rate_bump, DROP_RATE_BUMP);
    gl.uniform4f(program.u_spawn_bounds,
      view.spawn[0], view.spawn[1], view.spawn[2], view.spawn[3]);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    bindFramebuffer(gl, null);

    const temp = this.particleStateTexture0;
    this.particleStateTexture0 = this.particleStateTexture1;
    this.particleStateTexture1 = temp;
  }
}
