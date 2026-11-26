// Templates: named chart styles and named drawing settings per tool, and which ones new charts and
// drawings start from. Saved as templates.json; a file in the same format can be imported.
import { TOOLS } from './tools.js';
import { DEFAULT_STYLE } from './style.js';
import { clone, merge } from './util.js';

export const FORMAT = 'innachart-templates';
// The same format under the program's name before 1.3 (Modern Screen): saved and exported files
// keep that name and are read as they are.
const OLD_FORMATS = ['modern-screen-templates'];

export function emptyTemplates() {
  return { format: FORMAT, version: 1, chart: {}, tools: {}, defaults: { chart: null, tools: {} } };
}

// A templates object read from a file, checked: unknown tools and bad entries are left out.
// Returns {templates, count, skipped}.
export function readTemplates(data) {
  const out = emptyTemplates();
  let count = 0;
  let skipped = 0;
  if (!data || typeof data !== 'object' || (data.format && data.format !== FORMAT && !OLD_FORMATS.includes(data.format))) return { templates: out, count, skipped: 1 };
  const okName = (n) => typeof n === 'string' && n.trim().length > 0 && n.length <= 60;
  for (const [name, style] of Object.entries(data.chart || {})) {
    if (okName(name) && style && typeof style === 'object') {
      out.chart[name.trim()] = merge(DEFAULT_STYLE, style);
      count++;
    } else skipped++;
  }
  for (const [type, list] of Object.entries(data.tools || {})) {
    if (!TOOLS[type] || !list || typeof list !== 'object') {
      skipped++;
      continue;
    }
    for (const [name, s] of Object.entries(list)) {
      if (okName(name) && s && typeof s === 'object') {
        (out.tools[type] = out.tools[type] || {})[name.trim()] = merge(TOOLS[type].defaults, s);
        count++;
      } else skipped++;
    }
  }
  const d = data.defaults || {};
  if (typeof d.chart === 'string' && out.chart[d.chart]) out.defaults.chart = d.chart;
  for (const [type, name] of Object.entries(d.tools || {})) if (out.tools[type] && out.tools[type][name]) out.defaults.tools[type] = name;
  return { templates: out, count, skipped };
}

// b's templates added to a's (b wins on the same name); a's defaults kept unless b sets one.
export function mergeTemplates(a, b) {
  const out = clone(a);
  Object.assign(out.chart, clone(b.chart));
  for (const [type, list] of Object.entries(b.tools)) out.tools[type] = { ...(out.tools[type] || {}), ...clone(list) };
  if (b.defaults.chart) out.defaults.chart = b.defaults.chart;
  Object.assign(out.defaults.tools, b.defaults.tools);
  return out;
}

// The settings a new drawing of a type starts with: its default template, else the tool's own.
export function toolStart(templates, type) {
  const name = templates.defaults.tools[type];
  const t = name && templates.tools[type] && templates.tools[type][name];
  return clone(t || TOOLS[type].defaults);
}

export function chartStart(templates) {
  const name = templates.defaults.chart;
  return clone((name && templates.chart[name]) || DEFAULT_STYLE);
}
