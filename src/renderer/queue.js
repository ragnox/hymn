// What plays next: the list being played (the "context": your playlist, a mix, search results), the
// songs you queued by hand ("up next"), shuffle and repeat, and back/forward history.
// Pure logic without DOM or player, so test/queue.test.js can drive it directly.

/** A shuffled copy of `items` (Fisher–Yates). */
export function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

let contextSerial = 0;

export function createQueue({ random = Math.random, blocked = new Set() } = {}) {
  // `endless`: a radio that grows instead of starting over at its end.
  let context = { key: 0, kind: 'none', title: '', id: null, endless: false, tracks: [], order: [], pos: -1 };
  let upNext = [];
  let current = null; // { track, pos } — pos is the place in context.order, null for an up-next song
  let history = []; // earlier entries, newest last
  let forward = []; // entries we stepped back from, newest last
  let shuffle = false;
  let repeat = 'all'; // 'off' | 'all' | 'one'

  const playable = (track) => track && !blocked.has(track.id);
  const entry = (track, pos) => ({ track, pos, key: context.key });

  function buildOrder(first = null) {
    const indices = context.tracks.map((_, i) => i);
    if (!shuffle) return indices;
    const rest = shuffled(indices.filter((i) => i !== first), random);
    return first == null ? rest : [first, ...rest];
  }

  function remember() {
    if (!current) return;
    history.push(current);
    if (history.length > 200) history.shift();
  }

  function go(next, { keepForward = false } = {}) {
    remember();
    if (!keepForward) forward = [];
    current = next;
    if (next.pos != null && next.key === context.key) context.pos = next.pos;
    return next.track;
  }

  /** Where in the context we are: the current song's place, or the last context song's if an up-next song plays. */
  const anchor = () => (current?.pos != null && current.key === context.key ? current.pos : context.pos);

  /** History and forward entries point at places in the old order; after a reorder they keep only their songs. */
  function forgetPlaces() {
    history = history.map((e) => ({ ...e, pos: null }));
    forward = forward.map((e) => ({ ...e, pos: null }));
  }

  /** The next playable place in the context after `pos`, wrapping when `wrap`; null if there is none. */
  function nextPos(pos, wrap) {
    const n = context.order.length;
    for (let step = 1; step <= n; step++) {
      let p = pos + step;
      if (p >= n) {
        if (!wrap) return null;
        p -= n;
      }
      if (playable(context.tracks[context.order[p]])) return p;
    }
    return null;
  }

  return {
    get context() { return context; },
    get current() { return current?.track ?? null; },
    get upNext() { return upNext; },
    get shuffle() { return shuffle; },
    get repeat() { return repeat; },
    get blocked() { return blocked; },
    /** True when the current song came from the context (not from up next). */
    get inContext() { return current?.pos != null && current.key === context.key; },

    /** Plays a new list, from `startIndex` (an index into `tracks`), or from its start / a random song. */
    setContext({ kind, title = '', id = null, tracks, startIndex = null, endless = false }) {
      context = { key: ++contextSerial, kind, title, id, endless, tracks: [...tracks], order: [], pos: -1 };
      context.order = buildOrder(startIndex);
      forward = [];
      if (startIndex == null) return this.next();
      const pos = context.order.indexOf(startIndex);
      return go(entry(context.tracks[startIndex], pos));
    },

    /**
     * Swaps in a fresh copy of the same list (a refreshed playlist) without interrupting anything: the
     * shuffled order and the place in it stay; new songs join at the end of the round (or in their place
     * when not shuffled); removed songs drop out.
     */
    replaceTracks(tracks) {
      const fresh = [...tracks];
      const slots = new Map(); // id → its indices in `fresh` (a playlist can hold a song twice)
      fresh.forEach((t, i) => (slots.get(t.id) ?? slots.set(t.id, []).get(t.id)).push(i));
      const at = anchor();
      const inContext = this.inContext;
      const kept = []; // [old place, new index] in the old order
      context.order.forEach((oldIndex, place) => {
        const free = slots.get(context.tracks[oldIndex]?.id);
        if (free?.length) kept.push([place, free.shift()]);
      });
      const added = [...slots.values()].flat().sort((a, b) => a - b);
      // The new index of the song at (or the last one kept before) our place.
      const before = kept.filter(([place]) => place <= at);
      const anchorIndex = before.length ? before.at(-1)[1] : null;
      const anchorStillThere = before.length > 0 && before.at(-1)[0] === at;
      const order = shuffle ? [...kept.map(([, index]) => index), ...shuffled(added, random)] : fresh.map((_, i) => i);
      context = { ...context, tracks: fresh, order, pos: anchorIndex == null ? -1 : order.indexOf(anchorIndex) };
      if (current?.key === context.key && current.pos != null) {
        current = inContext && anchorStillThere
          ? { ...current, track: fresh[anchorIndex], pos: context.pos }
          : { ...current, pos: null };
      }
      forgetPlaces();
    },

    /** Adds songs to the end of the context (a mix growing), skipping ones already in it. */
    extend(tracks) {
      const known = new Set(context.tracks.map((t) => t.id));
      const added = tracks.filter((t) => !known.has(t.id) && known.add(t.id));
      const start = context.tracks.length;
      context.tracks.push(...added);
      const indices = added.map((_, i) => start + i);
      context.order.push(...(shuffle ? shuffled(indices, random) : indices));
      return added.length;
    },

    /** Plays song `index` of the context now. */
    playIndex(index) {
      if (!context.tracks[index]) return null;
      if (shuffle) {
        // Start a fresh shuffle from the chosen song, so everything else still comes once.
        context.order = buildOrder(index);
      }
      return go(entry(context.tracks[index], context.order.indexOf(index)));
    },

    /** Plays a song now without changing the context (a search result, a pasted link). */
    playNow(track) {
      return go({ track, pos: null, key: context.key });
    },

    /**
     * The song after this one, or null at the end of the list. `auto` is true when the last song ended
     * by itself: then "repeat one" plays it again.
     */
    next({ auto = false } = {}) {
      if (auto && repeat === 'one' && current) return current.track;
      while (upNext.length) {
        const track = upNext.shift();
        if (playable(track)) return go({ track, pos: null, key: context.key }, { keepForward: true });
      }
      while (forward.length) {
        const entry = forward.pop();
        if (playable(entry.track)) return go(entry, { keepForward: true });
      }
      const from = anchor();
      let pos = nextPos(from, false);
      if (pos == null && repeat !== 'off' && !context.endless && context.order.length) {
        if (shuffle && context.order.length > 1) {
          // A new round: reshuffle, but don't start it with the song that just played.
          const last = context.order[from];
          context.order = shuffled(context.order, random);
          if (context.order[0] === last) context.order.push(context.order.shift());
          pos = nextPos(-1, false);
        } else {
          pos = nextPos(from, true);
          if (pos === from && !auto) pos = null; // a single song: "next" doesn't restart it
        }
      }
      if (pos == null) return null;
      return go(entry(context.tracks[context.order[pos]], pos));
    },

    /** The song before this one (from history, skipping songs that can't play), or null if there is none. */
    previous() {
      let back = null;
      while (history.length && !back) {
        const entry = history.pop();
        if (playable(entry.track)) back = entry;
      }
      if (!back) return null;
      if (current) forward.push(current);
      current = back;
      if (back.pos != null && back.key === context.key) context.pos = back.pos;
      return back.track;
    },

    /**
     * Up to `limit` songs that will play next, in order: up next, then songs we stepped back over, then the
     * context. Context entries carry their `index` in the context's tracks.
     */
    upcoming(limit = 50) {
      const list = upNext.filter(playable).map((track) => ({ track, from: 'queue' }));
      for (let i = forward.length - 1; i >= 0; i--) {
        const entry = forward[i];
        if (!playable(entry.track)) continue;
        const index = entry.pos != null && entry.key === context.key ? context.order[entry.pos] : undefined;
        list.push({ track: entry.track, from: 'forward', index });
      }
      // After the forward songs, the list goes on from the furthest of them (if it's in the context).
      const furthest = forward.find((e) => playable(e.track));
      let pos = furthest ? (furthest.pos != null && furthest.key === context.key ? furthest.pos : context.pos) : anchor();
      const seen = new Set();
      while (list.length < limit) {
        pos = nextPos(pos, repeat === 'all' && !context.endless);
        if (pos == null || seen.has(pos)) break;
        seen.add(pos);
        list.push({ track: context.tracks[context.order[pos]], from: 'context', index: context.order[pos] });
      }
      return list.slice(0, limit);
    },

    /** How many context songs are left before the end (for growing a mix in time). */
    remaining() {
      const pos = anchor();
      let count = 0;
      for (let p = pos + 1; p < context.order.length; p++) if (playable(context.tracks[context.order[p]])) count++;
      return count;
    },

    enqueue(track) { upNext.push(track); return upNext.length; },
    removeQueued(index) { upNext.splice(index, 1); },
    clearQueue() { upNext = []; },

    setShuffle(on) {
      shuffle = Boolean(on);
      // Keep our place: the song playing, or the last list song before an up-next one.
      const inContext = this.inContext;
      const at = anchor();
      const anchorIndex = at >= 0 ? context.order[at] : null;
      context.order = buildOrder(anchorIndex);
      context.pos = anchorIndex == null ? -1 : context.order.indexOf(anchorIndex);
      if (inContext) current = { ...current, pos: context.pos };
      // The order changed: "back" keeps its songs (without their old places), "forward" is gone.
      history = history.map((e) => ({ ...e, pos: null }));
      forward = [];
    },

    setRepeat(mode) { repeat = ['off', 'all', 'one'].includes(mode) ? mode : 'all'; },

    block(id) { blocked.add(id); },

    /** Everything needed to pick up where we left off after a restart. */
    snapshot() {
      // A playlist's songs are stored by Hymn anyway; the snapshot keeps only their IDs, in their order.
      const isPlaylist = context.kind === 'playlist';
      return {
        context: {
          kind: context.kind, title: context.title, id: context.id, endless: context.endless,
          tracks: isPlaylist ? null : context.tracks,
          trackIds: isPlaylist ? context.tracks.map((t) => t.id) : undefined,
          order: context.order, pos: context.pos,
        },
        current: current ? { track: current.track, pos: current.key === context.key ? current.pos : null } : null,
        upNext,
      };
    },

    /**
     * Restores a snapshot. For a playlist, pass its songs as they are now: the saved order and place are
     * carried over to them (songs added or removed since are handled as in replaceTracks).
     */
    restore(snap, playlistTracks = null) {
      const saved = snap?.context;
      if (!saved) return null;
      const isPlaylist = saved.kind === 'playlist';
      if (isPlaylist && !Array.isArray(playlistTracks)) return null;
      const ids = Array.isArray(saved.trackIds) && saved.trackIds.every((id) => typeof id === 'string') ? saved.trackIds : null;
      let tracks = isPlaylist ? (ids ? ids.map((id) => ({ id })) : playlistTracks) : saved.tracks;
      if (!Array.isArray(tracks) || !tracks.every((t) => typeof t?.id === 'string')) return null;
      context = { key: ++contextSerial, kind: saved.kind, title: saved.title ?? '', id: saved.id ?? null, endless: Boolean(saved.endless), tracks: [...tracks], order: [], pos: -1 };
      const { order } = saved;
      const valid = Array.isArray(order) && order.length === tracks.length && new Set(order).size === tracks.length
        && order.every((i) => Number.isInteger(i) && i >= 0 && i < tracks.length);
      context.order = valid ? [...order] : buildOrder();
      if (valid && Number.isInteger(saved.pos) && saved.pos >= -1 && saved.pos < order.length) context.pos = saved.pos;
      upNext = Array.isArray(snap.upNext) ? snap.upNext.filter((t) => typeof t?.id === 'string') : [];
      history = [];
      forward = [];
      current = null;
      const track = snap.current?.track;
      if (typeof track?.id === 'string') {
        let pos = snap.current.pos;
        if (Number.isInteger(pos) && context.tracks[context.order[pos]]?.id !== track.id) {
          const index = context.tracks.findIndex((t) => t.id === track.id);
          pos = index >= 0 ? context.order.indexOf(index) : null;
        }
        if (!Number.isInteger(pos)) pos = null;
        current = { track, pos, key: context.key };
        if (pos != null) context.pos = pos;
      }
      // A playlist: from the saved IDs to its songs as they are now.
      if (isPlaylist && ids) this.replaceTracks(playlistTracks);
      return current?.track ?? null;
    },
  };
}
