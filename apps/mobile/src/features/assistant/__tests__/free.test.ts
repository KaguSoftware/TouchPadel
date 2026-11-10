import { describe, expect, it } from 'vitest';
import { FREE_HISTORY_MAX, FREE_PAGES_MAX, FREE_TEXT_MAX, MOBILE_STAFF_ROUTE } from '@touch/core/assistant/free';
import { STAFF_ROLES } from '@touch/core';
import { makeT } from '@touch/i18n';
import {
  FREE_STARTERS,
  FreeStreamError,
  answerPages,
  buildFreeBody,
  freeErrorMessage,
  freeFrom,
  freePages,
  freeTurn,
  routeSegment,
  type FreeLiveTurn,
} from '../free';

// The stream reducer, freeTurnsOf and freeRefusal are shared with the operator;
// their tests live in packages/core/src/assistant/free-client.test.ts.

const en = makeT('en');
const ar = makeT('ar');

const done = (id: number, question: string, text: string): FreeLiveTurn => ({
  ...freeTurn(id, question),
  text,
  done: true,
});

describe('freePages', () => {
  it('starts with Today and lists the role’s rows once each, in its language', () => {
    const pages = freePages({ role: 'waiter' }, (k) => en(k));
    expect(pages[0]).toEqual({ route: '/staff', label: en('staff.shell.today.title') });
    expect(pages.map((p) => p.route)).toContain('/staff-request');
    expect(pages.map((p) => p.route)).toContain('/staff-suggestions');
    expect(new Set(pages.map((p) => p.route)).size).toBe(pages.length);
    const arPages = freePages({ role: 'waiter' }, (k) => ar(k));
    expect(arPages[0]!.label).toBe(ar('staff.shell.today.title'));
  });

  it('never offers a page the role cannot open', () => {
    const waiter = freePages({ role: 'waiter' }, (k) => en(k)).map((p) => p.route);
    expect(waiter).not.toContain('/staff-production');
    const chef = freePages({ role: 'head_chef' }, (k) => en(k)).map((p) => p.route);
    expect(chef).toContain('/staff-production');
  });

  it('offers a second job’s pages too, as Today does (0345)', () => {
    const waiter = freePages({ role: 'waiter' }, (k) => en(k)).map((p) => p.route);
    expect(waiter).not.toContain('/staff-purchase');
    const both = freePages({ role: 'waiter', extraRoles: ['driver'] }, (k) => en(k)).map((p) => p.route);
    expect(both).toContain('/staff-purchase');
    // An owner's list is the owner alone.
    const owner = freePages({ role: 'owner' }, (k) => en(k)).map((p) => p.route);
    expect(freePages({ role: 'owner', extraRoles: ['driver'] }, (k) => en(k)).map((p) => p.route)).toEqual(owner);
  });

    it('stays inside the server’s limits for every role', () => {
    for (const role of STAFF_ROLES) {
      const pages = freePages({ role }, (k) => en(k));
      expect(pages.length).toBeLessThanOrEqual(FREE_PAGES_MAX);
      for (const p of pages) {
        expect(p.route).toMatch(MOBILE_STAFF_ROUTE);
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.label.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it('carries the pages every starter asks about, for every role', () => {
    expect(FREE_STARTERS).toHaveLength(3);
    for (const role of STAFF_ROLES) {
      const routes = freePages({ role }, (k) => en(k)).map((p) => p.route);
      expect(routes).toEqual(expect.arrayContaining(['/staff-request', '/staff-suggestions', '/staff-incidents']));
    }
  });

  it('drops empty labels', () => {
    expect(freePages({ role: 'waiter' }, () => '  ')).toEqual([]);
  });
});

describe('freeFrom', () => {
  it('keeps a staff page and drops anything else', () => {
    expect(freeFrom('/staff-order')).toBe('/staff-order');
    expect(freeFrom('/staff')).toBe('/staff');
    expect(freeFrom(['/staff-shopping'])).toBe('/staff-shopping');
    expect(freeFrom('/staff-order?x=1')).toBe('/staff-order');
    expect(freeFrom('/staff-assistant')).toBeNull();
    expect(freeFrom('/(tabs)')).toBeNull();
    expect(freeFrom('/staff_order')).toBeNull();
    expect(freeFrom(undefined)).toBeNull();
    expect(freeFrom('')).toBeNull();
  });
});

describe('buildFreeBody', () => {
  const pages = [{ route: '/staff', label: 'Staff panel' }];

  it('sends the question for the phone with its page and pages', () => {
    expect(buildFreeBody({ text: '  where?  ', lang: 'ar', route: '/staff-order', earlier: [], pages })).toEqual({
      text: 'where?',
      lang: 'ar',
      app: 'mobile',
      route: '/staff-order',
      pages,
    });
  });

  it('leaves out a missing page and empty history, and cuts a long question', () => {
    const body = buildFreeBody({ text: 'x'.repeat(FREE_TEXT_MAX + 50), lang: 'en', route: null, earlier: [], pages });
    expect(body.text).toHaveLength(FREE_TEXT_MAX);
    expect('route' in body).toBe(false);
    expect('history' in body).toBe(false);
  });

  it('sends back only finished answers, the last few turns', () => {
    const earlier: FreeLiveTurn[] = [
      done(1, 'q1', 'a1'),
      { ...done(2, 'q2', ''), error: { code: 'UPSTREAM' } },
      { ...done(3, 'q3', 'half'), stopped: true },
      done(4, 'q4', 'a4'),
      done(5, 'q5', 'a5'),
      done(6, 'q6', 'a6'),
    ];
    const body = buildFreeBody({ text: 'next', lang: 'en', route: null, earlier, pages });
    expect(body.history).toHaveLength(FREE_HISTORY_MAX);
    expect(body.history![0]).toEqual({ role: 'user', text: 'q4' });
    expect(body.history!.at(-1)).toEqual({ role: 'assistant', text: 'a6' });
  });
});

describe('refusals', () => {
  it('carries the refusal on the thrown error', () => {
    const err = new FreeStreamError({ code: 'RATE_LIMITED', scope: 'day' });
    expect(err.info.scope).toBe('day');
    expect(err.name).toBe('FreeStreamError');
  });

  it('lands each refusal on its sentence, and offers Try again only where it can help', () => {
    expect(freeErrorMessage({ code: 'RATE_LIMITED', scope: 'minute', retryAfterS: 20 })).toEqual({
      message: { kind: 'minute', seconds: 20 },
      retry: true,
    });
    expect(freeErrorMessage({ code: 'RATE_LIMITED', scope: 'day' })).toEqual({
      message: { kind: 'text', key: 'staff.assistant.free.errors.day' },
      retry: false,
    });
    expect(freeErrorMessage({ code: 'RATE_LIMITED', scope: 'club' }).message).toEqual({
      kind: 'text',
      key: 'staff.assistant.free.errors.busy',
    });
    expect(freeErrorMessage({ code: 'NOT_CONFIGURED' })).toEqual({
      message: { kind: 'text', key: 'staff.assistant.free.errors.notConfigured' },
      retry: false,
    });
    expect(freeErrorMessage({ code: 'UPSTREAM' })).toEqual({
      message: { kind: 'text', key: 'staff.assistant.free.errors.generic' },
      retry: true,
    });
  });
});

describe('answerPages', () => {
  const pages = [
    { route: '/staff', label: 'Staff panel' },
    { route: '/staff-request', label: 'Vacation & requests' },
    { route: '/staff-suggestions', label: 'Suggestions' },
    { route: '/staff-incidents', label: 'Incidents' },
    { route: '/staff-notes', label: 'Notes' },
  ];

  it('turns the pages an answer names into buttons, known ones only, at most three', () => {
    expect(answerPages('Go to /staff-request, then /staff-request again.', pages)).toEqual([pages[1]]);
    expect(answerPages('Try /staff-production.', pages)).toEqual([]);
    expect(
      answerPages('/staff-notes /staff-incidents /staff-suggestions /staff-request', pages).map((p) => p.route),
    ).toEqual(['/staff-notes', '/staff-incidents', '/staff-suggestions']);
  });

  it('names a route as a testID segment', () => {
    expect(routeSegment('/staff-shopping')).toBe('staff-shopping');
  });
});
