// Where the sidebar sits on a screen. Pure functions over Electron's rectangles ({ x, y, width, height }).

export const MIN_WIDTH = 380; // a 16:9 player at least 200 px high (YouTube's minimum), plus padding
export const MAX_WIDTH = 600;
export const MARGIN = 8; // gap to the screen edges, so the sidebar floats like a panel

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The sidebar's place on a display's work area (the part without menu bar and Dock). */
export function dockedBounds(workArea, side, width, margin = MARGIN) {
  const w = Math.round(clamp(width, MIN_WIDTH, Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, workArea.width - 2 * margin))));
  const x = side === 'left' ? workArea.x + margin : workArea.x + workArea.width - w - margin;
  return { x: Math.round(x), y: workArea.y + margin, width: w, height: Math.max(200, workArea.height - 2 * margin) };
}

/** The same place pushed just past the screen edge, for sliding out of view. */
export function hiddenBounds(displayBounds, docked, side) {
  const x = side === 'left' ? displayBounds.x - docked.width - 1 : displayBounds.x + displayBounds.width + 1;
  return { ...docked, x };
}

/** Which edge a window dropped at `bounds` belongs to: the side of the screen its middle is on. */
export function sideFor(workArea, bounds) {
  return bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? 'left' : 'right';
}

/** True when `point` touches the display's `side` edge, level with the sidebar. */
export function atEdge(displayBounds, side, point, band = 2) {
  const inY = point.y >= displayBounds.y && point.y < displayBounds.y + displayBounds.height;
  if (!inY) return false;
  return side === 'left'
    ? point.x <= displayBounds.x + band - 1 && point.x >= displayBounds.x - 1
    : point.x >= displayBounds.x + displayBounds.width - band && point.x <= displayBounds.x + displayBounds.width;
}

/** True when `point` is inside `bounds`, grown by `slack` pixels on every side. */
export function contains(bounds, point, slack = 0) {
  return point.x >= bounds.x - slack && point.x < bounds.x + bounds.width + slack
    && point.y >= bounds.y - slack && point.y < bounds.y + bounds.height + slack;
}
