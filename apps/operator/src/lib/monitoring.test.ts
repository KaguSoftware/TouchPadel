/**
 * Dev monitoring from the operator (0393): reportEvent never throws, sends
 * through app.report_event, keeps what it cannot send in a capped outbox and
 * sends it later, and routes telemetry into monitoring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let behaviour: 'ok' | 'error' | 'throw' = 'ok';

vi.mock('./supabase', () => ({
  supabase: {
    schema: () => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (behaviour === 'throw') throw new TypeError('Failed to fetch');
        return Promise.resolve({ error: behaviour === 'error' ? { message: 'down' } : null });
      },
    }),
  },
}));

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

import {
  OUTBOX_KEY,
  OUTBOX_MAX,
  __resetMonitoringForTests,
  flushReports,
  installMonitoringReporter,
  kindForContext,
  pendingReports,
  reportError,
  reportEvent,
} from './monitoring';
import { captureException, setReporter } from './telemetry';

beforeEach(() => {
  calls.length = 0;
  behaviour = 'ok';
  vi.stubGlobal('localStorage', new MemoryStorage());
  __resetMonitoringForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setReporter(null);
});

describe('reportEvent', () => {
  it('sends one app.report_event call with the operator source, scrubbed', async () => {
    const out = await reportEvent({
      level: 'error',
      kind: 'print_failed',
      message: 'printer said no to a@b.com',
      detail: { pin: '1234', printer: 'EPSON', phone: '07701234567' },
      userReported: true,
    });
    expect(out).toBe('sent');
    expect(calls).toHaveLength(1);
    const { fn, args } = calls[0]!;
    expect(fn).toBe('report_event');
    expect(args).toMatchObject({ p_source: 'operator', p_level: 'error', p_kind: 'print_failed', p_user_reported: true });
    expect(args.p_message).toBe('printer said no to [email]');
    expect(args.p_detail).toMatchObject({ printer: 'EPSON' });
    expect(args.p_detail).not.toHaveProperty('pin');
    expect(args.p_detail).not.toHaveProperty('phone');
  });

  it('never throws: a thrown network error and a refused call both queue the event', async () => {
    behaviour = 'throw';
    await expect(reportEvent({ level: 'error', kind: 'crash', message: 'x' })).resolves.toBe('queued');
    behaviour = 'error';
    await expect(reportEvent({ level: 'warn', kind: 'crash', message: 'y' })).resolves.toBe('queued');
    expect(pendingReports()).toBe(2);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY)!)).toHaveLength(2);
  });

  it('never throws on garbage input', async () => {
    await expect(reportEvent(undefined as never)).resolves.toBeTypeOf('string');
    await expect(reportEvent({ level: 'nope' as never, kind: 'BAD KIND', message: 42 as never })).resolves.toBe('sent');
    expect(calls.at(-1)!.args).toMatchObject({ p_level: 'error', p_kind: 'unknown' });
  });

  it('caps the outbox, keeping the newest', async () => {
    behaviour = 'error';
    for (let i = 0; i < OUTBOX_MAX + 5; i++) await reportEvent({ level: 'info', kind: 'crash', message: `m${i}` });
    const kept = JSON.parse(localStorage.getItem(OUTBOX_KEY)!) as Array<{ args: { p_message: string } }>;
    expect(kept).toHaveLength(OUTBOX_MAX);
    expect(kept.at(-1)!.args.p_message).toBe(`m${OUTBOX_MAX + 4}`);
  });

  it('sends the outbox, oldest first, once the network is back', async () => {
    behaviour = 'error';
    await reportEvent({ level: 'error', kind: 'crash', message: 'first' });
    await reportEvent({ level: 'error', kind: 'crash', message: 'second' });
    behaviour = 'ok';
    calls.length = 0;
    await flushReports();
    expect(calls.map((c) => c.args.p_message)).toEqual(['first', 'second']);
    expect(pendingReports()).toBe(0);
    expect(localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it('works with no storage at all (memory outbox)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    behaviour = 'error';
    await expect(reportEvent({ level: 'error', kind: 'crash', message: 'kept' })).resolves.toBe('queued');
    expect(pendingReports()).toBe(1);
  });
});

describe('reportError and the telemetry bridge', () => {
  it('reportError names the kind and carries the error', async () => {
    await reportError('crash', new RangeError('bad index'), { userReported: true });
    expect(calls[0]!.args).toMatchObject({ p_kind: 'crash', p_message: 'RangeError: bad index', p_user_reported: true });
    expect(calls[0]!.args.p_detail).toMatchObject({ name: 'RangeError' });
  });

  it('kindForContext: boundary → crash, global handlers → unhandled, else error', () => {
    expect(kindForContext({ boundary: 'route' })).toBe('crash');
    expect(kindForContext({ kind: 'unhandledrejection' })).toBe('unhandled');
    expect(kindForContext({ label: 'x' })).toBe('error');
    expect(kindForContext(undefined)).toBe('error');
  });

  it('every captureException is reported once installed', async () => {
    installMonitoringReporter();
    captureException(new Error('boom'), { boundary: 'app' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.args).toMatchObject({ p_kind: 'crash', p_user_reported: false });
  });
});
