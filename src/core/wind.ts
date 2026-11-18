// 风资源分析: 威布尔拟合(MLE)、风切变、空气密度修正、功率曲线积分、湍流强度
import { MetMast, SectorStat } from '../types';
import { PowerCurvePoint } from '../types';

export const SECTORS = 12;
export const SECTOR_W = 360 / SECTORS;
export const RHO0 = 1.225;

export function sectorIndex(dirDeg: number): number {
  return Math.floor((((dirDeg % 360) + 360) % 360 + SECTOR_W / 2) / SECTOR_W) % SECTORS;
}

// 威布尔 MLE 拟合(牛顿迭代求 k)
export function fitWeibull(samples: ArrayLike<number>): { A: number; k: number } {
  const v: number[] = [];
  for (let i = 0; i < samples.length; i++) if (samples[i] > 0.5) v.push(samples[i]);
  if (v.length < 10) return { A: 0, k: 2 };
  const n = v.length;
  let k = 2;
  for (let it = 0; it < 30; it++) {
    let svk = 0, svkln = 0, svkln2 = 0, sln = 0;
    for (const x of v) {
      const xk = Math.pow(x, k), ln = Math.log(x);
      svk += xk; svkln += xk * ln; svkln2 += xk * ln * ln; sln += ln;
    }
    const f = svkln / svk - sln / n - 1 / k;
    const df = svkln2 / svk - (svkln / svk) ** 2 + 1 / (k * k);
    const dk = f / df;
    k -= dk;
    if (Math.abs(dk) < 1e-6) break;
    k = Math.max(0.5, Math.min(10, k));
  }
  let svk = 0;
  for (const x of v) svk += Math.pow(x, k);
  const A = Math.pow(svk / n, 1 / k);
  return { A, k };
}

// 测风塔逐时数据 -> 分扇区威布尔/频率/湍流强度/切变
export function mastSectorStats(mast: MetMast): SectorStat {
  const top = mast.heights.length - 1;
  const speed = mast.speed[top], dir = mast.dir;
  const n = mast.hours;
  const bySector: number[][] = Array.from({ length: SECTORS }, () => []);
  const tiNum = new Array(SECTORS).fill(0); // 13.5~16.5 m/s 区间统计
  const tiSum = new Array(SECTORS).fill(0);
  const tiSq = new Array(SECTORS).fill(0);
  for (let i = 0; i < n; i++) {
    const s = sectorIndex(dir[i]);
    bySector[s].push(speed[i]);
    if (speed[i] >= 13.5 && speed[i] <= 16.5) {
      tiNum[s]++; tiSum[s] += speed[i]; tiSq[s] += speed[i] * speed[i];
    }
  }
  const freq = new Array(SECTORS).fill(0);
  const A = new Array(SECTORS).fill(0), k = new Array(SECTORS).fill(2);
  const ti15 = new Array(SECTORS).fill(0);
  for (let s = 0; s < SECTORS; s++) {
    freq[s] = bySector[s].length / n;
    const w = fitWeibull(bySector[s]);
    A[s] = w.A; k[s] = w.k;
    if (tiNum[s] > 5) {
      const mean = tiSum[s] / tiNum[s];
      const sd = Math.sqrt(Math.max(0, tiSq[s] / tiNum[s] - mean * mean));
      ti15[s] = sd / mean;
    }
  }
  // 分扇区风切变: 各高度层扇区平均风速 -> 幂律最小二乘
  const alpha = new Array(SECTORS).fill(0.14);
  const H = mast.heights.length;
  for (let s = 0; s < SECTORS; s++) {
    const sumV = new Array(H).fill(0), cnt = new Array(H).fill(0);
    for (let i = 0; i < n; i++) {
      if (sectorIndex(dir[i]) !== s) continue;
      for (let h = 0; h < H; h++) { sumV[h] += mast.speed[h][i]; cnt[h]++; }
    }
    let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
    for (let h = 0; h < H; h++) {
      if (cnt[h] < 20 || sumV[h] <= 0) continue;
      const lx = Math.log(mast.heights[h]), ly = Math.log(sumV[h] / cnt[h]);
      sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; m++;
    }
    if (m >= 2) {
      const a = (m * sxy - sx * sy) / (m * sxx - sx * sx);
      alpha[s] = Math.max(0.02, Math.min(0.6, a));
    }
  }
  return { freq, A, k, ti15, alpha };
}

// 整体湍流强度(15 m/s 特征值, 各扇区最大)
export function overallTI15(st: SectorStat): number {
  let m = 0;
  for (const t of st.ti15) m = Math.max(m, t);
  return m;
}

// 国际标准大气空气密度 kg/m3
export function airDensity(altitudeM: number): number {
  return RHO0 * Math.pow(1 - 2.2558e-5 * altitudeM, 4.2577);
}

// 功率曲线空气密度修正(IEC 61400-12 思路): 额定功率以下 P ∝ ρ, 额定段不变
export function densityCorrectCurve(curve: PowerCurvePoint[], rho: number, ratedKW: number): PowerCurvePoint[] {
  const ratio = rho / RHO0;
  return curve.map(p => ({
    v: p.v,
    p: Math.min(ratedKW, p.p < ratedKW * 0.999 ? p.p * ratio : p.p),
    ct: p.ct,
  }));
}

// 威布尔分箱功率积分: E[P] = Σ P(v_mid) * (F(v2)-F(v1)), 返回平均功率 kW
export function weibullMeanPower(curve: PowerCurvePoint[], A: number, k: number): number {
  if (A <= 0) return 0;
  let e = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const v1 = curve[i].v, v2 = curve[i + 1].v;
    const p = (curve[i].p + curve[i + 1].p) / 2;
    if (p <= 0) continue;
    const prob = Math.exp(-Math.pow(v1 / A, k)) - Math.exp(-Math.pow(v2 / A, k));
    e += p * prob;
  }
  // 截断在 25 m/s 以上按切出处理(曲线已含 cutOut)
  return e;
}

// 幂律垂直外推
export function extrapolate(vRef: number, zRef: number, z: number, alpha: number): number {
  return vRef * Math.pow(z / zRef, alpha);
}

// 逆距离加权插值
export function idw(xs: number[], ys: number[], vals: number[], x: number, y: number, power = 2): number {
  let wsum = 0, vsum = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.hypot(xs[i] - x, ys[i] - y);
    if (d < 1) return vals[i];
    const w = 1 / Math.pow(d, power);
    wsum += w; vsum += vals[i] * w;
  }
  return vsum / wsum;
}
