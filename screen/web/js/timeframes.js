// MetaTrader 5's timeframes, how the screen names them, and the calendar arithmetic of bars.
// Times are the broker's server time in seconds, read as if they were UTC (as MT5 shows them).

export const TIMEFRAMES = [
  { id: 'M1', sec: 60, label: '1m' },
  { id: 'M2', sec: 120, label: '2m' },
  { id: 'M3', sec: 180, label: '3m' },
  { id: 'M4', sec: 240, label: '4m' },
  { id: 'M5', sec: 300, label: '5m' },
  { id: 'M6', sec: 360, label: '6m' },
  { id: 'M10', sec: 600, label: '10m' },
  { id: 'M12', sec: 720, label: '12m' },
  { id: 'M15', sec: 900, label: '15m' },
  { id: 'M20', sec: 1200, label: '20m' },
  { id: 'M30', sec: 1800, label: '30m' },
  { id: 'H1', sec: 3600, label: '1h' },
  { id: 'H2', sec: 7200, label: '2h' },
  { id: 'H3', sec: 10800, label: '3h' },
  { id: 'H4', sec: 14400, label: '4h' },
  { id: 'H6', sec: 21600, label: '6h' },
  { id: 'H8', sec: 28800, label: '8h' },
  { id: 'H12', sec: 43200, label: '12h' },
  { id: 'D1', sec: 86400, label: 'D' },
  { id: 'W1', sec: 604800, label: 'W' },
  { id: 'MN1', sec: 2592000, label: 'M' },
];

export const FAVORITES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];

const BY_ID = new Map(TIMEFRAMES.map((t) => [t.id, t]));

export const isTimeframe = (id) => BY_ID.has(id);
export const tfSeconds = (id) => (BY_ID.get(id) || BY_ID.get('M15')).sec;
export const tfLabel = (id) => (BY_ID.get(id) || { label: id }).label;
export const isIntraday = (id) => tfSeconds(id) < 86400;

// When the bar that opened at t closes.
export function barEnd(t, tf) {
  if (tf === 'MN1') {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
  }
  return t + tfSeconds(tf);
}

// What the trader typed for an interval: "15" -> M15, "60" -> H1, "4h" -> H4, "d" -> D1, "w" -> W1,
// "m" or "mn" -> MN1. null when it is not one of MT5's timeframes.
export function parseInterval(text) {
  const s = String(text).trim().toLowerCase();
  let m = /^(\d+)\s*(m|min)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n >= 60 && n % 60 === 0 && !m[2]) return parseInterval(n / 60 + 'h');
    const id = 'M' + n;
    return BY_ID.has(id) ? id : null;
  }
  m = /^(\d+)\s*h$/.exec(s);
  if (m) {
    const id = 'H' + Number(m[1]);
    return BY_ID.has(id) ? id : null;
  }
  if (s === 'd' || s === '1d') return 'D1';
  if (s === 'w' || s === '1w') return 'W1';
  if (s === 'mn' || s === '1mn' || s === 'mo' || s === '1mo') return 'MN1';
  return null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');

export function monthName(m) {
  return MONTHS[m];
}

// The crosshair's time: "Tue 25 Nov '25  14:15", without the time from D1 up.
export function crosshairTime(t, tf) {
  const d = new Date(t * 1000);
  const day = DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + " '" + String(d.getUTCFullYear()).slice(2);
  return isIntraday(tf) ? day + '  ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) : day;
}

// "02:15" left of a bar's close; "1d 04:00:00" when longer than a day.
export function countdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return d + 'd ' + p2(h) + ':' + p2(m) + ':' + p2(r);
  if (h > 0) return p2(h) + ':' + p2(m) + ':' + p2(r);
  return p2(m) + ':' + p2(r);
}

// The steps a time axis may label at, in seconds (months and years count as such).
const STEPS = [
  60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 14400, 21600, 43200,
  86400, 2 * 86400, 7 * 86400, 14 * 86400, 'month', '3month', '6month', 'year',
];
const stepSec = (s) => (s === 'month' ? 30 * 86400 : s === '3month' ? 91 * 86400 : s === '6month' ? 182 * 86400 : s === 'year' ? 365 * 86400 : s);

// The step between time labels for bars of tf drawn barPx apart, labels at least minPx apart.
export function labelStep(tf, barPx, minPx = 90) {
  const want = (minPx / Math.max(barPx, 0.01)) * tfSeconds(tf);
  for (const s of STEPS) if (stepSec(s) >= want && stepSec(s) >= tfSeconds(tf)) return s;
  return 'year';
}

function bucket(t, step) {
  const d = new Date(t * 1000);
  if (step === 'month') return d.getUTCFullYear() * 12 + d.getUTCMonth();
  if (step === '3month') return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
  if (step === '6month') return d.getUTCFullYear() * 2 + Math.floor(d.getUTCMonth() / 6);
  if (step === 'year') return d.getUTCFullYear();
  if (step === 7 * 86400 || step === 14 * 86400) return Math.floor((t / 86400 + 3) / (step / 86400));   // weeks from Monday
  return Math.floor(t / step);
}

// The labelled bars between i0 and i1: {i, text, major}. A new year, month or day is "major" and
// named by itself (2026, Nov, 25); within a day, the time (14:00).
export function timeLabels(times, i0, i1, tf, barPx, minPx = 90) {
  const step = labelStep(tf, barPx, minPx);
  const out = [];
  let lastX = -Infinity;
  for (let i = Math.max(1, i0); i <= Math.min(times.length - 1, i1); i++) {
    const t = times[i];
    const prev = times[i - 1];
    if (bucket(t, step) === bucket(prev, step)) continue;
    if ((i - lastX) * barPx < minPx * 0.66) continue;
    const d = new Date(t * 1000);
    const p = new Date(prev * 1000);
    let text;
    let major = true;
    if (d.getUTCFullYear() !== p.getUTCFullYear()) text = String(d.getUTCFullYear());
    else if (d.getUTCMonth() !== p.getUTCMonth()) text = MONTHS[d.getUTCMonth()];
    else if (d.getUTCDate() !== p.getUTCDate()) text = String(d.getUTCDate());
    else {
      text = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
      major = false;
    }
    out.push({ i, text, major });
    lastX = i;
  }
  return out;
}
