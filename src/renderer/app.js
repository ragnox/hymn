// The sidebar page: the player and its controls, and four sources of music — your playlist, a radio
// (YouTube's endless mix for a song, or "discover": songs like your playlist that aren't in it),
// search (or a pasted link) and the queue. Talks to the main process only through window.hymn.
import { createMediaSession } from './media-session.js';
import { hydrateIcons, icon, setIcon } from './icons.js';
import { BLOCKING_ERRORS, createPlayer, PLAYER_ERRORS, STATE } from './player.js';
import { createQueue, shuffled } from './queue.js';
import { ago, fold, formatTime, plural } from '/shared/format.js';
import { isVideoId, parseYouTubeInput, thumbnailUrl, watchUrl } from '/shared/youtube-urls.js';

const hymn = window.hymn;
const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'pin', 'swap-side', 'open-settings', 'hide', 'video-host', 'video-empty', 'video-empty-text', 'now-title', 'now-channel',
  'open-youtube', 'elapsed', 'seek', 'duration', 'shuffle', 'previous', 'play', 'next', 'repeat', 'mute', 'volume',
  'queue-count', 'playlist-title', 'playlist-meta', 'playlist-refresh', 'playlist-play', 'playlist-filter', 'playlist-list',
  'playlist-empty', 'radio-current', 'radio-current-hint', 'radio-discover', 'radio-title', 'radio-meta', 'radio-list',
  'search-form', 'search-input', 'search-head', 'search-title', 'search-meta', 'search-play-all', 'search-list', 'search-empty',
  'queue-meta', 'queue-clear', 'queue-list', 'queue-context-title', 'queue-context-meta', 'queue-context-list', 'toast',
  'toast-text', 'toast-action', 'settings', 'settings-close', 'playlist-form', 'setting-playlist', 'setting-playlist-hint',
  'setting-width', 'setting-alwaysOnTop', 'setting-autoHide', 'setting-allSpaces', 'setting-menuBarTitle',
  'setting-openAtLogin', 'login-hint', 'shortcut-list', 'blocked-hint', 'blocked-clear', 'about', 'quit',
  'playlist-setup', 'playlist-setup-input', 'playlist-setup-hint',
].map((id) => [id.replace(/-(\w)/g, (_, c) => c.toUpperCase()), $(id)]));

const TABS = ['playlist', 'radio', 'search', 'queue'];
const RADIO_KINDS = new Set(['radio', 'discover']);
const short = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// ---------------------------------------------------------------------------------------------------------
// State

let settings = await hymn.settings.get();
const blockedCodes = new Map(); // video ID → YouTube's error code
const queue = createQueue({ blocked: new Set() });
queue.setShuffle(settings.shuffle);
queue.setRepeat(settings.repeat);

let playlist = null; // { id, title, owner, total, tracks, fetchedAt }
let searchView = null; // { kind: 'search' | 'list', id, title, meta, tracks }
let current = null; // the track loaded in the player
let playing = false;
let position = 0;
let duration = 0;
let seeking = false;
let loadSerial = 0;
let loadAutoplay = false; // whether the song in the player was meant to play (not just made ready)
let startedSerial = 0; // the last load that actually started playing
let errorsInARow = 0;
let growing = null; // { key, promise }: the radio's next batch while it's being fetched

const player = createPlayer(els.videoHost, { onState, onError, onTime });
// YouTube's player keeps growing (~8 MB a song), so it's swapped for a fresh one every so many songs.
const FRESH_PLAYER_EVERY = 20;
let loadsSinceFresh = 0;
let playerFailed = false;
let playerReady = null;
/** A new player (also after one failed to start); resolves when it's ready. */
function freshPlayer() {
  playerFailed = false;
  loadsSinceFresh = 0;
  playerReady = player.create({ volume: settings.volume, muted: settings.muted });
  playerReady.catch(() => { playerFailed = true; });
  return playerReady;
}
freshPlayer();
const mediaSession = createMediaSession({ onAction: mediaAction });

// For the UI test and for poking around in the developer tools.
window.hymnDebug = { player, queue, get current() { return current; }, get playing() { return playing; } };

// ---------------------------------------------------------------------------------------------------------
// Small UI helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'icon') el.innerHTML = icon(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.filter((child) => child != null));
  return el;
}

let toastTimer = null;
function toast(text, { action = null, run = null, timeout = 6000 } = {}) {
  els.toastText.textContent = text;
  els.toastAction.hidden = !action;
  els.toastAction.textContent = action ?? '';
  els.toastAction.onclick = action ? () => { hideToast(); run(); } : null;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, timeout);
}
function hideToast() {
  els.toast.classList.remove('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 200);
}

const openOnYouTube = (track) => track && hymn.openExternal(watchUrl(track.id));

// ---------------------------------------------------------------------------------------------------------
// Song lists

const ACTIONS = {
  add: { icon: 'plus', title: 'Add to Up next' },
  remove: { icon: 'close', title: 'Remove from Up next' },
  youtube: { icon: 'external', title: 'Open on YouTube' },
};

function trackRow(track, index, action) {
  const isBlocked = blockedCodes.has(track.id);
  const kind = isBlocked ? 'youtube' : action;
  const sub = [track.channel, track.live ? 'Live' : formatTime(track.duration)].filter(Boolean).join(' · ');
  return h('li', { class: isBlocked ? 'row blocked' : 'row', dataset: { index, id: track.id } },
    h('button', { class: 'row-main', type: 'button', title: isBlocked ? `${track.title}\nCan't be played outside YouTube` : track.title },
      h('span', { class: 'thumb' },
        h('img', { src: thumbnailUrl(track.id), alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      h('span', { class: 'row-text' },
        h('span', { class: 'row-title', text: track.title }),
        h('span', { class: 'row-sub', text: sub }))),
    kind ? h('button', { class: 'icon-button row-action', type: 'button', dataset: { action: kind }, title: ACTIONS[kind].title, 'aria-label': `${ACTIONS[kind].title}: ${track.title}`, icon: ACTIONS[kind].icon }) : null);
}

/** Shows `tracks` in `list`; `indices` maps rows to context positions where they differ from 0…n. */
function renderList(list, tracks, { action = 'add', indices = null } = {}) {
  list.tracks = tracks;
  list.indices = indices;
  const fragment = document.createDocumentFragment();
  tracks.forEach((track, i) => fragment.append(trackRow(track, i, action)));
  list.replaceChildren(fragment);
  markPlaying(list);
}

function bindList(list, { play, act }) {
  list.addEventListener('click', (event) => {
    const row = event.target.closest('.row');
    const track = row && list.tracks?.[Number(row.dataset.index)];
    if (!track) return;
    const index = Number(row.dataset.index);
    const button = event.target.closest('.row-action');
    if (button?.dataset.action === 'youtube') return openOnYouTube(track);
    if (button) return act(button.dataset.action, index, track);
    if (blockedCodes.has(track.id)) {
      toast(`“${short(track.title)}” can't be played outside YouTube.`, { action: 'Open on YouTube', run: () => openOnYouTube(track) });
      return;
    }
    play(index, track);
  });
}

function markPlaying(scope = document) {
  for (const row of scope.querySelectorAll('.row.playing')) row.classList.remove('playing');
  if (!current) return;
  for (const row of scope.querySelectorAll(`.row[data-id="${CSS.escape(current.id)}"]`)) row.classList.add('playing');
}

function markBlocked(id) {
  for (const row of document.querySelectorAll(`.row[data-id="${CSS.escape(id)}"]`)) {
    row.classList.add('blocked');
    const button = row.querySelector('.row-action');
    if (button) {
      button.dataset.action = 'youtube';
      button.title = ACTIONS.youtube.title;
      button.innerHTML = icon('external');
    }
  }
}

function enqueue(track) {
  queue.enqueue(track);
  renderQueue();
  saveStateSoon();
  toast(`Up next: “${short(track.title, 48)}”`, { timeout: 2500 });
}

// ---------------------------------------------------------------------------------------------------------
// Playing

/** Loads `track` into the player (playing it unless `autoplay` is false). */
function playTrack(track, { start = 0, autoplay = true } = {}) {
  if (!track) return;
  const serial = ++loadSerial;
  current = track;
  position = start;
  duration = track.duration ?? 0;
  playing = autoplay;
  renderNow();
  renderTime(start, duration);
  markPlaying();
  renderQueue();
  renderRadio();
  saveStateSoon();
  loadAutoplay = autoplay;
  if (playerFailed || (++loadsSinceFresh > FRESH_PLAYER_EVERY && player.ready)) freshPlayer();
  loadsSinceFresh = Math.max(loadsSinceFresh, 1);
  playerReady.then(() => {
    if (serial !== loadSerial) return;
    player.load(track.id, { start, autoplay });
    if (autoplay) watchStart(serial, track);
  }, (err) => {
    if (serial !== loadSerial) return;
    playing = false;
    renderNow();
    toast(`${err.message}. Check the connection.`, { action: 'Try again', run: () => playTrack(track, { start, autoplay: true }), timeout: 30_000 });
  });
  growRadio();
  scrollToCurrent();
}

/** A video that never started 30 seconds after loading is skipped (YouTube sometimes just stalls). */
function watchStart(serial, track) {
  setTimeout(() => {
    if (serial !== loadSerial || startedSerial === serial) return; // another song, or it did start
    if ([STATE.PAUSED, STATE.ENDED, STATE.CUED].includes(player.state)) return; // paused on purpose
    skipBroken(track, "it didn't start");
  }, 30_000);
}

/**
 * Moves on from a song that won't play — unless too many did in a row (no connection?), then stops.
 * `blocking`: it will never play here, so offer it on YouTube.
 */
function skipBroken(track, reason, { blocking = false } = {}) {
  errorsInARow++;
  if (errorsInARow >= 5) {
    const count = errorsInARow;
    errorsInARow = 0; // the next try (yours) starts counting afresh
    player.stop();
    playing = false;
    renderNow();
    toast(`Stopped: ${count} videos in a row wouldn't play (${reason}).`, { timeout: 10_000 });
    return;
  }
  toast(`Skipped “${short(track.title, 48)}”: ${reason}.`, blocking ? { action: 'Open on YouTube', run: () => openOnYouTube(track) } : {});
  next();
}

function next({ auto = false } = {}) {
  const track = queue.next({ auto });
  if (track && track === current && auto) {
    player.seek(0); // repeat one
    player.play();
    return;
  }
  if (track) return playTrack(track);
  if (RADIO_KINDS.has(queue.context.kind)) {
    const key = queue.context.key;
    const was = current;
    growRadio({ force: true }).then((added) => {
      if (queue.context.key !== key || current !== was) return; // something else was picked meanwhile
      if (added) next({ auto });
      else stopAtEnd();
    });
    return;
  }
  stopAtEnd();
}

function stopAtEnd() {
  playing = false;
  renderNow();
  if (current) toast(`That was the end of ${queue.context.title ? `“${short(queue.context.title, 40)}”` : 'the list'}.`, { timeout: 3500 });
}

function previous() {
  if (current && position > 3) {
    seekTo(0);
    return;
  }
  const track = queue.previous();
  if (track) playTrack(track);
  else if (current) player.seek(0);
}

function togglePlay() {
  if (!current) return playPlaylist();
  if (!playing && blockedCodes.has(current.id)) return next(); // it can't play; go on to the next
  if (playing) {
    player.pause();
  } else {
    if (player.state === STATE.UNSTARTED && !player.videoData?.video_id) {
      playTrack(current, { start: position }); // the player lost the video (e.g. after a reload)
      return;
    }
    loadAutoplay = true; // from now on it's meant to play
    player.play();
  }
}

/** Jumps to `seconds`; the position here follows at once (the player frame reports it a moment later). */
function seekTo(seconds) {
  if (!current) return;
  position = Math.min(Math.max(0, seconds), Math.max(0, duration - 1));
  player.seek(position);
  renderTime(position, duration);
}
const seekBy = (offset) => seekTo(position + offset);

function onState(state) {
  if (state === STATE.ENDED) {
    playing = false;
    renderNow();
    next({ auto: true });
    return;
  }
  if (state === STATE.PLAYING) {
    playing = true;
    startedSerial = loadSerial;
    loadAutoplay = true;
    errorsInARow = 0;
    fillInfoFromPlayer();
  } else if (state === STATE.PAUSED || state === STATE.CUED) {
    playing = false;
    saveState();
  }
  renderNow();
}

/** Titles from a pasted link can be bare; the player knows better once the video plays. */
function fillInfoFromPlayer() {
  const data = player.videoData;
  if (!current || data.video_id !== current.id) return;
  let changed = false;
  if (data.title && (!current.title || current.title === 'YouTube video')) { current.title = data.title; changed = true; }
  if (data.author && !current.channel) { current.channel = data.author; changed = true; }
  if (!current.duration && player.duration) current.duration = Math.round(player.duration);
  if (changed) renderNow();
}

function onError(code) {
  const track = current;
  if (!track) return;
  const reason = PLAYER_ERRORS[code] ?? `YouTube's player reported error ${code}`;
  if (BLOCKING_ERRORS.has(code)) {
    blockedCodes.set(track.id, code);
    queue.block(track.id);
    markBlocked(track.id);
    renderBlocked();
    saveStateSoon();
  }
  if (!loadAutoplay) {
    // Only made ready (e.g. restored at launch): say so, but don't start playing something else.
    playing = false;
    renderNow();
    toast(`“${short(track.title, 48)}” can't play: ${reason}.`, BLOCKING_ERRORS.has(code) ? { action: 'Open on YouTube', run: () => openOnYouTube(track) } : {});
    return;
  }
  skipBroken(track, reason, { blocking: BLOCKING_ERRORS.has(code) });
}

let lastSessionSecond = -1;
function onTime(time, total) {
  position = time;
  if (total) duration = total;
  renderTime(time, duration);
  const second = Math.floor(time);
  if (second % 5 === 0 && second !== lastSessionSecond) {
    lastSessionSecond = second;
    mediaSession.update({ track: current, album: queue.context.title, playing, time, duration });
  }
}

function mediaAction(action, details) {
  if (action === 'play') return current ? player.play() : playPlaylist();
  if (action === 'pause') return player.pause();
  if (action === 'next') return next();
  if (action === 'previous') return previous();
  if (action === 'seek' && Number.isFinite(details?.seekTime)) return seekTo(details.seekTime);
  if (action === 'seek-by') return seekBy(details.offset);
}

// ---------------------------------------------------------------------------------------------------------
// Sources: playlist, radio, search, queue

function playPlaylist(index = null) {
  if (!playlist?.tracks.length) {
    toast(settings.playlistId ? 'Your playlist is still loading.' : 'Choose a playlist first, or find something in Search.');
    if (!settings.playlistId) setTab('playlist');
    return;
  }
  if (index != null && queue.context.kind === 'playlist' && queue.context.id === playlist.id) {
    return playTrack(queue.playIndex(index));
  }
  const track = queue.setContext({ kind: 'playlist', id: playlist.id, title: playlist.title, tracks: playlist.tracks, startIndex: index });
  if (!track) toast("Nothing in this playlist can be played here.");
  playTrack(track);
}

/** Plays a list (search results, a pasted playlist) from `index`. */
function playView(view, index = null, start = 0) {
  if (index != null && queue.context.kind === view.kind && queue.context.id === view.id) {
    return playTrack(queue.playIndex(index), { start });
  }
  const track = queue.setContext({ kind: view.kind, id: view.id, title: view.title, tracks: view.tracks, startIndex: index });
  playTrack(track, { start });
}

/** Plays one song and keeps going with its mix (a search result, a pasted video). */
function playAsRadio(track, start = 0) {
  const first = queue.setContext({ kind: 'radio', id: track.id, title: `Mix · ${track.title}`, tracks: [track], startIndex: 0, endless: true });
  playTrack(first, { start });
  growRadio({ force: true });
}

async function loadPlaylist({ refresh = false, quiet = false } = {}) {
  const id = settings.playlistId;
  showSetup(!id);
  if (!id) return null;
  if (!quiet && (!playlist || refresh)) els.playlistMeta.textContent = refresh ? 'Reloading…' : 'Loading…';
  els.playlistRefresh.disabled = true;
  try {
    const list = await hymn.youtube.playlist(id, { refresh });
    if (id !== settings.playlistId) return;
    showPlaylist(list);
    if (list.cached && Date.now() - list.fetchedAt > 30 * 60_000) loadPlaylist({ refresh: true });
  } catch (err) {
    if (!playlist || playlist.id !== id) {
      els.playlistTitle.textContent = 'Your playlist';
      els.playlistMeta.textContent = "Couldn't load it";
      els.playlistEmpty.textContent = `${err.message}. Try again with ↻, or pick another playlist in Settings.`;
      els.playlistEmpty.hidden = false;
    } else {
      updatePlaylistMeta();
    }
    if (!quiet) toast(`Playlist: ${err.message}`);
  } finally {
    els.playlistRefresh.disabled = false;
  }
  return playlist;
}

/** No playlist chosen yet: the Playlist tab asks for one. */
function showSetup(on) {
  els.playlistSetup.hidden = !on;
  els.playlistFilter.hidden = on;
  els.playlistPlay.disabled = on;
  els.playlistRefresh.hidden = on;
  if (!on) return;
  playlist = null;
  els.playlistTitle.textContent = 'Your playlist';
  els.playlistMeta.textContent = 'Not chosen yet';
  els.playlistEmpty.hidden = true;
  renderList(els.playlistList, []);
}

/** Loads the playlist a pasted link points at and makes it yours; reports into `hint`. */
async function choosePlaylist(text, hint) {
  const link = parseYouTubeInput(text);
  if (!link?.playlistId || (link.playlistId.startsWith('RD') && isVideoId(link.playlistId.slice(2)))) {
    hint.textContent = "That isn't a link to a YouTube playlist.";
    return false;
  }
  hint.textContent = 'Loading…';
  try {
    const list = await hymn.youtube.playlist(link.playlistId, { refresh: true });
    await set({ playlistId: list.id });
    showSetup(false);
    showPlaylist(list);
    hint.textContent = `Loaded “${list.title}”, ${plural(list.tracks.length, 'song')}.`;
    return true;
  } catch (err) {
    hint.textContent = err.message;
    return false;
  }
}

function showPlaylist(list) {
  const scroll = els.playlistList.scrollTop;
  playlist = list;
  if (queue.context.kind === 'playlist' && queue.context.id === list.id) queue.replaceTracks(list.tracks);
  els.playlistTitle.textContent = list.title;
  els.playlistFilter.placeholder = `Filter ${plural(list.tracks.length, 'song')}`;
  updatePlaylistMeta();
  renderList(els.playlistList, list.tracks);
  applyFilter();
  els.playlistList.scrollTop = scroll;
}

function updatePlaylistMeta() {
  if (!playlist) return;
  els.playlistMeta.textContent = [plural(playlist.tracks.length, 'song'), playlist.owner && `by ${playlist.owner}`].filter(Boolean).join(' · ');
  els.playlistRefresh.title = `Reload from YouTube (updated ${ago(playlist.fetchedAt)})`;
}

function applyFilter() {
  const words = fold(els.playlistFilter.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const row of els.playlistList.children) {
    const track = els.playlistList.tracks[row.dataset.index];
    const text = fold(`${track.title} ${track.channel}`);
    row.hidden = !words.every((word) => text.includes(word));
    if (!row.hidden) shown++;
  }
  els.playlistEmpty.hidden = !playlist || shown > 0;
  if (playlist && !shown) els.playlistEmpty.textContent = `Nothing matches “${els.playlistFilter.value.trim()}”.`;
}

function scrollToCurrent() {
  if (!current) return;
  const list = document.querySelector('.panel:not([hidden]) .list');
  const row = list?.querySelector(`.row[data-id="${CSS.escape(current.id)}"]:not([hidden])`);
  if (row && !list.matches(':hover')) row.scrollIntoView({ block: 'nearest' });
}

async function startRadio(seed = current) {
  if (!seed) {
    toast('Play a song first, then start its radio.');
    return;
  }
  setTab('radio');
  showRadioLoading(`Mix for “${short(seed.title, 48)}”`);
  let mix;
  try {
    mix = await hymn.youtube.mix(seed.id);
  } catch (err) {
    renderRadio();
    toast(`Radio: ${err.message}`);
    return;
  }
  const tracks = mix.tracks.filter((t) => t.id !== seed.id);
  const title = /^Mix - /.test(mix.title) ? mix.title.replace(/^Mix - /, 'Mix · ') : `Radio · ${seed.title}`;
  const keepPlaying = current?.id === seed.id;
  const first = queue.setContext({ kind: 'radio', id: seed.id, title, tracks: [current?.id === seed.id ? current : seed, ...tracks], startIndex: 0, endless: true });
  if (keepPlaying) {
    renderRadio();
    renderQueue();
    markPlaying();
  } else {
    playTrack(first);
  }
}

/** Plays songs YouTube mixes with random songs of your playlist, leaving out the ones you have. */
async function discover() {
  if (!playlist?.tracks.length) {
    toast(settings.playlistId ? 'Your playlist has to load first.' : 'Discover finds songs like your playlist: choose one first.');
    if (!settings.playlistId) setTab('playlist');
    return;
  }
  setTab('radio');
  showRadioLoading('Looking for songs like yours…');
  const own = new Set(playlist.tracks.map((t) => t.id));
  const seeds = shuffled(playlist.tracks.filter((t) => !blockedCodes.has(t.id))).slice(0, 3);
  const found = new Map();
  let seed = null;
  for (const candidate of seeds) {
    try {
      const mix = await hymn.youtube.mix(candidate.id);
      seed ??= candidate;
      for (const t of mix.tracks) if (!own.has(t.id) && !blockedCodes.has(t.id)) found.set(t.id, t);
    } catch {
      // try the next seed
    }
    if (found.size >= 15) break;
  }
  if (!found.size) {
    renderRadio();
    toast("Couldn't find anything new right now. Try again in a moment.");
    return;
  }
  const first = queue.setContext({ kind: 'discover', id: seed.id, title: `Discover · like “${short(seed.title, 40)}”`, tracks: shuffled([...found.values()]), startIndex: 0, endless: true });
  playTrack(first);
}

/**
 * Keeps a radio going: when it's nearly through, adds the mix of one of its latest songs. Resolves to the
 * number of songs added (a call while a batch is on its way gets that batch).
 */
function growRadio({ force = false } = {}) {
  const context = queue.context;
  if (!RADIO_KINDS.has(context.kind)) return Promise.resolve(0);
  if (growing?.key === context.key) return growing.promise;
  if (!force && queue.remaining() >= 3) return Promise.resolve(0);
  const batch = { key: context.key, promise: null };
  growing = batch;
  batch.promise = (async () => {
    const own = context.kind === 'discover' && playlist ? new Set(playlist.tracks.map((t) => t.id)) : null;
    const recent = context.tracks.slice(-5).filter((t) => !blockedCodes.has(t.id));
    const seed = recent[Math.floor(Math.random() * recent.length)] ?? context.tracks[0];
    const mix = await hymn.youtube.mix(seed.id);
    if (queue.context.key !== context.key) return 0;
    const added = queue.extend(mix.tracks.filter((t) => !own?.has(t.id)));
    renderRadio();
    renderQueue();
    return added;
  })().catch(() => 0).finally(() => { if (growing === batch) growing = null; });
  return batch.promise;
}

function showRadioLoading(text) {
  els.radioTitle.textContent = text;
  els.radioMeta.textContent = 'Loading…';
  els.radioList.replaceChildren();
}

function renderRadio() {
  const context = queue.context;
  els.radioCurrentHint.textContent = current ? `YouTube's mix for “${short(current.title, 40)}”` : 'Play a song first';
  if (!RADIO_KINDS.has(context.kind)) {
    els.radioTitle.textContent = 'No radio playing';
    els.radioMeta.textContent = 'It keeps going: more songs come as it plays.';
    if (els.radioList.tracks?.length) renderList(els.radioList, []);
    return;
  }
  els.radioTitle.textContent = context.title;
  els.radioMeta.textContent = `${plural(context.tracks.length, 'song')} so far · more come as it plays`;
  if (els.radioList.tracks !== context.tracks || els.radioList.children.length !== context.tracks.length) {
    renderList(els.radioList, context.tracks);
    els.radioList.tracks = context.tracks;
  }
}

async function submitSearch(text) {
  const input = text.trim();
  if (!input) return;
  const link = parseYouTubeInput(input);
  els.searchEmpty.hidden = true;
  els.searchHead.hidden = false;
  els.searchPlayAll.hidden = true;
  els.searchList.replaceChildren();
  try {
    const songMix = link?.playlistId?.startsWith('RD') && isVideoId(link.playlistId.slice(2));
    // A playlist (with or without a song to start from), or a list like an album radio (RDCLAK…).
    if ((link?.playlistId && !link.playlistId.startsWith('RD')) || (link?.playlistId && !link.videoId && !songMix)) {
      els.searchTitle.textContent = 'Playlist';
      els.searchMeta.textContent = 'Loading…';
      const list = await hymn.youtube.playlist(link.playlistId, { refresh: true });
      searchView = { kind: 'list', id: list.id, title: list.title, meta: [plural(list.tracks.length, 'song'), list.owner && `by ${list.owner}`].filter(Boolean).join(' · '), tracks: list.tracks };
      renderSearch();
      const start = link.videoId ? list.tracks.findIndex((t) => t.id === link.videoId) : -1;
      playView(searchView, start >= 0 ? start : null, link.start);
    } else if (link?.videoId || songMix) {
      const videoId = link.videoId ?? link.playlistId.slice(2);
      els.searchTitle.textContent = 'Link';
      els.searchMeta.textContent = 'Loading…';
      const info = await hymn.youtube.video(videoId);
      searchView = { kind: 'search', id: `link:${videoId}`, title: 'From a link', meta: 'Keeps going with its mix', tracks: [info] };
      renderSearch();
      playAsRadio(info, link.start);
    } else {
      els.searchTitle.textContent = `“${short(input, 40)}”`;
      els.searchMeta.textContent = 'Searching…';
      const tracks = await hymn.youtube.search(input);
      searchView = { kind: 'search', id: `search:${input}`, title: `“${short(input, 40)}”`, meta: tracks.length ? `${plural(tracks.length, 'result')} · a song you pick keeps going as a radio` : 'Nothing found', tracks };
      renderSearch();
    }
  } catch (err) {
    els.searchMeta.textContent = err.message;
  }
}

function renderSearch() {
  if (!searchView) return;
  els.searchHead.hidden = false;
  els.searchTitle.textContent = searchView.title;
  els.searchMeta.textContent = searchView.meta;
  els.searchPlayAll.hidden = searchView.tracks.length < 2;
  renderList(els.searchList, searchView.tracks);
}

function renderQueue() {
  const upNext = queue.upNext;
  renderList(els.queueList, upNext, { action: 'remove' });
  els.queueClear.hidden = !upNext.length;
  els.queueMeta.textContent = upNext.length ? `${plural(upNext.length, 'song')} before the list goes on` : 'Songs you add with + play first.';
  els.queueCount.hidden = !upNext.length;
  els.queueCount.textContent = String(upNext.length);

  const context = queue.context;
  const coming = queue.upcoming(60).filter((u) => u.from !== 'queue');
  els.queueContextTitle.textContent = context.kind === 'none' ? 'Then' : `Then: ${context.title || 'the list'}`;
  const notes = [queue.shuffle && 'shuffled', { all: 'repeats', one: 'repeating this song', off: '' }[queue.repeat]].filter(Boolean);
  els.queueContextMeta.textContent = context.kind === 'none' ? 'Nothing is lined up yet.' : notes.join(' · ');
  renderList(els.queueContextList, coming.map((u) => u.track), { indices: coming.map((u) => u.index) });
}

// ---------------------------------------------------------------------------------------------------------
// Rendering the player

let lastAnnounced = '';
function renderNow() {
  els.nowTitle.textContent = current?.title ?? 'Nothing playing';
  els.nowTitle.title = current?.title ?? '';
  els.nowChannel.textContent = current?.channel || ' ';
  els.openYoutube.disabled = !current;
  els.seek.disabled = !current;
  els.videoEmpty.hidden = Boolean(current);
  setIcon(els.play, playing ? 'pause' : 'play');
  els.play.title = playing ? 'Pause (Space)' : 'Play (Space)';
  els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  document.body.classList.toggle('is-playing', playing);
  const info = current ? { id: current.id, title: current.title, channel: current.channel, playing } : null;
  const key = JSON.stringify(info);
  if (key !== lastAnnounced) {
    lastAnnounced = key;
    hymn.nowPlaying(info);
  }
  mediaSession.update({ track: current, album: queue.context.title, playing, time: position, duration });
}

function renderTime(time, total) {
  const shown = seeking ? (Number(els.seek.value) / 1000) * total : time;
  if (!seeking) els.seek.value = total ? Math.round((time / total) * 1000) : 0;
  els.seek.style.setProperty('--fill', `${(Number(els.seek.value) / 10).toFixed(2)}%`);
  els.elapsed.textContent = formatTime(shown) || '0:00';
  els.duration.textContent = total ? formatTime(total) : current?.live ? 'Live' : '0:00';
}

function renderVolume() {
  const volume = settings.muted ? 0 : settings.volume;
  els.volume.value = settings.volume;
  els.volume.style.setProperty('--fill', `${settings.muted ? 0 : settings.volume}%`);
  setIcon(els.mute, volume === 0 ? 'muted' : volume < 50 ? 'volumeLow' : 'volume');
  els.mute.title = settings.muted ? 'Unmute (M)' : 'Mute (M)';
}

function renderModes() {
  els.shuffle.setAttribute('aria-pressed', String(queue.shuffle));
  els.repeat.dataset.mode = queue.repeat;
  els.repeat.setAttribute('aria-pressed', String(queue.repeat !== 'off'));
  setIcon(els.repeat, queue.repeat === 'one' ? 'repeatOne' : 'repeat');
  els.repeat.title = `Repeat: ${{ off: 'off', all: 'all', one: 'this song' }[queue.repeat]} (R)`;
}

function renderBlocked() {
  const count = blockedCodes.size;
  els.blockedHint.textContent = count ? `${plural(count, 'video')} can't be played outside YouTube and ${count === 1 ? 'is' : 'are'} skipped.` : 'None so far.';
  els.blockedClear.hidden = !count;
}

// ---------------------------------------------------------------------------------------------------------
// Settings

function applySettings() {
  els.pin.setAttribute('aria-pressed', String(settings.alwaysOnTop));
  els.pin.title = settings.alwaysOnTop ? 'Kept on top of other windows (click to stop)' : 'Keep on top of other windows';
  document.body.dataset.dock = settings.side;
  els.swapSide.title = `Move to the ${settings.side === 'right' ? 'left' : 'right'} side`;
  for (const button of document.querySelectorAll('.segmented [data-side]')) button.setAttribute('aria-checked', String(button.dataset.side === settings.side));
  els.settingWidth.value = settings.width;
  els.settingWidth.style.setProperty('--fill', `${((settings.width - 380) / 220) * 100}%`);
  for (const key of ['alwaysOnTop', 'autoHide', 'allSpaces', 'menuBarTitle', 'openAtLogin']) els[`setting${key[0].toUpperCase()}${key.slice(1)}`].checked = settings[key];
  if (document.activeElement !== els.settingPlaylist) els.settingPlaylist.value = settings.playlistId ? `https://www.youtube.com/playlist?list=${settings.playlistId}` : '';
  renderVolume();
  renderModes();
}

const set = (patch) => hymn.settings.set(patch).then((value) => { settings = value; applySettings(); return value; });

let shortcutInfo = { status: {}, packaged: false, version: '' };
const SHORTCUTS = { playPause: 'Play / pause', next: 'Next song', previous: 'Previous song', toggleSidebar: 'Show / hide sidebar' };
const KEY_SYMBOLS = { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘', Super: '⌘', Left: '←', Right: '→', Up: '↑', Down: '↓' };
const pretty = (accelerator) => (accelerator ? accelerator.split('+').map((part) => KEY_SYMBOLS[part] ?? part).join('') : 'Off');
const STATUS_NOTES = { taken: 'Taken by another app', invalid: 'Not a valid shortcut' };

async function renderShortcuts() {
  shortcutInfo = await hymn.shortcuts().catch(() => shortcutInfo);
  els.shortcutList.replaceChildren(...Object.entries(SHORTCUTS).map(([key, label]) => {
    const status = shortcutInfo.status[key];
    return h('div', { class: 'shortcut' },
      h('span', { class: 'shortcut-label', text: label }),
      h('button', { class: 'shortcut-keys', type: 'button', dataset: { key }, text: pretty(settings.shortcuts[key]), title: 'Click, then press the new keys' }),
      STATUS_NOTES[status] ? h('span', { class: 'shortcut-note', text: STATUS_NOTES[status] }) : null);
  }));
  els.settingOpenAtLogin.disabled = !shortcutInfo.packaged;
  els.loginHint.hidden = shortcutInfo.packaged;
  els.about.textContent = `Hymn ${shortcutInfo.version}. Plays videos in YouTube's own embedded player; videos whose owners don't allow that are skipped.`;
}

/** Electron's name for a key press with modifiers ("Control+Alt+Command+P"), or null. */
function acceleratorFrom(event) {
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Command'].filter(Boolean);
  const { code } = event;
  const named = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Space: 'Space', Enter: 'Enter', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : named[code];
  if (!key || (!mods.length && !/^F\d/.test(key))) return null;
  return [...mods, key].join('+');
}

let recording = null;
function startRecording(button) {
  stopRecording();
  recording = button;
  button.classList.add('recording');
  button.textContent = 'Press keys…';
  hymn.window('pause-shortcuts', true);
}
function stopRecording() {
  if (!recording) return;
  recording.classList.remove('recording');
  recording = null;
  hymn.window('pause-shortcuts', false);
  renderShortcuts();
}

function openSettings() {
  els.settings.hidden = false;
  requestAnimationFrame(() => els.settings.classList.add('open'));
  hymn.window('hold', true);
  renderShortcuts();
  renderBlocked();
  els.settingsClose.focus();
}
function closeSettings() {
  stopRecording();
  els.settings.classList.remove('open');
  setTimeout(() => { els.settings.hidden = true; }, 180);
  hymn.window('hold', false);
}

function setTab(name, { save = true } = {}) {
  if (!TABS.includes(name)) name = 'playlist';
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const id of TABS) $(`panel-${id}`).hidden = id !== name;
  if (name === 'queue') renderQueue();
  if (name === 'radio') renderRadio();
  if (save && settings.tab !== name) set({ tab: name });
}

// ---------------------------------------------------------------------------------------------------------
// Saving where we are

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  hymn.state.save({ version: 1, queue: queue.snapshot(), time: Math.floor(position), blocked: Object.fromEntries(blockedCodes) });
}
function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 1500);
}
setInterval(() => { if (playing) saveState(); }, 10_000);
window.addEventListener('beforeunload', saveState);
// Recording a shortcut ends when the sidebar loses the keyboard (hidden, another app in front).
window.addEventListener('blur', () => stopRecording());

function restore(saved) {
  if (!saved?.queue?.context) return;
  const kind = saved.queue.context.kind;
  const tracks = kind === 'playlist' ? (saved.queue.context.id === playlist?.id ? playlist.tracks : null) : undefined;
  if (kind === 'playlist' && !tracks) return;
  const track = queue.restore(saved.queue, tracks);
  if (track) playTrack(track, { start: Math.max(0, (saved.time ?? 0) - 2), autoplay: false });
}

// ---------------------------------------------------------------------------------------------------------
// Wiring

hydrateIcons();
document.body.classList.add('hydrated');
applySettings();
setTab(settings.tab, { save: false });

// Buttons don't keep the focus after a click, so Space keeps meaning play/pause.
document.addEventListener('mousedown', (event) => { if (event.target.closest('button')) event.preventDefault(); });

els.play.addEventListener('click', togglePlay);
els.next.addEventListener('click', () => next());
els.previous.addEventListener('click', previous);
els.shuffle.addEventListener('click', () => {
  queue.setShuffle(!queue.shuffle);
  set({ shuffle: queue.shuffle });
  renderQueue();
  saveStateSoon();
});
els.repeat.addEventListener('click', () => {
  queue.setRepeat({ off: 'all', all: 'one', one: 'off' }[queue.repeat]);
  set({ repeat: queue.repeat });
  renderQueue();
});
els.mute.addEventListener('click', () => {
  const muted = !settings.muted;
  player.setMuted(muted);
  set({ muted });
});
els.volume.addEventListener('input', () => {
  const volume = Number(els.volume.value);
  player.setVolume(volume);
  if (settings.muted && volume > 0) player.setMuted(false);
  settings = { ...settings, volume, muted: settings.muted && volume === 0 };
  renderVolume();
});
els.volume.addEventListener('change', () => set({ volume: settings.volume, muted: settings.muted }));
els.seek.addEventListener('input', () => {
  seeking = true;
  renderTime(position, duration);
});
els.seek.addEventListener('change', () => {
  seeking = false;
  if (duration) seekTo((Number(els.seek.value) / 1000) * duration);
});
// After using a slider with the mouse, Space and the arrow keys go back to meaning play/pause and seek.
for (const slider of document.querySelectorAll('.player .slider')) slider.addEventListener('pointerup', () => slider.blur());
els.openYoutube.addEventListener('click', () => {
  player.pause();
  hymn.openExternal(watchUrl(current.id) + (position > 5 ? `&t=${Math.floor(position)}s` : ''));
});

els.pin.addEventListener('click', () => set({ alwaysOnTop: !settings.alwaysOnTop }));
els.swapSide.addEventListener('click', () => set({ side: settings.side === 'right' ? 'left' : 'right' }));
els.openSettings.addEventListener('click', openSettings);
els.hide.addEventListener('click', () => hymn.window('hide'));

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => setTab(tab.dataset.tab));
document.querySelector('.tabs').addEventListener('keydown', (event) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  const at = TABS.indexOf(document.querySelector('.tab[aria-selected="true"]').dataset.tab);
  const name = TABS[(at + step + TABS.length) % TABS.length];
  setTab(name);
  $(`tab-${name}`).focus();
  event.stopPropagation();
});

bindList(els.playlistList, { play: (index) => playPlaylist(index), act: (action, index, track) => enqueue(track) });
bindList(els.radioList, { play: (index) => playTrack(queue.playIndex(index)), act: (action, index, track) => enqueue(track) });
bindList(els.searchList, {
  play: (index, track) => (searchView.kind === 'list' ? playView(searchView, index) : playAsRadio(track)),
  act: (action, index, track) => enqueue(track),
});
bindList(els.queueList, {
  play: (index, track) => {
    queue.removeQueued(index);
    playTrack(queue.playNow(track));
  },
  act: (action, index) => {
    queue.removeQueued(index);
    renderQueue();
    saveStateSoon();
  },
});
bindList(els.queueContextList, {
  play: (index, track) => {
    const at = els.queueContextList.indices[index];
    playTrack(at != null ? queue.playIndex(at) : queue.playNow(track));
  },
  act: (action, index, track) => enqueue(track),
});

els.playlistPlay.addEventListener('click', () => playPlaylist());
els.playlistRefresh.addEventListener('click', () => loadPlaylist({ refresh: true }));
els.playlistFilter.addEventListener('input', applyFilter);
els.radioCurrent.addEventListener('click', () => startRadio());
els.radioDiscover.addEventListener('click', discover);
els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitSearch(els.searchInput.value);
});
els.searchPlayAll.addEventListener('click', () => searchView && playView(searchView));
els.queueClear.addEventListener('click', () => {
  queue.clearQueue();
  renderQueue();
  saveStateSoon();
});

els.settingsClose.addEventListener('click', closeSettings);
els.playlistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await choosePlaylist(els.settingPlaylist.value, els.settingPlaylistHint)) els.settingPlaylist.blur();
});
els.playlistSetup.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await choosePlaylist(els.playlistSetupInput.value, els.playlistSetupHint)) els.playlistSetupInput.blur();
});
for (const button of document.querySelectorAll('.segmented [data-side]')) button.addEventListener('click', () => set({ side: button.dataset.side }));
els.settingWidth.addEventListener('input', () => els.settingWidth.style.setProperty('--fill', `${((Number(els.settingWidth.value) - 380) / 220) * 100}%`));
els.settingWidth.addEventListener('change', () => set({ width: Number(els.settingWidth.value) }));
for (const key of ['alwaysOnTop', 'autoHide', 'allSpaces', 'menuBarTitle', 'openAtLogin']) {
  const input = els[`setting${key[0].toUpperCase()}${key.slice(1)}`];
  input.addEventListener('change', () => set({ [key]: input.checked }));
}
els.shortcutList.addEventListener('click', (event) => {
  const button = event.target.closest('.shortcut-keys');
  if (button) startRecording(button);
});
els.blockedClear.addEventListener('click', () => {
  blockedCodes.clear();
  queue.blocked.clear();
  renderBlocked();
  if (playlist) showPlaylist(playlist);
  saveState();
});
els.quit.addEventListener('click', () => hymn.window('quit'));

document.addEventListener('keydown', (event) => {
  if (recording) {
    event.preventDefault();
    if (event.key === 'Escape') return stopRecording();
    const key = recording.dataset.key;
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      set({ shortcuts: { [key]: '' } }).then(stopRecording);
      return;
    }
    const accelerator = acceleratorFrom(event);
    if (accelerator && !/^F\d/.test(accelerator.split('+').pop()) && accelerator.split('+').slice(0, -1).every((m) => m === 'Shift')) {
      recording.textContent = 'Add ⌃, ⌥ or ⌘';
      return;
    }
    if (accelerator) set({ shortcuts: { [key]: accelerator } }).then(stopRecording);
    return;
  }
  if (event.key === 'Escape') {
    if (!els.settings.hidden) closeSettings();
    else document.activeElement?.blur();
    return;
  }
  if (event.metaKey && event.key === ',') {
    event.preventDefault();
    openSettings();
    return;
  }
  if (event.metaKey && event.key === 'f') {
    event.preventDefault();
    setTab('search');
    els.searchInput.focus();
    els.searchInput.select();
    return;
  }
  const target = event.target;
  const typing = target.matches?.('input:not([type=range]):not([type=checkbox]), textarea');
  const onControl = target.matches?.('button, input[type=range], input[type=checkbox]') && target !== document.body;
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (onControl && [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const actions = {
    ' ': togglePlay,
    ArrowRight: () => (event.shiftKey ? next() : seekBy(10)),
    ArrowLeft: () => (event.shiftKey ? previous() : seekBy(-10)),
    n: () => next(),
    p: previous,
    m: () => els.mute.click(),
    s: () => els.shuffle.click(),
    r: () => els.repeat.click(),
    '/': () => { setTab('search'); els.searchInput.focus(); },
    1: () => setTab('playlist'),
    2: () => setTab('radio'),
    3: () => setTab('search'),
    4: () => setTab('queue'),
  };
  const action = actions[event.key];
  if (action) {
    event.preventDefault();
    action();
  }
});

// Typing in a field keeps an auto-hiding sidebar open.
document.addEventListener('focusin', (event) => { if (event.target.matches('input:not([type=range]):not([type=checkbox])')) hymn.window('hold', true); });
document.addEventListener('focusout', (event) => {
  if (event.target.matches('input:not([type=range]):not([type=checkbox])') && els.settings.hidden) hymn.window('hold', false);
});

hymn.on('command', (name) => {
  const commands = { 'play-pause': togglePlay, next: () => next(), previous, radio: () => startRadio(), discover, 'open-settings': openSettings };
  commands[name]?.();
});
hymn.on('settings', (value) => {
  const before = settings;
  settings = value;
  applySettings();
  if (before.playlistId !== value.playlistId) loadPlaylist();
  if (queue.shuffle !== value.shuffle) { queue.setShuffle(value.shuffle); renderQueue(); }
  if (queue.repeat !== value.repeat) { queue.setRepeat(value.repeat); renderQueue(); }
});

setInterval(updatePlaylistMeta, 60_000);
setInterval(() => { if (playlist && Date.now() - playlist.fetchedAt > 55 * 60_000) loadPlaylist({ refresh: true, quiet: true }); }, 5 * 60_000);
renderQueue();
renderRadio();
renderBlocked();

// Start: the player, the saved state, the playlist.
playerReady.then(() => {
  els.videoEmptyText.textContent = 'Pick a song to start';
  renderNow();
}, (err) => {
  els.videoEmptyText.textContent = `${err.message}.`;
  toast(`${err.message}. Check the connection and reload.`, { action: 'Reload', run: () => location.reload(), timeout: 60_000 });
});
const saved = await hymn.state.load().catch(() => null);
for (const [id, code] of Object.entries(saved?.blocked ?? {})) {
  if (!isVideoId(id)) continue;
  blockedCodes.set(id, code);
  queue.block(id);
}
renderBlocked();
if (saved?.queue?.context?.kind && saved.queue.context.kind !== 'playlist') restore(saved);
await loadPlaylist();
if (saved?.queue?.context?.kind === 'playlist') restore(saved);
document.body.classList.add('ready');
