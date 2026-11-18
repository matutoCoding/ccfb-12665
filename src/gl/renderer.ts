// WebGL2 渲染器: 地形(含分层着色叠加)、实例化机组、线条层、标签投影、拾取
import { TerrainGrid } from '../types';
import { mat4LookAt, mat4Multiply, mat4Perspective, mat4Transform, Mat4 } from './mat4';
import { LINE_FS, LINE_VS, MESH_FS, MESH_VS, TERRAIN_FS, TERRAIN_VS } from './shaders';
import { buildBoxGeometry, buildTurbineGeometry, MeshGeometry } from './meshes';

export interface Instance {
  x: number; y: number; z: number;
  scaleX: number; scaleY: number; // 机组: 叶轮直径/轮毂高; 立方体: 边长/0
  yaw: number; phase: number; flag: number;
}

export interface Label { x: number; y: number; z: number; text: string; color: string }

interface LineSet { data: Float32Array; visible: boolean }

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private labelCtx: CanvasRenderingContext2D;
  private labelCanvas: HTMLCanvasElement;

  // 相机
  yaw = -2.2; pitch = 0.55; dist = 5200;
  target = [2500, 2500, 750];

  private terrainGrid: TerrainGrid | null = null;
  private terrainVAO: WebGLVertexArrayObject | null = null;
  private terrainCount = 0;
  private elevRange: [number, number] = [0, 1000];

  private progTerrain: WebGLProgram;
  private progMesh: WebGLProgram;
  private progLine: WebGLProgram;

  private overlayTex: WebGLTexture | null = null;
  private overlayInfo: { originX: number; originY: number; w: number; h: number } | null = null;

  private turbineGeom: MeshGeometry;
  private boxGeom: MeshGeometry;
  private meshVAOs = new Map<string, { vao: WebGLVertexArrayObject; instBuf: WebGLBuffer; count: number; geom: MeshGeometry; color: [number, number, number] }>();

  private lineVAO: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineVertexCount = 0;
  private lineSets = new Map<string, LineSet>();

  private labels: Label[] = [];
  private mvp: Mat4 = new Float32Array(16);
  private camPos = [0, 0, 0];
  private fpsCb: (fps: number) => void;
  private frames = 0;
  private lastFpsT = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, labelCanvas: HTMLCanvasElement, fpsCb: (fps: number) => void) {
    this.canvas = canvas;
    this.labelCanvas = labelCanvas;
    this.labelCtx = labelCanvas.getContext('2d')!;
    this.fpsCb = fpsCb;
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.progTerrain = link(gl, TERRAIN_VS, TERRAIN_FS);
    this.progMesh = link(gl, MESH_VS, MESH_FS);
    this.progLine = link(gl, LINE_VS, LINE_FS);
    this.turbineGeom = buildTurbineGeometry();
    this.boxGeom = buildBoxGeometry();
    this.lineVAO = gl.createVertexArray()!;
    this.lineBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE); // 地形/叶片双面渲染, 不启用背面剔除
    gl.clearColor(0.10, 0.13, 0.17, 1);

    this.attachControls();
    this.loop(0);
  }

  // ---------------- 地形 ----------------
  setTerrain(t: TerrainGrid): void {
    this.terrainGrid = t;
    const gl = this.gl;
    const n = t.nx * t.ny;
    const verts = new Float32Array(n * 6);
    let zMin = Infinity, zMax = -Infinity;
    for (let k = 0; k < n; k++) { zMin = Math.min(zMin, t.z[k]); zMax = Math.max(zMax, t.z[k]); }
    this.elevRange = [zMin, zMax];
    const H = (i: number, j: number) => t.z[Math.max(0, Math.min(t.ny - 1, j)) * t.nx + Math.max(0, Math.min(t.nx - 1, i))];
    for (let j = 0; j < t.ny; j++) {
      for (let i = 0; i < t.nx; i++) {
        const k = j * t.nx + i;
        const x = t.originX + i * t.cell, y = t.originY + j * t.cell, z = t.z[k];
        // 中心差分法线
        const dzdx = (H(i + 1, j) - H(i - 1, j)) / (2 * t.cell);
        const dzdy = (H(i, j + 1) - H(i, j - 1)) / (2 * t.cell);
        const inv = 1 / Math.hypot(dzdx, dzdy, 1);
        verts[k * 6] = x; verts[k * 6 + 1] = y; verts[k * 6 + 2] = z;
        verts[k * 6 + 3] = -dzdx * inv; verts[k * 6 + 4] = -dzdy * inv; verts[k * 6 + 5] = inv;
      }
    }
    const idx = new Uint32Array((t.nx - 1) * (t.ny - 1) * 6);
    let q = 0;
    for (let j = 0; j < t.ny - 1; j++) {
      for (let i = 0; i < t.nx - 1; i++) {
        const a = j * t.nx + i, b = a + 1, c = a + t.nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    if (this.terrainVAO) this.gl.deleteVertexArray(this.terrainVAO);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrainVAO = vao;
    this.terrainCount = idx.length;
  }

  // ---------------- 叠加层(风速/发电量着色) ----------------
  setOverlay(data: Float32Array | null, nx: number, ny: number, originX: number, originY: number, cell: number, minV: number, maxV: number): void {
    const gl = this.gl;
    if (!data) { this.overlayInfo = null; return; }
    const rgba = new Uint8Array(nx * ny * 4);
    for (let k = 0; k < nx * ny; k++) {
      const t = Math.max(0, Math.min(1, (data[k] - minV) / Math.max(1e-9, maxV - minV)));
      const [r, g, b] = colormap(t);
      rgba[k * 4] = r; rgba[k * 4 + 1] = g; rgba[k * 4 + 2] = b; rgba[k * 4 + 3] = 255;
    }
    if (!this.overlayTex) this.overlayTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.overlayInfo = { originX, originY, w: nx * cell, h: ny * cell };
  }

  // ---------------- 实例网格 ----------------
  setInstances(key: string, geom: 'turbine' | 'box', list: Instance[], color: [number, number, number]): void {
    const gl = this.gl;
    const g = geom === 'turbine' ? this.turbineGeom : this.boxGeom;
    const inst = new Float32Array(list.length * 9);
    list.forEach((it, i) => {
      inst.set([it.x, it.y, it.z, it.scaleX, it.scaleY, 0, it.yaw, it.phase, it.flag], i * 9);
    });
    let entry = this.meshVAOs.get(key);
    if (entry) {
      gl.deleteVertexArray(entry.vao);
      gl.deleteBuffer(entry.instBuf);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, g.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    const kb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, kb);
    gl.bufferData(gl.ARRAY_BUFFER, g.kinds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    const instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 36, 12);
    gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 36, 24);
    gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 36, 32);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
    this.meshVAOs.set(key, { vao, instBuf, count: list.length, geom: g, color });
  }

  // ---------------- 线条 ----------------
  setLines(name: string, positions: Float32Array, rgb: [number, number, number]): void {
    // positions: 线段顶点 xyz 序列, 自动填充颜色
    const n = positions.length / 3;
    const data = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      data[i * 6] = positions[i * 3];
      data[i * 6 + 1] = positions[i * 3 + 1];
      data[i * 6 + 2] = positions[i * 3 + 2];
      data[i * 6 + 3] = rgb[0]; data[i * 6 + 4] = rgb[1]; data[i * 6 + 5] = rgb[2];
    }
    this.lineSets.set(name, { data, visible: true });
    this.rebuildLines();
  }

  removeLines(name: string): void {
    this.lineSets.delete(name);
    this.rebuildLines();
  }

  setLineVisible(name: string, v: boolean): void {
    const s = this.lineSets.get(name);
    if (s) { s.visible = v; this.rebuildLines(); }
  }

  private rebuildLines(): void {
    let total = 0;
    for (const s of this.lineSets.values()) if (s.visible) total += s.data.length;
    const all = new Float32Array(total);
    let off = 0;
    for (const s of this.lineSets.values()) {
      if (!s.visible) continue;
      all.set(s.data, off);
      off += s.data.length;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.DYNAMIC_DRAW);
    this.lineVertexCount = total / 6;
  }

  setLabels(labels: Label[]): void { this.labels = labels; }

  // ---------------- 相机/拾取 ----------------
  private eye(): number[] {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [
      this.target[0] + this.dist * cp * Math.cos(this.yaw),
      this.target[1] + this.dist * cp * Math.sin(this.yaw),
      this.target[2] + this.dist * sp,
    ];
  }

  pickGround(sx: number, sy: number): [number, number] | null {
    const t = this.terrainGrid;
    if (!t) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = (sx / rect.width) * 2 - 1;
    const ndcY = 1 - (sy / rect.height) * 2;
    const eye = this.eye();
    const fwd = norm3([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]]);
    const right = norm3(cross3(fwd, [0, 0, 1]));
    const up = cross3(right, fwd);
    const fov = (50 * Math.PI) / 180;
    const aspect = rect.width / rect.height;
    const dir = norm3([
      fwd[0] + right[0] * ndcX * Math.tan(fov / 2) * aspect + up[0] * ndcY * Math.tan(fov / 2),
      fwd[1] + right[1] * ndcX * Math.tan(fov / 2) * aspect + up[1] * ndcY * Math.tan(fov / 2),
      fwd[2] + right[2] * ndcX * Math.tan(fov / 2) * aspect + up[2] * ndcY * Math.tan(fov / 2),
    ]);
    // 步进求交 + 二分细化
    const heightAtLocal = (x: number, y: number): number => {
      const fx = (x - t.originX) / t.cell, fy = (y - t.originY) / t.cell;
      const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx)));
      const j = Math.max(0, Math.min(t.ny - 2, Math.floor(fy)));
      const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j));
      const k = j * t.nx + i;
      const a = t.z[k], b = t.z[k + 1], c = t.z[k + t.nx], d = t.z[k + t.nx + 1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    let tPrev = 0;
    const maxT = this.dist * 3;
    for (let tt = 10; tt < maxT; tt += Math.max(10, tt * 0.02)) {
      const px = eye[0] + dir[0] * tt, py = eye[1] + dir[1] * tt, pz = eye[2] + dir[2] * tt;
      if (px < 0 || py < 0 || px > (t.nx - 1) * t.cell || py > (t.ny - 1) * t.cell) { tPrev = tt; continue; }
      if (pz < heightAtLocal(px, py)) {
        let lo = tPrev, hi = tt;
        for (let it = 0; it < 20; it++) {
          const mid = (lo + hi) / 2;
          const mx = eye[0] + dir[0] * mid, my = eye[1] + dir[1] * mid, mz = eye[2] + dir[2] * mid;
          if (mz < heightAtLocal(mx, my)) hi = mid; else lo = mid;
        }
        return [eye[0] + dir[0] * hi, eye[1] + dir[1] * hi];
      }
      tPrev = tt;
    }
    return null;
  }

  worldToScreen(x: number, y: number, z: number): [number, number] | null {
    const [cx, cy, , w] = mat4Transform(this.mvp, x, y, z);
    if (w <= 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    return [((cx / w) * 0.5 + 0.5) * rect.width, (0.5 - (cy / w) * 0.5) * rect.height];
  }

  private attachControls(): void {
    const c = this.canvas;
    let dragging = false, panning = false, lx = 0, ly = 0;
    let downX = 0, downY = 0, downBtn = 0;
    c.addEventListener('pointerdown', e => {
      dragging = true;
      panning = e.button === 2 || e.shiftKey;
      lx = e.clientX; ly = e.clientY;
      downX = e.clientX; downY = e.clientY; downBtn = e.button;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (panning) {
        const s = this.dist * 0.0012;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        this.target[0] -= (dx * -sy) * s;
        this.target[1] -= (dx * cy) * s;
        this.target[0] -= (dy * cy) * s * -1;
        this.target[1] -= (dy * sy) * s * -1;
      } else {
        this.yaw += dx * 0.005;
        this.pitch = Math.max(0.08, Math.min(1.5, this.pitch + dy * 0.004));
      }
    });
    c.addEventListener('pointerup', e => {
      dragging = false;
      // 位移很小的左键点击视为拾取
      if (downBtn === 0 && Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && this.onClick) {
        const rect = c.getBoundingClientRect();
        this.onClick(e.clientX - rect.left, e.clientY - rect.top);
      }
    });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.max(300, Math.min(15000, this.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  onClick: ((sx: number, sy: number) => void) | null = null;

  private loop(tms: number): void {
    if (this.destroyed) return;
    requestAnimationFrame(tt => this.loop(tt));
    this.frames++;
    if (tms - this.lastFpsT > 500) {
      this.fpsCb(Math.round((this.frames * 1000) / Math.max(1, tms - this.lastFpsT)));
      this.frames = 0;
      this.lastFpsT = tms;
    }
    this.render(tms / 1000);
  }

  private render(time: number): void {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.labelCanvas.width = w; this.labelCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = w / Math.max(1, h);
    const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 5, 40000);
    const eye = this.eye();
    this.camPos = eye;
    const view = mat4LookAt(eye, this.target, [0, 0, 1]);
    this.mvp = mat4Multiply(proj, view);
    const light: [number, number, number] = [0.5, 0.35, 0.79];

    // 地形
    if (this.terrainVAO) {
      gl.useProgram(this.progTerrain);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progTerrain, 'uMVP'), false, this.mvp);
      gl.uniform2f(gl.getUniformLocation(this.progTerrain, 'uElevRange'), this.elevRange[0], this.elevRange[1]);
      gl.uniform3f(gl.getUniformLocation(this.progTerrain, 'uLightDir'), light[0], light[1], light[2]);
      gl.uniform3f(gl.getUniformLocation(this.progTerrain, 'uCamPos'), eye[0], eye[1], eye[2]);
      gl.uniform1f(gl.getUniformLocation(this.progTerrain, 'uFogDist'), this.dist * 1.8);
      const useOv = this.overlayInfo ? 1 : 0;
      gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uUseOverlay'), useOv);
      if (this.overlayInfo) {
        gl.uniform2f(gl.getUniformLocation(this.progTerrain, 'uOverlayOrigin'), this.overlayInfo.originX, this.overlayInfo.originY);
        gl.uniform2f(gl.getUniformLocation(this.progTerrain, 'uOverlaySize'), this.overlayInfo.w, this.overlayInfo.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
        gl.uniform1i(gl.getUniformLocation(this.progTerrain, 'uOverlay'), 0);
      }
      gl.bindVertexArray(this.terrainVAO);
      gl.drawElements(gl.TRIANGLES, this.terrainCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    }

    // 实例网格
    gl.useProgram(this.progMesh);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progMesh, 'uMVP'), false, this.mvp);
    gl.uniform1f(gl.getUniformLocation(this.progMesh, 'uTime'), time);
    gl.uniform3f(gl.getUniformLocation(this.progMesh, 'uLightDir'), light[0], light[1], light[2]);
    for (const entry of this.meshVAOs.values()) {
      if (entry.count === 0) continue;
      gl.uniform3f(gl.getUniformLocation(this.progMesh, 'uBaseColor'), entry.color[0], entry.color[1], entry.color[2]);
      gl.bindVertexArray(entry.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, entry.geom.count, entry.count);
    }
    gl.bindVertexArray(null);

    // 线条
    if (this.lineVertexCount > 0) {
      gl.useProgram(this.progLine);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.progLine, 'uMVP'), false, this.mvp);
      gl.bindVertexArray(this.lineVAO);
      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
      gl.bindVertexArray(null);
    }

    // 标签
    const ctx = this.labelCtx;
    const dprW = this.labelCanvas.width, dprH = this.labelCanvas.height;
    ctx.clearRect(0, 0, dprW, dprH);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (const lb of this.labels) {
      const p = this.worldToScreen(lb.x, lb.y, lb.z);
      if (!p) continue;
      ctx.fillStyle = 'rgba(10,14,18,0.65)';
      const tw = ctx.measureText(lb.text).width;
      ctx.fillRect(p[0] - tw / 2 - 3, p[1] - 16, tw + 6, 15);
      ctx.fillStyle = lb.color;
      ctx.fillText(lb.text, p[0], p[1] - 4);
    }
    ctx.restore();
  }

  destroy(): void { this.destroyed = true; }
}

function colormap(t: number): [number, number, number] {
  // 蓝->青->绿->黄->红
  const stops: [number, [number, number, number]][] = [
    [0, [49, 54, 149]], [0.25, [69, 117, 180]], [0.5, [116, 173, 89]], [0.75, [254, 224, 144]], [1, [215, 48, 39]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return [215, 48, 39];
}

function norm3(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
