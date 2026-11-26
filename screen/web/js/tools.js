// The drawing tools: what each one draws, where it can be grabbed, its settings and its defaults.
// A drawing is {id, type, pts: [{t, p}], s: settings}; times are the broker's server time, so a
// drawing stays on its bars across timeframes. Long and short positions also hold stop and target.
//
// Each tool receives a context c: c.g (the canvas), c.w and c.h (the plot), c.x(t), c.y(p),
// c.fmt(p), c.price (the last bid), c.spec and c.symbol, c.bars(t1, t2) (bars between two
// times), c.duration(t1, t2), and c.priceTags / c.timeTags to put labels on the scales.
import { withAlpha, textOn, formatMoney, clamp } from './util.js';
import { dash, FONT } from './style.js';
import { positionStats } from './position.js';


// ---- geometry ---------------------------------------------------------------------------------

const P = (c, pt) => ({ x: c.x(pt.t), y: c.y(pt.p) });

// The screen's pixels per CSS pixel (1.25 at 125% display scale). Straight lines are put on the
// screen's pixel grid with it, so they are sharp, not spread over two pixels.
let PX = 1;
export function setPixelRatio(r) {
  PX = r > 0 ? r : 1;
}

// A coordinate on the pixel grid for the current line width.
function crisp(g, v) {
  const w = Math.max(1, Math.round(g.lineWidth * PX));
  return (w % 2 ? Math.floor(v * PX) + 0.5 : Math.round(v * PX)) / PX;
}

export function distSeg(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((px - a.x) * dx + (py - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

export function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// The segment a-b, extended past a and/or past b to well beyond the plot.
export function extend(a, b, left, right, w, h) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [a, b];
  const far = (w + h) * 4;
  const ux = dx / len;
  const uy = dy / len;
  return [
    left ? { x: a.x - ux * far, y: a.y - uy * far } : a,
    right ? { x: b.x + ux * far, y: b.y + uy * far } : b,
  ];
}

const TOL = 6;

// ---- painting ---------------------------------------------------------------------------------

function stroke(g, line, color) {
  g.strokeStyle = color || line.color;
  g.lineWidth = Math.max(1, Math.round((line.width || 1) * PX)) / PX;
  g.setLineDash(dash(line.style, line.width));
  g.lineCap = 'round';
  g.lineJoin = 'round';
}

function seg(g, a, b) {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}

function hline(g, y, x1, x2) {
  const yy = crisp(g, y);
  g.beginPath();
  g.moveTo(x1, yy);
  g.lineTo(x2, yy);
  g.stroke();
}

function arrowHead(g, a, b, color, width) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const s = 7 + 2.5 * (width || 1);
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(b.x, b.y);
  g.lineTo(b.x - s * Math.cos(ang - 0.45), b.y - s * Math.sin(ang - 0.45));
  g.lineTo(b.x - s * Math.cos(ang + 0.45), b.y - s * Math.sin(ang + 0.45));
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function poly(g, pts, fill) {
  g.beginPath();
  pts.forEach((q, k) => (k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  g.stroke();
}

function font(size, bold, italic) {
  return (italic ? 'italic ' : '') + (bold ? '700 ' : '') + (size || 12) + 'px ' + FONT;
}

// A label in a rounded box centred on (xc, yc); lines of text stacked. Returns its rectangle.
export function labelBox(g, xc, yc, lines, bg, fg, size = 12) {
  const rows = Array.isArray(lines) ? lines : [lines];
  g.font = font(size);
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const lh = Math.round(size * 1.35);
  const w = Math.max(...rows.map((r) => g.measureText(r).width)) + 16;
  const h = rows.length * lh + 8;
  const x = Math.round(xc - w / 2);
  const y = Math.round(yc - h / 2);
  g.setLineDash([]);
  g.fillStyle = bg;
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, 4);
  else g.rect(x, y, w, h);
  g.fill();
  g.fillStyle = fg || textOn(bg);
  rows.forEach((r, k) => g.fillText(r, xc, y + 4 + lh * (k + 0.5)));
  g.textAlign = 'left';
  return { x, y, w, h };
}

function text(g, s, x, y, t, align = 'left', base = 'alphabetic') {
  g.font = font(t.size, t.bold, t.italic);
  g.fillStyle = t.color;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillText(s, x, y);
  g.textAlign = 'left';
}

const pctText = (v) => (v >= 0 ? '' : '-') + Math.abs(v).toFixed(2) + '%';

// ---- defaults ---------------------------------------------------------------------------------

const line = (color, width = 1, style = 'solid') => ({ color, width, style });

export const FIB_LEVELS = [
  [0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'],
  [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff'], [2.618, '#f23645'], [3.618, '#9c27b0'], [4.236, '#e91e63'],
].map(([v, color], k) => ({ v, color, show: k < 8 }));

const POSITION = {
  accountSize: 1000,
  risk: 1,
  riskMode: 'percent',
  useEquity: false,   // risk measured on the account's equity instead of the account size
  stopDistance: 0,     // 0: worked out from the prices on screen
  targetDistance: 0,
  lineColor: '#787b86',
  textColor: '#ffffff',
  stopColor: 'rgba(242, 54, 69, 0.2)',
  targetColor: 'rgba(8, 153, 129, 0.2)',
  fontSize: 12,
  lineWidth: 1,
  compact: false,
  alwaysShowStats: false,
  priceLabels: true,
  info: { targetPrice: true, targetPct: true, targetPips: true, targetAmount: true, openPL: true, qty: true, rr: true,
    stopPrice: true, stopPct: true, stopPips: true, stopAmount: true },
};

// ---- settings dialog fields (paths into a drawing's settings) ---------------------------------

const LINE_ROW = (label = 'Line', base = 'line') => ({ label, fields: [{ path: base + '.color', type: 'color' }, { path: base + '.width', type: 'width' }, { path: base + '.style', type: 'style' }] });
const EXTEND_ROWS = [
  { label: 'Extend left', fields: [{ path: 'extendLeft', type: 'check' }] },
  { label: 'Extend right', fields: [{ path: 'extendRight', type: 'check' }] },
];
const FILL_ROW = { label: 'Background', fields: [{ path: 'fill.show', type: 'check' }, { path: 'fill.color', type: 'color' }] };
const TEXT_ROWS = [
  { label: 'Text', fields: [{ path: 'text.show', type: 'check' }, { path: 'text.color', type: 'color' }, { path: 'text.size', type: 'select', options: [[10, '10'], [11, '11'], [12, '12'], [14, '14'], [16, '16'], [20, '20'], [24, '24'], [28, '28']] }] },
  { label: '', fields: [{ path: 'text.value', type: 'textarea' }] },
  { label: 'Bold, italic', fields: [{ path: 'text.bold', type: 'check' }, { path: 'text.italic', type: 'check' }] },
];
const POSITION_FIELDS = [
  {
    tab: 'Inputs',
    rows: [
      { label: 'Account size', fields: [{ path: 'accountSize', type: 'number', min: 0 }] },
      { label: 'Risk', fields: [{ path: 'risk', type: 'number', min: 0 }, { path: 'riskMode', type: 'select', options: [['percent', '%'], ['money', 'Money']] }] },
      { label: 'Use the account\'s equity', fields: [{ path: 'useEquity', type: 'check' }] },
      { label: 'Entry price', fields: [{ path: '@entry', type: 'price' }] },
      { label: 'Target price', fields: [{ path: '@target', type: 'price' }] },
      { label: 'Stop price', fields: [{ path: '@stop', type: 'price' }] },
    ],
  },
  {
    tab: 'Style',
    rows: [
      { label: 'Lines', fields: [{ path: 'lineColor', type: 'color' }, { path: 'lineWidth', type: 'width' }] },
      { label: 'Target background', fields: [{ path: 'targetColor', type: 'color' }] },
      { label: 'Stop background', fields: [{ path: 'stopColor', type: 'color' }] },
      { label: 'Text', fields: [{ path: 'textColor', type: 'color' }, { path: 'fontSize', type: 'select', options: [[10, '10'], [11, '11'], [12, '12'], [14, '14'], [16, '16']] }] },
      { label: 'Compact stats', fields: [{ path: 'compact', type: 'check' }] },
      { label: 'Always show stats', fields: [{ path: 'alwaysShowStats', type: 'check' }] },
      { label: 'Price labels on the scale', fields: [{ path: 'priceLabels', type: 'check' }] },
    ],
  },
  {
    tab: 'Labels',
    rows: [
      { label: 'Target: price, %, pips, amount', fields: ['targetPrice', 'targetPct', 'targetPips', 'targetAmount'].map((k) => ({ path: 'info.' + k, type: 'check' })) },
      { label: 'Stop: price, %, pips, amount', fields: ['stopPrice', 'stopPct', 'stopPips', 'stopAmount'].map((k) => ({ path: 'info.' + k, type: 'check' })) },
      { label: 'Open P&L, lots, risk : reward', fields: ['openPL', 'qty', 'rr'].map((k) => ({ path: 'info.' + k, type: 'check' })) },
    ],
  },
];

// ---- the tools --------------------------------------------------------------------------------

function twoPointLine(extendLeft, extendRight, arrow) {
  return {
    n: 2,
    defaults: { line: line('#2962ff', 2), extendLeft, extendRight, arrowEnd: arrow },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), ...EXTEND_ROWS, { label: 'Arrow at the end', fields: [{ path: 'arrowEnd', type: 'check' }] }] }],
    colors: { line: 'line' },
    draw(c, it) {
      const s = it.s;
      const [a, b] = extend(P(c, it.pts[0]), P(c, it.pts[1]), s.extendLeft, s.extendRight, c.w, c.h);
      stroke(c.g, s.line);
      seg(c.g, a, b);
      if (s.arrowEnd && !s.extendRight) arrowHead(c.g, a, b, s.line.color, s.line.width);
    },
    hit(c, it, x, y) {
      const [a, b] = extend(P(c, it.pts[0]), P(c, it.pts[1]), it.s.extendLeft, it.s.extendRight, c.w, c.h);
      return distSeg(x, y, a, b) <= TOL;
    },
  };
}

function priceOnLine(a, b, t) {
  if (b.t === a.t) return a.p;
  return a.p + ((b.p - a.p) * (t - a.t)) / (b.t - a.t);
}

function rectCorners(c, it) {
  const a = P(c, it.pts[0]);
  const b = P(c, it.pts[1]);
  return { x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), a, b };
}

function rotCorners(s) {
  if (s.length < 3) return [s[0], s[1]];
  const dx = s[1].x - s[0].x;
  const dy = s[1].y - s[0].y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const w = (s[2].x - s[0].x) * nx + (s[2].y - s[0].y) * ny;
  return [s[0], s[1], { x: s[1].x + nx * w, y: s[1].y + ny * w }, { x: s[0].x + nx * w, y: s[0].y + ny * w }];
}

const fibPrice = (it, v) => {
  const [a, b] = it.s.reverse ? [it.pts[1], it.pts[0]] : [it.pts[0], it.pts[1]];
  return b.p + (a.p - b.p) * v;
};

function rangeLabel(c, it) {
  const d = it.pts[1].p - it.pts[0].p;
  const pct = it.pts[0].p ? (d / it.pts[0].p) * 100 : 0;
  const pips = c.pip ? d / c.pip : 0;
  return (d < 0 ? '-' : '') + c.fmt(Math.abs(d)) + ' (' + pctText(pct) + ') ' + (Math.round(pips * 10) / 10).toLocaleString('en-US') + ' pips';
}

export const TOOLS = {
  trend: { name: 'Trend line', group: 'lines', key: 'Alt+T', ...twoPointLine(false, false, false) },
  ray: { name: 'Ray', group: 'lines', ...twoPointLine(false, true, false) },
  extended: { name: 'Extended line', group: 'lines', ...twoPointLine(true, true, false) },
  arrow: { name: 'Arrow', group: 'shapes', ...twoPointLine(false, false, true) },

  hline: {
    name: 'Horizontal line', group: 'lines', key: 'Alt+H', n: 1,
    defaults: { line: line('#2962ff', 1), priceLabel: true, text: { show: false, value: '', color: '#2962ff', size: 12, bold: false, italic: false, h: 'right', v: 'top' } },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), { label: 'Price on the scale', fields: [{ path: 'priceLabel', type: 'check' }] }] }, { tab: 'Text', rows: TEXT_ROWS }],
    colors: { line: 'line', text: 'text.color' },
    draw(c, it) {
      const s = it.s;
      const y = c.y(it.pts[0].p);
      stroke(c.g, s.line);
      hline(c.g, y, 0, c.w);
      if (s.priceLabel) c.priceTags.push({ y, text: c.fmt(it.pts[0].p), bg: s.line.color });
      if (s.text.show && s.text.value) {
        const x = s.text.h === 'left' ? 6 : s.text.h === 'center' ? c.w / 2 : c.w - 6;
        text(c.g, s.text.value, x, s.text.v === 'bottom' ? y + 4 : y - 4, s.text, s.text.h === 'left' ? 'left' : s.text.h === 'center' ? 'center' : 'right', s.text.v === 'bottom' ? 'top' : 'bottom');
      }
    },
    hit: (c, it, x, y) => Math.abs(y - c.y(it.pts[0].p)) <= TOL,
    handles: (c, it) => [{ x: clamp(c.x(it.pts[0].t), 12, c.w - 12), y: c.y(it.pts[0].p), k: 0 }],
  },

  hray: {
    name: 'Horizontal ray', group: 'lines', n: 1,
    defaults: { line: line('#2962ff', 1), priceLabel: true },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), { label: 'Price on the scale', fields: [{ path: 'priceLabel', type: 'check' }] }] }],
    colors: { line: 'line' },
    draw(c, it) {
      const a = P(c, it.pts[0]);
      stroke(c.g, it.s.line);
      hline(c.g, a.y, a.x, c.w);
      if (it.s.priceLabel) c.priceTags.push({ y: a.y, text: c.fmt(it.pts[0].p), bg: it.s.line.color });
    },
    hit(c, it, x, y) {
      const a = P(c, it.pts[0]);
      return Math.abs(y - a.y) <= TOL && x >= a.x - TOL;
    },
  },

  vline: {
    name: 'Vertical line', group: 'lines', key: 'Alt+V', n: 1,
    defaults: { line: line('#2962ff', 1), timeLabel: true },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), { label: 'Time on the scale', fields: [{ path: 'timeLabel', type: 'check' }] }] }],
    colors: { line: 'line' },
    draw(c, it) {
      stroke(c.g, it.s.line);
      const x = crisp(c.g, c.x(it.pts[0].t));
      seg(c.g, { x, y: 0 }, { x, y: c.h });
      if (it.s.timeLabel) c.timeTags.push({ x, t: it.pts[0].t, bg: it.s.line.color });
    },
    hit: (c, it, x) => Math.abs(x - c.x(it.pts[0].t)) <= TOL,
    handles: (c, it) => [{ x: c.x(it.pts[0].t), y: clamp(c.y(it.pts[0].p), 12, c.h - 12), k: 0 }],
  },

  channel: {
    name: 'Parallel channel', group: 'lines', n: 3,
    defaults: { line: line('#2962ff', 1), fill: { show: true, color: 'rgba(41, 98, 255, 0.2)' }, middle: true, extendLeft: false, extendRight: false },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), FILL_ROW, { label: 'Middle line', fields: [{ path: 'middle', type: 'check' }] }, ...EXTEND_ROWS] }],
    colors: { line: 'line', fill: 'fill.color' },
    offset(it) {
      if (it.pts.length < 3) return 0;
      return it.pts[2].p - priceOnLine(it.pts[0], it.pts[1], it.pts[2].t);
    },
    lines(c, it) {
      const d = this.offset(it);
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      const a2 = { x: a.x, y: c.y(it.pts[0].p + d) };
      const b2 = { x: b.x, y: c.y(it.pts[1].p + d) };
      return { a, b, a2, b2 };
    },
    draw(c, it) {
      const s = it.s;
      const { a, b, a2, b2 } = this.lines(c, it);
      const [p, q] = extend(a, b, s.extendLeft, s.extendRight, c.w, c.h);
      const [p2, q2] = extend(a2, b2, s.extendLeft, s.extendRight, c.w, c.h);
      stroke(c.g, s.line);
      if (s.fill.show) {
        c.g.beginPath();
        c.g.moveTo(p.x, p.y);
        c.g.lineTo(q.x, q.y);
        c.g.lineTo(q2.x, q2.y);
        c.g.lineTo(p2.x, p2.y);
        c.g.closePath();
        c.g.fillStyle = s.fill.color;
        c.g.fill();
      }
      seg(c.g, p, q);
      seg(c.g, p2, q2);
      if (s.middle) {
        c.g.setLineDash(dash('dashed', 1));
        c.g.lineWidth = 1;
        seg(c.g, { x: (p.x + p2.x) / 2, y: (p.y + p2.y) / 2 }, { x: (q.x + q2.x) / 2, y: (q.y + q2.y) / 2 });
      }
    },
    hit(c, it, x, y) {
      const { a, b, a2, b2 } = this.lines(c, it);
      return inPoly(x, y, [a, b, b2, a2]) || distSeg(x, y, a, b) <= TOL || distSeg(x, y, a2, b2) <= TOL;
    },
    handles(c, it) {
      const { a, b, a2, b2 } = this.lines(c, it);
      return [{ ...a, k: 0 }, { ...b, k: 1 }, { ...a2, k: 2 }, { ...b2, k: 3 }];
    },
    // Dragging the parallel line's ends moves the whole parallel line.
    drag(it, k, pt) {
      if (k <= 1) it.pts[k] = pt;
      else it.pts[2] = pt;
    },
  },

  fib: {
    name: 'Fib retracement', group: 'fib', key: 'Alt+F', n: 2,
    defaults: {
      levels: FIB_LEVELS, line: { width: 1, style: 'solid' }, fill: { show: true, alpha: 0.12 },
      labels: { show: true, prices: true, percents: false, h: 'left', v: 'middle' },
      extendLeft: false, extendRight: false, reverse: false,
      trend: { show: true, color: '#787b86', width: 1, style: 'dashed' },
    },
    fields: [
      { tab: 'Levels', rows: [{ label: '', fields: [{ path: 'levels', type: 'levels' }] }] },
      {
        tab: 'Style',
        rows: [
          { label: 'Levels line', fields: [{ path: 'line.width', type: 'width' }, { path: 'line.style', type: 'style' }] },
          { label: 'Trend line', fields: [{ path: 'trend.show', type: 'check' }, { path: 'trend.color', type: 'color' }, { path: 'trend.width', type: 'width' }, { path: 'trend.style', type: 'style' }] },
          { label: 'Background, opacity', fields: [{ path: 'fill.show', type: 'check' }, { path: 'fill.alpha', type: 'number', min: 0, max: 1, step: 0.01 }] },
          { label: 'Levels as %', fields: [{ path: 'labels.percents', type: 'check' }] },
          { label: 'Labels, prices', fields: [{ path: 'labels.show', type: 'check' }, { path: 'labels.prices', type: 'check' }] },
          { label: 'Labels, place', fields: [{ path: 'labels.h', type: 'select', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] }, { path: 'labels.v', type: 'select', options: [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] }] },
          { label: 'Reverse', fields: [{ path: 'reverse', type: 'check' }] },
          ...EXTEND_ROWS,
        ],
      },
    ],
    colors: { line: 'trend.color', width: 'line.width', style: 'line.style' },
    draw(c, it) {
      const s = it.s;
      const g = c.g;
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      const x1 = s.extendLeft ? 0 : Math.min(a.x, b.x);
      const x2 = s.extendRight ? c.w : Math.max(a.x, b.x);
      if (s.trend.show) {
        stroke(g, s.trend);
        seg(g, a, b);
      }
      const shown = s.levels.filter((l) => l.show).sort((p, q) => p.v - q.v);
      if (s.fill.show) {
        for (let k = 1; k < shown.length; k++) {
          const y0 = c.y(fibPrice(it, shown[k - 1].v));
          const y1 = c.y(fibPrice(it, shown[k].v));
          g.fillStyle = withAlpha(shown[k].color, s.fill.alpha);
          g.fillRect(x1, Math.min(y0, y1), x2 - x1, Math.abs(y1 - y0));
        }
      }
      for (const l of shown) {
        const p = fibPrice(it, l.v);
        const y = c.y(p);
        stroke(g, { color: l.color, width: s.line.width, style: s.line.style });
        hline(g, y, x1, x2);
        if (!s.labels.show) continue;
        const name = s.labels.percents ? +(l.v * 100).toFixed(1) + '%' : String(l.v);
        const label = s.labels.prices ? name + ' (' + c.fmt(p) + ')' : name;
        const h = s.labels.h;
        const v = s.labels.v;
        const tx = h === 'left' ? x1 - 6 : h === 'right' ? x2 + 6 : (x1 + x2) / 2;
        const ty = v === 'top' ? y - 3 : v === 'bottom' ? y + 3 : y;
        text(g, label, tx, ty, { color: l.color, size: 12 }, h === 'left' ? 'right' : h === 'right' ? 'left' : 'center', v === 'top' ? 'bottom' : v === 'bottom' ? 'top' : 'middle');
      }
    },
    hit(c, it, x, y) {
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      const ys = it.s.levels.filter((l) => l.show).map((l) => c.y(fibPrice(it, l.v)));
      const x1 = it.s.extendLeft ? 0 : Math.min(a.x, b.x);
      const x2 = it.s.extendRight ? c.w : Math.max(a.x, b.x);
      if (x < x1 - TOL || x > x2 + TOL) return distSeg(x, y, a, b) <= TOL;
      return ys.some((yy) => Math.abs(y - yy) <= TOL) || (it.s.fill.show && y >= Math.min(...ys) && y <= Math.max(...ys)) || distSeg(x, y, a, b) <= TOL;
    },
  },

  rect: {
    name: 'Rectangle', group: 'shapes', n: 2,
    defaults: { line: line('#9c27b0', 1), fill: { show: true, color: 'rgba(156, 39, 176, 0.2)' }, extendLeft: false, extendRight: false },
    fields: [{ tab: 'Style', rows: [LINE_ROW('Border'), FILL_ROW, ...EXTEND_ROWS] }],
    colors: { line: 'line', fill: 'fill.color' },
    draw(c, it) {
      const s = it.s;
      const r = rectCorners(c, it);
      const x1 = s.extendLeft ? 0 : r.x1;
      const x2 = s.extendRight ? c.w : r.x2;
      if (s.fill.show) {
        c.g.fillStyle = s.fill.color;
        c.g.fillRect(x1, r.y1, x2 - x1, r.y2 - r.y1);
      }
      stroke(c.g, s.line);
      const L = crisp(c.g, x1);
      const T = crisp(c.g, r.y1);
      c.g.strokeRect(L, T, crisp(c.g, x2) - L, crisp(c.g, r.y2) - T);
    },
    hit(c, it, x, y) {
      const r = rectCorners(c, it);
      const x1 = it.s.extendLeft ? 0 : r.x1;
      const x2 = it.s.extendRight ? c.w : r.x2;
      const near = x >= x1 - TOL && x <= x2 + TOL && y >= r.y1 - TOL && y <= r.y2 + TOL;
      if (!near) return false;
      if (it.s.fill.show) return true;
      return Math.abs(x - x1) <= TOL || Math.abs(x - x2) <= TOL || Math.abs(y - r.y1) <= TOL || Math.abs(y - r.y2) <= TOL;
    },
    handles(c, it) {
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      return [{ ...a, k: 0 }, { ...b, k: 1 }, { x: b.x, y: a.y, k: 2 }, { x: a.x, y: b.y, k: 3 }];
    },
    drag(it, k, pt) {
      if (k <= 1) it.pts[k] = pt;
      else if (k === 2) {
        it.pts[1] = { t: pt.t, p: it.pts[1].p };
        it.pts[0] = { t: it.pts[0].t, p: pt.p };
      } else {
        it.pts[0] = { t: pt.t, p: it.pts[0].p };
        it.pts[1] = { t: it.pts[1].t, p: pt.p };
      }
    },
  },

  rotrect: {
    name: 'Rotated rectangle', group: 'shapes', n: 3,
    defaults: { line: line('#9c27b0', 1), fill: { show: true, color: 'rgba(156, 39, 176, 0.2)' } },
    fields: [{ tab: 'Style', rows: [LINE_ROW('Border'), FILL_ROW] }],
    colors: { line: 'line', fill: 'fill.color' },
    draw(c, it) {
      const pts = rotCorners(it.pts.map((q) => P(c, q)));
      stroke(c.g, it.s.line);
      if (pts.length < 4) seg(c.g, pts[0], pts[1]);
      else poly(c.g, pts, it.s.fill.show ? it.s.fill.color : null);
    },
    hit(c, it, x, y) {
      const pts = rotCorners(it.pts.map((q) => P(c, q)));
      return (pts.length > 3 && it.s.fill.show && inPoly(x, y, pts)) || pts.some((q, k) => distSeg(x, y, q, pts[(k + 1) % pts.length]) <= TOL);
    },
  },

  triangle: {
    name: 'Triangle', group: 'shapes', n: 3,
    defaults: { line: line('#f57c00', 1), fill: { show: true, color: 'rgba(245, 124, 0, 0.2)' } },
    fields: [{ tab: 'Style', rows: [LINE_ROW('Border'), FILL_ROW] }],
    colors: { line: 'line', fill: 'fill.color' },
    draw(c, it) {
      const pts = it.pts.map((q) => P(c, q));
      stroke(c.g, it.s.line);
      poly(c.g, pts, it.s.fill.show && pts.length > 2 ? it.s.fill.color : null);
    },
    hit(c, it, x, y) {
      const pts = it.pts.map((q) => P(c, q));
      return (pts.length > 2 && it.s.fill.show && inPoly(x, y, pts)) || pts.some((q, k) => distSeg(x, y, q, pts[(k + 1) % pts.length]) <= TOL);
    },
  },

  path: {
    name: 'Path', group: 'shapes', n: -1,
    defaults: { line: line('#2962ff', 2), arrowEnd: false },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), { label: 'Arrow at the end', fields: [{ path: 'arrowEnd', type: 'check' }] }] }],
    colors: { line: 'line' },
    draw(c, it) {
      const pts = it.pts.map((q) => P(c, q));
      stroke(c.g, it.s.line);
      c.g.beginPath();
      pts.forEach((q, k) => (k ? c.g.lineTo(q.x, q.y) : c.g.moveTo(q.x, q.y)));
      c.g.stroke();
      if (it.s.arrowEnd && pts.length > 1) arrowHead(c.g, pts[pts.length - 2], pts[pts.length - 1], it.s.line.color, it.s.line.width);
    },
    hit(c, it, x, y) {
      const pts = it.pts.map((q) => P(c, q));
      for (let k = 1; k < pts.length; k++) if (distSeg(x, y, pts[k - 1], pts[k]) <= TOL) return true;
      return false;
    },
  },

  text: {
    name: 'Text', group: 'text', n: 1,
    defaults: { text: { value: 'Text', color: '#ffffff', size: 14, bold: false, italic: false }, background: { show: false, color: 'rgba(41, 98, 255, 0.8)' }, border: { show: false, color: '#2962ff' } },
    fields: [{
      tab: 'Text',
      rows: [
        { label: '', fields: [{ path: 'text.value', type: 'textarea' }] },
        { label: 'Colour, size', fields: [{ path: 'text.color', type: 'color' }, { path: 'text.size', type: 'select', options: [[10, '10'], [12, '12'], [14, '14'], [16, '16'], [20, '20'], [24, '24'], [28, '28'], [36, '36']] }] },
        { label: 'Bold, italic', fields: [{ path: 'text.bold', type: 'check' }, { path: 'text.italic', type: 'check' }] },
        { label: 'Background', fields: [{ path: 'background.show', type: 'check' }, { path: 'background.color', type: 'color' }] },
        { label: 'Border', fields: [{ path: 'border.show', type: 'check' }, { path: 'border.color', type: 'color' }] },
      ],
    }],
    colors: { text: 'text.color', fill: 'background.color' },
    box(c, it) {
      const t = it.s.text;
      c.g.font = font(t.size, t.bold, t.italic);
      const rows = String(t.value || '').split('\n');
      const lh = Math.round(t.size * 1.3);
      const w = Math.max(10, ...rows.map((r) => c.g.measureText(r).width));
      const a = P(c, it.pts[0]);
      return { x: a.x, y: a.y, w: w + 12, h: rows.length * lh + 8, rows, lh };
    },
    draw(c, it) {
      const s = it.s;
      const b = this.box(c, it);
      if (s.background.show || s.border.show) {
        c.g.setLineDash([]);
        c.g.beginPath();
        if (c.g.roundRect) c.g.roundRect(b.x, b.y, b.w, b.h, 4);
        else c.g.rect(b.x, b.y, b.w, b.h);
        if (s.background.show) {
          c.g.fillStyle = s.background.color;
          c.g.fill();
        }
        if (s.border.show) {
          c.g.strokeStyle = s.border.color;
          c.g.lineWidth = 1;
          c.g.stroke();
        }
      }
      b.rows.forEach((r, k) => text(c.g, r, b.x + 6, b.y + 4 + b.lh * k, s.text, 'left', 'top'));
    },
    hit(c, it, x, y) {
      const b = this.box(c, it);
      return x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2;
    },
  },

  prange: {
    name: 'Price range', group: 'measure', n: 2,
    defaults: {
      line: line('#2962ff', 1), text: { color: '#ffffff', size: 12 }, label: { show: true, bg: '#2962ff' },
      fill: { show: true, color: 'rgba(41, 98, 255, 0.2)' }, border: { show: false, color: '#2962ff' }, extendLeft: false, extendRight: false,
    },
    fields: [{
      tab: 'Style',
      rows: [
        LINE_ROW(), FILL_ROW,
        { label: 'Border', fields: [{ path: 'border.show', type: 'check' }, { path: 'border.color', type: 'color' }] },
        { label: 'Label', fields: [{ path: 'label.show', type: 'check' }, { path: 'label.bg', type: 'color' }] },
        { label: 'Label text', fields: [{ path: 'text.color', type: 'color' }, { path: 'text.size', type: 'select', options: [[10, '10'], [11, '11'], [12, '12'], [14, '14']] }] },
        ...EXTEND_ROWS,
      ],
    }],
    colors: { line: 'line', fill: 'fill.color' },
    draw(c, it) {
      const s = it.s;
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      const x1 = s.extendLeft ? 0 : Math.min(a.x, b.x);
      const x2 = s.extendRight ? c.w : Math.max(a.x, b.x);
      const xm = (Math.min(a.x, b.x) + Math.max(a.x, b.x)) / 2;
      if (s.fill.show) {
        c.g.fillStyle = s.fill.color;
        c.g.fillRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
      }
      if (s.border.show) {
        stroke(c.g, { color: s.border.color, width: 1, style: 'solid' });
        c.g.strokeRect(x1, Math.min(a.y, b.y), x2 - x1, Math.abs(b.y - a.y));
      }
      stroke(c.g, s.line);
      hline(c.g, a.y, x1, x2);
      hline(c.g, b.y, x1, x2);
      seg(c.g, { x: xm, y: a.y }, { x: xm, y: b.y });
      arrowHead(c.g, { x: xm, y: a.y }, { x: xm, y: b.y }, s.line.color, 1);
      if (s.label.show) {
        const up = b.y < a.y;
        labelBox(c.g, xm, b.y + (up ? -16 : 16), rangeLabel(c, it), s.label.bg, s.text.color, s.text.size);
      }
    },
    hit(c, it, x, y) {
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      return x >= Math.min(a.x, b.x) - TOL && x <= Math.max(a.x, b.x) + TOL && y >= Math.min(a.y, b.y) - TOL && y <= Math.max(a.y, b.y) + TOL;
    },
  },

  dprange: {
    name: 'Date and price range', group: 'measure', n: 2,
    defaults: { line: line('#2962ff', 1), text: { color: '#ffffff', size: 12 }, label: { show: true, bg: '#2962ff' }, fill: { show: true, color: 'rgba(41, 98, 255, 0.2)' } },
    fields: [{ tab: 'Style', rows: [LINE_ROW(), FILL_ROW, { label: 'Label', fields: [{ path: 'label.show', type: 'check' }, { path: 'label.bg', type: 'color' }, { path: 'text.color', type: 'color' }] }] }],
    colors: { line: 'line', fill: 'fill.color' },
    draw(c, it) {
      const s = it.s;
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      const xm = (a.x + b.x) / 2;
      const ym = (a.y + b.y) / 2;
      if (s.fill.show) {
        c.g.fillStyle = s.fill.color;
        c.g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      stroke(c.g, s.line);
      seg(c.g, { x: a.x, y: ym }, { x: b.x, y: ym });
      arrowHead(c.g, { x: a.x, y: ym }, { x: b.x, y: ym }, s.line.color, 1);
      seg(c.g, { x: xm, y: a.y }, { x: xm, y: b.y });
      arrowHead(c.g, { x: xm, y: a.y }, { x: xm, y: b.y }, s.line.color, 1);
      if (s.label.show) {
        const bars = c.bars(it.pts[0].t, it.pts[1].t);
        const up = b.y < a.y;
        labelBox(c.g, xm, b.y + (up ? -24 : 24), [rangeLabel(c, it), bars + ' bars, ' + c.duration(it.pts[0].t, it.pts[1].t)], s.label.bg, s.text.color, s.text.size);
      }
    },
    hit(c, it, x, y) {
      const a = P(c, it.pts[0]);
      const b = P(c, it.pts[1]);
      return x >= Math.min(a.x, b.x) - TOL && x <= Math.max(a.x, b.x) + TOL && y >= Math.min(a.y, b.y) - TOL && y <= Math.max(a.y, b.y) + TOL;
    },
  },
};

// ---- long and short positions -----------------------------------------------------------------

// The decimals of a lot size at the broker's lot step (0.01 -> 2, 0.001 -> 3, 1 -> 0).
function lotDigits(spec) {
  const step = spec && spec.volStep > 0 ? spec.volStep : 0.01;
  return Math.max(0, Math.min(6, Math.round(-Math.log10(step))));
}

// A template's distance is used only when it makes sense at this price: a template saved on gold
// (a stop 5.00 away) would put a euro position's stop below zero.
export function usableDistance(d, entry) {
  return d > 0 && d < Math.abs(entry) * 0.5;
}

function positionTool(side) {
  return {
    name: side > 0 ? 'Long position' : 'Short position',
    group: 'positions',
    n: 1,
    side,
    defaults: POSITION,
    fields: POSITION_FIELDS,
    colors: { line: 'lineColor', text: 'textColor' },
    // A new position: as wide as about a sixth of the screen, with the template's distances or,
    // without them, a stop at 8% and a target at 16% of the prices on screen.
    create(c, it) {
      const e = it.pts[0];
      const span = c.priceSpan || Math.abs(e.p) * 0.01;
      const fallback = (share) => Math.min(span * share, Math.abs(e.p) * share * 0.5);
      const stopD = usableDistance(it.s.stopDistance, e.p) ? it.s.stopDistance : fallback(0.08);
      const targetD = usableDistance(it.s.targetDistance, e.p) ? it.s.targetDistance : fallback(0.16);
      it.stop = e.p - side * stopD;
      it.target = e.p + side * targetD;
      it.pts[1] = { t: c.timeAfter(e.t, Math.max(10, Math.round(c.w / c.barW / 6))), p: e.p };
    },
    geom(c, it) {
      const e = it.pts[0];
      const x1 = c.x(e.t);
      const x2 = c.x(it.pts[1] ? it.pts[1].t : e.t);
      return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), ye: c.y(e.p), yt: c.y(it.target), ys: c.y(it.stop) };
    },
    stats(c, it) {
      const s = it.s;
      return positionStats({
        side, entry: it.pts[0].p, stop: it.stop, target: it.target, spec: c.spec, symbol: c.symbol,
        accountSize: s.useEquity && c.equity > 0 ? c.equity : s.accountSize, risk: s.risk, riskMode: s.riskMode, price: c.price,
      });
    },
    draw(c, it, state) {
      const s = it.s;
      const g = c.g;
      const { x1, x2, ye, yt, ys } = this.geom(c, it);
      const w = x2 - x1;
      g.setLineDash([]);
      g.fillStyle = s.targetColor;
      g.fillRect(x1, Math.min(ye, yt), w, Math.abs(yt - ye));
      g.fillStyle = s.stopColor;
      g.fillRect(x1, Math.min(ye, ys), w, Math.abs(ys - ye));
      stroke(g, { color: s.lineColor, width: s.lineWidth, style: 'solid' });
      hline(g, ye, x1, x2);
      const st = this.stats(c, it);
      const fs = s.fontSize;
      const inf = s.info;
      const money = (v) => formatMoney(v, 2);
      const targetBg = withAlpha(s.targetColor, 1);
      const stopBg = withAlpha(s.stopColor, 1);
      // The stats show while the mouse is on the drawing or it is selected (or always, by its setting),
      // so a chart with several positions drawn stays readable.
      const showStats = s.alwaysShowStats || state.selected || state.hover;
      if (!s.compact && showStats) {
        const tParts = [];
        if (inf.targetPrice) tParts.push(c.fmt(st.targetDist));
        if (inf.targetPct) tParts.push('(' + st.targetPct.toFixed(2) + '%)');
        if (inf.targetPips) tParts.push((Math.round(st.targetPips * 10) / 10) + ' pips');
        let tText = tParts.length ? 'Target: ' + tParts.join(' ') : '';
        if (inf.targetAmount) tText += (tText ? ', ' : '') + 'Amount: ' + money(st.targetAmount);
        const sParts = [];
        if (inf.stopPrice) sParts.push(c.fmt(st.stopDist));
        if (inf.stopPct) sParts.push('(' + st.stopPct.toFixed(2) + '%)');
        if (inf.stopPips) sParts.push((Math.round(st.stopPips * 10) / 10) + ' pips');
        let sText = sParts.length ? 'Stop: ' + sParts.join(' ') : '';
        if (inf.stopAmount) sText += (sText ? ', ' : '') + 'Amount: ' + money(st.stopAmount);
        const xm = x1 + w / 2;
        if (tText) labelBox(g, xm, yt + (yt < ye ? -13 : 13) * (fs / 12), tText, targetBg, s.textColor, fs);
        if (sText) labelBox(g, xm, ys + (ys > ye ? 13 : -13) * (fs / 12), sText, stopBg, s.textColor, fs);
      }
      if (showStats) {
        const rows = [];
        const first = [];
        if (inf.openPL && st.openPL !== null && !s.compact) first.push('Open P&L: ' + money(st.openPL));
        if (inf.qty && !s.compact) {
          first.push(!c.spec ? 'Qty: ' + +st.units.toFixed(4)
            : st.tooSmall ? 'Lots: ' + +st.exactLots.toPrecision(2) + ' (below the ' + st.minLots + ' minimum)' : 'Lots: ' + +st.lots.toFixed(lotDigits(c.spec)));
        }
        if (first.length) rows.push(first.join(', '));
        if (inf.rr) rows.push((s.compact ? 'R:R ' : 'Risk/Reward Ratio: ') + st.rr.toFixed(2));
        if (rows.length) labelBox(g, x1 + w / 2, ye, rows, withAlpha(side > 0 ? '#089981' : '#f23645', 0.92), s.textColor, fs);
      }
      if (s.priceLabels && (state.selected || state.hover)) {
        c.priceTags.push({ y: yt, text: c.fmt(it.target), bg: targetBg });
        c.priceTags.push({ y: ys, text: c.fmt(it.stop), bg: stopBg });
        c.priceTags.push({ y: ye, text: c.fmt(it.pts[0].p), bg: s.lineColor });
      }
    },
    hit(c, it, x, y) {
      const { x1, x2, ye, yt, ys } = this.geom(c, it);
      return x >= x1 - TOL && x <= x2 + TOL && y >= Math.min(ye, yt, ys) - TOL && y <= Math.max(ye, yt, ys) + TOL;
    },
    handles(c, it) {
      const { x1, x2, ye, yt, ys } = this.geom(c, it);
      return [{ x: x1, y: ye, k: 0 }, { x: x1, y: yt, k: 1 }, { x: x1, y: ys, k: 2 }, { x: x2, y: ye, k: 3 }];
    },
    // The entry handle moves the entry (stop and target stay); the others move their level, or the
    // right edge.
    drag(it, k, pt) {
      if (k === 0) it.pts[0] = { t: pt.t, p: pt.p };
      else if (k === 1) it.target = pt.p;
      else if (k === 2) it.stop = pt.p;
      else it.pts[1] = { t: pt.t, p: it.pts[0].p };
      if (it.pts[1]) it.pts[1].p = it.pts[0].p;
    },
    move(it, dp) {
      it.stop += dp;
      it.target += dp;
    },
  };
}

TOOLS.long = positionTool(1);
TOOLS.short = positionTool(-1);
TOOLS.long.key = 'Alt+L';
TOOLS.short.key = 'Alt+S';

// The left toolbar's groups, in order; each opens to its tools.
export const GROUPS = [
  { id: 'lines', name: 'Lines', tools: ['trend', 'ray', 'extended', 'hline', 'hray', 'vline', 'channel'] },
  { id: 'fib', name: 'Fibonacci', tools: ['fib'] },
  { id: 'shapes', name: 'Shapes', tools: ['rect', 'rotrect', 'triangle', 'path', 'arrow'] },
  { id: 'text', name: 'Text', tools: ['text'] },
  { id: 'positions', name: 'Positions', tools: ['long', 'short'] },
  { id: 'measure', name: 'Measure', tools: ['prange', 'dprange'] },
];

// The handles of a drawing: its own, else one on each point.
export function handlesOf(c, it) {
  const tool = TOOLS[it.type];
  if (tool.handles) return tool.handles(c, it);
  return it.pts.map((q, k) => ({ x: c.x(q.t), y: c.y(q.p), k }));
}
