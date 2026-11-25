// The Modern Screen: wires the feed from MT5, the chart, the toolbars, the drawings, the templates
// and the network indicator together.
import { Chart } from './chart.js';
import { Series } from './series.js';
import { Feed } from './feed.js';
import { Store } from './store.js';
import { TOOLS, GROUPS } from './tools.js';
import { CHART_FIELDS, CHART_TYPES, getPath, setPath } from './style.js';
import { TIMEFRAMES, FAVORITES, tfLabel, isTimeframe, parseInterval } from './timeframes.js';
import { emptyTemplates, readTemplates, mergeTemplates, toolStart, chartStart } from './templates.js';
import { clone, debounce, drawingsFile, formatPrice, merge, withAlpha } from './util.js';
import { icon } from './icons.js';
import { Watchlist } from './watchlist.js';
import { el, esc, menu, menuBelow, popupBelow, closePopups, colorPicker, dialog, formTab, prompt, confirmBox, toast, dragBy, linePreview } from './ui.js';

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const TERM = Number(params.get('term')) || 0;
const KEY = hash.get('key') || '';
document.title = 'Modern Screen' + (TERM ? ' #' + TERM : '');

const store = new Store(KEY);
const chart = new Chart(document.getElementById('chart'));
const D = chart.drawings;
const feed = KEY ? new Feed('ws://' + location.host + '/ws?term=' + TERM, KEY) : null;

const LAYOUT_DEFAULT = {
  symbol: '',
  tf: 'H1',
  style: null,
  watchlist: true,
  favorites: FAVORITES.slice(),
  magnet: false,
  stay: false,
  ftb: null,
  groupTool: {},
};

const app = {
  layout: clone(LAYOUT_DEFAULT),
  templates: emptyTemplates(),
  hello: null,
  symbols: [],         // Market Watch: {name, desc, digits}
  quotes: new Map(),   // symbol -> {bid, ask, prev}
  loadToken: 0,
  loadingMore: false,
  tickTime: 0,         // the last tick's server time, ms
  offsets: [],         // lower bounds of (server time - this PC's time), ms, with when seen
  perf: { render: NaN, delay: NaN },
};

const saveLayout = debounce(() => store.put('layout.json', app.layout).catch((e) => toast(e.message)), 400);
const saveDrawings = debounce((symbol, items) => store.put(drawingsFile(symbol), { version: 1, symbol, items }).catch((e) => toast(e.message)), 300);
const saveTemplates = () => store.put('templates.json', app.templates).catch((e) => toast(e.message));

// ---- the top bar ------------------------------------------------------------------------------

const top = document.getElementById('top');
const left = document.getElementById('left');
const right = document.getElementById('right');
const legend = document.getElementById('legend');
const notice = document.getElementById('notice');
const corner = document.getElementById('corner');

function tbButton(html, title, onClick, cls = '') {
  const b = el('button', 'tb ' + cls, html);
  b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const symbolBtn = tbButton('', 'Symbol search (start typing on the chart)', () => openSearch(''), 'symbol-btn');
const tfBox = el('div', 'tf-box');
tfBox.style.display = 'flex';
const tfMore = tbButton(icon('chevron', 16), 'All timeframes', (e) => {
  menuBelow(TIMEFRAMES.map((t) => ({
    label: t.label + '  (' + t.id + ')',
    check: app.layout.tf === t.id,
    action: () => setTimeframe(t.id),
  })).concat([{ sep: true }, { label: 'Choose the timeframe buttons...', action: chooseFavorites }]), e.currentTarget);
}, 'icon');
const typeBtn = tbButton(icon('candles'), 'Chart type', (e) => {
  menuBelow(CHART_TYPES.map(([id, label]) => ({ label, check: chart.style.chartType === id, action: () => changeStyle('chartType', id) })), e.currentTarget);
}, 'icon');
const undoBtn = tbButton(icon('undo'), 'Undo (Ctrl+Z)', () => D.undo() && chart.invalidate(), 'icon');
const redoBtn = tbButton(icon('redo'), 'Redo (Ctrl+Y)', () => D.redo() && chart.invalidate(), 'icon');
const netBtn = tbButton('<span class="dot"></span><span class="ms">-- ms</span>', 'Network and speed', () => openNet(), 'net');
const watchBtn = tbButton(icon('list'), 'Watchlist', () => {
  app.layout.watchlist = !app.layout.watchlist;
  showWatchlist();
  saveLayout();
}, 'icon');
const settingsBtn = tbButton(icon('gear'), 'Chart settings', () => openChartSettings(), 'icon');
const windowBtn = tbButton(icon('popout'), '', () => {
  if (feed) feed.setSeparate(!feed.separate);
}, 'icon');
const hideBtn = tbButton(icon('mt5') + '<span>MT5 charts</span>', 'Hide the screen and show MetaTrader 5\'s own charts (Ctrl+Alt+M shows it again)', () => {
  if (feed) feed.hide();
}, 'hide-label');

function sep() {
  return el('div', 'sep');
}
function grow() {
  return el('div', 'grow');
}

top.append(symbolBtn, sep(), tfBox, tfMore, sep(), typeBtn, sep(), undoBtn, redoBtn, grow(), netBtn, sep(), watchBtn, settingsBtn, windowBtn, hideBtn);

function paintWindowBtn() {
  const separate = !!(feed && feed.separate);
  windowBtn.innerHTML = icon(separate ? 'glue' : 'popout');
  windowBtn.title = separate ? 'Glue the screen onto the chart area of MetaTrader 5' :'Make the screen a window of its own (to move it to another monitor)';
  windowBtn.hidden = !feed;
}

function renderTop() {
  const sym = app.layout.symbol;
  const s = app.symbols.find((x) => x.name === sym);
  symbolBtn.innerHTML = icon('search', 18) + '<span>' + esc(sym || 'Symbol') + '</span>' + (s && s.desc ? '<small>' + esc(s.desc) + '</small>' : '');
  tfBox.innerHTML = '';
  for (const id of app.layout.favorites) {
    const b = tbButton(esc(tfLabel(id)), id, () => setTimeframe(id), 'tf-btn' + (app.layout.tf === id ? ' on' : ''));
    tfBox.appendChild(b);
  }
  undoBtn.disabled = !D.undoStack.length;
  redoBtn.disabled = !D.redoStack.length;
  watchBtn.classList.toggle('on', app.layout.watchlist);
}

function chooseFavorites() {
  const body = el('div', 'form');
  const picked = new Set(app.layout.favorites);
  const grid = el('div', 'levels');
  for (const t of TIMEFRAMES) {
    const row = el('label', 'level');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = picked.has(t.id);
    cb.addEventListener('change', () => (cb.checked ? picked.add(t.id) : picked.delete(t.id)));
    row.append(cb, document.createTextNode(t.label + ' (' + t.id + ')'));
    grid.appendChild(row);
  }
  body.appendChild(grid);
  dialog({
    title: 'Timeframe buttons', width: 380, tabs: [{ name: 'Timeframes', body }],
    onOk: () => {
      app.layout.favorites = TIMEFRAMES.map((t) => t.id).filter((id) => picked.has(id));
      renderTop();
      saveLayout();
    },
  });
}

// ---- the left toolbar -------------------------------------------------------------------------

const cursorBtn = el('button', 'tool', icon('cursor'));
cursorBtn.title = 'Cursor (Esc)';
cursorBtn.addEventListener('click', () => D.setTool(null));
left.appendChild(cursorBtn);
left.appendChild(el('div', 'sep'));
const groupBtns = new Map();
for (const g of GROUPS) {
  const b = el('button', 'tool');
  b.type = 'button';
  const current = () => app.layout.groupTool[g.id] || g.tools[0];
  const paint = () => {
    const t = current();
    b.innerHTML = icon(t) + (g.tools.length > 1 ? '<span class="more">' + icon('chevron', 10) + '</span>' : '');
    b.title = TOOLS[t].name + (TOOLS[t].key ? ' (' + TOOLS[t].key + ')' : '') + (g.tools.length > 1 ? '; the small arrow shows more' : '');
  };
  const flyout = () => {
    const r = b.getBoundingClientRect();
    menu(groupMenu(g), r.right + 4, r.top);
  };
  b.addEventListener('click', (e) => {
    if (e.target.closest('.more')) {
      flyout();
      return;
    }
    pickTool(g, current());
  });
  // Right-click: the tools and their saved templates, as on the big charting sites.
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    flyout();
  });
  b.paint = paint;
  paint();
  groupBtns.set(g.id, b);
  left.appendChild(b);
}
left.appendChild(el('div', 'sep'));
const magnetBtn = toggleTool('magnet', 'Magnet: points snap to open, high, low or close', () => (D.magnet = app.layout.magnet = !app.layout.magnet));
const stayBtn = toggleTool('stay', 'Keep drawing with the same tool', () => (D.stay = app.layout.stay = !app.layout.stay));
const lockBtn = toggleTool('lock', 'Lock every drawing', () => (D.locked = !D.locked));
const hideAllBtn = toggleTool('eyeOff', 'Hide every drawing', () => (D.hidden = !D.hidden));
const removeBtn = el('button', 'tool', icon('trash'));
removeBtn.title = 'Remove every drawing on this symbol';
removeBtn.addEventListener('click', async () => {
  if (!D.items.length) return;
  if (await confirmBox({ title: 'Remove drawings', text: 'Remove all ' + D.items.length + ' drawings on ' + app.layout.symbol + '? Undo (Ctrl+Z) brings them back.' })) {
    D.removeAll();
    chart.invalidate();
  }
});
left.appendChild(removeBtn);

function toggleTool(name, title, flip) {
  const b = el('button', 'tool', icon(name));
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', () => {
    b.classList.toggle('on', !!flip());
    saveLayout();
    chart.invalidate();
  });
  left.appendChild(b);
  return b;
}

function pickTool(g, t, armed) {
  app.layout.groupTool[g.id] = t;
  groupBtns.get(g.id).paint();
  saveLayout();
  if (armed) {
    D.setTool(t, armed);
    toast(TOOLS[t].name + ' "' + armed.name + '": click on the chart', 3000);
  } else D.setTool(D.tool === t && !D.armed ? null : t);
}

const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// A group's tools, each followed by its saved templates: picking one draws the next drawing with it.
function groupMenu(g) {
  const items = [];
  for (const t of g.tools) {
    items.push({ label: TOOLS[t].name, icon: t, hint: TOOLS[t].key || '', check: D.tool === t && !D.armed, action: () => pickTool(g, t) });
    const list = app.templates.tools[t] || {};
    for (const n of Object.keys(list).sort(byName)) {
      items.push({ label: '    ' + n, check: !!(D.armed && D.armed.type === t && D.armed.name === n), action: () => pickTool(g, t, { name: n, s: list[n] }) });
    }
  }
  return items;
}

function paintTools() {
  cursorBtn.classList.toggle('on', !D.tool);
  for (const g of GROUPS) groupBtns.get(g.id).classList.toggle('on', !!D.tool && g.tools.includes(D.tool));
  magnetBtn.classList.toggle('on', D.magnet);
  stayBtn.classList.toggle('on', D.stay);
  lockBtn.classList.toggle('on', D.locked);
  hideAllBtn.classList.toggle('on', D.hidden);
}

// ---- the floating toolbar of the selected drawing ---------------------------------------------

const ftb = el('div', 'ftb');
ftb.hidden = true;
document.getElementById('chart-wrap').appendChild(ftb);

function renderFtb() {
  const it = D.selectedItem;
  if (!it || D.hidden) {
    ftb.hidden = true;
    return;
  }
  const tool = TOOLS[it.type];
  ftb.innerHTML = '';
  ftb.hidden = false;
  const grip = el('div', 'grip', icon('grip', 16));
  ftb.appendChild(grip);
  dragBy(grip, ftb, (box) => {
    app.layout.ftb = { x: box.offsetLeft, y: box.offsetTop };
    saveLayout();
  });
  const btn = (html, title, onClick) => {
    const b = tbButton(html, title, onClick);
    ftb.appendChild(b);
    return b;
  };
  btn(icon('template', 18) + icon('chevron', 12), 'Templates', (e) => templateMenu(it, e.currentTarget));
  ftb.appendChild(el('div', 'sep'));
  const swatch = (path, title, glyph) => {
    const b = el('button', 'swatch-btn');
    b.type = 'button';
    b.title = title;
    b.style.setProperty('--c', getPath(it.s, path));
    b.innerHTML = '<span>' + icon(glyph, 18) + '<i></i></span>';
    b.addEventListener('click', () => colorPicker(b, getPath(it.s, path), (c) => {
      D.setStyle(it.id, path, c);
      b.style.setProperty('--c', c);
      chart.invalidate();
    }));
    ftb.appendChild(b);
  };
  const colors = tool.colors || {};
  const linePath = colors.line === 'line' ? 'line.color' : colors.line;
  if (linePath) swatch(linePath, 'Line colour', 'trend');
  if (colors.fill) swatch(colors.fill, 'Background colour', 'rect');
  if (colors.text) swatch(colors.text, 'Text colour', 'text');
  const wPath = colors.width || (colors.line === 'line' ? 'line.width' : tool.side ? 'lineWidth' : null);
  const sPath = colors.style || (colors.line === 'line' ? 'line.style' : null);
  if (wPath) {
    const w = getPath(it.s, wPath) || 1;
    btn('<span>' + w + 'px</span>', 'Line width', (e) => menuBelow([1, 2, 3, 4].map((n) => ({ label: n + 'px', check: n === w, action: () => {
      D.setStyle(it.id, wPath, n);
      chart.invalidate();
    } })), e.currentTarget));
  }
  if (sPath) {
    const cur = getPath(it.s, sPath) || 'solid';
    btn(linePreview(cur, 1.5), 'Line style', (e) => menuBelow([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(([v, label]) => ({
      label, check: cur === v, action: () => {
        D.setStyle(it.id, sPath, v);
        chart.invalidate();
      },
    })), e.currentTarget));
  }
  ftb.appendChild(el('div', 'sep'));
  btn(icon('gear', 18), 'Settings', () => openDrawingSettings(it));
  btn(icon(it.locked ? 'lock' : 'unlock', 18), it.locked ? 'Unlock' : 'Lock', () => {
    D.toggleLock(it.id);
    chart.invalidate();
  });
  btn(icon('trash', 18), 'Remove (Delete)', () => {
    D.remove(it.id);
    chart.invalidate();
  });
  btn(icon('more', 18), 'More', (e) => menuBelow(drawingMenu(it), e.currentTarget));
  placeFtb();
}

function placeFtb() {
  const wrap = document.getElementById('chart-wrap');
  const p = app.layout.ftb;
  const w = ftb.offsetWidth || 360;
  const x = p ? Math.min(p.x, wrap.clientWidth - w - 4) : Math.round((wrap.clientWidth - w) / 2);
  const y = p ? Math.min(p.y, wrap.clientHeight - 44) : 44;
  ftb.style.left = Math.max(4, x) + 'px';
  ftb.style.top = Math.max(4, y) + 'px';
}

function drawingMenu(it) {
  const list = app.templates.tools[it.type] || {};
  const names = Object.keys(list).sort(byName);
  const templates = names.length
    ? [{ title: 'Templates' }].concat(names.map((n) => ({ label: n, action: () => D.applyTemplate(it.id, list[n]) })), [{ sep: true }])
    : [];
  return templates.concat([
    { label: 'Settings...', icon: 'gear', action: () => openDrawingSettings(it) },
    { label: 'Clone', icon: 'clone', action: () => D.duplicate(it.id) },
    { label: 'Copy', hint: 'Ctrl+C', action: () => D.copy() },
    { label: it.locked ? 'Unlock' : 'Lock', icon: it.locked ? 'unlock' : 'lock', action: () => D.toggleLock(it.id) },
    { sep: true },
    { label: 'Bring to front', action: () => D.toFront(it.id) },
    { label: 'Send to back', action: () => D.toBack(it.id) },
    { sep: true },
    { label: 'Save as a template...', icon: 'template', action: () => saveToolTemplate(it) },
    { sep: true },
    { label: 'Remove', icon: 'trash', hint: 'Delete', danger: true, action: () => D.remove(it.id) },
  ]).map((m) => (m.action ? { ...m, action: () => {
    m.action();
    chart.invalidate();
  } } : m));
}

// ---- templates --------------------------------------------------------------------------------

function templateMenu(it, anchor) {
  const list = app.templates.tools[it.type] || {};
  const names = Object.keys(list).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const def = app.templates.defaults.tools[it.type];
  const items = [{ title: TOOLS[it.type].name + ' templates' }];
  for (const n of names) items.push({ label: n, check: n === def, hint: n === def ? 'default' : '', action: () => {
    D.applyTemplate(it.id, list[n]);
    chart.invalidate();
  } });
  if (!names.length) items.push({ label: 'No templates yet', disabled: true });
  items.push({ sep: true });
  items.push({ label: 'Save as a template...', icon: 'template', action: () => saveToolTemplate(it) });
  if (names.length) {
    items.push({ label: 'New drawings start from...', action: () => chooseToolDefault(it.type) });
    items.push({ label: 'Remove a template...', action: () => removeToolTemplate(it.type) });
  }
  items.push({ label: 'Back to the plain settings', action: () => {
    D.applyStyle(it.id, TOOLS[it.type].defaults);
    chart.invalidate();
  } });
  menuBelow(items, anchor);
}

async function saveToolTemplate(it) {
  const name = await prompt({ title: 'Save a template', label: 'The name of this ' + TOOLS[it.type].name.toLowerCase() + ' template:', value: '' });
  if (!name || !name.trim()) return;
  const list = (app.templates.tools[it.type] = app.templates.tools[it.type] || {});
  list[name.trim().slice(0, 60)] = D.templateOf(it);
  await saveTemplates();
  toast('Saved the template "' + name.trim() + '"');
}

function chooseToolDefault(type) {
  const names = Object.keys(app.templates.tools[type] || {});
  const def = app.templates.defaults.tools[type];
  const r = renderFtbAnchor();
  menu([{ title: 'New ' + TOOLS[type].name.toLowerCase() + 's start from' }, { label: 'The plain settings', check: !def, action: () => setToolDefault(type, null) }]
    .concat(names.map((n) => ({ label: n, check: n === def, action: () => setToolDefault(type, n) }))), r.x, r.y);
}

function setToolDefault(type, name) {
  if (name) app.templates.defaults.tools[type] = name;
  else delete app.templates.defaults.tools[type];
  saveTemplates();
}

async function removeToolTemplate(type) {
  const names = Object.keys(app.templates.tools[type] || {});
  const r = renderFtbAnchor();
  menu([{ title: 'Remove a template' }].concat(names.map((n) => ({ label: n, danger: true, action: async () => {
    if (!(await confirmBox({ title: 'Remove a template', text: 'Remove the template "' + n + '"?' }))) return;
    delete app.templates.tools[type][n];
    if (app.templates.defaults.tools[type] === n) delete app.templates.defaults.tools[type];
    saveTemplates();
  } }))), r.x, r.y);
}

function renderFtbAnchor() {
  const r = ftb.hidden ? top.getBoundingClientRect() : ftb.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
}

function importTemplates() {
  const input = el('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const { templates, count, skipped } = readTemplates(JSON.parse(await file.text()));
      if (!count) {
        toast('No templates found in ' + file.name);
        return;
      }
      app.templates = mergeTemplates(app.templates, templates);
      await saveTemplates();
      if (templates.defaults.chart && (await confirmBox({ title: 'Chart template', text: 'Use the chart template "' + templates.defaults.chart + '" now?' }))) {
        applyChartStyle(clone(app.templates.chart[templates.defaults.chart]));
      }
      toast('Imported ' + count + ' templates' + (skipped ? ' (' + skipped + ' left out)' : ''));
    } catch (e) {
      toast('Could not read ' + file.name + ': ' + e.message, 4000);
    }
  });
  input.click();
}

function exportTemplates() {
  const blob = new Blob([JSON.stringify(app.templates, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'modern-screen-templates.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- settings dialogs -------------------------------------------------------------------------

function openDrawingSettings(it) {
  const tool = TOOLS[it.type];
  D.remember();
  const ctx = { digits: chart.digits };
  const get = (path) => (path === '@entry' ? it.pts[0].p : path === '@stop' ? it.stop : path === '@target' ? it.target : getPath(it.s, path));
  const set = (path, v) => {
    if (path === '@entry') {
      it.pts[0].p = v;
      if (it.pts[1]) it.pts[1].p = v;
    } else if (path === '@stop') it.stop = v;
    else if (path === '@target') it.target = v;
    else setPath(it.s, path, v);
    chart.invalidate();
  };
  const tabs = tool.fields.map((t) => ({ name: t.tab, body: formTab(t.rows, get, set, ctx) }));
  const tplBtn = el('button', 'btn', 'Template ' + icon('chevron', 12));
  tplBtn.type = 'button';
  const d = dialog({
    title: tool.name, tabs, footerLeft: tplBtn,
    onOk: () => {
      D.changed();
      chart.invalidate();
    },
    onCancel: () => {
      D.undo();
      D.redoStack.pop();
      chart.invalidate();
    },
  });
  tplBtn.addEventListener('click', () => {
    const list = app.templates.tools[it.type] || {};
    const names = Object.keys(list).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    menuBelow(names.map((n) => ({ label: n, action: () => {
      d.close(true);
      D.applyTemplate(it.id, list[n]);
      chart.invalidate();
    } })).concat([{ sep: true }, { label: 'Save as a template...', action: () => saveToolTemplate(it) }]), tplBtn);
  });
}

function openChartSettings() {
  const before = clone(chart.style);
  const work = clone(chart.style);
  const set = (path, v) => {
    setPath(work, path, v);
    chart.style = work;
    chart.layout();
    chart.invalidate();
    renderLegend();
  };
  const tabs = CHART_FIELDS.map((t) => ({ name: t.tab, body: formTab(t.rows, (p) => getPath(work, p), set) }));
  const tplBtn = el('button', 'btn', 'Template ' + icon('chevron', 12));
  tplBtn.type = 'button';
  const d = dialog({
    title: 'Chart settings', tabs, footerLeft: tplBtn, width: 520,
    onOk: () => applyChartStyle(work),
    onCancel: () => applyChartStyle(before),
  });
  tplBtn.addEventListener('click', () => {
    const names = Object.keys(app.templates.chart).sort();
    const def = app.templates.defaults.chart;
    menuBelow([{ title: 'Chart templates' }]
      .concat([{ label: 'Modern (the default)', action: () => {
        d.close(true);
        applyChartStyle(chartStart(emptyTemplates()));
      } }])
      .concat(names.map((n) => ({ label: n, check: n === def, hint: n === def ? 'default' : '', action: () => {
        d.close(true);
        applyChartStyle(clone(app.templates.chart[n]));
      } })))
      .concat([
        { sep: true },
        { label: 'Save as a template...', icon: 'template', action: async () => {
          const name = await prompt({ title: 'Save a chart template', label: 'The name of this chart template:' });
          if (!name || !name.trim()) return;
          app.templates.chart[name.trim().slice(0, 60)] = clone(work);
          app.templates.defaults.chart = name.trim().slice(0, 60);
          await saveTemplates();
          toast('Saved the chart template "' + name.trim() + '"');
        } },
        { label: 'Import templates...', action: () => {
          d.close(true);
          importTemplates();
        } },
        { label: 'Export templates...', action: exportTemplates },
      ]), tplBtn);
  });
}

function applyChartStyle(style) {
  chart.style = merge(chartStart(emptyTemplates()), style);
  app.layout.style = clone(chart.style);
  chart.layout();
  chart.invalidate();
  renderLegend();
  saveLayout();
}

function changeStyle(path, v) {
  const s = clone(chart.style);
  setPath(s, path, v);
  applyChartStyle(s);
}

// ---- the legend, notices and the corner buttons ------------------------------------------------

let hoverIndex = null;

function renderLegend() {
  const st = chart.style.legend;
  const s = chart.series;
  let html = '';
  if (st.title && app.layout.symbol) html += '<span class="title">' + esc(app.layout.symbol) + ' &middot; ' + esc(tfLabel(app.layout.tf)) + (app.hello ? ' &middot; ' + esc(app.hello.company || '') : '') + '</span>';
  if (s && s.length && (st.ohlc || st.change || st.volume)) {
    const i = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < s.length ? hoverIndex : s.length - 1;
    const b = s.bars[i];
    const prev = i > 0 ? s.bars[i - 1].c : b.o;
    const up = b.c >= b.o;
    const cls = up ? 'up' : 'down';
    const f = (p) => formatPrice(p, s.digits);
    let o = '';
    if (st.ohlc) o += '<span>O <b class="' + cls + '">' + f(b.o) + '</b></span><span>H <b class="' + cls + '">' + f(b.h) + '</b></span><span>L <b class="' + cls + '">' + f(b.l) + '</b></span><span>C <b class="' + cls + '">' + f(b.c) + '</b></span>';
    if (st.change) {
      const d = b.c - prev;
      o += '<span><b class="' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '') + f(d) + ' (' + (d >= 0 ? '+' : '') + (prev ? (d / prev * 100).toFixed(2) : '0.00') + '%)</b></span>';
    }
    if (st.volume) o += '<span>Vol <b>' + b.v + '</b></span>';
    html += '<span class="ohlc">' + o + '</span>';
  }
  legend.innerHTML = html;
}

function showNotice(title, text) {
  if (!title) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.innerHTML = '<b>' + esc(title) + '</b>' + esc(text || '');
}

const autoBtn = tbButton('A', 'Auto scale (double-click the price scale)', () => {
  chart.view.auto = !chart.view.auto;
  chart.invalidate();
  paintCorner();
});
const latestBtn = tbButton(icon('latest', 16), 'Go to the newest bar', () => {
  chart.resetTime();
  paintCorner();
});
corner.append(latestBtn, autoBtn);

function paintCorner() {
  autoBtn.classList.toggle('on', chart.view.auto);
  latestBtn.hidden = chart.atEnd;
}

// ---- the watchlist ----------------------------------------------------------------------------

const saveWatchlist = debounce((items) => store.put('watchlist.json', { version: 1, items }).catch((e) => toast(e.message)), 300);
const watch = new Watchlist(right, {
  onPick: (name) => loadChart(name, app.layout.tf),
  onChange: (items) => {
    app.watchSaved = true;
    saveWatchlist(items);
  },
  onSymbols: () => subscribeQuotes(),
  onAdd: () => openSearch('', (r) => watch.add(r.name), 'Add to the watchlist'),
  onWidth: (px) => {
    app.layout.watchWidth = px;
    saveLayout();
  },
  digitsOf: (name) => {
    const s = app.symbols.find((x) => x.name === name);
    return s ? s.digits : chart.symbol === name ? chart.digits : 5;
  },
  marketWatch: () => app.symbols.map((s) => s.name),
});

function showWatchlist() {
  right.hidden = !app.layout.watchlist;
  watchBtn.classList.toggle('on', app.layout.watchlist);
  chart.resize();
}

function subscribeQuotes() {
  if (!feed) return;
  const list = watch.symbols();
  if (app.layout.symbol && !list.includes(app.layout.symbol)) list.push(app.layout.symbol);
  feed.quotes(list);
}

// ---- symbol search ----------------------------------------------------------------------------

function openSearch(start, onPick, title) {
  closePopups();
  const shade = el('div', 'shade');
  const box = el('div', 'dialog search');
  box.innerHTML = '<div class="search-input">' + icon('search', 18) + '<input spellcheck="false" placeholder="' + esc(title || 'Symbol or name') + '"></div><div class="search-list"></div>';
  shade.appendChild(box);
  document.body.appendChild(shade);
  const input = box.querySelector('input');
  const list = box.querySelector('.search-list');
  let results = [];
  let sel = 0;
  let seq = 0;
  const close = () => {
    shade.remove();
    document.removeEventListener('keydown', keys, true);
  };
  const pick = (r) => {
    close();
    if (!r) return;
    if (onPick) onPick(r);
    else loadChart(r.name, app.layout.tf);
  };
  const paint = () => {
    list.innerHTML = '';
    results.forEach((r, k) => {
      const row = el('div', 'search-row' + (k === sel ? ' on' : ''), '<b>' + esc(r.name) + '</b><span>' + esc(r.desc || '') + '</span><em>' + esc(r.mw === false ? (r.path || '').split('\\')[0] : 'Market Watch') + '</em>');
      row.addEventListener('click', () => pick(r));
      list.appendChild(row);
    });
    if (!results.length) list.innerHTML = '<div class="form-note" style="padding:10px">No symbol found</div>';
  };
  const search = debounce(async () => {
    const q = input.value.trim().toLowerCase();
    const mine = ++seq;
    const local = app.symbols.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q));
    results = local.slice(0, 60);
    sel = 0;
    paint();
    if (!feed || !q) return;
    try {
      const r = await feed.request({ t: 'find', q });
      if (mine !== seq) return;
      const seen = new Set(results.map((x) => x.name));
      results = results.concat(r.list.filter((x) => !seen.has(x.name))).slice(0, 80);
      const exact = results.findIndex((x) => x.name.toLowerCase() === q);
      if (exact > 0) results.unshift(results.splice(exact, 1)[0]);
      paint();
    } catch (e) {
      // the local list stays
    }
  }, 120);
  const keys = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter') {
      e.stopPropagation();
      pick(results[sel]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(results.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      paint();
      const on = list.querySelector('.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
  };
  document.addEventListener('keydown', keys, true);
  shade.addEventListener('pointerdown', (e) => {
    if (e.target === shade) close();
  });
  input.addEventListener('input', search);
  input.value = start;
  input.focus();
  search();
}

// A number typed on the chart opens a small box for the timeframe ("15" then Enter).
let intervalBox = null;
function typeInterval(ch) {
  if (!intervalBox) {
    intervalBox = el('div', 'popup interval-box');
    intervalBox.dataset.v = '';
    document.body.appendChild(intervalBox);
  }
  intervalBox.dataset.v += ch;
  const v = intervalBox.dataset.v;
  const tf = parseInterval(v);
  intervalBox.innerHTML = esc(v) + '<small>' + (tf ? tfLabel(tf) + ': press Enter' : 'not a timeframe') + '</small>';
  clearTimeout(intervalBox.timer);
  intervalBox.timer = setTimeout(endInterval, 2500);
}
function endInterval(apply) {
  if (!intervalBox) return;
  const tf = parseInterval(intervalBox.dataset.v);
  clearTimeout(intervalBox.timer);
  intervalBox.remove();
  intervalBox = null;
  if (apply && tf) setTimeframe(tf);
}

// ---- the network indicator --------------------------------------------------------------------

function grade(ms, good, warn) {
  if (!Number.isFinite(ms)) return 'bad';
  return ms <= good ? 'good' : ms <= warn ? 'warn' : 'bad';
}
const msText = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) + ' ms' : '--');

function tickAge() {
  if (!app.tickTime) return NaN;
  return Math.max(0, Date.now() + chart.serverOffset - app.tickTime);
}

function paintNet() {
  if (!feed) return;
  const st = feed.stats;
  const linked = feed.state === 'open' && feed.feedOn;
  const worst = !linked || st.connected === false ? 'bad' : [grade(st.feedRtt, 30, 120), grade(st.brokerPing, 80, 200)].includes('bad') ? 'bad'
    : [grade(st.feedRtt, 30, 120), grade(st.brokerPing, 80, 200)].includes('warn') ? 'warn' : 'good';
  netBtn.className = 'tb net ' + worst;
  netBtn.querySelector('.ms').textContent = !linked ? (feed.state === 'open' ? 'MT5 not linked' : 'Offline')
    : st.connected === false ? 'Broker offline' : 'MT5 ' + msText(st.brokerPing) + ' / ' + msText(st.feedRtt, 1);
  if (netPanel && netPanel.isConnected) fillNet();
}

let netPanel = null;
function fillNet() {
  const st = feed.stats;
  const row = (label, value, cls) => '<div class="net-row"><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>';
  netPanel.innerHTML = '<h4>Network and speed</h4>' +
    row('MT5 to the broker\'s server (ping)', st.connected === false ? 'not connected' : msText(st.brokerPing, 1), st.connected === false ? 'bad' : grade(st.brokerPing, 80, 200)) +
    row('Screen to MT5 and back', msText(st.feedRtt, 1), grade(st.feedRtt, 30, 120)) +
    row('Screen to ModernScreen.exe and back', msText(st.hostRtt, 1), grade(st.hostRtt, 10, 50)) +
    row('A tick to the screen', msText(app.perf.delay, 1), grade(app.perf.delay, 20, 60)) +
    row('Drawing one frame', msText(app.perf.render, 2), grade(app.perf.render, 8, 16)) +
    row('Age of the last tick', msText(tickAge()), '') +
    row('Ticks a second', String(st.ticksPerSec), '') +
    '<div class="net-note">The broker ping is MetaTrader 5\'s own measurement. "A tick to the screen" is from the moment the tick reaches the screen to the moment it is drawn.</div>';
}

function openNet() {
  netPanel = el('div', 'net-panel');
  fillNet();
  popupBelow(netPanel, netBtn);
}

// ---- loading a chart --------------------------------------------------------------------------

async function loadChart(symbol, tf) {
  if (!symbol || !isTimeframe(tf)) return;
  if (D.pending || D.drag) D.cancel();
  const token = ++app.loadToken;
  const sameSymbol = symbol === app.layout.symbol;
  if (!sameSymbol && D.owner) saveDrawings.flush(D.owner, D.items);
  app.layout.symbol = symbol;
  app.layout.tf = tf;
  document.title = 'Modern Screen - ' + symbol + ', ' + tfLabel(tf) + (TERM ? ' #' + TERM : '');
  saveLayout();
  renderTop();
  watch.setCurrent(symbol);
  chart.symbol = symbol;
  chart.tf = tf;
  chart.bid = NaN;
  chart.ask = NaN;
  const series = new Series(symbol, tf, (app.symbols.find((s) => s.name === symbol) || { digits: 2 }).digits);
  chart.message = 'Loading ' + symbol + ' ' + tfLabel(tf) + '...';
  chart.setSeries(series);
  chart.message = 'Loading ' + symbol + ' ' + tfLabel(tf) + '...';
  if (D.owner !== symbol) {
    // Nothing of the last symbol's may be saved under this one, nor anything over this symbol's
    // file before it was read.
    D.load([]);
    D.owner = null;
    try {
      const saved = await store.get(drawingsFile(symbol), null);
      if (token !== app.loadToken) return;
      D.load(saved && saved.items);
      D.owner = symbol;
    } catch (e) {
      if (token !== app.loadToken) return;
      toast('Could not read the drawings of ' + symbol + ': ' + e.message + '. New drawings are not saved until it can be read.', 6000);
    }
  }
  if (!feed) return;
  feed.watch([[symbol, tf]]);
  subscribeQuotes();
  try {
    const r = await feed.request({ t: 'history', sym: symbol, tf, before: 0, count: 3000 }, 30000);
    if (token !== app.loadToken) return;
    series.digits = r.digits;
    series.setHistory(r.bars, r.done);
    chart.setSeries(series);
    hoverIndex = null;
    renderLegend();
    paintCorner();
  } catch (e) {
    if (token !== app.loadToken) return;
    chart.message = 'Could not load ' + symbol + ' ' + tfLabel(tf) + ':\n' + e.message;
    chart.invalidate();
  }
  refreshSpec();
}

async function refreshSpec() {
  if (!feed || !feed.feedOn || !app.layout.symbol) return;
  try {
    const spec = await feed.request({ t: 'spec', sym: app.layout.symbol });
    if (spec.sym === app.layout.symbol) {
      chart.spec = spec;
      chart.invalidate();
    }
  } catch (e) {
    // the position tools count in units until it arrives
  }
}
setInterval(refreshSpec, 30000);

async function loadMore() {
  const s = chart.series;
  if (!feed || app.loadingMore || !s || !s.length || s.done || (s.retryAt && Date.now() < s.retryAt)) return;
  app.loadingMore = true;
  const token = app.loadToken;
  try {
    const r = await feed.request({ t: 'history', sym: s.symbol, tf: s.tf, before: s.bars[0].t, count: 2000 }, 30000);
    if (token === app.loadToken && chart.series === s) {
      const added = s.prepend(r.bars, r.done);
      chart.prepended(added);
    }
  } catch (e) {
    s.retryAt = Date.now() + 5000;   // MT5 may still be downloading them: ask again in a while
  }
  app.loadingMore = false;
}

function setTimeframe(tf) {
  loadChart(app.layout.symbol, tf);
}

// ---- the feed ---------------------------------------------------------------------------------

function noteServerTime(serverMs) {
  const now = Date.now();
  app.offsets.push({ v: serverMs - now, at: now });
  while (app.offsets.length && now - app.offsets[0].at > 60000) app.offsets.shift();
  chart.serverOffset = Math.max(...app.offsets.map((o) => o.v));
}

if (feed) {
  feed.on('state', () => {
    paintNet();
    updateNotice();
  });
  feed.on('host', paintWindowBtn);
  feed.on('feed', () => {
    paintNet();
    updateNotice();
  });
  feed.on('resync', () => {
    if (app.layout.symbol) loadChart(app.layout.symbol, app.layout.tf);
  });
  feed.on('hello', (m) => {
    app.hello = m;
    noteServerTime(m.now * 1000);
    renderLegend();
  });
  feed.on('symbols', (m) => {
    app.symbols = m.list || [];
    if (!app.watchSaved) watch.setItems((m.list || []).map((s) => ({ type: 'symbol', name: s.name })));   // the first time: Market Watch
    else watch.render();
    renderTop();
    subscribeQuotes();
    if (!app.layout.symbol && app.symbols.length) {
      const gold = app.symbols.find((s) => /^xau/i.test(s.name));
      loadChart((gold || app.symbols[0]).name, app.layout.tf);
    }
  });
  feed.on('bar', (m) => {
    if (m.sym === app.layout.symbol && m.tf === app.layout.tf) {
      chart.live(m.bar, m);
      if (hoverIndex === null) renderLegend();
      if (m.time) {
        app.tickTime = m.time;
        noteServerTime(m.time);
      }
    }
  });
  feed.on('quote', (m) => {
    app.quotes.set(m.sym, m);
    watch.quote(m);
  });
  feed.on('clock', (m) => noteServerTime(m.now * 1000));
  feed.on('account', (m) => {
    chart.equity = m.equity;
  });
  feed.on('stats', paintNet);
}

chart.onFrame = (took, sinceData) => {
  const ema = (old, v) => (Number.isFinite(old) ? old * 0.8 + v * 0.2 : v);
  app.perf.render = ema(app.perf.render, took);
  if (sinceData > 0) app.perf.delay = ema(app.perf.delay, sinceData);
};
chart.onNeedHistory = loadMore;
chart.onHover = (i) => {
  hoverIndex = i;
  renderLegend();
};
chart.onViewChange = paintCorner;
chart.onOpenSettings = (it) => openDrawingSettings(it);
chart.onContextMenu = (it, x, y) => {
  if (it) {
    menu(drawingMenu(it), x, y);
    return;
  }
  menu([
    { label: 'Reset the view', hint: 'Alt+R', action: () => chart.resetTime() },
    { label: 'Auto scale', check: chart.view.auto, action: () => {
      chart.view.auto = !chart.view.auto;
      chart.invalidate();
      paintCorner();
    } },
    { sep: true },
    { label: 'Chart settings...', icon: 'gear', action: openChartSettings },
    { label: 'Import templates...', action: importTemplates },
    { label: 'Export templates...', action: exportTemplates },
    { sep: true },
    { label: 'Remove every drawing...', icon: 'trash', danger: true, disabled: !D.items.length, action: () => removeBtn.click() },
  ], x, y);
};

D.onChange = (items) => {
  if (D.owner) saveDrawings(D.owner, items);
  renderTop();
  chart.invalidate();
};
D.onSelect = () => {
  renderFtb();
  chart.invalidate();
};
D.onTool = () => {
  paintTools();
  chart.invalidate();
};
D.onEditText = async (it) => {
  const v = await prompt({ title: 'Text', value: it.s.text.value, multiline: true });
  if (v !== null) D.setStyle(it.id, 'text.value', v);
  chart.invalidate();
};
D.templateFor = (type) => toolStart(app.templates, type);

function updateNotice() {
  if (!feed) {
    showNotice('Open the screen from ModernScreen.exe', 'This page needs ModernScreen.exe running on this PC: it is opened by the program (its tray icon), not on its own.');
    return;
  }
  if (feed.state !== 'open') showNotice('Connecting to ModernScreen.exe...', '');
  else if (!feed.feedOn) showNotice('Waiting for MetaTrader 5', 'Add the ModernScreen service once: in MetaTrader 5\'s Navigator, right-click Services > Add Service > ModernScreen > OK. It starts by itself from then on.');
  else showNotice(null);
}

// ---- keys -------------------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.shade') || e.target.closest('input, textarea, select')) return;
  if (intervalBox) {
    if (/^[0-9a-z]$/i.test(e.key)) {
      typeInterval(e.key);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      endInterval(true);
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      endInterval(false);
      e.preventDefault();
      return;
    }
  }
  if (D.key(e)) {
    e.preventDefault();
    chart.invalidate();
    return;
  }
  if (e.altKey && !e.ctrlKey) {
    const k = e.key.toLowerCase();
    const byKey = { t: 'trend', h: 'hline', v: 'vline', f: 'fib', l: 'long', s: 'short' };
    if (byKey[k]) {
      D.setTool(byKey[k]);
      e.preventDefault();
      return;
    }
    if (k === 'r') {
      chart.resetTime();
      e.preventDefault();
      return;
    }
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    chart.scrollBy((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
    paintCorner();
    e.preventDefault();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    chart.zoom(e.key === 'ArrowUp' ? 1.15 : 1 / 1.15);
    e.preventDefault();
  } else if (/^[0-9]$/.test(e.key)) {
    typeInterval(e.key);
    e.preventDefault();
  } else if (/^[a-z]$/i.test(e.key) && !e.shiftKey) {
    openSearch(e.key.toUpperCase());
    e.preventDefault();
  }
});

window.addEventListener('beforeunload', () => {
  if (D.owner) saveDrawings.flush(D.owner, D.items);
  saveLayout.flush();
});

// ---- start ------------------------------------------------------------------------------------

async function start() {
  const [layout, templates, saved] = await Promise.all([store.getOr('layout.json', null), store.getOr('templates.json', null), store.getOr('watchlist.json', null)]);
  if (saved && Array.isArray(saved.items)) {
    app.watchSaved = true;
    watch.setItems(saved.items);
  }
  if (templates) app.templates = readTemplates(templates).templates;
  app.layout = { ...clone(LAYOUT_DEFAULT), ...(layout || {}) };
  if (!isTimeframe(app.layout.tf)) app.layout.tf = 'H1';
  chart.style = merge(chartStart(emptyTemplates()), app.layout.style || chartStart(app.templates));
  D.magnet = !!app.layout.magnet;
  D.stay = !!app.layout.stay;
  chart.layout();
  if (app.layout.watchWidth) watch.setWidth(app.layout.watchWidth);
  showWatchlist();
  renderTop();
  paintWindowBtn();
  paintTools();
  paintCorner();
  renderLegend();
  updateNotice();
  paintNet();
  // With MT5 already linked, load now; otherwise the feed's link (resync) loads it.
  if (app.layout.symbol && feed && feed.feedOn) loadChart(app.layout.symbol, app.layout.tf);
}

start();
window.addEventListener('resize', placeFtb);
export { app, chart, withAlpha };
