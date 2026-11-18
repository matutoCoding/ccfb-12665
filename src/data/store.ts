// 项目持久化: localStorage。地形/测风大数组不存, 由种子确定性重建
import { Project } from '../types';
import { buildSampleProject } from './sample';

const KEY = 'windfarm.projects.v1';

interface ProjectMeta { id: string; name: string; createdAt: string; seed: number; turbines: number }

// 可序列化部分(不含 terrain.z / mast.speed 等大数组)
interface ProjectDTO extends Omit<Project, 'terrain' | 'masts'> {
  terrain: Omit<Project['terrain'], 'z'>;
  masts: Omit<Project['masts'][number], 'speed' | 'dir'>[];
}

export function listProjects(): ProjectMeta[] {
  const metas: ProjectMeta[] = [{ id: 'sample', name: '示例: 云岭山区 20 机位风电场', createdAt: '2026-11-19', seed: 12665, turbines: 20 }];
  for (const p of loadAll()) {
    metas.push({ id: p.id, name: p.name, createdAt: p.createdAt, seed: p.seed, turbines: p.turbines.length });
  }
  return metas;
}

function loadAll(): ProjectDTO[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProjectDTO[]) : [];
  } catch {
    return [];
  }
}

function saveAll(list: ProjectDTO[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function loadProject(id: string): Project | null {
  if (id === 'sample') return buildSampleProject();
  const dto = loadAll().find(p => p.id === id);
  if (!dto) return null;
  // 以种子重建地形与测风数据, 再套用保存的布置与设置
  const base = buildSampleProject();
  if (dto.seed !== base.seed) return null; // 目前所有项目同场地, 后续可扩展多场地
  return {
    ...base,
    ...dto,
    terrain: base.terrain,
    masts: base.masts,
  };
}

export function saveProject(p: Project): void {
  const dto: ProjectDTO = {
    ...p,
    terrain: { nx: p.terrain.nx, ny: p.terrain.ny, cell: p.terrain.cell, originX: p.terrain.originX, originY: p.terrain.originY },
    masts: p.masts.map(m => ({ id: m.id, name: m.name, x: m.x, y: m.y, heights: m.heights, hours: m.hours })),
  };
  const all = loadAll().filter(q => q.id !== p.id);
  all.push(dto);
  saveAll(all);
}

export function deleteProject(id: string): void {
  saveAll(loadAll().filter(q => q.id !== id));
}

export function duplicateProject(source: Project, name: string): Project {
  const copy: Project = {
    ...source,
    id: `p${Date.now().toString(36)}`,
    name,
    createdAt: new Date().toISOString().slice(0, 10),
    turbines: source.turbines.map(t => ({ ...t })),
    houses: source.houses.map(h => ({ ...h })),
    losses: { ...source.losses },
    settings: { ...source.settings },
    candidate: source.candidate.map(c => ({ ...c })),
  };
  saveProject(copy);
  return copy;
}
