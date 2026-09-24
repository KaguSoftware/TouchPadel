import { describe, expect, it } from 'vitest';
import { courtCss } from '@/features/court3d/court.css';
import { cafeCss } from '@/styles/cafe';
import { PHOTO_GRADE_ID } from '@/lib/site/photoGrade';
import { siteCss, siteCssModules } from './index';
import { siteLostCss, siteLostFrameCss } from './lost.css';

/**
 * Style guard for the site family (a copy of cafe-css.test.ts's rules, plus the site's
 * own), run over every site module AND over the court's `courtCss`, which SiteStyles
 * inlines beside it.
 */
const PHYSICAL =
  /margin-left|margin-right|padding-left|padding-right|border-(top|bottom)-(left|right)|border-(left|right)\b|[^-]left:|[^-]right:|text-align:\s*(left|right)|float:\s*(left|right)/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_RGB = /\b(rgba?|hsla?|oklch)\(/;
const CAFE_SCALE = /var\(--tp-(fs|radius|space|cafe|shadow|z|dur|ease|lh|tracking|fw)-/;
/** The only properties the site may animate or transition. */
const MOTION_OK = new Set(['transform', 'opacity', 'clip-path', 'stroke-dashoffset']);

const ALL: [string, string][] = [
  ...Object.entries(siteCssModules),
  ['court3d', courtCss],
  // The fallback 404's own frame, which ships without the site sheet (not-found.tsx).
  ['lost-frame', siteLostFrameCss],
];

function transitionedProperties(css: string): string[] {
  const out: string[] = [];
  for (const [, value] of css.matchAll(/transition(?:-property)?:\s*([^;}]+)/g)) {
    for (const part of value!.split(',')) {
      const prop = part.trim().split(/\s+/)[0]!;
      if (prop && prop !== 'none') out.push(prop);
    }
  }
  return out;
}

function keyframeProperties(css: string): string[] {
  const out: string[] = [];
  for (const [, body] of css.matchAll(/@keyframes[^{]+\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    for (const [, decls] of body!.matchAll(/\{([^}]*)\}/g)) {
      for (const decl of decls!.split(';')) {
        const prop = decl.split(':')[0]?.trim();
        if (prop && prop !== 'animation-timing-function') out.push(prop);
      }
    }
  }
  return out;
}

describe('site css guard', () => {
  for (const [name, css] of ALL) {
    it(`${name}: no physical properties`, () => {
      const hit = css.match(PHYSICAL);
      expect(hit, hit ? `found "${hit[0]}" in site/${name}` : undefined).toBeNull();
    });
    if (name !== 'tokens-bridge') {
      it(`${name}: no raw colour literals`, () => {
        const hex = css.match(RAW_HEX);
        expect(hex, hex ? `found "${hex[0]}" in site/${name}` : undefined).toBeNull();
        const fn = css.match(RAW_RGB);
        expect(fn, fn ? `found "${fn[0]}" in site/${name}` : undefined).toBeNull();
      });
    }
    it(`${name}: z-index only via --tp-site-z-*`, () => {
      const zs = css.match(/z-index:\s*[^;]+/g) ?? [];
      for (const z of zs) expect(z).toMatch(/var\(--tp-site-z-/);
    });
    it(`${name}: none of the café's own scale`, () => {
      const hit = css.match(CAFE_SCALE);
      expect(hit, hit ? `found "${hit[0]}" in site/${name}` : undefined).toBeNull();
    });
    it(`${name}: only transform / opacity / clip-path / stroke-dashoffset move`, () => {
      for (const prop of [...transitionedProperties(css), ...keyframeProperties(css)]) {
        expect(MOTION_OK.has(prop), `"${prop}" animates in site/${name}`).toBe(true);
      }
    });
    it(`${name}: a module that moves has a reduced-motion block`, () => {
      const moves = /\b(animation|transition)\s*:/.test(css);
      if (moves) expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    });
  }

  it('concatenates every module once', () => {
    for (const name of Object.keys(siteCssModules)) {
      expect(siteCss.split(`/* ---- site/${name} ---- */`).length).toBe(2);
    }
  });

  it('keeps the hooks the pages render', () => {
    for (const cls of [
      '.tp-site',
      '.tp-site-header',
      '.tp-site-menu',
      '.tp-site-footer',
      '.tp-photo',
      '.tp-front',
      '.tp-club',
      '.tp-points',
      '.tp-lessons',
      '.tp-events',
      '.tp-cafe-handoff',
      '.tp-appband',
      '.tp-screen',
      '.tp-faq',
      '.tp-visit',
      '.tp-hours-list',
      '.tp-legal',
      '.tp-legal__title',
      '.tp-lost',
      '.tp-display',
      '.tp-store--soon',
    ]) {
      expect(siteCss).toContain(cls);
    }
  });

  it('shares no class with the café sheet, so the two can never catch each other’s blocks', () => {
    // The café's .tp-hero / .tp-app / .tp-steps once caught the home page's own blocks, when
    // the layout still inlined the café sheet into every page (it no longer does).
    // Only the legal form's .tp-btn hooks (DeleteAccountForm) are shared on purpose.
    const classes = (css: string) => new Set(css.match(/\.tp-[a-zA-Z0-9_-]+/g) ?? []);
    const cafe = classes(cafeCss);
    const shared = [...classes(siteCss), ...classes(courtCss)].filter((c) => cafe.has(c));
    expect(shared.filter((c) => !c.startsWith('.tp-btn'))).toEqual([]);
  });

  it('every photo gets the one grade: the SVG duotone, the hero its night exposure', () => {
    const photo = siteCssModules.photo;
    expect(photo).toMatch(
      new RegExp(`\\.tp-photo__img \\{[^}]*filter: url\\(#${PHOTO_GRADE_ID.print}\\);`),
    );
    expect(photo).toMatch(
      new RegExp(
        `\\.tp-photo--night \\.tp-photo__img \\{[^}]*filter: url\\(#${PHOTO_GRADE_ID.night}\\);`,
      ),
    );
    // The filters' SVG must stay renderable: never display: none.
    expect(photo).toMatch(/\.tp-photo-grade \{[^}]*inline-size: 0;/);
    expect(photo).not.toMatch(/\.tp-photo-grade \{[^}]*display: none/);
    // No scrim gradients, no glass anywhere in the site sheet.
    expect(siteCss).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('the poster letters are knocked out of the full-green bands, with clean edges', () => {
    // A dilation filter per type step (Events.tsx), never a mitred text stroke: its joins
    // left sawtooth spikes at every sharp corner (ART-03).
    expect(siteCssModules.events).toMatch(/\.tp-events__word \{[^}]*filter: url\(#tp-knockout-s\)/);
    expect(siteCssModules.events).toContain('filter: url(#tp-knockout-m)');
    expect(siteCssModules.events).toContain('filter: url(#tp-knockout-l)');
    expect(siteCssModules.events).not.toMatch(/-webkit-text-stroke|paint-order/);
    expect(siteCssModules.base).toContain('.tp-events .tp-events__pattern { opacity: 1; }');
    // The green word is coloured by its own class, not by its position among the spans.
    expect(siteCssModules.events).toMatch(/\.tp-events__word--hit \{[^}]*color: var\(--tp-brand-green\)/);
    expect(siteCss).not.toMatch(/tp-events__word:nth-of-type/);
  });

  it('the poster words leave room for WCAG text spacing (1.4.12)', () => {
    // SMASH is 3.57 em; +0.12 em a letter is 4.17 em, which 23.5 cqi still fits.
    const size = siteCssModules.events.match(/\.tp-events__word \{[^}]*font-size: min\(([\d.]+)cqi/);
    expect(Number(size?.[1])).toBeLessThanOrEqual(100 / 4.17);
  });

  it('the bands fill the whole poster block, one crop per layout', () => {
    for (const key of ['tall', 'mid', 'wide', 'xwide']) {
      expect(siteCssModules.events).toContain(`.tp-events__pattern--${key}`);
    }
    // No hand-sized band box inside the block any more: the base .tp-pattern (inset 0).
    expect(siteCssModules.events).not.toMatch(/\.tp-events__pattern\.tp-pattern \{/);
  });

  it('the error boundary sheet stays small; the fallback 404 adds only its frame', () => {
    expect(siteLostCss.length).toBeLessThan(4000);
    expect(siteLostFrameCss.length).toBeLessThan(2500);
    expect(siteLostFrameCss).not.toMatch(/\.tp-front|\.tp-site-header/);
  });

  it('Arabic display type is never capitalised or letter-spaced', () => {
    expect(siteCss).toMatch(
      /\[dir='rtl'\] \.tp-display \{ text-transform: none; letter-spacing: 0;/,
    );
  });

  it('the html ground follows the mode through :has (in the bridge only)', () => {
    expect(siteCssModules['tokens-bridge']).toContain(":has(.tp-site[data-mode='night'])");
    expect(siteCssModules['tokens-bridge']).toContain(":has(.tp-site[data-mode='light'])");
  });
});
