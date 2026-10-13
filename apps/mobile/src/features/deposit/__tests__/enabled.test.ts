import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlinePaymentsShipped, parseOnlinePaymentsFlag } from '../enabled';
import { invokeDepositEdge } from '../api';
import { DepositEdgeError, parseDepositQuote, reviewPayment } from '../logic';
import { defaultPaymentChoice, effectiveChoice, paymentChoices } from '../../coaching/logic';
import { matchesEnabled } from '../../matches/logic';
import { guestPushHref } from '../../matches/pushRoutes';
import { getPendingJoin, setPendingJoin } from '../../matches/pendingJoin';
import { suggest, topSuggestions } from '../../playProfile/suggest';

afterEach(() => vi.unstubAllEnvs());

describe('parseOnlinePaymentsFlag', () => {
  it('only the literal "on" enables', () => {
    expect(parseOnlinePaymentsFlag('on')).toBe(true);
    expect(parseOnlinePaymentsFlag(' ON ')).toBe(true);
    for (const v of ['off', '', 'true', '1', 'yes', undefined, null]) {
      expect(parseOnlinePaymentsFlag(v)).toBe(false);
    }
  });

  it('reads the env at call time', () => {
    vi.stubEnv('EXPO_PUBLIC_ONLINE_PAYMENTS', 'on');
    expect(onlinePaymentsShipped()).toBe(true);
    vi.stubEnv('EXPO_PUBLIC_ONLINE_PAYMENTS', 'off');
    expect(onlinePaymentsShipped()).toBe(false);
  });
});

describe('store build (flag off): the server cannot turn the features on', () => {
  const off = () => vi.stubEnv('EXPO_PUBLIC_ONLINE_PAYMENTS', 'off');

  it('Review shows only the plain reserve button, whatever the quote says', () => {
    off();
    const quote = parseDepositQuote({ deposit_mode: 'optional', deposit_iqd: 20000, price_iqd: 40000, rest_iqd: 20000 });
    const required = parseDepositQuote({ deposit_mode: 'required', deposit_iqd: 20000, price_iqd: 40000, rest_iqd: 20000 });
    expect(reviewPayment(quote, false)).toEqual({ kind: 'off' });
    expect(reviewPayment(required, false)).toEqual({ kind: 'off' });
    expect(reviewPayment(undefined, false)).toEqual({ kind: 'off' });
  });

  it('a lesson offers the desk only', () => {
    off();
    expect(paymentChoices('online_optional')).toEqual(['desk']);
    expect(paymentChoices('online_required')).toEqual(['desk']);
    expect(defaultPaymentChoice('online_required')).toBe('desk');
    expect(effectiveChoice('online_optional', 'online')).toBe('desk');
  });

  it('open matches are off whatever the branch switch says', () => {
    off();
    expect(matchesEnabled({ matches_enabled: true })).toBe(false);
  });

  it('match and tickets pushes land on Home', () => {
    off();
    expect(guestPushHref('match', 'm-1')).toEqual({ pathname: '/(tabs)' });
    expect(guestPushHref('match', null)).toEqual({ pathname: '/(tabs)' });
    expect(guestPushHref('tickets', null)).toEqual({ pathname: '/(tabs)' });
  });

  it('no payment call leaves the phone', async () => {
    off();
    const invoke = vi.fn();
    const client = { functions: { invoke } } as never;
    await expect(invokeDepositEdge(client, 'deposit-begin', {})).rejects.toBeInstanceOf(DepositEdgeError);
    await expect(invokeDepositEdge(client, 'ticket-begin', {})).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('no join is left pending', () => {
    off();
    setPendingJoin({ kind: 'link', token: 't' });
    expect(getPendingJoin()).toBeNull();
  });

  it('open matches are never suggested', () => {
    off();
    expect(suggest({ level: 'advanced', years: null, wants: ['matches'] } as never).find((s) => s.kind === 'matches')?.available).toBe(false);
    expect(topSuggestions({ level: 'advanced', years: null, wants: ['matches'] } as never, 5).map((s) => s.kind)).not.toContain('matches');
  });
});
