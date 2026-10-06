import { describe, expect, it } from 'vitest';
import { courtCss } from '@/features/court3d/court.css';
import { PHOTO_GRADE_ID } from '@/lib/site/photoGrade';
import { siteCssModules } from './index';
import { siteLostCss, siteLostFrameCss } from './lost.css';
import { sitePayReturnCss } from './payReturn.css';
import { siteMatchInviteCss } from './matchInvite.css';
import { siteCoachLinkCss } from './coachLink.css';
import { siteTournamentPageCss } from './tournamentPage.css';

/**
 * Style guard for the site family, run over every site module AND over the court's
 * `courtCss`, which SiteStyles inlines beside it: the rules a broken Arabic layout, a
 * broken light mode or a motion-sensitive visitor would pay for.
 */
const PHYSICAL =
  /margin-left|margin-right|padding-left|padding-right|border-(top|bottom)-(left|right)|border-(left|right)\b|[^-]left:|[^-]right:|text-align:\s*(left|right)|float:\s*(left|right)/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_RGB = /\b(rgba?|hsla?|oklch)\(/;

const ALL: [string, string][] = [
  ...Object.entries(siteCssModules),
  ['court3d', courtCss],
  // The fallback 404's own frame, which ships without the site sheet (not-found.tsx).
  ['lost-frame', siteLostFrameCss],
  // The payment return page's whole sheet, which also ships without it (pay/return/page.tsx).
  ['pay-return', sitePayReturnCss],
  // The open-match invite page's whole sheet, which also ships without it (m/[token]/page.tsx).
  ['match-invite', siteMatchInviteCss],
  // The coach link page's whole sheet, which also ships without it (c/[id]/page.tsx).
  ['coach-link', siteCoachLinkCss],
  // The tournament page's whole sheet, which also ships without it (events/[id]/page.tsx).
  ['tournament-page', siteTournamentPageCss],
];

describe('site css guard', () => {
  for (const [name, css] of ALL) {
    it(`${name}: no physical properties (the lint rule sees style objects, not these strings)`, () => {
      const hit = css.match(PHYSICAL);
      expect(hit, hit ? `found "${hit[0]}" in site/${name}` : undefined).toBeNull();
    });
    if (name !== 'tokens-bridge') {
      it(`${name}: no raw colour literals (they would not follow the mode)`, () => {
        const hex = css.match(RAW_HEX);
        expect(hex, hex ? `found "${hex[0]}" in site/${name}` : undefined).toBeNull();
        const fn = css.match(RAW_RGB);
        expect(fn, fn ? `found "${fn[0]}" in site/${name}` : undefined).toBeNull();
      });
    }
    it(`${name}: a module that moves has a reduced-motion block`, () => {
      const moves = /\b(animation|transition)\s*:/.test(css);
      if (moves) expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    });
  }

  it('the coaching page and the landing strip ride the site sheet; the coach link page its own', () => {
    // docs/design/coaching/guest.md §4.14.2-§4.14.3.
    expect(siteCssModules.coaching).toContain('.tp-coach-card');
    expect(siteCssModules.coaching).toContain('.tp-lessons__coaches');
    expect(siteCoachLinkCss).toContain('.tp-clink__open');
    expect(siteCoachLinkCss).not.toMatch(/\.tp-front|\.tp-site-header/);
  });

  it('the landing’s tournament cards ride the site sheet; the tournament page its own', () => {
    // T-8, build contracts §1.11.
    expect(siteCssModules.events).toContain('.tp-tour-card');
    expect(siteTournamentPageCss).toContain('.tp-tpage__open');
    expect(siteTournamentPageCss).not.toMatch(/\.tp-front|\.tp-site-header/);
  });

  it('the poster words leave room for WCAG text spacing (1.4.12)', () => {
    // SMASH is 3.57 em; +0.12 em a letter is 4.17 em, which 23.5 cqi still fits.
    const size = siteCssModules.events.match(/\.tp-events__word \{[^}]*font-size: min\(([\d.]+)cqi/);
    expect(Number(size?.[1])).toBeLessThanOrEqual(100 / 4.17);
  });

  it('photos point at the grade filters PhotoGrade draws; the hero at its night exposure', () => {
    const photo = siteCssModules.photo;
    expect(photo).toContain(`.tp-photo__img { object-fit: cover; filter: url(#${PHOTO_GRADE_ID.print}); }`);
    expect(photo).toContain(`.tp-photo--night .tp-photo__img { filter: url(#${PHOTO_GRADE_ID.night}); }`);
  });

  it('the error boundary sheet stays small; the fallback 404 adds only its frame', () => {
    // Both ride inside every route of the segment, the café menu's included (perf P1).
    expect(siteLostCss.length).toBeLessThan(4000);
    expect(siteLostFrameCss.length).toBeLessThan(2500);
    expect(siteLostFrameCss).not.toMatch(/\.tp-front|\.tp-site-header/);
  });
});
