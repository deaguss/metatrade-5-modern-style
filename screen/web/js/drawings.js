// The drawings on the chart: creating them with the mouse, selecting, moving, the handles, undo and
// redo, copy and paste, the magnet, lock and hide. The chart calls in with a context (see tools.js)
// and mouse positions in plot pixels.
import { TOOLS, handlesOf, usableDistance } from './tools.js';
import { clone, uid } from './util.js';
import { setPath, getPath } from './style.js';

const DRAG_START = 3;    // pixels the mouse moves before a press becomes a drag
const UNDO_MAX = 100;

export class Drawings {
  constructor() {
    this.items = [];
    this.selected = null;     // id
    this.hover = null;        // id
    this.tool = null;         // the tool being drawn with, or null for the cursor
    this.stay = false;        // keep the tool after one drawing
    this.magnet = false;
    this.locked = false;      // every drawing locked
    this.hidden = false;      // every drawing hidden
    this.pending = null;      // {it, fixed, down}
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = null;
    this.armed = null;        // {type, name, s}: the template the next drawing of that tool starts from
    this.owner = null;        // the symbol these drawings belong to; null while they are being read
    this.templateFor = (type) => clone(TOOLS[type].defaults);   // the app sets the current templates
    this.onChange = () => {};
    this.onSelect = () => {};
    this.onTool = () => {};
    this.onEditText = () => {};
  }

  load(items) {
    this.items = Array.isArray(items) ? items.filter((it) => it && TOOLS[it.type] && Array.isArray(it.pts) && it.pts.length) : [];
    for (const it of this.items) it.s = { ...clone(TOOLS[it.type].defaults), ...it.s };
    this.selected = null;
    this.hover = null;
    this.pending = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.onSelect(null);
  }

  get(id) {
    return this.items.find((it) => it.id === id) || null;
  }

  get selectedItem() {
    return this.get(this.selected);
  }

  // The tool to draw with; armed: a template {name, s} the drawings of this tool start from.
  setTool(type, armed) {
    this.cancel();
    this.tool = type && TOOLS[type] ? type : null;
    this.armed = this.tool && armed ? { type: this.tool, name: armed.name, s: clone(armed.s) } : null;
    if (this.tool) this.select(null);
    this.onTool(this.tool);
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.onSelect(this.selectedItem);
  }

  // ---- undo -----------------------------------------------------------------------------------

  remember() {
    this.undoStack.push(JSON.stringify(this.items));
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
  }

  changed() {
    this.onChange(this.items);
    if (this.selected && !this.get(this.selected)) this.select(null);
    else this.onSelect(this.selectedItem);
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.undoStack.pop());
    this.changed();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.items));
    this.items = JSON.parse(this.redoStack.pop());
    this.changed();
    return true;
  }

  // ---- changes from the toolbar and dialogs ---------------------------------------------------

  setStyle(id, path, value) {
    const it = this.get(id);
    if (!it) return;
    this.remember();
    if (path === '@entry') {
      it.pts[0].p = value;
      if (it.pts[1]) it.pts[1].p = value;
    } else if (path === '@stop') it.stop = value;
    else if (path === '@target') it.target = value;
    else setPath(it.s, path, value);
    this.changed();
  }

  // Replaces a drawing's settings, keeping what is not a setting (points, levels).
  applyStyle(id, s) {
    const it = this.get(id);
    if (!it) return;
    this.remember();
    it.s = { ...clone(TOOLS[it.type].defaults), ...clone(s) };
    this.changed();
  }

  // A position template's distances move its stop and target (from its entry).
  applyTemplate(id, s) {
    const it = this.get(id);
    if (!it) return;
    this.applyStyle(id, s);
    const tool = TOOLS[it.type];
    const e = it.pts[0].p;
    if (tool.side && (usableDistance(s.stopDistance, e) || usableDistance(s.targetDistance, e))) {
      if (usableDistance(s.stopDistance, e)) it.stop = e - tool.side * s.stopDistance;
      if (usableDistance(s.targetDistance, e)) it.target = e + tool.side * s.targetDistance;
      this.changed();
    }
  }

  remove(id) {
    if (!this.get(id)) return;
    this.remember();
    this.items = this.items.filter((it) => it.id !== id);
    this.changed();
  }

  removeAll() {
    if (!this.items.length) return;
    this.remember();
    this.items = [];
    this.changed();
  }

  toggleLock(id) {
    const it = this.get(id);
    if (!it) return;
    this.remember();
    it.locked = !it.locked;
    this.changed();
  }

  duplicate(id) {
    const it = this.get(id);
    if (!it) return null;
    this.remember();
    const copy = clone(it);
    copy.id = uid();
    copy.locked = false;
    this.items.push(copy);
    this.selected = copy.id;
    this.changed();
    return copy;
  }

  toFront(id) {
    const it = this.get(id);
    if (!it) return;
    this.remember();
    this.items = this.items.filter((x) => x !== it).concat([it]);
    this.changed();
  }

  toBack(id) {
    const it = this.get(id);
    if (!it) return;
    this.remember();
    this.items = [it].concat(this.items.filter((x) => x !== it));
    this.changed();
  }

  copy() {
    const it = this.selectedItem;
    if (it) this.clipboard = clone(it);
  }

  paste() {
    if (!this.clipboard) return;
    this.remember();
    const copy = clone(this.clipboard);
    copy.id = uid();
    this.items.push(copy);
    this.selected = copy.id;
    this.changed();
  }

  // ---- painting -------------------------------------------------------------------------------

  draw(c) {
    if (this.hidden) {
      if (this.pending) this.drawItem(c, this.pending.it, { selected: true, hover: false });
      return;
    }
    for (const it of this.items) {
      if (it.hidden) continue;
      this.drawItem(c, it, { selected: it.id === this.selected, hover: it.id === this.hover });
    }
    if (this.pending) this.drawItem(c, this.pending.it, { selected: true, hover: false });
    const sel = this.selectedItem;
    if (sel && !sel.hidden) this.drawHandles(c, sel);
  }

  drawItem(c, it, state) {
    const g = c.g;
    g.save();
    try {
      TOOLS[it.type].draw(c, it, state);
    } catch (e) {
      // A drawing with bad numbers must not stop the chart.
    }
    g.restore();
  }

  drawHandles(c, it) {
    const g = c.g;
    g.save();
    g.setLineDash([]);
    for (const h of handlesOf(c, it)) {
      g.beginPath();
      g.arc(h.x, h.y, 5, 0, Math.PI * 2);
      g.fillStyle = c.bg;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = it.locked || this.locked ? '#787b86' : '#2962ff';
      g.stroke();
    }
    g.restore();
  }

  // ---- the mouse ------------------------------------------------------------------------------

  hitHandle(c, x, y) {
    const it = this.selectedItem;
    if (!it || it.hidden || this.hidden) return null;
    // The nearest handle wins: a position's entry and target may be only a few pixels apart.
    let best = null;
    for (const h of handlesOf(c, it)) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= 8 && (!best || d < best.d)) best = { it, k: h.k, d };
    }
    return best;
  }

  hitItem(c, x, y) {
    if (this.hidden) return null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.hidden) continue;
      try {
        if (TOOLS[it.type].hit(c, it, x, y)) return it;
      } catch (e) {
        // ignore a drawing that cannot be measured
      }
    }
    return null;
  }

  // The cursor for the mouse at (x, y) when nothing is pressed.
  cursorAt(c, x, y) {
    if (this.tool || this.pending) return 'crosshair';
    if (this.hitHandle(c, x, y)) return 'pointer';
    const it = this.hitItem(c, x, y);
    this.hover = it ? it.id : null;
    return it ? (it.locked || this.locked ? 'pointer' : 'move') : '';
  }

  // A press on the plot. true when the drawings took it (else the chart pans).
  down(c, x, y) {
    if (this.tool || this.pending) {
      this.createDown(c, x, y);
      return true;
    }
    const h = this.hitHandle(c, x, y);
    if (h) {
      this.drag = { kind: 'handle', it: h.it, k: h.k, x, y, started: false };
      return true;
    }
    const it = this.hitItem(c, x, y);
    if (it) {
      this.select(it.id);
      this.drag = { kind: 'move', it, x, y, started: false, from: clone(it), start: c.toPoint(x, y, false) };
      return true;
    }
    this.select(null);
    return false;
  }

  move(c, x, y) {
    if (this.pending) {
      this.pending.it.pts[this.pending.it.pts.length - 1] = c.toPoint(x, y, this.magnet);
      return true;
    }
    const d = this.drag;
    if (!d) return false;
    if (!d.started) {
      if (Math.hypot(x - d.x, y - d.y) < DRAG_START) return true;
      if (d.it.locked || this.locked) return true;
      d.started = true;
      this.remember();
    }
    if (d.kind === 'handle') {
      const pt = c.toPoint(x, y, this.magnet);
      const tool = TOOLS[d.it.type];
      if (tool.drag) tool.drag(d.it, d.k, pt);
      else d.it.pts[d.k] = pt;
    } else {
      const now = c.toPoint(x, y, false);
      const bars = Math.round(c.indexOf(now.t) - c.indexOf(d.start.t));
      const dp = now.p - d.start.p;
      const tool = TOOLS[d.it.type];
      d.it.pts = d.from.pts.map((q) => ({ t: d.it.type === 'hline' ? q.t : c.timeAfter(q.t, bars), p: d.it.type === 'vline' ? q.p : q.p + dp }));
      if (tool.move) {
        d.it.stop = d.from.stop;
        d.it.target = d.from.target;
        tool.move(d.it, dp);
      }
    }
    return true;
  }

  up(c, x, y) {
    if (this.pending) {
      const p = this.pending;
      if (p.down && Math.hypot(x - p.down.x, y - p.down.y) > 5) this.fix(c);
      if (this.pending) this.pending.down = null;
      return true;
    }
    const d = this.drag;
    this.drag = null;
    if (d && d.started) {
      this.changed();
      return true;
    }
    return !!d;
  }

  dblclick(c, x, y) {
    if (this.pending && this.pending.it.type === 'path') {
      this.finishPath();
      return true;
    }
    const it = this.hitItem(c, x, y);
    return it || null;
  }

  createDown(c, x, y) {
    const pt = c.toPoint(x, y, this.magnet);
    if (!this.pending) {
      const type = this.tool;
      const tool = TOOLS[type];
      const start = this.armed && this.armed.type === type ? clone(this.armed.s) : this.templateFor(type);
      const it = { id: uid(), type, pts: [pt], s: start };
      if (tool.n === 1) {
        if (tool.create) tool.create(c, it);
        this.remember();
        this.items.push(it);
        this.finished(it);
        return;
      }
      it.pts.push({ ...pt });
      this.pending = { it, fixed: 1, down: { x, y } };
      return;
    }
    this.pending.it.pts[this.pending.it.pts.length - 1] = pt;
    this.pending.down = { x, y };
    this.fix(c);
  }

  // The moving point stays where it is; the drawing is finished, or a next point follows the mouse.
  fix() {
    const p = this.pending;
    const n = TOOLS[p.it.type].n;
    p.fixed++;
    if (n > 0 && p.fixed >= n) {
      this.pending = null;
      this.remember();
      this.items.push(p.it);
      this.finished(p.it);
      return;
    }
    const last = p.it.pts[p.it.pts.length - 1];
    p.it.pts.push({ ...last });
  }

  finishPath() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const pts = p.it.pts.slice(0, p.fixed);
    if (pts.length < 2) {
      this.onTool(this.tool);
      return;
    }
    p.it.pts = pts;
    this.remember();
    this.items.push(p.it);
    this.finished(p.it);
  }

  finished(it) {
    this.selected = it.id;
    if (!this.stay) {
      this.tool = null;
      this.armed = null;
    }
    this.onTool(this.tool);
    this.changed();
    if (it.type === 'text') this.onEditText(it);
  }

  // Esc: a drawing being made is dropped (a path keeps the points made), a selection cleared.
  cancel() {
    if (this.pending) {
      if (this.pending.it.type === 'path' && this.pending.fixed >= 2) this.finishPath();
      else this.pending = null;
      return true;
    }
    if (this.drag && this.drag.started) {
      this.undo();
      this.redoStack.pop();
      this.drag = null;
      return true;
    }
    return false;
  }

  // Keys when the chart has the keyboard. true when handled.
  key(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (this.cancel()) return true;
      if (this.tool) {
        this.setTool(null);
        return true;
      }
      if (this.selected) {
        this.select(null);
        return true;
      }
      return false;
    }
    if (e.key === 'Enter' && this.pending && this.pending.it.type === 'path') {
      this.finishPath();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      this.remove(this.selected);
      return true;
    }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') return this.undo() || true;
    if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) return this.redo() || true;
    if (ctrl && e.key.toLowerCase() === 'c' && this.selected) {
      this.copy();
      return true;
    }
    if (ctrl && e.key.toLowerCase() === 'v' && this.clipboard) {
      this.paste();
      return true;
    }
    return false;
  }

  // What a template saves of a drawing: its settings, and for a position its distances.
  templateOf(it) {
    const s = clone(it.s);
    if (TOOLS[it.type].side) {
      s.stopDistance = Math.abs(it.pts[0].p - it.stop);
      s.targetDistance = Math.abs(it.target - it.pts[0].p);
    }
    return s;
  }
}

export { getPath };
