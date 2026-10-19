import { siteHoursListCss, siteOnDarkCss } from './base.css';
import { siteFooterCss } from './footer.css';

/**
 * The site footer for the pages that ship WITHOUT the site sheet (the coach link, the tournament
 * page): footer.css and the few base rules it stands on, the dark-ground tokens, the hours list,
 * the icon box and tabular numbers, plus the document resets base.css gives every `.tp-site`
 * page. Those pages' own sheets already reset their lists and headings and draw the lockup.
 * A few kilobytes, so the visitor still never downloads the landing page's stylesheet.
 */
export const siteFooterKitCss = `
${siteOnDarkCss}
${siteHoursListCss}
:where(.tp-site-footer) a { color: inherit; }
.tp-site-footer { line-height: var(--tp-site-lh-body); }
.tp-site-footer .tp-num { font-variant-numeric: tabular-nums; }
.tp-site-footer .tp-icon { display: block; inline-size: 1.25em; block-size: 1.25em; }
${siteFooterCss}
`;
