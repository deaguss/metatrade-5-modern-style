// The ticket's lines on the chart: the order being previewed (entry, stop loss, take profit, with
// the money at each, dragged to change them) and the open trades of the chart's symbol (dragged to
// open a change card, x to close or remove). Drawn after the drawings, hit before them.
import { formatPrice, textOn } from './util.js';
import { tradesOf, pipsText } from './ticketcore.js';

const COL = { tp: '#089981', sl: '#f23645', entry: '#787b86', buy: '#2962ff', sell: '#f23645', chip: '#161616', edge: '#4a4a4a' };
const FONT = '12px "Trebuchet MS", Arial, sans-serif';

export class TradeLayer {
  // where: the chart pane it draws on, {symbol(), offset()}: its symbol's trades show there, the
  // ticket's preview only where the symbol is the ticket's, and offset() is where the pane is in
  // the area the ticket floats over. Without it: the ticket's symbol, at no offset.
  constructor(ticket, where) {
    this.t = ticket;
    this.where = where || { symbol: () => ticket.symbol, offset: () => ({ x: 0, y: 0 }) };
    this.hits = [];     // chips' buttons from the last frame: {x, y, w, h, fn}
    this.lines = [];    // draggable lines from the last frame: {y, kind, which, trade}
    this.drag = null;
    this.placed = [];
    this.entries = [];
    this.pinned = 0;    // the trade shown in full after a click on its label, until clicked again
  }

  // A row of chips ending at xr, centred on y; returns each chip's rectangle.
  chips(g, xr, y, parts) {
    g.font = FONT;
    g.textBaseline = 'middle';
    g.setLineDash([]);
    const h = 20;
    const rects = [];
    let x = xr;
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      const w = Math.ceil(g.measureText(p.t).width) + 14;
      x -= w;
      const top = Math.round(y - h / 2);
      g.fillStyle = p.bg;
      g.fillRect(x, top, w, h);
      if (p.bd) {
        g.strokeStyle = p.bd;
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      }
      g.fillStyle = p.fg || textOn(p.bg);
      g.fillText(p.t, x + 7, y + 0.5);
      rects[k] = { x, y: top, w, h };
    }
    return rects;
  }

  // The width of a row of chips.
  width(g, parts) {
    g.font = FONT;
    return parts.reduce((w, p) => w + Math.ceil(g.measureText(p.t).width) + 14, 0);
  }

  // Draws a row of chips ending at xr, unless the ticket covers that spot: then left of the ticket,
  // or right of it when there is no room on its left. Returns each chip's rectangle.
  row(c, xr, y, parts) {
    const t = this.t.rect ? this.t.rect() : null;
    const off = this.where.offset();
    const r = t ? { x: t.x - off.x, y: t.y - off.y, w: t.w, h: t.h } : null;
    const w = this.width(c.g, parts);
    let x = xr;
    if (r && xr > r.x - 4 && xr - w < r.x + r.w + 4 && y >= r.y - 12 && y <= r.y + r.h + 12) {
      x = r.x - 8 - w >= 2 ? Math.min(xr, r.x - 8) : Math.min(c.w - 2, r.x + r.w + 8 + w);
    }
    // Two rows at nearly the same price (two trades opened close together) would hide each other:
    // the later one goes to the left of the one already there.
    for (let k = 0; k < 6; k++) {
      const hit = this.placed.find((p) => Math.abs(p.y - y) < 20 && x > p.x - 4 && x - w < p.x + p.w + 4);
      if (!hit) break;
      x = hit.x - 6;
    }
    this.placed.push({ x: x - w, y, w });
    return this.chips(c.g, x, y, parts);
  }

  level(c, price, color, dashed) {
    const g = c.g;
    const y = c.y(price);
    const yy = c.mid ? c.mid(y) : Math.round(y) + 0.5;
    g.strokeStyle = color;
    g.lineWidth = c.hair || 1;
    g.setLineDash(dashed ? [6, 4] : []);
    g.beginPath();
    g.moveTo(0, yy);
    g.lineTo(c.w, yy);
    g.stroke();
    g.setLineDash([]);
    return y;
  }

  draw(c) {
    // Open positions show in full. A pending order shows its entry line only, faint, until the mouse
    // is on it (or its label was clicked): then its label, stop and target show too.
    let hover = 0;
    if (c.mouse) {
      const chip = this.hitChip(c.mouse.x, c.mouse.y);
      const line = chip ? null : this.hitLine(c.mouse.y) || this.hitNear(this.entries, c.mouse.y);
      const t = (chip && chip.trade) || (line && line.trade);
      hover = t ? t.ticket : 0;
    }
    this.hits = [];
    this.lines = [];
    this.placed = [];   // the rows of chips drawn so far this frame
    this.entries = [];  // every trade's entry line: the mouse on one shows that trade in full
    const g = c.g;
    const fmt = (p) => formatPrice(p, c.digits);
    const cash = (v) => this.t.cash(v);
    g.save();
    // the open trades of this symbol
    const pc = this.t.pendingChange();
    const X = Math.round(c.w * 0.62);
    const symbol = this.where.symbol();
    const full = (tr) => tr.position || tr.ticket === hover || tr.ticket === this.pinned || !!(pc && pc.ticket === tr.ticket);
    const trades = tradesOf(this.t.trades, symbol).sort((a, b) => full(a) - full(b));   // the one in full on top
    for (const tr of trades) {
      const shown = full(tr);
      const lvl = (which) => (pc && pc.ticket === tr.ticket && pc.which === which ? pc.price : which === 'open' ? tr.open : tr[which]);
      const moved = (which) => pc && pc.ticket === tr.ticket && pc.which === which;
      g.globalAlpha = shown ? 1 : 0.45;
      const ye = this.level(c, lvl('open'), tr.position ? COL.entry : COL.buy, true);
      g.globalAlpha = 1;
      this.entries.push({ y: ye, trade: tr });
      const sideBg = tr.side > 0 ? COL.buy : COL.sell;
      const parts = [{ t: tr.type + ' ' + Number(tr.lots).toFixed(this.t.lotDigits), bg: sideBg }];
      parts.push(tr.position ? { t: cash(tr.profit), fg: tr.profit >= 0 ? '#22ab94' : '#ff6b76', bg: COL.chip, bd: COL.edge } : { t: 'pending', fg: '#b2b5be', bg: COL.chip, bd: COL.edge });
      parts.push({ t: 'x', fg: '#b2b5be', bg: COL.chip, bd: COL.edge });
      if (!tr.position && !tr.locked) this.lines.push({ y: ye, kind: 'trade', which: 'open', trade: tr });
      if (!shown) continue;   // a pending order out of focus: its faint line only
      c.priceTags.push({ y: ye, text: fmt(lvl('open')), bg: tr.position ? COL.entry : COL.buy });
      for (const which of ['sl', 'tp']) {
        const p = lvl(which);
        if (!(p > 0)) continue;
        const color = which === 'sl' ? COL.sl : COL.tp;
        const y = this.level(c, p, color, true);
        c.priceTags.push({ y, text: fmt(p), bg: color });
        if (!tr.locked) this.lines.push({ y, kind: 'trade', which, trade: tr });
        // the money there from MT5; the price while the line is being changed (the card has the money)
        const m = tr[which + 'Money'];
        const money = Number.isFinite(m) && !moved(which) && !moved('open');
        const up = money ? m >= 0 : which === 'tp';
        this.row(c, X, y, [{ t: which.toUpperCase(), bg: color }, { t: money ? cash(m) : fmt(p), fg: up ? '#22ab94' : '#ff6b76', bg: COL.chip, bd: color }]);
      }
      // the entry's chips last: over the stop's and target's when the lines are close, x on top
      const r = this.row(c, X, ye, parts);
      const x = r[r.length - 1];
      this.hits.push({ ...x, trade: tr, fn: () => (tr.position ? this.t.openClose(tr) : this.t.cancelOrder(tr)) });
      // a click on the label keeps the trade in full (its stop and target labels), again to let go
      const body = r[r.length - 2];
      this.hits.push({ x: r[0].x, y: r[0].y, w: body.x + body.w - r[0].x, h: r[0].h, trade: tr, fn: () => {
        this.pinned = this.pinned === tr.ticket ? 0 : tr.ticket;
      } });
    }
    // the order being previewed
    const pv = symbol === this.t.symbol ? this.t.previewLines() : null;
    if (pv) {
      const plan = pv.plan;
      const X = c.w - 10;
      const dot = '  \u00b7  ';
      g.globalAlpha = pv.stale ? 0.6 : 1;
      if (pv.tp > 0) {
        const y = this.level(c, pv.tp, COL.tp, false);
        this.row(c, X, y, [{ t: 'TP', bg: COL.tp }, { t: cash(plan.rewardMoney) + dot + pipsText(plan.tpPips || 0) + ' pips', fg: '#22ab94', bg: COL.chip, bd: COL.tp }]);
        c.priceTags.push({ y, text: fmt(pv.tp), bg: COL.tp });
        this.lines.push({ y, kind: 'preview', which: 'tp' });
      }
      if (pv.sl > 0) {
        const y = this.level(c, pv.sl, COL.sl, false);
        this.row(c, X, y, [{ t: 'SL', bg: COL.sl }, { t: cash(-plan.riskMoney) + dot + pipsText(plan.slPips || 0) + ' pips', fg: '#ff6b76', bg: COL.chip, bd: COL.sl }]);
        c.priceTags.push({ y, text: fmt(pv.sl), bg: COL.sl });
        this.lines.push({ y, kind: 'preview', which: 'sl' });
      }
      const y = this.level(c, pv.entry, COL.entry, false);
      const lots = plan.lots > 0 ? plan.lots.toFixed(this.t.lotDigits) + ' lots @ ' : '';
      this.row(c, X, y, [{ t: plan.type || (pv.side > 0 ? 'BUY' : 'SELL'), bg: pv.side > 0 ? COL.buy : COL.sell }, { t: lots + fmt(pv.entry), fg: '#d1d4dc', bg: COL.chip, bd: COL.edge }]);
      c.priceTags.push({ y, text: fmt(pv.entry), bg: COL.entry });
      this.lines.push({ y, kind: 'preview', which: 'entry' });
      g.globalAlpha = 1;
    }
    // a line being dragged follows the mouse
    if (this.drag && this.drag.price > 0) this.level(c, this.drag.price, '#d1d4dc', false);
    g.restore();
  }

  hitChip(x, y) {
    return this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) || null;
  }

  hitLine(y) {
    return this.hitNear(this.lines, y);
  }

  hitNear(lines, y) {
    let best = null;
    for (const l of lines || []) {
      const d = Math.abs(l.y - y);
      if (d <= 5 && (!best || d < best.d)) best = { ...l, d };
    }
    return best;
  }

  cursorAt(c, x, y) {
    if (this.hitChip(x, y)) return 'pointer';
    if (this.hitLine(y)) return 'ns-resize';
    return '';
  }

  // A press: true when the ticket's lines take it.
  down(c, x, y) {
    const chip = this.hitChip(x, y);
    if (chip) {
      chip.fn();
      return true;
    }
    const line = this.hitLine(y);
    if (!line) return false;
    this.drag = { ...line, price: 0, moved: false, y0: y };
    return true;
  }

  move(c, x, y) {
    if (!this.drag) return;
    if (Math.abs(y - this.drag.y0) > 2) this.drag.moved = true;
    this.drag.price = Number(c.toPoint(x, y, false).p.toFixed(c.digits));
    if (this.drag.kind === 'preview' && this.drag.moved) this.t.setLevel(this.drag.which, this.drag.price);
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.moved || !(d.price > 0)) return;
    if (d.kind === 'trade') this.t.openChange(d.trade, d.which, d.price);
  }
}
