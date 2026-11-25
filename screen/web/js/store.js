// The screen's saved files, kept by ModernScreen.exe in %APPDATA%\ModernScreen. Without the program
// (the page opened on its own) they are kept in the browser instead.

export class Store {
  constructor(key) {
    this.key = key;
    this.local = !key;
  }

  // The saved value, or fallback when there is none yet. Throws when it exists but cannot be read
  // (so nothing is saved over it by mistake).
  async get(name, fallback = null) {
    if (this.local) {
      const text = localStorage.getItem('ms.' + name);
      return text ? JSON.parse(text) : fallback;
    }
    const r = await fetch('/api/store/' + name, { headers: { 'X-Key': this.key }, cache: 'no-store' });
    if (r.status === 404) return fallback;
    if (!r.ok) throw new Error('reading ' + name + ' failed (HTTP ' + r.status + ')');
    return await r.json();
  }

  // The same, but a problem only logged: for files whose loss costs nothing (the layout).
  async getOr(name, fallback = null) {
    try {
      return await this.get(name, fallback);
    } catch (e) {
      console.warn(e.message);
      return fallback;
    }
  }

  async put(name, value) {
    const text = JSON.stringify(value);
    if (this.local) {
      localStorage.setItem('ms.' + name, text);
      return true;
    }
    const r = await fetch('/api/store/' + name, { method: 'PUT', headers: { 'X-Key': this.key, 'Content-Type': 'application/json' }, body: text });
    if (!r.ok) throw new Error('Saving ' + name + ' failed (HTTP ' + r.status + ')');
    return true;
  }
}
