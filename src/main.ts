// 入口: 初始化渲染器、加载项目、装配导航与图层开关
import { App, PageName } from './ui/app';
import { Renderer } from './gl/renderer';
import { loadProject } from './data/store';
import { renderProjects } from './ui/projects';
import { renderTerrainPage } from './ui/terrainPage';
import { renderLayoutPage } from './ui/layoutPage';
import { renderWindPage } from './ui/windPage';
import { renderReportPage } from './ui/reportPage';

const PAGES: { id: PageName; label: string; ico: string }[] = [
  { id: 'projects', label: '项目', ico: '📁' },
  { id: 'terrain', label: '地形建模', ico: '⛰️' },
  { id: 'layout', label: '机位布置', ico: '🌀' },
  { id: 'wind', label: '风资源', ico: '🌬️' },
  { id: 'report', label: '报告', ico: '📄' },
];

let app: App;

function openProject(id: string): void {
  const p = loadProject(id);
  if (!p) {
    document.getElementById('status-text')!.textContent = `项目 ${id} 加载失败`;
    return;
  }
  app = new App(p, renderer);
  (window as unknown as { __app: App }).__app = app; // 调试句柄
  app.registerPage('projects', a => renderProjects(a, openProject));
  app.registerPage('terrain', renderTerrainPage);
  app.registerPage('layout', renderLayoutPage);
  app.registerPage('wind', renderWindPage);
  app.registerPage('report', renderReportPage);
  document.getElementById('project-name')!.textContent = p.name;
  app.setPage(currentPage);
  app.status(`已加载项目「${p.name}」`);
}

// 渲染器(全局唯一, 项目切换时复用)
const glCanvas = document.getElementById('glcanvas') as HTMLCanvasElement;
const labelCanvas = document.getElementById('labelcanvas') as HTMLCanvasElement;
const renderer = new Renderer(glCanvas, labelCanvas, fps => {
  document.getElementById('fps')!.textContent = `${fps} FPS`;
});

// 导航
const nav = document.getElementById('sidenav')!;
let currentPage: PageName = 'projects';
for (const pg of PAGES) {
  const b = document.createElement('button');
  b.dataset.page = pg.id;
  b.innerHTML = `<span class="ico">${pg.ico}</span>${pg.label}`;
  b.addEventListener('click', () => {
    currentPage = pg.id;
    app?.setPage(pg.id);
  });
  nav.appendChild(b);
}

// 顶栏图层开关
const LAYERS: [string, string][] = [
  ['ridge', '山脊线'], ['gully', '冲沟排水'], ['pads', '平台边坡'],
  ['cables', '集电线路'], ['houses', '居民点'], ['roughness', '粗糙度'], ['candidate', '候选区'],
];
const toggleBar = document.getElementById('layer-toggles')!;
for (const [key, label] of LAYERS) {
  const lb = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = key !== 'roughness' && key !== 'candidate';
  lb.classList.toggle('on', cb.checked);
  cb.addEventListener('change', () => {
    lb.classList.toggle('on', cb.checked);
    if (app) {
      app.layers[key] = cb.checked;
      app.updateRenderer();
    }
  });
  lb.appendChild(cb);
  lb.appendChild(document.createTextNode(label));
  toggleBar.appendChild(lb);
}

openProject('sample');
