// "Hide when the mouse leaves": slides the sidebar away once the mouse has been elsewhere for a moment, and
// back when the mouse rests against that screen edge. Driven by tick(), which main.js calls a few times a
// second while the option is on (Electron has no event for "mouse touched the screen edge").
import { atEdge, contains } from './geometry.js';

export const HIDE_AFTER_MS = 700;
export const SHOW_AFTER_MS = 200;

/**
 * `state()` describes the sidebar now: { visible, bounds, display, side, held } — `held` keeps it open
 * (while typing in it or with settings open).
 */
export function createAutoHide({ now = Date.now, cursor, state, show, hide, hideAfter = HIDE_AFTER_MS, showAfter = SHOW_AFTER_MS }) {
  let armed = true; // hiding waits until the mouse has been on the sidebar at least once
  let awaySince = null;
  let edgeSince = null;

  return {
    /** After the sidebar was shown on purpose (shortcut, menu): don't hide it before the mouse comes by. */
    shown() {
      armed = false;
      awaySince = null;
    },
    tick() {
      const { visible, bounds, display, side, held } = state();
      const point = cursor();
      const t = now();
      if (visible) {
        edgeSince = null;
        if (contains(bounds, point, 6) || atEdge(display, side, point)) {
          armed = true;
          awaySince = null;
          return;
        }
        if (!armed || held) {
          awaySince = null;
          return;
        }
        awaySince ??= t;
        if (t - awaySince >= hideAfter) {
          awaySince = null;
          hide();
        }
      } else {
        awaySince = null;
        const level = point.y >= bounds.y && point.y < bounds.y + bounds.height;
        if (level && atEdge(display, side, point)) {
          edgeSince ??= t;
          if (t - edgeSince >= showAfter) {
            edgeSince = null;
            armed = true;
            show();
          }
        } else {
          edgeSince = null;
        }
      }
    },
  };
}
