// 风资源分析页: 测风塔统计、风玫瑰、威布尔参数、风切变、折减设置、50m 网格资源图、尾流模型校验
import { App } from './app';
import { el, button, kv, row, numInput, selectInput, table, fmt } from './dom';
import { SECTORS } from '../core/wind';
import { computeGridMap } from '../core/aep';
import { analyticCenterlineDeficit, sectorDeficits, wakeDecayK } from '../core/wake';
import { getModel } from '../core/turbines';

const SECTOR_LABELS = ['N', 'N30E', 'N60E', 'E', 'E60S', 'E30S', 'S', 'S30W', 'S60W', 'W', 'W30N', 'W60N'];

export function renderWindPage(app: App): void {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';
  const p = app.project;

  // ---------- 测风塔概览 ----------
  panel.appendChild(el('h3', '', '测风塔与风资源'));
  let mastIdx = 0;
  const mastSel = selectInput(
    p.masts.map((m, i) => ({ value: String(i), label: `${m.name} (${m.heights.join('/')}m)` })),
    '0',
    v => { mastIdx = Number(v); drawMast(); },
  );
  panel.appendChild(row('选择测风塔', mastSel));
  const mastInfo = el('div');
  panel.appendChild(mastInfo);
  const rose = document.createElement('canvas');
  rose.className = 'rose';
  rose.width = 340; rose.height = 260;
  panel.appendChild(rose);
  const weibullDiv = el('div');
  panel.appendChild(weibullDiv);

  const drawMast = () => {
    const m = p.masts[mastIdx];
    const st = app.mastStats[mastIdx];
    const topH = m.heights[m.heights.length - 1];
    // 各高度平均风速
    const means = m.heights.map((_, hi) => {
      let s = 0;
      for (let i = 0; i < m.hours; i++) s += m.speed[hi][i];
      return s / m.hours;
    });
    const alphaAvg = st.alpha.reduce((a, b) => a + b, 0) / SECTORS;
    mastInfo.innerHTML = '';
    mastInfo.appendChild(kv([
      ['记录时长', `${m.hours} h (一年逐时)`],
      ['顶层高度', `${topH} m`],
      ['各层平均风速', means.map((v, i) => `${m.heights[i]}m:${fmt(v, 2)}`).join('  ')],
      ['平均风切变指数', fmt(alphaAvg, 3)],
      ['特征湍流强度(15m/s)', fmt(Math.max(...st.ti15) * 100, 1) + ' %'],
    ]));
    drawRose(rose, st.freq, st.A);
    // 分扇区威布尔表
    const rowsW: (string | number)[][] = [];
    for (let s = 0; s < SECTORS; s++) {
      rowsW.push([SECTOR_LABELS[s], fmt(st.freq[s] * 100, 1) + '%', fmt(st.A[s], 2), fmt(st.k[s], 2), fmt(st.alpha[s], 3)]);
    }
    weibullDiv.innerHTML = '';
    weibullDiv.appendChild(el('h4', '', `分扇区威布尔参数 (${topH}m)`));
    weibullDiv.appendChild(table(['扇区', '频率', 'A(m/s)', 'k', '切变α'], rowsW));
  };
  drawMast();

  // ---------- 折减系数 ----------
  panel.appendChild(el('h3', '', '发电量折减(逐项)'));
  const L = p.losses;
  const lossItems: [string, keyof typeof L][] = [
    ['可利用率损失', 'availability'], ['限电损失', 'curtailment'],
    ['叶片污染损失', 'soiling'], ['场用电及线损', 'station'],
  ];
  for (const [label, key] of lossItems) {
    panel.appendChild(row(label + ' %', numInput(L[key] * 100, 0.5, v => {
      L[key] = Math.max(0, Math.min(50, v)) / 100;
      app.refreshLayout();
      app.renderPanel();
    }, 0, 50)));
  }
  const totalLoss = 1 - (1 - L.availability) * (1 - L.curtailment) * (1 - L.soiling) * (1 - L.station);
  panel.appendChild(el('div', 'note', `综合折减 ${fmt(totalLoss * 100, 2)}% —— 各项连乘后参与年发电量核算。`));

  // ---------- 轮毂高度与全场重算 ----------
  panel.appendChild(el('h3', '', '轮毂高度与全场风速'));
  const model = getModel(p.settings.modelId);
  panel.appendChild(row('轮毂高度 m', selectInput(
    model.hubHeights.map(h => ({ value: String(h), label: `${h} m` })),
    String(p.settings.hubHeight),
    v => {
      p.settings.hubHeight = Number(v);
      for (const t of p.turbines) t.hubHeight = Number(v);
      app.refreshLayout();
      app.renderPanel();
    },
  )));
  panel.appendChild(el('div', 'note', '任意轮毂高度的风速按各扇区拟合的幂律风切变垂直廓线外推, 修改后全场风速与发电量自动重算。'));

  // ---------- 50m 网格资源图 ----------
  panel.appendChild(el('h3', '', '全场风资源图 (50m 网格)'));
  const overlaySel = selectInput(
    [{ value: 'none', label: '不叠加' }, { value: 'wind', label: '平均风速' }, { value: 'aep', label: '单机年发电量' }],
    app.overlayMode,
    v => { app.overlayMode = v as 'none' | 'wind' | 'aep'; app.applyOverlay(); legend(app); },
  );
  panel.appendChild(row('地形叠加层', overlaySel));
  const legendDiv = el('div');
  panel.appendChild(legendDiv);
  const legend = (a: App) => {
    legendDiv.innerHTML = '';
    if (a.overlayMode === 'none' || !a.gridMap) return;
    const g = a.gridMap;
    const data = a.overlayMode === 'wind' ? g.meanV : g.aep;
    let mn = Infinity, mx = -Infinity;
    for (const v of data) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const unit = a.overlayMode === 'wind' ? 'm/s' : 'MWh';
    const lg = el('div', 'legend');
    lg.appendChild(el('span', '', `${fmt(mn, 1)}`));
    const bar = el('div', 'bar');
    bar.style.background = 'linear-gradient(to right, rgb(49,54,149), rgb(69,117,180), rgb(116,173,89), rgb(254,224,144), rgb(215,48,39))';
    lg.appendChild(bar);
    lg.appendChild(el('span', '', `${fmt(mx, 1)} ${unit}`));
    legendDiv.appendChild(lg);
  };
  panel.appendChild(button('计算全场资源图', () => {
    app.status('正在计算 50m 网格风资源…');
    setTimeout(() => {
      app.gridMap = computeGridMap(p, app.mastStats, p.settings.modelId, p.settings.hubHeight, 50);
      if (app.overlayMode === 'none') app.overlayMode = 'wind';
      app.applyOverlay();
      app.renderPanel();
      app.status('资源图计算完成');
    }, 30);
  }));
  legend(app);

  // ---------- 尾流模型校验 ----------
  panel.appendChild(el('h3', '', '尾流模型校验 (Jensen/PARK)'));
  const k = wakeDecayK(p.settings.hubHeight, 0.1);
  const model0 = getModel(p.settings.modelId);
  const R = model0.rotorD / 2;
  const ct = 0.75;
  const rowsV: (string | number)[][] = [];
  for (const xD of [3, 5, 8, 10]) {
    const analytic = analyticCenterlineDeficit(ct, xD, k);
    const two = [
      { x: 0, y: 0, rotorR: R, ct },
      { x: xD * model0.rotorD, y: 0, rotorR: R, ct },
    ];
    const def = sectorDeficits(two, 270, k)[1]; // 西风, 下游机位在 +x
    rowsV.push([`${xD}D`, fmt(analytic * 100, 2) + '%', fmt(def * 100, 2) + '%']);
  }
  panel.appendChild(kv([
    ['尾流衰减常数 k', fmt(k, 4) + '  (z0=0.1m)'],
    ['叠加方式', '平方和 (√Σδᵢ²)'],
  ]));
  panel.appendChild(table(['下游距离', '解析解中心线亏损', '模型计算亏损'], rowsV));
  panel.appendChild(el('div', 'note',
    '单尾流中心线亏损 δ=(1-√(1-Ct))·(r₀/(r₀+kx))², 与 WAsP PARK 模型同构; 部分遮挡按叶轮-尾流截面重叠面积加权。'));
}

// 风玫瑰: 12 扇区频率(半径) × 平均风速(颜色)
function drawRose(canvas: HTMLCanvasElement, freq: number[], A: number[]): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2 + 6, Rmax = Math.min(W, H) / 2 - 30;
  const fMax = Math.max(...freq, 0.01);
  ctx.strokeStyle = '#3a4552';
  ctx.fillStyle = '#8b98a5';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  for (const rr of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, Rmax * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  const names12 = ['N', '', 'NE', '', 'E', '', 'SE', '', 'S', '', 'SW', '', 'W', '', 'NW', ''];
  for (let s = 0; s < SECTORS; s++) {
    const ang = (s * 30 - 90) * (Math.PI / 180);
    const r = (freq[s] / fMax) * Rmax;
    const a1 = ang - (Math.PI / SECTORS) * 0.85, a2 = ang + (Math.PI / SECTORS) * 0.85;
    const t = Math.min(1, Math.max(0, (A[s] - 4) / 8));
    ctx.fillStyle = `rgb(${Math.round(80 + 175 * t)}, ${Math.round(160 - 60 * t)}, ${Math.round(200 - 160 * t)})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a1, a2);
    ctx.closePath();
    ctx.fill();
    if (names12[s]) {
      ctx.fillStyle = '#8b98a5';
      ctx.fillText(names12[s], cx + Math.cos(ang) * (Rmax + 14), cy + Math.sin(ang) * (Rmax + 14) + 4);
    }
  }
  ctx.fillStyle = '#8b98a5';
  ctx.fillText(`最大扇区频率 ${(fMax * 100).toFixed(1)}%`, cx, H - 6);
}
