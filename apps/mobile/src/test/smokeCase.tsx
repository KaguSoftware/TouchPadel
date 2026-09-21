/**
 * The one thing a smoke case does, written once.
 *
 * Every suite is the same three assertions over a different list of screens
 * (see auth.smoke.test.tsx's header for what they are and why they are those
 * three), so the list is the interesting part of a suite and the runner is
 * not. Five copies of it would be five places for the EN and AR halves to
 * quietly drift apart.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';
import { renderRoute, type RenderRouteOptions } from './smoke';
import type { ComponentType } from 'react';

/**
 * OBJECT rows, and the runner's callback takes exactly ONE parameter.
 *
 * jest-each reads the callback's ARITY: a callback declaring more parameters
 * than a row supplies is treated as taking a `done`, and every case then sits
 * there until the timeout with no other explanation. Rows of varying length
 * (most cases need no options, a few need several) make that trivial to hit,
 * so there are no tuples anywhere in this suite.
 */
export interface SmokeCase {
  /** The route name, as `src/smoke/routes.ts` spells it. Also the test title. */
  route: string;
  Component: ComponentType<Record<string, never>>;
  /** The always-mounted primary action's testID. */
  primary: string;
  /**
   * The catalog key whose text must appear INSIDE the primary. Omit only when
   * the primary carries no text of its own (an icon button, a segmented
   * control's track) and give `nearbyKey` instead.
   */
  labelKey?: MessageKey;
  /**
   * Text that must be on the SCREEN when the primary has none of its own.
   * Still a catalog key, so an AR case that rendered English still fails.
   */
  nearbyKey?: MessageKey;
  /** Params for `nearbyKey` / `labelKey` when the string interpolates. */
  labelParams?: Record<string, string | number>;
  options?: RenderRouteOptions;
  /**
   * In-memory state the screen reads that is neither a query nor a param.
   * Returns its own undo, run after the case unmounts.
   */
  arrange?: () => () => void;
  /** Set when the screen cannot render in Node yet; the case is skipped and says why. */
  todo?: string;
}

const LOCALES: Locale[] = ['en', 'ar'];

export function runSmokeCases(group: string, cases: SmokeCase[]): void {
  describe.each(LOCALES)(`${group} in %s`, (locale) => {
    const t = makeT(locale);

    it.each(cases)('$route renders its primary action', (c) => {
      if (c.todo) {
        // NOT deleted and NOT silently skipped: the route stays in the table
        // (`src/smoke/routes.ts`) so the coverage check still counts it, and
        // the reason travels with the case.
        console.warn(`smoke: ${c.route} is todo — ${c.todo}`);
        return;
      }
      const undo = c.arrange?.();
      const screen = renderRoute(c.Component, { ...c.options, locale });
      try {
        expect(screen.getByTestId(c.primary)).toBeTruthy();
        expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
        // The label the guest actually reads. An AR case that mirrored
        // correctly but rendered the English catalog fails HERE, which is the
        // whole point of running both languages. Queries, not custom matchers:
        // RNTL's matchers extend the AMBIENT `expect`, and this file imports
        // its own from '@jest/globals'.
        if (c.labelKey) {
          expect(
            within(screen.getByTestId(c.primary)).getByText(t(c.labelKey, c.labelParams)),
          ).toBeTruthy();
        }
        if (c.nearbyKey) {
          expect(screen.getByText(t(c.nearbyKey, c.labelParams))).toBeTruthy();
        }
      } finally {
        screen.unmount();
        undo?.();
      }
    });
  });
}
