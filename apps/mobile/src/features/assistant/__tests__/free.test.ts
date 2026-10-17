import { describe, expect, it } from 'vitest';
import { FREE_HISTORY_MAX, FREE_PAGES_MAX, FREE_TEXT_MAX, MOBILE_STAFF_ROUTE } from '@touch/core/assistant/free';
import { STAFF_ROLES } from '@touch/core';
import { makeT } from '@touch/i18n';
import {
  FREE_STARTERS,
  FreeStreamError,
  answerPages,
  applyFreeEvent,
  buildFreeBody,
  freeErrorMessage,
  freeFrom,
  freePages,
  freeRefusal,
  freeTurn,
  freeTurnsOf,
  routeSegment,
  type FreeLiveTurn,
} from '../free';
import { parseSseChunk, parseSseData } from '../sse';

const en = makeT('en');
const ar = makeT('ar');

const done = (id: number, question: string, text: string): FreeLiveTurn => ({
  ...freeTurn(id, question),
  text,
  done: true,
});

describe('freePages', () => {
  it('starts with Today and lists the role’s rows once each, in its language', () => {
    const pages = freePages('waiter', (k) => en(k));
    expect(pages[0]).toEqual({ route: '/staff', label: en('staff.shell.today.title') });
    expect(pages.map((p) => p.route)).toContain('/staff-request');
    expect(pages.map((p) => p.route)).toContain('/staff-suggestions');
    expect(new Set(pages.map((p) => p.route)).size).toBe(pages.length);
    const arPages = freePages('waiter', (k) => ar(k));
    expect(arPages[0]!.label).toBe(ar('staff.shell.today.title'));
  });

  it('never offers a page the role cannot open', () => {
    const waiter = freePages('waiter', (k) => en(k)).map((p) => p.route);
    expect(waiter).not.toContain('/staff-production');
    const chef = freePages('head_chef', (k) => en(k)).map((p) => p.route);
    expect(chef).toContain('/staff-production');
  });

  it('stays inside the server’s limits for every role', () => {
    for (const role of STAFF_ROLES) {
      const pages = freePages(role, (k) => en(k));
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
      const routes = freePages(role, (k) => en(k)).map((p) => p.route);
      expect(routes).toEqual(expect.arrayContaining(['/staff-request', '/staff-suggestions', '/staff-incidents']));
    }
  });

  it('drops empty labels', () => {
    expect(freePages('waiter', () => '  ')).toEqual([]);
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
  const pages = [{ route: '/staff', label: 'Today' }];

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
    expect(freeTurnsOf(earlier.slice(0, 4))).toEqual([
      { role: 'user', text: 'q1' },
      { role: 'assistant', text: 'a1' },
      { role: 'user', text: 'q4' },
      { role: 'assistant', text: 'a4' },
    ]);
    const body = buildFreeBody({ text: 'next', lang: 'en', route: null, earlier, pages });
    expect(body.history).toHaveLength(FREE_HISTORY_MAX);
    expect(body.history![0]).toEqual({ role: 'user', text: 'q4' });
    expect(body.history!.at(-1)).toEqual({ role: 'assistant', text: 'a6' });
  });
});

describe('applyFreeEvent', () => {
  it('folds a streamed answer', () => {
    const stream =
      'event: message_start\ndata: {"model":"m","free":true}\n\n' +
      'event: delta\ndata: {"text":"Open "}\n\n' +
      ': keep-alive\n\n' +
      'event: delta\ndata: {"text":"/staff-request"}\n\n' +
      'event: done\ndata: {"stop_reason":"end_turn"}\n\n';
    let turn = freeTurn(1, 'day off?');
    for (const ev of parseSseChunk(stream).events) turn = applyFreeEvent(turn, ev.event, parseSseData(ev.data));
    expect(turn).toMatchObject({ text: 'Open /staff-request', done: true, error: null });
  });

  it('keeps the first error and ends the turn', () => {
    let turn = applyFreeEvent(freeTurn(1, 'q'), 'error', { code: 'TIMEOUT', message: 'slow' });
    turn = applyFreeEvent(turn, 'done', { stop_reason: 'TIMEOUT' });
    expect(turn.error).toEqual({ code: 'TIMEOUT' });
    expect(turn.done).toBe(true);
    expect(applyFreeEvent(freeTurn(1, 'q'), 'error', { code: 'WHAT' }).error).toEqual({ code: 'UNKNOWN' });
  });
});

describe('refusals', () => {
  it('reads the body’s code, scope and wait', () => {
    expect(freeRefusal(429, { code: 'RATE_LIMITED', scope: 'minute', retry_after_s: 12.2 })).toEqual({
      code: 'RATE_LIMITED',
      scope: 'minute',
      retryAfterS: 13,
    });
    expect(freeRefusal(429, { code: 'RATE_LIMITED', scope: 'club' })).toEqual({ code: 'RATE_LIMITED', scope: 'club' });
    expect(freeRefusal(503, { code: 'NOT_CONFIGURED' })).toEqual({ code: 'NOT_CONFIGURED' });
  });

  it('falls back to the HTTP class', () => {
    expect(freeRefusal(401, null).code).toBe('AUTH_REQUIRED');
    expect(freeRefusal(403, 'no').code).toBe('FORBIDDEN');
    expect(freeRefusal(429, {}).code).toBe('RATE_LIMITED');
    expect(freeRefusal(503, {}).code).toBe('NOT_CONFIGURED');
    expect(freeRefusal(502, {}).code).toBe('UPSTREAM');
    expect(freeRefusal(400, {}).code).toBe('INVALID_REQUEST');
    expect(freeRefusal(418, {}).code).toBe('UNKNOWN');
  });

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
    { route: '/staff', label: 'Today' },
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
