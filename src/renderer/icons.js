// Inline SVG icons (24×24, drawn with currentColor). Elements with data-icon="name" get theirs on start.

const stroke = (body) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fill = (body) => `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;

const ICONS = {
  logo: fill('<rect x="2.5" y="9.5" width="3" height="5" rx="1.5"/><rect x="7" y="5.5" width="3" height="13" rx="1.5"/><rect x="11.5" y="2.5" width="3" height="19" rx="1.5"/><rect x="16" y="6.5" width="3" height="11" rx="1.5"/><rect x="20.5" y="10" width="1.5" height="4" rx=".75"/>'),
  play: fill('<path d="M7.5 5.2v13.6a1 1 0 0 0 1.52.85l11-6.8a1 1 0 0 0 0-1.7l-11-6.8A1 1 0 0 0 7.5 5.2z"/>'),
  pause: fill('<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>'),
  next: fill('<path d="M4.5 6.1v11.8a1 1 0 0 0 1.56.83l8.6-5.9a1 1 0 0 0 0-1.66l-8.6-5.9a1 1 0 0 0-1.56.83z"/><rect x="16.5" y="5" width="3" height="14" rx="1.2"/>'),
  previous: fill('<path d="M19.5 6.1v11.8a1 1 0 0 1-1.56.83l-8.6-5.9a1 1 0 0 1 0-1.66l8.6-5.9a1 1 0 0 1 1.56.83z"/><rect x="4.5" y="5" width="3" height="14" rx="1.2"/>'),
  shuffle: stroke('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>'),
  repeat: stroke('<path d="m17 2 4 4-4 4"/><path d="M3 11V10a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  repeatOne: stroke('<path d="m17 2 4 4-4 4"/><path d="M3 11V10a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10.5 12.5 9.5V15" stroke-width="1.8"/>'),
  volume: stroke('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  volumeLow: stroke('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
  muted: stroke('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/>'),
  playlist: stroke('<path d="M3 6h12"/><path d="M3 11h12"/><path d="M3 16h7"/><circle cx="16.5" cy="17.5" r="2.5"/><path d="M19 17.5V7l2.5-.8"/>'),
  radio: stroke('<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/>'),
  search: stroke('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  queue: stroke('<path d="M3 6h18"/><path d="M3 12h11"/><path d="M3 18h8"/><path d="M17 14.5v6l4.5-3z" fill="currentColor"/>'),
  pin: stroke('<path d="M12 17v5"/><path d="M9 3h6l-1 6.5 3.5 3.2V15h-11v-2.3L10 9.5z"/>'),
  swap: stroke('<path d="M4 8h15"/><path d="m15 4 4 4-4 4"/><path d="M20 16H5"/><path d="m9 12-4 4 4 4"/>'),
  settings: stroke('<path d="M4 7h9"/><path d="M19 7h1"/><path d="M4 17h3"/><path d="M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/>'),
  hide: stroke('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/><path d="m8.5 9.5 2.5 2.5-2.5 2.5"/>'),
  close: stroke('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  plus: stroke('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  external: stroke('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  refresh: stroke('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  sparkles: fill('<path d="M11 2.5 12.9 8 18.5 10l-5.6 2L11 17.5 9.1 12 3.5 10l5.6-2z"/><path d="M18.5 14.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>'),
  blocked: stroke('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),
};

export function icon(name) {
  return ICONS[name] ?? '';
}

/** Fills every [data-icon] element below `root` with its icon (keeping any text after it). */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) setIcon(el, el.dataset.icon);
}

/** Replaces the icon of `el` (its first <svg>, or a new one in front of its text). */
export function setIcon(el, name) {
  el.dataset.icon = name;
  const template = document.createElement('template');
  template.innerHTML = icon(name);
  const svg = template.content.firstChild;
  if (!svg) return;
  const old = el.querySelector(':scope > svg.icon');
  if (old) old.replaceWith(svg);
  else el.prepend(svg);
}
