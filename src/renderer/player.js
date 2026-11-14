// The sidebar's handle on YouTube's player. The player itself runs in a frame of its own
// (src/player, origin app://player), so that YouTube's scripts never run next to window.hymn; this
// module talks to it by messages and keeps a copy of its state (position, length, what's loaded).
export { BLOCKING_ERRORS, PLAYER_ERRORS, STATE } from '/shared/player-codes.js';
import { STATE } from '/shared/player-codes.js';

const FRAME_ORIGIN = 'app://player';
const FRAME_URL = `${FRAME_ORIGIN}/player.html`;
const CALL_TIMEOUT_MS = 30_000;

/**
 * A player inside `host`. Events: onState(state), onError(code), onTime(seconds, duration).
 * `create()` must finish before anything else is called; calling it again gives a fresh player.
 */
export function createPlayer(host, { onState = () => {}, onError = () => {}, onTime = () => {} } = {}) {
  let frame = null;
  let frameReady = null;
  let nextId = 0;
  const pending = new Map();
  const mirror = { state: STATE.UNSTARTED, time: 0, duration: 0, data: {}, ready: false };

  const update = (message) => {
    for (const key of ['state', 'time', 'duration', 'data', 'ready']) if (key in message) mirror[key] = message[key];
  };

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== FRAME_ORIGIN) return;
    const message = event.data ?? {};
    if (message.type === 'hello') {
      frameReady?.resolve();
    } else if (message.type === 'result') {
      update(message);
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if ('error' in message) call.reject(new Error(message.error));
      else call.resolve(message.value);
    } else if (message.type === 'event') {
      update(message);
      if (message.name === 'state') onState(message.state);
      else if (message.name === 'error') onError(Number(message.code));
      else if (message.name === 'time') onTime(message.time, message.duration);
    }
  });

  /** The frame, loaded and listening. */
  function openFrame() {
    if (frameReady) return frameReady.promise;
    frameReady = {};
    frameReady.promise = new Promise((resolve, reject) => {
      frameReady.resolve = resolve;
      setTimeout(() => reject(new Error("The player didn't load")), CALL_TIMEOUT_MS);
    });
    frame = document.createElement('iframe');
    frame.src = FRAME_URL;
    frame.title = 'YouTube video player';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    host.replaceChildren(frame);
    frameReady.promise.catch(() => { frameReady = null; }); // try again next time
    return frameReady.promise;
  }

  function call(method, ...args) {
    if (!frame?.contentWindow) return Promise.reject(new Error("The player isn't there"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("YouTube's player didn't answer"));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      frame.contentWindow.postMessage({ type: 'call', id, method, args }, FRAME_ORIGIN);
    });
  }

  /** For commands whose answer nobody waits for: failures only matter as the next state/error event. */
  const fire = (method, ...args) => { call(method, ...args).catch(() => {}); };

  return {
    get state() { return mirror.state; },
    get ready() { return mirror.ready; },
    get time() { return mirror.time; },
    get duration() { return mirror.duration; },
    /** What YouTube says about the loaded video: { video_id, title, author }. */
    get videoData() { return mirror.data ?? {}; },

    async create(options = {}) {
      mirror.ready = false;
      await openFrame();
      await call('create', options);
    },
    load(videoId, { start = 0, autoplay = true } = {}) {
      mirror.state = STATE.UNSTARTED;
      mirror.time = start;
      mirror.data = {};
      fire('load', videoId, { start, autoplay });
    },
    play: () => fire('play'),
    pause: () => fire('pause'),
    stop: () => fire('stop'),
    seek(seconds) {
      mirror.time = Math.max(0, seconds);
      fire('seek', seconds);
    },
    setVolume: (volume) => fire('setVolume', volume),
    setMuted: (on) => fire('setMuted', on),
  };
}
