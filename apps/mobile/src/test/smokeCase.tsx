/**
 * The one thing a smoke case does, written once.
 *
 * Every suite is the same three assertions over a different list of screens
 * (see auth.smoke.test.tsx's header for what they are and why they are those
 * three), so the list is the interesting part of a suite and the runner is
 * not. Five copies of it would be five places for the EN and AR halves to
 * quietly drift apart.
 *
 * THE ROUTE TABLE IS THE SOURCE. A case names its route and brings the
 * component; the primary id — and whether the route is still a `todo` — come
 * from `src/smoke/routes.ts`, so an id is written down exactly once and the
 * coverage test (`src/navigation/__tests__/smokeCoverage.test.ts`) can check
 * the same table against the `app/` directory AND against these suites.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';
import { SMOKE_ROUTES, type SmokeRoute } from '../smoke/routes';
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
}

/** A case joined to its table row: the primary id and the todo reason. */
interface ResolvedCase extends SmokeCase {
  primary: string;
  todo?: string;
}

const LOCALES: Locale[] = ['en', 'ar'];

function resolve(c: SmokeCase): ResolvedCase {
  const row: SmokeRoute | undefined = SMOKE_ROUTES.find((r) => r.route === c.route);
  if (!row) {
    throw new Error(
      `smoke: no route named '${c.route}' in src/smoke/routes.ts — add it there first`,
    );
  }
  return { ...c, primary: row.primary, todo: row.todo };
}

export function runSmokeCases(group: string, cases: SmokeCase[]): void {
  const resolved = cases.map(resolve);
  const live = resolved.filter((c) => !c.todo);
  const todo = resolved.filter((c) => c.todo);

  describe.each(LOCALES)(`${group} in %s`, (locale) => {
    const t = makeT(locale);

    if (live.length > 0) {
      it.each(live)('$route renders its primary action', (c) => {
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
    }

    // A SKIP, not a pass: the route stays in the table so the coverage check
    // still counts it, the reason is in the title so it shows in every run's
    // output, and the runner's own tally says "skipped" rather than "passed".
    if (todo.length > 0) {
      it.skip.each(todo)('$route is todo: $todo', () => {});
    }
  });
}
