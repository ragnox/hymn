// Hymn: a sidebar music player for your YouTube playlist, YouTube mixes and search, with a menu-bar icon
// and global shortcuts. The page (src/renderer, app://hymn) shows the sidebar; YouTube's embedded player
// runs in a frame of its own inside it (src/player, app://player), away from the page's API. This main
// process owns the window, the menu bar, shortcuts, settings and all requests to YouTube's data endpoints.
import { app, dialog, globalShortcut, ipcMain, Menu, nativeImage, protocol, session, shell, Tray } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSettings, jsonFile } from './settings.js';
import { createSidebar } from './sidebar.js';
import { registerShortcuts } from './shortcuts.js';
import { trayMenu } from './tray-menu.js';
import { createYouTube, YouTubeError } from './youtube.js';
import { isPlaylistId, isVideoId, watchUrl } from '../shared/youtube-urls.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const SCHEME = 'app';
const APP_ORIGIN = `${SCHEME}://hymn`;
const PLAYER_ORIGIN = `${SCHEME}://player`;
// YouTube's embedded player wants to know which site or app embeds it (it refuses to play with error 153
// otherwise). An app without a web address names itself with an https URL made of its app ID.
const APP_REFERER = 'https://io.github.ragnox.hymn/';
const TEST = process.env.HYMN_TEST_DRIVER === '1';

if (TEST) app.setPath('userData', process.env.HYMN_PROFILE);
// Look like plain Chrome to YouTube (an "Electron/…" user agent gets odd answers from some sites).
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|hymn|Hymn)\/\S+/g, '');
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(start).catch((err) => {
    // Without this, a failed start would leave an invisible process holding the single-instance lock.
    console.error(err);
    dialog.showErrorBox("Hymn couldn't start", String(err?.stack ?? err));
    app.exit(1);
  });
}

// ---------------------------------------------------------------------------------------------------------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
// The two origins of the app, with their folder and Content Security Policy. Only the player frame may
// run YouTube's scripts; the sidebar page runs nothing but its own.
const SITES = {
  hymn: {
    root: 'renderer',
    csp: [
      "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https://i.ytimg.com",
      'media-src blob:', `frame-src ${PLAYER_ORIGIN}`, "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
  player: {
    root: 'player',
    csp: [
      "default-src 'none'", "script-src 'self' https://www.youtube.com https://s.ytimg.com", "style-src 'self'",
      "img-src 'self'", 'frame-src https://www.youtube.com https://www.youtube-nocookie.com', "connect-src 'self'",
      "base-uri 'none'", "form-action 'none'", `frame-ancestors ${APP_ORIGIN}`,
    ].join('; '),
  },
};
const notFound = () => new Response('Not found', { status: 404 });

/** Serves app://hymn/… from src/renderer, app://player/… from src/player, and …/shared/… from src/shared. */
async function serveApp(request) {
  let rel;
  let site;
  try {
    const url = new URL(request.url);
    site = SITES[url.hostname];
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return notFound(); // a malformed URL or % escape
  }
  if (!site) return notFound();
  const [root, inner] = rel.startsWith('shared/') ? ['shared', rel.slice(7)] : [site.root, rel];
  const base = path.join(SRC, root);
  const file = path.normalize(path.join(base, inner));
  if (!file.startsWith(base + path.sep)) return notFound();
  try {
    const body = await fs.readFile(file);
    const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (file.endsWith('.html')) headers['content-security-policy'] = site.csp;
    return new Response(body, { headers });
  } catch {
    return notFound();
  }
}

const isYouTubeUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/.test(u.hostname);
  } catch {
    return false;
  }
};

const openExternal = (url) => { if (isYouTubeUrl(url)) shell.openExternal(url); };

function hardenSession(ses) {
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*', 'https://youtube.com/*'] },
    (details, callback) => {
      const headers = details.requestHeaders;
      const referer = headers.Referer ?? headers.referer;
      if (!referer || !referer.startsWith('https://')) {
        delete headers.referer;
        headers.Referer = APP_REFERER;
      }
      callback({ requestHeaders: headers });
    },
  );
  ses.protocol.handle(SCHEME, serveApp);
}

// ---------------------------------------------------------------------------------------------------------

async function start() {
  app.dock?.hide(); // a widget: lives in the menu bar, not the Dock
  const userData = app.getPath('userData');
  const settings = createSettings(path.join(userData, 'settings.json'));
  const state = jsonFile(path.join(userData, 'state.json'));
  const youtube = createYouTube({
    clientVersion: settings.get().clientVersion ?? undefined,
    onClientVersion: (clientVersion) => settings.set({ clientVersion }),
  });

  hardenSession(session.defaultSession);
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url); // e.g. the YouTube logo in the player
      return { action: 'deny' };
    });
  });

  const sidebar = createSidebar({
    settings,
    preload: fileURLToPath(new URL('../preload/preload.cjs', import.meta.url)),
    url: `${APP_ORIGIN}/index.html`,
    headless: TEST,
  });
  const page = sidebar.win.webContents;
  page.on('will-navigate', (event, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault(); });
  // The player frame stays the player frame (YouTube's own frames inside it navigate as they like).
  page.on('will-frame-navigate', (event) => {
    const parent = event.frame?.parent;
    if (!event.isMainFrame && parent && !parent.parent && !event.url.startsWith(`${PLAYER_ORIGIN}/`)) event.preventDefault();
  });
  if (TEST) page.setAudioMuted(true); // the UI test plays real videos; never out loud

  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
    settings.flush();
    flushState();
  });
  sidebar.win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      sidebar.hide();
    }
  });

  // --- what the page tells us, and what we tell it

  let nowPlaying = null;
  const command = (name, arg) => { if (!page.isDestroyed()) page.send('command', name, arg); };

  function run(action) {
    switch (action) {
      case 'toggle-sidebar': return sidebar.toggle();
      case 'show-sidebar': return sidebar.reveal();
      case 'swap-side': return settings.set({ side: settings.get().side === 'right' ? 'left' : 'right' });
      case 'alwaysOnTop':
      case 'autoHide':
      case 'menuBarTitle': return settings.set({ [action]: !settings.get()[action] });
      case 'open-youtube': return nowPlaying && openExternal(watchUrl(nowPlaying.id));
      case 'settings':
        sidebar.reveal();
        return command('open-settings');
      case 'quit': return app.quit();
      default: return command(action); // play-pause, next, previous, radio, discover
    }
  }

  const fromPage = (event) => event.sender === page && event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`);
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!fromPage(event)) return { error: 'Not allowed' };
    try {
      return { value: await fn(...args) };
    } catch (err) {
      if (!(err instanceof YouTubeError)) console.error(channel, err);
      return { error: err instanceof YouTubeError ? err.message : 'Something went wrong' };
    }
  });
  const listen = (channel, fn) => ipcMain.on(channel, (event, ...args) => { if (fromPage(event)) fn(...args); });

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    settings.set(patch);
    return settings.get();
  });
  settings.onChange((value) => { if (!page.isDestroyed()) page.send('settings', value); });

  const playlistFile = (id) => jsonFile(path.join(userData, 'cache', `playlist-${id}.json`));
  const loading = new Map();
  handle('yt:playlist', async (id, { refresh = false } = {}) => {
    if (!isPlaylistId(id)) throw new YouTubeError('That is not a YouTube playlist');
    if (!refresh) {
      const cached = playlistFile(id).read();
      if (Array.isArray(cached?.tracks) && cached.tracks.length) return { ...cached, cached: true };
    }
    if (!loading.has(id)) {
      loading.set(id, youtube.playlist(id).then((fresh) => {
        try {
          playlistFile(id).write(fresh);
        } catch (err) {
          console.error("Couldn't cache the playlist:", err.message);
        }
        return fresh;
      }).finally(() => loading.delete(id)));
    }
    return loading.get(id);
  });
  handle('yt:search', (query) => youtube.search(String(query ?? '').slice(0, 200)));
  handle('yt:mix', (id) => youtube.mix(id));
  handle('yt:video', (id) => youtube.video(id));

  let pendingState = null;
  let stateTimer = null;
  function flushState() {
    clearTimeout(stateTimer);
    stateTimer = null;
    if (!pendingState) return;
    try {
      state.write(pendingState);
    } catch (err) {
      console.error("Couldn't save the state:", err.message); // e.g. a full disk; the next save tries again
    }
    pendingState = null;
  }
  handle('state:load', () => state.read(null));
  listen('state:save', (value) => {
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 5_000_000) return;
    pendingState = value;
    if (quitting) flushState(); // the page's last word while Hymn quits: no time to wait
    else stateTimer ??= setTimeout(flushState, 2000);
  });
  app.on('will-quit', flushState);

  listen('now-playing', (info) => {
    nowPlaying = info && isVideoId(info.id)
      ? { id: info.id, title: String(info.title ?? ''), channel: String(info.channel ?? ''), playing: Boolean(info.playing) }
      : null;
    updateTray();
  });
  listen('open-external', openExternal);
  listen('window', (action, value) => {
    if (action === 'hide') sidebar.hide({ slide: settings.get().autoHide });
    else if (action === 'hold') sidebar.hold(value);
    else if (action === 'pause-shortcuts') {
      // While a new shortcut is being recorded, the old ones mustn't swallow the keys.
      shortcutsPaused = Boolean(value);
      if (shortcutsPaused) globalShortcut.unregisterAll();
      else applyShortcuts();
    }
    else if (action === 'quit') app.quit();
  });

  // --- menu bar icon, application menu, shortcuts

  let tray = null;
  function updateTray() {
    if (!tray) return;
    const s = settings.get();
    const template = trayMenu({ nowPlaying, visible: sidebar.visible, settings: s }).map((item) => ({
      ...item,
      registerAccelerator: false, // shown as a hint; the global shortcut does the work
      click: item.id ? () => run(item.id) : undefined,
    }));
    tray.setContextMenu(Menu.buildFromTemplate(template));
    const title = s.menuBarTitle && nowPlaying ? ` ${nowPlaying.title.length > 32 ? `${nowPlaying.title.slice(0, 31)}…` : nowPlaying.title}` : '';
    tray.setTitle(title);
    tray.setToolTip(nowPlaying ? `${nowPlaying.title} — ${nowPlaying.channel}` : 'Hymn');
  }

  if (!TEST) {
    const icon = nativeImage.createFromPath(path.join(SRC, 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
  }
  settings.onChange(updateTray);
  sidebar.onVisibility(updateTray);
  updateTray();

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Hymn',
      submenu: [
        { role: 'about', label: 'About Hymn' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => run('settings') },
        { label: 'Hide Sidebar', accelerator: 'Command+W', click: () => sidebar.hide() },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Hymn' },
      ],
    },
    { role: 'editMenu' },
  ]));

  let shortcutStatus = {};
  let shortcutsPaused = false;
  const applyShortcuts = () => {
    shortcutsPaused = false;
    if (!TEST) shortcutStatus = registerShortcuts(globalShortcut, settings.get().shortcuts, run);
  };
  sidebar.onVisibility((visible) => { if (!visible && shortcutsPaused) applyShortcuts(); });
  applyShortcuts();
  settings.onChange((value, changed) => {
    if (changed.includes('shortcuts')) applyShortcuts();
    if (changed.includes('openAtLogin') && app.isPackaged) app.setLoginItemSettings({ openAtLogin: value.openAtLogin });
  });
  handle('shortcuts:status', () => ({ status: shortcutStatus, packaged: app.isPackaged, version: app.getVersion() }));
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('second-instance', () => sidebar.reveal());
  app.on('activate', () => sidebar.reveal());
  app.on('window-all-closed', () => {}); // keep running in the menu bar

  page.once('did-finish-load', () => sidebar.start());

  if (TEST) {
    const { startDriver } = await import('./test-driver.js');
    startDriver({ sidebar, settings, run, tray: () => trayMenu({ nowPlaying, visible: sidebar.visible, settings: settings.get() }), userData });
  }
}

