#!/usr/bin/env node
// Not part of `npm run test:ui`: plays N songs of the playlist back to back (skipping to the end of each)
// and prints the memory of each process before and after, to catch a player that keeps growing.
//   node test/ui/soak.js 40
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp } from './app.js';

const count = Number(process.argv[2] ?? 30);
const app = await openApp({ profile: fs.mkdtempSync(path.join(os.tmpdir(), 'hymn-soak-')) });
const total = (list) => list.reduce((sum, m) => sum + m.mb, 0);
try {
  await app.waitFor(() => document.body.classList.contains('ready'), null, { timeout: 60_000 });
  await app.click('#playlist-setup-input');
  await app.type('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
  await app.key('Enter');
  await app.waitFor(() => document.querySelectorAll('#playlist-list .row').length > 50 && window.hymnDebug.player.ready, null, { timeout: 60_000 });
  await app.click('#playlist-list .row[data-index="0"] .row-main');
  const before = await app.memory();
  let last = null;
  for (let i = 0; i < count; i++) {
    const id = await app.waitFor((not) => window.hymnDebug.player.state === 1 && window.hymnDebug.current?.id !== not && window.hymnDebug.current.id, last, { timeout: 60_000 });
    last = id;
    await app.evaluate(() => window.hymnDebug.player.seek(window.hymnDebug.player.duration - 1));
    if (i % 10 === 9) { const m = await app.memory(); console.log(`${i + 1} songs: ${total(m)} MB`, m.map((p) => `${p.type}#${p.pid}:${p.mb}`).join(" ")); }
  }
  const after = await app.memory();
  console.log('before', before, total(before), 'MB');
  console.log('after ', after, total(after), 'MB');
} finally {
  await app.close();
}
