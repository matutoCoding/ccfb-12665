// 吊装平台自动设计与挖填方核算
// 平台尺寸/边坡坡比由机型决定, 平台走向取挖填量最小的方向, 逐台核算、全场汇总
import { EarthworkResult, PadDesign, Project, TerrainGrid, Turbine, Vec2 } from '../types';
import { getModel } from './turbines';
import { heightAt } from './terrain';

const SAMPLE = 5;        // 土方采样间距 m
const MAX_SLOPE_REACH = 60; // 边坡最大影响范围 m

interface PadGeom { angle: number; z: number; cut: number; fill: number; reach: number }

// 某走向下平台土方试算
function tryPad(t: TerrainGrid, x: number, y: number, w: number, l: number, slopeRatio: number, angle: number): PadGeom {
  // 平台高程取平台范围内地形平均值
  let zSum = 0, zCnt = 0;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let u = -l / 2; u <= l / 2; u += SAMPLE) {
    for (let v = -w / 2; v <= w / 2; v += SAMPLE) {
      zSum += heightAt(t, x + u * ca - v * sa, y + u * sa + v * ca);
      zCnt++;
    }
  }
  const z = zSum / zCnt;
  // 预估最大高差确定边坡影响半径
  let maxDz = 0;
  for (let u = -l / 2; u <= l / 2; u += SAMPLE) {
    for (let v = -w / 2; v <= w / 2; v += SAMPLE) {
      maxDz = Math.max(maxDz, Math.abs(heightAt(t, x + u * ca - v * sa, y + u * sa + v * ca) - z));
    }
  }
  const reach = Math.min(MAX_SLOPE_REACH, maxDz * slopeRatio + SAMPLE);
  let cut = 0, fill = 0;
  const halfL = l / 2, halfW = w / 2;
  const R = Math.hypot(halfL, halfW) + reach;
  for (let dx = -R; dx <= R; dx += SAMPLE) {
    for (let dy = -R; dy <= R; dy += SAMPLE) {
      const px = x + dx, py = y + dy;
      // 转换到平台局部坐标
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const du = Math.max(0, Math.abs(u) - halfL);
      const dv = Math.max(0, Math.abs(v) - halfW);
      const d = Math.hypot(du, dv); // 到平台边缘的距离
      if (d > reach) continue;
      const zt = heightAt(t, px, py);
      const area = SAMPLE * SAMPLE;
      if (d === 0) {
        const dz = zt - z;
        if (dz > 0) cut += dz * area; else fill += -dz * area;
      } else if (zt > z) {
        // 挖方边坡: 自平台边以 1:slopeRatio 向上放坡
        const target = z + d / slopeRatio;
        if (zt > target) cut += (zt - target) * area;
      } else if (zt < z) {
        // 填方边坡: 自平台边向下放坡
        const target = z - d / slopeRatio;
        if (zt < target) fill += (target - zt) * area;
      }
    }
  }
  return { angle, z, cut, fill, reach };
}

export function designPad(t: TerrainGrid, turbine: Turbine): PadDesign {
  const model = getModel(turbine.modelId);
  const { width, length, slopeRatio } = model.pad;
  let best: PadGeom | null = null;
  for (let a = 0; a < 180; a += 15) {
    const g = tryPad(t, turbine.x, turbine.y, width, length, slopeRatio, (a * Math.PI) / 180);
    if (!best || g.cut + g.fill < best.cut + best.fill) best = g;
  }
  const b = best!;
  // 边坡占地范围: 平台矩形外扩影响半径后的八边形轮廓
  const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
  const hl = length / 2 + b.reach, hw = width / 2 + b.reach;
  const corners: Vec2[] = [
    { x: -hl, y: -hw }, { x: hl, y: -hw }, { x: hl, y: hw }, { x: -hl, y: hw },
  ].map(p => ({ x: turbine.x + p.x * ca - p.y * sa, y: turbine.y + p.x * sa + p.y * ca }));
  return {
    turbineId: turbine.id,
    x: turbine.x, y: turbine.y, angle: b.angle,
    w: width, l: length, z: b.z, slopeRatio,
    cut: Math.round(b.cut), fill: Math.round(b.fill),
    footprint: corners,
  };
}

export function designAllPads(project: Project): EarthworkResult {
  const pads = project.turbines.map(t => designPad(project.terrain, t));
  return {
    pads,
    totalCut: pads.reduce((a, p) => a + p.cut, 0),
    totalFill: pads.reduce((a, p) => a + p.fill, 0),
  };
}

// 将平台与边坡应用到地形网格(三维中展示开挖效果), 返回新地形
export function applyPadsToTerrain(t: TerrainGrid, pads: PadDesign[]): TerrainGrid {
  const z = new Float32Array(t.z);
  for (const p of pads) {
    const slopeRatio = p.slopeRatio;
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const hl = p.l / 2, hw = p.w / 2;
    const R = Math.hypot(hl, hw) + MAX_SLOPE_REACH;
    const i0 = Math.max(0, Math.floor((p.x - R - t.originX) / t.cell));
    const i1 = Math.min(t.nx - 1, Math.ceil((p.x + R - t.originX) / t.cell));
    const j0 = Math.max(0, Math.floor((p.y - R - t.originY) / t.cell));
    const j1 = Math.min(t.ny - 1, Math.ceil((p.y + R - t.originY) / t.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = t.originX + i * t.cell, y = t.originY + j * t.cell;
        const dx = x - p.x, dy = y - p.y;
        const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        const du = Math.max(0, Math.abs(u) - hl);
        const dv = Math.max(0, Math.abs(v) - hw);
        const d = Math.hypot(du, dv);
        const k = j * t.nx + i;
        const zt = t.z[k];
        if (d === 0) { z[k] = p.z; continue; }
        if (zt > p.z) {
          const target = p.z + d / slopeRatio;
          if (zt > target) z[k] = target;
        } else {
          const target = p.z - d / slopeRatio;
          if (zt < target) z[k] = target;
        }
      }
    }
  }
  return { ...t, z };
}
