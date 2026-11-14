// YouTube's embedded player (the IFrame Player API), wrapped: load a video, play, pause, seek, volume, and
// events for state changes, errors and the playing position. Runs inside the player frame (frame.js),
// which keeps YouTube's scripts away from the sidebar page and its access to the app.
// https://developers.google.com/youtube/iframe_api_reference
import { STATE } from '/shared/player-codes.js';

const EMBED_HOSTS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];
const START_TIMEOUT_MS = 20_000;

let api = null;
function loadApi() {
  api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const script = document.createElement('script');
    const fail = (err) => {
      clearTimeout(timer);
      script.remove();
      api = null; // the next attempt loads it again
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("YouTube's player didn't load")), START_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve(window.YT);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => fail(new Error("Can't reach YouTube"));
    document.head.append(script);
  });
  return api;
}

/**
 * A player inside `host`. Events: onState(state), onError(code), onTime(seconds, duration).
 * `create()` must finish before anything else is called; it can be called again for a fresh player.
 */
export function createYouTubePlayer(host, { onState = () => {}, onError = () => {}, onTime = () => {} } = {}) {
  let yt = null;
  let ready = false;
  let generation = 0;
  let state = STATE.UNSTARTED;
  let timer = null;

  const tick = () => {
    if (!ready || !yt?.getCurrentTime) return;
    onTime(yt.getCurrentTime() || 0, yt.getDuration() || 0);
  };

  function watchTime(on) {
    clearInterval(timer);
    timer = on ? setInterval(tick, 250) : null;
  }

  function destroy() {
    ready = false;
    watchTime(false);
    try { yt?.destroy(); } catch { /* already gone */ }
    yt = null;
    host.replaceChildren();
  }

  return {
    get state() { return state; },
    get ready() { return ready; },
    get time() { return (ready && yt.getCurrentTime()) || 0; },
    get duration() { return (ready && yt.getDuration()) || 0; },
    /** What YouTube says about the loaded video: { video_id, title, author }. */
    get videoData() {
      const data = (ready && yt.getVideoData?.()) || {};
      return { video_id: data.video_id ?? null, title: data.title ?? '', author: data.author ?? '' };
    },

    async create({ volume = 70, muted = false } = {}) {
      const YT = await loadApi();
      // A fresh player: YouTube's grows by several MB with every video it plays (see test/ui/soak.js).
      destroy();
      state = STATE.UNSTARTED;
      // Each new player comes from the other of YouTube's two embed hosts. A different site gets a new
      // browser process, and the old one, now without frames, ends — with all the memory it had grown.
      const embedHost = EMBED_HOSTS[generation++ % EMBED_HOSTS.length];
      const mount = document.createElement('div');
      host.replaceChildren(mount);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          destroy();
          reject(new Error("YouTube's player didn't start"));
        }, START_TIMEOUT_MS);
        yt = new YT.Player(mount, {
          host: embedHost,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, iv_load_policy: 3, fs: 0, autoplay: 0 },
          events: {
            onReady: () => {
              clearTimeout(timeout);
              yt.setVolume(volume);
              if (muted) yt.mute();
              ready = true;
              resolve();
            },
            onStateChange: (event) => {
              state = event.data;
              watchTime(state === STATE.PLAYING);
              tick();
              onState(state);
            },
            onError: (event) => onError(Number(event.data)),
          },
        });
      });
      host.querySelector('iframe')?.setAttribute('title', 'YouTube video player');
    },

    /** Loads a video; plays it at once when `autoplay`, else shows it ready to play. */
    load(videoId, { start = 0, autoplay = true } = {}) {
      if (!ready) return;
      state = STATE.UNSTARTED;
      const options = { videoId, startSeconds: Math.max(0, Math.floor(start)) };
      if (autoplay) yt.loadVideoById(options);
      else yt.cueVideoById(options);
    },
    play() { if (ready) yt.playVideo(); },
    pause() { if (ready) yt.pauseVideo(); },
    stop() {
      if (ready) yt.stopVideo();
      watchTime(false);
    },
    seek(seconds) {
      if (!ready) return;
      yt.seekTo(Math.max(0, seconds), true);
      tick();
    },
    setVolume(volume) { if (ready) yt.setVolume(volume); },
    setMuted(on) {
      if (!ready) return;
      if (on) yt.mute();
      else yt.unMute();
    },
  };
}
