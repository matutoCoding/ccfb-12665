// Jensen (PARK) 尾流模型: 逐机位、逐扇区风速亏损解析, 面积加权部分遮挡, 平方和叠加
// 与 WAsP PARK 模型同构: 单尾流中心线亏损 (1-sqrt(1-Ct)) * (r0/(r0+kx))^2
export interface WakeTurbine {
  x: number; y: number;
  rotorR: number;   // 叶轮半径 m
  ct: number;       // 来流风速下推力系数(取额定前代表值)
}

// 尾流衰减常数: Jensen 推荐 k = 1 / (2 ln(z_hub / z0))
export function wakeDecayK(hubHeight: number, z0: number): number {
  return 1 / (2 * Math.log(hubHeight / Math.max(0.01, z0)));
}

// 两圆重叠面积(尾流截面与下游叶轮)
export function overlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const t = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return a1 + a2 - t;
}

// 单扇区(风向 dirDeg 为风的来向)各机组组合风速亏损
export function sectorDeficits(turbs: WakeTurbine[], dirDeg: number, k: number): number[] {
  const n = turbs.length;
  const sumSq = new Array<number>(n).fill(0);
  // 风向单位向量(指向下游)
  const rad = ((dirDeg + 180) * Math.PI) / 180;
  const dx = Math.sin(rad), dy = Math.cos(rad);
  // 沿风向投影排序, 只考虑上游机组
  const proj = turbs.map((t, i) => ({ i, s: t.x * dx + t.y * dy }));
  proj.sort((a, b) => a.s - b.s);
  for (let a = 0; a < n; a++) {
    const up = turbs[proj[a].i];
    for (let b = a + 1; b < n; b++) {
      const dn = turbs[proj[b].i];
      const x = proj[b].s - proj[a].s; // 下游距离
      if (x <= 0.5) continue;
      const cross = Math.abs((dn.x - up.x) * dy - (dn.y - up.y) * dx);
      const rw = up.rotorR + k * x; // 尾流半径
      if (cross >= rw + dn.rotorR) continue;
      const full = (1 - Math.sqrt(1 - up.ct)) * (up.rotorR / rw) ** 2;
      const frac = overlapArea(rw, dn.rotorR, cross) / (Math.PI * dn.rotorR * dn.rotorR);
      const def = full * frac;
      sumSq[proj[b].i] += def * def;
    }
  }
  return sumSq.map(s => Math.min(0.95, Math.sqrt(s)));
}

// 全部扇区: 返回 deficits[turbine][sector]
export function allSectorDeficits(turbs: WakeTurbine[], k: number, sectors: number): number[][] {
  const out: number[][] = turbs.map(() => new Array(sectors).fill(0));
  for (let s = 0; s < sectors; s++) {
    const d = sectorDeficits(turbs, s * (360 / sectors), k);
    for (let i = 0; i < turbs.length; i++) out[i][s] = d[i];
  }
  return out;
}

// 解析校验: 单机组下游 x 处中心线亏损(与 WAsP 算例对比用)
export function analyticCenterlineDeficit(ct: number, xOverD: number, k: number): number {
  return (1 - Math.sqrt(1 - ct)) / (1 + 2 * k * xOverD) ** 2;
}
