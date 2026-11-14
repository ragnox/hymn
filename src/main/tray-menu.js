// The menu-bar menu, as a plain template (main.js turns it into an Electron Menu).

const short = (text, max = 48) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The menu for what's playing (`nowPlaying`: { id, title, channel, playing } or null) and the settings. */
export function trayMenu({ nowPlaying, visible, settings }) {
  const keys = settings.shortcuts ?? {};
  const accelerator = (key) => keys[key] || undefined;
  return [
    { id: 'now-title', label: nowPlaying ? short(nowPlaying.title) : 'Nothing playing', enabled: false },
    ...(nowPlaying?.channel ? [{ id: 'now-channel', label: short(nowPlaying.channel), enabled: false }] : []),
    { type: 'separator' },
    { id: 'play-pause', label: nowPlaying?.playing ? 'Pause' : 'Play', accelerator: accelerator('playPause') },
    { id: 'next', label: 'Next', accelerator: accelerator('next') },
    { id: 'previous', label: 'Previous', accelerator: accelerator('previous') },
    { type: 'separator' },
    { id: 'radio', label: 'Radio from This Song', enabled: Boolean(nowPlaying) },
    { id: 'discover', label: 'Discover Something New' },
    { id: 'open-youtube', label: 'Open on YouTube', enabled: Boolean(nowPlaying) },
    { type: 'separator' },
    { id: 'toggle-sidebar', label: visible ? 'Hide Sidebar' : 'Show Sidebar', accelerator: accelerator('toggleSidebar') },
    { id: 'swap-side', label: settings.side === 'right' ? 'Move to Left Side' : 'Move to Right Side' },
    { id: 'alwaysOnTop', label: 'Keep on Top', type: 'checkbox', checked: settings.alwaysOnTop },
    { id: 'autoHide', label: 'Hide When Mouse Leaves', type: 'checkbox', checked: settings.autoHide },
    { id: 'menuBarTitle', label: 'Show Song in Menu Bar', type: 'checkbox', checked: settings.menuBarTitle },
    { type: 'separator' },
    { id: 'settings', label: 'Settings…' },
    { id: 'quit', label: 'Quit Hymn', accelerator: 'Command+Q' },
  ];
}
