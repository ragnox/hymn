// The page's only way to the main process: a small, fixed API on window.hymn.
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const answer = await ipcRenderer.invoke(channel, ...args);
  if (answer?.error) throw new Error(answer.error);
  return answer?.value;
}

const EVENTS = new Set(['command', 'settings']);

contextBridge.exposeInMainWorld('hymn', {
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  youtube: {
    playlist: (id, options) => invoke('yt:playlist', id, options),
    search: (query) => invoke('yt:search', query),
    mix: (videoId) => invoke('yt:mix', videoId),
    video: (videoId) => invoke('yt:video', videoId),
  },
  state: {
    load: () => invoke('state:load'),
    save: (value) => ipcRenderer.send('state:save', value),
  },
  shortcuts: () => invoke('shortcuts:status'),
  nowPlaying: (info) => ipcRenderer.send('now-playing', info),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  window: (action, value) => ipcRenderer.send('window', action, value),
  /** Listens for 'command' (name, arg) or 'settings' (settings); returns a function that stops listening. */
  on(event, callback) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
