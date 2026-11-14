// Only for the UI test (HYMN_TEST_DRIVER=1): lets test/ui/app.js drive the real app over stdin/stdout.
// The window stays hidden, the sound is muted, and there is no menu-bar icon or global shortcut.
import fs from 'node:fs';
import readline from 'node:readline';
import { app, nativeTheme, screen } from 'electron';

export function startDriver({ sidebar, settings, run, tray, userData }) {
  const page = sidebar.win.webContents;
  const send = (message) => process.stdout.write(`@hymn ${JSON.stringify(message)}\n`);
  // Only Hymn's own page: YouTube's player frame logs plenty of its own (ad trackers, report-only CSP…).
  page.on('console-message', (event) => {
    if (event.frame && !/^app:\/\/(hymn|player)\//.test(event.frame.url)) return;
    send({ console: { level: event.level, message: event.message } });
  });
  page.on('render-process-gone', (event, details) => send({ console: { level: 'error', message: `page crashed: ${details.reason}` } }));

  const commands = {
    eval: (code) => page.executeJavaScript(code, true),
    input: (events) => { for (const event of events) page.sendInputEvent(event); },
    insertText: (text) => page.insertText(text),
    screenshot: async (file) => fs.writeFileSync(file, (await page.capturePage()).toPNG()),
    inspect: () => ({
      bounds: sidebar.win.getBounds(),
      visible: sidebar.visible,
      alwaysOnTop: sidebar.win.isAlwaysOnTop(),
      settings: settings.get(),
      tray: tray(),
      workArea: screen.getPrimaryDisplay().workArea,
      displayBounds: screen.getPrimaryDisplay().bounds,
      userData,
    }),
    run: (action) => { run(action); },
    theme: (source) => { nativeTheme.themeSource = source; },
    // Memory of each process, in MB (for the soak test).
    memory: () => app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, mb: Math.round(m.memory.workingSetSize / 1024) })),
    // Drops the window at these bounds, as if dragged there by its top bar.
    drop: (bounds) => { sidebar.win.setBounds(bounds); sidebar.snapFrom(bounds); },
    // One auto-hide check with the mouse at `point` (instead of the real mouse).
    autoHideTick: (point) => sidebar.tickAutoHide(point),
  };

  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    const { id, command, arg } = JSON.parse(line);
    try {
      send({ id, value: await commands[command](arg) });
    } catch (err) {
      send({ id, error: err.message });
    }
  }).on('close', () => {
    process.exit(0);
  });
  if (page.isLoading()) page.once('did-finish-load', () => send({ ready: true }));
  else send({ ready: true });
}
