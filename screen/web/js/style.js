// The font of everything drawn on the canvas.
export const FONT = '"Trebuchet MS", Arial, sans-serif';

// The chart's look, and the settings dialog's fields for it. A chart template is one of these
// objects; the default is the modern style (the same colours as the ModernStyle script).

export const DEFAULT_STYLE = {
  chartType: 'candles',   // candles | hollow | bars | line | area
  candles: {
    body: true, border: true, wick: true,
    upBody: '#ffffff', downBody: '#2962ff',
    upBorder: '#ffffff', downBorder: '#2962ff',
    upWick: '#ffffff', downWick: '#2962ff',
  },
  line: { color: '#2962ff', width: 2 },
  background: { gradient: false, color: '#0f0f0f', top: '#1f1f1f' },
  grid: { vert: false, horz: false, color: 'rgba(242, 242, 242, 0.06)' },
  crosshair: { color: '#9c9c9c', style: 'dashed', width: 1 },
  scales: { text: '#b8b8b8', fontSize: 12, line: 'rgba(242, 242, 242, 0)' },
  priceLine: { show: true, color: '', countdown: true, bidAsk: false },
  legend: { title: true, ohlc: true, change: true, volume: false },
  watermark: { show: false, color: 'rgba(255, 255, 255, 0.06)' },
  margins: { top: 10, bottom: 8 },
};

export const CHART_TYPES = [
  ['candles', 'Candles'],
  ['hollow', 'Hollow candles'],
  ['bars', 'Bars'],
  ['line', 'Line'],
  ['area', 'Area'],
];

export const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];

// The settings dialog: tabs of rows; each field names a path into the style.
export const CHART_FIELDS = [
  {
    tab: 'Symbol',
    rows: [
      { label: 'Chart type', fields: [{ path: 'chartType', type: 'select', options: CHART_TYPES }] },
      { label: 'Body', fields: [{ path: 'candles.body', type: 'check' }, { path: 'candles.upBody', type: 'color' }, { path: 'candles.downBody', type: 'color' }] },
      { label: 'Borders', fields: [{ path: 'candles.border', type: 'check' }, { path: 'candles.upBorder', type: 'color' }, { path: 'candles.downBorder', type: 'color' }] },
      { label: 'Wick', fields: [{ path: 'candles.wick', type: 'check' }, { path: 'candles.upWick', type: 'color' }, { path: 'candles.downWick', type: 'color' }] },
      { label: 'Line and area', fields: [{ path: 'line.color', type: 'color' }, { path: 'line.width', type: 'width' }] },
    ],
  },
  {
    tab: 'Status line',
    rows: [
      { label: 'Symbol and timeframe', fields: [{ path: 'legend.title', type: 'check' }] },
      { label: 'Open, high, low, close', fields: [{ path: 'legend.ohlc', type: 'check' }] },
      { label: 'Bar change', fields: [{ path: 'legend.change', type: 'check' }] },
      { label: 'Tick volume', fields: [{ path: 'legend.volume', type: 'check' }] },
    ],
  },
  {
    tab: 'Scales',
    rows: [
      { label: 'Text', fields: [{ path: 'scales.text', type: 'color' }, { path: 'scales.fontSize', type: 'select', options: [[10, '10'], [11, '11'], [12, '12'], [13, '13'], [14, '14']] }] },
      { label: 'Lines', fields: [{ path: 'scales.line', type: 'color' }] },
      { label: 'Last price line', fields: [{ path: 'priceLine.show', type: 'check' }, { path: 'priceLine.color', type: 'color', empty: 'Candle colour' }] },
      { label: 'Countdown to bar close', fields: [{ path: 'priceLine.countdown', type: 'check' }] },
      { label: 'Bid and ask lines', fields: [{ path: 'priceLine.bidAsk', type: 'check' }] },
      { label: 'Top margin, %', fields: [{ path: 'margins.top', type: 'number', min: 0, max: 40 }] },
      { label: 'Bottom margin, %', fields: [{ path: 'margins.bottom', type: 'number', min: 0, max: 40 }] },
    ],
  },
  {
    tab: 'Canvas',
    rows: [
      { label: 'Background', fields: [{ path: 'background.color', type: 'color' }] },
      { label: 'Gradient, top colour', fields: [{ path: 'background.gradient', type: 'check' }, { path: 'background.top', type: 'color' }] },
      { label: 'Vertical grid lines', fields: [{ path: 'grid.vert', type: 'check' }] },
      { label: 'Horizontal grid lines', fields: [{ path: 'grid.horz', type: 'check' }] },
      { label: 'Grid colour', fields: [{ path: 'grid.color', type: 'color' }] },
      { label: 'Crosshair', fields: [{ path: 'crosshair.color', type: 'color' }, { path: 'crosshair.width', type: 'width' }, { path: 'crosshair.style', type: 'style' }] },
      { label: 'Watermark', fields: [{ path: 'watermark.show', type: 'check' }, { path: 'watermark.color', type: 'color' }] },
    ],
  },
];

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// The dash pattern of a line style at a width.
export function dash(style, width = 1) {
  if (style === 'dashed') return [6 * Math.max(1, width * 0.75), 4 * Math.max(1, width * 0.75)];
  if (style === 'dotted') return [Math.max(1, width), 2.5 * Math.max(1, width)];
  return [];
}
