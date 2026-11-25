// The bars of one symbol and timeframe, as MT5 sent them: oldest first, each {t, o, h, l, c, v}.
// Drawings are kept by time, not by bar number, so they stay put across timeframes and when older
// bars arrive; indexAt and timeAt turn one into the other.
import { tfSeconds, barEnd } from './timeframes.js';

const rowToBar = (r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] || 0 });

export class Series {
  constructor(symbol, tf, digits = 5) {
    this.symbol = symbol;
    this.tf = tf;
    this.digits = digits;
    this.bars = [];
    this.done = false;   // no older bars to ask for
  }

  get length() {
    return this.bars.length;
  }

  get last() {
    return this.bars[this.bars.length - 1];
  }

  setHistory(rows, done) {
    this.bars = rows.map(rowToBar);
    this.done = !!done;
  }

  // Older bars in front; rows at or after the first bar already held are left out. Returns how
  // many were added.
  prepend(rows, done) {
    const first = this.bars.length ? this.bars[0].t : Infinity;
    const older = rows.filter((r) => r[0] < first).map(rowToBar);
    this.bars = older.concat(this.bars);
    if (done || older.length === 0) this.done = true;
    return older.length;
  }

  // A bar from the live feed: the forming bar changed, a new bar opened, or the bar before was
  // finished. Returns 'update', 'append', 'old' or 'ignored'.
  live(row) {
    const bar = rowToBar(row);
    const n = this.bars.length;
    if (n === 0) {
      this.bars.push(bar);
      return 'append';
    }
    const last = this.bars[n - 1];
    if (bar.t === last.t) {
      this.bars[n - 1] = bar;
      return 'update';
    }
    if (bar.t > last.t) {
      this.bars.push(bar);
      return 'append';
    }
    const k = this.find(bar.t);
    if (k >= 0 && this.bars[k].t === bar.t) {
      this.bars[k] = bar;
      return 'old';
    }
    return 'ignored';
  }

  // The bar opened at or before t (its index), -1 when t is before the first bar.
  find(t) {
    let lo = 0;
    let hi = this.bars.length - 1;
    if (hi < 0 || t < this.bars[0].t) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bars[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Where a time falls, in bars: a bar's own time is its index; a time between two bars falls
  // between them; before the first or after the last bar it counts on in this timeframe's bars.
  indexAt(t) {
    const n = this.bars.length;
    if (n === 0) return NaN;
    const sec = tfSeconds(this.tf);
    const first = this.bars[0].t;
    const last = this.bars[n - 1].t;
    if (t <= first) return (t - first) / sec;
    if (t >= last) return n - 1 + (t - last) / sec;
    const k = this.find(t);
    const a = this.bars[k].t;
    const b = this.bars[k + 1].t;
    return k + (t - a) / (b - a);
  }

  // The time at a bar position, the inverse of indexAt.
  timeAt(i) {
    const n = this.bars.length;
    if (n === 0) return NaN;
    const sec = tfSeconds(this.tf);
    if (i <= 0) return Math.round(this.bars[0].t + i * sec);
    if (i >= n - 1) return Math.round(this.bars[n - 1].t + (i - (n - 1)) * sec);
    const k = Math.floor(i);
    const a = this.bars[k].t;
    const b = this.bars[k + 1].t;
    return Math.round(a + (i - k) * (b - a));
  }

  // Lowest low and highest high of the bars from i0 to i1 (clamped), or null.
  range(i0, i1) {
    const a = Math.max(0, Math.floor(i0));
    const b = Math.min(this.bars.length - 1, Math.ceil(i1));
    if (b < a) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = a; i <= b; i++) {
      const bar = this.bars[i];
      if (bar.l < lo) lo = bar.l;
      if (bar.h > hi) hi = bar.h;
    }
    return { lo, hi };
  }

  // Seconds until the forming bar closes, given the server's time now.
  secondsLeft(serverNow) {
    const last = this.last;
    return last ? barEnd(last.t, this.tf) - serverNow : 0;
  }
}
