// The chart: one canvas with the bars, grid, scales, crosshair and drawings, and the mouse on it.
// It draws on the next animation frame after anything changed, and only the bars on screen.
import { View, priceTicks, stepDigits } from './scale.js';
import { timeLabels, crosshairTime, countdown, tfSeconds } from './timeframes.js';
import { formatPrice, withAlpha, textOn, clamp, pipSize } from './util.js';
import { DEFAULT_STYLE, FONT, dash } from './style.js';
import { Drawings } from './drawings.js';
import { setPixelRatio } from './tools.js';

const TIME_H = 28;

export class Chart {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    el.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.view = new View();
    this.drawings = new Drawings();
    this.layers = [];      // drawn after the drawings and hit before them (the ticket's lines)
    this.layer = null;     // the layer a press went to
    this.series = null;
    this.style = DEFAULT_STYLE;
    this.symbol = '';
    this.tf = 'M15';
    this.spec = null;
    this.bid = NaN;
    this.ask = NaN;
    this.equity = 0;
    this.serverOffset = 0;   // server time minus this PC's time, ms
    this.times = [];
    this.W = 0;
    this.H = 0;
    this.axisW = 64;
    this.mouse = null;
    this.mode = null;
    this.dirty = true;
    this.lastData = 0;       // when the last live bar arrived (performance.now)
    this.message = '';       // shown in the middle when there is nothing to draw
    this.onNeedHistory = () => {};
    this.onHover = () => {};
    this.onFrame = () => {};
    this.onOpenSettings = () => {};
    this.onContextMenu = () => {};
    this.onViewChange = () => {};

    // The canvas is sized in the screen's own pixels (125% display scale and the like included), so
    // a 1 px line is one pixel of the screen and nothing is drawn between two pixels (blurred).
    const ro = new ResizeObserver((entries) => {
      const box = entries[0].devicePixelContentBoxSize && entries[0].devicePixelContentBoxSize[0];
      this.resize(box ? box.inlineSize : 0, box ? box.blockSize : 0);
    });
    try {
      ro.observe(el, { box: 'device-pixel-content-box' });
    } catch (e) {
      ro.observe(el);
    }
    this.ro = ro;
    this.alive = true;
    this.resize();
    this.bindMouse();
    const loop = () => {
      if (!this.alive) return;
      if (this.dirty) this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // The countdown and the tick age change every second even without ticks.
    this.ticker = setInterval(() => {
      if (this.style.priceLine.countdown) this.dirty = true;
    }, 1000);
  }

  // A chart taken off the screen (a split view made smaller): it stops drawing and lets go of its canvas.
  destroy() {
    this.alive = false;
    clearInterval(this.ticker);
    this.ro.disconnect();
    this.canvas.remove();
  }

  invalidate() {
    this.dirty = true;
  }

  get digits() {
    return this.series ? this.series.digits : 2;
  }

  get serverNow() {
    return (Date.now() + this.serverOffset) / 1000;
  }

  resize(deviceW, deviceH) {
    const dpr = window.devicePixelRatio || 1;
    const r = this.el.getBoundingClientRect();
    const dw = deviceW > 0 ? deviceW : Math.round(r.width * dpr);
    const dh = deviceH > 0 ? deviceH : Math.round(r.height * dpr);
    this.canvas.width = Math.max(1, dw);
    this.canvas.height = Math.max(1, dh);
    this.canvas.style.width = dw / dpr + 'px';
    this.canvas.style.height = dh / dpr + 'px';
    this.W = Math.max(100, dw / dpr);
    this.H = Math.max(80, dh / dpr);
    this.dpr = dpr;
    setPixelRatio(dpr);
    this.layout();
    this.dirty = true;
  }

  // A 1-pixel line's centre on the screen's pixel grid, in CSS pixels.
  mid(v) {
    return (Math.floor(v * this.dpr) + 0.5) / this.dpr;
  }

  get hair() {
    return 1 / this.dpr;
  }

  layout() {
    this.g.font = this.style.scales.fontSize + 'px ' + FONT;
    const sample = this.series && this.series.length ? formatPrice(this.series.last.h * 1.2, this.digits) : '0000.00';
    this.axisW = Math.max(56, Math.ceil(this.g.measureText(sample).width) + 22);
    this.view.w = this.W - this.axisW;
    this.view.h = this.H - TIME_H;
  }

  // ---- data -----------------------------------------------------------------------------------

  setSeries(series, keepView) {
    this.series = series;
    this.times = series.bars.map((b) => b.t);
    this.layout();
    if (!keepView) {
      this.view.auto = true;
      this.view.right = series.length - 1 + Math.round(this.view.w / this.view.barW * 0.08);
    }
    this.message = series.length ? '' : 'No bars for ' + series.symbol + ' ' + series.tf + ' yet';
    this.dirty = true;
  }

  // Older bars arrived in front: the view stays on the same bars.
  prepended(count) {
    this.times = this.series.bars.map((b) => b.t);
    this.view.right += count;
    this.dirty = true;
  }

  // A bar from the feed (with its tick). Follows the newest bar when it was in view.
  live(row, tick) {
    if (!this.series) return;
    const n = this.series.length;
    const following = this.view.right >= n - 1 - 0.5;
    const kind = this.series.live(row);
    if (kind === 'append') {
      this.times.push(row[0]);
      if (following) this.view.right += 1;
    }
    if (tick) {
      if (Number.isFinite(tick.bid)) this.bid = tick.bid;
      if (Number.isFinite(tick.ask)) this.ask = tick.ask;
    }
    this.lastData = performance.now();
    this.dirty = true;
  }

  // ---- coordinates for the drawings ------------------------------------------------------------

  context() {
    const v = this.view;
    const s = this.series;
    const digits = this.digits;
    const spec = this.spec && this.spec.sym === this.symbol ? this.spec : null;
    const last = s && s.length ? s.last.c : NaN;
    return {
      g: this.g,
      digits,
      mid: (y) => this.mid(y),
      hair: this.hair,
      w: v.w,
      h: v.h,
      barW: v.barW,
      bg: this.style.background.color,
      x: (t) => v.xOf(s.indexAt(t)),
      y: (p) => v.yOf(p),
      fmt: (p) => formatPrice(p, digits),
      price: Number.isFinite(this.bid) ? this.bid : last,
      spec,
      symbol: this.symbol,
      pip: pipSize(this.symbol, digits, spec ? spec.point : Math.pow(10, -digits)),
      equity: this.equity,
      priceSpan: v.top - v.bottom,
      priceTags: [],
      timeTags: [],
      indexOf: (t) => s.indexAt(t),
      timeAfter: (t, n) => s.timeAt(s.indexAt(t) + n),
      bars: (t1, t2) => Math.round(Math.abs(s.indexAt(t2) - s.indexAt(t1))),
      duration: (t1, t2) => duration(Math.abs(t2 - t1)),
      toPoint: (x, y, magnet) => this.pointAt(x, y, magnet),
    };
  }

  // The chart point under the mouse: the bar's time, and the price (pulled onto the bar's open,
  // high, low or close with the magnet, when one is near).
  pointAt(x, y, magnet) {
    const v = this.view;
    const s = this.series;
    const i = Math.round(v.iOf(x));
    let p = v.pOf(y);
    if (magnet && i >= 0 && i < s.length) {
      const b = s.bars[i];
      let best = null;
      for (const q of [b.o, b.h, b.l, b.c]) {
        const d = Math.abs(v.yOf(q) - y);
        if (d < 30 && (!best || d < best.d)) best = { q, d };
      }
      if (best) p = best.q;
    }
    return { t: s.timeAt(i), p: Number(p.toFixed(this.digits)) };
  }

  // ---- painting -------------------------------------------------------------------------------

  render() {
    const t0 = performance.now();
    this.dirty = false;
    const g = this.g;
    const st = this.style;
    const v = this.view;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.paintBackground();
    const s = this.series;
    if (!s || !s.length) {
      this.paintMessage(this.message || 'Waiting for MetaTrader 5...');
      this.onFrame(performance.now() - t0, 0);
      return;
    }
    v.limit(s.length);
    const [i0, i1] = v.visible();
    if (v.auto) {
      const r = s.range(i0, i1);
      if (r) v.fit(r.lo, r.hi, st.margins.top / 100, st.margins.bottom / 100);
    }
    const ticks = priceTicks(v.top, v.bottom, v.h, 34);
    const labels = timeLabels(this.times, i0, i1, this.tf, v.barW);
    const c = this.context();

    g.save();
    g.beginPath();
    g.rect(0, 0, v.w, v.h);
    g.clip();
    this.paintGrid(ticks, labels);
    if (st.watermark.show) this.paintWatermark();
    this.paintBars(i0, i1);
    this.paintPriceLines();
    this.drawings.draw(c);
    for (const L of this.layers) L.draw(c);
    this.paintCrosshair();
    g.restore();

    this.paintPriceAxis(ticks, c.priceTags);
    this.paintTimeAxis(labels, c.timeTags);
    if (i0 < 30 && !s.done) this.onNeedHistory();
    const took = performance.now() - t0;
    const sinceData = this.lastData ? performance.now() - this.lastData : 0;
    this.lastData = 0;
    this.onFrame(took, sinceData);
  }

  paintBackground() {
    const g = this.g;
    const b = this.style.background;
    if (b.gradient) {
      const grad = g.createLinearGradient(0, 0, 0, this.H);
      grad.addColorStop(0, b.top);
      grad.addColorStop(1, b.color);
      g.fillStyle = grad;
    } else g.fillStyle = b.color;
    g.fillRect(0, 0, this.W, this.H);
  }

  paintMessage(text) {
    const g = this.g;
    g.fillStyle = this.style.scales.text;
    g.font = '14px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    String(text).split('\n').forEach((line, k, all) => g.fillText(line, this.W / 2, this.H / 2 + (k - (all.length - 1) / 2) * 22));
    g.textAlign = 'left';
  }

  paintGrid(ticks, labels) {
    const g = this.g;
    const v = this.view;
    const grid = this.style.grid;
    if (!grid.vert && !grid.horz) return;
    g.strokeStyle = grid.color;
    g.lineWidth = this.hair;
    g.setLineDash([]);
    g.beginPath();
    if (grid.horz) for (const p of ticks) {
      const y = this.mid(v.yOf(p));
      g.moveTo(0, y);
      g.lineTo(v.w, y);
    }
    if (grid.vert) for (const l of labels) {
      const x = this.mid(v.xOf(l.i));
      g.moveTo(x, 0);
      g.lineTo(x, v.h);
    }
    g.stroke();
  }

  paintWatermark() {
    const g = this.g;
    const v = this.view;
    g.fillStyle = this.style.watermark.color;
    g.font = '700 ' + Math.round(Math.min(96, v.w / 8)) + 'px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(this.symbol + ', ' + this.tf, v.w / 2, v.h / 2);
    g.textAlign = 'left';
  }

  paintBars(i0, i1) {
    const g = this.g;
    const v = this.view;
    const s = this.series;
    const st = this.style;
    const type = st.chartType;
    const a = Math.max(0, i0);
    const b = Math.min(s.length - 1, i1);
    if (b < a) return;
    if (type === 'line' || type === 'area') {
      g.beginPath();
      for (let i = a; i <= b; i++) {
        const x = v.xOf(i);
        const y = v.yOf(s.bars[i].c);
        if (i === a) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.setLineDash([]);
      g.lineWidth = st.line.width;
      g.strokeStyle = st.line.color;
      g.lineJoin = 'round';
      g.stroke();
      if (type === 'area') {
        g.lineTo(v.xOf(b), v.h);
        g.lineTo(v.xOf(a), v.h);
        g.closePath();
        const grad = g.createLinearGradient(0, 0, 0, v.h);
        grad.addColorStop(0, withAlpha(st.line.color, 0.35));
        grad.addColorStop(1, withAlpha(st.line.color, 0.02));
        g.fillStyle = grad;
        g.fill();
      }
      return;
    }
    // Candles are drawn in the screen's own pixels: every edge on a pixel, every body an odd number
    // of pixels wide around a one-pixel wick.
    const cs = st.candles;
    const d = this.dpr;
    let bodyW = Math.max(1, Math.floor(v.barW * 0.72 * d));
    if (bodyW % 2 === 0) bodyW -= 1;
    const half = (bodyW - 1) / 2;
    const wick = Math.max(1, Math.floor(d));
    const wl = Math.floor((wick - 1) / 2);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.setLineDash([]);
    g.lineWidth = 1;
    for (let i = a; i <= b; i++) {
      const bar = s.bars[i];
      const up = bar.c >= bar.o;
      const x = Math.round(v.xOf(i) * d);
      const yo = Math.round(v.yOf(bar.o) * d);
      const yc = Math.round(v.yOf(bar.c) * d);
      const yh = Math.round(v.yOf(bar.h) * d);
      const yl = Math.round(v.yOf(bar.l) * d);
      if (type === 'bars') {
        g.fillStyle = up ? cs.upBody : cs.downBody;
        g.fillRect(x - wl, yh, wick, Math.max(1, yl - yh + 1));
        g.fillRect(x - half, yo, half + 1, wick);
        g.fillRect(x, yc, half + 1, wick);
        continue;
      }
      if (cs.wick) {
        g.fillStyle = up ? cs.upWick : cs.downWick;
        g.fillRect(x - wl, yh, wick, Math.max(1, yl - yh + 1));
      }
      const top = Math.min(yo, yc);
      const h = Math.max(1, Math.max(yo, yc) - top);
      const hollow = type === 'hollow' && up;
      if (cs.body && !hollow) {
        g.fillStyle = up ? cs.upBody : cs.downBody;
        g.fillRect(x - half, top, bodyW, h);
      }
      if ((cs.border || hollow) && bodyW > 2) {
        g.strokeStyle = up ? (hollow ? cs.upBody : cs.upBorder) : cs.downBorder;
        g.strokeRect(x - half + 0.5, top + 0.5, bodyW - 1, Math.max(0, h - 1));
      }
    }
    g.restore();
  }

  lastPriceColor() {
    const s = this.series;
    const pl = this.style.priceLine;
    if (pl.color) return pl.color;
    const last = s.last;
    return last.c >= last.o ? this.style.candles.upBody : this.style.candles.downBody;
  }

  paintPriceLines() {
    const g = this.g;
    const v = this.view;
    const pl = this.style.priceLine;
    if (pl.show) {
      const y = this.mid(v.yOf(this.series.last.c));
      g.strokeStyle = this.lastPriceColor();
      g.lineWidth = this.hair;
      g.setLineDash([1, 2]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(v.w, y);
      g.stroke();
    }
    if (pl.bidAsk && Number.isFinite(this.ask)) {
      const y = this.mid(v.yOf(this.ask));
      g.strokeStyle = '#f23645';
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(v.w, y);
      g.stroke();
    }
    g.setLineDash([]);
  }

  paintCrosshair() {
    const m = this.mouse;
    if (!m || m.area !== 'plot' || this.mode === 'pan') return;
    const g = this.g;
    const v = this.view;
    const ch = this.style.crosshair;
    const i = Math.round(v.iOf(m.x));
    const x = this.mid(v.xOf(i));
    const y = this.mid(m.y);
    g.strokeStyle = ch.color;
    g.lineWidth = Math.max(1, Math.round(ch.width * this.dpr)) / this.dpr;
    g.setLineDash(dash(ch.style, 1));
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(v.w, y);
    g.moveTo(x, 0);
    g.lineTo(x, v.h);
    g.stroke();
    g.setLineDash([]);
  }

  tag(y, text, bg, fg, sub) {
    const g = this.g;
    const v = this.view;
    const fs = this.style.scales.fontSize;
    const h = sub ? fs * 2 + 10 : fs + 8;
    const top = Math.round(sub ? y - (fs + 8) / 2 : y - h / 2);
    if (y < -h || y > v.h + h) return;
    g.fillStyle = bg;
    g.beginPath();
    if (g.roundRect) g.roundRect(v.w + 1, top, this.axisW - 2, h, 3);
    else g.rect(v.w + 1, top, this.axisW - 2, h);
    g.fill();
    g.fillStyle = fg || textOn(bg);
    g.font = fs + 'px ' + FONT;
    g.textBaseline = 'middle';
    g.fillText(text, v.w + 8, top + (fs + 8) / 2 + 0.5);
    if (sub) g.fillText(sub, v.w + 8, top + (fs + 8) / 2 + fs + 2.5);
  }

  paintPriceAxis(ticks, tags) {
    const g = this.g;
    const v = this.view;
    const st = this.style;
    g.fillStyle = st.background.color;
    g.fillRect(v.w, 0, this.axisW, this.H);
    g.strokeStyle = st.scales.line;
    g.lineWidth = this.hair;
    g.beginPath();
    g.moveTo(this.mid(v.w), 0);
    g.lineTo(this.mid(v.w), v.h);
    g.stroke();
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const digits = stepDigits(step, this.digits);
    g.font = st.scales.fontSize + 'px ' + FONT;
    g.fillStyle = st.scales.text;
    g.textBaseline = 'middle';
    for (const p of ticks) {
      const y = v.yOf(p);
      if (y < 8 || y > v.h - 8) continue;
      g.fillText(p.toFixed(digits), v.w + 8, y);
    }
    for (const t of tags) this.tag(t.y, t.text, t.bg, t.fg);
    const s = this.series;
    if (st.priceLine.bidAsk && Number.isFinite(this.ask)) this.tag(v.yOf(this.ask), formatPrice(this.ask, this.digits), '#f23645');
    if (st.priceLine.show) {
      const sub = st.priceLine.countdown ? countdown(s.secondsLeft(this.serverNow)) : null;
      this.tag(v.yOf(s.last.c), formatPrice(s.last.c, this.digits), this.lastPriceColor(), null, sub);
    }
    const m = this.mouse;
    if (m && m.area === 'plot' && this.mode !== 'pan') this.tag(m.y, formatPrice(v.pOf(m.y), this.digits), '#363a45', '#ffffff');
  }

  paintTimeAxis(labels, tags) {
    const g = this.g;
    const v = this.view;
    const st = this.style;
    g.fillStyle = st.background.color;
    g.fillRect(0, v.h, this.W, TIME_H);
    g.strokeStyle = st.scales.line;
    g.lineWidth = this.hair;
    g.beginPath();
    g.moveTo(0, this.mid(v.h));
    g.lineTo(v.w, this.mid(v.h));
    g.stroke();
    g.font = st.scales.fontSize + 'px ' + FONT;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    for (const l of labels) {
      const x = v.xOf(l.i);
      if (x < 20 || x > v.w - 20) continue;
      g.fillStyle = st.scales.text;
      g.font = (l.major ? '700 ' : '') + st.scales.fontSize + 'px ' + FONT;
      g.fillText(l.text, x, v.h + TIME_H / 2);
    }
    const timeTag = (x, text, bg) => {
      g.font = st.scales.fontSize + 'px ' + FONT;
      const w = g.measureText(text).width + 14;
      const left = clamp(x - w / 2, 0, v.w - w);
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(left, v.h + 4, w, TIME_H - 8, 3);
      else g.rect(left, v.h + 4, w, TIME_H - 8);
      g.fill();
      g.fillStyle = textOn(bg);
      g.fillText(text, left + w / 2, v.h + TIME_H / 2);
    };
    for (const t of tags) timeTag(t.x, crosshairTime(t.t, this.tf), t.bg);
    const m = this.mouse;
    if (m && m.area === 'plot' && this.mode !== 'pan') {
      const i = Math.round(v.iOf(m.x));
      timeTag(v.xOf(i), crosshairTime(this.series.timeAt(i), this.tf), '#363a45');
    }
    g.textAlign = 'left';
  }

  // ---- the mouse ------------------------------------------------------------------------------

  areaAt(x, y) {
    if (x >= this.view.w) return y < this.view.h ? 'price' : 'corner';
    return y >= this.view.h ? 'time' : 'plot';
  }

  bindMouse() {
    const cv = this.canvas;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!this.series || !this.series.length) return;
      const { x, y } = pos(e);
      const area = this.areaAt(x, y);
      if (e.button === 2) return;
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      cv.setPointerCapture(e.pointerId);
      const v = this.view;
      this.press = { x, y, right: v.right, top: v.top, bottom: v.bottom, barW: v.barW, auto: v.auto };
      if (area === 'plot') {
        const ctx = this.context();
        this.layer = this.drawings.tool || this.drawings.pending ? null : this.layers.find((L) => L.down(ctx, x, y)) || null;
        if (this.layer) this.mode = 'layer';
        else if (this.drawings.down(ctx, x, y)) this.mode = 'draw';
        else this.mode = 'pan';
      } else if (area === 'price') this.mode = 'scaleP';
      else if (area === 'time') this.mode = 'scaleT';
      this.dirty = true;
    });
    cv.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e);
      this.mouse = { x, y, area: this.areaAt(x, y) };
      const v = this.view;
      const p = this.press;
      if (this.mode === 'layer') this.layer.move(this.context(), x, y);
      else if (this.mode === 'draw' || (!this.mode && this.drawings.pending)) {
        this.drawings.move(this.context(), x, y);
        if (!this.mode) cv.style.cursor = 'crosshair';
      } else if (this.mode === 'pan') {
        v.right = p.right - (x - p.x) / v.barW;
        if (Math.abs(y - p.y) > 6 || !v.auto) {
          // Free movement: dragging up or down moves the prices too, and ends auto scale.
          if (v.auto) {
            v.auto = false;
            p.top = v.top;
            p.bottom = v.bottom;
            p.y = y;
          }
          const d = ((y - p.y) / v.h) * (p.top - p.bottom);
          v.top = p.top + d;
          v.bottom = p.bottom + d;
        }
        this.onViewChange();
      } else if (this.mode === 'scaleP') {
        const f = Math.exp((y - p.y) / 150);
        const mid = (p.top + p.bottom) / 2;
        v.top = mid + ((p.top - p.bottom) / 2) * f;
        v.bottom = mid - ((p.top - p.bottom) / 2) * f;
        v.auto = false;
        this.onViewChange();
      } else if (this.mode === 'scaleT') {
        const f = Math.exp((x - p.x) / 200);
        const keep = v.w;
        const i = p.right;
        v.barW = clamp(p.barW * f, 1, 80);
        v.right = i + (v.w - keep) / v.barW;
        this.onViewChange();
      } else if (this.series && this.series.length && this.mouse.area === 'plot') {
        const ctx = this.context();
        let cur = '';
        if (!this.drawings.tool) for (const L of this.layers) if ((cur = L.cursorAt(ctx, x, y))) break;
        cv.style.cursor = cur || this.drawings.cursorAt(ctx, x, y) || 'crosshair';
      } else cv.style.cursor = this.mouse.area === 'price' ? 'ns-resize' : this.mouse.area === 'time' ? 'ew-resize' : 'default';
      if (this.mouse.area === 'plot' && this.series && this.series.length) this.onHover(Math.round(v.iOf(x)));
      this.dirty = true;
    });
    const end = (e) => {
      if (!this.mode) return;
      const { x, y } = pos(e);
      if (this.mode === 'draw') this.drawings.up(this.context(), x, y);
      if (this.mode === 'layer' && this.layer) this.layer.up(this.context(), x, y);
      this.layer = null;
      this.mode = null;
      this.press = null;
      this.dirty = true;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      if (!this.mode) {
        this.mouse = null;
        this.onHover(null);
        this.dirty = true;
      }
    });
    cv.addEventListener('wheel', (e) => {
      if (!this.series || !this.series.length) return;
      e.preventDefault();
      const { x, y } = pos(e);
      const area = this.areaAt(x, y);
      const f = Math.pow(1.0015, -e.deltaY);
      if (area === 'price') this.view.scalePrice(1 / f, y);
      else this.view.zoomAt(f, Math.min(x, this.view.w));
      this.onViewChange();
      this.dirty = true;
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      if (!this.series || !this.series.length) return;
      const { x, y } = pos(e);
      const area = this.areaAt(x, y);
      if (area === 'price') this.view.auto = true;
      else if (area === 'time') this.resetTime();
      else {
        const hit = this.drawings.dblclick(this.context(), x, y);
        if (hit && hit !== true) this.onOpenSettings(hit);
      }
      this.dirty = true;
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.series || !this.series.length) return;
      const { x, y } = pos(e);
      if (this.drawings.cancel()) {
        this.dirty = true;
        return;
      }
      const it = this.areaAt(x, y) === 'plot' ? this.drawings.hitItem(this.context(), x, y) : null;
      if (it) this.drawings.select(it.id);
      this.onContextMenu(it, e.clientX, e.clientY);
      this.dirty = true;
    });
  }

  resetTime() {
    const v = this.view;
    v.barW = 6;
    v.right = this.series.length - 1 + Math.round(v.w / v.barW * 0.08);
    v.auto = true;
    this.onViewChange();
    this.dirty = true;
  }

  scrollBy(bars) {
    this.view.right += bars;
    this.dirty = true;
  }

  zoom(factor) {
    this.view.zoomAt(factor, this.view.w);
    this.dirty = true;
  }

  get atEnd() {
    return !this.series || this.view.right >= this.series.length - 1;
  }
}

// "3d 4h", "2h 15m", "45m".
export function duration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (d > 0) return d + 'd' + (h ? ' ' + h + 'h' : '');
  if (h > 0) return h + 'h' + (m ? ' ' + m + 'm' : '');
  return m + 'm';
}

export { tfSeconds };
