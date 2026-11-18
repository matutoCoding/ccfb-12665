// 机型库: 功率曲线(标准空气密度 1.225 kg/m3)、推力系数、倍频程声功率级、吊装平台参数
import { PowerCurvePoint, TurbineModel } from '../types';

function makeCurve(ratedKW: number, cutIn: number, ratedV: number, cutOut: number): PowerCurvePoint[] {
  const pts: PowerCurvePoint[] = [];
  for (let v = 0; v <= 25.001; v += 0.5) {
    let p = 0;
    if (v >= cutIn && v < ratedV) p = ratedKW * (v ** 3 - cutIn ** 3) / (ratedV ** 3 - cutIn ** 3);
    else if (v >= ratedV && v <= cutOut) p = ratedKW;
    // 推力系数: 切入到额定之间较高, 额定后变桨卸载
    let ct = 0;
    if (v >= cutIn && v <= cutOut) {
      if (v < ratedV) ct = 0.82 - 0.25 * (v - cutIn) / (ratedV - cutIn);
      else ct = 0.57 * (ratedV / v) ** 2;
      ct = Math.max(0.06, ct);
    }
    pts.push({ v, p: Math.round(p * 10) / 10, ct });
  }
  return pts;
}

export const TURBINE_MODELS: TurbineModel[] = [
  {
    id: 'WD5000-191', name: 'WD5.0-191 山地型', ratedKW: 5000, rotorD: 191,
    hubHeights: [100, 110, 120], cutIn: 2.5, cutOut: 25,
    curve: makeCurve(5000, 2.5, 10.2, 25),
    octaveLw: [95, 97, 100, 102, 101, 99, 95, 89],
    iecClass: 'B', tiRef: 0.14,
    pad: { width: 35, length: 50, slopeRatio: 1.5 },
  },
  {
    id: 'WD6250-200', name: 'WD6.25-200 大叶轮', ratedKW: 6250, rotorD: 200,
    hubHeights: [110, 120, 140], cutIn: 2.5, cutOut: 24,
    curve: makeCurve(6250, 2.5, 9.8, 24),
    octaveLw: [96, 98, 101, 103, 102, 100, 96, 90],
    iecClass: 'C', tiRef: 0.12,
    pad: { width: 40, length: 55, slopeRatio: 1.5 },
  },
  {
    id: 'WD4500-170', name: 'WD4.5-170 高塔筒', ratedKW: 4500, rotorD: 170,
    hubHeights: [95, 110, 125], cutIn: 2.5, cutOut: 25,
    curve: makeCurve(4500, 2.5, 10.6, 25),
    octaveLw: [94, 96, 99, 101, 100, 98, 94, 88],
    iecClass: 'A', tiRef: 0.16,
    pad: { width: 32, length: 45, slopeRatio: 1.75 },
  },
];

export function getModel(id: string): TurbineModel {
  const m = TURBINE_MODELS.find(m => m.id === id);
  if (!m) throw new Error(`未知机型 ${id}`);
  return m;
}

// IEC 61400-1 各类别 15 m/s 特征湍流强度参考值
export const IEC_TI_REF = { A: 0.16, B: 0.14, C: 0.12 } as const;
