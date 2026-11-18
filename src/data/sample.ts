// 内置示例项目: 山区 20 台机位, 地形/测风塔逐时数据均由种子程序化生成, 打开即用
import { House, MetMast, Project, Turbine, Vec2 } from '../types';
import { extractDrainage, generateTerrain } from '../core/terrain';
import { mulberry32, randn, weibullSample } from '../core/rng';

const SAMPLE_SEED = 12665;

// 生成测风塔一年逐时数据(确定性)
function synthesizeMast(seed: number, id: string, name: string, x: number, y: number, heights: number[]): MetMast {
  const rand = mulberry32(seed);
  const hours = 8760;
  const speed = heights.map(() => new Float32Array(hours));
  const dir = new Float32Array(hours);
  let d = 250; // 主导风向 WSW
  for (let h = 0; h < hours; h++) {
    const dayOfYear = h / 24;
    const hod = h % 24;
    // 风向: 围绕主导风向的相关随机游走
    d += randn(rand) * 6 + (250 - d) * 0.02;
    const dd = ((d % 360) + 360) % 360;
    dir[h] = dd;
    // 季节系数(冬季大) + 扇区风能差异(西南象限强)
    const seasonal = 1 + 0.28 * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365);
    const sectorBoost = 1 + 0.35 * Math.cos(((dd - 250) * Math.PI) / 180);
    const A = 8.0 * seasonal * sectorBoost;
    const v100 = weibullSample(rand, Math.max(3, A), 2.05);
    // 切变: 夜间稳定层结切变大, 白天混合强切变小
    const alpha = 0.09 + 0.09 * (0.5 + 0.5 * Math.cos((2 * Math.PI * (hod - 3)) / 24)) + rand() * 0.02;
    for (let zi = 0; zi < heights.length; zi++) {
      const vz = v100 * Math.pow(heights[zi] / 100, alpha);
      speed[zi][h] = Math.max(0, vz * (1 + (rand() - 0.5) * 0.04));
    }
  }
  return { id, name, x, y, heights, hours, speed, dir };
}

export function buildSampleProject(): Project {
  const seed = SAMPLE_SEED;
  const terrain = generateTerrain(seed, 200, 200, 25); // 5km x 5km
  const W = 199 * 25, H = 199 * 25;

  const masts = [
    synthesizeMast(seed + 11, 'M1', 'M1 测风塔', 2350, 2600, [30, 50, 70, 90, 100]),
    synthesizeMast(seed + 23, 'M2', 'M2 测风塔', 3100, 1900, [50, 80, 100]),
  ];

  // 机位: 沿自动提取的山脊线, 按高程优先、最小间距 450m 选 20 台
  const drainage = extractDrainage(terrain, 60, 40);
  const ridge = drainage.ridgeCells
    .map(k => ({ k, z: terrain.z[k] }))
    .sort((a, b) => b.z - a.z);
  const turbines: Turbine[] = [];
  const minD = 450;
  for (const { k } of ridge) {
    if (turbines.length >= 20) break;
    const i = k % terrain.nx, j = (k / terrain.nx) | 0;
    const x = i * 25, y = j * 25;
    if (x < 500 || y < 500 || x > W - 500 || y > H - 500) continue;
    if (drainage.gullyMask[k]) continue;
    if (turbines.some(t => Math.hypot(t.x - x, t.y - y) < minD)) continue;
    turbines.push({
      id: `T${String(turbines.length + 1).padStart(2, '0')}`,
      label: `T${String(turbines.length + 1).padStart(2, '0')}`,
      x, y, modelId: 'WD5000-191', hubHeight: 110,
    });
  }

  // 居民点: 场地边缘低洼处 8 户(按高程升序贪心选取, 保证户数)
  const rand = mulberry32(seed + 99);
  const edgeCells: { x: number; y: number; z: number }[] = [];
  for (let j = 0; j < terrain.ny; j++) {
    for (let i = 0; i < terrain.nx; i++) {
      const x = i * 25, y = j * 25;
      const edge = Math.min(x, y, W - x, H - y);
      if (edge < 250 || edge > 1000) continue;
      edgeCells.push({ x, y, z: terrain.z[j * terrain.nx + i] });
    }
  }
  edgeCells.sort((a, b) => a.z - b.z);
  const houses: House[] = [];
  for (const c of edgeCells) {
    if (houses.length >= 8) break;
    const hx = c.x + (rand() - 0.5) * 40, hy = c.y + (rand() - 0.5) * 40;
    if (houses.some(hh => Math.hypot(hh.x - hx, hh.y - hy) < 450)) continue;
    houses.push({ id: `H${houses.length + 1}`, name: `居民点${houses.length + 1}`, x: Math.round(hx), y: Math.round(hy) });
  }

  // 粗糙度分区: 两片林地
  const roughness = [
    {
      id: 'R1', name: '西侧林地', z0: 0.3,
      poly: ellipsePoly(1100, 3200, 500, 380, 12),
    },
    {
      id: 'R2', name: '东南林地', z0: 0.25,
      poly: ellipsePoly(3900, 1300, 460, 340, 12),
    },
  ];

  return {
    id: 'sample', name: '示例: 云岭山区 20 机位风电场', createdAt: '2026-11-19',
    seed,
    terrain,
    masts,
    turbines,
    houses,
    roughness,
    substation: { x: 2500, y: 600 },
    losses: { availability: 0.03, curtailment: 0.02, soiling: 0.01, station: 0.02 },
    settings: {
      maxPerCircuit: 8, minSpacingRD: 3,
      dayLimit: 55, nightLimit: 45,
      hubHeight: 110, modelId: 'WD5000-191',
    },
    candidate: [
      { x: 600, y: 900 }, { x: 4400, y: 900 }, { x: 4400, y: 4400 }, { x: 600, y: 4400 },
    ],
  };
}

function ellipsePoly(cx: number, cy: number, rx: number, ry: number, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}
