#!/usr/bin/env node
// Records fresh YouTube answers into test/fixtures, for when YouTube changes its JSON and the parsers in
// src/main/youtube.js need fixing. Uses a public playlist of YouTube's own Music channel, a search, and
// the mix and related videos of the playlist's first song. Strips what identifies the request (visitor
// data, location, tracking tokens), so the fixtures say nothing about who recorded them.
//   node scripts/record-fixtures.js
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createYouTube, parseList, parsePlaylistPage } from '../src/main/youtube.js';

export const FIXTURE_PLAYLIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'; // "Popular Music Videos" by Music
const SEARCH = 'beethoven symphony 5';
const DROP = new Set(['responseContext', 'trackingParams', 'clickTrackingParams', 'visitorData', 'serviceTrackingParams',
  'loggingContext', 'loggingDirectives', 'adSignalsInfo', 'mainAppWebResponseContext', 'webResponseContextExtensionData',
  'frameworkUpdates', 'topbar', 'onResponseReceivedEndpoints']);

const scrub = (value) => JSON.parse(JSON.stringify(value, (key, v) => (DROP.has(key) ? undefined : v)));
const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));

// The raw answers: record what createYouTube fetches, by endpoint.
const answers = [];
const recordingFetch = async (url, init) => {
  const response = await fetch(url, init);
  if (!String(url).includes('/youtubei/')) return response;
  const json = await response.json();
  answers.push({ url: String(url), body: JSON.parse(init.body), json });
  return { ok: response.ok, status: response.status, json: async () => json, text: async () => JSON.stringify(json) };
};
const youtube = createYouTube({ fetch: recordingFetch });
const take = (predicate) => answers.filter(predicate).at(-1).json;

const playlist = await youtube.playlist(FIXTURE_PLAYLIST, { maxPages: 2 });
const first = take((a) => a.body.browseId);
const second = take((a) => a.body.continuation);
await youtube.search(SEARCH);
const search = take((a) => a.url.includes('/search'));
const seed = playlist.tracks[0].id;
await youtube.mix(seed);
const mix = take((a) => a.body.playlistId === `RD${seed}`);
await youtube.related(seed);
const related = take((a) => a.url.includes('/next') && !a.body.playlistId);

const fixtures = { playlist: first, 'playlist-continuation': second, search, mix, related };
for (const [name, json] of Object.entries(fixtures)) {
  const clean = JSON.stringify(scrub(json));
  for (const tell of ['"gl":', 'visitorData', 'Austria', 'de-AT', '"AT"']) {
    if (clean.includes(tell)) console.warn(`${name}: still contains ${tell}`);
  }
  fs.writeFileSync(`${dir}${name}.json.gz`, zlib.gzipSync(clean, { level: 9 }));
  console.log(`${name}: ${(clean.length / 1024).toFixed(0)} KB`);
}
const page = parsePlaylistPage(scrub(first));
console.log({ title: page.title, owner: page.owner, total: page.total, firstPage: page.tracks.length, first: page.tracks[0], second: page.tracks[1],
  continuation: parseList(scrub(second).onResponseReceivedActions ?? {}).tracks.length, seed, query: SEARCH });
