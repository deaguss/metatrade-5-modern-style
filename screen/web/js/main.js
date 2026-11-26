// InnaChart: wires the feed from MT5, the chart, the toolbars, the drawings, the templates
// and the network indicator together.
import { Chart } from './chart.js';
import { Series } from './series.js';
import { Feed } from './feed.js';
import { Store } from './store.js';
import { TOOLS, GROUPS } from './tools.js';
import { CHART_FIELDS, CHART_TYPES, getPath, setPath } from './style.js';
import { TIMEFRAMES, FAVORITES, tfLabel, isTimeframe, parseInterval, nextTimeframe } from './timeframes.js';
import { emptyTemplates, readTemplates, mergeTemplates, toolStart, chartStart } from './templates.js';
import { clamp, clone, debounce, drawingsFile, formatPrice, merge, withAlpha } from './util.js';
import { icon } from './icons.js';
import { Watchlist } from './watchlist.js';
import { Ticket } from './ticket.js';
import { TradeLayer } from './tradelayer.js';
import { el, esc, menu, menuBelow, popupBelow, closePopups, colorPicker, dialog, formTab, prompt, confirmBox, toast, dragBy, linePreview } from './ui.js';

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const TERM = Number(params.get('term')) || 0;
const KEY = hash.get('key') || '';
document.title = 'InnaChart' + (TERM ? ' #' + TERM : '');

const store = new Store(KEY);
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
  toolsFloat: true,    // the drawing tools float over the chart (the prototype's bar), or dock at the left
  toolsPos: null,      // where the floating bar is, in the chart area's pixels
  grid: '1',           // one chart, or the screen split: '2v', '2h', '3', '4'
  panes: null,         // each chart's {symbol, tf}, kept for up to four (symbol and tf: the active one's)
  active: 0,           // the active chart's place
};

const app = {
  layout: clone(LAYOUT_DEFAULT),
  templates: emptyTemplates(),
  hello: null,
  symbols: [],         // Market Watch: {name, desc, digits}
  quotes: new Map(),   // symbol -> {bid, ask, prev}
  tickTime: 0,         // the last tick's server time, ms
  offsets: [],         // lower bounds of (server time - this PC's time), ms, with when seen
  perf: { render: NaN, delay: NaN },
};

const saveLayout = debounce(() => store.put('layout.json', app.layout).catch((e) => toast(e.message)), 400);
const saveTemplates = () => store.put('templates.json', app.templates).catch((e) => toast(e.message));

// Each symbol's drawings are saved on their own: two charts of two symbols, changed together, both saved.
const drawingSavers = new Map();
function saveDrawings(symbol, items) {
  let save = drawingSavers.get(symbol);
  if (!save) {
    save = debounce((list) => store.put(drawingsFile(symbol), { version: 1, symbol, items: list }).catch((e) => toast(e.message)), 300);
    drawingSavers.set(symbol, save);
  }
  save(items);
}
saveDrawings.flush = (symbol, items) => {
  const save = drawingSavers.get(symbol);
  if (save) save.flush(items);
};

// ---- the charts: one, or the screen split into 2, 3 or 4 ---------------------------------------

// The layouts and how many charts each holds. 2v: side by side; 2h: one over the other; 3: a big one
// on the left and two on the right; 4: two by two.
const GRIDS = [
  { id: '1', n: 1, label: 'One chart' },
  { id: '2v', n: 2, label: 'Two, side by side' },
  { id: '2h', n: 2, label: 'Two, one over the other' },
  { id: '3', n: 3, label: 'Three: a big one and two beside it' },
  { id: '4', n: 4, label: 'Four, two by two' },
];
const gridOf = (id) => GRIDS.find((g) => g.id === id) || GRIDS[0];

const panesEl = document.getElementById('panes');
const panes = [];
let active = null;          // the chart the top bar, the watchlist, the ticket and the drawing tools work on
let chart = null;           // the active chart
let D = null;               // and its drawings
let tradeLayers = false;    // once the ticket is made, every chart shows its own symbol's trades
let ready = false;          // the page is built: making a chart active updates the rest

function makePane() {
  const p = { el: el('div', 'pane'), box: el('div', 'pane-chart'), legend: el('div', 'legend'), corner: el('div', 'corner'),
    symbol: '', tf: app.layout.tf, token: 0, hover: null, loadingMore: false };
  p.el.append(p.box, p.legend, p.corner);
  panesEl.appendChild(p.el);
  p.chart = new Chart(p.box);
  p.D = p.chart.drawings;
  p.autoBtn = tbButton('A', 'Auto scale (double-click the price scale)', () => {
    p.chart.view.auto = !p.chart.view.auto;
    p.chart.invalidate();
    paintCorner(p);
  });
  p.latestBtn = tbButton(icon('latest', 16), 'Go to the newest bar', () => {
    p.chart.resetTime();
    paintCorner(p);
  });
  p.corner.append(p.latestBtn, p.autoBtn);
  // A press anywhere on a chart makes it the active one first, so a drawing tool draws there.
  p.el.addEventListener('pointerdown', () => activate(p), true);
  wirePane(p);
  panes.push(p);
  if (tradeLayers) addTradeLayer(p);
  return p;
}

// The chart the top bar, the watchlist, the ticket and the drawing tools work on. A drawing tool
// picked on the last one goes along.
function activate(p) {
  if (p === active) return;
  const old = active;
  active = p;
  chart = p.chart;
  D = p.D;
  for (const q of panes) q.el.classList.toggle('active', q === p);
  if (old && panes.includes(old)) {
    const tool = old.D.tool;
    const armed = old.D.armed;
    if (old.D.pending || old.D.drag) old.D.cancel();
    old.D.select(null);
    if (tool) {
      old.D.setTool(null);
      D.setTool(tool, armed);
    }
    old.chart.invalidate();
  }
  app.layout.active = panes.indexOf(p);
  if (p.symbol) {
    app.layout.symbol = p.symbol;
    app.layout.tf = p.tf;
  }
  if (ready) showActive();
}

function showActive() {
  document.title = 'InnaChart' + (app.layout.symbol ? ' - ' + app.layout.symbol + ', ' + tfLabel(app.layout.tf) : '') + (TERM ? ' #' + TERM : '');
  saveLayout();
  renderTop();
  watch.setCurrent(app.layout.symbol);
  if (ticket && app.layout.symbol) ticket.setSymbol(app.layout.symbol, symbolDesc(app.layout.symbol));
  renderFtb();
  paintTools();
}

// One chart, or the screen split into 2, 3 or 4. Charts added come back as they were last time
// (their symbol and timeframe), else the active symbol on the next timeframe up.
function setGrid(id) {
  const g = gridOf(id);
  app.layout.grid = g.id;
  panesEl.className = 'panes g' + g.id;
  while (panes.length > g.n) dropPane(panes[panes.length - 1]);
  while (panes.length < g.n) {
    const kept = app.layout.panes && app.layout.panes[panes.length];
    const spec = kept && kept.symbol && isTimeframe(kept.tf) ? kept : nextPane();
    const p = makePane();
    p.symbol = spec.symbol || '';
    p.tf = isTimeframe(spec.tf) ? spec.tf : app.layout.tf;
    if (ready && p.symbol && feed && feed.feedOn) loadChart(p.symbol, p.tf, p);
  }
  gridBtn.innerHTML = icon('g' + g.id, 20);
  rememberPanes();
  if (ready) {
    saveLayout();
    watchAll();
    subscribeQuotes();
  }
}

// A chart added to a split shows the active symbol on the next timeframe up.
function nextPane() {
  const base = active || panes[0];
  return { symbol: base.symbol, tf: nextTimeframe([base.tf].concat(panes.filter((q) => q.symbol === base.symbol).map((q) => q.tf))) };
}

function dropPane(p) {
  if (p.D.owner) saveDrawings.flush(p.D.owner, p.D.items);
  p.chart.destroy();
  p.el.remove();
  panes.splice(panes.indexOf(p), 1);
  if (active === p) activate(panes[0]);
}

// Each chart's symbol and timeframe, kept for up to four (a smaller split keeps the others' for later).
function rememberPanes() {
  const kept = Array.isArray(app.layout.panes) ? app.layout.panes.slice(0, 4) : [];
  panes.forEach((q, i) => {
    kept[i] = { symbol: q.symbol, tf: q.tf };
  });
  app.layout.panes = kept;
  app.layout.active = Math.max(0, panes.indexOf(active));
}

function watchAll() {
  if (feed) feed.watch(panes.filter((q) => q.symbol).map((q) => [q.symbol, q.tf]));
}

// Two charts of one symbol show the same drawings: a change on one shows on the other.
function shareDrawings(p) {
  for (const q of panes) {
    if (q === p || q.D.owner !== p.D.owner) continue;
    q.D.load(clone(p.D.items));
    q.chart.invalidate();
  }
}

function addTradeLayer(p) {
  p.chart.layers.push(new TradeLayer(ticket, { symbol: () => p.symbol, offset: () => ({ x: p.el.offsetLeft, y: p.el.offsetTop }) }));
}

function invalidateAll() {
  for (const q of panes) q.chart.invalidate();
}

activate(makePane());

// ---- the top bar ------------------------------------------------------------------------------

const top = document.getElementById('top');
const left = document.getElementById('left');
const right = document.getElementById('right');
const notice = document.getElementById('notice');

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
const gridBtn = tbButton(icon('g1', 20), 'Split the screen: 1, 2, 3 or 4 charts (each its own symbol and timeframe)', (e) => {
  menuBelow([{ title: 'Charts on the screen' }].concat(GRIDS.map((g) => ({ label: g.label, icon: 'g' + g.id, check: app.layout.grid === g.id, action: () => setGrid(g.id) }))), e.currentTarget);
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
const tradeBtn = tbButton(icon('long') + '<span>Trade</span>', 'The order ticket: BUY and SELL through the ActionInna EA, with a preview and Confirm', () => {
  if (ticket) ticket.show(ticket.el.hidden);
}, 'hide-label');
const hideBtn = tbButton(icon('mt5') + '<span>MT5 charts</span>', 'Hide the screen and show MetaTrader 5\'s own charts (Ctrl+Alt+M shows it again)', () => {
  if (feed) feed.hide();
}, 'hide-label');

function sep() {
  return el('div', 'sep');
}
function grow() {
  return el('div', 'grow');
}

const logo = el('img', 'logo');
logo.src = 'img/logo.svg';
logo.alt = 'InnaChart';
logo.title = 'InnaChart';
top.append(logo, symbolBtn, sep(), tfBox, tfMore, sep(), typeBtn, gridBtn, sep(), undoBtn, redoBtn, grow(), netBtn, sep(), tradeBtn, watchBtn, settingsBtn, windowBtn, hideBtn);

function paintWindowBtn() {
  const separate = !!(feed && feed.separate);
  windowBtn.innerHTML = icon(separate ? 'glue' : 'popout');
  windowBtn.title = separate ? 'Glue the screen onto the chart area of MetaTrader 5' :'Make the screen a window of its own (to move it to another monitor)';
  windowBtn.hidden = !feed;
}

const symbolDesc = (name) => (app.symbols.find((x) => x.name === name) || {}).desc || '';

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

// ---- the drawing tools: a bar floating over the chart, or docked at the left -------------------

const chartWrap = document.getElementById('chart-wrap');
const toolsGrip = el('div', 'tools-grip', icon('grip', 16));
toolsGrip.title = 'Drag to move the drawing tools';
left.appendChild(toolsGrip);
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
    if (!toolsFloating()) {
      menu(groupMenu(g), r.right + 4, r.top);
      return;
    }
    // under the floating bar, or over it when the bar is low on the screen
    const m = menu(groupMenu(g), r.left, r.bottom + 4);
    if (m.offsetTop < r.bottom) m.style.top = Math.max(4, r.top - 4 - m.offsetHeight) + 'px';
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
const everyChart = (key, v) => {
  for (const q of panes) q.D[key] = v;
  return v;
};
const magnetBtn = toggleTool('magnet', 'Magnet: points snap to open, high, low or close', () => everyChart('magnet', (app.layout.magnet = !app.layout.magnet)));
const stayBtn = toggleTool('stay', 'Keep drawing with the same tool', () => everyChart('stay', (app.layout.stay = !app.layout.stay)));
const lockBtn = toggleTool('lock', 'Lock every drawing', () => everyChart('locked', !D.locked));
const hideAllBtn = toggleTool('eyeOff', 'Hide every drawing', () => everyChart('hidden', !D.hidden));
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
const dockToolsBtn = el('button', 'tool tools-dock');
dockToolsBtn.type = 'button';
dockToolsBtn.addEventListener('click', () => {
  app.layout.toolsFloat = !toolsFloating();
  app.layout.toolsPos = null;
  saveLayout();
  placeTools();
});
left.appendChild(dockToolsBtn);

function toolsFloating() {
  return app.layout.toolsFloat !== false;
}

// Floating: inside the chart area, where the trader dragged it (at first low on the left, clear of
// the ticket); docked: the column at the left, as before.
function placeTools() {
  const float = toolsFloating();
  document.body.classList.toggle('tools-float', float);
  left.classList.toggle('float', float);
  if (float && left.parentElement !== chartWrap) chartWrap.appendChild(left);
  if (!float && left.parentElement !== document.body) document.body.insertBefore(left, chartWrap);
  dockToolsBtn.innerHTML = icon(float ? 'glue' : 'popout', 18);
  dockToolsBtn.title = float ? 'Dock the drawing tools at the left' : 'Float the drawing tools over the chart';
  if (float) keepToolsIn();
  else {
    left.style.left = '';
    left.style.top = '';
  }
}

function keepToolsIn() {
  if (!toolsFloating()) return;
  const W = chartWrap.clientWidth;
  const H = chartWrap.clientHeight;
  const p = app.layout.toolsPos;
  const x = p ? p.x : 8;
  const y = p ? p.y : H - left.offsetHeight - 40;
  left.style.left = clamp(x, 0, Math.max(0, W - left.offsetWidth)) + 'px';
  left.style.top = clamp(y, 0, Math.max(0, H - left.offsetHeight)) + 'px';
}

dragBy(toolsGrip, left, (box) => {
  app.layout.toolsPos = { x: box.offsetLeft, y: box.offsetTop };
  saveLayout();
  if (!ftb.hidden) placeFtb();
});
new ResizeObserver(() => keepToolsIn()).observe(chartWrap);
placeTools();   // as the default layout says, until the saved one is read

function toggleTool(name, title, flip) {
  const b = el('button', 'tool', icon(name));
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', () => {
    b.classList.toggle('on', !!flip());
    saveLayout();
    invalidateAll();
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
  // clear of the floating drawing tools: under them, or over them when there is no room under
  if (toolsFloating()) {
    const a = { x: ftb.offsetLeft, y: ftb.offsetTop, w: ftb.offsetWidth, h: ftb.offsetHeight };
    const b = { x: left.offsetLeft, y: left.offsetTop, w: left.offsetWidth, h: left.offsetHeight };
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
      const below = b.y + b.h + 6;
      ftb.style.top = (below + a.h <= wrap.clientHeight - 4 ? below : Math.max(4, b.y - a.h - 6)) + 'px';
    }
  }
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
  a.download = 'innachart-templates.json';
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
    for (const q of panes) {
      q.chart.style = work;
      q.chart.layout();
      q.chart.invalidate();
      renderLegend(q);
    }
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
  const st = merge(chartStart(emptyTemplates()), style);
  app.layout.style = clone(st);
  for (const q of panes) {
    q.chart.style = st;
    q.chart.layout();
    q.chart.invalidate();
    renderLegend(q);
  }
  saveLayout();
}

function changeStyle(path, v) {
  const s = clone(chart.style);
  setPath(s, path, v);
  applyChartStyle(s);
}

// ---- the legend, notices and the corner buttons ------------------------------------------------

function renderLegend(p = active) {
  const st = p.chart.style.legend;
  const s = p.chart.series;
  let html = '';
  if (st.title && p.symbol) html += '<span class="title">' + esc(p.symbol) + ' &middot; ' + esc(tfLabel(p.tf)) + (app.hello ? ' &middot; ' + esc(app.hello.company || '') : '') + '</span>';
  if (s && s.length && (st.ohlc || st.change || st.volume)) {
    const i = p.hover !== null && p.hover >= 0 && p.hover < s.length ? p.hover : s.length - 1;
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
  p.legend.innerHTML = html;
}

function renderLegends() {
  for (const q of panes) renderLegend(q);
}

function showNotice(title, text) {
  if (!title) {
    notice.hidden = true;
    return;
  }
  notice.hidden = false;
  notice.innerHTML = '<b>' + esc(title) + '</b>' + esc(text || '');
}

function paintCorner(p = active) {
  p.autoBtn.classList.toggle('on', p.chart.view.auto);
  p.latestBtn.hidden = p.chart.atEnd;
}

// ---- the order ticket -------------------------------------------------------------------------

const ticket = feed ? new Ticket(document.getElementById('chart-wrap'), {
  feed,
  get chart() {
    return chart;
  },
  get layout() {
    return app.layout;
  },
  save: () => saveLayout(),
  onShow: (on) => tradeBtn.classList.toggle('on', on),
}) : null;
if (ticket) {
  tradeLayers = true;
  for (const q of panes) addTradeLayer(q);
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
  for (const q of panes) q.chart.resize();
}

function subscribeQuotes() {
  if (!feed) return;
  const list = watch.symbols();
  for (const q of panes) if (q.symbol && !list.includes(q.symbol)) list.push(q.symbol);
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
    row('Screen to InnaChart.exe and back', msText(st.hostRtt, 1), grade(st.hostRtt, 10, 50)) +
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

async function loadChart(symbol, tf, p = active) {
  if (!symbol || !isTimeframe(tf) || !panes.includes(p)) return;
  if (p.D.pending || p.D.drag) p.D.cancel();
  const token = ++p.token;
  const c = p.chart;
  if (symbol !== p.symbol && p.D.owner) saveDrawings.flush(p.D.owner, p.D.items);
  p.symbol = symbol;
  p.tf = tf;
  rememberPanes();
  if (p === active) {
    app.layout.symbol = symbol;
    app.layout.tf = tf;
    showActive();
  } else saveLayout();
  c.symbol = symbol;
  c.tf = tf;
  c.bid = NaN;
  c.ask = NaN;
  const series = new Series(symbol, tf, (app.symbols.find((x) => x.name === symbol) || { digits: 2 }).digits);
  c.message = 'Loading ' + symbol + ' ' + tfLabel(tf) + '...';
  c.setSeries(series);
  c.message = 'Loading ' + symbol + ' ' + tfLabel(tf) + '...';
  if (p.D.owner !== symbol) {
    // Nothing of the last symbol's may be saved under this one, nor anything over this symbol's
    // file before it was read. Another chart of the symbol has its drawings already.
    p.D.load([]);
    p.D.owner = null;
    const twin = panes.find((q) => q !== p && q.D.owner === symbol);
    if (twin) {
      p.D.load(clone(twin.D.items));
      p.D.owner = symbol;
    } else {
      try {
        const saved = await store.get(drawingsFile(symbol), null);
        if (token !== p.token) return;
        p.D.load(saved && saved.items);
        p.D.owner = symbol;
      } catch (e) {
        if (token !== p.token) return;
        toast('Could not read the drawings of ' + symbol + ': ' + e.message + '. New drawings are not saved until it can be read.', 6000);
      }
    }
  }
  if (!feed) return;
  watchAll();
  subscribeQuotes();
  try {
    const r = await feed.request({ t: 'history', sym: symbol, tf, before: 0, count: 3000 }, 30000);
    if (token !== p.token) return;
    series.digits = r.digits;
    series.setHistory(r.bars, r.done);
    c.setSeries(series);
    p.hover = null;
    renderLegend(p);
    paintCorner(p);
  } catch (e) {
    if (token !== p.token) return;
    c.message = 'Could not load ' + symbol + ' ' + tfLabel(tf) + ':\n' + e.message;
    c.invalidate();
  }
  refreshSpec(p);
}

async function refreshSpec(p = active) {
  if (!feed || !feed.feedOn || !p.symbol) return;
  const symbol = p.symbol;
  try {
    const spec = await feed.request({ t: 'spec', sym: symbol });
    if (spec.sym === p.symbol) {
      p.chart.spec = spec;
      p.chart.invalidate();
    }
  } catch (e) {
    // the position tools count in units until it arrives
  }
}
setInterval(() => panes.forEach((q) => refreshSpec(q)), 30000);

async function loadMore(p) {
  const s = p.chart.series;
  if (!feed || p.loadingMore || !s || !s.length || s.done || (s.retryAt && Date.now() < s.retryAt)) return;
  p.loadingMore = true;
  const token = p.token;
  try {
    const r = await feed.request({ t: 'history', sym: s.symbol, tf: s.tf, before: s.bars[0].t, count: 2000 }, 30000);
    if (token === p.token && p.chart.series === s) {
      const added = s.prepend(r.bars, r.done);
      p.chart.prepended(added);
    }
  } catch (e) {
    s.retryAt = Date.now() + 5000;   // MT5 may still be downloading them: ask again in a while
  }
  p.loadingMore = false;
}

// Every chart that has a symbol, loaded again (MT5 linked again, or the page started).
function loadAll() {
  for (const q of panes) if (q.symbol) loadChart(q.symbol, q.tf, q);
}

function setTimeframe(tf) {
  loadChart(app.layout.symbol, tf);
}

// ---- the feed ---------------------------------------------------------------------------------

function noteServerTime(serverMs) {
  const now = Date.now();
  app.offsets.push({ v: serverMs - now, at: now });
  while (app.offsets.length && now - app.offsets[0].at > 60000) app.offsets.shift();
  const offset = Math.max(...app.offsets.map((o) => o.v));
  for (const q of panes) q.chart.serverOffset = offset;
}

if (feed) {
  feed.on('state', () => {
    paintNet();
    updateNotice();
  });
  feed.on('host', (m) => {
    paintWindowBtn();
    if (ticket) ticket.setLinked(!!m.ticket);
  });
  feed.on('ticket.terminal', (m) => ticket && ticket.onTerminal(m));
  feed.on('ticket.trades', (m) => {
    if (ticket) ticket.onTrades(m);
    invalidateAll();
  });
  feed.on('feed', () => {
    paintNet();
    updateNotice();
  });
  feed.on('resync', loadAll);
  feed.on('hello', (m) => {
    app.hello = m;
    noteServerTime(m.now * 1000);
    renderLegends();
  });
  feed.on('symbols', (m) => {
    app.symbols = m.list || [];
    if (!app.watchSaved) watch.setItems((m.list || []).map((s) => ({ type: 'symbol', name: s.name })));   // the first time: Market Watch
    else watch.render();
    renderTop();
    if (ticket && app.layout.symbol) ticket.setSymbol(app.layout.symbol, symbolDesc(app.layout.symbol));
    subscribeQuotes();
    if (app.symbols.length) {
      // a chart without a symbol yet (the first start) shows gold, or the first symbol
      const gold = app.symbols.find((s) => /^xau/i.test(s.name));
      for (const q of panes) if (!q.symbol) loadChart((gold || app.symbols[0]).name, q.tf, q);
    }
  });
  feed.on('bar', (m) => {
    let shown = false;
    for (const q of panes) {
      if (m.sym !== q.symbol || m.tf !== q.tf) continue;
      q.chart.live(m.bar, m);
      if (q.hover === null) renderLegend(q);
      shown = true;
    }
    if (!shown) return;
    if (ticket && m.sym === app.layout.symbol) ticket.onTick(m.bid, m.ask);
    if (m.time) {
      app.tickTime = m.time;
      noteServerTime(m.time);
    }
  });
  feed.on('quote', (m) => {
    app.quotes.set(m.sym, m);
    watch.quote(m);
    if (ticket && m.sym === app.layout.symbol) ticket.onTick(m.bid, m.ask);
  });
  feed.on('clock', (m) => noteServerTime(m.now * 1000));
  feed.on('account', (m) => {
    for (const q of panes) q.chart.equity = m.equity;
  });
  feed.on('stats', paintNet);
}

// A chart's own callbacks, and its drawings' (each chart has its own: the toolbars work on the active one's).
function wirePane(p) {
  const c = p.chart;
  const d = p.D;
  c.onFrame = (took, sinceData) => {
    const ema = (old, v) => (Number.isFinite(old) ? old * 0.8 + v * 0.2 : v);
    app.perf.render = ema(app.perf.render, took);
    if (sinceData > 0) app.perf.delay = ema(app.perf.delay, sinceData);
  };
  c.onNeedHistory = () => loadMore(p);
  c.onHover = (i) => {
    p.hover = i;
    renderLegend(p);
  };
  c.onViewChange = () => paintCorner(p);
  c.onOpenSettings = (it) => openDrawingSettings(it);
  c.onContextMenu = (it, x, y) => {
    if (it) {
      menu(drawingMenu(it), x, y);
      return;
    }
    menu([
      { label: 'Reset the view', hint: 'Alt+R', action: () => c.resetTime() },
      { label: 'Auto scale', check: c.view.auto, action: () => {
        c.view.auto = !c.view.auto;
        c.invalidate();
        paintCorner(p);
      } },
      { sep: true },
      { label: 'Chart settings...', icon: 'gear', action: openChartSettings },
      { label: 'Import templates...', action: importTemplates },
      { label: 'Export templates...', action: exportTemplates },
      { sep: true },
      { label: 'Remove every drawing...', icon: 'trash', danger: true, disabled: !d.items.length, action: () => removeBtn.click() },
    ], x, y);
  };
  d.magnet = !!app.layout.magnet;
  d.stay = !!app.layout.stay;
  if (active) {
    // like the other charts: their style, and their drawings locked or hidden
    c.style = active.chart.style;
    c.serverOffset = active.chart.serverOffset;
    c.equity = active.chart.equity;
    d.locked = active.D.locked;
    d.hidden = active.D.hidden;
    c.layout();
  }
  d.onChange = (items) => {
    if (d.owner) {
      saveDrawings(d.owner, items);
      shareDrawings(p);
    }
    if (p === active) renderTop();
    c.invalidate();
  };
  d.onSelect = () => {
    if (p === active) renderFtb();
    c.invalidate();
  };
  d.onTool = () => {
    if (p === active) paintTools();
    c.invalidate();
  };
  d.onEditText = async (it) => {
    const v = await prompt({ title: 'Text', value: it.s.text.value, multiline: true });
    if (v !== null) d.setStyle(it.id, 'text.value', v);
    c.invalidate();
  };
  d.templateFor = (type) => toolStart(app.templates, type);
}

function updateNotice() {
  if (!feed) {
    showNotice('Open the screen from InnaChart.exe', 'This page needs InnaChart.exe running on this PC: it is opened by the program (its tray icon), not on its own.');
    return;
  }
  if (feed.state !== 'open') showNotice('Connecting to InnaChart.exe...', '');
  else if (!feed.feedOn) showNotice('Waiting for MetaTrader 5', 'Add the InnaChart service once: in MetaTrader 5\'s Navigator, right-click Services > Add Service > InnaChart > OK. It starts by itself from then on.');
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
  if (e.key === 'Escape' && ticket && (ticket.card || ticket.active)) {
    if (ticket.card) ticket.closeCard();
    else ticket.cancel();
    e.preventDefault();
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
  for (const q of panes) if (q.D.owner) saveDrawings.flush(q.D.owner, q.D.items);
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
  if (!Array.isArray(app.layout.panes) || !app.layout.panes.length) app.layout.panes = [{ symbol: app.layout.symbol, tf: app.layout.tf }];
  const first = app.layout.panes[0] || {};
  active.symbol = first.symbol || '';
  active.tf = isTimeframe(first.tf) ? first.tf : app.layout.tf;
  chart.style = merge(chartStart(emptyTemplates()), app.layout.style || chartStart(app.templates));
  D.magnet = !!app.layout.magnet;
  D.stay = !!app.layout.stay;
  chart.layout();
  const wanted = Math.min(Math.max(0, Number(app.layout.active) || 0), gridOf(app.layout.grid).n - 1);
  setGrid(app.layout.grid);
  activate(panes[wanted] || panes[0]);
  if (active.symbol) {
    app.layout.symbol = active.symbol;
    app.layout.tf = active.tf;
  }
  ready = true;
  if (app.layout.watchWidth) watch.setWidth(app.layout.watchWidth);
  showWatchlist();
  renderTop();
  paintWindowBtn();
  if (ticket) ticket.applyLayout();
  for (const b of groupBtns.values()) b.paint();   // each group's last tool, from the saved layout
  placeTools();
  paintTools();
  for (const q of panes) paintCorner(q);
  renderLegends();
  updateNotice();
  paintNet();
  showActive();
  // With MT5 already linked, load now; otherwise the feed's link (resync) loads them.
  if (feed && feed.feedOn) loadAll();
}

start();
window.addEventListener('resize', placeFtb);
export { app, chart, withAlpha };
