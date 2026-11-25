// The watchlist's rows as data: symbols and sections, added, removed, moved, sorted. No page
// needed, so the tests use it on its own.
import { clamp } from './util.js';

export const symbolItem = (name) => ({ type: 'symbol', name });
export const sectionItem = (name) => ({ type: 'section', name, closed: false });

// The items as saved, checked: unknown entries and repeated symbols are left out.
export function readItems(data) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(data) ? data : []) {
    if (!it || typeof it.name !== 'string' || !it.name.trim()) continue;
    if (it.type === 'section') out.push({ type: 'section', name: it.name.slice(0, 40), closed: !!it.closed });
    else if (it.type === 'symbol' && !seen.has(it.name)) {
      seen.add(it.name);
      out.push(symbolItem(it.name));
    }
  }
  return out;
}

export function addSymbol(items, name, at = items.length) {
  if (items.some((it) => it.type === 'symbol' && it.name === name)) return items;
  const out = items.slice();
  out.splice(clamp(at, 0, out.length), 0, symbolItem(name));
  return out;
}

export function removeAt(items, i) {
  return items.filter((_, k) => k !== i);
}

// The item at `from` moved so that it lands before what is now at `to` (to = length: the end).
export function move(items, from, to) {
  if (from < 0 || from >= items.length || to === from || to === from + 1) return items;
  const out = items.slice();
  const [it] = out.splice(from, 1);
  out.splice(to > from ? to - 1 : to, 0, it);
  return out;
}

// The symbols in the order shown, skipping the closed sections' symbols.
export function shownSymbols(items) {
  const out = [];
  let closed = false;
  for (const it of items) {
    if (it.type === 'section') closed = it.closed;
    else if (!closed) out.push(it.name);
  }
  return out;
}

export function allSymbols(items) {
  return items.filter((it) => it.type === 'symbol').map((it) => it.name);
}

// The order to show the items in: sorted by a column within each section, or as they are.
// quote(name) -> {last, chg, pct}; sort = {key: 'name'|'last'|'chg'|'pct', dir: 1|-1} or null.
export function viewOrder(items, sort, quote) {
  const idx = items.map((_, i) => i);
  if (!sort) return idx;
  const out = [];
  let group = [];
  const value = (i) => (sort.key === 'name' ? items[i].name : (quote(items[i].name) || {})[sort.key]);
  const flush = () => {
    group.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === undefined || Number.isNaN(va)) return 1;
      if (vb === undefined || Number.isNaN(vb)) return -1;
      return (typeof va === 'string' ? va.localeCompare(vb, 'en', { numeric: true }) : va - vb) * sort.dir;
    });
    out.push(...group);
    group = [];
  };
  for (const i of idx) {
    if (items[i].type === 'section') {
      flush();
      out.push(i);
    } else group.push(i);
  }
  flush();
  return out;
}
