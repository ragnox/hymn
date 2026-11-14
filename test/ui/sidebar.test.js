// The whole app, end to end, against live YouTube: hidden window, muted, throwaway profile.
// Needs a network connection. HYMN_UI_SCREENSHOTS=<dir> keeps screenshots of the main states.
// It plays a public playlist of YouTube's own Music channel; its songs change over time, so the test
// takes them from the playlist as it is rather than expecting particular ones.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openApp } from './app.js';

const SHOTS = process.env.HYMN_UI_SCREENSHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PLAYLIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'; // "Popular Music Videos", by YouTube's Music channel
const BLOCKED = 'HxilwT1sKSo'; // an age-restricted official video: embedded players refuse it (error 150)
const SEARCH = 'beethoven symphony 5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the player is really playing: `id`, or anything but `not`. */
function playing(app, { id = null, not = null } = {}) {
  return app.waitFor(({ id, not }) => {
    const { player, current } = window.hymnDebug;
    const loaded = player.videoData.video_id;
    if (player.state !== 1 || !current || loaded !== current.id) return false;
    if (id && current.id !== id) return false;
    if (not && current.id === not) return false;
    return current.id;
  }, { id, not }, { what: `playing ${id ?? `anything but ${not}`}`, timeout: 40_000 });
}

const debug = (app) => app.evaluate(() => {
  const { player, current, queue, playing: isPlaying } = window.hymnDebug;
  return { state: player.state, time: player.time, duration: player.duration, id: current?.id ?? null, playing: isPlaying, kind: queue.context.kind, contextSize: queue.context.tracks.length };
});

async function waitForMain(app, check, what) {
  const end = Date.now() + 10_000;
  for (;;) {
    const info = await app.inspect();
    if (check(info)) return info;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify({ bounds: info.bounds, visible: info.visible })}`);
    await sleep(100);
  }
}

async function clearField(app, selector) {
  await app.evaluate((sel) => {
    const field = document.querySelector(sel);
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector);
}

/**
 * Clicks the position bar at `fraction` until the player is really there. Popular videos can start with an
 * ad, during which YouTube's player ignores seeking. Returns the position.
 */
async function seekBar(app, fraction) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await app.clickAt('#seek', fraction);
    await sleep(1500); // the player frame reports its real position by then
    const { time, duration } = await debug(app);
    if (duration && Math.abs(time / duration - fraction) < 0.05) return time;
    await sleep(2500);
  }
  throw new Error(`The player didn't go to ${fraction * 100}%`);
}

/** A screenshot for the README: only when keeping screenshots, after the video has had time to paint. */
async function cleanScreenshot(app, name) {
  if (!SHOTS) return null;
  await sleep(3000);
  await app.evaluate(() => { document.querySelector('#toast').hidden = true; });
  return app.screenshot(name);
}

/** The songs of the playlist as shown: [{ id, title, channel }] in list order. */
const rows = (app) => app.evaluate(() => [...document.querySelectorAll('#playlist-list .row')].map((row) => ({
  id: row.dataset.id,
  title: row.querySelector('.row-title').textContent,
  channel: row.querySelector('.row-sub').textContent.split(' · ')[0],
})));

test('Hymn against live YouTube (hidden, muted)', { timeout: 900_000 }, async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hymn-ui-'));
  let app = await openApp({ profile, screenshots: SHOTS });
  t.after(() => app.close());
  let songs = []; // the playlist's first songs: A, B, C
  let [A, B, C] = [];

  await t.test('the first start asks for a playlist, and a pasted link loads it', async () => {
    await app.waitFor(() => document.body.classList.contains('ready'), null, { what: 'the page', timeout: 30_000 });
    assert.equal(await app.evaluate(() => document.querySelector('#playlist-setup').hidden), false);
    assert.equal(await app.text('#playlist-meta'), 'Not chosen yet');
    await app.screenshot('0-first-start');
    await app.click('#playlist-setup-input');
    await app.type(`https://www.youtube.com/playlist?list=${PLAYLIST}`);
    await app.key('Enter');
    await app.waitFor(() => document.querySelectorAll('#playlist-list .row').length > 100, null, { what: 'playlist rows', timeout: 40_000 });
    assert.equal(await app.text('#playlist-title'), 'Popular Music Videos');
    assert.match(await app.text('#playlist-meta'), /^\d+ songs · by Music$/);
    assert.equal(await app.evaluate(() => document.querySelector('#playlist-setup').hidden), true);
    assert.equal((await app.inspect()).settings.playlistId, PLAYLIST);
    assert.match(await app.text('#playlist-list .row[data-index="0"]'), / · \d+:\d\d$/); // channel · length
    songs = await rows(app);
    [A, B, C] = songs;
    await app.waitFor(() => window.hymnDebug.player.ready, null, { what: "YouTube's player", timeout: 40_000 });
    assert.equal(await app.text('#video-empty-text'), 'Pick a song to start');
  });

  await t.test('clicking a song plays it, and the menu bar knows', async () => {
    await app.click(`#playlist-list .row[data-id="${A.id}"] .row-main`);
    await playing(app, { id: A.id });
    assert.equal(await app.text('#now-title'), A.title);
    assert.equal(await app.text('#now-channel'), A.channel);
    assert.ok(await app.evaluate((id) => document.querySelector(`#playlist-list .row[data-id="${id}"]`).classList.contains('playing'), A.id));
    assert.equal(await app.evaluate(() => document.querySelector('#play').getAttribute('aria-label')), 'Pause');
    const { tray } = await app.inspect();
    assert.ok(tray[0].label.startsWith(A.title.slice(0, 40)), tray[0].label);
    assert.equal(tray.find((item) => item.id === 'play-pause').label, 'Pause');
    await cleanScreenshot(app, '1-playing');
  });

  await t.test('pause, play, seeking with the bar and the keyboard', async () => {
    await app.click('#play');
    await app.waitFor(() => window.hymnDebug.player.state === 2, null, { what: 'paused' });
    await waitForMain(app, (info) => info.tray.find((item) => item.id === 'play-pause').label === 'Play', 'tray says Play');
    await app.key('Space');
    await playing(app, { id: A.id });
    const half = await seekBar(app, 0.5);
    await app.key('Right');
    await app.waitFor((from) => window.hymnDebug.player.time >= from + 8, half, { what: '10 s further' });
  });

  await t.test('next and previous', async () => {
    await app.click('#next');
    const other = await playing(app, { not: A.id });
    assert.notEqual(other, A.id);
    await app.click('#previous');
    // Previous restarts a song that has played for more than 3 s; a second press goes back.
    await sleep(500);
    if ((await debug(app)).id !== A.id) await app.click('#previous');
    await playing(app, { id: A.id });
  });

  await t.test('shuffle and repeat are buttons that remember', async () => {
    assert.equal(await app.evaluate(() => document.querySelector('#shuffle').getAttribute('aria-pressed')), 'true');
    await app.click('#shuffle');
    await app.waitFor(() => document.querySelector('#shuffle').getAttribute('aria-pressed') === 'false', null, { what: 'shuffle off' });
    await waitForMain(app, (info) => info.settings.shuffle === false, 'shuffle saved');
    await app.click('#repeat');
    await waitForMain(app, (info) => info.settings.repeat === 'one', 'repeat one');
    await app.click('#repeat');
    await waitForMain(app, (info) => info.settings.repeat === 'off', 'repeat off');
    await app.click('#repeat');
    await waitForMain(app, (info) => info.settings.repeat === 'all', 'repeat all');
    // In order now: next after the first song is the second.
    await app.click('#next');
    await playing(app, { id: B.id });
  });

  await t.test('the filter finds songs', async () => {
    const word = B.channel.split(/\s+/).find((w) => w.length >= 3) ?? B.channel;
    await app.click('#playlist-filter');
    await app.type(word);
    const shown = await app.waitFor((w) => {
      const visible = [...document.querySelectorAll('#playlist-list .row')].filter((r) => !r.hidden);
      return visible.length > 0 && visible.length < document.querySelectorAll('#playlist-list .row').length && visible.map((r) => r.textContent);
    }, word, { what: `rows matching ${word}` });
    assert.ok(shown.every((text) => text.toLowerCase().includes(word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')) || text.toLowerCase().includes(word.toLowerCase())));
    await clearField(app, '#playlist-filter');
    await app.key('Escape');
  });

  await t.test('+ adds a song to Up next, which plays before the list goes on', async () => {
    await app.hover(`#playlist-list .row[data-id="${A.id}"]`);
    await app.click(`#playlist-list .row[data-id="${A.id}"] .row-action`);
    await app.waitFor(() => document.querySelector('#toast-text').textContent.startsWith('Up next'), null, { what: 'toast' });
    assert.equal(await app.text('#queue-count'), '1');
    await app.click('#tab-queue');
    await app.waitFor(() => document.querySelectorAll('#queue-list .row').length === 1, null, { what: 'one queued row' });
    assert.equal(await app.text('#queue-list .row .row-title'), A.title);
    assert.ok(await app.evaluate(() => document.querySelectorAll('#queue-context-list .row').length > 10));
    assert.equal(await app.text('#queue-context-title'), 'Then: Popular Music Videos');
    await cleanScreenshot(app, '2-queue');
    await app.click('#next');
    await playing(app, { id: A.id });
    await app.waitFor(() => document.querySelector('#queue-count').hidden, null, { what: 'empty queue' });
  });

  await t.test("a pasted link to a video that can't be embedded is skipped and remembered", async () => {
    await app.click('#tab-search');
    await app.click('#search-input');
    await app.type(`https://www.youtube.com/watch?v=${BLOCKED}`);
    await app.key('Enter');
    await app.waitFor(() => /^Skipped/.test(document.querySelector('#toast-text').textContent), null, { what: 'skip toast', timeout: 40_000 });
    assert.match(await app.text('#toast-text'), /outside YouTube|on YouTube/); // error 150 or 152, depending on YouTube's mood
    await playing(app, { not: BLOCKED }); // its mix goes on
    assert.equal((await debug(app)).kind, 'radio');
    assert.match(await app.text('#blocked-hint'), /^1 video can't be played outside YouTube/);
  });

  await t.test('search, and a picked song keeps going as a radio', async () => {
    await clearField(app, '#search-input');
    await app.click('#search-input');
    await app.type(SEARCH);
    await app.key('Enter');
    await app.waitFor(() => document.querySelectorAll('#search-list .row').length >= 5, null, { what: 'search results', timeout: 30_000 });
    assert.match(await app.text('#search-list .row'), /beethoven|symphon/i);
    const id = await app.evaluate(() => document.querySelector('#search-list .row').dataset.id);
    await app.click('#search-list .row .row-main');
    await playing(app, { id });
    await app.waitFor(() => window.hymnDebug.queue.context.kind === 'radio' && window.hymnDebug.queue.context.tracks.length > 10, null, { what: 'the mix behind it', timeout: 30_000 });
    await cleanScreenshot(app, '3-search');
  });

  await t.test('radio from this song, and discover', async () => {
    await app.click('#tab-radio');
    await app.click('#radio-current');
    await app.waitFor(() => window.hymnDebug.queue.context.kind === 'radio' && /^(Mix|Radio) · /.test(document.querySelector('#radio-title').textContent)
      && document.querySelectorAll('#radio-list .row').length > 10, null, { what: 'radio list', timeout: 30_000 });
    await app.click('#radio-discover');
    await app.waitFor(() => window.hymnDebug.queue.context.kind === 'discover', null, { what: 'discover', timeout: 40_000 });
    const id = await playing(app);
    assert.ok(!songs.some((song) => song.id === id), 'discover plays something that is not in the playlist');
    assert.match(await app.text('#radio-title'), /^Discover · like “/);
    await cleanScreenshot(app, '4-discover');
  });

  await t.test('a link to a song in a playlist plays that playlist from that song', async () => {
    await app.click('#tab-search');
    await clearField(app, '#search-input');
    await app.click('#search-input');
    await app.type(`https://www.youtube.com/watch?v=${B.id}&list=${PLAYLIST}`);
    await app.key('Enter');
    await playing(app, { id: B.id });
    assert.equal((await debug(app)).kind, 'list');
    assert.equal(await app.text('#search-title'), 'Popular Music Videos');
  });

  await t.test('a song that ends goes on to the next one by itself', async () => {
    // Jump to 12 s before the end (again, if an ad swallowed the jump) and wait for the next song.
    for (let attempt = 0; ; attempt++) {
      const { duration, id } = await debug(app);
      if (id === C.id) break;
      await app.clickAt('#seek', 1 - 12 / duration);
      const next = await app.waitFor((c) => window.hymnDebug.current?.id === c, C.id, { what: 'the next song', timeout: 25_000 }).catch(() => null);
      if (next || attempt >= 3) break;
    }
    await playing(app, { id: C.id });
  });

  await t.test('the window docks left or right, snaps when dropped, and keeps its width', async () => {
    let info = await app.inspect();
    const { workArea } = info;
    assert.equal(info.bounds.x + info.bounds.width, workArea.x + workArea.width - 8);
    assert.equal(info.bounds.y, workArea.y + 8);
    assert.equal(info.bounds.height, workArea.height - 16);
    await app.click('#swap-side');
    info = await waitForMain(app, (i) => i.bounds.x === workArea.x + 8, 'docked left');
    assert.equal(info.settings.side, 'left');
    await app.drop({ x: workArea.x + workArea.width - 500, y: workArea.y + 100, width: 380, height: 600 });
    info = await waitForMain(app, (i) => i.bounds.x + i.bounds.width === workArea.x + workArea.width - 8 && i.bounds.height === workArea.height - 16, 'snapped right');
    assert.equal(info.settings.side, 'right');

    await app.click('#open-settings');
    await app.waitFor(() => document.querySelector('#settings').classList.contains('open'), null, { what: 'settings open' });
    await sleep(300); // let it finish sliding in
    await app.screenshot('5-settings');
    await app.clickAt('#setting-width', 0.999);
    info = await waitForMain(app, (i) => i.bounds.width === 600, 'width 600');
    assert.equal(info.bounds.x + info.bounds.width, workArea.x + workArea.width - 8);
    await app.clickAt('#setting-width', 0.001);
    await waitForMain(app, (i) => i.bounds.width === 380, 'width 380');
    assert.equal(info.alwaysOnTop, true);
    await app.click('label.switch:has(#setting-alwaysOnTop)');
    await waitForMain(app, (i) => i.alwaysOnTop === false && i.settings.alwaysOnTop === false, 'not on top');
    assert.equal(await app.evaluate(() => document.querySelector('#pin').getAttribute('aria-pressed')), 'false');
    await app.key('Escape');
    await app.waitFor(() => document.querySelector('#settings').hidden, null, { what: 'settings closed' });
    await app.click('#pin');
    await waitForMain(app, (i) => i.alwaysOnTop === true, 'on top again');
    await app.click('#open-settings');
    await app.waitFor(() => document.querySelector('#settings').classList.contains('open'), null, { what: 'settings open again' });
  });

  await t.test('a global shortcut is recorded by pressing it', async () => {
    await app.click('.shortcut-keys[data-key="next"]');
    await app.waitFor(() => document.querySelector('.shortcut-keys[data-key="next"]').textContent === 'Press keys…', null, { what: 'recording' });
    await app.key('N', ['control', 'alt', 'meta']);
    await waitForMain(app, (i) => i.settings.shortcuts.next === 'Control+Alt+Command+N', 'shortcut saved');
    await app.waitFor(() => document.querySelector('.shortcut-keys[data-key="next"]').textContent === '⌃⌥⌘N', null, { what: 'shown as symbols' });
    await app.click('.shortcut-keys[data-key="next"]');
    await app.key('Right', ['control', 'alt', 'meta']);
    await waitForMain(app, (i) => i.settings.shortcuts.next === 'Control+Alt+Command+Right', 'shortcut back');
  });

  await t.test('auto-hide: away it goes when the mouse leaves, back at the screen edge', async () => {
    await app.click('label.switch:has(#setting-autoHide)');
    await waitForMain(app, (i) => i.settings.autoHide === true, 'auto-hide on');
    await app.key('Escape');
    await app.waitFor(() => document.querySelector('#settings').hidden, null, { what: 'settings closed' });
    const { bounds, displayBounds } = await app.inspect();
    const inside = { x: bounds.x + 50, y: bounds.y + 50 };
    const away = { x: displayBounds.x + 100, y: bounds.y + 300 };
    const edge = { x: displayBounds.x + displayBounds.width - 1, y: bounds.y + 300 };
    assert.equal(await app.autoHideTick(inside), true);
    assert.equal(await app.autoHideTick(away), true);
    await sleep(800);
    assert.equal(await app.autoHideTick(away), false, 'hidden after the mouse was away');
    assert.equal((await app.inspect()).tray.find((item) => item.id === 'toggle-sidebar').label, 'Show Sidebar');
    assert.equal(await app.autoHideTick(edge), false);
    await sleep(300);
    assert.equal(await app.autoHideTick(edge), true, 'back after resting at the edge');
    await app.run('autoHide'); // the menu-bar item turns it off again
    await waitForMain(app, (i) => i.settings.autoHide === false, 'auto-hide off');
  });

  await t.test('a restart picks up the same song, paused where it was, with the same settings', async () => {
    await app.click('#tab-playlist');
    await app.click(`#playlist-list .row[data-id="${A.id}"] .row-main`);
    await playing(app, { id: A.id });
    await seekBar(app, 0.4);
    await app.key('Space');
    await app.waitFor(() => window.hymnDebug.player.state === 2, null, { what: 'paused' });
    const before = await debug(app);
    await sleep(2500); // the main process writes the state at most every 2 s
    assert.deepEqual(app.errors, []);
    await app.close();

    app = await openApp({ profile, screenshots: SHOTS });
    await app.waitFor(() => window.hymnDebug.current?.id, null, { what: 'restored song', timeout: 40_000 });
    assert.equal(await app.text('#now-title'), A.title);
    await app.waitFor(() => window.hymnDebug.player.state === 5, null, { what: 'cued, not playing', timeout: 30_000 });
    assert.equal((await debug(app)).playing, false);
    const info = await app.inspect();
    assert.equal(info.settings.shuffle, false);
    assert.equal(info.settings.tab, 'playlist');
    assert.equal(info.settings.playlistId, PLAYLIST);
    assert.match(await app.text('#blocked-hint'), /^1 video/);
    await app.click('#play');
    await playing(app, { id: A.id });
    const after = await debug(app);
    assert.ok(Math.abs(after.time - before.time) < 6, `resumed at ${after.time}, paused at ${before.time}`);
    await cleanScreenshot(app, '6-restored');
    await app.theme('dark');
    await sleep(300);
    await cleanScreenshot(app, '7-dark');
    await app.theme('system');
  });

  await t.test("YouTube's player runs in its own frame, away from the app's API", async () => {
    const page = await app.evaluate(() => {
      const frame = document.querySelector('#video-host iframe');
      let reachable;
      try {
        reachable = Boolean(frame.contentWindow.hymn);
      } catch {
        reachable = false; // cross-origin: no access at all
      }
      return {
        frame: frame.src,
        scripts: [...document.scripts].map((script) => script.src),
        yt: typeof window.YT,
        hymn: typeof window.hymn,
        reachable,
      };
    });
    assert.equal(page.frame, 'app://player/player.html');
    assert.ok(page.scripts.every((src) => src.startsWith('app://hymn/')), page.scripts.join(', '));
    assert.equal(page.yt, 'undefined');
    assert.equal(page.hymn, 'object');
    assert.equal(page.reachable, false);
  });

  await t.test('no errors in the page', () => {
    assert.deepEqual(app.errors, []);
  });
});
