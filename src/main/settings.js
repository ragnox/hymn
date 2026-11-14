// Settings and saved state, as small JSON files in the app's data folder.
// Every value is checked on the way in, so a hand-edited or damaged file can't break the app.
import fs from 'node:fs';
import path from 'node:path';
import { isPlaylistId } from '../shared/youtube-urls.js';
import { MAX_WIDTH, MIN_WIDTH } from './geometry.js';
import { isSafeAccelerator } from './shortcuts.js';

export const DEFAULT_SHORTCUTS = {
  playPause: 'Control+Alt+Command+P',
  next: 'Control+Alt+Command+Right',
  previous: 'Control+Alt+Command+Left',
  toggleSidebar: 'Control+Alt+Command+H',
};

export const DEFAULTS = {
  playlistId: null, // chosen on first start, in the Playlist tab
  side: 'right',
  displayId: null,
  width: MIN_WIDTH,
  alwaysOnTop: true,
  autoHide: false,
  allSpaces: true,
  menuBarTitle: false,
  openAtLogin: false,
  volume: 70,
  muted: false,
  shuffle: true,
  repeat: 'all',
  tab: 'playlist',
  shortcuts: DEFAULT_SHORTCUTS,
  clientVersion: null,
};

const bool = (v) => typeof v === 'boolean';
const RULES = {
  playlistId: (v) => v === null || isPlaylistId(v),
  side: (v) => v === 'left' || v === 'right',
  displayId: (v) => v === null || Number.isSafeInteger(v),
  width: (v) => Number.isInteger(v) && v >= MIN_WIDTH && v <= MAX_WIDTH,
  alwaysOnTop: bool,
  autoHide: bool,
  allSpaces: bool,
  menuBarTitle: bool,
  openAtLogin: bool,
  volume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  muted: bool,
  shuffle: bool,
  repeat: (v) => ['off', 'all', 'one'].includes(v),
  tab: (v) => ['playlist', 'radio', 'search', 'queue'].includes(v),
  shortcuts: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, s]) => Object.hasOwn(DEFAULT_SHORTCUTS, k) && isSafeAccelerator(s)),
  clientVersion: (v) => v === null || (typeof v === 'string' && /^\d+\.\d{8}\.\d{2}\.\d{2}$/.test(v)),
};

/** `input` reduced to known, valid settings (shortcuts merged over the defaults). */
export function validSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    // Object.hasOwn: a "__proto__" or "toString" key in the file is just an unknown key.
    if (Object.hasOwn(RULES, key) && RULES[key](value)) out[key] = key === 'shortcuts' ? { ...value } : value;
  }
  return out;
}

/** A JSON file that's written atomically (a crash mid-write leaves the old file, not half a new one). */
export function jsonFile(file) {
  return {
    file,
    read(fallback = null) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return fallback;
      }
    },
    write(value) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

/**
 * The settings, kept in memory and written to `file` shortly after each change.
 * `set(patch)` applies the valid parts of `patch` and returns the keys that actually changed.
 */
export function createSettings(file, { delay = 300 } = {}) {
  const store = jsonFile(file);
  const saved = validSettings(store.read({}));
  let settings = { ...DEFAULTS, ...saved, shortcuts: { ...DEFAULT_SHORTCUTS, ...saved.shortcuts } };
  let timer = null;
  const listeners = new Set();

  const flush = () => {
    clearTimeout(timer);
    timer = null;
    try {
      store.write(settings);
    } catch (err) {
      console.error("Couldn't save the settings:", err.message); // e.g. a full disk; the next change tries again
    }
  };

  return {
    get: () => structuredClone(settings),
    set(patch) {
      const valid = validSettings(patch);
      if (valid.shortcuts) valid.shortcuts = { ...settings.shortcuts, ...valid.shortcuts };
      const changed = Object.keys(valid).filter((key) => JSON.stringify(valid[key]) !== JSON.stringify(settings[key]));
      if (!changed.length) return changed;
      settings = { ...settings, ...valid };
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
      timer.unref?.();
      for (const listener of listeners) listener(structuredClone(settings), changed);
      return changed;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: () => { if (timer) flush(); },
  };
}
