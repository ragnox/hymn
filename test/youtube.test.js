// The YouTube parsers against real answers saved in test/fixtures (gzipped JSON, as YouTube sent it in
// November 2026, recorded with scripts/record-fixtures.js), plus the fetching logic against a fake fetch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { test } from 'node:test';
import {
  createYouTube, parseContinuation, parseMix, parsePlaylistPage, parseRelated, parseSearch, textOf, YouTubeError,
} from '../src/main/youtube.js';

const fixture = (name) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))));

const isTrack = (t) => /^[\w-]{11}$/.test(t.id) && typeof t.title === 'string' && t.title.length > 0 && typeof t.channel === 'string';

test('textOf reads every text shape', () => {
  assert.equal(textOf('a'), 'a');
  assert.equal(textOf({ content: 'b' }), 'b');
  assert.equal(textOf({ simpleText: 'c' }), 'c');
  assert.equal(textOf({ runs: [{ text: 'd' }, { text: 'e' }] }), 'de');
  assert.equal(textOf(null), '');
  assert.equal(textOf({}), '');
});

test('first playlist page: title, owner, size, 100 videos and a next-page token', () => {
  const page = parsePlaylistPage(fixture('playlist'));
  assert.equal(page.title, 'Popular Music Videos');
  assert.equal(page.owner, 'Music');
  assert.equal(page.total, 182);
  assert.equal(page.tracks.length, 100);
  assert.ok(page.tracks.every(isTrack));
  assert.deepEqual(page.tracks[0], { id: 'fOT0BUpITw8', title: 'BELLAKEO (Video Oficial) - Peso Pluma, Anitta', channel: 'Peso Pluma', duration: 235 });
  assert.deepEqual(page.tracks[1], { id: 'NFvDHYMzj9U', title: 'Arcángel - FN8 ( Video Lyric )', channel: 'Arcangel', duration: 650 });
  assert.match(page.continuation, /^4qmF/);
  assert.equal(page.error, null);
});

test('later playlist page: the remaining videos and no further token', () => {
  const page = parseContinuation(fixture('playlist-continuation'));
  assert.equal(page.tracks.length, 82);
  assert.ok(page.tracks.every(isTrack));
  assert.equal(page.tracks[0].title, 'Andrea Bocelli, Matteo Bocelli - Holy Night / Cantique de Noël (The Chosen Performance)');
  assert.equal(page.continuation, null);
});

test('search: videos with channel and length', () => {
  const tracks = parseSearch(fixture('search'));
  assert.equal(tracks.length, 20);
  assert.ok(tracks.every(isTrack));
  assert.deepEqual(tracks[0], { id: 'q_kw904K2bw', title: 'Beethoven: Symphony No. 5 Fate Symphony | Christian Thielemann & Vienna Philharmonic', channel: 'DW Classical Music', duration: 2347 });
});

test('mix: title and 25 videos, starting with the seed', () => {
  const mix = parseMix(fixture('mix'));
  assert.equal(mix.id, 'RDfOT0BUpITw8');
  assert.equal(mix.title, 'Mix - BELLAKEO (Video Oficial) - Peso Pluma, Anitta');
  assert.equal(mix.tracks.length, 25);
  assert.ok(mix.tracks.every(isTrack));
  assert.equal(mix.tracks[0].id, 'fOT0BUpITw8');
  assert.deepEqual(mix.tracks[1], { id: '-r687V8yqKY', title: 'FloyyMenor, Cris MJ - Gata Only (Video Oficial)', channel: 'FloyyMenor', duration: 216 });
});

test('related: the suggested videos', () => {
  const tracks = parseRelated(fixture('related'));
  assert.equal(tracks.length, 18);
  assert.ok(tracks.every(isTrack));
  assert.ok(tracks.every((t) => t.duration > 0));
});

test('an error notice instead of a playlist is reported', () => {
  const page = parsePlaylistPage({ alerts: [{ alertRenderer: { type: 'ERROR', text: { runs: [{ text: 'The playlist does not exist.' }] } } }] });
  assert.equal(page.tracks.length, 0);
  assert.equal(page.error, 'The playlist does not exist.');
});

// A fake fetch that answers InnerTube calls from the fixtures and records what was asked.
function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, headers: init.headers });
    const answer = answers(String(url), body, calls.length);
    if (answer instanceof Error) throw answer;
    const { status = 200, json, text } = answer;
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => text ?? JSON.stringify(json) };
  };
  return { fetch, calls };
}

test('playlist() follows the next-page token and returns every video', async () => {
  const { fetch, calls } = fakeFetch((url, body) => ({ json: body.continuation ? fixture('playlist-continuation') : fixture('playlist') }));
  const playlist = await createYouTube({ fetch }).playlist('PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  assert.equal(playlist.tracks.length, 182);
  assert.equal(playlist.title, 'Popular Music Videos');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.browseId, 'VLPLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  assert.equal(calls[0].body.context.client.clientName, 'WEB');
  assert.match(calls[1].body.continuation, /^4qmF/);
});

test('an outdated client version is refreshed once and remembered', async () => {
  const seen = [];
  const { fetch, calls } = fakeFetch((url, body) => {
    if (url.includes('/results?')) return { text: '..."INNERTUBE_CLIENT_VERSION":"2.20270101.01.00"...' };
    return body.context.client.clientVersion === '2.20270101.01.00' ? { json: fixture('search') } : { status: 400, json: {} };
  });
  const youtube = createYouTube({ fetch, clientVersion: '2.1', onClientVersion: (v) => seen.push(v) });
  assert.equal((await youtube.search('x')).length, 20);
  assert.deepEqual(seen, ['2.20270101.01.00']);
  assert.equal(youtube.clientVersion, '2.20270101.01.00');
  assert.equal(calls.length, 3);
});

test('network and HTTP failures become readable YouTubeErrors', async () => {
  const offline = createYouTube({ fetch: fakeFetch(() => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })).fetch });
  await assert.rejects(offline.search('x'), (err) => err instanceof YouTubeError && /Can't reach YouTube \(ENOTFOUND\)/.test(err.message));
  const broken = createYouTube({ fetch: fakeFetch(() => ({ status: 500, json: {} })).fetch });
  await assert.rejects(broken.mix('fOT0BUpITw8'), /YouTube answered 500/);
  await assert.rejects(broken.playlist('nope'), /not a YouTube playlist ID/);
});

test('mix() falls back to related videos when YouTube has no mix', async () => {
  const { fetch } = fakeFetch((url, body) => ({ json: body.playlistId ? {} : fixture('related') }));
  const mix = await createYouTube({ fetch }).mix('fOT0BUpITw8');
  assert.equal(mix.title, 'Related videos');
  assert.equal(mix.tracks.length, 18);
});

test('video() reads title and channel from oEmbed', async () => {
  const { fetch, calls } = fakeFetch(() => ({ json: { title: 'Big Buck Bunny', author_name: 'Blender' } }));
  assert.deepEqual(await createYouTube({ fetch }).video('aqz-KE-bpKQ'), { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny', channel: 'Blender', duration: null });
  assert.match(calls[0].url, /oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Daqz-KE-bpKQ/);
});

test('a failing later page keeps the first one; HTML instead of JSON is a readable error', async () => {
  const { fetch } = fakeFetch((url, body) => (body.continuation ? { status: 500, json: {} } : { json: fixture('playlist') }));
  const playlist = await createYouTube({ fetch }).playlist('PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  assert.equal(playlist.tracks.length, 100);
  assert.equal(playlist.partial, true);
  const html = createYouTube({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) });
  await assert.rejects(html.search('x'), (err) => err instanceof YouTubeError && /something unexpected/.test(err.message));
  assert.equal(parseSearch({ contents: [{ videoRenderer: null }, { videoRenderer: { videoId: 'aqz-KE-bpKQ', title: { simpleText: 'x' } } }] }).length, 1);
});
