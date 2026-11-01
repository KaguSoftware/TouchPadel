import { beforeEach, describe, expect, it, vi } from 'vitest';

const printMock = vi.fn();
let electron = true;
vi.mock('../ipc/bridge', () => ({ touch: { print: (job: unknown) => printMock(job) } }));
vi.mock('./mutate', () => ({ isElectron: () => electron }));
const reportEvent = vi.fn();
vi.mock('./monitoring', () => ({ reportEvent: (e: unknown) => reportEvent(e) }));

const { printMessageKey, printOutcomeOf, printReceipt } = await import('./print');

beforeEach(() => {
  printMock.mockReset();
  reportEvent.mockReset();
  electron = true;
});

describe('print outcomes (F-30)', () => {
  it('reads the shell’s answer', () => {
    expect(printOutcomeOf({ ok: true })).toEqual({ ok: true, via: 'printer' });
    expect(printOutcomeOf({ ok: false, error: 'no-printer' })).toEqual({ ok: false, reason: 'no-printer', detail: null });
    expect(printOutcomeOf({ ok: false, error: 'Error: connect ECONNREFUSED 192.168.1.50:9100' })).toMatchObject({ ok: false, reason: 'failed' });
    expect(printOutcomeOf({ error: 'invalid IPC payload: html' })).toMatchObject({ ok: false, reason: 'failed' });
    expect(printOutcomeOf(undefined, new Error('boom'))).toEqual({ ok: false, reason: 'failed', detail: 'Error: boom' });
    expect(printOutcomeOf({ ok: false, error: 'x'.repeat(500) })).toMatchObject({ detail: 'x'.repeat(200) });
  });

  it('says a missing printer and a failed one differently', () => {
    expect(printMessageKey({ ok: false, reason: 'no-printer', detail: null })).toBe('ws.kit.print.noPrinter');
    expect(printMessageKey({ ok: false, reason: 'failed', detail: null })).toBe('ws.kit.print.failed');
    expect(printMessageKey({ ok: true, via: 'printer' })).toBeNull();
    expect(printMessageKey(null)).toBeNull();
  });
});

describe('printReceipt (F-30)', () => {
  it('prints on the station printer and reports nothing when it works', async () => {
    printMock.mockResolvedValue({ ok: true });
    expect(await printReceipt({ html: '<p>bill</p>', what: 'till_bill' })).toEqual({ ok: true, via: 'printer' });
    expect(printMock).toHaveBeenCalledWith({ kind: 'receipt', data: { html: '<p>bill</p>' } });
    expect(reportEvent).not.toHaveBeenCalled();
  });

  it('a missing printer: no dialog of its own, a report to monitoring without the bill', async () => {
    printMock.mockResolvedValue({ ok: false, error: 'no-printer' });
    const out = await printReceipt({ html: '<p>Ali 40,000</p>', what: 'court_receipt' });
    expect(out).toEqual({ ok: false, reason: 'no-printer', detail: null });
    expect(reportEvent).toHaveBeenCalledWith({
      level: 'error',
      kind: 'print_failed',
      message: 'court_receipt: no-printer',
      detail: { what: 'court_receipt', reason: 'no-printer', again: false, error: null },
    });
    expect(JSON.stringify(reportEvent.mock.calls)).not.toContain('Ali');
  });

  it('a throw from the bridge is a failure, and Print again is marked as a reprint', async () => {
    printMock.mockRejectedValue(new Error('ipc gone'));
    const out = await printReceipt({ html: '<p/>', what: 'shop_receipt', again: true });
    expect(out).toMatchObject({ ok: false, reason: 'failed' });
    expect(printMock).toHaveBeenCalledWith({ kind: 'reprint', data: { html: '<p/>' } });
    expect(reportEvent.mock.calls[0]![0]).toMatchObject({ kind: 'print_failed', detail: { again: true } });
  });

  it('browser mode prints with the browser and never calls the shell', async () => {
    electron = false;
    const print = vi.fn();
    vi.stubGlobal('window', { print });
    expect(await printReceipt({ html: '<p/>', what: 'till_bill' })).toEqual({ ok: true, via: 'dialog' });
    expect(print).toHaveBeenCalled();
    expect(printMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
