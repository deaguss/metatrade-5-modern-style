// The WebSocket to InnaChart.exe, and through it to the MT5 feed. Requests with an id get their
// reply as a promise. It connects again on its own; what the screen watches is sent again then.
// It also measures the links (round trips, in ms) for the network indicator.

export class Feed {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.ws = null;
    this.nextId = 1;
    this.waiting = new Map();
    this.handlers = new Map();
    this.state = 'connecting';   // connecting | open | closed
    this.feedOn = false;         // MT5's feed is connected to the program
    this.separate = false;       // the screen is a window of its own, not glued onto MT5
    this.watchList = '';
    this.quoteList = '';
    this.stats = { hostRtt: NaN, feedRtt: NaN, brokerPing: NaN, connected: null, tickAge: NaN, ticksPerSec: 0, renderMs: NaN, frameDelay: NaN };
    this.ticks = 0;
    this.retry = 500;
    this.connect();
    setInterval(() => this.measure(), 2000);
    setInterval(() => {
      this.stats.ticksPerSec = this.ticks;
      this.ticks = 0;
      this.emit('stats', this.stats);
    }, 1000);
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  connect() {
    this.state = 'connecting';
    this.emit('state', this.state);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.later();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'host.auth', key: this.key }));   // the first message: never in the address
      this.state = 'open';
      this.retry = 500;
      this.emit('state', this.state);
      this.measure();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      this.received(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.state = 'closed';
      this.feedOn = false;
      for (const [, w] of this.waiting) w.reject(new Error('The link to InnaChart.exe closed.'));
      this.waiting.clear();
      this.emit('state', this.state);
      this.later();
    };
  }

  later() {
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(5000, this.retry * 2);
  }

  received(msg) {
    if (msg.t === 'host') {
      const was = this.feedOn;
      this.feedOn = !!msg.feed;
      this.separate = !!msg.separate;
      this.ticketOn = !!msg.ticket;
      this.emit('host', msg);
      this.emit('feed', this.feedOn);
      if (this.feedOn && !was) this.resend();
      return;
    }
    if (msg.t === 'hello' && !this.feedOn) {
      this.feedOn = true;
      this.emit('feed', true);
      this.resend();
    }
    if (msg.t === 'bar') this.ticks++;   // the charts' ticks; the watchlist's quotes are not counted
    if (msg.t === 'clock' || msg.t === 'pong') {
      if (Number.isFinite(msg.brokerPing)) this.stats.brokerPing = msg.brokerPing;
      if (typeof msg.connected === 'boolean') this.stats.connected = msg.connected;
    }
    if (msg.id && this.waiting.has(msg.id) && (msg.t === 'bars' || msg.t === 'found' || msg.t === 'spec' || msg.t === 'error' || msg.t === 'pong' || msg.t === 'host.pong' || msg.t === 'ticket.reply')) {
      const w = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.t === 'error') w.reject(new Error(msg.error));
      else w.resolve(msg);
      return;
    }
    this.emit(msg.t, msg);
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  request(msg, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error('MetaTrader 5 did not answer in time.'));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      if (!this.send({ ...msg, id })) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(new Error('Not connected to InnaChart.exe.'));
      }
    });
  }

  // The charts to keep live ([[symbol, tf]]) and the symbols whose quotes to send.
  watch(charts) {
    this.watchList = charts.map(([sym, tf]) => tf + '@' + sym).join('\n');
    this.send({ t: 'watch', list: this.watchList });
  }

  quotes(symbols) {
    this.quoteList = symbols.join('\n');
    this.send({ t: 'quotes', list: this.quoteList });
  }

  resend() {
    if (this.watchList) this.send({ t: 'watch', list: this.watchList });
    if (this.quoteList) this.send({ t: 'quotes', list: this.quoteList });
    this.emit('resync', null);
  }

  // Round trips to the program and through it to MT5's feed.
  async measure() {
    if (this.state !== 'open') return;
    const t0 = performance.now();
    try {
      await this.request({ t: 'host.ping' }, 5000);
      this.stats.hostRtt = performance.now() - t0;
    } catch (e) {
      this.stats.hostRtt = NaN;
    }
    if (!this.feedOn) {
      this.stats.feedRtt = NaN;
      return;
    }
    const t1 = performance.now();
    try {
      await this.request({ t: 'ping' }, 5000);
      this.stats.feedRtt = performance.now() - t1;
    } catch (e) {
      this.stats.feedRtt = NaN;
    }
    this.emit('stats', this.stats);
  }

  hide() {
    this.send({ t: 'host.hide' });
  }

  // A window of its own (true), or glued onto MT5's chart area (false).
  setSeparate(on) {
    this.send({ t: on ? 'host.separate' : 'host.glue' });
  }
}
