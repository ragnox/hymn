#!/usr/bin/env node
// Renders Hymn's icons from one drawing — five rounded bars, like a level meter or organ pipes:
//   src/assets/trayTemplate.png (+@2x)  the menu-bar icon (black on clear; macOS tints it)
//   build/icon.png                      1024², macOS icon grid; electron-builder turns it into .icns
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

// Bars on a 24-unit grid: [x, y, width, height].
const BARS = [[2.5, 9.5, 3, 5], [7, 5.5, 3, 13], [11.5, 2.5, 3, 19], [16, 6.5, 3, 11], [20.5, 10, 1.5, 4]];
const bars = (fill, scale = 1, dx = 0, dy = 0) => BARS.map(([x, y, w, h]) =>
  `<rect x="${dx + x * scale}" y="${dy + y * scale}" width="${w * scale}" height="${h * scale}" rx="${(w * scale) / 2}" fill="${fill}"/>`).join('');

const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">${bars('#000')}</svg>`;

// The app icon: the bars in white on a pink-to-violet tile (824 px on a 1024 canvas, with Apple's margin).
const app = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff6a9a"/>
      <stop offset="0.55" stop-color="#d9408a"/>
      <stop offset="1" stop-color="#7a45f0"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.28" cy="0.18" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#2a0b3a" flood-opacity="0.35"/>
    </filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#3a0b2a" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#glow)"/>
  <g filter="url(#soft)">${bars('#fff', 22, 512 - 12 * 22, 512 - 12 * 22)}</g>
</svg>`;

await fs.mkdir(out('src/assets/'), { recursive: true });
await fs.mkdir(out('build/'), { recursive: true });
for (const scale of [1, 2]) {
  const file = out(`src/assets/trayTemplate${scale === 2 ? '@2x' : ''}.png`);
  await sharp(Buffer.from(tray), { density: 72 * scale * 1.5 }).resize(18 * scale, 18 * scale).png().toFile(file);
  console.log(`Wrote ${file}`);
}
await sharp(Buffer.from(app)).resize(1024, 1024).png().toFile(out('build/icon.png'));
console.log(`Wrote ${out('build/icon.png')}`);
