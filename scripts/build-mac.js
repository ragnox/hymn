#!/usr/bin/env node
// Builds Hymn.app for this Mac's architecture: `npm run dist` (DMG + zip) or `npm run dist:dir` (just the app,
// in dist/mac-arm64/ or dist/mac/). Without a Developer ID certificate (CSC_LINK) the app is signed ad hoc:
// fine on this Mac; on another one, macOS asks before opening it the first time.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('Build Hymn.app on macOS');
const run = (args, env = process.env) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  if (result.status) process.exit(result.status);
};
run(['scripts/make-icons.js']);
const signed = Boolean(process.env.CSC_LINK);
const args = ['node_modules/electron-builder/cli.js', '--mac', `--${process.arch}`, '--publish', 'never'];
if (process.argv.includes('--dir')) args.push('--dir');
if (!signed) args.push('--config.mac.identity=-');
run(args, { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false' });
