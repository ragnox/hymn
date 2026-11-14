// Codes of YouTube's IFrame Player API, shared by the player frame and the sidebar page.
// https://developers.google.com/youtube/iframe_api_reference

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

/** Why YouTube's player refused a video, by its error code. */
export const PLAYER_ERRORS = {
  2: 'YouTube says the video ID is invalid',
  5: "YouTube's player can't play it here",
  100: 'it was removed or is private',
  101: "its owner doesn't allow playing it outside YouTube",
  150: "its owner doesn't allow playing it outside YouTube",
  152: 'it can only be watched on YouTube (e.g. age-restricted)',
  153: 'YouTube refused to identify the player',
};

/** Errors that mean "this video will never play here", so it's skipped from now on. */
export const BLOCKING_ERRORS = new Set([100, 101, 150, 152]);
