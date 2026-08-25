import { describe, expect, it } from 'vitest';
import { cafeCss, cafeCssModules } from './index';

/**
 * Style guard (web-slice §3): every cafe CSS module must use logical
 * properties only and reference colours through tokens. Raw colour literals
 * are allowed in `tokens-bridge` only.
 */
const PHYSICAL =
  /margin-left|margin-right|padding-left|padding-right|border-(top|bottom)-(left|right)|[^-]left:|[^-]right:|text-align:\s*(left|right)/;
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
const RAW_RGB = /\brgba?\(/;

describe('cafe css guard', () => {
  for (const [name, css] of Object.entries(cafeCssModules)) {
    it(`${name}: no physical properties`, () => {
      const hit = css.match(PHYSICAL);
      expect(hit, hit ? `found "${hit[0]}" in cafe/${name}` : undefined).toBeNull();
    });
    if (name !== 'tokens-bridge') {
      it(`${name}: no raw colour literals`, () => {
        const hex = css.match(RAW_HEX);
        expect(hex, hex ? `found "${hex[0]}" in cafe/${name}` : undefined).toBeNull();
        const rgb = css.match(RAW_RGB);
        expect(rgb, rgb ? `found "${rgb[0]}" in cafe/${name}` : undefined).toBeNull();
      });
      it(`${name}: z-index only via --tp-z-*`, () => {
        const zs = css.match(/z-index:\s*[^;]+/g) ?? [];
        for (const z of zs) expect(z).toMatch(/var\(--tp-z-/);
      });
    }
  }

  it('concatenates every module once', () => {
    for (const name of Object.keys(cafeCssModules)) {
      expect(cafeCss.split(`/* ---- cafe/${name} ---- */`).length).toBe(2);
    }
  });

  it('keeps the RTL-aware marquee and the existing tp-* hooks', () => {
    expect(cafeCss).toContain('calc(var(--tp-dir-sign) * -33.333%)');
    for (const cls of [
      '.tp-cafe__topbar',
      '.tp-cafe__table',
      '.tp-basketbar',
      '.tp-sheet',
      '.tp-order__status',
      '.tp-reasons',
      '.tp-cattabs',
      '.tp-menu-item',
      '.tp-banner--warn',
    ]) {
      expect(cafeCss).toContain(cls);
    }
    expect(cafeCss).toMatch(/prefers-reduced-motion/);
  });
});
