// A stand-in for the InnaChart service, for developing and testing without MetaTrader 5. It
// connects to InnaChart.exe's pipe like the service and answers the same requests with made-up
// prices (the same bars every time for the same symbol and time). It moves the price a few times a
// second. Run: node screen/tools/fake-feed.js   (InnaChart.exe must be running)
import net from 'node:net';

const PIPE = '\\\\.\\pipe\\InnaChart.Feed';
const TF = { M1: 60, M2: 120, M3: 180, M4: 240, M5: 300, M6: 360, M10: 600, M12: 720, M15: 900, M20: 1200, M30: 1800,
  H1: 3600, H2: 7200, H3: 10800, H4: 14400, H6: 21600, H8: 28800, H12: 43200, D1: 86400, W1: 604800, MN1: 2592000 };
const SYMBOLS = [
  { name: 'XAUUSD', desc: 'Gold vs US Dollar', digits: 2, base: 2650, point: 0.01, tickValue: 1, contract: 100 },
  { name: 'EURUSD', desc: 'Euro vs US Dollar', digits: 5, base: 1.085, point: 0.00001, tickValue: 1, contract: 100000 },
  { name: 'GBPUSD', desc: 'Great Britain Pound vs US Dollar', digits: 5, base: 1.27, point: 0.00001, tickValue: 1, contract: 100000 },
  { name: 'USDJPY', desc: 'US Dollar vs Japanese Yen', digits: 3, base: 151.2, point: 0.001, tickValue: 0.66, contract: 100000 },
  { name: 'BTCUSD', desc: 'Bitcoin vs US Dollar', digits: 2, base: 59000, point: 0.01, tickValue: 0.01, contract: 1 },
];
const bySym = new Map(SYMBOLS.map((s) => [s.name, s]));
const latencyMs = Number(process.env.FAKE_FEED_DELAY || 0);   // to see how the screen shows a slow link

// A repeatable "random" number in [0, 1) for a symbol and a time.
function noise(sym, t) {
  let h = 2166136261;
  for (const c of sym + ':' + t) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function priceAt(s, t) {
  const w = 2 * Math.PI;
  return s.base * (1 + 0.02 * Math.sin((w * t) / (86400 * 9)) + 0.006 * Math.sin((w * t) / (3600 * 7)) +
    0.002 * Math.sin((w * t) / 2700) + 0.0008 * (noise(s.name, Math.floor(t / 300)) - 0.5));
}

function bar(s, t, sec, now) {
  const end = Math.min(t + sec, now);
  const o = priceAt(s, t);
  const c = priceAt(s, end);
  const span = Math.abs(c - o) + s.base * 0.0006 * (0.3 + noise(s.name, t));
  const h = Math.max(o, c) + span * noise(s.name, t + 1) * 0.6;
  const l = Math.min(o, c) - span * noise(s.name, t + 2) * 0.6;
  const f = (v) => Number(v.toFixed(s.digits));
  return [t, f(o), f(h), f(l), f(c), Math.round(50 + 500 * noise(s.name, t + 3))];
}

// Bar open times as MT5 would have them: no weekends, months by the calendar.
function opensBefore(tf, before, count) {
  const sec = TF[tf];
  const out = [];
  let t;
  if (tf === 'MN1') {
    const d = new Date(before * 1000);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    if (Date.UTC(y, m, 1) / 1000 >= before) m--;
    while (out.length < count) {
      out.push(Date.UTC(y, m, 1) / 1000);
      m--;
      if (m < 0) { m = 11; y--; }
    }
    return out.reverse();
  }
  t = Math.floor((before - 1) / sec) * sec;
  if (tf === 'W1') t = Math.floor((before - 1 - 4 * 86400) / sec) * sec + 4 * 86400;   // Sundays
  while (out.length < count && t > 0) {
    const day = new Date(t * 1000).getUTCDay();
    if (sec >= 604800 || (day !== 0 && day !== 6)) out.push(t);
    t -= sec;
  }
  return out.reverse();
}

let socket = null;
let watch = [];
let quotes = [];
const lastSent = new Map();

function send(obj) {
  if (!socket) return;
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  const write = () => socket && socket.write(Buffer.concat([head, body]));
  if (latencyMs > 0) setTimeout(write, latencyMs);
  else write();
}

const now = () => Math.floor(Date.now() / 1000);

function handle(msg) {
  const id = msg.id || 0;
  const s = bySym.get(msg.sym);
  switch (msg.t) {
    case 'pulse':
      break;
    case 'ping':
      send({ t: 'pong', id, connected: true, brokerPing: 23.4 });
      break;
    case 'history': {
      if (!s) return send({ t: 'error', id, error: 'Unknown symbol ' + msg.sym });
      if (!TF[msg.tf]) return send({ t: 'error', id, error: 'Unknown timeframe ' + msg.tf });
      const count = Math.max(1, Math.min(5000, msg.count || 1000));
      const n = now();
      const before = msg.before > 0 ? msg.before : n + 1;
      const first = n - 400 * 86400 * (TF[msg.tf] >= 86400 ? 30 : 1);   // "history" begins here
      const times = opensBefore(msg.tf, before, count).filter((t) => t >= first);
      send({ t: 'bars', id, sym: s.name, tf: msg.tf, digits: s.digits, done: times.length < count,
        bars: times.map((t) => bar(s, t, TF[msg.tf], n)) });
      break;
    }
    case 'watch':
      watch = String(msg.list || '').split('\n').filter(Boolean).map((x) => {
        const at = x.indexOf('@');
        return { tf: x.slice(0, at), sym: x.slice(at + 1) };
      }).filter((w) => TF[w.tf] && bySym.has(w.sym));
      break;
    case 'quotes':
      quotes = String(msg.list || '').split('\n').filter((x) => bySym.has(x));
      break;
    case 'find': {
      const q = String(msg.q || '').toLowerCase();
      send({ t: 'found', id, list: SYMBOLS.filter((x) => x.name.toLowerCase().includes(q) || x.desc.toLowerCase().includes(q))
        .map((x) => ({ name: x.name, desc: x.desc, path: 'Fake\\' + x.name, mw: true })) });
      break;
    }
    case 'spec':
      if (!s) return send({ t: 'error', id, error: 'Unknown symbol ' + msg.sym });
      send({ t: 'spec', id, sym: s.name, desc: s.desc, digits: s.digits, point: s.point, tickSize: s.point, tickValue: s.tickValue,
        contract: s.contract, volMin: 0.01, volStep: 0.01, volMax: 100, profitCcy: 'USD', accountCcy: 'USD' });
      break;
    case 'symbols':
      sendSymbols();
      break;
    default:
      send({ t: 'error', id, error: 'Unknown request ' + msg.t });
  }
}

function sendSymbols() {
  send({ t: 'symbols', list: SYMBOLS.map((s) => ({ name: s.name, desc: s.desc, digits: s.digits })) });
}

function tick() {
  const n = now();
  const ms = Date.now();
  for (const w of watch) {
    const s = bySym.get(w.sym);
    const sec = TF[w.tf];
    const open = opensBefore(w.tf, n + 1, 1)[0];
    const b = bar(s, open, sec, n);
    const jitter = s.base * 0.00015 * (Math.random() - 0.5);
    b[4] = Number((b[4] + jitter).toFixed(s.digits));
    b[2] = Math.max(b[2], b[4]);
    b[3] = Math.min(b[3], b[4]);
    const key = w.sym + w.tf;
    const prev = lastSent.get(key);
    if (prev && prev !== open) send({ t: 'bar', sym: w.sym, tf: w.tf, bar: bar(s, prev, sec, n) });
    lastSent.set(key, open);
    const spread = s.point * (s.digits === 2 ? 20 : 12);
    send({ t: 'bar', sym: w.sym, tf: w.tf, bar: b, bid: b[4], ask: Number((b[4] + spread).toFixed(s.digits)), time: ms });
  }
  for (const q of quotes) {
    const s = bySym.get(q);
    const p = Number((priceAt(s, n) + s.base * 0.0001 * (Math.random() - 0.5)).toFixed(s.digits));
    send({ t: 'quote', sym: q, bid: p, ask: Number((p + s.point * 15).toFixed(s.digits)), time: ms,
      prev: Number(priceAt(s, Math.floor(n / 86400) * 86400 - 1).toFixed(s.digits)) });
  }
}

function connect() {
  const sock = net.connect(PIPE);
  let buf = Buffer.alloc(0);
  sock.on('connect', () => {
    socket = sock;
    console.log('Connected to InnaChart.exe as process ' + process.pid + '.');
    send({ t: 'hello', v: 1, company: 'Fake Broker', server: 'Fake-Demo', currency: 'USD', build: 5000, maxBars: 100000, now: now(), pulse: true });
    sendSymbols();
  });
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const text = buf.subarray(4, 4 + len).toString('utf8');
      buf = buf.subarray(4 + len);
      if (!text) continue;   // a pulse from the program: only meant to wake the feed
      try {
        handle(JSON.parse(text));
      } catch (e) {
        send({ t: 'error', id: 0, error: 'Not a request: ' + e.message });
      }
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => {
    if (socket === sock) console.log('InnaChart.exe went away; trying again.');
    socket = null;
    setTimeout(connect, 1000);
  });
}

setInterval(tick, 200);
setInterval(() => send({ t: 'clock', now: now(), connected: true, brokerPing: 20 + Math.random() * 8 }), 1000);
setInterval(() => send({ t: 'account', balance: 10000, equity: 10000 + Math.round(Math.random() * 100), currency: 'USD' }), 2000);
connect();
