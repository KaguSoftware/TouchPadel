/**
 * Dev monitoring from the phone (F-15, 0393): reportEvent never throws, tries
 * twice, holds what still did not land for the next report, and telemetry
 * (the crash boundary, the Apple-revoke failure) reaches it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let answers: Array<'ok' | 'error' | 'throw'> = [];

vi.mock('../supabase', () => ({
  supabase: {
    schema: () => ({
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const a = answers.shift() ?? 'ok';
        if (a === 'throw') throw new TypeError('Network request failed');
        return Promise.resolve({ error: a === 'error' ? { message: 'down' } : null });
      },
    }),
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.1.0' }, platform: { ios: {} } } }));

vi.stubGlobal('__DEV__', false);

const {
  __resetMonitoringForTests,
  installGlobalErrorReporting,
  installMonitoringReporter,
  kindForContext,
  pendingReports,
  reportError,
  reportEvent,
} = await import('../monitoring');
const { captureException, setReporter } = await import('../telemetry');

beforeEach(() => {
  calls.length = 0;
  answers = [];
  __resetMonitoringForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setReporter(null);
});

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe('reportEvent (phone)', () => {
  it('sends one call with the mobile source, the app version and scrubbed detail', async () => {
    const out = await settle(
      reportEvent({ level: 'error', kind: 'crash', message: 'x', detail: { otp: '123456', screen: 'book' }, userReported: true }),
    );
    expect(out).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('report_event');
    expect(calls[0]!.args).toMatchObject({ p_source: 'mobile', p_app_version: '1.1.0', p_user_reported: true });
    expect(calls[0]!.args.p_detail).toMatchObject({ screen: 'book', platform: 'ios' });
    expect(calls[0]!.args.p_detail).not.toHaveProperty('otp');
  });

  it('retries once, and lands on the second try', async () => {
    answers = ['throw', 'ok'];
    await expect(settle(reportEvent({ level: 'error', kind: 'crash', message: 'x' }))).resolves.toBe('sent');
    expect(calls).toHaveLength(2);
  });

  it('never throws: two failures hold the event for the next report', async () => {
    answers = ['error', 'throw'];
    await expect(settle(reportEvent({ level: 'error', kind: 'crash', message: 'held' }))).resolves.toBe('queued');
    expect(pendingReports()).toBe(1);
    answers = ['ok', 'ok'];
    await settle(reportEvent({ level: 'error', kind: 'crash', message: 'next' }));
    await vi.runAllTimersAsync();
    expect(calls.slice(-2).map((c) => c.args.p_message)).toEqual(['next', 'held']);
    expect(pendingReports()).toBe(0);
  });

  it('never throws on garbage input', async () => {
    await expect(settle(reportEvent(null as never))).resolves.toBeTypeOf('string');
  });
});

describe('the telemetry bridge (F-15)', () => {
  it('a render crash and the Apple-revoke capture are reported without a button', async () => {
    installMonitoringReporter();
    captureException(new Error('render blew up'), { scope: 'render', fatal: true });
    captureException(new Error('account deletion: Apple revocation failed (500)'), { scope: 'account.delete.apple' });
    await vi.runAllTimersAsync();
    expect(calls.map((c) => c.args.p_kind)).toEqual(['crash', 'error']);
    expect(calls[1]!.args.p_message).toContain('Apple revocation failed');
    expect(calls.every((c) => c.args.p_user_reported === false)).toBe(true);
  });

  it('kindForContext', () => {
    expect(kindForContext({ scope: 'render' })).toBe('crash');
    expect(kindForContext({ scope: 'global' })).toBe('unhandled');
    expect(kindForContext({ scope: 'fonts.load' })).toBe('error');
  });

  it('uncaught JS errors are reported, then handed to the previous handler', async () => {
    let handler: ((e: unknown, fatal?: boolean) => void) | undefined;
    const previous = vi.fn();
    installGlobalErrorReporting({ getGlobalHandler: () => previous, setGlobalHandler: (h) => (handler = h) });
    const err = new Error('uncaught');
    handler!(err, true);
    expect(previous).toHaveBeenCalledWith(err, true);
    await vi.runAllTimersAsync();
    expect(calls[0]!.args).toMatchObject({ p_kind: 'crash' });
  });

  it('reportError carries the error name', async () => {
    await settle(reportError('crash', new TypeError('nope'), { userReported: true }));
    expect(calls[0]!.args).toMatchObject({ p_message: 'TypeError: nope', p_user_reported: true });
  });
});
