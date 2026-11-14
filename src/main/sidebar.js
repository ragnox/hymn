// The sidebar window: a frameless panel docked to the left or right edge of a screen. Drag it by its top
// bar and it snaps to the nearer edge (of whichever screen you drop it on); drag its inner edge to resize.
import { BrowserWindow, screen } from 'electron';
import { createAutoHide } from './autohide.js';
import { dockedBounds, hiddenBounds, MAX_WIDTH, MIN_WIDTH, sideFor } from './geometry.js';

const SLIDE_MS = 260;

/**
 * `headless`: for the UI test — the window is never put on screen; showing and hiding only change
 * `visible`, while sizes and positions are still applied (to the hidden window).
 */
export function createSidebar({ settings, preload, url, headless = false, cursor = () => screen.getCursorScreenPoint() }) {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    title: 'Hymn',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true, // a click on a button works even while another app is in front
    width: MIN_WIDTH,
    height: 800,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep the player and its timers going while hidden
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  let visible = false;
  let held = false;
  let userMoving = false;
  let userResizing = false;
  let hideTimer = null;
  const listeners = new Set();

  const notify = () => { for (const listener of listeners) listener(visible); };

  function display() {
    const { displayId } = settings.get();
    return screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  }

  function target() {
    const s = settings.get();
    const d = display();
    return { display: d, side: s.side, bounds: dockedBounds(d.workArea, s.side, s.width) };
  }

  function place(bounds, animate = false) {
    win.setMinimumSize(MIN_WIDTH, bounds.height);
    win.setMaximumSize(MAX_WIDTH, bounds.height);
    win.setBounds(bounds, animate && !headless);
  }

  /** Puts the sidebar where the settings say (after a settings or screen change). */
  function dock({ animate = false } = {}) {
    if (visible || headless) place(target().bounds, animate);
  }

  function show({ focus = false, slide = false } = {}) {
    clearTimeout(hideTimer);
    const wasVisible = visible;
    visible = true;
    const t = target();
    if (headless) {
      place(t.bounds);
    } else if (slide && !win.isVisible()) {
      place(hiddenBounds(t.display.bounds, t.bounds, t.side));
      win.showInactive();
      place(t.bounds, true);
    } else {
      place(t.bounds);
      if (focus) win.show();
      else win.showInactive();
    }
    if (focus && !headless) win.focus();
    if (!wasVisible) notify();
  }

  function hide({ slide = false } = {}) {
    if (!visible) return;
    visible = false;
    if (!headless) {
      if (slide) {
        const t = target();
        place(hiddenBounds(t.display.bounds, t.bounds, t.side), true);
        hideTimer = setTimeout(() => { if (!visible) win.hide(); }, SLIDE_MS);
      } else {
        win.hide();
      }
    }
    notify();
  }

  let cursorOverride = null; // the UI test's stand-in for the mouse
  const autoHide = createAutoHide({
    cursor: () => cursorOverride ?? cursor(),
    state: () => {
      const t = target();
      return { visible, bounds: t.bounds, display: t.display.bounds, side: t.side, held };
    },
    show: () => show({ slide: true }),
    hide: () => hide({ slide: true }),
  });
  let autoHideTimer = null;

  function setAutoHide(on) {
    clearInterval(autoHideTimer);
    autoHideTimer = null;
    if (on && !headless) { // the UI test ticks it by hand, with a mouse position of its own
      autoHideTimer = setInterval(() => { if (!win.isDestroyed()) autoHide.tick(); }, 120);
    } else if (!visible) {
      show();
    }
  }

  /** Where a window dropped at `bounds` belongs: the nearer edge of the screen it's on. */
  function snapFrom(bounds) {
    const d = screen.getDisplayMatching(bounds);
    settings.set({ side: sideFor(d.workArea, bounds), displayId: d.id });
    dock({ animate: true });
  }

  win.on('will-move', () => { userMoving = true; });
  win.on('moved', () => {
    if (!userMoving) return;
    userMoving = false;
    snapFrom(win.getBounds());
  });
  win.on('will-resize', () => { userResizing = true; });
  win.on('resized', () => {
    if (!userResizing) return;
    userResizing = false;
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, win.getBounds().width));
    settings.set({ width });
    dock();
  });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => { if (!win.isDestroyed()) dock(); });
  }

  function apply(s, changed) {
    if (changed.some((key) => ['side', 'width', 'displayId'].includes(key))) dock({ animate: true });
    if (changed.includes('alwaysOnTop')) win.setAlwaysOnTop(s.alwaysOnTop, 'floating');
    if (changed.includes('allSpaces')) win.setVisibleOnAllWorkspaces(s.allSpaces, { visibleOnFullScreen: s.allSpaces, skipTransformProcessType: true });
    if (changed.includes('autoHide')) setAutoHide(s.autoHide);
  }

  const initial = settings.get();
  apply(initial, ['alwaysOnTop', 'allSpaces']);
  settings.onChange(apply);
  win.loadURL(url);

  return {
    win,
    get visible() { return visible; },
    show,
    hide,
    toggle() {
      if (visible) hide({ slide: settings.get().autoHide });
      else this.reveal();
    },
    /** Shows it on purpose (shortcut, menu, relaunch): focused, and auto-hide waits for the mouse to come by. */
    reveal() {
      show({ focus: true, slide: settings.get().autoHide });
      autoHide.shown();
    },
    /** Starts things that need the page: the first showing and auto-hide. */
    start() {
      show();
      setAutoHide(initial.autoHide);
    },
    /** The page asks to stay open (typing in it, settings open) even when the mouse leaves. */
    hold(on) { held = Boolean(on); },
    snapFrom,
    autoHide,
    /** One auto-hide check with the mouse at `point`; returns whether the sidebar is visible after it. */
    tickAutoHide(point) {
      cursorOverride = point;
      try {
        autoHide.tick();
      } finally {
        cursorOverride = null;
      }
      return visible;
    },
    onVisibility(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
