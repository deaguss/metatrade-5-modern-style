import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readItems, addSymbol, removeAt, move, shownSymbols, allSymbols, viewOrder, symbolItem, sectionItem } from '../web/js/watchitems.js';

const names = (items) => items.map((it) => (it.type === 'section' ? '#' + it.name : it.name));

test('saved lists are checked', () => {
  const items = readItems([{ type: 'symbol', name: 'XAUUSD' }, { type: 'symbol', name: 'XAUUSD' }, { type: 'section', name: 'FOREX' }, { type: 'x', name: 'Y' }, null, { type: 'symbol', name: '' }]);
  assert.deepEqual(names(items), ['XAUUSD', '#FOREX'], 'a repeated symbol, unknown entries and empty names are left out');
  assert.deepEqual(readItems('nonsense'), []);
});

test('add, remove and move', () => {
  let items = [symbolItem('A'), symbolItem('B'), symbolItem('C')];
  items = addSymbol(items, 'D');
  assert.deepEqual(names(items), ['A', 'B', 'C', 'D']);
  assert.equal(addSymbol(items, 'B'), items, 'a symbol already there is not added twice');
  assert.deepEqual(names(removeAt(items, 1)), ['A', 'C', 'D']);
  assert.deepEqual(names(move(items, 0, 2)), ['B', 'A', 'C', 'D'], 'dragged down: before the row it was dropped on');
  assert.deepEqual(names(move(items, 3, 0)), ['D', 'A', 'B', 'C'], 'dragged to the top');
  assert.deepEqual(names(move(items, 0, 4)), ['B', 'C', 'D', 'A'], 'dragged to the end');
  assert.equal(move(items, 1, 1), items, 'dropped where it was');
  assert.equal(move(items, 1, 2), items, 'dropped just below itself');
});

test('sections: folded ones hide their symbols from the arrow keys', () => {
  const items = [sectionItem('METALS'), symbolItem('XAUUSD'), symbolItem('XAGUSD'), { ...sectionItem('FOREX'), closed: true }, symbolItem('EURUSD')];
  assert.deepEqual(shownSymbols(items), ['XAUUSD', 'XAGUSD']);
  assert.deepEqual(allSymbols(items), ['XAUUSD', 'XAGUSD', 'EURUSD'], 'quotes still come for every symbol');
});

test('sorting by a column keeps the sections where they are', () => {
  const items = [symbolItem('B'), symbolItem('A'), sectionItem('S'), symbolItem('D'), symbolItem('C')];
  const pct = { A: 1, B: -2, C: 5, D: 0 };
  const byName = viewOrder(items, { key: 'name', dir: 1 }, () => null).map((i) => names(items)[i]);
  assert.deepEqual(byName, ['A', 'B', '#S', 'C', 'D']);
  const byPctDown = viewOrder(items, { key: 'pct', dir: -1 }, (n) => ({ pct: pct[n] })).map((i) => names(items)[i]);
  assert.deepEqual(byPctDown, ['A', 'B', '#S', 'C', 'D']);
  const noQuotes = viewOrder(items, { key: 'pct', dir: 1 }, (n) => (n === 'A' ? { pct: 3 } : null)).map((i) => names(items)[i]);
  assert.deepEqual(noQuotes.slice(0, 2), ['A', 'B'], 'symbols without a price yet go last');
  assert.deepEqual(viewOrder(items, null, () => null), [0, 1, 2, 3, 4], 'unsorted: the trader\'s own order');
});
