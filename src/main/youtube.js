// Reads public YouTube data the way youtube.com's own pages do, through its "InnerTube" JSON endpoints:
// a public playlist, search results, a video's mix ("radio") and related videos. No API key, no sign-in.
//
// These endpoints are not a documented API and their answers change shape now and then. Everything that
// depends on that shape is in the parse* functions below, which test/youtube.test.js runs against saved
// answers (test/fixtures). When YouTube changes something, refresh a fixture and fix the parser there.
import { parseDuration } from '../shared/format.js';
import { isPlaylistId, isVideoId, watchUrl } from '../shared/youtube-urls.js';

const ORIGIN = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// What youtube.com's web client called itself when this was written; refreshed on its own if YouTube rejects it.
export const DEFAULT_CLIENT_VERSION = '2.20261112.00.00';
const VIDEOS_ONLY = 'EgIQAQ%3D%3D'; // search filter "Type: Video", as youtube.com sends it
const TIMEOUT_MS = 20_000;

export class YouTubeError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'YouTubeError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Parsing

/** Text of any of YouTube's text shapes: "x", { content }, { simpleText } or { runs: [{ text }] }. */
export function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.content === 'string') return value.content;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run.text ?? '').join('');
  return '';
}

/** Every value stored under `key`, anywhere below `node`, in document order. */
export function* findAll(node, key) {
  if (Array.isArray(node)) {
    for (const item of node) yield* findAll(item, key);
  } else if (node && typeof node === 'object') {
    for (const [k, value] of Object.entries(node)) {
      if (k === key) yield value;
      yield* findAll(value, key);
    }
  }
}

const findFirst = (node, key) => findAll(node, key).next().value;

function track(id, title, channel, durationText, { live = false } = {}) {
  if (!isVideoId(id)) return null;
  const result = { id, title: title.trim() || 'Untitled', channel: channel.trim(), duration: parseDuration(durationText) };
  if (live) result.live = true;
  return result;
}

/** A video from the newer card layout (`lockupViewModel`), as in playlists and related videos. */
export function trackFromLockup(lockup) {
  if (lockup.contentType && lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const meta = lockup.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const badges = [...findAll(lockup.contentImage ?? {}, 'thumbnailBadgeViewModel')].map((badge) => textOf(badge.text));
  const duration = badges.find((text) => parseDuration(text) != null);
  return track(lockup.contentId, textOf(meta?.title), textOf(rows[0]?.metadataParts?.[0]?.text), duration, {
    live: !duration && badges.some((text) => /live/i.test(text)),
  });
}

/** A search result (`videoRenderer`) or an older playlist row (`playlistVideoRenderer`). */
export function trackFromVideoRenderer(renderer) {
  const durationText = textOf(renderer.lengthText);
  const badges = [...findAll(renderer.badges ?? [], 'label')].join(' ');
  return track(renderer.videoId, textOf(renderer.title), textOf(renderer.ownerText ?? renderer.shortBylineText ?? renderer.longBylineText), durationText, {
    live: !durationText && /live/i.test(badges),
  });
}

/** A row of a mix (`playlistPanelVideoRenderer`). */
export function trackFromPanel(renderer) {
  return track(renderer.videoId, textOf(renderer.title), textOf(renderer.shortBylineText ?? renderer.longBylineText), textOf(renderer.lengthText));
}

const ROW_PARSERS = {
  lockupViewModel: trackFromLockup,
  playlistVideoRenderer: trackFromVideoRenderer,
  videoRenderer: trackFromVideoRenderer,
  playlistPanelVideoRenderer: trackFromPanel,
};

/** The videos in the list(s) below `node`, and the token for the list's next page, if there is one. */
export function parseList(node) {
  const tracks = [];
  let continuation = null;
  // A list is an array whose items are video rows, with a "load more" item at its end.
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      const rows = current.filter((item) => item && Object.keys(item).some((key) => key in ROW_PARSERS));
      if (rows.length) {
        for (const item of rows) {
          const [key] = Object.keys(item).filter((k) => k in ROW_PARSERS);
          const row = item[key] && typeof item[key] === 'object' ? ROW_PARSERS[key](item[key]) : null;
          if (row) tracks.push(row);
        }
        const more = current.find((item) => item?.continuationItemViewModel || item?.continuationItemRenderer);
        continuation ??= more ? continuationToken(more) : null;
        continue;
      }
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i]);
    } else if (current && typeof current === 'object') {
      const values = Object.values(current);
      for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
    }
  }
  return { tracks, continuation };
}

function continuationToken(node) {
  for (const command of findAll(node, 'continuationCommand')) if (typeof command?.token === 'string') return command.token;
  return null;
}

/** What YouTube said went wrong, when a page carries an error notice instead of content. */
function errorNotice(data) {
  for (const alert of findAll(data?.alerts ?? [], 'alertRenderer')) {
    if (alert.type === 'ERROR') return textOf(alert.text) || 'YouTube reported an error';
  }
  const status = data?.playabilityStatus;
  if (status && status.status !== 'OK') return status.reason ?? null;
  return null;
}

/** First page of a playlist: its title, owner, size, videos and the token for the next page. */
export function parsePlaylistPage(data) {
  const { tracks, continuation } = parseList(data?.contents ?? {});
  const header = data?.header ?? {};
  const strings = [...findAll(header, 'content'), ...findAll(header, 'simpleText')].filter((s) => typeof s === 'string');
  for (const runs of findAll(header, 'runs')) if (Array.isArray(runs)) strings.push(runs.map((r) => r.text ?? '').join(''));
  const owner = strings.map((s) => /^by\s+(.+)$/i.exec(s.trim())?.[1]).find(Boolean) ?? '';
  const count = strings.map((s) => /([\d.,]+)\s+videos?\b/i.exec(s)?.[1]).find(Boolean);
  const title = data?.metadata?.playlistMetadataRenderer?.title
    ?? textOf(findFirst(header, 'title')?.dynamicTextViewModel?.text)
    ?? '';
  return {
    title: title || data?.microformat?.microformatDataRenderer?.title || 'Playlist',
    owner,
    total: count ? Number(count.replace(/[.,]/g, '')) : null,
    tracks,
    continuation,
    error: tracks.length ? null : errorNotice(data),
  };
}

/** A later page of a playlist (an answer to a continuation token). */
export function parseContinuation(data) {
  return parseList(data?.onResponseReceivedActions ?? data?.continuationContents ?? {});
}

/** Videos of a search answer (only videos are asked for). */
export function parseSearch(data) {
  return parseList(data?.contents ?? {}).tracks;
}

/** A video's mix: its title ("Mix - …") and videos, starting with the video itself. */
export function parseMix(data) {
  const playlist = [...findAll(data?.contents ?? {}, 'playlist')].find((p) => Array.isArray(p?.contents));
  if (!playlist) return { id: null, title: '', tracks: [] };
  return { id: playlist.playlistId ?? null, title: textOf(playlist.title) || textOf(playlist.titleText), tracks: parseList(playlist.contents).tracks };
}

/** The "up next" videos YouTube suggests next to a video. */
export function parseRelated(data) {
  const secondary = findFirst(data?.contents ?? {}, 'secondaryResults') ?? {};
  return parseList(secondary).tracks;
}

// ---------------------------------------------------------------------------------------------------------
// Fetching

/**
 * A YouTube reader. `fetch` can be swapped for tests; `onClientVersion` hears about a refreshed client
 * version so the caller can remember it.
 */
export function createYouTube({ fetch: fetchImpl = globalThis.fetch, clientVersion = DEFAULT_CLIENT_VERSION, onClientVersion } = {}) {
  let version = clientVersion;

  async function http(url, init = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-US,en;q=0.8', ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code ?? err.message;
      throw new YouTubeError(`Can't reach YouTube (${reason})`);
    }
    return response;
  }

  /** The client version youtube.com's pages use today, or null if it can't be found. */
  async function currentClientVersion() {
    const response = await http(`${ORIGIN}/results?search_query=music`, { headers: { accept: 'text/html' } });
    if (!response.ok) return null;
    const html = await response.text();
    return /"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/.exec(html)?.[1] ?? null;
  }

  async function call(endpoint, body, retried = false) {
    const response = await http(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, referer: `${ORIGIN}/` },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version, hl: 'en' } }, ...body }),
    });
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        // e.g. a consent or error page in HTML instead of JSON
        throw new YouTubeError(`YouTube answered with something unexpected (${endpoint})`);
      }
    }
    // An outdated client version is answered with 400; learn today's and try once more.
    if (!retried && (response.status === 400 || response.status === 403)) {
      const fresh = await currentClientVersion().catch(() => null);
      if (fresh && fresh !== version) {
        version = fresh;
        onClientVersion?.(fresh);
        return call(endpoint, body, true);
      }
    }
    throw new YouTubeError(`YouTube answered ${response.status} (${endpoint})`, { status: response.status });
  }

  return {
    get clientVersion() { return version; },

    /** All videos of a public or unlisted playlist (YouTube hides unavailable ones). */
    async playlist(playlistId, { maxPages = 60 } = {}) {
      if (!isPlaylistId(playlistId)) throw new YouTubeError('That is not a YouTube playlist ID');
      const first = parsePlaylistPage(await call('browse', { browseId: `VL${playlistId}` }));
      if (first.error) throw new YouTubeError(first.error);
      const tracks = [...first.tracks];
      let token = first.continuation;
      let partial = false;
      for (let page = 1; token && page < maxPages; page++) {
        try {
          const next = parseContinuation(await call('browse', { continuation: token }));
          tracks.push(...next.tracks);
          token = next.continuation;
        } catch {
          partial = true; // keep what came so far rather than nothing
          break;
        }
      }
      const result = { id: playlistId, title: first.title, owner: first.owner, total: first.total, tracks, fetchedAt: Date.now() };
      if (partial) result.partial = true;
      return result;
    },

    /** Videos for a search (no channels, playlists or Shorts shelves). */
    async search(query) {
      const q = String(query ?? '').trim();
      if (!q) return [];
      return parseSearch(await call('search', { query: q, params: VIDEOS_ONLY }));
    },

    /** The video's mix, YouTube's endless "radio" for it; falls back to related videos. */
    async mix(videoId) {
      if (!isVideoId(videoId)) throw new YouTubeError('That is not a YouTube video ID');
      const mix = parseMix(await call('next', { videoId, playlistId: `RD${videoId}` }));
      if (mix.tracks.length > 1) return mix;
      return { id: null, title: 'Related videos', tracks: await this.related(videoId) };
    },

    /** Videos YouTube suggests next to this one. */
    async related(videoId) {
      if (!isVideoId(videoId)) throw new YouTubeError('That is not a YouTube video ID');
      return parseRelated(await call('next', { videoId }));
    },

    /** Title and channel of one video, through YouTube's public oEmbed endpoint. */
    async video(videoId) {
      if (!isVideoId(videoId)) throw new YouTubeError('That is not a YouTube video ID');
      const response = await http(`${ORIGIN}/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`);
      if (response.status === 404 || response.status === 400) throw new YouTubeError('That video does not exist or is private');
      if (!response.ok) return { id: videoId, title: 'YouTube video', channel: '', duration: null };
      const info = await response.json();
      return { id: videoId, title: info.title ?? 'YouTube video', channel: info.author_name ?? '', duration: null };
    },
  };
}
