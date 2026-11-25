// The order ticket's rules that need no page: what a preview request holds, when Confirm may be
// pressed, the - and + steps, and which lines the chart shows for the trades. The ActionInna EA in
// MT5 keeps every number and every rule (risk, lots, checks); these only build the requests and
// show its answers. Nothing is sent to the broker without a preview and a Confirm.

// A preview is fresh for this long: Confirm waits for a newer one after that. The EA itself
// refuses previews older than 60 s and re-checks everything when it sends.
export const FRESH_MS = 3000;

export function defaultForm(settings) {
  const s = settings || {};
  const presets = Array.isArray(s.presets) && s.presets.length ? s.presets : [1, 1.5, 2];
  return {
    pending: false,
    entry: 0,
    slMode: 'pips',
    slValue: s.defaultSLPips > 0 ? s.defaultSLPips : 20,
    tpMode: s.defaultTPMode === 'pips' || s.defaultTPMode === 'price' ? s.defaultTPMode : 'r',
    tpValue: s.defaultTPValue > 0 ? s.defaultTPValue : 2,
    riskMode: 'percent',
    riskValue: presets[0],
    riskBase: s.riskBase === 'balance' ? 'balance' : 'equity',
  };
}

// The ticket.preview request for a side (1 buy, -1 sell).
export function previewRequest(form, symbol, side) {
  return {
    t: 'ticket.preview',
    symbol,
    side: side > 0 ? 'buy' : 'sell',
    pending: !!form.pending,
    entry: form.pending ? Number(form.entry) || 0 : 0,
    slMode: form.slMode,
    slValue: Number(form.slValue) || 0,
    tpMode: form.tpMode,
    tpValue: Number(form.tpValue) || 0,
    riskMode: form.riskMode,
    riskValue: Number(form.riskValue) || 0,
    riskBase: form.riskBase,
  };
}

// Whether Confirm may be pressed now, and if not, why (in words for the button's tooltip).
export function confirmState(st, now) {
  if (!st.linked) return { ok: false, why: 'The ActionInna EA is not serving the ticket' };
  if (st.problem) return { ok: false, why: st.problem };
  if (!st.side) return { ok: false, why: 'Press BUY or SELL first' };
  if (st.sending) return { ok: false, why: 'Sending...' };
  if (!st.preview || !st.preview.plan) return { ok: false, why: 'Waiting for MT5\'s preview' };
  if (!st.preview.plan.valid) return { ok: false, why: st.preview.plan.err || 'MT5 does not accept this order' };
  if (st.preview.side !== st.side || st.preview.symbol !== st.symbol) return { ok: false, why: 'Waiting for MT5\'s preview' };
  if (now - st.preview.at > FRESH_MS) return { ok: false, why: 'Waiting for a fresh preview' };
  return { ok: true, why: '' };
}

export const UNITS = { risk: ['percent', 'lots', 'money'], sl: ['pips', 'price'], tp: ['r', 'pips', 'price'] };

// A field's next unit (the unit button cycles them) and its value in that unit, so the order stays
// what it was. MT5's preview gives the exact value; without one (no side picked yet, or the order
// was just sent) it comes from the market and the account, else from the EA's defaults.
//   k: 'risk', 'sl' or 'tp'; plan: MT5's valid preview or null (for the risk, the last one on this
//   symbol will do); ctx: {side, bid, ask, pip, digits, base (the account's balance or equity),
//   volMin, settings, slMode, slValue}
export function nextUnit(k, mode, value, plan, ctx) {
  const list = UNITS[k];
  const next = list[(list.indexOf(mode) + 1) % list.length];
  const v = Number(value) || 0;
  const s = ctx.settings || {};
  const round = (x, d) => Number(x.toFixed(d));
  if (plan && plan.valid) {
    if (k === 'risk') return { mode: next, value: next === 'money' ? Math.round(plan.riskMoney) : next === 'lots' ? plan.lots : round(plan.riskPct, 2) };
    if (k === 'sl') return { mode: next, value: next === 'price' ? plan.sl : round(plan.slPips, 1) };
    return { mode: next, value: next === 'price' ? plan.tp : next === 'pips' ? round(plan.tpPips, 1) : round(plan.rr, 2) };
  }
  if (k === 'risk') {
    const pct = Array.isArray(s.presets) && s.presets[0] > 0 ? s.presets[0] : 1;
    const base = ctx.base > 0 ? ctx.base : 0;
    if (next === 'lots') return { mode: next, value: ctx.volMin > 0 ? ctx.volMin : 0.01 };
    if (next === 'money') return { mode: next, value: base ? Math.max(1, Math.round((base * pct) / 100)) : 100 };
    return { mode: next, value: base && mode === 'money' ? round((v / base) * 100, 2) : pct };
  }
  const pip = ctx.pip > 0 ? ctx.pip : 0;
  const side = ctx.side || 0;
  const entry = side > 0 ? ctx.ask : side < 0 ? ctx.bid : (ctx.bid + ctx.ask) / 2;
  const market = Number.isFinite(entry) && entry > 0 && pip > 0;
  const slPips = ctx.slMode === 'pips' && Number(ctx.slValue) > 0 ? Number(ctx.slValue) : s.defaultSLPips > 0 ? s.defaultSLPips : 20;
  // the distance from the entry in pips, as the field says it now
  let dist = mode === 'pips' ? v : mode === 'r' ? v * slPips : market && side ? Math.abs(v - entry) / pip : 0;
  if (!(dist > 0)) dist = k === 'sl' ? slPips : slPips * (s.defaultTPValue > 0 && s.defaultTPMode !== 'pips' && s.defaultTPMode !== 'price' ? s.defaultTPValue : 2);
  if (next === 'pips') return { mode: next, value: round(dist, 1) };
  if (next === 'r') return { mode: next, value: round(dist / slPips, 2) };
  if (!market) return { mode: next, value: 0 };
  // a price: the stop on the losing side, the target on the winning side; before a side is picked,
  // where a buy's would be
  const dir = (side || 1) * (k === 'sl' ? -1 : 1);
  return { mode: next, value: round(entry + dir * dist * pip, ctx.digits) };
}

// The next value of a stop or target field after - or + (dir -1 or 1). Pips and money move by 5,
// an R by 0.5, a price by 5 pips. Never below the smallest step.
export function stepLevel(mode, value, dir, pipSize, digits) {
  const v = Number(value) || 0;
  if (mode === 'r') return Math.max(0.5, Math.round((v + dir * 0.5) * 2) / 2);
  if (mode === 'price') {
    const step = (pipSize > 0 ? pipSize : Math.pow(10, -digits)) * 5;
    return Number(Math.max(step, v + dir * step).toFixed(digits));
  }
  return Math.max(1, Math.round(v / 5) * 5 + dir * 5);
}

// The next risk value after - or +: % by 0.25, money by 10, lots by the broker's step.
export function stepRisk(mode, value, dir, volStep) {
  const v = Number(value) || 0;
  if (mode === 'lots') {
    const step = volStep > 0 ? volStep : 0.01;
    const d = Math.max(0, Math.round(-Math.log10(step)));
    return Number(Math.max(step, v + dir * step).toFixed(d));
  }
  if (mode === 'money') return Math.max(10, Math.round(v / 10) * 10 + dir * 10);
  return Math.max(0.25, Math.round((v + dir * 0.25) * 100) / 100);
}

// A pending order's starting entry: the pending offset away from the market, on the side a limit
// order sits (below the ask for a buy, above the bid for a sell).
export function pendingEntry(side, bid, ask, offsetPips, pipSize, digits) {
  const off = (offsetPips > 0 ? offsetPips : 10) * (pipSize > 0 ? pipSize : Math.pow(10, -digits));
  return Number((side > 0 ? ask - off : bid + off).toFixed(digits));
}

// The trades of one symbol as the chart draws them.
export function tradesOf(trades, symbol) {
  const list = trades && Array.isArray(trades.list) ? trades.list : [];
  return list.filter((t) => t.symbol === symbol).map((t) => ({
    ticket: t.ticket,
    position: t.kind === 'position',
    type: t.type,
    side: t.side,
    lots: t.lots,
    open: t.open,
    sl: t.sl > 0 ? t.sl : 0,
    tp: t.tp > 0 ? t.tp : 0,
    profit: t.profit,
    // the money at the stop and the target from MT5: NaN when it did not say
    slMoney: t.sl > 0 && Number.isFinite(t.slMoney) ? t.slMoney : NaN,
    tpMoney: t.tp > 0 && Number.isFinite(t.tpMoney) ? t.tpMoney : NaN,
    digits: t.digits,
    locked: !!t.locked,
  }));
}

// What a dragged line of a trade asks MT5 to change: its stop, its target or (a pending order's)
// entry, with the other levels as they are.
export function changeRequest(trade, which, price) {
  const req = { t: 'ticket.modPreview', ticket: trade.ticket, sl: trade.sl, tp: trade.tp };
  if (which === 'sl') req.sl = price;
  else if (which === 'tp') req.tp = price;
  else if (which === 'open' && !trade.position) req.open = price;
  return req;
}

export const money = (v, digits = 2) => (Number.isFinite(v) ? (v < 0 ? '-' : v > 0 ? '+' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-');
