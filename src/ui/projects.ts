// 项目列表页
import { App } from './app';
import { el, button } from './dom';
import { deleteProject, duplicateProject, listProjects, loadProject } from '../data/store';

export function renderProjects(app: App, openProject: (id: string) => void): void {
  const panel = document.getElementById('panel')!;
  panel.innerHTML = '';
  panel.appendChild(el('h3', '', '项目列表'));
  panel.appendChild(el('div', 'note', '示例项目自带山区地形与一年逐时测风数据, 打开即可查看尾流与发电量。'));

  for (const meta of listProjects()) {
    const card = el('div', 'proj-card');
    card.appendChild(el('div', 'nm', meta.name));
    card.appendChild(el('div', 'meta', `${meta.turbines} 台机位 · 创建于 ${meta.createdAt}`));
    card.addEventListener('click', () => openProject(meta.id));
    panel.appendChild(card);
  }

  panel.appendChild(el('h3', '', '操作'));
  panel.appendChild(button('以当前项目为模板新建', () => {
    const name = prompt('新项目名称', app.project.name + ' 副本');
    if (!name) return;
    const copy = duplicateProject(app.project, name);
    openProject(copy.id);
  }));
  if (app.project.id !== 'sample') {
    panel.appendChild(button('删除当前项目', () => {
      if (!confirm(`确定删除项目「${app.project.name}」?`)) return;
      deleteProject(app.project.id);
      openProject('sample');
    }, 'act danger'));
  }
  panel.appendChild(el('div', 'note',
    '说明: 示例项目为只读模板, 对其修改不会保存; 新建副本后的修改会自动保存到浏览器本地。'));
}
