// 应用状态与分析流水线: 项目 -> 地形派生 -> 风资源 -> 尾流/AEP -> 土方/电气/噪声 -> 渲染同步
import {
  AEPResult, Circuit, EarthworkResult, HouseNoise, Project,
  SectorStat, TerrainGrid, Turbine,
} from '../types';
import { DrainageResult, extractDrainage, heightAt } from '../core/terrain';
import { mastSectorStats } from '../core/wind';
import { buildWindTables, evaluateAEP, GridMap, SiteWind } from '../core/aep';
import { designAllPads, applyPadsToTerrain } from '../core/earthwork';
import { planCircuits } from '../core/electrical';
import { assessNoise } from '../core/noise';
import { getModel } from '../core/turbines';
import { Renderer, Instance, Label } from '../gl/renderer';
import { saveProject } from '../data/store';

export type PageName = 'projects' | 'terrain' | 'layout' | 'wind' | 'report';

export class App {
  project: Project;
  renderer: Renderer;
  drainage: DrainageResult;
  mastStats: SectorStat[];
  wind: SiteWind | null = null;
  aep: AEPResult | null = null;
  earthworks: EarthworkResult | null = null;
  circuits: Circuit[] = [];
  noise: HouseNoise[] = [];
  gridMap: GridMap | null = null;
  displayTerrain: TerrainGrid;

  page: PageName = 'projects';
  overlayMode: 'none' | 'wind' | 'aep' = 'none';
  layers: Record<string, boolean> = {
    ridge: true, gully: true, pads: true, cables: true,
    houses: true, roughness: false, candidate: false, masts: true,
  };
  selectedTurbine: string | null = null;
  addMode = false;
  optimizing = false;
  private cancelOpt = false;
  private pageRenderers = new Map<PageName, (app: App) => void>();

  constructor(project: Project, renderer: Renderer) {
    this.project = project;
    this.renderer = renderer;
    this.drainage = extractDrainage(project.terrain, 60, 40);
    this.mastStats = project.masts.map(m => mastSectorStats(m));
    this.displayTerrain = project.terrain;
    renderer.setTerrain(project.terrain);
    renderer.onClick = (sx, sy) => this.handleClick(sx, sy);
    this.refreshAnalysis();
  }

  registerPage(name: PageName, fn: (app: App) => void): void {
    this.pageRenderers.set(name, fn);
  }

  setPage(name: PageName): void {
    this.page = name;
    document.querySelectorAll('#sidenav button').forEach(b => {
      b.classList.toggle('active', (b as HTMLButtonElement).dataset.page === name);
    });
    const reportView = document.getElementById('report-view')!;
    reportView.hidden = name !== 'report';
    document.getElementById('panel')!.style.display = name === 'report' ? 'none' : '';
    this.pageRenderers.get(name)?.(this);
  }

  renderPanel(): void {
    if (this.page !== 'report') this.pageRenderers.get(this.page)?.(this);
    else this.pageRenderers.get('report')?.(this);
  }

  // 布局或风资源参数变化后重算
  refreshAnalysis(): void {
    const p = this.project;
    this.wind = buildWindTables(p, this.mastStats, p.turbines);
    this.aep = evaluateAEP(p, this.wind, p.turbines);
    this.earthworks = designAllPads(p);
    this.circuits = planCircuits(p);
    this.noise = assessNoise(p);
    this.displayTerrain = applyPadsToTerrain(p.terrain, this.earthworks.pads);
    this.renderer.setTerrain(this.displayTerrain);
    this.gridMap = null;
    this.updateRenderer();
    if (this.page !== 'projects') this.save();
  }

  // 仅布局变化(机位增删移)也走同一入口
  refreshLayout(): void { this.refreshAnalysis(); }

  save(): void {
    if (this.project.id !== 'sample') saveProject(this.project);
  }

  status(msg: string): void {
    document.getElementById('status-text')!.textContent = msg;
  }

  private handleClick(sx: number, sy: number): void {
    if (!this.addMode) return;
    const pt = this.renderer.pickGround(sx, sy);
    if (!pt) return;
    const n = this.project.turbines.length + 1;
    const t: Turbine = {
      id: `T${String(n).padStart(2, '0')}`,
      label: `T${String(n).padStart(2, '0')}`,
      x: Math.round(pt[0]), y: Math.round(pt[1]),
      modelId: this.project.settings.modelId,
      hubHeight: this.project.settings.hubHeight,
    };
    this.project.turbines.push(t);
    this.addMode = false;
    this.status(`已添加机位 ${t.label} (${t.x}, ${t.y})`);
    this.refreshLayout();
    this.renderPanel();
  }

  // ---------------- 渲染同步 ----------------
  updateRenderer(): void {
    const p = this.project;
    const r = this.renderer;
    const t = this.displayTerrain;

    // 机组实例
    const tInst: Instance[] = p.turbines.map(tb => {
      const m = getModel(tb.modelId);
      return {
        x: tb.x, y: tb.y, z: heightAt(t, tb.x, tb.y),
        scaleX: m.rotorD, scaleY: tb.hubHeight,
        yaw: 4.36, phase: (tb.x * 13 + tb.y * 7) % 6.28,
        flag: this.selectedTurbine === tb.id ? 1 : 0,
      };
    });
    r.setInstances('turbines', 'turbine', tInst, [0.92, 0.93, 0.95]);

    // 居民点 / 升压站
    if (this.layers.houses) {
      r.setInstances('houses', 'box', p.houses.map(h => ({
        x: h.x, y: h.y, z: heightAt(t, h.x, h.y), scaleX: 22, scaleY: 0, yaw: 0, phase: 0, flag: 0,
      })), [0.85, 0.55, 0.25]);
    } else r.setInstances('houses', 'box', [], [0, 0, 0]);
    r.setInstances('sub', 'box', [{
      x: p.substation.x, y: p.substation.y, z: heightAt(t, p.substation.x, p.substation.y),
      scaleX: 45, scaleY: 0, yaw: 0, phase: 0, flag: 0,
    }], [0.55, 0.58, 0.62]);

    // 山脊线 / 冲沟(带流向箭头)
    r.setLines('ridge', this.drainage.ridgeSegs, [1.0, 0.45, 0.3]);
    r.setLineVisible('ridge', this.layers.ridge);
    r.setLines('gully', this.gullyWithArrows(), [0.35, 0.65, 1.0]);
    r.setLineVisible('gully', this.layers.gully);

    // 平台边坡占地范围
    if (this.earthworks && this.layers.pads) {
      const pts: number[] = [];
      for (const pad of this.earthworks.pads) {
        const fp = pad.footprint;
        for (let i = 0; i < fp.length; i++) {
          const a = fp[i], b = fp[(i + 1) % fp.length];
          pts.push(a.x, a.y, heightAt(t, a.x, a.y) + 3, b.x, b.y, heightAt(t, b.x, b.y) + 3);
        }
      }
      r.setLines('pads', new Float32Array(pts), [1.0, 0.85, 0.3]);
    } else r.removeLines('pads');

    // 集电线路
    if (this.layers.cables && this.circuits.length) {
      const pts: number[] = [];
      for (const c of this.circuits) {
        for (let i = 1; i < c.path.length; i++) {
          const a = c.path[i - 1], b = c.path[i];
          // 顺地形折线
          const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 50));
          for (let s = 0; s < steps; s++) {
            const u1 = s / steps, u2 = (s + 1) / steps;
            const x1 = a.x + (b.x - a.x) * u1, y1 = a.y + (b.y - a.y) * u1;
            const x2 = a.x + (b.x - a.x) * u2, y2 = a.y + (b.y - a.y) * u2;
            pts.push(x1, y1, heightAt(t, x1, y1) + 4, x2, y2, heightAt(t, x2, y2) + 4);
          }
        }
      }
      r.setLines('cables', new Float32Array(pts), [0.95, 0.8, 0.2]);
    } else r.removeLines('cables');

    // 候选区域 / 粗糙度分区
    if (this.layers.candidate) {
      r.setLines('candidate', polyLines(p.candidate, t), [0.4, 0.95, 0.5]);
    } else r.removeLines('candidate');
    if (this.layers.roughness) {
      const pts: number[] = [];
      for (const rz of p.roughness) {
        const arr = polyLines(rz.poly, t);
        for (let i = 0; i < arr.length; i += 3) pts.push(arr[i], arr[i + 1], arr[i + 2]);
      }
      r.setLines('rough', new Float32Array(pts), [0.5, 0.8, 0.4]);
    } else r.removeLines('rough');

    // 测风塔
    if (this.layers.masts) {
      const pts: number[] = [];
      for (const m of p.masts) {
        const z0 = heightAt(t, m.x, m.y);
        const top = Math.max(...m.heights);
        pts.push(m.x, m.y, z0, m.x, m.y, z0 + top);
        pts.push(m.x - 15, m.y, z0 + top * 0.55, m.x, m.y, z0 + top);
        pts.push(m.x + 15, m.y, z0 + top * 0.55, m.x, m.y, z0 + top);
      }
      r.setLines('masts', new Float32Array(pts), [0.9, 0.4, 0.9]);
    } else r.removeLines('masts');

    // 标签
    const labels: Label[] = [];
    for (const tb of p.turbines) {
      labels.push({
        x: tb.x, y: tb.y, z: heightAt(t, tb.x, tb.y) + tb.hubHeight + 60,
        text: tb.label, color: this.selectedTurbine === tb.id ? '#f5b13f' : '#e8eef4',
      });
    }
    if (this.layers.houses) {
      for (const h of p.houses) {
        labels.push({ x: h.x, y: h.y, z: heightAt(t, h.x, h.y) + 40, text: h.name, color: '#f0b080' });
      }
    }
    if (this.layers.masts) {
      for (const m of p.masts) {
        labels.push({ x: m.x, y: m.y, z: heightAt(t, m.x, m.y) + Math.max(...m.heights) + 30, text: m.name, color: '#e080e0' });
      }
    }
    labels.push({ x: p.substation.x, y: p.substation.y, z: heightAt(t, p.substation.x, p.substation.y) + 60, text: '升压站', color: '#b0c0d0' });
    r.setLabels(labels);

    // 叠加层
    this.applyOverlay();
  }

  applyOverlay(): void {
    if (this.overlayMode === 'none' || !this.gridMap) {
      this.renderer.setOverlay(null, 0, 0, 0, 0, 0, 0, 1);
      return;
    }
    const g = this.gridMap;
    const data = this.overlayMode === 'wind' ? g.meanV : g.aep;
    let mn = Infinity, mx = -Infinity;
    for (const v of data) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    this.renderer.setOverlay(data, g.nx, g.ny, g.originX, g.originY, g.cell, mn, mx);
  }

  private gullyWithArrows(): Float32Array {
    const segs = this.drainage.gullySegs;
    const out: number[] = [];
    for (let i = 0; i < segs.length; i += 6) {
      const x1 = segs[i], y1 = segs[i + 1], z1 = segs[i + 2];
      const x2 = segs[i + 3], y2 = segs[i + 4], z2 = segs[i + 5];
      out.push(x1, y1, z1, x2, y2, z2);
      // 箭头: 下游端两侧短划
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len, uy = dy / len;
      const al = Math.min(14, len * 0.4);
      const px = -uy, py = ux;
      out.push(x2, y2, z2, x2 - ux * al + px * al * 0.5, y2 - uy * al + py * al * 0.5, z2);
      out.push(x2, y2, z2, x2 - ux * al - px * al * 0.5, y2 - uy * al - py * al * 0.5, z2);
    }
    return new Float32Array(out);
  }

  cancelOptimization(): void { this.cancelOpt = true; }
  get optCancelled(): boolean { return this.cancelOpt; }
  resetOptCancel(): void { this.cancelOpt = false; }
}

function polyLines(poly: { x: number; y: number }[], t: TerrainGrid): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    pts.push(a.x, a.y, heightAt(t, a.x, a.y) + 3, b.x, b.y, heightAt(t, b.x, b.y) + 3);
  }
  return new Float32Array(pts);
}
