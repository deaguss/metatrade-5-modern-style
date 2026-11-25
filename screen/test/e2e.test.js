// End to end, on Windows: a test instance of InnaChart.exe (unglued, no tray icon, its own mutex
// and pipes, so a running InnaChart is not touched) with the stand-in feed and ticket,
// spoken to over the WebSocket as the page does. It checks the key, the routing of replies to the
// screen that asked, and the ticket's preview-then-confirm round trips. Run it after
// scripts\build-screen.ps1 with:  set INNACHART_E2E=1 & node --test screen/test/e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const exe = process.env.INNACHART_EXE || path.join(repo, 'build', 'screen', 'InnaChart.exe');
const run = process.platform === 'win32' && process.env.INNACHART_E2E === '1' && existsSync(exe);
const PORT = 18151;
const KEY = 'e2e-key-0123456789abcdef';
const CRLF = '\r\n';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small WebSocket client that sends an Origin, as a browser does (Node's own sends none).
function openSocket(url, origin) {
  const u = new URL(url);
  const sock = net.connect(Number(u.port), u.hostname);
  const ws = { onopen: null, onmessage: null, onclose: null, onerror: null };
  let buf = Buffer.alloc(0);
  let open = false;
  let closedCode = null;
  const key = crypto.randomBytes(16).toString('base64');
  sock.on('connect', () => {
    const lines = ['GET ' + u.pathname + u.search + ' HTTP/1.1', 'Host: ' + u.host, 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13', 'Origin: ' + origin];
    sock.write(lines.join(CRLF) + CRLF + CRLF);
  });
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const end = buf.indexOf(CRLF + CRLF);
      if (end < 0) return;
      const head = buf.subarray(0, end).toString();
      buf = buf.subarray(end + 4);
      if (!head.startsWith('HTTP/1.1 101')) {
        if (ws.onerror) ws.onerror(new Error(head.split(CRLF)[0]));
        sock.destroy();
        return;
      }
      open = true;
      if (ws.onopen) ws.onopen();
    }
    while (buf.length >= 2) {
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      if (buf.length < at + len) return;
      const payload = buf.subarray(at, at + len);
      buf = buf.subarray(at + len);
      if (op === 1 && ws.onmessage) ws.onmessage({ data: payload.toString('utf8') });
      if (op === 8) {
        closedCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        sock.end();
      }
    }
  });
  sock.on('close', () => {
    if (ws.onclose) ws.onclose({ code: closedCode || 1006 });
  });
  sock.on('error', (e) => {
    if (ws.onerror) ws.onerror(e);
  });
  ws.send = (text) => {
    const body = Buffer.from(text, 'utf8');
    const mask = crypto.randomBytes(4);
    const head = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : Buffer.from([0x81, 0x80 | 126, body.length >> 8, body.length & 255]);
    const masked = Buffer.from(body.map((b, i) => b ^ mask[i & 3]));
    sock.write(Buffer.concat([head, mask, masked]));
  };
  ws.close = () => sock.end();
  return ws;
}

class Client {
  constructor(key) {
    this.key = key;
    this.msgs = [];
    this.waiting = new Map();
    this.nextId = 1;
  }

  async open() {
    this.ws = openSocket('ws://127.0.0.1:' + PORT + '/ws?term=0', 'http://127.0.0.1:' + PORT);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id) && /reply|bars|spec|found|pong|error/.test(m.t)) {
        this.waiting.get(m.id)(m);
        this.waiting.delete(m.id);
      } else this.msgs.push(m);
    };
    this.closed = new Promise((r) => (this.ws.onclose = (e) => r(e.code)));
    await new Promise((r, j) => {
      this.ws.onopen = r;
      this.ws.onerror = (e) => j(new Error('the WebSocket did not open: ' + e.message));
    });
    this.ws.send(JSON.stringify({ t: 'host.auth', key: this.key }));
  }

  ask(msg, id = this.nextId++) {
    return new Promise((r, j) => {
      const timer = setTimeout(() => j(new Error('no answer to ' + msg.t)), 8000);
      this.waiting.set(id, (m) => {
        clearTimeout(timer);
        r(m);
      });
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  async until(pred, what) {
    for (let i = 0; i < 100; i++) {
      const m = this.msgs.find(pred);
      if (m) return m;
      await sleep(100);
    }
    throw new Error('never came: ' + what);
  }
}

test('InnaChart.exe, the feed and the ticket, end to end', { skip: !run && 'set INNACHART_E2E=1 on Windows after building InnaChart.exe' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'innachart-e2e-'));
  const host = spawn(exe, ['--web', path.join(repo, 'screen', 'web'), '--store', path.join(dir, 'store'), '--data', path.join(dir, 'data'),
    '--no-glue', '--no-tray', '--instance', 'e2e', '--key', KEY, '--port', String(PORT)], { stdio: 'ignore' });
  await sleep(1500);
  const feed = spawn(process.execPath, [path.join(repo, 'screen', 'tools', 'fake-feed.js')], { stdio: 'ignore', env: { ...process.env, INNACHART_INSTANCE: 'e2e' } });
  try {
    await sleep(2500);
    // A wrong key is closed with 1008 and gets nothing.
    const bad = new Client('wrong-key-0000000000000');
    await bad.open();
    assert.equal(await bad.closed, 1008);

    const a = new Client(KEY);
    await a.open();
    const status = await a.until((m) => m.t === 'host' && m.feed && m.ticket, 'the feed and the ticket linked');
    assert.equal(status.separate, false);
    await a.until((m) => m.t === 'ticket.terminal', 'the EA\'s terminal message');

    // The feed: history, and the same id from two screens reaching each its own reply.
    const b = new Client(KEY);
    await b.open();
    const [ha, hb] = await Promise.all([
      a.ask({ t: 'history', sym: 'XAUUSD', tf: 'H1', before: 0, count: 50 }, 77),
      b.ask({ t: 'history', sym: 'EURUSD', tf: 'M5', before: 0, count: 20 }, 77),
    ]);
    assert.equal(ha.sym, 'XAUUSD');
    assert.equal(ha.bars.length, 50);
    assert.equal(hb.sym, 'EURUSD', 'the other screen\'s reply, with the same id, is its own');

    // The ticket: a preview, a send naming it, and the trade in the next trades message.
    const w = await a.ask({ t: 'ticket.watch', symbol: 'XAUUSD' });
    assert.equal(w.ok, true);
    assert.equal(w.spec.pipSize, 0.1);
    const pv = await a.ask({ t: 'ticket.preview', symbol: 'XAUUSD', side: 'buy', pending: false, entry: 0, slMode: 'pips', slValue: 20,
      tpMode: 'r', tpValue: 2, riskMode: 'percent', riskValue: 1, riskBase: 'equity' });
    assert.equal(pv.ok, true);
    assert.equal(pv.plan.valid, true);
    assert.ok(pv.plan.lots > 0);
    assert.ok(Math.abs(pv.plan.rr - 2) < 1e-9);
    const sent = await a.ask({ t: 'ticket.send', preview: pv.preview });
    assert.equal(sent.ok, true);
    assert.equal(sent.type, 'BUY');
    const again = await a.ask({ t: 'ticket.send', preview: pv.preview });
    assert.equal(again.ok, false, 'a preview is used once');
    const tr = await a.until((m) => m.t === 'ticket.trades' && m.list.some((x) => x.ticket === sent.ticket), 'the new position in the trades');
    const pos = tr.list.find((x) => x.ticket === sent.ticket);

    // Change its stop, then close it, each with a preview and a confirm.
    const mp = await a.ask({ t: 'ticket.modPreview', ticket: pos.ticket, sl: pos.sl - 1, tp: pos.tp });
    assert.equal(mp.ok && mp.mod.changed, true);
    assert.equal((await a.ask({ t: 'ticket.modSend', preview: mp.preview })).ok, true);
    const cp = await a.ask({ t: 'ticket.closePreview', ticket: pos.ticket, lots: 0 });
    assert.equal(cp.close.lots, pos.lots);
    assert.equal((await a.ask({ t: 'ticket.close', preview: cp.preview })).ok, true);
    await a.until((m) => m.t === 'ticket.trades' && !m.list.some((x) => x.ticket === pos.ticket), 'the position gone');
    a.ws.close();
    b.ws.close();
  } finally {
    feed.kill();
    host.kill();
    await sleep(500);
    rmSync(dir, { recursive: true, force: true });
  }
});
