// 报告页: 机位坐标、单机年发电量、尾流损失、容量系数、噪声结论汇总, 可导出
import { App } from './app';
import { el, button, table, fmt } from './dom';
import { getModel } from '../core/turbines';

export function renderReportPage(app: App): void {
  const view = document.getElementById('report-view')!;
  view.innerHTML = '';
  const p = app.project;
  const aep = app.aep;
  if (!aep || !app.earthworks) {
    view.appendChild(el('div', 'note', '数据尚未计算完成'));
    return;
  }

  const actions = el('div', 'rep-actions');
  actions.appendChild(button('导出 Markdown 报告', () => download(`${p.name}-报告.md`, buildMarkdown(app), 'text/markdown')));
  actions.appendChild(button('导出机位 CSV', () => download(`${p.name}-机位.csv`, buildCsv(app), 'text/csv')));
  view.appendChild(actions);

  view.appendChild(el('h2', '', `${p.name} —— 微观选址设计报告`));
  view.appendChild(el('div', 'note', `机位 ${p.turbines.length} 台 · 机型 ${getModel(p.settings.modelId).name} · 轮毂高度 ${p.settings.hubHeight} m · 生成日期 ${new Date().toISOString().slice(0, 10)}`));

  view.appendChild(el('h3', '', '一、全场指标'));
  const L = p.losses;
  const totalLossPct = (1 - (1 - L.availability) * (1 - L.curtailment) * (1 - L.soiling) * (1 - L.station)) * 100;
  const ratedMW = p.turbines.reduce((a, t) => a + getModel(t.modelId).ratedKW, 0) / 1000;
  view.appendChild(table(['指标', '数值'], [
    ['装机容量', `${fmt(ratedMW, 1)} MW`],
    ['年发电量(毛, 无尾流)', `${fmt(aep.totalGross, 0)} MWh`],
    ['年发电量(净)', `${fmt(aep.totalNet, 0)} MWh`],
    ['全场尾流损失', `${fmt(aep.wakeLossPct, 2)} %`],
    ['容量系数', `${fmt(aep.capacityFactor * 100, 1)} %`],
    ['年等效满发小时数', `${fmt(ratedMW > 0 ? aep.totalNet / ratedMW : 0, 0)} h`],
    ['综合折减(可利用率/限电/污染/场用电)', `${fmt(totalLossPct, 2)} %`],
    ['全场挖方 / 填方', `${fmt(app.earthworks.totalCut, 0)} / ${fmt(app.earthworks.totalFill, 0)} m³`],
    ['集电线路总长', `${fmt(app.circuits.reduce((a, c) => a + c.cableM, 0) / 1000, 2)} km (${app.circuits.length} 回)`],
  ]));

  view.appendChild(el('h3', '', '二、机位坐标与单机年发电量'));
  view.appendChild(table(
    ['机位', 'X(m)', 'Y(m)', '高程(m)', '轮毂(m)', '毛发电量(MWh)', '净发电量(MWh)', '尾流损失', '挖方(m³)', '填方(m³)'],
    p.turbines.map((t, i) => {
      const a = aep.per[i];
      const pad = app.earthworks!.pads.find(pd => pd.turbineId === t.id);
      return [
        t.label, t.x, t.y, fmt(terrainZ(app, t.x, t.y), 1), t.hubHeight,
        fmt(a.gross, 0), fmt(a.net, 0), fmt(a.wakeLoss * 100, 1) + '%',
        pad ? fmt(pad.cut, 0) : '-', pad ? fmt(pad.fill, 0) : '-',
      ];
    }),
  ));

  view.appendChild(el('h3', '', '三、噪声合规结论'));
  const bad = app.noise.filter(n => n.exceedDay || n.exceedNight);
  view.appendChild(table(
    ['居民点', '等效声级(dBA)', '昼间限值', '夜间限值', '结论', '需退让'],
    app.noise.map(n => {
      const h = p.houses.find(x => x.id === n.houseId);
      return [
        h?.name ?? n.houseId, fmt(n.level, 1), n.dayLimit, n.nightLimit,
        n.exceedNight ? '夜间超标' : n.exceedDay ? '昼间超标' : '达标',
        n.setbackM > 0 ? `${n.setbackM} m (主导声源 ${n.dominant})` : '—',
      ];
    }),
    i => (app.noise[i].exceedNight || app.noise[i].exceedDay ? 'bad' : ''),
  ));
  view.appendChild(el('div', bad.length
    ? 'note bad-text'
    : 'note good-text',
    bad.length
      ? `结论: ${bad.length} 户声级超标, 需按上表退让或调整机位。`
      : '结论: 全部居民点昼夜声级均满足限值要求。'));
}

function terrainZ(app: App, x: number, y: number): number {
  const t = app.project.terrain;
  const i = Math.max(0, Math.min(t.nx - 1, Math.round((x - t.originX) / t.cell)));
  const j = Math.max(0, Math.min(t.ny - 1, Math.round((y - t.originY) / t.cell)));
  return t.z[j * t.nx + i];
}

function buildMarkdown(app: App): string {
  const p = app.project;
  const aep = app.aep!;
  const lines: string[] = [];
  lines.push(`# ${p.name} 微观选址设计报告`, '');
  lines.push(`- 机位数: ${p.turbines.length}`);
  lines.push(`- 机型: ${getModel(p.settings.modelId).name}, 轮毂高度 ${p.settings.hubHeight} m`);
  lines.push(`- 年发电量(毛/净): ${fmt(aep.totalGross, 0)} / ${fmt(aep.totalNet, 0)} MWh`);
  lines.push(`- 尾流损失: ${fmt(aep.wakeLossPct, 2)} %, 容量系数: ${fmt(aep.capacityFactor * 100, 1)} %`);
  lines.push(`- 挖方/填方: ${fmt(app.earthworks!.totalCut, 0)} / ${fmt(app.earthworks!.totalFill, 0)} m³`, '');
  lines.push('| 机位 | X | Y | 净发电量MWh | 尾流损失 |', '|---|---|---|---|---|');
  p.turbines.forEach((t, i) => {
    const a = aep.per[i];
    lines.push(`| ${t.label} | ${t.x} | ${t.y} | ${fmt(a.net, 0)} | ${fmt(a.wakeLoss * 100, 1)}% |`);
  });
  lines.push('', '## 噪声');
  for (const n of app.noise) {
    const h = p.houses.find(x => x.id === n.houseId);
    lines.push(`- ${h?.name}: ${fmt(n.level, 1)} dBA, ${n.exceedNight || n.exceedDay ? `超标, 需退让 ${n.setbackM}m` : '达标'}`);
  }
  return lines.join('\n');
}

function buildCsv(app: App): string {
  const p = app.project;
  const aep = app.aep!;
  const rows = ['机位,X(m),Y(m),轮毂高度(m),毛发电量(MWh),净发电量(MWh),尾流损失(%)'];
  p.turbines.forEach((t, i) => {
    const a = aep.per[i];
    rows.push(`${t.label},${t.x},${t.y},${t.hubHeight},${a.gross.toFixed(1)},${a.net.toFixed(1)},${(a.wakeLoss * 100).toFixed(2)}`);
  });
  return '﻿' + rows.join('\n');
}

function download(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
