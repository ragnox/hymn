// Recognises YouTube links (and bare playlist IDs). Shared by the main process and the sidebar page.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// PL… user playlists, OLAK5uy_… albums, UU… channel uploads, RD… mixes, OL… music lists, FL/LL likes.
const PLAYLIST_ID = /^(PL|OLAK5uy_|UU|RD|OL|FL|LL)[A-Za-z0-9_-]{10,62}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be']);

export const isVideoId = (value) => typeof value === 'string' && VIDEO_ID.test(value);
export const isPlaylistId = (value) => typeof value === 'string' && PLAYLIST_ID.test(value);

/** Seconds for a `t=` / `start=` value such as "90", "90s", "1m30s" or "1h2m3s"; 0 if unreadable. */
export function parseStart(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !match[0]) return 0;
  return (Number(match[1] ?? 0) * 3600) + (Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0);
}

/**
 * What a pasted link or ID points at: `{ videoId?, playlistId?, start }`, or null when it isn't YouTube.
 * Plain words are never taken for a video ID, so a search for an 11-letter word stays a search.
 */
export function parseYouTubeInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (isPlaylistId(text)) return { playlistId: text, start: 0 };
  if (/^VL/.test(text) && isPlaylistId(text.slice(2))) return { playlistId: text.slice(2), start: 0 };
  if (/\s/.test(text)) return null;

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const params = url.searchParams;
  const list = params.get('list');
  const result = { start: parseStart(params.get('t') ?? params.get('start')) };
  if (isPlaylistId(list)) result.playlistId = list;

  let videoId = null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') videoId = parts[0];
  else if (parts[0] === 'watch') videoId = params.get('v');
  else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) videoId = parts[1];
  if (isVideoId(videoId)) result.videoId = videoId;

  return result.videoId || result.playlistId ? result : null;
}

export const watchUrl = (videoId, playlistId) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${playlistId ? `&list=${encodeURIComponent(playlistId)}` : ''}`;
export const playlistUrl = (playlistId) => `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
export const thumbnailUrl = (videoId) => `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
