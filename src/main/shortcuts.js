// Global keyboard shortcuts (work while other apps are in front).

export const SHORTCUT_ACTIONS = {
  playPause: 'play-pause',
  next: 'next',
  previous: 'previous',
  toggleSidebar: 'toggle-sidebar',
};

const MODIFIERS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
const KEYS = /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Left|Right|Up|Down|Space|Enter|Return|Tab|Home|End|PageUp|PageDown|Plus|[\[\],.\/;'`=\\-])$/;

/**
 * True for a shortcut that's safe to take over system-wide: a key with at least one modifier other than
 * Shift ("Control+Alt+Command+P"), or a function key. "A", "Space" or "Shift+A" would swallow typing.
 * An empty string (turned off) is fine too.
 */
export function isSafeAccelerator(accelerator) {
  if (accelerator === '') return true;
  if (typeof accelerator !== 'string' || accelerator.length > 60) return false;
  const parts = accelerator.split('+');
  const key = parts.pop();
  if (!KEYS.test(key) || new Set(parts).size !== parts.length || !parts.every((part) => MODIFIERS.has(part))) return false;
  return /^F\d/.test(key) || parts.some((part) => part !== 'Shift');
}

export const SHORTCUT_LABELS = {
  playPause: 'Play / pause',
  next: 'Next song',
  previous: 'Previous song',
  toggleSidebar: 'Show / hide sidebar',
};

/**
 * Registers `shortcuts` ({ playPause: 'Control+Alt+Command+P', … }) with Electron's `globalShortcut`,
 * replacing earlier ones. Returns each one's status: 'ok', 'taken' (another app has it), 'invalid' or 'off'.
 */
export function registerShortcuts(globalShortcut, shortcuts, run) {
  globalShortcut.unregisterAll();
  const status = {};
  for (const [key, action] of Object.entries(SHORTCUT_ACTIONS)) {
    const accelerator = shortcuts?.[key]?.trim();
    if (!accelerator) {
      status[key] = 'off';
      continue;
    }
    try {
      status[key] = globalShortcut.register(accelerator, () => run(action)) ? 'ok' : 'taken';
    } catch {
      status[key] = 'invalid';
    }
  }
  return status;
}
