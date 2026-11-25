import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drawings } from '../web/js/drawings.js';
import { TOOLS, distSeg, inPoly, extend, usableDistance } from '../web/js/tools.js';
import { readTemplates, mergeTemplates, toolStart, chartStart, emptyTemplates } from '../web/js/templates.js';

// A chart without a canvas: bar i at x = 10 i, price p at y = 1000 - p; times are 60 s a bar.
function ctx() {
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, a]) && { width: 10 }), set: (o, k, v) => ((o[k] = v), true) });
  g.measureText = () => ({ width: 50 });
  return {
    g, w: 800, h: 600, barW: 10, bg: '#000', priceSpan: 100,
    x: (t) => t / 6, y: (p) => 1000 - p, fmt: (p) => p.toFixed(2), price: 950, spec: null, symbol: 'XAUUSD', pip: 0.1,
    priceTags: [], timeTags: [], equity: 0,
    indexOf: (t) => t / 60, timeAfter: (t, n) => t + n * 60, bars: (a, b) => Math.abs(b - a) / 60, duration: () => '1h',
    toPoint: (x, y) => ({ t: Math.round(x / 10) * 60, p: 1000 - y }),
    calls,
  };
}

test('geometry', () => {
  assert.equal(distSeg(5, 5, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(distSeg(15, 0, { x: 0, y: 0 }, { x: 10, y: 0 }), 5, 'past the end, to the end point');
  assert.ok(inPoly(5, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  assert.ok(!inPoly(15, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  const [a, b] = extend({ x: 0, y: 0 }, { x: 10, y: 0 }, false, true, 100, 100);
  assert.equal(a.x, 0);
  assert.ok(b.x > 500, 'extended far to the right');
});

test('a trend line: press, drag, release', () => {
  const d = new Drawings();
  const c = ctx();
  let saved = null;
  d.onChange = (items) => (saved = items);
  d.setTool('trend');
  assert.ok(d.down(c, 100, 500));
  d.move(c, 200, 400);
  d.up(c, 200, 400);
  assert.equal(d.items.length, 1);
  const it = d.items[0];
  assert.deepEqual(it.pts, [{ t: 600, p: 500 }, { t: 1200, p: 600 }]);
  assert.equal(d.tool, null, 'back to the cursor');
  assert.equal(d.selected, it.id);
  assert.ok(saved && saved.length === 1, 'saved');
  assert.ok(TOOLS.trend.hit(c, it, 150, 450), 'the line is hit in its middle');
  assert.ok(!TOOLS.trend.hit(c, it, 150, 300));
});

test('a trend line: click, move, click', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('trend');
  d.down(c, 100, 500);
  d.up(c, 100, 500);
  assert.equal(d.items.length, 0, 'not finished after one click');
  d.move(c, 300, 450);
  d.down(c, 300, 450);
  d.up(c, 300, 450);
  assert.equal(d.items.length, 1);
  assert.deepEqual(d.items[0].pts[1], { t: 1800, p: 550 });
});

test('a channel takes three points; a path ends with Enter', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('channel');
  d.down(c, 100, 500);
  d.move(c, 300, 500);
  d.up(c, 300, 500);
  d.move(c, 300, 450);
  d.down(c, 300, 450);
  d.up(c, 300, 450);
  assert.equal(d.items.length, 1);
  assert.equal(TOOLS.channel.offset(d.items[0]), 50);
  d.setTool('path');
  for (const x of [100, 200, 300]) {
    d.move(c, x, 500);
    d.down(c, x, 500);
    d.up(c, x, 500);
  }
  d.move(c, 400, 500);
  assert.ok(d.key({ key: 'Enter' }));
  assert.equal(d.items.length, 2);
  assert.equal(d.items[1].pts.length, 3, 'the point following the mouse is left out');
});

test('one-click tools, and a long position from a template', () => {
  const d = new Drawings();
  const c = ctx();
  d.templateFor = (type) => ({ ...TOOLS[type].defaults, stopDistance: 1, targetDistance: 2 });
  d.setTool('long');
  d.down(c, 100, 50);
  d.up(c, 100, 50);
  const it = d.items[0];
  assert.equal(it.pts[0].p, 950);
  assert.equal(it.stop, 949);
  assert.equal(it.target, 952);
  d.setTool('short');
  d.down(c, 100, 50);
  const sh = d.items[1];
  assert.equal(sh.stop, 951);
  assert.equal(sh.target, 948);
  // Dragging the target handle moves only the target.
  d.select(it.id);
  const h = TOOLS.long.handles(c, it).find((q) => q.k === 1);
  d.down(c, h.x, h.y);
  d.move(c, h.x, h.y - 10);
  d.up(c, h.x, h.y - 10);
  assert.equal(it.target, 962);
  assert.equal(it.stop, 949);
  assert.equal(it.pts[0].p, 950);
  assert.deepEqual(d.templateOf(it).targetDistance, 12);
});

test('moving a drawing, undo and redo', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('hline');
  d.down(c, 100, 500);
  d.up(c, 100, 500);
  const it = d.items[0];
  d.select(null);
  assert.ok(d.down(c, 400, 500), 'pressing on the line takes it');
  d.move(c, 400, 480);
  d.up(c, 400, 480);
  assert.equal(d.items[0].pts[0].p, 520);
  assert.ok(d.undo());
  assert.equal(d.items[0].pts[0].p, 500);
  assert.ok(d.redo());
  assert.equal(d.items[0].pts[0].p, 520);
  assert.ok(d.undo() && d.undo());
  assert.equal(d.items.length, 0, 'undo goes back to before the line');
  assert.equal(it.id.length > 0, true);
});

test('a click without moving selects but does not move; locked drawings stay', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('hline');
  d.down(c, 100, 500);
  d.up(c, 100, 500);
  d.select(null);
  d.down(c, 400, 501);
  d.move(c, 401, 501);
  d.up(c, 401, 501);
  assert.equal(d.items[0].pts[0].p, 500);
  assert.equal(d.undoStack.length, 1, 'nothing to undo for a click');
  d.toggleLock(d.items[0].id);
  d.down(c, 400, 500);
  d.move(c, 400, 400);
  d.up(c, 400, 400);
  assert.equal(d.items[0].pts[0].p, 500);
});

test('delete, copy and paste, Esc', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('rect');
  d.down(c, 100, 100);
  d.move(c, 200, 200);
  d.up(c, 200, 200);
  assert.ok(d.key({ key: 'c', ctrlKey: true }));
  assert.ok(d.key({ key: 'v', ctrlKey: true }));
  assert.equal(d.items.length, 2);
  assert.notEqual(d.items[0].id, d.items[1].id);
  assert.ok(d.key({ key: 'Delete' }));
  assert.equal(d.items.length, 1);
  d.setTool('trend');
  d.down(c, 100, 100);
  assert.ok(d.key({ key: 'Escape' }));
  assert.equal(d.pending, null);
  assert.equal(d.items.length, 1);
});

test('every tool draws and hit-tests without throwing', () => {
  const c = ctx();
  for (const [type, tool] of Object.entries(TOOLS)) {
    const n = tool.n > 0 ? tool.n : 3;
    const it = { id: 'x', type, pts: [], s: JSON.parse(JSON.stringify(tool.defaults)) };
    for (let k = 0; k < n; k++) it.pts.push({ t: 600 + k * 600, p: 500 + k * 20 });
    if (tool.create) tool.create(c, it);
    tool.draw(c, it, { selected: true, hover: true });
    tool.hit(c, it, 120, 490);
  }
});

test('templates: read, merge and start from', () => {
  const { templates, count, skipped } = readTemplates({
    format: 'modern-screen-templates',
    chart: { 'My chart': { legend: { title: false } } },
    tools: { long: { '10 10': { stopDistance: 1, targetDistance: 1, risk: 25 } }, hline: { 'my base': { line: { color: '#c2185b', width: 2 } } }, nosuch: { a: {} } },
    defaults: { chart: 'My chart', tools: { hline: 'my base', long: 'missing' } },
  });
  assert.equal(count, 3);
  assert.equal(skipped, 1);
  assert.equal(templates.chart['My chart'].legend.title, false);
  assert.equal(templates.chart['My chart'].legend.ohlc, true, 'the rest from the default style');
  assert.equal(templates.tools.long['10 10'].riskMode, 'percent', 'the rest from the tool');
  assert.equal(templates.defaults.tools.long, undefined, 'a default naming a missing template is dropped');
  assert.equal(toolStart(templates, 'hline').line.width, 2);
  assert.equal(toolStart(templates, 'trend').line.width, 2);
  assert.equal(chartStart(templates).legend.title, false);
  const merged = mergeTemplates(emptyTemplates(), templates);
  assert.ok(merged.tools.long['10 10']);
  assert.equal(readTemplates({ format: 'something else' }).count, 0);
});

test('a template picked from the toolbar draws the next position with it', () => {
  const d = new Drawings();
  const c = ctx();
  d.setTool('long', { name: '150 150', s: { ...TOOLS.long.defaults, stopDistance: 15.03, targetDistance: 15.03, risk: 25 } });
  d.down(c, 100, 50);
  const it = d.items[0];
  assert.equal(it.s.risk, 25);
  assert.ok(Math.abs(it.stop - (950 - 15.03)) < 1e-9);
  assert.ok(Math.abs(it.target - (950 + 15.03)) < 1e-9);
  assert.equal(d.armed, null, 'the armed template is used once, then the cursor is back');
  d.stay = true;
  d.setTool('short', { name: '10 10', s: { ...TOOLS.short.defaults, stopDistance: 1, targetDistance: 1 } });
  d.down(c, 100, 50);
  d.down(c, 200, 60);
  assert.equal(d.items.length, 3, 'with "keep drawing" it stays armed');
  assert.equal(d.items[2].stop, 941);
});

test('a template\'s distances that make no sense at this price are not used', () => {
  assert.equal(usableDistance(5, 2650), true);
  assert.equal(usableDistance(5, 1.05), false, 'a gold distance on the euro');
  assert.equal(usableDistance(0, 1.05), false);
  const d = new Drawings();
  const c = { ...ctx(), priceSpan: 0.02 };
  d.setTool('long');
  d.down(c, 100, 999);   // price 1
  const it = d.items[0];
  d.applyTemplate(it.id, { ...TOOLS.long.defaults, stopDistance: 5, targetDistance: 5 });
  assert.ok(it.stop > 0, 'the stop stays above zero');
});
