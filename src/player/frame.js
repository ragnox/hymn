// The player frame (app://player/player.html): YouTube's player and scripts live here, on an origin of
// their own, so they can't reach the sidebar page or window.hymn. The page drives the player by messages:
//   page → frame  { type: 'call', id, method, args }
//   frame → page  { type: 'hello' } · { type: 'result', id, value | error } · { type: 'event', name, … }
import { createYouTubePlayer } from './youtube-player.js';

const PAGE_ORIGIN = 'app://hymn';
const METHODS = new Set(['create', 'load', 'play', 'pause', 'stop', 'seek', 'setVolume', 'setMuted']);

const send = (message) => window.parent.postMessage(message, PAGE_ORIGIN);
const snapshot = () => ({ state: player.state, time: player.time, duration: player.duration, data: player.videoData, ready: player.ready });

const player = createYouTubePlayer(document.getElementById('host'), {
  onState: (state) => send({ type: 'event', name: 'state', state, ...snapshot() }),
  onError: (code) => send({ type: 'event', name: 'error', code, ...snapshot() }),
  onTime: (time, duration) => send({ type: 'event', name: 'time', time, duration, data: player.videoData }),
});

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || event.origin !== PAGE_ORIGIN) return;
  const { type, id, method, args } = event.data ?? {};
  if (type !== 'call' || !METHODS.has(method)) return;
  try {
    const value = await player[method](...(Array.isArray(args) ? args : []));
    send({ type: 'result', id, value: value ?? null, ...snapshot() });
  } catch (err) {
    send({ type: 'result', id, error: err?.message ?? String(err), ...snapshot() });
  }
});

send({ type: 'hello' });
