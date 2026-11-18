// 全局数据类型定义
export interface Vec2 { x: number; y: number }

export interface TerrainGrid {
  nx: number; ny: number;       // 网格数
  cell: number;                 // 网格间距 m
  originX: number; originY: number; // 左下角坐标
  z: Float32Array;              // nx*ny 高程
}

export interface PowerCurvePoint { v: number; p: number; ct: number } // v m/s, p kW, ct 推力系数

export interface TurbineModel {
  id: string;
  name: string;
  ratedKW: number;
  rotorD: number;               // 叶轮直径 m
  hubHeights: number[];         // 可选轮毂高度
  cutIn: number; cutOut: number;
  curve: PowerCurvePoint[];
  octaveLw: number[];           // 63..8kHz 八个倍频程声功率级 dB
  iecClass: 'A' | 'B' | 'C';    // IEC 湍流类别
  tiRef: number;                // 该类别 15m/s 特征湍流强度上限
  pad: { width: number; length: number; slopeRatio: number }; // 平台尺寸 m, 边坡坡比(水平:垂直= ratio:1)
}

export interface Turbine {
  id: string; label: string;
  x: number; y: number;
  modelId: string;
  hubHeight: number;
}

export interface MetMast {
  id: string; name: string;
  x: number; y: number;
  heights: number[];            // 测风高度层 m
  hours: number;                // 逐时记录数
  speed: Float32Array[];        // 每层 hours 长度
  dir: Float32Array;            // 风向(来向, 度)
}

export interface House { id: string; name: string; x: number; y: number }

export interface RoughnessZone {
  id: string; name: string; z0: number; // 粗糙度长度 m
  poly: Vec2[];
}

export interface LossFactors {
  availability: number;  // 可利用率损失, 如 0.03
  curtailment: number;   // 限电
  soiling: number;       // 叶片污染
  station: number;       // 场用电及线损
}

export interface ProjectSettings {
  maxPerCircuit: number;   // 单回路最大机组数
  minSpacingRD: number;    // 最小间距(叶轮直径倍数)
  dayLimit: number;        // 昼间噪声限值 dBA
  nightLimit: number;      // 夜间噪声限值 dBA
  hubHeight: number;       // 全场默认轮毂高度
  modelId: string;         // 全场默认机型
}

export interface Project {
  id: string; name: string; createdAt: string;
  seed: number;                 // 地形/测风数据生成种子
  terrain: TerrainGrid;
  masts: MetMast[];
  turbines: Turbine[];
  houses: House[];
  roughness: RoughnessZone[];
  substation: Vec2;
  losses: LossFactors;
  settings: ProjectSettings;
  candidate: Vec2[];            // 候选布置区域多边形
}

// ---------- 分析结果 ----------
export interface SectorStat {
  freq: number[];   // 12 扇区频率
  A: number[];      // 威布尔尺度
  k: number[];      // 威布尔形状
  ti15: number[];   // 15m/s 特征湍流强度
  alpha: number[];  // 风切变指数
}

export interface TurbineAEP {
  id: string;
  gross: number;        // MWh/年, 无尾流
  net: number;          // MWh/年, 扣尾流与各项折减
  wakeLoss: number;     // 尾流损失比例 0..1
  meanDeficit: number;  // 频率加权平均风速亏损
}

export interface AEPResult {
  per: TurbineAEP[];
  totalGross: number;
  totalNet: number;
  wakeLossPct: number;  // 全场尾流损失 %
  capacityFactor: number;
}

export interface PadDesign {
  turbineId: string;
  x: number; y: number; angle: number; // 平台中心与走向
  w: number; l: number; z: number;     // 尺寸与平台高程
  slopeRatio: number;                  // 边坡坡比
  cut: number; fill: number;           // m3
  footprint: Vec2[];                   // 边坡占地范围
}

export interface EarthworkResult {
  pads: PadDesign[];
  totalCut: number; totalFill: number;
}

export interface Circuit {
  index: number;
  turbineIds: string[];
  cableM: number;
  path: Vec2[];       // 串联路径(末点为升压站)
  alarm: string | null;
}

export interface HouseNoise {
  houseId: string;
  level: number;             // 等效声级 dBA
  dayLimit: number; nightLimit: number;
  exceedDay: boolean; exceedNight: boolean;
  setbackM: number;          // 为达标主导声源需退让的距离
  dominant: string | null;   // 主导机位
}
