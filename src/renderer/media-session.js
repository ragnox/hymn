// macOS "Now Playing" and the keyboard's media keys (⏯ ⏭ ⏮), through the browser's Media Session API.
//
// The sound comes from YouTube's player, which lives in its own frame; the system would send media keys
// there, where "next" means nothing. A silent sound playing in this page makes it the one that answers
// them, so next/previous go through our queue. It plays and pauses together with the music.
import { thumbnailUrl } from '/shared/youtube-urls.js';

/** A WAV file of `seconds` of silence (8 kHz, 8-bit mono), as a blob: URL. */
function silence(seconds = 15, rate = 8000) {
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // format chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128); // 8-bit silence is the middle value
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/** `onAction(name, details)` hears play, pause, next, previous and seek (details.seekTime). */
export function createMediaSession({ onAction }) {
  const session = navigator.mediaSession;
  if (!session) return { update() {} };
  const keeper = new Audio(silence());
  keeper.loop = true;

  const actions = {
    play: () => onAction('play'),
    pause: () => onAction('pause'),
    stop: () => onAction('pause'),
    nexttrack: () => onAction('next'),
    previoustrack: () => onAction('previous'),
    seekto: (details) => onAction('seek', details),
    seekforward: () => onAction('seek-by', { offset: 10 }),
    seekbackward: () => onAction('seek-by', { offset: -10 }),
  };
  for (const [name, handler] of Object.entries(actions)) {
    try {
      session.setActionHandler(name, handler);
    } catch {
      // an action this browser doesn't know
    }
  }

  let shownId = null;
  return {
    /** Tells the system what's playing: `track` ({ id, title, channel }) or null, and the position. */
    update({ track, album = '', playing, time = 0, duration = 0 }) {
      if (!track) {
        session.metadata = null;
        session.playbackState = 'none';
        keeper.pause();
        shownId = null;
        return;
      }
      if (shownId !== track.id) {
        shownId = track.id;
        session.metadata = new MediaMetadata({
          title: track.title,
          artist: track.channel,
          album,
          artwork: [{ src: thumbnailUrl(track.id).replace('mqdefault', 'hqdefault'), sizes: '480x360', type: 'image/jpeg' }],
        });
      }
      session.playbackState = playing ? 'playing' : 'paused';
      if (playing) keeper.play().catch(() => {});
      else keeper.pause();
      if (duration > 0) {
        try {
          session.setPositionState({ duration, position: Math.min(Math.max(0, time), duration), playbackRate: 1 });
        } catch {
          // a position the browser didn't accept (e.g. during a live stream)
        }
      }
    },
  };
}
