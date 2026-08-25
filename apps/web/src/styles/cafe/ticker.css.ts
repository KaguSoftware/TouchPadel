/**
 * Bottom marquee strip (brown). Content is tripled by the component; the track
 * travels one third of its width in the reading direction — multiplied by
 * --tp-dir-sign so it reverses under [dir='rtl'] with no duplicated keyframes.
 */
export const tickerCss = `
.tp-ticker { position: fixed; inset-block-end: 0; inset-inline: 0; z-index: var(--tp-z-sticky); block-size: calc(var(--tp-ticker-h) + env(safe-area-inset-bottom));
  padding-block-end: env(safe-area-inset-bottom); background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast); overflow: hidden; display: flex; align-items: center; }
.tp-ticker__track { display: inline-flex; gap: var(--tp-space-6); white-space: nowrap; will-change: transform; animation: tp-tick var(--tp-ticker-dur) linear infinite; padding-inline-start: var(--tp-space-6); }
.tp-ticker__item { font-size: var(--tp-fs-xs); font-weight: 700; letter-spacing: var(--tp-tracking-eyebrow); text-transform: uppercase; }
.tp-ticker__item::after { content: '•'; margin-inline-start: var(--tp-space-6); opacity: 0.6; }
@keyframes tp-tick {
  from { translate: 0 0; }
  to { translate: calc(var(--tp-dir-sign) * -33.333%) 0; }
}
`;
