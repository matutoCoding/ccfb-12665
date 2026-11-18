// 单位机组网格(局部坐标): 塔筒 z∈[0,1], 机舱/轮毂围绕原点, 叶片在 XY 平面
// aKind: (0,0) 塔筒 (1,0) 机舱/轮毂 (2,基准角) 叶片
export interface MeshGeometry {
  positions: Float32Array;
  normals: Float32Array;
  kinds: Float32Array; // 每顶点 2 分量
  count: number;
}

class GeomBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  kind: number[] = [];
  tri(p1: number[], p2: number[], p3: number[], n: number[], k: number[]) {
    for (const p of [p1, p2, p3]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.kind.push(k[0], k[1]);
    }
  }
  quad(p1: number[], p2: number[], p3: number[], p4: number[], n: number[], k: number[]) {
    this.tri(p1, p2, p3, n, k);
    this.tri(p1, p3, p4, n, k);
  }
  build(): MeshGeometry {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      kinds: new Float32Array(this.kind),
      count: this.pos.length / 3,
    };
  }
}

export function buildTurbineGeometry(): MeshGeometry {
  const g = new GeomBuilder();
  // 塔筒: 8 边锥台
  const SEG = 8, rBot = 0.024, rTop = 0.014;
  for (let s = 0; s < SEG; s++) {
    const a1 = (s / SEG) * 2 * Math.PI, a2 = ((s + 1) / SEG) * 2 * Math.PI;
    const b1 = [rBot * Math.cos(a1), rBot * Math.sin(a1), 0];
    const b2 = [rBot * Math.cos(a2), rBot * Math.sin(a2), 0];
    const t1 = [rTop * Math.cos(a1), rTop * Math.sin(a1), 1];
    const t2 = [rTop * Math.cos(a2), rTop * Math.sin(a2), 1];
    const am = (a1 + a2) / 2;
    const n = [Math.cos(am), Math.sin(am), 0.25];
    g.quad(b1, b2, t2, t1, n, [0, 0]);
  }
  // 机舱: 以原点(轮毂中心)后伸的箱体
  const nl = 0.075, nw = 0.016, nh = 0.018; // 半长/半宽/半高
  const x0 = -nl * 1.4, x1 = nl * 0.6;
  const faces: [number[], number[], number[], number[], number[]][] = [
    [[x1, -nw, -nh], [x1, nw, -nh], [x1, nw, nh], [x1, -nw, nh], [1, 0, 0]],
    [[x0, nw, -nh], [x0, -nw, -nh], [x0, -nw, nh], [x0, nw, nh], [-1, 0, 0]],
    [[x0, nw, -nh], [x1, nw, -nh], [x1, nw, nh], [x0, nw, nh], [0, 1, 0]],
    [[x1, -nw, -nh], [x0, -nw, -nh], [x0, -nw, nh], [x1, -nw, nh], [0, -1, 0]],
    [[x0, -nw, nh], [x0, nw, nh], [x1, nw, nh], [x1, -nw, nh], [0, 0, 1]],
    [[x0, nw, -nh], [x0, -nw, -nh], [x1, -nw, -nh], [x1, nw, -nh], [0, 0, -1]],
  ];
  for (const [p1, p2, p3, p4, n] of faces) g.quad(p1, p2, p3, p4, n, [1, 0]);
  // 轮毂罩: 短圆柱沿 X
  const hr = 0.014, hx0 = 0, hx1 = 0.035;
  for (let s = 0; s < SEG; s++) {
    const a1 = (s / SEG) * 2 * Math.PI, a2 = ((s + 1) / SEG) * 2 * Math.PI;
    const p1 = [hx0, hr * Math.cos(a1), hr * Math.sin(a1)];
    const p2 = [hx0, hr * Math.cos(a2), hr * Math.sin(a2)];
    const p3 = [hx1, hr * Math.cos(a2), hr * Math.sin(a2)];
    const p4 = [hx1, hr * Math.cos(a1), hr * Math.sin(a1)];
    const am = (a1 + a2) / 2;
    g.quad(p1, p2, p3, p4, [0, Math.cos(am), Math.sin(am)], [1, 0]);
  }
  // 三支叶片: XY 平面内 +Y 方向, 法线 +Z
  for (let b = 0; b < 3; b++) {
    const baseAng = (b * 2 * Math.PI) / 3;
    const stations = [0.03, 0.12, 0.28, 0.42, 0.5];
    const chords = [0.022, 0.028, 0.02, 0.011, 0.004];
    for (let s = 0; s < stations.length - 1; s++) {
      const r1 = stations[s], r2 = stations[s + 1];
      const c1 = chords[s] / 2, c2 = chords[s + 1] / 2;
      g.quad(
        [-c1, r1, 0], [c1, r1, 0], [c2, r2, 0], [-c2, r2, 0],
        [0, 0, 1], [2, baseAng],
      );
      g.quad(
        [c1, r1, 0], [-c1, r1, 0], [-c2, r2, 0], [c2, r2, 0],
        [0, 0, -1], [2, baseAng],
      );
    }
  }
  return g.build();
}

// 单位立方体(房屋/升压站): xy∈[-0.5,0.5], z∈[0,1]
export function buildBoxGeometry(): MeshGeometry {
  const g = new GeomBuilder();
  const h = 0.5;
  const faces: [number[], number[], number[], number[], number[]][] = [
    [[h, -h, 0], [h, h, 0], [h, h, 1], [h, -h, 1], [1, 0, 0]],
    [[-h, h, 0], [-h, -h, 0], [-h, -h, 1], [-h, h, 1], [-1, 0, 0]],
    [[-h, h, 0], [h, h, 0], [h, h, 1], [-h, h, 1], [0, 1, 0]],
    [[h, -h, 0], [-h, -h, 0], [-h, -h, 1], [h, -h, 1], [0, -1, 0]],
    [[-h, -h, 1], [-h, h, 1], [h, h, 1], [h, -h, 1], [0, 0, 1]],
  ];
  for (const [p1, p2, p3, p4, n] of faces) g.quad(p1, p2, p3, p4, n, [1, 0]);
  return g.build();
}
