// 噪声预测: 倍频程声功率级 -> 距离发散 + 大气吸收 + 地面吸收 + 地形遮挡(马厄卡瓦屏障衰减)
// 逐户昼夜等效声级核算, 超标户给出主导声源需退让距离
import { HouseNoise, Project, TerrainGrid } from '../types';
import { getModel } from './turbines';
import { heightAt, profileHeights } from './terrain';

const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const A_WEIGHT = [-26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];
// ISO 9613-1 大气吸收系数 dB/km (10°C, 70%RH)
const ATM_ABS = [0.1, 0.4, 1.0, 1.9, 3.7, 9.7, 32.8, 117.0];
const C0 = 343; // 声速 m/s

// 地形遮挡: 声源-接收点剖面上的最大衍射路径差 δ = a+b-d
function screeningDelta(t: TerrainGrid, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number {
  const prof = profileHeights(t, x1, y1, x2, y2, 20);
  const d = prof.d[prof.d.length - 1];
  let maxDelta = 0;
  for (let i = 1; i < prof.d.length - 1; i++) {
    const groundZ = prof.z[i];
    const lineZ = z1 + ((z2 - z1) * prof.d[i]) / d;
    if (groundZ > lineZ) {
      // 以该遮挡点为衍射顶点
      const a = Math.hypot(prof.d[i], groundZ - z1);
      const b = Math.hypot(d - prof.d[i], groundZ - z2);
      const straight = Math.hypot(d, z2 - z1);
      maxDelta = Math.max(maxDelta, a + b - straight);
    }
  }
  return maxDelta;
}

// 单机组到接收点的 A 计权声压级
export function turbineLevelAt(
  t: TerrainGrid,
  tx: number, ty: number, hubZ: number,
  rx: number, ry: number, rz: number,
  octaveLw: number[],
): number {
  const d = Math.max(10, Math.hypot(rx - tx, ry - ty));
  const delta = screeningDelta(t, tx, ty, hubZ, rx, ry, rz);
  const hm = Math.max(1, (hubZ + rz) / 2 - (heightAt(t, (tx + rx) / 2, (ty + ry) / 2)));
  let sumE = 0;
  for (let b = 0; b < 8; b++) {
    const aDiv = 20 * Math.log10(d) + 11;           // 半球面发散
    const aAtm = (ATM_ABS[b] * d) / 1000;
    const aGr = Math.max(0, 4.8 - ((2 * hm) / d) * (17 + 300 / d)); // 地面吸收
    let aBar = 0;
    if (delta > 0) {
      const lambda = C0 / BANDS[b];
      const N = (2 * delta) / lambda;               // 菲涅尔数
      const s = Math.sqrt(2 * Math.PI * Math.max(N, 1e-6));
      aBar = Math.min(25, 5 + 20 * Math.log10(s / Math.tanh(s))); // 马厄卡瓦
    }
    const lp = octaveLw[b] - aDiv - aAtm - aGr - aBar + A_WEIGHT[b];
    sumE += Math.pow(10, lp / 10);
  }
  return 10 * Math.log10(Math.max(1e-12, sumE));
}

export function assessNoise(project: Project): HouseNoise[] {
  const t = project.terrain;
  const { dayLimit, nightLimit } = project.settings;
  return project.houses.map(h => {
    const rz = heightAt(t, h.x, h.y) + 1.5; // 受声点 1.5m
    let sumE = 0;
    let dominant: string | null = null, domLevel = -Infinity, domDist = 0;
    for (const tb of project.turbines) {
      const model = getModel(tb.modelId);
      const hubZ = heightAt(t, tb.x, tb.y) + tb.hubHeight;
      const lp = turbineLevelAt(t, tb.x, tb.y, hubZ, h.x, h.y, rz, model.octaveLw);
      sumE += Math.pow(10, lp / 10);
      if (lp > domLevel) {
        domLevel = lp; dominant = tb.id;
        domDist = Math.hypot(h.x - tb.x, h.y - tb.y);
      }
    }
    const level = 10 * Math.log10(Math.max(1e-12, sumE));
    const exceedDay = level > dayLimit, exceedNight = level > nightLimit;
    // 需退让距离: 按发散主导近似, 全体声源距离同比放大使总级达标
    const worst = Math.max(dayLimit, nightLimit);
    const target = exceedNight ? nightLimit : worst;
    let setback = 0;
    if (level > target && domDist > 0) {
      const scale = Math.pow(10, (level - target) / 20);
      setback = Math.ceil((domDist * (scale - 1)) / 5) * 5;
    }
    return {
      houseId: h.id, level: Math.round(level * 10) / 10,
      dayLimit, nightLimit, exceedDay, exceedNight,
      setbackM: setback, dominant,
    };
  });
}
