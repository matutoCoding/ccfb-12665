// 年发电量(AEP)核算引擎: 分扇区威布尔 × 密度修正功率曲线 × Jensen 尾流 × 逐项折减
import { AEPResult, MetMast, Project, SectorStat, Turbine, TurbineAEP } from '../types';
import { getModel } from './turbines';
import { airDensity, densityCorrectCurve, idw, SECTORS, weibullMeanPower } from './wind';
import { allSectorDeficits, sectorDeficits, wakeDecayK, WakeTurbine } from './wake';
import { heightAt } from './terrain';

// Lanczos 伽马函数
export function gamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function weibullMean(A: number, k: number): number {
  return A * gamma(1 + 1 / k);
}

const DEFICIT_STEPS = 31;      // δ: 0..0.6 步长 0.02
const DEFICIT_MAX = 0.6;

export interface TurbineWindTable {
  // 每机位每扇区: 不同风速亏损比例下的年发电量(MWh), 用于尾流迭代快速查表
  energy: Float32Array[];   // [sector][DEFICIT_STEPS]
  freeMeanV: number[];      // 每扇区自由流平均风速
  ct: number[];             // 每扇区代表推力系数
  freq: number[];
  grossFree: number;        // 无尾流年发电量 MWh
}

export interface SiteWind {
  tables: TurbineWindTable[];
  sectorStats: SectorStat[]; // 各测风塔
}

// 为给定机位集合构建风资源查算表(换机型/轮毂高度/测风数据时重建)
export function buildWindTables(project: Project, mastStats: SectorStat[], turbines: Turbine[]): SiteWind {
  const masts = project.masts;
  const mx = masts.map(m => m.x), my = masts.map(m => m.y);
  const tables: TurbineWindTable[] = turbines.map(t => {
    const model = getModel(t.modelId);
    const zGround = heightAt(project.terrain, t.x, t.y);
    const rho = airDensity(zGround + t.hubHeight / 2); // 按轮毂处海拔修正
    const curve = densityCorrectCurve(model.curve, rho, model.ratedKW);
    const energy: Float32Array[] = [];
    const freeMeanV: number[] = [];
    const ct: number[] = [];
    const freq: number[] = [];
    let grossFree = 0;
    for (let s = 0; s < SECTORS; s++) {
      // 各塔分扇区参数外推到轮毂高度后 IDW 插值
      const As = mastStats.map((st, mi) => {
        const zRef = masts[mi].heights[masts[mi].heights.length - 1];
        return st.A[s] * Math.pow(t.hubHeight / zRef, st.alpha[s]);
      });
      const ks = mastStats.map(st => st.k[s]);
      const fs = mastStats.map(st => st.freq[s]);
      const A = idw(mx, my, As, t.x, t.y);
      const k = Math.max(1.2, idw(mx, my, ks, t.x, t.y));
      const f = idw(mx, my, fs, t.x, t.y);
      freq.push(f);
      freeMeanV.push(weibullMean(A, k));
      // 代表推力系数取扇区平均风速处值
      const vMean = weibullMean(A, k);
      ct.push(ctAt(model.curve, vMean));
      const row = new Float32Array(DEFICIT_STEPS);
      for (let d = 0; d < DEFICIT_STEPS; d++) {
        const delta = (d / (DEFICIT_STEPS - 1)) * DEFICIT_MAX;
        row[d] = (weibullMeanPower(curve, A * (1 - delta), k) * 8760 * f) / 1000; // MWh
      }
      grossFree += row[0];
      energy.push(row);
    }
    return { energy, freeMeanV, ct, freq, grossFree };
  });
  return { tables, sectorStats: mastStats };
}

function ctAt(curve: { v: number; ct: number }[], v: number): number {
  if (v <= curve[0].v) return curve[0].ct;
  for (let i = 0; i < curve.length - 1; i++) {
    if (v >= curve[i].v && v <= curve[i + 1].v) {
      const u = (v - curve[i].v) / (curve[i + 1].v - curve[i].v);
      return curve[i].ct + (curve[i + 1].ct - curve[i].ct) * u;
    }
  }
  return curve[curve.length - 1].ct;
}

function lossFactor(project: Project): number {
  const L = project.losses;
  return (1 - L.availability) * (1 - L.curtailment) * (1 - L.soiling) * (1 - L.station);
}

// 尾流+折减全场核算。z0 取场地代表粗糙度
export function evaluateAEP(project: Project, wind: SiteWind, turbines: Turbine[]): AEPResult {
  const z0 = 0.1;
  const wt: WakeTurbine[] = turbines.map(t => {
    const model = getModel(t.modelId);
    return { x: t.x, y: t.y, rotorR: model.rotorD / 2, ct: 0.75 }; // ct 初值, 下按扇区修正
  });
  // 逐扇区: 用各机位该扇区代表 ct 计算亏损
  const deficits: number[][] = turbines.map(() => new Array(SECTORS).fill(0));
  const k = wakeDecayK(turbines[0]?.hubHeight ?? 100, z0);
  for (let s = 0; s < SECTORS; s++) {
    for (let i = 0; i < turbines.length; i++) wt[i].ct = wind.tables[i].ct[s];
    const d = sectorDeficits(wt, (s * 360) / SECTORS, k);
    for (let i = 0; i < turbines.length; i++) deficits[i][s] = d[i];
  }
  const lf = lossFactor(project);
  const per: TurbineAEP[] = turbines.map((t, i) => {
    const tbl = wind.tables[i];
    let gross = 0, waked = 0, meanDef = 0;
    for (let s = 0; s < SECTORS; s++) {
      const row = tbl.energy[s];
      gross += row[0];
      const delta = Math.min(DEFICIT_MAX, deficits[i][s]);
      const pos = (delta / DEFICIT_MAX) * (DEFICIT_STEPS - 1);
      const i0 = Math.floor(pos), u = pos - i0;
      const e = i0 >= DEFICIT_STEPS - 1 ? row[DEFICIT_STEPS - 1] : row[i0] + (row[i0 + 1] - row[i0]) * u;
      waked += e;
      meanDef += tbl.freq[s] * delta;
    }
    return {
      id: t.id,
      gross,
      net: waked * lf,
      wakeLoss: gross > 0 ? 1 - waked / gross : 0,
      meanDeficit: meanDef,
    };
  });
  const totalGross = per.reduce((a, b) => a + b.gross, 0);
  const totalNet = per.reduce((a, b) => a + b.net, 0);
  const totalWaked = per.reduce((a, b) => a + b.gross * (1 - b.wakeLoss), 0);
  const ratedTotal = turbines.reduce((a, t) => a + getModel(t.modelId).ratedKW, 0);
  return {
    per,
    totalGross,
    totalNet,
    wakeLossPct: totalGross > 0 ? (1 - totalWaked / totalGross) * 100 : 0,
    capacityFactor: ratedTotal > 0 ? totalNet / ((ratedTotal * 8760) / 1000) : 0,
  };
}

// 50m 网格全场风资源图: 平均风速与单机年发电量(自由流)
export interface GridMap {
  nx: number; ny: number; cell: number;
  originX: number; originY: number;
  meanV: Float32Array;
  aep: Float32Array; // MWh/年
}

export function computeGridMap(project: Project, mastStats: SectorStat[], modelId: string, hubHeight: number, cell = 50): GridMap {
  const t = project.terrain;
  const nx = Math.floor((t.nx - 1) * t.cell / cell) + 1;
  const ny = Math.floor((t.ny - 1) * t.cell / cell) + 1;
  const meanV = new Float32Array(nx * ny);
  const aep = new Float32Array(nx * ny);
  const model = getModel(modelId);
  const masts = project.masts;
  const mx = masts.map(m => m.x), my = masts.map(m => m.y);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = t.originX + i * cell, y = t.originY + j * cell;
      const zGround = heightAt(t, x, y);
      const rho = airDensity(zGround + hubHeight / 2);
      const curve = densityCorrectCurve(model.curve, rho, model.ratedKW);
      let vSum = 0, eSum = 0;
      for (let s = 0; s < SECTORS; s++) {
        const As = mastStats.map((st, mi) => {
          const zRef = masts[mi].heights[masts[mi].heights.length - 1];
          return st.A[s] * Math.pow(hubHeight / zRef, st.alpha[s]);
        });
        const ks = mastStats.map(st => st.k[s]);
        const fs = mastStats.map(st => st.freq[s]);
        const A = idw(mx, my, As, x, y);
        const k = Math.max(1.2, idw(mx, my, ks, x, y));
        const f = idw(mx, my, fs, x, y);
        vSum += f * weibullMean(A, k);
        eSum += (weibullMeanPower(curve, A, k) * 8760 * f) / 1000;
      }
      meanV[j * nx + i] = vSum;
      aep[j * nx + i] = eSum;
    }
  }
  return { nx, ny, cell, originX: t.originX, originY: t.originY, meanV, aep };
}
