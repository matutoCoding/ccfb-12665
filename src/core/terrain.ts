// 地形建模: DEM 生成、D8 汇流、山脊线/冲沟自动提取
import { TerrainGrid, Vec2 } from '../types';
import { fbm, ridged } from './rng';

export function generateTerrain(seed: number, nx: number, ny: number, cell: number): TerrainGrid {
  const z = new Float32Array(nx * ny);
  const s1 = 3.2 / (nx * cell); // 大尺度起伏频率
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * cell, y = j * cell;
      const r = ridged(x * s1, y * s1, 5, seed);
      const base = fbm(x * s1 * 0.7 + 31, y * s1 * 0.7 + 17, 3, seed + 7);
      // 边缘略抬升形成完整流域, 中部山脊高耸
      const ex = Math.abs(i / (nx - 1) - 0.5) * 2, ey = Math.abs(j / (ny - 1) - 0.5) * 2;
      const edge = Math.max(ex, ey);
      z[j * nx + i] = 480 + r * 420 + base * 120 + edge * edge * 60;
    }
  }
  // 轻度平滑去毛刺
  const z2 = new Float32Array(z);
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      z2[k] = z[k] * 0.6 + (z[k - 1] + z[k + 1] + z[k - nx] + z[k + nx]) * 0.1;
    }
  }
  return { nx, ny, cell, originX: 0, originY: 0, z: z2 };
}

export function heightAt(t: TerrainGrid, x: number, y: number): number {
  const fx = (x - t.originX) / t.cell, fy = (y - t.originY) / t.cell;
  const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(t.ny - 2, Math.floor(fy)));
  const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j));
  const k = j * t.nx + i;
  const a = t.z[k], b = t.z[k + 1], c = t.z[k + t.nx], d = t.z[k + t.nx + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function slopeAt(t: TerrainGrid, x: number, y: number): number {
  const d = t.cell;
  const dzdx = (heightAt(t, x + d, y) - heightAt(t, x - d, y)) / (2 * d);
  const dzdy = (heightAt(t, x, y + d) - heightAt(t, x, y - d)) / (2 * d);
  return Math.hypot(dzdx, dzdy);
}

// D8 流向与汇流累积量。invert=true 时在地形反向上计算 -> 山脊汇流
export function flowAccumulation(t: TerrainGrid, invert = false): { down: Int32Array; acc: Float32Array } {
  const n = t.nx * t.ny;
  const down = new Int32Array(n).fill(-1);
  const acc = new Float32Array(n).fill(1);
  const z = t.z, nx = t.nx, ny = t.ny;
  const sgn = invert ? -1 : 1;
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let best = 0, bestK = -1;
      for (let d = 0; d < 8; d++) {
        const ii = i + DX[d], jj = j + DY[d];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        const dist = d % 2 === 0 ? t.cell : t.cell * Math.SQRT2;
        const drop = (z[k] - z[kk]) * sgn / dist;
        if (drop > best) { best = drop; bestK = kk; }
      }
      down[k] = bestK;
    }
  }
  // 按高程排序后自高向低累积
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const key = invert ? Float32Array.from(z, v => -v) : z;
  order.sort((a, b) => key[b] - key[a]);
  for (let m = 0; m < n; m++) {
    const k = order[m];
    const d = down[k];
    if (d >= 0) acc[d] += acc[k];
  }
  return { down, acc };
}

export interface DrainageResult {
  gullySegs: Float32Array;   // 冲沟线段 x1,y1,z1,x2,y2,z2 (世界坐标)
  ridgeSegs: Float32Array;   // 山脊线段
  gullyMask: Uint8Array;     // 汇水冲沟缓冲区(禁止机位/道路)
  ridgeCells: number[];      // 山脊线经过的网格索引(排机位参考)
}

export function extractDrainage(t: TerrainGrid, accThresholdCells: number, bufferM: number): DrainageResult {
  const gully = flowAccumulation(t, false);
  const ridge = flowAccumulation(t, true);
  const nx = t.nx, ny = t.ny;
  const gSegs: number[] = [], rSegs: number[] = [];
  const gullyMask = new Uint8Array(nx * ny);
  const ridgeCells: number[] = [];
  const center = (k: number): [number, number, number] => {
    const i = k % nx, j = (k / nx) | 0;
    return [t.originX + i * t.cell, t.originY + j * t.cell, t.z[k]];
  };
  for (let k = 0; k < nx * ny; k++) {
    if (gully.acc[k] >= accThresholdCells) {
      gullyMask[k] = 1;
      const d = gully.down[k];
      if (d >= 0) {
        const [x1, y1, z1] = center(k), [x2, y2, z2] = center(d);
        gSegs.push(x1, y1, z1 + 2, x2, y2, z2 + 2);
      }
    }
    if (ridge.acc[k] >= accThresholdCells * 0.7) {
      ridgeCells.push(k);
      const d = ridge.down[k];
      if (d >= 0 && ridge.acc[d] >= accThresholdCells * 0.35) {
        const [x1, y1, z1] = center(k), [x2, y2, z2] = center(d);
        rSegs.push(x1, y1, z1 + 2, x2, y2, z2 + 2);
      }
    }
  }
  // 冲沟缓冲区膨胀
  const rad = Math.max(1, Math.round(bufferM / t.cell));
  const dilated = new Uint8Array(gullyMask);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!gullyMask[j * nx + i]) continue;
      for (let dj = -rad; dj <= rad; dj++) {
        for (let di = -rad; di <= rad; di++) {
          if (di * di + dj * dj > rad * rad) continue;
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) dilated[jj * nx + ii] = 1;
        }
      }
    }
  }
  return {
    gullySegs: new Float32Array(gSegs),
    ridgeSegs: new Float32Array(rSegs),
    gullyMask: dilated,
    ridgeCells,
  };
}

export function inGullyBuffer(t: TerrainGrid, mask: Uint8Array, x: number, y: number): boolean {
  const i = Math.round((x - t.originX) / t.cell), j = Math.round((y - t.originY) / t.cell);
  if (i < 0 || j < 0 || i >= t.nx || j >= t.ny) return true;
  return mask[j * t.nx + i] === 1;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// 沿剖面采样高程(噪声遮挡、线缆长度用)
export function profileHeights(t: TerrainGrid, x1: number, y1: number, x2: number, y2: number, step: number): { d: number[]; z: number[] } {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(2, Math.ceil(len / step));
  const d: number[] = [], z: number[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    d.push(s * len);
    z.push(heightAt(t, x1 + (x2 - x1) * s, y1 + (y2 - y1) * s));
  }
  return { d, z };
}
