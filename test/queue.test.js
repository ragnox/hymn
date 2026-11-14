import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueue, shuffled } from '../src/renderer/queue.js';

const tracks = (n, prefix = 't') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(10, '0')}`.slice(0, 11), title: `${prefix}${i}` }));
const titles = (list) => list.map((t) => t?.title ?? null);
// A predictable "random": cycles through fixed values.
const seeded = (values = [0.42, 0.13, 0.77, 0.05, 0.91, 0.36, 0.6, 0.28]) => { let i = 0; return () => values[i++ % values.length]; };

test('shuffled() keeps every item exactly once', () => {
  const items = [...Array(50).keys()];
  const out = shuffled(items, seeded());
  assert.equal(out.length, 50);
  assert.deepEqual([...out].sort((a, b) => a - b), items);
  assert.notDeepEqual(out, items);
});

test('in order: next, previous, forward again, and the end of the list', () => {
  const q = createQueue();
  q.setRepeat('off');
  assert.equal(q.setContext({ kind: 'playlist', tracks: tracks(3) }).title, 't0');
  assert.equal(q.next().title, 't1');
  assert.equal(q.next().title, 't2');
  assert.equal(q.next(), null);
  assert.equal(q.current.title, 't2');
  assert.equal(q.previous().title, 't1');
  assert.equal(q.previous().title, 't0');
  assert.equal(q.previous(), null);
  assert.equal(q.next().title, 't1'); // forward through what we stepped back over
  assert.equal(q.next().title, 't2');
});

test('repeat all wraps around; repeat one replays only when a song ends by itself', () => {
  const q = createQueue();
  q.setContext({ kind: 'playlist', tracks: tracks(2), startIndex: 1 });
  assert.equal(q.next().title, 't0');
  q.setRepeat('one');
  assert.equal(q.next({ auto: true }).title, 't0');
  assert.equal(q.next().title, 't1');
});

test('a single song: next does nothing, but repeat all replays it when it ends', () => {
  const q = createQueue();
  q.setContext({ kind: 'link', tracks: tracks(1) });
  assert.equal(q.next(), null);
  assert.equal(q.next({ auto: true }).title, 't0');
});

test('clicking a song plays it; next continues after it', () => {
  const q = createQueue();
  q.setContext({ kind: 'playlist', tracks: tracks(5) });
  assert.equal(q.playIndex(3).title, 't3');
  assert.equal(q.next().title, 't4');
  assert.equal(q.next().title, 't0');
});

test('shuffle plays every song once per round and never the same song twice in a row', () => {
  const q = createQueue({ random: seeded() });
  q.setShuffle(true);
  const list = tracks(8);
  const played = [q.setContext({ kind: 'playlist', tracks: list }).title];
  for (let i = 0; i < 23; i++) played.push(q.next().title);
  for (let round = 0; round < 3; round++) {
    assert.equal(new Set(played.slice(round * 8, round * 8 + 8)).size, 8, `round ${round}`);
  }
  for (let i = 1; i < played.length; i++) assert.notEqual(played[i], played[i - 1]);
});

test('turning shuffle on keeps the current song and plays all the others next', () => {
  const q = createQueue({ random: seeded() });
  q.setContext({ kind: 'playlist', tracks: tracks(6), startIndex: 2 });
  q.setShuffle(true);
  assert.equal(q.current.title, 't2');
  const rest = titles(q.upcoming(5).map((u) => u.track));
  assert.deepEqual([...rest].sort(), ['t0', 't1', 't3', 't4', 't5']);
  q.setShuffle(false);
  assert.equal(q.next().title, 't3');
});

test('songs queued by hand come first, then the list continues where it was', () => {
  const q = createQueue();
  const extra = tracks(2, 'x');
  q.setContext({ kind: 'playlist', tracks: tracks(4) });
  q.enqueue(extra[0]);
  q.enqueue(extra[1]);
  assert.deepEqual(titles(q.upcoming(4).map((u) => u.track)), ['x0', 'x1', 't1', 't2']);
  assert.equal(q.next().title, 'x0');
  assert.equal(q.inContext, false);
  assert.equal(q.next().title, 'x1');
  assert.equal(q.next().title, 't1');
  q.enqueue(extra[0]);
  q.removeQueued(0);
  assert.equal(q.next().title, 't2');
});

test('blocked songs are skipped everywhere', () => {
  const blocked = new Set();
  const q = createQueue({ blocked });
  const list = tracks(4);
  q.setContext({ kind: 'playlist', tracks: list });
  q.block(list[1].id);
  q.block(list[2].id);
  assert.equal(q.next().title, 't3');
  assert.equal(q.remaining(), 0);
  q.enqueue(list[1]);
  assert.equal(q.next().title, 't0'); // the queued one is blocked too
  assert.ok(blocked.has(list[2].id));
});

test('every song blocked: next gives up instead of looping', () => {
  const list = tracks(3);
  const q = createQueue({ blocked: new Set(list.map((t) => t.id)) });
  assert.equal(q.setContext({ kind: 'playlist', tracks: list }), null);
  assert.equal(q.next({ auto: true }), null);
});

test('a growing mix: extend adds only new songs, remaining counts what is left', () => {
  const q = createQueue();
  q.setRepeat('off');
  const list = tracks(3);
  q.setContext({ kind: 'radio', tracks: list });
  assert.equal(q.remaining(), 2);
  assert.equal(q.extend([list[1], ...tracks(2, 'm')]), 2);
  assert.equal(q.remaining(), 4);
  q.next(); q.next(); q.next();
  assert.equal(q.next().title, 'm1');
  assert.equal(q.next(), null);
});

test('a refreshed playlist keeps the song that is playing', () => {
  const q = createQueue();
  const list = tracks(5);
  q.setContext({ kind: 'playlist', tracks: list, startIndex: 2 });
  q.replaceTracks([list[4], list[2], list[0]]); // reordered, two removed
  assert.equal(q.current.title, 't2');
  assert.equal(q.inContext, true);
  assert.equal(q.next().title, 't0');
});

test('snapshot and restore pick up the same song, order and queue', () => {
  const q = createQueue({ random: seeded() });
  q.setShuffle(true);
  const list = tracks(6);
  q.setContext({ kind: 'playlist', id: 'PLx', title: 'Music', tracks: list });
  q.next();
  q.enqueue(tracks(1, 'x')[0]);
  const snap = JSON.parse(JSON.stringify(q.snapshot()));
  assert.equal(snap.context.tracks, null); // the playlist itself isn't stored twice
  const upcoming = titles(q.upcoming(10).map((u) => u.track));

  const r = createQueue({ random: seeded() });
  r.setShuffle(true);
  assert.equal(r.restore(snap, list).title, q.current.title);
  assert.equal(r.context.title, 'Music');
  assert.deepEqual(titles(r.upcoming(10).map((u) => u.track)), upcoming);
  assert.equal(r.restore({ context: { kind: 'playlist' } }, null), null);
});

test('after stepping back, queued songs come before going forward; turning shuffle off forgets "forward"', () => {
  const q = createQueue();
  const list = tracks(5);
  const extra = tracks(1, 'x')[0];
  q.setContext({ kind: 'playlist', tracks: list });
  q.next();
  q.next(); // t2
  q.previous(); // t1, forward: t2
  q.enqueue(extra);
  assert.equal(q.next().title, 'x0');
  assert.equal(q.next().title, 't2'); // then forward again
  q.previous(); // x0
  q.previous(); // t1
  q.setShuffle(false);
  assert.equal(q.next().title, 't2'); // next in the list, not "forward"
});

test('a refreshed shuffled playlist keeps its round: no song comes twice', () => {
  const q = createQueue({ random: seeded() });
  q.setShuffle(true);
  const list = tracks(10);
  const played = [q.setContext({ kind: 'playlist', tracks: list }).title];
  for (let i = 0; i < 4; i++) played.push(q.next().title);
  q.replaceTracks([...list, ...tracks(2, 'n')]); // two new songs on YouTube
  const rest = titles(q.upcoming(20).map((u) => u.track)).slice(0, 7);
  assert.ok(rest.every((t) => !played.includes(t)), `${rest} after ${played}`);
});

test('the place in the list survives an up-next song, shuffle toggles and a restart', () => {
  const q = createQueue();
  const list = tracks(8);
  q.setContext({ kind: 'playlist', id: 'PLx', tracks: list, startIndex: 5 });
  q.enqueue(tracks(1, 'x')[0]);
  q.next(); // the up-next song
  q.setShuffle(false);
  const snap = JSON.parse(JSON.stringify(q.snapshot()));
  assert.equal(q.next().title, 't6');
  const r = createQueue();
  assert.equal(r.restore(snap, list).title, 'x0');
  assert.equal(r.next().title, 't6');
});

test('previous skips songs that turned out to be blocked; a new list forgets "forward"', () => {
  const blocked = new Set();
  const q = createQueue({ blocked });
  const list = tracks(4);
  q.setContext({ kind: 'playlist', tracks: list });
  q.next(); q.next(); // t2
  blocked.add(list[1].id);
  assert.equal(q.previous().title, 't0');
  q.setContext({ kind: 'search', tracks: tracks(2, 's') });
  assert.equal(q.current.title, 's0');
  assert.equal(q.next().title, 's1');
});

test('an endless radio never starts over: it ends so it can grow', () => {
  const q = createQueue();
  q.setContext({ kind: 'radio', tracks: tracks(1), startIndex: 0, endless: true });
  assert.equal(q.next({ auto: true }), null);
  assert.equal(q.extend(tracks(2, 'm')), 2);
  assert.equal(q.next({ auto: true }).title, 'm0');
});
