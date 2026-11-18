// 地形建模页: 山脊线/冲沟提取参数、统计、排水展示
import { App } from './app';
import { el, button, kv, row, numInput, fmt } from './dom';
import { extractDrainage } from '../core/terrain';

function segsLength(segs: Float32Array): number {
  let len = 0;
  for (let i = 0; i < segs.length; i += 6) {
    len += Math.hypot(segs[i + 3] - segs[i], segs[i + 4] - segs[i + 1]);
  }
  return len;
}

export function renderTerrainPage(app: App): void {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';
  const t = app.project.terrain;
  let zMin = Infinity, zMax = -Infinity;
  for (const z of t.z) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z); }

  panel.appendChild(el('h3', '', '地形模型'));
  panel.appendChild(kv([
    ['网格规模', `${t.nx} × ${t.ny} × ${t.cell} m`],
    ['场地范围', `${((t.nx - 1) * t.cell / 1000).toFixed(1)} × ${((t.ny - 1) * t.cell / 1000).toFixed(1)} km`],
    ['高程范围', `${fmt(zMin, 0)} ~ ${fmt(zMax, 0)} m`],
  ]));

  panel.appendChild(el('h3', '', '山脊线 / 汇水冲沟自动提取'));
  let accThreshold = 60;
  let bufferM = 40;
  const statsDiv = el('div');
  const rebuild = () => {
    app.drainage = extractDrainage(app.project.terrain, accThreshold, bufferM);
    app.updateRenderer();
    statsDiv.innerHTML = '';
    const d = app.drainage;
    const bufCells = d.gullyMask.reduce((a, b) => a + b, 0);
    statsDiv.appendChild(kv([
      ['山脊线总长', `${fmt(segsLength(d.ridgeSegs) / 1000, 2)} km`],
      ['冲沟总长', `${fmt(segsLength(d.gullySegs) / 1000, 2)} km`],
      ['汇水缓冲区面积', `${fmt(bufCells * t.cell * t.cell / 1e4, 1)} hm²`],
    ]));
    statsDiv.appendChild(el('div', 'note',
      '红色为山脊线(排布机位参考), 蓝色为冲沟与汇水线(箭头指向排水方向)。冲沟缓冲区内禁止布置机位与道路, 自动优化与手动加点均会避让。'));
  };
  panel.appendChild(row('汇流阈值(网格数)', numInput(accThreshold, 10, v => { accThreshold = v; }, 10, 500)));
  panel.appendChild(row('冲沟缓冲距离 m', numInput(bufferM, 5, v => { bufferM = v; }, 0, 200)));
  panel.appendChild(button('重新提取', rebuild));
  panel.appendChild(statsDiv);
  rebuild();

  panel.appendChild(el('h3', '', '三维显示'));
  const toggles: [string, string][] = [
    ['ridge', '山脊线'], ['gully', '冲沟与排水走向'], ['pads', '平台边坡范围'], ['masts', '测风塔'],
  ];
  for (const [key, label] of toggles) {
    const lb = el('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = app.layers[key];
    cb.addEventListener('change', () => {
      app.layers[key] = cb.checked;
      app.updateRenderer();
    });
    lb.appendChild(cb);
    lb.appendChild(document.createTextNode(' ' + label));
    const r = el('div', 'row');
    r.appendChild(lb);
    panel.appendChild(r);
  }
}
