// Main-process logic that doesn't need Electron: geometry, settings, auto-hide, tray menu, shortcuts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { atEdge, contains, dockedBounds, hiddenBounds, MIN_WIDTH, sideFor } from '../src/main/geometry.js';
import { createSettings, DEFAULTS, validSettings } from '../src/main/settings.js';
import { createAutoHide } from '../src/main/autohide.js';
import { trayMenu } from '../src/main/tray-menu.js';
import { isSafeAccelerator, registerShortcuts } from '../src/main/shortcuts.js';

const workArea = { x: 0, y: 25, width: 1512, height: 920 };
const display = { x: 0, y: 0, width: 1512, height: 982 };

test('docked on the right or left of the work area, inset by the margin', () => {
  assert.deepEqual(dockedBounds(workArea, 'right', 400), { x: 1512 - 400 - 8, y: 33, width: 400, height: 904 });
  assert.deepEqual(dockedBounds(workArea, 'left', 400), { x: 8, y: 33, width: 400, height: 904 });
  assert.equal(dockedBounds(workArea, 'right', 100).width, MIN_WIDTH);
  assert.equal(dockedBounds(workArea, 'right', 5000).width, 600);
  // A second display to the left of the main one (negative coordinates).
  assert.deepEqual(dockedBounds({ x: -1920, y: 0, width: 1920, height: 1050 }, 'left', 380), { x: -1912, y: 8, width: 380, height: 1034 });
});

test('slid out just past the edge, and snapping to the nearer side', () => {
  const docked = dockedBounds(workArea, 'right', 400);
  assert.equal(hiddenBounds(display, docked, 'right').x, 1513);
  assert.equal(hiddenBounds(display, dockedBounds(workArea, 'left', 400), 'left').x, -401);
  assert.equal(sideFor(workArea, { x: 100, y: 0, width: 400, height: 10 }), 'left');
  assert.equal(sideFor(workArea, { x: 800, y: 0, width: 400, height: 10 }), 'right');
});

test('the edge zone and hit testing', () => {
  assert.equal(atEdge(display, 'right', { x: 1511, y: 500 }), true);
  assert.equal(atEdge(display, 'right', { x: 1500, y: 500 }), false);
  assert.equal(atEdge(display, 'left', { x: 0, y: 500 }), true);
  assert.equal(atEdge(display, 'left', { x: 0, y: 2000 }), false);
  assert.equal(contains({ x: 10, y: 10, width: 10, height: 10 }, { x: 25, y: 15 }, 6), true);
  assert.equal(contains({ x: 10, y: 10, width: 10, height: 10 }, { x: 25, y: 15 }), false);
});

test('settings: defaults, valid values only, saved after a change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hymn-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ side: 'left', width: 99999, volume: 'loud', shortcuts: { next: 'Alt+N', bogus: 'x' } }));
  const settings = createSettings(file, { delay: 1 });
  const s = settings.get();
  assert.equal(s.side, 'left');
  assert.equal(s.width, DEFAULTS.width);
  assert.equal(s.volume, DEFAULTS.volume);
  assert.equal(s.shortcuts.next, DEFAULTS.shortcuts.next); // the bad key spoils the whole shortcuts object
  const heard = [];
  settings.onChange((value, changed) => heard.push(changed));
  assert.deepEqual(settings.set({ volume: 30, side: 'left', repeat: 'sometimes' }), ['volume']);
  assert.deepEqual(settings.set({ shortcuts: { next: 'Alt+N' } }), ['shortcuts']);
  assert.equal(settings.get().shortcuts.playPause, DEFAULTS.shortcuts.playPause);
  assert.deepEqual(heard, [['volume'], ['shortcuts']]);
  settings.flush();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.volume, 30);
  assert.equal(saved.shortcuts.next, 'Alt+N');
  assert.deepEqual(validSettings({ playlistId: 'not a playlist', clientVersion: '2.20261112.00.00' }), { clientVersion: '2.20261112.00.00' });
  assert.equal(DEFAULTS.playlistId, null); // chosen on first start
  assert.deepEqual(validSettings({ playlistId: null }), { playlistId: null });
});

test('auto-hide: hides after the mouse has been away a while, shows at the edge', () => {
  let now = 0;
  let cursor = { x: 1300, y: 400 };
  let visible = true;
  const bounds = dockedBounds(workArea, 'right', 400);
  const hide = createAutoHide({
    now: () => now,
    cursor: () => cursor,
    state: () => ({ visible, bounds, display, side: 'right', held: false }),
    show: () => { visible = true; },
    hide: () => { visible = false; },
  });
  hide.tick(); // inside: arms it
  cursor = { x: 200, y: 400 };
  now = 100; hide.tick();
  now = 500; hide.tick();
  assert.equal(visible, true, 'not yet');
  now = 900; hide.tick();
  assert.equal(visible, false, 'hidden after 700 ms away');
  cursor = { x: 1511, y: 300 };
  now = 1000; hide.tick();
  assert.equal(visible, false, 'a quick brush past the edge is not enough');
  now = 1250; hide.tick();
  assert.equal(visible, true, 'shown after resting at the edge');
});

test('auto-hide: an explicit show waits for the mouse to visit; held open stays open', () => {
  let now = 0;
  let visible = true;
  let held = false;
  const cursor = { x: 10, y: 400 };
  const hide = createAutoHide({
    now: () => now, cursor: () => cursor,
    state: () => ({ visible, bounds: dockedBounds(workArea, 'right', 400), display, side: 'right', held }),
    show: () => { visible = true; }, hide: () => { visible = false; },
  });
  hide.shown();
  for (now = 0; now < 5000; now += 150) hide.tick();
  assert.equal(visible, true, 'never visited, never hidden');
  cursor.x = 1300; hide.tick();
  held = true;
  cursor.x = 10;
  for (; now < 10000; now += 150) hide.tick();
  assert.equal(visible, true, 'held open (e.g. typing in search)');
  held = false;
  for (; now < 11000; now += 150) hide.tick();
  assert.equal(visible, false);
});

test('tray menu shows what is playing and the current settings', () => {
  const menu = trayMenu({
    nowPlaying: { title: 'Song Title', channel: 'Some Artist', playing: true, id: 'aqz-KE-bpKQ' },
    visible: true,
    settings: { ...DEFAULTS, autoHide: true },
  });
  const labels = menu.filter((i) => i.label).map((i) => i.label);
  assert.equal(labels[0], 'Song Title');
  assert.equal(labels[1], 'Some Artist');
  assert.ok(labels.includes('Pause'));
  assert.ok(labels.includes('Hide Sidebar'));
  assert.ok(labels.includes('Move to Left Side'));
  assert.equal(menu.find((i) => i.id === 'autoHide').checked, true);
  assert.equal(menu.find((i) => i.id === 'next').accelerator, DEFAULTS.shortcuts.next);
  const idle = trayMenu({ nowPlaying: null, visible: false, settings: DEFAULTS });
  assert.equal(idle[0].label, 'Nothing playing');
  assert.equal(idle.find((i) => i.id === 'play-pause').label, 'Play');
  assert.equal(idle.find((i) => i.id === 'open-youtube').enabled, false);
});

test('shortcuts: registered, taken, invalid or off', () => {
  const registered = [];
  const fake = {
    unregisterAll() { registered.length = 0; },
    register(accelerator, fn) {
      if (accelerator === 'Bad+Key') throw new Error('invalid');
      if (accelerator === 'Alt+T') return false;
      registered.push([accelerator, fn]);
      return true;
    },
  };
  const fired = [];
  const status = registerShortcuts(fake, { playPause: 'Alt+P', next: 'Alt+T', previous: 'Bad+Key', toggleSidebar: '' }, (action) => fired.push(action));
  assert.deepEqual(status, { playPause: 'ok', next: 'taken', previous: 'invalid', toggleSidebar: 'off' });
  registered[0][1]();
  assert.deepEqual(fired, ['play-pause']);
});

test('settings: a damaged file with "__proto__" or "toString" keys is just ignored', () => {
  assert.deepEqual(validSettings(JSON.parse('{"__proto__": {"side": "left"}, "toString": 1, "valueOf": true, "volume": 20}')), { volume: 20 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hymn-settings-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"__proto__": {"x": 1}, "side": "left"}');
  assert.equal(createSettings(file).get().side, 'left');
});

test('shortcuts must not swallow ordinary typing', () => {
  for (const ok of ['Control+Alt+Command+P', 'Control+Alt+Command+Right', 'Alt+Shift+]', 'F8', 'Shift+F5', '']) assert.equal(isSafeAccelerator(ok), true, ok);
  for (const bad of ['A', 'Space', 'Shift+A', 'Control+Control+P', 'Hyper+P', 'Control+', 'Control+Alt+Command+PP', null]) assert.equal(isSafeAccelerator(bad), false, String(bad));
  assert.deepEqual(validSettings({ shortcuts: { next: 'Space' } }), {});
  assert.deepEqual(validSettings({ shortcuts: { next: '' } }), { shortcuts: { next: '' } });
});
