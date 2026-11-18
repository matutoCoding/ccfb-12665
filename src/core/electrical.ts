// 集电线路自动分组接线: 回路机组数限制报警, 线缆顺地形长度估算
import { Circuit, Project, Turbine, Vec2 } from '../types';
import { profileHeights } from './terrain';

// 顺地形三维路径长度(含 3% 弧垂余量)
export function terrainCableLength(project: Project, a: Vec2, b: Vec2): number {
  const prof = profileHeights(project.terrain, a.x, a.y, b.x, b.y, 15);
  let len = 0;
  for (let i = 1; i < prof.d.length; i++) {
    const dd = prof.d[i] - prof.d[i - 1];
    const dz = prof.z[i] - prof.z[i - 1];
    len += Math.hypot(dd, dz);
  }
  return len * 1.03;
}

export function planCircuits(project: Project): Circuit[] {
  const turb = project.turbines;
  const sub = project.substation;
  const maxN = project.settings.maxPerCircuit;
  if (turb.length === 0) return [];
  // 按相对升压站的方位角排序, 贪心划分回路, 回路内最近邻串联
  const remaining = new Set(turb.map(t => t.id));
  const byId = new Map(turb.map(t => [t.id, t]));
  const circuits: Circuit[] = [];
  let idx = 0;
  while (remaining.size > 0) {
    // 从离升压站最远的未分配机组起链
    let start: Turbine | null = null, bestD = -1;
    for (const id of remaining) {
      const t = byId.get(id)!;
      const d = Math.hypot(t.x - sub.x, t.y - sub.y);
      if (d > bestD) { bestD = d; start = t; }
    }
    const chain: Turbine[] = [start!];
    remaining.delete(start!.id);
    while (chain.length < maxN && remaining.size > 0) {
      const last = chain[chain.length - 1];
      let next: Turbine | null = null, nd = Infinity;
      for (const id of remaining) {
        const t = byId.get(id)!;
        const d = Math.hypot(t.x - last.x, t.y - last.y);
        if (d < nd) { nd = d; next = t; }
      }
      // 若最近机组离升压站更近且当前链已过半, 另起一回路更省线
      chain.push(next!);
      remaining.delete(next!.id);
    }
    // 路径: 链首 -> ... -> 链尾 -> 升压站, 顺地形累计
    const path: Vec2[] = chain.map(t => ({ x: t.x, y: t.y }));
    path.push({ ...sub });
    let cable = 0;
    for (let i = 1; i < path.length; i++) cable += terrainCableLength(project, path[i - 1], path[i]);
    const alarm = chain.length > maxN ? `回路机组数 ${chain.length} 超过限制 ${maxN}` : null;
    circuits.push({ index: idx++, turbineIds: chain.map(t => t.id), cableM: Math.round(cable), path, alarm });
  }
  return circuits;
}
