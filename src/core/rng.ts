// 确定性随机数与分形噪声(示例项目地形/测风数据由此程序化生成, 保证可复现)
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 二维哈希 -> [0,1)
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const u = smooth(fx), v = smooth(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, octaves: number, seed: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

// 山脊状噪声: 输出 [0,1], 山脊处接近 1
export function ridged(x: number, y: number, octaves: number, seed: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = valueNoise(x * freq, y * freq, seed + i * 77);
    const r = 1 - Math.abs(2 * n - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5; freq *= 2.11;
  }
  return sum / norm;
}

// 威布尔分布采样
export function weibullSample(rand: () => number, A: number, k: number): number {
  return A * Math.pow(-Math.log(1 - rand()), 1 / k);
}

export function randn(rand: () => number): number {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
