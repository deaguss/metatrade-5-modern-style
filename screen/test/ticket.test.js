import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultForm, previewRequest, confirmState, FRESH_MS, stepLevel, stepRisk, pendingEntry, tradesOf, changeRequest, money, nextUnit } from '../web/js/ticketcore.js';

const SETTINGS = { presets: [1, 1.5, 2], riskBase: 'equity', defaultSLPips: 20, defaultTPMode: 'r', defaultTPValue: 2, pendingOffsetPips: 10 };

test('the form starts from the EA\'s own settings', () => {
  const f = defaultForm(SETTINGS);
  assert.deepEqual([f.slMode, f.slValue, f.tpMode, f.tpValue, f.riskMode, f.riskValue, f.riskBase], ['pips', 20, 'r', 2, 'percent', 1, 'equity']);
  const g = defaultForm({ presets: [0.5], riskBase: 'balance', defaultTPMode: 'pips', defaultTPValue: 40 });
  assert.equal(g.riskValue, 0.5);
  assert.equal(g.riskBase, 'balance');
  assert.equal(g.tpMode, 'pips');
  assert.equal(defaultForm(null).slValue, 20, 'before MT5 says anything');
});

test('a preview request says everything the EA needs, nothing more', () => {
  const f = { ...defaultForm(SETTINGS), entry: 2600 };
  assert.deepEqual(previewRequest(f, 'XAUUSD', 1), {
    t: 'ticket.preview', symbol: 'XAUUSD', side: 'buy', pending: false, entry: 0, slMode: 'pips', slValue: 20,
    tpMode: 'r', tpValue: 2, riskMode: 'percent', riskValue: 1, riskBase: 'equity',
  });
  const p = previewRequest({ ...f, pending: true }, 'XAUUSD', -1);
  assert.equal(p.side, 'sell');
  assert.equal(p.entry, 2600, 'a pending order carries its entry');
});

test('Confirm only on a valid, fresh preview of what is on screen', () => {
  const now = 100000;
  const good = { linked: true, problem: '', side: 1, symbol: 'XAUUSD', sending: false, preview: { pid: 'p1', side: 1, symbol: 'XAUUSD', at: now - 500, plan: { valid: true } } };
  assert.equal(confirmState(good, now).ok, true);
  assert.equal(confirmState({ ...good, linked: false }, now).ok, false, 'no EA');
  assert.match(confirmState({ ...good, problem: 'Turn on Algo Trading' }, now).why, /Algo Trading/, 'MT5\'s own problem is shown');
  assert.equal(confirmState({ ...good, side: 0 }, now).ok, false, 'no side');
  assert.equal(confirmState({ ...good, sending: true }, now).ok, false, 'not twice');
  assert.equal(confirmState({ ...good, preview: { ...good.preview, at: now - FRESH_MS - 1 } }, now).ok, false, 'a stale preview');
  assert.equal(confirmState({ ...good, preview: { ...good.preview, side: -1 } }, now).ok, false, 'a preview of the other side');
  assert.equal(confirmState({ ...good, symbol: 'EURUSD' }, now).ok, false, 'a preview of another symbol');
  assert.match(confirmState({ ...good, preview: { ...good.preview, plan: { valid: false, err: 'Set a stop loss' } } }, now).why, /stop loss/);
});

test('steps of - and +', () => {
  assert.equal(stepLevel('pips', 20, 1, 0.1, 2), 25);
  assert.equal(stepLevel('pips', 23, -1, 0.1, 2), 20, 'onto the 5s');
  assert.equal(stepLevel('pips', 5, -1, 0.1, 2), 1, 'never below 1');
  assert.equal(stepLevel('r', 2, 1, 0.1, 2), 2.5);
  assert.equal(stepLevel('r', 0.5, -1, 0.1, 2), 0.5);
  assert.equal(stepLevel('price', 2650, 1, 0.1, 2), 2650.5, 'a price moves by 5 pips');
  assert.equal(stepRisk('percent', 1, 1), 1.25);
  assert.equal(stepRisk('percent', 0.25, -1), 0.25);
  assert.equal(stepRisk('money', 100, -1), 90);
  assert.equal(stepRisk('lots', 0.1, 1, 0.01), 0.11);
  assert.equal(stepRisk('lots', 0.01, -1, 0.01), 0.01);
});

test('the unit buttons keep the order what it was', () => {
  const plan = { valid: true, lots: 0.5, riskMoney: 100.4, riskPct: 1.004, sl: 2645, slPips: 50, tp: 2665, tpPips: 100, rr: 2 };
  const ctx = { side: 1, bid: 2649.8, ask: 2650, pip: 0.1, digits: 2, base: 10000, volMin: 0.01, settings: SETTINGS, slMode: 'pips', slValue: 50 };
  // with MT5's preview: its numbers
  assert.deepEqual(nextUnit('risk', 'percent', 1, plan, ctx), { mode: 'lots', value: 0.5 });
  assert.deepEqual(nextUnit('risk', 'lots', 0.5, plan, ctx), { mode: 'money', value: 100 });
  assert.deepEqual(nextUnit('risk', 'money', 100, plan, ctx), { mode: 'percent', value: 1 });
  assert.deepEqual(nextUnit('sl', 'pips', 50, plan, ctx), { mode: 'price', value: 2645 });
  assert.deepEqual(nextUnit('tp', 'r', 2, plan, ctx), { mode: 'pips', value: 100 });
  assert.deepEqual(nextUnit('tp', 'price', 2665, plan, ctx), { mode: 'r', value: 2 });
  // without one: from the account and the market, never a 1 % that turns into $1
  assert.deepEqual(nextUnit('risk', 'percent', 1, null, ctx), { mode: 'lots', value: 0.01 });
  assert.deepEqual(nextUnit('risk', 'lots', 0.01, null, ctx), { mode: 'money', value: 100 });
  assert.deepEqual(nextUnit('risk', 'money', 250, null, ctx), { mode: 'percent', value: 2.5 });
  assert.deepEqual(nextUnit('risk', 'lots', 0.01, null, { ...ctx, base: 0 }), { mode: 'money', value: 100 });
  assert.deepEqual(nextUnit('sl', 'pips', 50, null, ctx), { mode: 'price', value: 2645 }, 'a buy stop under the ask');
  assert.deepEqual(nextUnit('sl', 'pips', 50, null, { ...ctx, side: -1 }), { mode: 'price', value: 2654.8 }, 'a sell stop over the bid');
  assert.deepEqual(nextUnit('sl', 'price', 2645, null, ctx), { mode: 'pips', value: 50 });
  assert.deepEqual(nextUnit('tp', 'r', 2, null, ctx), { mode: 'pips', value: 100 });
  assert.deepEqual(nextUnit('tp', 'pips', 100, null, ctx), { mode: 'price', value: 2660 });
  assert.deepEqual(nextUnit('tp', 'price', 2660, null, ctx), { mode: 'r', value: 2 });
  assert.deepEqual(nextUnit('tp', 'pips', 100, null, { ...ctx, bid: NaN, ask: NaN }), { mode: 'price', value: 0 }, 'no price yet: nothing made up');
  assert.deepEqual(nextUnit('tp', 'price', 2660, null, { ...ctx, side: 0 }), { mode: 'r', value: 2 }, 'no side: back to the default');
});

test('a pending order starts its offset away, on the limit side', () => {
  assert.equal(pendingEntry(1, 2650, 2650.3, 10, 0.1, 2), 2649.3);
  assert.equal(pendingEntry(-1, 1.085, 1.0851, 10, 0.0001, 5), 1.086);
});

test('trades on the chart, and what dragging their lines asks', () => {
  const trades = { list: [
    { ticket: 11, symbol: 'XAUUSD', kind: 'position', type: 'BUY', side: 1, lots: 0.2, open: 2650.5, sl: 2645.5, tp: 0, profit: 12.4, slMoney: -100, digits: 2 },
    { ticket: 12, symbol: 'EURUSD', kind: 'order', type: 'SELL LIMIT', side: -1, lots: 0.5, open: 1.09, sl: 1.092, tp: 1.086, profit: 0, digits: 5 },
    { ticket: 13, symbol: 'XAUUSD', kind: 'order', type: 'BUY LIMIT', side: 1, lots: 0.1, open: 2600, sl: 2590, tp: 2620, profit: 0, digits: 2, locked: false },
  ] };
  const mine = tradesOf(trades, 'XAUUSD');
  assert.deepEqual(mine.map((t) => t.ticket), [11, 13]);
  assert.equal(mine[0].position, true);
  assert.equal(mine[0].tp, 0, 'no target');
  assert.equal(mine[0].slMoney, -100, 'the money at the stop, from MT5');
  assert.ok(Number.isNaN(mine[0].tpMoney) && Number.isNaN(mine[1].slMoney), 'none where there is no target, or MT5 did not say');
  assert.deepEqual(tradesOf(null, 'X'), []);
  assert.deepEqual(changeRequest(mine[0], 'sl', 2648), { t: 'ticket.modPreview', ticket: 11, sl: 2648, tp: 0 });
  assert.deepEqual(changeRequest(mine[1], 'open', 2605), { t: 'ticket.modPreview', ticket: 13, sl: 2590, tp: 2620, open: 2605 });
  assert.equal(changeRequest(mine[0], 'open', 2600).open, undefined, 'a position\'s entry can\'t move');
  assert.equal(money(-1234.5), '-1,234.50');
  assert.equal(money(12), '+12.00');
});
