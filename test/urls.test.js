import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStart, parseYouTubeInput } from '../src/shared/youtube-urls.js';
import { ago, fold, formatTime, parseDuration } from '../src/shared/format.js';

test('links to videos, playlists and both', () => {
  const cases = {
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ': { videoId: 'aqz-KE-bpKQ', start: 0 },
    'youtube.com/watch?v=aqz-KE-bpKQ&t=1m30s': { videoId: 'aqz-KE-bpKQ', start: 90 },
    'https://youtu.be/aqz-KE-bpKQ?t=42': { videoId: 'aqz-KE-bpKQ', start: 42 },
    'https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=RDAMVMaqz-KE-bpKQ': { videoId: 'aqz-KE-bpKQ', start: 0, playlistId: 'RDAMVMaqz-KE-bpKQ' },
    'https://m.youtube.com/shorts/aqz-KE-bpKQ': { videoId: 'aqz-KE-bpKQ', start: 0 },
    'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?start=10': { videoId: 'aqz-KE-bpKQ', start: 10 },
    'https://www.youtube.com/live/aqz-KE-bpKQ': { videoId: 'aqz-KE-bpKQ', start: 0 },
    'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI': { playlistId: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', start: 0 },
    'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI': { playlistId: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', start: 0 },
    'VLPLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI': { playlistId: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', start: 0 },
    '  https://www.youtube.com/watch?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&v=aqz-KE-bpKQ  ': { videoId: 'aqz-KE-bpKQ', playlistId: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', start: 0 },
  };
  for (const [input, expected] of Object.entries(cases)) assert.deepEqual(parseYouTubeInput(input), expected, input);
});

test('anything else is not a YouTube link', () => {
  for (const input of ['', '   ', 'some song title', 'aqz-KE-bpKQ', 'Thunderstru', 'https://vimeo.com/123',
    'https://www.youtube.com/watch?v=short', 'https://evil.example/watch?v=aqz-KE-bpKQ', 'https://www.youtube.com/@channel', 'javascript:alert(1)']) {
    assert.equal(parseYouTubeInput(input), null, input);
  }
});

test('start times', () => {
  assert.equal(parseStart('90'), 90);
  assert.equal(parseStart('90s'), 90);
  assert.equal(parseStart('1h2m3s'), 3723);
  assert.equal(parseStart('abc'), 0);
  assert.equal(parseStart(null), 0);
});

test('durations and times', () => {
  assert.equal(parseDuration('4:01'), 241);
  assert.equal(parseDuration('1:37:02'), 5822);
  assert.equal(parseDuration('LIVE'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(formatTime(241), '4:01');
  assert.equal(formatTime(5822), '1:37:02');
  assert.equal(formatTime(NaN), '');
  assert.equal(ago(1000, 1000 + 30_000), 'just now');
  assert.equal(ago(0, 5 * 60_000), '5 min ago');
  assert.equal(ago(0, 3 * 3600_000), '3 h ago');
  assert.equal(ago(0, 49 * 3600_000), '2 days ago');
});

test('matching ignores case and accents', () => {
  assert.equal(fold('Arcángel'), 'arcangel');
  assert.equal(fold('Cantique de NOËL'), 'cantique de noel');
  assert.equal(fold('GROẞ'), 'groß'.toLowerCase());
});
