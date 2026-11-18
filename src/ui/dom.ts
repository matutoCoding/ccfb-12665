// DOM 小工具
export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function row(label: string, input: HTMLElement): HTMLElement {
  const r = el('div', 'row');
  r.appendChild(el('label', '', label));
  r.appendChild(input);
  return r;
}

export function numInput(value: number, step: number, onChange: (v: number) => void, min?: number, max?: number): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.step = String(step);
  i.value = String(value);
  if (min !== undefined) i.min = String(min);
  if (max !== undefined) i.max = String(max);
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

export function selectInput(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  for (const o of options) {
    const op = document.createElement('option');
    op.value = o.value;
    op.textContent = o.label;
    s.appendChild(op);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function button(text: string, onClick: () => void, cls = 'act'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

export function kv(pairs: [string, string][]): HTMLElement {
  const d = el('div', 'kv');
  for (const [k, v] of pairs) {
    d.appendChild(el('span', 'k', k));
    d.appendChild(el('span', 'v', v));
  }
  return d;
}

export function table(headers: string[], rows: (string | number)[][], rowCls?: (i: number) => string): HTMLElement {
  const t = el('table', 'data');
  const thead = el('thead');
  const trh = el('tr');
  for (const h of headers) trh.appendChild(el('th', '', h));
  thead.appendChild(trh);
  t.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr');
    if (rowCls && rowCls(i)) tr.className = rowCls(i);
    for (const c of r) tr.appendChild(el('td', '', String(c)));
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  return t;
}

export function fmt(v: number, digits = 1): string {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
