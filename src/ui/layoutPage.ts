// 机位布置页: 机位表(含尾流/湍流提示)、吊装平台土方、集电线路、噪声、自动优化
import { App } from './app';
import { el, button, kv, row, numInput, selectInput, table, fmt } from './dom';
import { TURBINE_MODELS, getModel, IEC_TI_REF } from '../core/turbines';
import { optimizeLayout } from '../core/optimize';
import { overallTI15 } from '../core/wind';

export function renderLayoutPage(app: App): void {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';
  const p = app.project;
  const aep = app.aep;

  // ---------- 机位表 ----------
  panel.appendChild(el('h3', '', `机位布置 (${p.turbines.length} 台)`));
  const ti15 = Math.max(...app.mastStats.map(s => overallTI15(s)));
  if (aep) {
    panel.appendChild(kv([
      ['全场年发电量(净)', `${fmt(aep.totalNet, 0)} MWh`],
      ['尾流损失', `${fmt(aep.wakeLossPct, 2)} %`],
      ['容量系数', `${fmt(aep.capacityFactor * 100, 1)} %`],
      ['场区特征湍流强度', `${fmt(ti15 * 100, 1)} % (IEC ${ti15 <= 0.12 ? 'C' : ti15 <= 0.14 ? 'B' : 'A'} 类)`],
    ]));
  }
  const rows = p.turbines.map((t, i) => {
    const a = aep?.per[i];
    const model = getModel(t.modelId);
    const tiWarn = ti15 > model.tiRef;
    return {
      cells: [
        t.label, t.x, t.y, t.hubHeight,
        a ? fmt(a.gross, 0) : '-',
        a ? fmt(a.net, 0) : '-',
        a ? fmt(a.wakeLoss * 100, 1) + '%' : '-',
        tiWarn ? `超IEC-${model.iecClass}` : '合格',
      ],
      cls: tiWarn ? 'warn' : '',
    };
  });
  const tbl = table(
    ['机位', 'X(m)', 'Y(m)', '轮毂(m)', '发电量(毛)', '发电量(净)', '尾流损失', '湍流'],
    rows.map(r => r.cells),
    i => rows[i].cls,
  );
  tbl.addEventListener('click', e => {
    const tr = (e.target as HTMLElement).closest('tr');
    if (!tr || !tr.parentElement || tr.parentElement.tagName !== 'TBODY') return;
    const idx = Array.from(tr.parentElement.children).indexOf(tr);
    const t = p.turbines[idx];
    if (t) {
      app.selectedTurbine = app.selectedTurbine === t.id ? null : t.id;
      app.updateRenderer();
    }
  });
  panel.appendChild(tbl);
  panel.appendChild(el('div', 'note', '点击表格行在三维中高亮机位。湍流超 IEC 类别(机型 '
    + p.turbines.map(t => getModel(t.modelId).iecClass).join('/') + ')的机位以橙色标出, 建议换型或复核。'));

  // ---------- 添加/删除/机型 ----------
  panel.appendChild(el('h4', '', '机位操作'));
  const addBtn = button('在地图上加点布置', () => {
    app.addMode = !app.addMode;
    addBtn.textContent = app.addMode ? '点击地形放置机位…(再点取消)' : '在地图上加点布置';
    addBtn.classList.toggle('secondary', app.addMode);
  });
  panel.appendChild(addBtn);
  panel.appendChild(button('删除选中机位', () => {
    if (!app.selectedTurbine) { app.status('请先在表格中选中机位'); return; }
    p.turbines = p.turbines.filter(t => t.id !== app.selectedTurbine);
    app.selectedTurbine = null;
    app.refreshLayout();
    app.renderPanel();
  }, 'act secondary'));
  panel.appendChild(row('默认机型', selectInput(
    TURBINE_MODELS.map(m => ({ value: m.id, label: `${m.name} (${m.ratedKW}kW/D${m.rotorD})` })),
    p.settings.modelId,
    v => { p.settings.modelId = v; app.refreshLayout(); app.renderPanel(); },
  )));
  panel.appendChild(row('默认轮毂高度 m', selectInput(
    getModel(p.settings.modelId).hubHeights.map(h => ({ value: String(h), label: `${h} m` })),
    String(p.settings.hubHeight),
    v => { p.settings.hubHeight = Number(v); app.refreshLayout(); app.renderPanel(); },
  )));
  panel.appendChild(button('全部应用默认机型/塔高', () => {
    for (const t of p.turbines) { t.modelId = p.settings.modelId; t.hubHeight = p.settings.hubHeight; }
    app.refreshLayout();
    app.renderPanel();
  }, 'act secondary'));

  // ---------- 吊装平台与土方 ----------
  panel.appendChild(el('h3', '', '吊装平台与土方'));
  if (app.earthworks) {
    const ew = app.earthworks;
    panel.appendChild(kv([
      ['全场挖方', `${fmt(ew.totalCut, 0)} m³`],
      ['全场填方', `${fmt(ew.totalFill, 0)} m³`],
      ['挖填差(挖-填)', `${fmt(ew.totalCut - ew.totalFill, 0)} m³`],
    ]));
    const padRows = ew.pads.map(pad => {
      const t = p.turbines.find(x => x.id === pad.turbineId);
      return [t?.label ?? pad.turbineId, `${pad.l}×${pad.w}`, fmt(pad.z, 1), fmt(pad.cut, 0), fmt(pad.fill, 0)];
    });
    panel.appendChild(table(['机位', '平台(m)', '平台高程', '挖方m³', '填方m³'], padRows));
    panel.appendChild(el('div', 'note',
      '平台尺寸与边坡坡比按机型确定, 走向自动选取挖填量最小方向; 黄色线为边坡占地范围, 地形三维中已展示开挖效果。'));
  }

  // ---------- 集电线路 ----------
  panel.appendChild(el('h3', '', '集电线路'));
  panel.appendChild(row('单回路最大机组数', numInput(p.settings.maxPerCircuit, 1, v => {
    p.settings.maxPerCircuit = Math.max(1, Math.round(v));
    app.refreshLayout();
    app.renderPanel();
  }, 1, 20)));
  if (app.circuits.length) {
    const totalCable = app.circuits.reduce((a, c) => a + c.cableM, 0);
    panel.appendChild(kv([
      ['回路数', String(app.circuits.length)],
      ['电缆总长(顺地形)', `${fmt(totalCable / 1000, 2)} km`],
    ]));
    panel.appendChild(table(
      ['回路', '机组数', '电缆长度', '状态'],
      app.circuits.map(c => [
        `#${c.index + 1}`, c.turbineIds.length, `${fmt(c.cableM / 1000, 2)} km`,
        c.alarm ?? '正常',
      ]),
      i => (app.circuits[i].alarm ? 'bad' : ''),
    ));
  }

  // ---------- 噪声 ----------
  panel.appendChild(el('h3', '', '噪声合规'));
  const limRow = el('div');
  limRow.appendChild(row('昼间限值 dBA', numInput(p.settings.dayLimit, 1, v => { p.settings.dayLimit = v; app.refreshLayout(); app.renderPanel(); }, 40, 70)));
  limRow.appendChild(row('夜间限值 dBA', numInput(p.settings.nightLimit, 1, v => { p.settings.nightLimit = v; app.refreshLayout(); app.renderPanel(); }, 35, 60)));
  panel.appendChild(limRow);
  if (app.noise.length) {
    panel.appendChild(table(
      ['居民点', '等效声级', '昼间', '夜间', '需退让'],
      app.noise.map(n => {
        const h = p.houses.find(x => x.id === n.houseId);
        return [
          h?.name ?? n.houseId, `${fmt(n.level, 1)} dBA`,
          n.exceedDay ? '超标' : '达标', n.exceedNight ? '超标' : '达标',
          n.setbackM > 0 ? `${n.setbackM} m` : '—',
        ];
      }),
      i => (app.noise[i].exceedNight || app.noise[i].exceedDay ? 'bad' : ''),
    ));
    panel.appendChild(el('div', 'note',
      '按机型倍频程声功率级, 计入距离发散、大气/地面吸收与地形遮挡; 退让距离按主导声源(标注于报告)发散衰减估算。'));
  }

  // ---------- 自动优化 ----------
  panel.appendChild(el('h3', '', '机位自动优化'));
  let optCount = p.turbines.length || 20;
  let optSweeps = 12;
  panel.appendChild(row('目标机位数', numInput(optCount, 1, v => { optCount = Math.round(v); }, 1, 60)));
  panel.appendChild(row('搜索轮数', numInput(optSweeps, 1, v => { optSweeps = Math.round(v); }, 1, 60)));
  const prog = el('div');
  const progBar = el('div', 'progress-track');
  const progFill = el('div', 'progress-fill');
  progBar.appendChild(progFill);
  const progText = el('div', 'note', '未运行');
  prog.appendChild(progBar);
  prog.appendChild(progText);
  let lastBest: import('../types').Turbine[] = [];
  const runBtn = button('开始搜索', async () => {
    if (app.optimizing) return;
    app.optimizing = true;
    app.resetOptCancel();
    runBtn.disabled = true;
    stopBtn.disabled = false;
    try {
      const result = await optimizeLayout(
        app.project, app.mastStats, app.drainage,
        { count: optCount, seed: 42, candidatePool: 400, sweeps: optSweeps },
        pr => {
          progFill.style.width = `${pr.done ? 100 : Math.min(95, (pr.iteration / (optCount * optSweeps * 24)) * 100)}%`;
          progText.textContent = `迭代 ${pr.iteration} · 当前最优净发电量 ${fmt(pr.bestNet, 0)} MWh/年`;
          // 实时显示当前最优解
          const rotorD = getModel(p.settings.modelId).rotorD;
          app.renderer.setInstances('candidates', 'turbine', pr.positions.map((pt, i) => ({
            x: pt.x, y: pt.y, z: terrainHeightAt(app, pt.x, pt.y),
            scaleX: rotorD, scaleY: p.settings.hubHeight, yaw: 4.36, phase: i, flag: 2,
          })), [0.4, 0.95, 0.5]);
        },
        () => app.optCancelled,
      );
      lastBest = result;
      if (result.length) {
        progText.textContent = `搜索完成, 最优净发电量见上; 共 ${result.length} 台, 可一键落成正式布置`;
        applyBtn.disabled = false;
      }
    } finally {
      app.optimizing = false;
      runBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });
  const stopBtn = button('停止', () => app.cancelOptimization(), 'act secondary');
  stopBtn.disabled = true;
  const applyBtn = button('落成正式布置', () => {
    if (!lastBest.length) return;
    app.project.turbines = lastBest;
    app.renderer.setInstances('candidates', 'turbine', [], [0, 0, 0]);
    app.refreshLayout();
    app.renderPanel();
    app.status('已将优化结果落成正式布置');
  }, 'act');
  applyBtn.disabled = true;
  panel.appendChild(row('候选区域显示', selectInput(
    [{ value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }],
    app.layers.candidate ? 'on' : 'off',
    v => { app.layers.candidate = v === 'on'; app.updateRenderer(); },
  )));
  panel.appendChild(runBtn);
  panel.appendChild(stopBtn);
  panel.appendChild(applyBtn);
  panel.appendChild(prog);
  panel.appendChild(el('div', 'note',
    '约束: 候选区域内、避让冲沟缓冲区、最小间距 ' + p.settings.minSpacingRD + 'D; 目标为全场净年发电量最大(含 Jensen 尾流与各项折减)。绿色为搜索过程中的当前最优解。'));
}

function terrainHeightAt(app: App, x: number, y: number): number {
  const t = app.displayTerrain;
  const fx = (x - t.originX) / t.cell, fy = (y - t.originY) / t.cell;
  const i = Math.max(0, Math.min(t.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(t.ny - 2, Math.floor(fy)));
  const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j));
  const k = j * t.nx + i;
  const a = t.z[k], b = t.z[k + 1], c = t.z[k + t.nx], d = t.z[k + t.nx + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
