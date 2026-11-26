import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceStep, parseColor, toCss, withAlpha, textOn, drawingsFile, pipSize, merge, formatPrice } from '../web/js/util.js';
import { parseInterval, barEnd, crosshairTime, countdown, labelStep, timeLabels, tfSeconds, nextTimeframe } from '../web/js/timeframes.js';

test('a chart added to a split screen: the next timeframe up', () => {
  assert.equal(nextTimeframe(['M15']), 'H1');
  assert.equal(nextTimeframe(['H1', 'H4']), 'D1', 'above the highest one shown');
  assert.equal(nextTimeframe(['H1', 'H4', 'D1']), 'W1');
  assert.equal(nextTimeframe(['MN1']), 'MN1', 'the top stays the top');
  assert.equal(nextTimeframe(['M30']), 'H1', 'a timeframe between the steps: the next step');
  assert.equal(nextTimeframe(['H2', 'M5']), 'H4', 'above the longest');
});
import { Series } from '../web/js/series.js';
import { View, priceTicks, stepDigits } from '../web/js/scale.js';
import { positionStats, levelsFor } from '../web/js/position.js';

const T0 = Date.UTC(2026, 10, 24, 0, 0) / 1000;   // Tue 24 Nov 2026 00:00

test('nice steps', () => {
  assert.equal(niceStep(0.7), 1);
  assert.equal(niceStep(1.3), 2);
  assert.equal(niceStep(2.2), 2.5);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(0.00042), 0.0005);
  assert.equal(niceStep(70), 100);
});

test('colours read and write back', () => {
  assert.deepEqual(parseColor('#2962FF'), { r: 41, g: 98, b: 255, a: 1 });
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('rgba( 255, 255, 255, 1)'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('rgba(242, 54, 69, 0.2)'), { r: 242, g: 54, b: 69, a: 0.2 });
  assert.equal(parseColor('red'), null);
  assert.equal(toCss({ r: 15, g: 15, b: 15, a: 1 }), '#0f0f0f');
  assert.equal(withAlpha('#089981', 0.2), 'rgba(8, 153, 129, 0.2)');
  assert.equal(textOn('#ffffff'), '#000000');
  assert.equal(textOn('#2962ff'), '#ffffff');
});

test('names and pips', () => {
  assert.equal(drawingsFile('XAUUSD.m'), 'drawings.xauusd_m.json');
  assert.equal(drawingsFile('US30#'), 'drawings.us30_.json');
  assert.equal(pipSize('XAUUSD', 2, 0.01), 0.1);
  assert.equal(pipSize('XAUUSDm', 3, 0.001), 0.1);
  assert.ok(Math.abs(pipSize('EURUSD', 5, 0.00001) - 0.0001) < 1e-12);
  assert.ok(Math.abs(pipSize('USDJPY', 3, 0.001) - 0.01) < 1e-12);
  assert.equal(pipSize('US30', 1, 0.1), 0.1);
  assert.equal(formatPrice(2650.5, 2), '2650.50');
});

test('merge keeps what the second object leaves out', () => {
  const a = { candles: { up: '#fff', down: '#00f' }, grid: false, list: [1, 2] };
  const m = merge(a, { candles: { down: '#f00' }, list: [3] });
  assert.deepEqual(m, { candles: { up: '#fff', down: '#f00' }, grid: false, list: [3] });
  assert.deepEqual(a.candles, { up: '#fff', down: '#00f' }, 'the first object is unchanged');
});

test('intervals typed by the trader', () => {
  assert.equal(parseInterval('15'), 'M15');
  assert.equal(parseInterval('60'), 'H1');
  assert.equal(parseInterval('240'), 'H4');
  assert.equal(parseInterval('4h'), 'H4');
  assert.equal(parseInterval('D'), 'D1');
  assert.equal(parseInterval('w'), 'W1');
  assert.equal(parseInterval('mn'), 'MN1');
  assert.equal(parseInterval('7'), null);
  assert.equal(parseInterval('5h'), null);
});

test('bar ends and countdowns', () => {
  assert.equal(barEnd(T0, 'M15'), T0 + 900);
  assert.equal(barEnd(Date.UTC(2026, 1, 1) / 1000, 'MN1'), Date.UTC(2026, 2, 1) / 1000, 'February has 28 days');
  assert.equal(countdown(135), '02:15');
  assert.equal(countdown(3725), '01:02:05');
  assert.equal(countdown(90061), '1d 01:01:01');
  assert.equal(countdown(-5), '00:00');
  assert.equal(crosshairTime(T0 + 14 * 3600 + 15 * 60, 'M15'), "Tue 24 Nov '26  14:15");
  assert.equal(crosshairTime(T0, 'D1'), "Tue 24 Nov '26");
});

test('time labels: days are major, hours in between', () => {
  const times = [];
  for (let i = 0; i < 400; i++) times.push(T0 - 86400 + i * 900);   // M15 from Monday 00:00
  assert.equal(labelStep('M15', 6), 14400, '90 px at 6 px a bar is 15 bars: 4 hours');
  const labels = timeLabels(times, 0, 399, 'M15', 6);
  const day = labels.find((l) => l.major);
  assert.equal(day.text, '24');
  assert.equal(times[day.i], T0);
  assert.ok(labels.some((l) => l.text === '04:00' && !l.major));
  for (let k = 1; k < labels.length; k++) assert.ok((labels[k].i - labels[k - 1].i) * 6 >= 59, 'labels keep apart');
  const months = [];
  for (let i = 0; i < 120; i++) months.push(Date.UTC(2020, i, 1) / 1000);
  const ml = timeLabels(months, 0, 119, 'MN1', 6);
  assert.ok(ml.some((l) => l.text === '2021' && l.major), 'years on a monthly chart');
});

function makeSeries() {
  const s = new Series('XAUUSD', 'M15', 2);
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push([T0 + i * 900, 100 + i, 101 + i, 99 + i, 100.5 + i, 10]);
  s.setHistory(rows, false);
  return s;
}

test('series: live bars update, append and finish the bar before', () => {
  const s = makeSeries();
  assert.equal(s.live([T0 + 9 * 900, 109, 112, 108, 111, 12]), 'update');
  assert.equal(s.last.h, 112);
  assert.equal(s.live([T0 + 10 * 900, 111, 111, 111, 111, 1]), 'append');
  assert.equal(s.length, 11);
  assert.equal(s.live([T0 + 9 * 900, 109, 113, 108, 111, 15]), 'old');
  assert.equal(s.bars[9].h, 113);
  assert.equal(s.live([T0 - 5 * 900, 1, 1, 1, 1, 1]), 'ignored');
});

test('series: older bars go in front once', () => {
  const s = makeSeries();
  const added = s.prepend([[T0 - 1800, 90, 91, 89, 90, 1], [T0 - 900, 91, 92, 90, 91, 1], [T0, 0, 0, 0, 0, 0]], false);
  assert.equal(added, 2);
  assert.equal(s.bars[0].t, T0 - 1800);
  assert.equal(s.bars[2].o, 100, 'a bar already held is kept');
  assert.equal(s.done, false);
  assert.equal(s.prepend([], true), 0);
  assert.equal(s.done, true);
});

test('series: times and bar positions', () => {
  const s = makeSeries();
  assert.equal(s.indexAt(T0 + 3 * 900), 3);
  assert.equal(s.indexAt(T0 + 3 * 900 + 450), 3.5);
  assert.equal(s.indexAt(T0 + 12 * 900), 12, 'after the last bar it counts on');
  assert.equal(s.indexAt(T0 - 2 * 900), -2, 'before the first bar too');
  assert.equal(s.timeAt(3), T0 + 2700);
  assert.equal(s.timeAt(12), T0 + 12 * 900);
  assert.equal(s.timeAt(s.indexAt(T0 + 1234)), T0 + 1234);
  assert.deepEqual(s.range(2, 4), { lo: 101, hi: 105 });
  assert.equal(s.range(20, 30), null);
  // A gap (a weekend): a time inside it falls between the bars around it.
  const g = new Series('X', 'H1', 2);
  g.setHistory([[0, 1, 1, 1, 1], [3600, 1, 1, 1, 1], [3600 * 50, 1, 1, 1, 1]], true);
  assert.equal(g.indexAt(3600 * 25.5), 1.5);
  assert.equal(g.secondsLeft(3600 * 50 + 600), 3000);
});

test('view: positions, zoom and fit', () => {
  const v = new View();
  v.w = 600;
  v.h = 400;
  v.barW = 10;
  v.right = 100;
  assert.equal(v.xOf(100), 595);
  assert.equal(v.iOf(595), 100);
  const under = v.iOf(300);
  v.zoomAt(2, 300);
  assert.equal(v.barW, 20);
  assert.ok(Math.abs(v.iOf(300) - under) < 1e-9, 'the bar under the mouse stays');
  v.fit(100, 200, 0.1, 0.1);
  assert.ok(Math.abs(v.yOf(200) - 40) < 1e-9 && Math.abs(v.yOf(100) - 360) < 1e-9, 'margins of 10%');
  assert.ok(Math.abs(v.pOf(v.yOf(150)) - 150) < 1e-9);
  v.scalePrice(2, 200);
  assert.equal(v.auto, false, 'dragging the scale ends auto scale');
  assert.ok(Math.abs(v.top - v.bottom - 250) < 1e-9);
  v.right = 5000;
  v.limit(200);
  assert.ok(v.right < 200 + 600 / 20, 'not scrolled far past the last bar');
});

test('price ticks are nice and far enough apart', () => {
  const t = priceTicks(2660, 2640, 400, 32);
  assert.deepEqual(t.slice(0, 3), [2640, 2642, 2644]);
  assert.ok(t.every((p) => p >= 2640 && p <= 2660));
  assert.equal(stepDigits(0.0005, 5), 5);
  assert.equal(stepDigits(2.5, 2), 2);
  assert.equal(stepDigits(0.25, 0), 2);
});

const GOLD = { digits: 2, point: 0.01, tickSize: 0.01, tickValue: 1, volMin: 0.01, volStep: 0.01, volMax: 100 };

test('long position: lots from the risk with MT5\'s tick value', () => {
  // Template "10 10": stop and target 1.00 away; 25% of 1000 = 250 at risk; 1.00 is 100 ticks of
  // $1 a lot, so 2.5 lots.
  const s = positionStats({ side: 1, entry: 2650, stop: 2649, target: 2651, spec: GOLD, symbol: 'XAUUSD', accountSize: 1000, risk: 25, riskMode: 'percent', price: 2650.5 });
  assert.equal(s.lots, 2.5);
  assert.equal(s.riskMoney, 250);
  assert.equal(s.stopAmount, 250);
  assert.equal(s.targetAmount, 250);
  assert.equal(s.rr, 1);
  assert.ok(Math.abs(s.stopPips - 10) < 1e-9, '1.00 on gold is 10 pips');
  assert.ok(Math.abs(s.openPL - 125) < 1e-9);
  const short = positionStats({ side: -1, entry: 2650, stop: 2653, target: 2644, spec: GOLD, symbol: 'XAUUSD', accountSize: 10000, risk: 300, riskMode: 'money', price: 2651 });
  assert.equal(short.lots, 1);
  assert.equal(short.rr, 2);
  assert.equal(short.openPL, -100);
});

test('position: lots round down to the step, and too little risk is shown', () => {
  const s = positionStats({ side: 1, entry: 100, stop: 97, target: 106, spec: GOLD, symbol: 'XAUUSD', accountSize: 1000, risk: 1, riskMode: 'percent' });
  assert.equal(s.lots, 0.03, '10 / 300 = 0.0333 -> 0.03');
  const tiny = positionStats({ side: 1, entry: 100, stop: 50, target: 150, spec: GOLD, symbol: 'XAUUSD', accountSize: 100, risk: 1, riskMode: 'percent' });
  assert.equal(tiny.tooSmall, true);
  assert.equal(tiny.lots, 0);
  assert.equal(tiny.stopAmount, 1, 'the amount meant to be risked');
  assert.equal(tiny.targetAmount, 1);
  assert.ok(Math.abs(tiny.exactLots - 0.0002) < 1e-12);
  assert.equal(tiny.minLots, 0.01);
  const units = positionStats({ side: 1, entry: 100, stop: 98, target: 104, accountSize: 1000, risk: 2, riskMode: 'percent' });
  assert.equal(units.units, 10, 'without a spec: 20 at risk over 2 = 10 units');
  assert.deepEqual(levelsFor(-1, 100, 2, 3), { stop: 102, target: 97 });
});
