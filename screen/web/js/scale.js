// The chart's view: which bars are on screen and how large, and which prices. Bar i is drawn
// centred at xOf(i); `right` is the bar position at the plot's right edge.
import { clamp, niceStep } from './util.js';

export const MIN_BAR = 1;
export const MAX_BAR = 80;

export class View {
  constructor() {
    this.w = 100;   // plot size in CSS pixels
    this.h = 100;
    this.barW = 6;  // distance between bars
    this.right = 0;
    this.top = 1;
    this.bottom = 0;
    this.auto = true;
  }

  xOf(i) {
    return this.w - (this.right - i + 0.5) * this.barW;
  }

  iOf(x) {
    return this.right + 0.5 - (this.w - x) / this.barW;
  }

  yOf(p) {
    const span = this.top - this.bottom || 1;
    return ((this.top - p) / span) * this.h;
  }

  pOf(y) {
    return this.top - (y / this.h) * (this.top - this.bottom);
  }

  // The first and last bar positions on screen (may be outside the bars held).
  visible() {
    return [Math.floor(this.iOf(0)), Math.ceil(this.iOf(this.w))];
  }

  // Wider or narrower bars, keeping the bar under x where it is.
  zoomAt(factor, x) {
    const i = this.iOf(x);
    this.barW = clamp(this.barW * factor, MIN_BAR, MAX_BAR);
    this.right = i - 0.5 + (this.w - x) / this.barW;
  }

  pan(dx) {
    this.right -= dx / this.barW;
  }

  // Keeps at least a few bars of n on screen, and no more than most of the screen empty on the right.
  limit(n) {
    const onScreen = this.w / this.barW;
    this.right = clamp(this.right, Math.min(4, n - 1), n - 1 + onScreen * 0.85);
  }

  // Prices from lo to hi, with margins (fractions of the height) above and below.
  fit(lo, hi, topMargin = 0.1, bottomMargin = 0.08) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (hi - lo < Math.abs(hi) * 1e-9) {
      const pad = Math.abs(hi) * 0.001 || 1;
      lo -= pad;
      hi += pad;
    }
    const inner = 1 - topMargin - bottomMargin;
    const span = (hi - lo) / Math.max(inner, 0.2);
    this.top = hi + span * topMargin;
    this.bottom = this.top - span;
  }

  // Stretches the prices around the one at y (dragging the price scale): factor > 1 shows more.
  scalePrice(factor, y) {
    const p = this.pOf(y);
    const f = clamp(factor, 0.05, 20);
    this.top = p + (this.top - p) * f;
    this.bottom = p - (p - this.bottom) * f;
    this.auto = false;
  }

  panPrice(dy) {
    const d = (dy / this.h) * (this.top - this.bottom);
    this.top += d;
    this.bottom += d;
    this.auto = false;
  }
}

// The prices to label on the scale: a nice step, labels at least minGap pixels apart.
export function priceTicks(top, bottom, h, minGap = 32) {
  const span = top - bottom;
  if (!(span > 0) || !(h > 0)) return [];
  const step = niceStep((span / h) * minGap);
  const out = [];
  const first = Math.ceil(bottom / step) * step;
  for (let p = first; p <= top + step * 1e-9 && out.length < 200; p += step) out.push(Math.round(p / step) * step);
  return out;
}

// How many decimals the scale's labels need for a step, at least the symbol's own digits.
export function stepDigits(step, digits) {
  let d = 0;
  while (d < 10 && Math.abs(Math.round(step * Math.pow(10, d)) - step * Math.pow(10, d)) > 1e-6) d++;
  return Math.max(d, digits);
}
