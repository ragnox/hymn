// Runs the real Hymn app for the UI test: hidden window, muted, a throwaway profile, no menu-bar icon and
// no global shortcuts (src/main/test-driver.js). Drives it like a person would: real mouse clicks and key
// presses on what's visible, so a hidden or covered button fails the test.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function openApp({ profile, screenshots = null }) {
  const env = { ...process.env, HYMN_TEST_DRIVER: '1', HYMN_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  // HYMN_APP=dist/mac-arm64/Hymn.app/Contents/MacOS/Hymn tests the built app instead of the sources.
  const [binary, args] = process.env.HYMN_APP ? [process.env.HYMN_APP, []] : [require('electron'), [ROOT]];
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16_000); });
  const waiting = new Map();
  const errors = [];
  const logs = [];
  let nextId = 0;
  let ready;
  const started = new Promise((resolve, reject) => {
    ready = resolve;
    child.once('exit', (code) => reject(new Error(`Hymn exited (${code})\n${stderr}`)));
    setTimeout(() => reject(new Error(`Hymn didn't start\n${stderr}`)), 30_000).unref();
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.startsWith('@hymn ')) return;
    const message = JSON.parse(line.slice(6));
    if (message.ready) ready();
    if (message.console) {
      logs.push(message.console);
      if (message.console.level === 'error' || message.console.level === 3) errors.push(message.console.message);
    }
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if ('error' in message) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
  });
  child.once('exit', () => {
    for (const { reject } of waiting.values()) reject(new Error(`Hymn exited\n${stderr}`));
  });
  await started;

  const call = (command, arg) => new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, command, arg })}\n`);
  });

  /** Runs `fn(arg)` in the page and returns its (JSON) result. */
  const evaluate = (fn, arg) => call('eval', `(${fn})(${JSON.stringify(arg ?? null)})`);

  async function screenshot(name) {
    const dir = screenshots ?? await fs.mkdtemp(path.join(os.tmpdir(), 'hymn-ui-'));
    const file = path.join(dir, `${name}.png`);
    // A hidden window paints lazily: wait for a fresh frame, or the picture can be of an earlier state.
    await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await call('screenshot', file);
    return file;
  }

  /** Waits until `fn(arg)` returns something truthy in the page, and returns it. */
  async function waitFor(fn, arg, { what = String(fn), timeout = 15_000 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(fn, arg);
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}\nScreenshot: ${await screenshot('timeout')}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /** The middle of the element, if that's what a click there would hit; else why not. */
  const target = (selector) => evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const [x, y] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    const hit = document.elementFromPoint(x, y);
    if (!r.width || !r.height || !el.contains(hit)) return { hidden: true, covered: hit?.outerHTML.slice(0, 160) ?? null };
    return { x, y };
  }, selector);

  async function pointAt(selector) {
    const end = Date.now() + 10_000;
    let at = await target(selector);
    while (at.missing || at.hidden) {
      if (Date.now() > end) throw new Error(`Can't reach ${selector}: ${JSON.stringify(at)}\nScreenshot: ${await screenshot('unreachable')}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      at = await target(selector);
    }
    return at;
  }

  async function hover(selector) {
    const { x, y } = await pointAt(selector);
    await call('input', [{ type: 'mouseMove', x, y }]);
  }

  /** A click in the middle of the element (it must be visible and not covered). */
  async function click(selector, { offsetX = 0 } = {}) {
    const { x: cx, y } = await pointAt(selector);
    const x = cx + offsetX;
    await call('input', [
      { type: 'mouseMove', x, y },
      { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
    ]);
  }

  /** A click at a fraction (0…1) of the element's width, e.g. on a slider. */
  async function clickAt(selector, fraction) {
    const box = await evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + r.height / 2 }; }, selector);
    // Inside the element: rounding the far end up would land just past it.
    const x = Math.min(Math.ceil(box.left) + Math.round((box.width - 2) * fraction) + 1, Math.floor(box.left + box.width) - 1);
    const y = Math.round(box.y);
    await call('input', [
      { type: 'mouseMove', x, y },
      { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
    ]);
  }

  /** A key press, e.g. key('Space') or key('Right', ['shift']). */
  async function key(keyCode, modifiers = []) {
    const char = { Space: ' ', Enter: '\r' }[keyCode] ?? (keyCode.length === 1 ? keyCode : null);
    await call('input', [
      { type: 'keyDown', keyCode, modifiers },
      ...(char && !modifiers.length ? [{ type: 'char', keyCode: char }] : []),
      { type: 'keyUp', keyCode, modifiers },
    ]);
  }

  return {
    errors,
    logs,
    evaluate,
    waitFor,
    screenshot,
    hover,
    click,
    clickAt,
    key,
    type: (text) => call('insertText', text),
    text: (selector) => evaluate((sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null, selector),
    inspect: () => call('inspect'),
    run: (action) => call('run', action),
    theme: (source) => call('theme', source),
    memory: () => call('memory'),
    drop: (bounds) => call('drop', bounds),
    autoHideTick: (point) => call('autoHideTick', point),
    async close() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}
