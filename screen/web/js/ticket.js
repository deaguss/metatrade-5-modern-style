// The order ticket on InnaChart, laid out as the prototype's floating ticket (variant A): a panel
// that asks the ActionInna EA in MT5 for a preview of the order (lots from the risk, the stop and
// target, the money at each), shows it on the chart, and sends it only when the trader presses
// Confirm on a fresh preview. Open trades are changed and closed through cards that do the same: a
// preview from MT5, then Confirm.
import { el, esc, dragBy, toast, confirmBox } from './ui.js';
import { icon } from './icons.js';
import { formatPrice, clamp, debounce } from './util.js';
import { tfLabel } from './timeframes.js';
import { defaultForm, previewRequest, confirmState, FRESH_MS, TYPE_HOLD_MS, stepLevel, stepRisk, pendingEntry, money, nextUnit, pipsText, slipText } from './ticketcore.js';

const ACCOUNT_WORD = { demo: 'DEMO', real: 'REAL', contest: 'CONTEST' };
const MODE_LABEL = { pips: 'pips', price: 'price', r: 'R', percent: '%', money: '$', lots: 'lot' };

// A field with - and + inside its box, as the prototype draws it.
const field = (k) => '<div class="tk-fld" data-k="' + k + '"><button type="button" class="tk-st" data-k="' + k + '" data-d="-1" tabindex="-1">-</button>' +
  '<input class="tk-in" data-k="' + k + '" inputmode="decimal" autocomplete="off" spellcheck="false"><button type="button" class="tk-st" data-k="' + k + '" data-d="1" tabindex="-1">+</button></div>';
const sideBtn = (sd, cls) => '<button type="button" class="tk-side ' + (sd > 0 ? 'buy' : 'sell') + (cls ? ' ' + cls : '') + '" data-side="' + sd + '"><span class="lbl">' +
  (sd > 0 ? 'BUY' : 'SELL') + '</span><span class="px">-</span></button>';

export class Ticket {
  // opts: feed, chart, layout (the saved layout: the ticket's place and fold), save(), onShow(on)
  constructor(wrap, opts) {
    this.wrap = wrap;
    this.o = opts;
    this.feed = opts.feed;
    this.linked = false;
    this.term = null;          // the EA's "terminal" message
    this.trades = null;        // the EA's "trades" message
    this.spec = null;          // the symbol's specification from the EA (pip size, lot step)
    this.symbol = '';
    this.desc = '';
    this.bid = NaN;
    this.ask = NaN;
    this.side = 0;
    this.form = defaultForm(null);
    this.preview = null;       // {pid, plan, at, side, symbol}
    this.lastPlan = null;      // {symbol, plan}: the last valid preview, for the risk's unit button
    this.inFlight = false;
    this.again = false;
    this.sending = false;
    this.flash = null;         // {text, level, until}: the last send's result
    this.holdUntil = 0;        // Confirm waits until then after the order's type changed
    this.recallIndex = { sl: -1, tp: -1 };
    this.card = null;          // the open change or close card
    this.build();
    this.schedule = debounce(() => this.requestPreview(), 120);
    setInterval(() => {
      if (this.side) this.requestPreview();   // keeps the preview fresh with the market
      this.paintConfirm();
      this.paintStatus();
    }, 1000);
  }

  get active() {
    return this.side !== 0;
  }

  // ---- the panel --------------------------------------------------------------------------------

  build() {
    const tk = el('div', 'tk');
    this.el = tk;
    tk.innerHTML =
      '<div class="tk-head" title="Drag to move it; double-click to dock it at the right">' +
      '<span class="tk-grip">' + icon('grip', 14) + '</span><span class="tk-sym"></span><span class="tk-sub"></span><span class="grow"></span><span class="tk-acct"></span>' +
      '<button type="button" class="icon-btn tk-dock" title="Dock at the right edge, or float"></button>' +
      '<button type="button" class="icon-btn tk-fold" title="Fold or unfold"></button>' +
      '<button type="button" class="icon-btn tk-close" title="Hide the ticket (the Trade button shows it again)">' + icon('close', 16) + '</button></div>' +
      '<div class="tk-mini">' + sideBtn(-1, 'sm') + '<span class="tk-mini-mid"><b class="tk-mini-risk"></b><span class="tk-mini-lots"></span></span>' + sideBtn(1, 'sm') + '</div>' +
      '<div class="tk-body">' +
      '<div class="tk-sides">' + sideBtn(-1) + sideBtn(1) + '<span class="tk-spread" title="Spread (pips)">-</span></div>' +
      '<div class="tk-seg"><button type="button" data-v="market">Market</button><button type="button" data-v="pending">Limit / Stop</button></div>' +
      '<div class="tk-row tk-entry-row"><label>Entry</label>' + field('entry') + '</div>' +
      '<div class="tk-row"><label>Risk<button type="button" class="tk-base" title="What the risk % counts from: the equity or the balance (press to switch)"></button></label><div class="tk-chips"><span class="tk-presets"></span><div class="tk-fld tk-custom" data-k="risk">' +
      '<input class="tk-in" data-k="risk" inputmode="decimal" autocomplete="off" spellcheck="false"><button type="button" class="tk-cu" title="Unit: % / lot / $"></button></div></div></div>' +
      '<div class="tk-row"><label>Stop loss</label><div class="tk-fline">' + field('sl') + '<button type="button" class="tk-unit" data-k="sl" title="Change the unit"></button>' +
      '<button type="button" class="tk-last" data-k="sl" title="The stop loss used before on this symbol (press again for older ones)">Last</button></div></div>' +
      '<div class="tk-row"><label>Take profit</label><div class="tk-fline">' + field('tp') + '<button type="button" class="tk-unit" data-k="tp" title="Change the unit"></button>' +
      '<button type="button" class="tk-last" data-k="tp" title="The take profit used before on this symbol (press again for older ones)">Last</button></div></div>' +
      '<div class="tk-sum"><div class="tk-lotsline"><span class="k">Lots</span><span><b class="big tk-lots">-</b> <span class="k tk-units"></span></span></div>' +
      '<div class="tk-tiles"><div><span class="k">Risk</span><b class="neg tk-risk">-</b><span class="k tk-riskp"></span></div>' +
      '<div><span class="k">Reward</span><b class="pos tk-reward">-</b><span class="k tk-rewardp"></span></div>' +
      '<div><span class="k">R : R</span><b class="tk-rr">-</b><span class="k tk-dist"></span></div></div>' +
      '<div class="tk-meta"><span>Pip value <b class="tk-pipv">-</b></span><span>Margin <b class="tk-margin">-</b> <span class="tk-free"></span></span></div></div>' +
      '<div class="tk-confirm-row"><button type="button" class="tk-cbtn"></button><button type="button" class="tk-xbtn" title="Cancel (Esc)">' + icon('close', 16) + '</button></div>' +
      '<div class="tk-status"></div>' +
      '</div>';
    this.wrap.appendChild(tk);
    const q = (s) => tk.querySelector(s);
    this.$ = {
      sym: q('.tk-sym'), sub: q('.tk-sub'), acct: q('.tk-acct'), dock: q('.tk-dock'), fold: q('.tk-fold'), spread: q('.tk-spread'),
      miniRisk: q('.tk-mini-risk'), miniLots: q('.tk-mini-lots'), seg: q('.tk-seg'), entryRow: q('.tk-entry-row'), presets: q('.tk-presets'),
      custom: q('.tk-custom'), cu: q('.tk-cu'), lots: q('.tk-lots'), units: q('.tk-units'), risk: q('.tk-risk'), riskp: q('.tk-riskp'),
      reward: q('.tk-reward'), rewardp: q('.tk-rewardp'), rr: q('.tk-rr'), dist: q('.tk-dist'), pipv: q('.tk-pipv'), margin: q('.tk-margin'),
      free: q('.tk-free'), cbtn: q('.tk-cbtn'), xbtn: q('.tk-xbtn'), status: q('.tk-status'),
    };
    const head = q('.tk-head');
    dragBy(head, tk, (box) => {
      this.o.layout.ticketPos = { x: box.offsetLeft, y: box.offsetTop };
      this.o.layout.ticketDocked = false;
      this.o.save();
    });
    head.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) this.toggleDock();
    });
    this.$.dock.addEventListener('click', () => this.toggleDock());
    tk.querySelectorAll('.tk-side').forEach((b) => b.addEventListener('click', () => this.choose(Number(b.dataset.side))));
    this.$.xbtn.addEventListener('click', () => this.cancel());
    this.$.cbtn.addEventListener('click', () => this.confirm());
    this.$.fold.addEventListener('click', () => {
      this.o.layout.ticketOpen = !this.o.layout.ticketOpen;
      if (!this.o.layout.ticketOpen) this.cancel();
      this.o.save();
      this.paint();
    });
    q('.tk-close').addEventListener('click', () => this.show(false));
    this.$.seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.form.pending = b.dataset.v === 'pending';
      if (this.form.pending && (!this.form.entry || this.entryAuto)) this.placeEntry(this.side || 1);
      this.changed();
    });
    tk.querySelectorAll('.tk-in').forEach((input) => input.addEventListener('change', () => {
      const v = Number(String(input.value).trim().replace(',', '.'));
      if (Number.isFinite(v) && v > 0) {
        const k = input.dataset.k;
        if (k === 'entry') [this.form.entry, this.entryAuto] = [v, false];
        else if (k === 'risk') this.form.riskValue = v;
        else if (k === 'sl') this.form.slValue = v;
        else this.form.tpValue = v;
      }
      this.changed();
    }));
    tk.querySelectorAll('.tk-st').forEach((b) => b.addEventListener('click', () => this.step(b.dataset.k, Number(b.dataset.d))));
    tk.querySelectorAll('.tk-unit').forEach((b) => b.addEventListener('click', () => this.cycleMode(b.dataset.k)));
    this.$.cu.addEventListener('click', () => this.cycleMode('risk'));
    this.$.base = tk.querySelector('.tk-base');
    this.$.base.addEventListener('click', () => this.toggleRiskBase());
    tk.querySelectorAll('.tk-last').forEach((b) => b.addEventListener('click', () => this.recall(b.dataset.k)));
    this.applyLayout();
  }

  // Shows the ticket as the saved layout says (nothing is saved: the layout may still be loading).
  applyLayout() {
    const on = this.o.layout.ticket !== false;
    const base = this.o.layout.ticketRiskBase;
    if (base === 'equity' || base === 'balance') this.form.riskBase = base;
    this.el.hidden = !on;
    if (on) this.place();
    if (this.o.onShow) this.o.onShow(on);
    this.paint();
  }

  // The trader shows or hides the ticket.
  show(on) {
    this.o.layout.ticket = !!on;
    this.o.save();
    if (!on) {
      this.cancel();
      this.closeCard();
    }
    this.applyLayout();
  }

  dockX() {
    const axis = this.o.chart.axisW || 64;
    return Math.max(4, this.wrap.clientWidth - axis - this.el.offsetWidth - 8);
  }

  toggleDock() {
    this.o.layout.ticketDocked = !this.o.layout.ticketDocked;
    this.o.save();
    this.place();
  }

  place() {
    const p = this.o.layout.ticketPos;
    const h = this.wrap.clientHeight;
    const x = this.o.layout.ticketDocked ? this.dockX() : p ? clamp(p.x, 4, Math.max(4, this.wrap.clientWidth - this.el.offsetWidth - 4)) : 10;
    const y = p ? clamp(p.y, 4, Math.max(4, h - 60)) : 34;
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    this.$.dock.innerHTML = icon(this.o.layout.ticketDocked ? 'popout' : 'glue', 16);
  }

  // The ticket's rectangle in the chart's own pixels (its lines' labels keep clear of it).
  rect() {
    if (this.el.hidden) return null;
    return { x: this.el.offsetLeft, y: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  get digits() {
    return this.spec ? this.spec.digits : this.o.chart.digits;
  }

  get pip() {
    return this.spec && this.spec.pipSize > 0 ? this.spec.pipSize : Math.pow(10, -this.digits);
  }

  get lotDigits() {
    const step = this.spec && this.spec.volStep > 0 ? this.spec.volStep : 0.01;
    return Math.max(0, Math.min(6, Math.round(-Math.log10(step))));
  }

  // Money in the account's currency: "$" for dollars, else the currency's code.
  cash(v, signed = true) {
    const ccy = this.term ? this.term.currency : 'USD';
    const cd = this.term ? this.term.currencyDigits || 2 : 2;
    const s = money(v, cd);
    const body = signed ? s : s.replace(/^[+]/, '');
    if (body === '-') return body;
    const sign = body[0] === '-' || body[0] === '+' ? body[0] : '';
    const num = sign ? body.slice(1) : body;
    return ccy === 'USD' || !ccy ? sign + '$' + num : sign + num + ' ' + ccy;
  }

  // A pending order's entry, placed for the side on its limit side, until the trader moves it.
  placeEntry(side) {
    this.form.entry = this.defaultEntry(side);
    this.entryAuto = true;
  }

  defaultEntry(side) {
    const s = this.term && this.term.settings ? this.term.settings.pendingOffsetPips : 10;
    return pendingEntry(side, this.bid, this.ask, s, this.pip, this.digits);
  }

  // ---- what MT5 tells ---------------------------------------------------------------------------

  setLinked(on) {
    this.linked = !!on;
    if (!on) {
      this.preview = null;
      this.trades = null;
    }
    if (on && this.symbol) this.watch();
    this.paint();
  }

  onTerminal(m) {
    const first = !this.term;
    this.term = m;
    if (first) {
      const saved = this.o.layout.ticketRiskBase;
      this.form = { ...defaultForm(m.settings), pending: this.form.pending, entry: this.form.entry };
      if (saved === 'equity' || saved === 'balance') this.form.riskBase = saved;
    }
    this.paint();
  }

  onTrades(m) {
    this.trades = m;
    if (this.card) this.card.tradesChanged();
  }

  setSymbol(symbol, desc) {
    if (desc !== undefined) this.desc = desc;
    if (symbol === this.symbol) {
      this.paint();
      return;
    }
    this.cancel();
    this.closeCard();
    this.symbol = symbol;
    this.spec = null;
    this.bid = NaN;
    this.ask = NaN;
    this.recallIndex = { sl: -1, tp: -1 };
    // another symbol's prices mean nothing here: a pending entry, or a level typed as a price
    this.form.entry = 0;
    this.entryAuto = false;
    const d = defaultForm(this.term ? this.term.settings : null);
    if (this.form.slMode === 'price') [this.form.slMode, this.form.slValue] = ['pips', d.slValue];
    if (this.form.tpMode === 'price') [this.form.tpMode, this.form.tpValue] = d.tpMode === 'price' ? ['r', 2] : [d.tpMode, d.tpValue];
    if (this.linked) this.watch();
    this.paint();
  }

  async watch() {
    const symbol = this.symbol;
    try {
      const r = await this.feed.request({ t: 'ticket.watch', symbol });
      if (r.ok && symbol === this.symbol) {
        this.spec = r.spec;
        this.paint();
      }
    } catch (e) {
      // the ticket works without the specification; the preview has the numbers
    }
  }

  onTick(bid, ask) {
    if (Number.isFinite(bid)) this.bid = bid;
    if (Number.isFinite(ask)) this.ask = ask;
    this.paintPrices();
  }

  // ---- the trader's input -----------------------------------------------------------------------

  choose(side) {
    if (this.side === side) {
      this.cancel();
      return;
    }
    this.side = side;
    this.preview = null;
    this.flash = null;
    if (this.form.pending && (!this.form.entry || this.entryAuto)) this.placeEntry(side);
    this.changed();
  }

  changed() {
    this.paint();
    if (this.side) this.schedule();
  }

  step(k, dir) {
    if (k === 'risk') this.form.riskValue = stepRisk(this.form.riskMode, this.form.riskValue, dir, this.spec ? this.spec.volStep : 0.01);
    else if (k === 'sl') this.form.slValue = stepLevel(this.form.slMode, this.form.slValue, dir, this.pip, this.digits);
    else if (k === 'tp') this.form.tpValue = stepLevel(this.form.tpMode, this.form.tpValue, dir, this.pip, this.digits);
    else if (k === 'entry') [this.form.entry, this.entryAuto] = [Number(((Number(this.form.entry) || 0) + dir * this.pip).toFixed(this.digits)), false];
    this.changed();
  }

  // Changes the unit of a field (% / lot / $, pips / price, R / pips / price), keeping the order
  // what it was: by MT5's preview when there is one, else by the market and the account.
  cycleMode(k) {
    const pv = this.preview && this.preview.plan && this.preview.plan.valid && this.preview.symbol === this.symbol ? this.preview.plan : null;
    const last = this.lastPlan && this.lastPlan.symbol === this.symbol ? this.lastPlan.plan : null;
    const f = this.form;
    const ctx = { side: this.side, bid: this.bid, ask: this.ask, pip: this.pip, digits: this.digits, base: this.riskBaseMoney(), volMin: this.spec ? this.spec.volMin : 0,
      settings: this.term ? this.term.settings : null, slMode: f.slMode, slValue: f.slValue };
    const mode = k === 'risk' ? f.riskMode : k === 'sl' ? f.slMode : f.tpMode;
    const value = k === 'risk' ? f.riskValue : k === 'sl' ? f.slValue : f.tpValue;
    const n = nextUnit(k, mode, value, k === 'risk' ? pv || last : pv, ctx);
    if (k === 'risk') [f.riskMode, f.riskValue] = [n.mode, n.value];
    else if (k === 'sl') [f.slMode, f.slValue] = [n.mode, n.value];
    else [f.tpMode, f.tpValue] = [n.mode, n.value];
    this.changed();
  }

  // The money the risk % counts from: the account's equity or balance, as the trader picked.
  riskBaseMoney() {
    if (!this.trades) return 0;
    return this.form.riskBase === 'balance' ? this.trades.balance : this.trades.equity;
  }

  // The risk % counts from the equity or the balance: the EA's setting at first, then the
  // trader's choice on the ticket (kept with the layout).
  toggleRiskBase() {
    this.form.riskBase = this.form.riskBase === 'balance' ? 'equity' : 'balance';
    this.o.layout.ticketRiskBase = this.form.riskBase;
    this.o.save();
    this.lastPlan = null;   // its % was of the other one
    this.changed();
  }

  async recall(which) {
    if (!this.linked || !this.symbol) return;
    const back = this.recallIndex[which] + 1;
    try {
      const r = await this.feed.request({ t: 'ticket.recall', symbol: this.symbol, side: this.side < 0 ? 'sell' : 'buy', entry: this.form.pending ? this.form.entry : 0, which, back });
      if (!r.ok) {
        toast(r.err || 'Nothing to bring back');
        return;
      }
      this.recallIndex[which] = r.count > 0 ? r.index : -1;
      if (which === 'sl') {
        this.form.slMode = r.slMode;
        this.form.slValue = r.slValue;
      } else {
        this.form.tpMode = r.tpMode;
        this.form.tpValue = r.tpValue;
      }
      if (r.desc) toast(r.desc);
      this.changed();
    } catch (e) {
      toast(e.message);
    }
  }

  // A line of the preview dragged on the chart: that level becomes a price.
  setLevel(which, price) {
    const p = Number(price.toFixed(this.digits));
    if (which === 'sl') {
      this.form.slMode = 'price';
      this.form.slValue = p;
    } else if (which === 'tp') {
      this.form.tpMode = 'price';
      this.form.tpValue = p;
    } else if (which === 'entry') {
      this.form.pending = true;
      this.form.entry = p;
      this.entryAuto = false;
    }
    this.changed();
  }

  // ---- preview and send -------------------------------------------------------------------------

  async requestPreview() {
    if (!this.side || !this.linked || !this.symbol) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    const side = this.side;
    const symbol = this.symbol;
    try {
      const r = await this.feed.request(previewRequest(this.form, symbol, side), 10000);
      if (this.side === side && this.symbol === symbol) {
        const old = this.preview && this.preview.plan && this.preview.plan.valid && this.preview.side === side && this.preview.symbol === symbol ? this.preview.plan.type : '';
        this.preview = r.ok ? { pid: r.preview, plan: r.plan, at: Date.now(), side, symbol } : { pid: '', plan: { valid: false, err: r.err }, at: Date.now(), side, symbol };
        if (r.ok && r.plan && r.plan.valid) this.lastPlan = { symbol, plan: r.plan };
        // the price crossed the pending entry: say so, and hold Confirm a moment
        if (r.ok && r.plan && r.plan.valid && old && r.plan.type !== old) {
          this.holdUntil = Date.now() + TYPE_HOLD_MS;
          this.flash = { text: 'Now a ' + r.plan.type + ': the price crossed the entry. Check it before you confirm', level: 1, until: Date.now() + 6000 };
          setTimeout(() => this.paintConfirm(), TYPE_HOLD_MS + 50);
        }
      }
    } catch (e) {
      if (this.side === side) this.preview = { pid: '', plan: { valid: false, err: e.message }, at: Date.now(), side, symbol };
    }
    this.inFlight = false;
    this.paint();
    this.o.chart.invalidate();
    if (this.again) {
      this.again = false;
      this.requestPreview();
    }
  }

  state() {
    return { linked: this.linked, problem: this.problem(), side: this.side, symbol: this.symbol, sending: this.sending, preview: this.preview, holdUntil: this.holdUntil };
  }

  problem() {
    if (!this.term) return '';
    if (this.term.connected === false) return 'MetaTrader 5 is not connected to the broker';
    return this.term.problem || '';
  }

  async confirm() {
    const cs = confirmState(this.state(), Date.now());
    if (!cs.ok) {
      toast(cs.why);
      return;
    }
    const pv = this.preview;
    this.sending = true;
    this.paint();
    try {
      const r = await this.feed.request({ t: 'ticket.send', preview: pv.pid }, 30000);
      this.sending = false;
      if (r.ok) {
        const f = r.fill || {};
        const text = r.type + ' ' + r.lots + ' ' + this.symbol + (r.pending ? ' placed at ' : ' filled at ') + formatPrice(r.price, this.digits) +
          (f.slipped ? ' (' + slipText(f.slipPips) + (f.slMoved ? '; SL and TP moved with it' : '') + ')' : '');
        this.flash = { text, level: 3, until: Date.now() + 6000 };
        toast(text, 5000);
        this.cancel();
        return;
      }
      this.flash = { text: 'Not sent: ' + (r.err || 'MT5 refused it'), level: 2, until: Date.now() + 8000 };
    } catch (e) {
      this.sending = false;
      this.flash = { text: 'Not sent: ' + e.message, level: 2, until: Date.now() + 8000 };
    }
    this.paint();
  }

  cancel() {
    this.side = 0;
    this.preview = null;
    this.paint();
    if (this.o.chart) this.o.chart.invalidate();
  }

  // The preview's lines for the chart: null while not trading.
  previewLines() {
    if (!this.side || !this.preview || !this.preview.plan || this.preview.symbol !== this.symbol) return null;
    const p = this.preview.plan;
    if (!(p.entry > 0)) return null;
    return { side: this.side, pending: this.form.pending, entry: p.entry, sl: p.sl, tp: p.tp, plan: p, stale: Date.now() - this.preview.at > FRESH_MS };
  }

  // ---- painting ---------------------------------------------------------------------------------

  paintPrices() {
    const d = this.digits;
    const bid = Number.isFinite(this.bid) ? formatPrice(this.bid, d) : '-';
    const ask = Number.isFinite(this.ask) ? formatPrice(this.ask, d) : '-';
    this.el.querySelectorAll('.tk-side.sell .px').forEach((e) => (e.textContent = bid));
    this.el.querySelectorAll('.tk-side.buy .px').forEach((e) => (e.textContent = ask));
    this.$.spread.textContent = Number.isFinite(this.bid) && Number.isFinite(this.ask) ? (Math.round(((this.ask - this.bid) / this.pip) * 10) / 10).toString() : '-';
  }

  paintConfirm() {
    const cs = confirmState(this.state(), Date.now());
    const plan = this.preview && this.preview.plan;
    this.$.cbtn.disabled = !cs.ok;
    this.$.cbtn.title = cs.ok ? 'Send this order to MetaTrader 5' : cs.why;
    this.$.cbtn.textContent = this.sending ? 'Sending...' : !this.side ? 'Pick SELL or BUY'
      : 'Confirm ' + (plan && plan.valid ? plan.type + ' ' + plan.lots.toFixed(this.lotDigits) + ' lots' : this.side > 0 ? 'BUY' : 'SELL');
    this.$.cbtn.classList.toggle('sell', this.side < 0);
    this.$.xbtn.hidden = !this.side;
  }

  // One line under Confirm: the last send's result, else what stops the order, else a warning.
  paintStatus() {
    const plan = this.preview && this.preview.plan;
    let text = '';
    let level = 0;
    if (this.flash && this.flash.until > Date.now()) ({ text, level } = this.flash);
    else if (!this.linked) {
      text = 'To trade from here, put the ActionInna EA on a chart in MT5 (it serves the ticket).';
      level = 1;
    } else if (this.problem()) {
      text = this.problem();
      level = 2;
    } else if (this.side && plan && !plan.valid) {
      text = plan.err || 'MT5 does not accept this order';
      level = 2;
    } else if (this.side && plan && plan.warn) {
      text = plan.warn;
      level = 1;
    } else if (this.side && !plan) {
      text = 'Waiting for MT5\'s preview...';
      level = 0;
    }
    this.$.status.textContent = text;
    this.$.status.className = 'tk-status l' + level;
  }

  riskShort() {
    const f = this.form;
    if (f.riskMode === 'lots') return f.riskValue + ' lot';
    if (f.riskMode === 'money') return this.cash(Number(f.riskValue), false);
    return f.riskValue + '%';
  }

  paint() {
    const f = this.form;
    const t = this.term;
    const open = this.side !== 0 || !!this.o.layout.ticketOpen;
    this.el.classList.toggle('collapsed', !open);
    this.$.fold.innerHTML = open ? icon('minus', 16) : icon('plus', 16);
    this.$.sym.textContent = this.symbol || '-';
    // 'Gold vs US Dollar' as 'Gold', as the prototype names it; the whole of it on hover
    const short = this.desc.split(/\s+vs\.?\s+/i)[0];
    this.$.sub.textContent = (short ? short + ' \u00b7 ' : '') + tfLabel(this.o.chart.tf || '');
    this.$.sub.title = this.desc;
    const acct = t ? ACCOUNT_WORD[t.tradeMode] || '' : '';
    this.$.acct.textContent = acct;
    this.$.acct.className = 'tk-acct' + (acct === 'REAL' ? ' real' : '');
    this.el.querySelectorAll('.tk-side').forEach((b) => b.classList.toggle('on', Number(b.dataset.side) === this.side));
    this.$.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'pending') === !!f.pending));
    this.$.entryRow.hidden = !f.pending;
    const put = (k, v) => {
      const input = this.el.querySelector('.tk-in[data-k="' + k + '"]');
      if (input && document.activeElement !== input) input.value = v;
    };
    put('entry', f.entry ? formatPrice(f.entry, this.digits) : '');
    put('sl', f.slMode === 'price' ? formatPrice(Number(f.slValue), this.digits) : f.slValue);
    put('tp', f.tpMode === 'price' ? formatPrice(Number(f.tpValue), this.digits) : f.tpValue);
    this.el.querySelector('.tk-unit[data-k="sl"]').textContent = MODE_LABEL[f.slMode];
    this.el.querySelector('.tk-unit[data-k="tp"]').textContent = MODE_LABEL[f.tpMode];
    this.$.cu.textContent = MODE_LABEL[f.riskMode];
    this.$.base.textContent = 'of ' + (f.riskBase === 'balance' ? 'balance' : 'equity');
    this.$.base.hidden = f.riskMode !== 'percent';
    const presets = t && t.settings && Array.isArray(t.settings.presets) ? t.settings.presets : [1, 1.5, 2];
    const onPreset = f.riskMode === 'percent' && presets.includes(Number(f.riskValue));
    this.$.presets.innerHTML = '';
    for (const p of presets) {
      const b = el('button', 'tk-chip' + (onPreset && Number(f.riskValue) === p ? ' on' : ''), esc(p + '%'));
      b.type = 'button';
      b.addEventListener('click', () => {
        this.form.riskMode = 'percent';
        this.form.riskValue = p;
        this.changed();
      });
      this.$.presets.appendChild(b);
    }
    this.$.custom.classList.toggle('on', !onPreset);
    put('risk', onPreset ? '' : f.riskValue);
    const plan = this.preview && this.preview.plan;
    if (plan && plan.valid) {
      const lots = plan.lots.toFixed(this.lotDigits);
      this.$.lots.textContent = lots;
      this.$.units.textContent = this.spec && this.spec.contractSize > 0 ? '(' + Math.round(plan.lots * this.spec.contractSize).toLocaleString('en-US') + ' units)' : '';
      this.$.risk.textContent = this.cash(-plan.riskMoney);
      this.$.riskp.textContent = '(' + plan.riskPct.toFixed(2) + '%)';
      this.$.reward.textContent = this.cash(plan.rewardMoney);
      this.$.rewardp.textContent = '(' + plan.rewardPct.toFixed(2) + '%)';
      this.$.rr.textContent = '1:' + plan.rr.toFixed(2);
      this.$.dist.textContent = 'SL ' + pipsText(plan.slPips) + ' \u00b7 TP ' + pipsText(plan.tpPips);
      this.$.pipv.textContent = this.cash(plan.pipValue, false);
      this.$.margin.textContent = this.cash(plan.margin, false);
      this.$.free.textContent = '(free ' + this.cash(plan.freeAfter, false) + ')';
      this.$.miniLots.textContent = lots + ' lots';
    } else {
      for (const k of ['lots', 'risk', 'reward', 'rr', 'pipv', 'margin']) this.$[k].textContent = '-';
      for (const k of ['units', 'riskp', 'rewardp', 'dist', 'free']) this.$[k].textContent = '';
      this.$.miniLots.textContent = 'risk';
    }
    this.$.miniRisk.textContent = this.riskShort();
    this.paintPrices();
    this.paintConfirm();
    this.paintStatus();
  }

  // ---- open trades: change and close cards ------------------------------------------------------

  openChange(trade, which, price) {
    this.closeCard();
    this.card = new Card(this, 'change', trade, { which, price });
  }

  openClose(trade) {
    this.closeCard();
    this.card = new Card(this, 'close', trade, {});
  }

  async cancelOrder(trade) {
    if (!(await confirmBox({ title: 'Remove the order', text: 'Remove ' + trade.type + ' ' + trade.lots + ' ' + this.symbol + ' #' + trade.ticket + '?' }))) return;
    try {
      const r = await this.feed.request({ t: 'ticket.cancel', ticket: trade.ticket }, 30000);
      toast(r.ok ? 'Removed #' + trade.ticket : 'Not removed: ' + r.err, 4000);
    } catch (e) {
      toast('Not removed: ' + e.message, 4000);
    }
  }

  closeCard() {
    if (this.card) this.card.close();
    this.card = null;
    if (this.o.chart) this.o.chart.invalidate();
  }

  // The level a trade's line shows while its change card is open.
  pendingChange() {
    return this.card && this.card.kind === 'change' ? { ticket: this.card.trade.ticket, which: this.card.which, price: this.card.price } : null;
  }
}

// A card for one open trade: change its stop, target or entry, or close it (all or part). MT5
// previews the change every second while the card is open; Confirm sends the newest preview.
class Card {
  constructor(ticket, kind, trade, { which, price }) {
    this.t = ticket;
    this.kind = kind;
    this.trade = trade;
    this.which = which;
    this.price = price;
    this.lots = 0;    // a close: 0 is all of it
    this.preview = null;
    this.busy = false;
    const c = el('div', 'tk-card');
    c.innerHTML = '<div class="tk-card-head"></div><div class="tk-card-rows"></div><div class="tk-card-lots" hidden><label>Lots to close</label><input class="num" type="number" step="any" min="0"></div>' +
      '<div class="tk-status"></div><div class="tk-card-actions"><button type="button" class="btn">Cancel</button><button type="button" class="tk-cbtn"></button></div>';
    this.el = c;
    this.$ = { head: c.querySelector('.tk-card-head'), rows: c.querySelector('.tk-card-rows'), lotsRow: c.querySelector('.tk-card-lots'), lots: c.querySelector('.tk-card-lots input'),
      msg: c.querySelector('.tk-status'), cancel: c.querySelector('.btn'), confirm: c.querySelector('.tk-cbtn') };
    this.$.head.textContent = (kind === 'change' ? 'Change ' : 'Close ') + trade.type + ' ' + trade.lots + ' #' + trade.ticket;
    this.$.cancel.addEventListener('click', () => ticket.closeCard());
    this.$.confirm.addEventListener('click', () => this.confirm());
    if (kind === 'close') {
      this.$.lotsRow.hidden = false;
      this.$.lots.value = trade.lots;
      this.$.lots.addEventListener('change', () => {
        const v = Number(this.$.lots.value);
        this.lots = Number.isFinite(v) && v > 0 && v < trade.lots ? v : 0;
        this.ask();
      });
    }
    ticket.wrap.appendChild(c);
    this.timer = setInterval(() => this.ask(), 1000);
    this.ask();
    this.paint();
  }

  close() {
    clearInterval(this.timer);
    this.el.remove();
  }

  tradesChanged() {
    const now = this.t.trades && this.t.trades.list ? this.t.trades.list.find((x) => x.ticket === this.trade.ticket) : null;
    if (!now) {
      toast('#' + this.trade.ticket + ' is no longer open');
      this.t.closeCard();
    }
  }

  async ask() {
    if (this.busy) return;
    const req = this.kind === 'change'
      ? { t: 'ticket.modPreview', ticket: this.trade.ticket, sl: this.which === 'sl' ? this.price : this.trade.sl, tp: this.which === 'tp' ? this.price : this.trade.tp, ...(this.which === 'open' ? { open: this.price } : {}) }
      : { t: 'ticket.closePreview', ticket: this.trade.ticket, lots: this.lots };
    try {
      const r = await this.t.feed.request(req, 10000);
      const body = r.ok ? (this.kind === 'change' ? r.mod : r.close) : { valid: false, err: r.err };
      this.preview = { pid: r.ok ? r.preview : '', body, at: Date.now() };
    } catch (e) {
      this.preview = { pid: '', body: { valid: false, err: e.message }, at: Date.now() };
    }
    this.paint();
  }

  ready() {
    const p = this.preview;
    if (!p || !p.pid || !p.body || !p.body.valid || this.busy) return false;
    if (this.kind === 'change' && !p.body.changed) return false;
    return Date.now() - p.at <= FRESH_MS;
  }

  paint() {
    const p = this.preview;
    const b = p && p.body;
    const d = this.trade.digits || this.t.digits;
    const row = (k, v) => '<div class="tk-card-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
    let html = '';
    if (b && b.valid && this.kind === 'change') {
      if (b.sl > 0) html += row('Stop loss', formatPrice(b.sl, d) + '  ' + this.t.cash(b.slMoney) + ' (' + b.slPct.toFixed(2) + '%)');
      if (b.tp > 0) html += row('Take profit', formatPrice(b.tp, d) + '  ' + this.t.cash(b.tpMoney) + ' (' + b.tpPct.toFixed(2) + '%)');
      if (this.which === 'open') html += row('Entry', formatPrice(b.open, d));
      if (b.rr > 0) html += row('R : R', '1:' + b.rr.toFixed(2));
      if (b.type !== this.trade.type) html += row('Becomes', b.type);
    } else if (b && b.valid) {
      html += row('Lots', b.lots + (b.left > 0 ? ' (' + b.left + ' stay open)' : ''));
      html += row('At about', formatPrice(b.price, d));
      html += row('Profit', this.t.cash(b.profit));
    }
    this.$.rows.innerHTML = html;
    this.$.msg.textContent = b ? (b.valid ? b.warn || '' : b.err || '') : 'Waiting for MT5\'s preview...';
    this.$.msg.className = 'tk-status ' + (b && !b.valid ? 'l2' : 'l1');
    this.$.confirm.disabled = !this.ready();
    this.$.confirm.textContent = this.busy ? 'Sending...' : this.kind === 'change' ? 'Confirm change' : 'Confirm close';
  }

  async confirm() {
    if (!this.ready()) return;
    this.busy = true;
    this.paint();
    const pid = this.preview.pid;
    try {
      const r = await this.t.feed.request({ t: this.kind === 'change' ? 'ticket.modSend' : 'ticket.close', preview: pid }, 30000);
      if (r.ok) {
        toast(this.kind === 'change' ? (r.replaced ? 'Replaced by #' + r.ticket + ' (' + r.type + ')' : 'Changed #' + this.trade.ticket)
          : 'Closed ' + r.lots + ' of #' + this.trade.ticket + ' at ' + formatPrice(r.price, this.trade.digits || this.t.digits), 5000);
        this.t.closeCard();
        return;
      }
      toast('Not done: ' + (r.err || 'MT5 refused it') + (r.removed ? ' (the old order was removed)' : ''), 6000);
      this.preview = { pid: '', body: { valid: false, err: r.err }, at: Date.now() };
    } catch (e) {
      toast('Not done: ' + e.message, 5000);
    }
    this.busy = false;
    this.paint();
  }
}
