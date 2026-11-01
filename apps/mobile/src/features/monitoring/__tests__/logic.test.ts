import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { REPORT_LINE, reportDone } from '../logic';

describe('Report crash states (F-15)', () => {
  it('has a line in both languages for every state', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      for (const key of Object.values(REPORT_LINE)) expect(t(key)).not.toBe(key);
    }
    expect(makeT('en')(REPORT_LINE.sent)).toBe('Sent. Thank you.');
  });
  it('stays off once sent or kept to send, and offers a retry after a failure', () => {
    expect(reportDone('sent')).toBe(true);
    expect(reportDone('queued')).toBe(true);
    expect(reportDone('failed')).toBe(false);
    expect(reportDone('idle')).toBe(false);
  });
});
