// The screen's building blocks: menus, the colour picker, dialogs with settings forms, prompts and
// toasts. Plain DOM; every popup closes on Esc or a click elsewhere.
import { icon } from './icons.js';
import { parseColor, toCss, clamp } from './util.js';
import { LINE_STYLES, dash } from './style.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- popups -----------------------------------------------------------------------------------

const open = [];

export function closePopups(except) {
  for (const p of open.slice()) if (p !== except && !(except && p.contains && p.contains(except))) {
    p.remove();
    open.splice(open.indexOf(p), 1);
    if (p._onClose) p._onClose();
  }
}

document.addEventListener('pointerdown', (e) => {
  if (!open.length) return;
  if (open.some((p) => p.contains(e.target))) return;
  closePopups();
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open.length) {
    e.stopPropagation();
    closePopups();
  }
}, true);

// Shows a popup at (x, y) (screen pixels), kept inside the window.
export function popup(content, x, y, { keepOthers = false, onClose } = {}) {
  if (!keepOthers) closePopups();
  content.classList.add('popup');
  content._onClose = onClose;
  document.body.appendChild(content);
  open.push(content);
  const r = content.getBoundingClientRect();
  content.style.left = clamp(x, 4, window.innerWidth - r.width - 4) + 'px';
  content.style.top = (y + r.height > window.innerHeight - 4 ? Math.max(4, y - r.height) : y) + 'px';
  return content;
}

export function popupBelow(content, anchor, opts) {
  const r = anchor.getBoundingClientRect();
  return popup(content, r.left, r.bottom + 4, opts);
}

// items: {label, icon, hint, check, disabled, action, sep, danger}
export function menu(items, x, y, opts) {
  const m = el('div', 'menu');
  for (const it of items) {
    if (it.sep) {
      m.appendChild(el('div', 'menu-sep'));
      continue;
    }
    if (it.title) {
      m.appendChild(el('div', 'menu-title', esc(it.title)));
      continue;
    }
    const row = el('button', 'menu-item' + (it.danger ? ' danger' : '') + (it.check ? ' checked' : ''));
    row.type = 'button';
    row.disabled = !!it.disabled;
    row.innerHTML = '<span class="mi-icon">' + (it.icon ? icon(it.icon, 18) : it.check ? icon('check', 16) : '') + '</span><span class="mi-label">' + esc(it.label) + '</span>' + (it.hint ? '<span class="mi-hint">' + esc(it.hint) + '</span>' : '');
    row.addEventListener('click', () => {
      closePopups();
      if (it.action) it.action();
    });
    m.appendChild(row);
  }
  return popup(m, x, y, opts);
}

export function menuBelow(items, anchor) {
  const r = anchor.getBoundingClientRect();
  return menu(items, r.left, r.bottom + 4);
}

// ---- colours ----------------------------------------------------------------------------------

const PALETTE = [
  ['#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#131722', '#000000'],
  ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'],
  ['#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#ace5dc', '#b2ebf2', '#bbd9fb', '#d1c4e9', '#e1bee7', '#f8bbd0'],
  ['#faa1a4', '#ffcc80', '#fff59d', '#a5d6a7', '#70ccbd', '#80deea', '#90bff9', '#b39ddb', '#ce93d8', '#f48fb1'],
  ['#f7525f', '#ffb74d', '#fff176', '#81c784', '#42bda8', '#4dd0e1', '#5b9cf6', '#9575cd', '#ba68c8', '#f06292'],
  ['#b22833', '#f57c00', '#fbc02d', '#388e3c', '#056656', '#0097a7', '#1848cc', '#512da8', '#7b1fa2', '#c2185b'],
  ['#801922', '#e65100', '#f57f17', '#1b5e20', '#00332a', '#006064', '#0c3299', '#311b92', '#4a148c', '#880e4f'],
];

// A colour picker below anchor: the palette, opacity, and a typed colour. onChange gets CSS text.
export function colorPicker(anchor, value, onChange) {
  const start = parseColor(value) || { r: 41, g: 98, b: 255, a: 1 };
  let cur = { ...start };
  const box = el('div', 'colors');
  const grid = el('div', 'color-grid');
  for (const row of PALETTE) for (const c of row) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = c;
    b.title = c;
    const pc = parseColor(c);
    if (pc.r === start.r && pc.g === start.g && pc.b === start.b) b.classList.add('on');
    b.addEventListener('click', () => {
      cur = { ...pc, a: cur.a };
      grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      sync();
    });
    grid.appendChild(b);
  }
  box.appendChild(grid);
  const opacity = el('div', 'color-row');
  opacity.innerHTML = '<span>Opacity</span><input type="range" min="0" max="100" step="1"><b></b>';
  const range = opacity.querySelector('input');
  const pct = opacity.querySelector('b');
  range.value = Math.round(cur.a * 100);
  range.addEventListener('input', () => {
    cur.a = range.value / 100;
    sync();
  });
  box.appendChild(opacity);
  const typed = el('div', 'color-row');
  typed.innerHTML = '<span>Colour</span><input type="text" spellcheck="false" class="color-text">';
  const text = typed.querySelector('input');
  text.addEventListener('change', () => {
    const c = parseColor(text.value);
    if (c) {
      cur = c;
      range.value = Math.round(cur.a * 100);
      sync();
    } else text.value = toCss(cur);
  });
  box.appendChild(typed);
  function sync() {
    pct.textContent = Math.round(cur.a * 100) + '%';
    text.value = toCss(cur);
    onChange(toCss(cur));
  }
  pct.textContent = Math.round(cur.a * 100) + '%';
  text.value = toCss(cur);
  return popupBelow(box, anchor, { keepOthers: true });
}

// A swatch button showing a colour; clicking opens the picker.
export function colorButton(value, onChange, title = 'Colour') {
  const b = el('button', 'color-btn');
  b.type = 'button';
  b.title = title;
  const set = (v) => {
    b.style.setProperty('--c', v || 'transparent');
    b.classList.toggle('empty', !v);
  };
  set(value);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    colorPicker(b, value || '#2962ff', (v) => {
      value = v;
      set(v);
      onChange(v);
    });
  });
  return b;
}

// ---- settings forms ---------------------------------------------------------------------------

function widthSelect(value, onChange) {
  const s = el('select', 'width-select');
  for (const w of [1, 2, 3, 4]) s.appendChild(new Option(w + 'px', w));
  s.value = String(value || 1);
  s.addEventListener('change', () => onChange(Number(s.value)));
  return s;
}

function styleSelect(value, onChange) {
  const s = el('select', 'style-select');
  for (const [v, label] of LINE_STYLES) s.appendChild(new Option(label, v));
  s.value = value || 'solid';
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function levelsEditor(levels, onChange) {
  const box = el('div', 'levels');
  const list = levels.map((l) => ({ ...l }));
  const emit = () => onChange(list.map((l) => ({ ...l })));
  list.forEach((l) => {
    const row = el('div', 'level');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!l.show;
    cb.addEventListener('change', () => {
      l.show = cb.checked;
      emit();
    });
    const v = el('input', 'num');
    v.type = 'number';
    v.step = '0.001';
    v.value = l.v;
    v.addEventListener('change', () => {
      const n = Number(v.value);
      if (Number.isFinite(n)) l.v = n;
      emit();
    });
    row.append(cb, v, colorButton(l.color, (c) => {
      l.color = c;
      emit();
    }));
    box.appendChild(row);
  });
  return box;
}

// One form tab: rows of label and fields. get(path) and set(path, value) read and change.
export function formTab(rows, get, set, ctx = {}) {
  const body = el('div', 'form');
  for (const row of rows) {
    const r = el('div', 'form-row' + (row.label ? '' : ' wide'));
    if (row.label) r.appendChild(el('label', 'form-label', esc(row.label)));
    const fields = el('div', 'form-fields');
    for (const f of row.fields) {
      const v = get(f.path);
      let input;
      switch (f.type) {
        case 'color':
          input = colorButton(v, (c) => set(f.path, c));
          break;
        case 'width':
          input = widthSelect(v, (w) => set(f.path, w));
          break;
        case 'style':
          input = styleSelect(v, (s) => set(f.path, s));
          break;
        case 'check':
          input = el('input');
          input.type = 'checkbox';
          input.checked = !!v;
          input.addEventListener('change', () => set(f.path, input.checked));
          break;
        case 'select':
          input = el('select');
          for (const [val, label] of f.options) input.appendChild(new Option(label, val));
          input.value = String(v);
          input.addEventListener('change', () => {
            const o = f.options.find(([val]) => String(val) === input.value);
            set(f.path, o ? o[0] : input.value);
          });
          break;
        case 'number':
        case 'price':
          input = el('input', 'num');
          input.type = 'number';
          if (f.min !== undefined) input.min = f.min;
          if (f.max !== undefined) input.max = f.max;
          input.step = f.type === 'price' ? String(Math.pow(10, -(ctx.digits || 2))) : f.step || 'any';
          input.value = f.type === 'price' && Number.isFinite(v) ? v.toFixed(ctx.digits || 2) : v;
          input.addEventListener('change', () => {
            let n = Number(input.value);
            if (!Number.isFinite(n)) return;
            if (f.min !== undefined) n = Math.max(f.min, n);
            if (f.max !== undefined) n = Math.min(f.max, n);
            set(f.path, n);
          });
          break;
        case 'textarea':
          input = el('textarea');
          input.rows = 3;
          input.value = v || '';
          input.addEventListener('input', () => set(f.path, input.value));
          break;
        case 'levels':
          input = levelsEditor(v || [], (l) => set(f.path, l));
          break;
        default:
          input = el('input');
          input.value = v || '';
          input.addEventListener('input', () => set(f.path, input.value));
      }
      fields.appendChild(input);
    }
    r.appendChild(fields);
    body.appendChild(r);
  }
  return body;
}

// A dialog: title, tabs, and a footer with buttons (left: template menu; right: Cancel, Ok).
export function dialog({ title, tabs, footerLeft, onOk, onCancel, width = 440 }) {
  closePopups();
  const shade = el('div', 'shade');
  const d = el('div', 'dialog');
  d.style.width = width + 'px';
  const head = el('div', 'dialog-head', '<span>' + esc(title) + '</span>');
  const x = el('button', 'icon-btn', icon('close', 18));
  x.type = 'button';
  x.title = 'Close';
  head.appendChild(x);
  d.appendChild(head);
  const tabBar = el('div', 'tabs');
  const bodies = el('div', 'dialog-body');
  tabs.forEach((t, k) => {
    const b = el('button', 'tab' + (k ? '' : ' on'), esc(t.name));
    b.type = 'button';
    b.addEventListener('click', () => {
      tabBar.querySelectorAll('.tab').forEach((q) => q.classList.remove('on'));
      b.classList.add('on');
      bodies.querySelectorAll('.tab-body').forEach((q, j) => (q.hidden = j !== k));
    });
    tabBar.appendChild(b);
    const body = t.body;
    body.classList.add('tab-body');
    body.hidden = k !== 0;
    bodies.appendChild(body);
  });
  if (tabs.length > 1) d.appendChild(tabBar);
  d.appendChild(bodies);
  const foot = el('div', 'dialog-foot');
  const left = el('div', 'foot-left');
  if (footerLeft) left.appendChild(footerLeft);
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  const ok = el('button', 'btn primary', 'Ok');
  ok.type = 'button';
  foot.append(left, cancel, ok);
  d.appendChild(foot);
  shade.appendChild(d);
  document.body.appendChild(shade);
  let done = false;
  const close = (accepted) => {
    if (done) return;
    done = true;
    shade.remove();
    document.removeEventListener('keydown', keys, true);
    if (accepted) onOk && onOk();
    else onCancel && onCancel();
  };
  const keys = (e) => {
    if (open.length) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(false);
    } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.stopPropagation();
      close(true);
    }
  };
  document.addEventListener('keydown', keys, true);
  x.addEventListener('click', () => close(false));
  cancel.addEventListener('click', () => close(false));
  ok.addEventListener('click', () => close(true));
  shade.addEventListener('pointerdown', (e) => {
    if (e.target === shade) close(false);
  });
  dragBy(head, d);
  return { el: d, close };
}

// Lets the user move box by dragging handle.
export function dragBy(handle, box, onEnd) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      box.style.left = clamp(ev.clientX - dx, 0, window.innerWidth - r.width) + 'px';
      box.style.top = clamp(ev.clientY - dy, 0, window.innerHeight - 30) + 'px';
      box.style.transform = 'none';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (onEnd) onEnd(box);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

// A one-field prompt. Resolves to the text, or null when cancelled.
export function prompt({ title, label, value = '', multiline = false }) {
  return new Promise((resolve) => {
    const body = el('div', 'form');
    const row = el('div', 'form-row wide');
    if (label) body.appendChild(el('div', 'form-note', esc(label)));
    const input = el(multiline ? 'textarea' : 'input');
    if (multiline) input.rows = 4;
    input.value = value;
    row.appendChild(input);
    body.appendChild(row);
    dialog({
      title, width: 380, tabs: [{ name: title, body }],
      onOk: () => resolve(input.value),
      onCancel: () => resolve(null),
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

export function confirmBox({ title, text }) {
  return new Promise((resolve) => {
    const body = el('div', 'form', '<div class="form-note">' + esc(text) + '</div>');
    dialog({ title, width: 380, tabs: [{ name: title, body }], onOk: () => resolve(true), onCancel: () => resolve(false) });
  });
}

let toastTimer = null;
export function toast(text, ms = 2500) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', 'toast');
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// A small preview of a line style, for buttons.
export function linePreview(style, width) {
  const d = dash(style, width).join(' ');
  return '<svg width="28" height="10" viewBox="0 0 28 10"><path d="M2 5h24" stroke="currentColor" stroke-width="' + width + '"' + (d ? ' stroke-dasharray="' + d + '"' : '') + '/></svg>';
}
