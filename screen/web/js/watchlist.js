// The watchlist: the screen's own list of symbols and sections, filled from MT5's Market Watch
// the first time. Add with +, remove with x, Delete or a right-click, drag rows to reorder, sort by
// a column, arrow keys to step through the symbols, drag the panel's left edge to resize it.
import { el, esc, menu, prompt, confirmBox } from './ui.js';
import { icon } from './icons.js';
import { formatPrice, clamp } from './util.js';
import { readItems, addSymbol, removeAt, move, shownSymbols, allSymbols, viewOrder, sectionItem } from './watchitems.js';

// ---- on the page -------------------------------------------------------------------------------

const COLS = [['name', 'Symbol'], ['last', 'Last'], ['chg', 'Chg'], ['pct', 'Chg%']];

export class Watchlist {
  // opts: onPick(symbol), onChange(items) (save), onSymbols() (the quotes to ask for changed),
  // onAdd() (open the symbol search to add one), onWidth(px), digitsOf(symbol)
  constructor(root, opts) {
    this.root = root;
    this.o = opts;
    this.items = [];
    this.current = '';
    this.sort = null;
    this.quotes = new Map();   // symbol -> {bid, prev}
    this.rows = new Map();     // symbol -> {el, last, chg, pct, prevBid}
    root.innerHTML = '';
    root.tabIndex = 0;
    const grip = el('div', 'watch-resize');
    grip.title = 'Drag to make the panel wider or narrower';
    root.appendChild(grip);
    const head = el('div', 'watch-head', '<span>Watchlist</span>');
    const tools = el('div', 'watch-tools');
    const add = el('button', 'icon-btn', icon('plus', 18));
    add.type = 'button';
    add.title = 'Add a symbol';
    add.addEventListener('click', () => this.o.onAdd());
    const more = el('button', 'icon-btn', icon('more', 18));
    more.type = 'button';
    more.title = 'More';
    more.addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      menu(this.listMenu(), r.left - 160, r.bottom + 4);
    });
    tools.append(add, more);
    head.appendChild(tools);
    root.appendChild(head);
    this.cols = el('div', 'watch-cols');
    root.appendChild(this.cols);
    this.list = el('div', 'watch-list');
    root.appendChild(this.list);
    this.marker = el('div', 'watch-drop');
    this.bindResize(grip);
    this.bindKeys();
    this.paintCols();
  }

  setItems(items) {
    this.items = readItems(items);
    this.render();
    this.o.onSymbols();
  }

  change(items) {
    this.items = items;
    this.render();
    this.o.onChange(this.items);
    this.o.onSymbols();
  }

  symbols() {
    return allSymbols(this.items);
  }

  has(name) {
    return this.items.some((it) => it.type === 'symbol' && it.name === name);
  }

  add(name) {
    if (this.has(name)) {
      this.scrollTo(name);
      return;
    }
    this.change(addSymbol(this.items, name));
    this.scrollTo(name);
  }

  setCurrent(name) {
    this.current = name;
    for (const [n, r] of this.rows) r.el.classList.toggle('on', n === name);
  }

  scrollTo(name) {
    const r = this.rows.get(name);
    if (r) r.el.scrollIntoView({ block: 'nearest' });
  }

  values(name) {
    const q = this.quotes.get(name);
    if (!q) return null;
    const chg = q.prev > 0 ? q.bid - q.prev : NaN;
    return { last: q.bid, chg, pct: q.prev > 0 ? (chg / q.prev) * 100 : NaN };
  }

  paintCols() {
    this.cols.innerHTML = '';
    for (const [key, label] of COLS) {
      const s = this.sort && this.sort.key === key ? (this.sort.dir > 0 ? ' \u25b2' : ' \u25bc') : '';
      const b = el('button', 'watch-col c-' + key, esc(label) + s);
      b.type = 'button';
      b.title = 'Sort by ' + label.toLowerCase() + ' (click again to reverse, a third time for your own order)';
      b.addEventListener('click', () => {
        if (!this.sort || this.sort.key !== key) this.sort = { key, dir: 1 };
        else if (this.sort.dir > 0) this.sort = { key, dir: -1 };
        else this.sort = null;
        this.paintCols();
        this.render();
      });
      this.cols.appendChild(b);
    }
  }

  render() {
    this.list.innerHTML = '';
    this.rows.clear();
    let closed = false;
    for (const i of viewOrder(this.items, this.sort, (n) => this.values(n))) {
      const it = this.items[i];
      if (it.type === 'section') {
        closed = it.closed;
        const r = el('div', 'watch-section' + (it.closed ? ' closed' : ''), '<span class="caret">' + icon('chevron', 12) + '</span><span class="n">' + esc(it.name) + '</span><button type="button" class="x" title="Remove the section">' + icon('close', 14) + '</button>');
        r.dataset.i = i;
        this.bindRow(r, i);
        this.list.appendChild(r);
        continue;
      }
      if (closed) continue;
      const r = el('div', 'watch-row' + (it.name === this.current ? ' on' : ''),
        '<span class="n">' + esc(it.name) + '</span><span class="p">-</span><span class="ch">-</span><span class="c">-</span>' +
        '<button type="button" class="x" title="Remove from the watchlist (Delete)">' + icon('close', 14) + '</button>');
      r.dataset.i = i;
      this.bindRow(r, i);
      this.list.appendChild(r);
      const row = { el: r, last: r.querySelector('.p'), chg: r.querySelector('.ch'), pct: r.querySelector('.c'), prevBid: NaN };
      this.rows.set(it.name, row);
      const q = this.quotes.get(it.name);
      if (q) this.paint(it.name, q, false);
    }
    if (!this.items.length) this.list.appendChild(el('div', 'watch-empty', 'No symbols. Press + to add one.'));
  }

  quote(q) {
    this.quotes.set(q.sym, q);
    this.paint(q.sym, q, true);
  }

  paint(name, q, flash) {
    const r = this.rows.get(name);
    if (!r) return;
    const d = this.o.digitsOf(name);
    r.last.textContent = formatPrice(q.bid, d);
    if (flash && Number.isFinite(r.prevBid) && q.bid !== r.prevBid && r.last.animate) {
      r.last.animate([{ color: q.bid > r.prevBid ? '#22ab94' : '#ff6b76' }], { duration: 450, easing: 'ease-out' });
    }
    r.prevBid = q.bid;
    if (q.prev > 0) {
      const ch = q.bid - q.prev;
      const cls = ch >= 0 ? 'up' : 'down';
      r.chg.textContent = (ch >= 0 ? '+' : '') + formatPrice(ch, d);
      r.pct.textContent = (ch >= 0 ? '+' : '') + ((ch / q.prev) * 100).toFixed(2) + '%';
      r.chg.className = 'ch ' + cls;
      r.pct.className = 'c ' + cls;
    }
  }

  // A row: click opens its chart (or folds a section), drag moves it, x removes it, right-click
  // shows the rest.
  bindRow(r, i) {
    const it = this.items[i];
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.x')) return;
      const startY = e.clientY;
      let dragging = false;
      r.setPointerCapture(e.pointerId);
      const moveTo = (ev) => {
        if (!dragging && Math.abs(ev.clientY - startY) > 4) {
          if (this.sort) return;   // a sorted list keeps the sort's order
          dragging = true;
          r.classList.add('dragging');
          this.list.appendChild(this.marker);
        }
        if (dragging) this.placeMarker(ev.clientY);
      };
      const up = (ev) => {
        r.removeEventListener('pointermove', moveTo);
        r.removeEventListener('pointerup', up);
        r.removeEventListener('pointercancel', up);
        if (dragging) {
          r.classList.remove('dragging');
          const to = this.dropIndex(ev.clientY);
          this.marker.remove();
          if (ev.type === 'pointerup') this.change(move(this.items, i, to));
          return;
        }
        if (it.type === 'section') {
          it.closed = !it.closed;
          this.change(this.items.slice());
        } else this.o.onPick(it.name);
        this.root.focus({ preventScroll: true });
      };
      r.addEventListener('pointermove', moveTo);
      r.addEventListener('pointerup', up);
      r.addEventListener('pointercancel', up);
    });
    r.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      this.change(removeAt(this.items, i));
    });
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(this.rowMenu(i), e.clientX, e.clientY);
    });
  }

  // Where a dragged row would land: before the row under the pointer's upper half.
  dropIndex(y) {
    const rows = [...this.list.querySelectorAll('.watch-row, .watch-section')];
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) return Number(r.dataset.i);
    }
    return this.items.length;
  }

  placeMarker(y) {
    const rows = [...this.list.querySelectorAll('.watch-row, .watch-section')];
    const lb = this.list.getBoundingClientRect();
    let top = rows.length ? rows[rows.length - 1].getBoundingClientRect().bottom : lb.top;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) {
        top = b.top;
        break;
      }
    }
    this.marker.style.top = top - lb.top + this.list.scrollTop - 1 + 'px';
  }

  rowMenu(i) {
    const it = this.items[i];
    const m = [];
    if (it.type === 'symbol') m.push({ label: 'Open ' + it.name, action: () => this.o.onPick(it.name) });
    else {
      m.push({ label: it.closed ? 'Open the section' : 'Fold the section', action: () => {
        it.closed = !it.closed;
        this.change(this.items.slice());
      } });
      m.push({ label: 'Rename...', action: async () => {
        const name = await prompt({ title: 'Rename the section', value: it.name });
        if (name && name.trim()) {
          it.name = name.trim().slice(0, 40);
          this.change(this.items.slice());
        }
      } });
    }
    m.push({ label: 'Add a section above...', action: () => this.addSection(i) });
    m.push({ label: 'Move to the top', disabled: i === 0, action: () => this.change(move(this.items, i, 0)) });
    m.push({ sep: true });
    m.push({ label: it.type === 'symbol' ? 'Remove from the watchlist' : 'Remove the section', icon: 'trash', hint: 'Delete', danger: true, action: () => this.change(removeAt(this.items, i)) });
    return m;
  }

  listMenu() {
    return [
      { label: 'Add a symbol...', icon: 'plus', action: () => this.o.onAdd() },
      { label: 'Add a section...', action: () => this.addSection(0) },
      { sep: true },
      { label: 'Add every Market Watch symbol', action: () => {
        let items = this.items;
        for (const n of this.o.marketWatch()) items = addSymbol(items, n);
        this.change(items);
      } },
      { label: 'Sort by name, for good', action: () => {
        const order = viewOrder(this.items, { key: 'name', dir: 1 }, () => null);
        this.sort = null;
        this.paintCols();
        this.change(order.map((i) => this.items[i]));
      } },
      { sep: true },
      { label: 'Clear the watchlist...', icon: 'trash', danger: true, disabled: !this.items.length, action: async () => {
        if (await confirmBox({ title: 'Clear the watchlist', text: 'Remove all ' + this.items.length + ' rows from the watchlist? Market Watch in MT5 stays as it is.' })) this.change([]);
      } },
    ];
  }

  async addSection(at) {
    const name = await prompt({ title: 'Add a section', label: 'The section\'s name (for example FOREX or METALS):' });
    if (!name || !name.trim()) return;
    const out = this.items.slice();
    out.splice(at, 0, sectionItem(name.trim().slice(0, 40).toUpperCase()));
    this.change(out);
  }

  // Up and down step through the symbols and open each; Delete removes the open one.
  bindKeys() {
    this.root.addEventListener('keydown', (e) => {
      if (e.target !== this.root) return;
      const shown = shownSymbols(viewOrder(this.items, this.sort, (n) => this.values(n)).map((i) => this.items[i]));
      const at = shown.indexOf(this.current);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = shown[clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, shown.length - 1)];
        if (next && next !== this.current) {
          this.o.onPick(next);
          this.scrollTo(next);
        }
      } else if (e.key === 'Delete' && at >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const i = this.items.findIndex((it) => it.type === 'symbol' && it.name === this.current);
        if (i >= 0) this.change(removeAt(this.items, i));
      }
    });
  }

  bindResize(grip) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = this.root.getBoundingClientRect().width;
      const moveTo = (ev) => this.setWidth(startW + (startX - ev.clientX));
      const up = () => {
        grip.removeEventListener('pointermove', moveTo);
        grip.removeEventListener('pointerup', up);
        this.o.onWidth(Math.round(this.root.getBoundingClientRect().width));
      };
      grip.addEventListener('pointermove', moveTo);
      grip.addEventListener('pointerup', up);
    });
    grip.addEventListener('dblclick', () => {
      this.setWidth(300);
      this.o.onWidth(300);
    });
  }

  setWidth(px) {
    const w = clamp(Math.round(px), 200, Math.max(220, Math.min(640, window.innerWidth * 0.5)));
    this.root.style.width = w + 'px';
    this.root.classList.toggle('narrow', w < 270);
  }
}
