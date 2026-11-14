// Small formatting helpers shared by the main process and the sidebar page.

/** "4:01" or "1:02:03" for a number of seconds; "" when unknown. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Seconds for "4:01" / "1:02:03"; null for anything else (e.g. "LIVE"). */
export function parseDuration(text) {
  if (typeof text !== 'string' || !/^\d+(:\d{1,2}){1,2}$/.test(text.trim())) return null;
  return text.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** "152 tracks", "1 track". */
export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" for a past timestamp in ms. */
export function ago(timestamp, now = Date.now()) {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return plural(Math.round(hours / 24), 'day') + ' ago';
}

/** Text for matching: lower case, without accents ("Noël" → "noel"). */
export const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
