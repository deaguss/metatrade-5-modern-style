// Small helpers shared by the screen: numbers, colours, names.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pad2 = (n) => String(n).padStart(2, '0');

// A "nice" step (1, 2, 2.5, 5 times a power of ten) at least as large as raw.
export function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw * (1 - 1e-9)) return m * p;
  return 10 * p;
}

export function formatPrice(p, digits) {
  return Number.isFinite(p) ? p.toFixed(Math.max(0, Math.min(10, digits | 0))) : '';
}

// 1234567.891 -> "1,234,567.89"
export function formatMoney(v, decimals = 2) {
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// "#rgb", "#rrggbb", "#rrggbbaa", "rgb(r, g, b)" and "rgba(r, g, b, a)" -> {r, g, b, a}; null otherwise.
export function parseColor(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    const c = (v) => clamp(Math.round(Number(v)), 0, 255);
    return { r: c(m[1]), g: c(m[2]), b: c(m[3]), a: m[4] === undefined ? 1 : clamp(Number(m[4]), 0, 1) };
  }
  return null;
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

export function toCss(c) {
  if (!c) return 'transparent';
  if (c.a >= 1) return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);
  return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + +c.a.toFixed(3) + ')';
}

// The colour with its opacity set to a (0..1).
export function withAlpha(color, a) {
  const c = parseColor(color);
  return c ? toCss({ ...c, a: clamp(a, 0, 1) }) : color;
}

export function alphaOf(color) {
  const c = parseColor(color);
  return c ? c.a : 1;
}

// Black or white, whichever reads better on bg.
export function textOn(bg) {
  const c = parseColor(bg);
  if (!c) return '#ffffff';
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return lum > 0.4 ? '#000000' : '#ffffff';
}

// The store file of a symbol's drawings: "XAUUSD.m" -> "drawings.xauusd_m.json".
export function drawingsFile(symbol) {
  const s = String(symbol).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 60) || '_';
  return 'drawings.' + s + '.json';
}

// The size of one pip, as the ActionInna ticket counts it: 0.1 on gold, ten points on 3- and
// 5-digit prices, one point otherwise.
export function pipSize(symbol, digits, point) {
  if (!(point > 0)) return 0;
  if (/^xau|gold/i.test(symbol)) return 0.1;
  if (digits === 3 || digits === 5) return point * 10;
  return point;
}

export function debounce(fn, ms) {
  let timer = null;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  run.flush = (...args) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn(...args);
    }
  };
  return run;
}

let lastId = 0;
export function uid() {
  lastId = Math.max(lastId + 1, Date.now() * 1000);
  return lastId.toString(36);
}

export const clone = (o) => JSON.parse(JSON.stringify(o));

// Merges b's keys into a copy of a, objects deeply, arrays and values replaced.
export function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? clone(a) : clone(b);
  const out = a && typeof a === 'object' && !Array.isArray(a) ? clone(a) : {};
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
      ? merge(out[k], v)
      : clone(v);
  }
  return out;
}
