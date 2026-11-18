// 机位自动优化: 候选点池 + 贪心初始解 + 逐机位交换局部搜索, 目标全场净年发电量最大
// 迭代过程异步分片执行, 每片回调当前最优解供界面实时显示
import { Project, SectorStat, Turbine, Vec2 } from '../types';
import { buildWindTables, SiteWind } from './aep';
import { DrainageResult, inGullyBuffer, pointInPolygon } from './terrain';
import { getModel } from './turbines';
import { mulberry32 } from './rng';
import { sectorDeficits, wakeDecayK } from './wake';
import { SECTORS } from './wind';

export interface OptimizeOptions {
  count: number;          // 机位数
  seed: number;
  candidatePool: number;  // 候选点池规模
  sweeps: number;         // 局部搜索轮数
}

export interface OptimizeProgress {
  iteration: number;
  bestNet: number;        // MWh (含折减)
  positions: Vec2[];
  done: boolean;
}

const DEFICIT_MAX = 0.6;

export async function optimizeLayout(
  project: Project,
  mastStats: SectorStat[],
  drainage: DrainageResult,
  opts: OptimizeOptions,
  onProgress: (p: OptimizeProgress) => void,
  isCancelled: () => boolean,
): Promise<Turbine[]> {
  const t = project.terrain;
  const rand = mulberry32(opts.seed);
  const w = (t.nx - 1) * t.cell, h = (t.ny - 1) * t.cell;
  const model = getModel(project.settings.modelId);
  const hubH = project.settings.hubHeight;
  const minSpacing = project.settings.minSpacingRD * model.rotorD;
  const lossFactor =
    (1 - project.losses.availability) * (1 - project.losses.curtailment) *
    (1 - project.losses.soiling) * (1 - project.losses.station);

  // 1) 候选点池(满足区域/冲沟缓冲约束)
  const pool: Vec2[] = [];
  let guard = 0;
  while (pool.length < opts.candidatePool && guard++ < opts.candidatePool * 60) {
    const x = rand() * w, y = rand() * h;
    if (x < minSpacing / 2 || y < minSpacing / 2 || x > w - minSpacing / 2 || y > h - minSpacing / 2) continue;
    if (!pointInPolygon({ x, y }, project.candidate)) continue;
    if (inGullyBuffer(t, drainage.gullyMask, x, y)) continue;
    pool.push({ x, y });
  }
  const poolTurbines: Turbine[] = pool.map((p, i) => ({
    id: `cand${i}`, label: `C${i}`, x: p.x, y: p.y,
    modelId: project.settings.modelId, hubHeight: hubH,
  }));
  const wind = buildWindTables(project, mastStats, poolTurbines);
  const rotorR = model.rotorD / 2;

  // 子集净发电量快速核算
  const evalSel = (sel: number[]): number => {
    const k = wakeDecayK(hubH, 0.1);
    let total = 0;
    for (let s = 0; s < SECTORS; s++) {
      const wt = sel.map(i => ({ x: pool[i].x, y: pool[i].y, rotorR, ct: wind.tables[i].ct[s] }));
      const def = sectorDeficits(wt, (s * 360) / SECTORS, k);
      for (let m = 0; m < sel.length; m++) {
        const row = wind.tables[sel[m]].energy[s];
        const delta = Math.min(DEFICIT_MAX, def[m]);
        const pos = (delta / DEFICIT_MAX) * (row.length - 1);
        const i0 = Math.floor(pos), u = pos - i0;
        total += i0 >= row.length - 1 ? row[row.length - 1] : row[i0] + (row[i0 + 1] - row[i0]) * u;
      }
    }
    return total * lossFactor;
  };

  const farEnough = (sel: number[], cand: number, exceptPos = -1): boolean => {
    for (let m = 0; m < sel.length; m++) {
      if (m === exceptPos) continue;
      if (Math.hypot(pool[sel[m]].x - pool[cand].x, pool[sel[m]].y - pool[cand].y) < minSpacing) return false;
    }
    return true;
  };

  // 2) 贪心初始解: 逐台加入使当前总量最大
  let sel: number[] = [];
  const freeOrder = pool.map((_, i) => i).sort((a, b) => wind.tables[b].grossFree - wind.tables[a].grossFree);
  sel.push(freeOrder[0]);
  while (sel.length < opts.count) {
    let bestC = -1, bestV = -Infinity;
    for (let t2 = 0; t2 < 60; t2++) {
      const c = freeOrder[Math.floor(rand() * freeOrder.length)];
      if (sel.includes(c) || !farEnough(sel, c)) continue;
      const v = evalSel([...sel, c]);
      if (v > bestV) { bestV = v; bestC = c; }
    }
    // 随机抽样未命中时全池扫描兜底, 保证凑满台数
    if (bestC < 0) {
      for (const c of freeOrder) {
        if (sel.includes(c) || !farEnough(sel, c)) continue;
        const v = evalSel([...sel, c]);
        if (v > bestV) { bestV = v; bestC = c; }
      }
    }
    if (bestC < 0) break;
    sel.push(bestC);
    if (isCancelled()) return [];
    await new Promise(r => setTimeout(r, 0));
  }
  let best = evalSel(sel);
  let iter = 0;
  onProgress({ iteration: iter, bestNet: best, positions: sel.map(i => pool[i]), done: false });

  // 3) 局部搜索: 逐机位尝试换到更优候选点
  for (let sweep = 0; sweep < opts.sweeps; sweep++) {
    let improved = false;
    for (let m = 0; m < sel.length; m++) {
      for (let t2 = 0; t2 < 24; t2++) {
        const c = Math.floor(rand() * pool.length);
        if (sel.includes(c) || !farEnough(sel, c, m)) continue;
        const trial = [...sel];
        trial[m] = c;
        const v = evalSel(trial);
        iter++;
        if (v > best + 1e-6) {
          best = v; sel = trial; improved = true;
          onProgress({ iteration: iter, bestNet: best, positions: sel.map(i => pool[i]), done: false });
        }
      }
      if (iter % 200 === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (isCancelled()) return [];
      }
    }
    if (!improved) break;
  }
  onProgress({ iteration: iter, bestNet: best, positions: sel.map(i => pool[i]), done: true });
  return sel.map((i, m) => ({
    id: `T${String(m + 1).padStart(2, '0')}`,
    label: `T${String(m + 1).padStart(2, '0')}`,
    x: Math.round(pool[i].x), y: Math.round(pool[i].y),
    modelId: project.settings.modelId, hubHeight: hubH,
  }));
}
