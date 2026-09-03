// Minimal Chrome DevTools Protocol client: enough to drive a page and send
// real key events. No dependency beyond `ws`, which the workspace already has.
import WebSocket from 'ws';

export const delay = ms => new Promise(r => setTimeout(r, ms));

export async function waitUntil(fn, timeoutMs, intervalMs = 500, label = '') {
  const rounds = Math.ceil(timeoutMs / intervalMs);
  for (let i = 0; i < rounds; i++) {
    try { if (await fn()) return true; } catch {}
    await delay(intervalMs);
  }
  if (label) console.error(`  ! timed out waiting for ${label}`);
  return false;
}

export class Page {
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails;
        this.errors.push((e.exception?.description || e.text || '').split('\n')[0]);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(
          'console.error: ' +
            m.params.args.map(a => a.description ?? a.value).join(' ').split('\n')[0]
        );
      }
    });
  }

  static async attach(name, debuggerUrl) {
    const ws = new WebSocket(debuggerUrl, { maxPayload: 512 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const page = new Page(name, ws);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
  }

  send(method, params = {}) {
    return new Promise(res => {
      const id = ++this.id;
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(
        `[${this.name}] ${(d.exception?.description || d.text || 'eval failed').split('\n')[0]}`
      );
    }
    return r.result?.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await delay(2500);
  }

  /** A real keystroke: the same rawKeyDown/char/keyUp triple the browser
   *  produces for a human pressing a key, so CodeMirror's input handling,
   *  the grammar and the syn session all run exactly as they do in the app. */
  async typeChar(ch) {
    if (ch === '\n') {
      await this.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter',
      });
      await this.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' });
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter',
      });
      return;
    }
    const code = ch.toUpperCase().charCodeAt(0);
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: code, key: ch, text: ch, unmodifiedText: ch,
    });
    await this.send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', windowsVirtualKeyCode: code, key: ch, text: ch, unmodifiedText: ch,
    });
  }

  close() { try { this.ws.close(); } catch {} }
}
