import { describe, expect, it } from 'vitest';
import { canReportRow, rankReportMailto } from '../report';

describe('rankReportMailto', () => {
  it('addresses the venue and encodes the subject and body', () => {
    const url = rankReportMailto(
      'info@touch-padel.com',
      'Report a name: Ali K.',
      'Line one\n\nبلاغ',
    );
    expect(url.startsWith('mailto:info@touch-padel.com?subject=')).toBe(true);
    expect(url).toContain('subject=Report%20a%20name%3A%20Ali%20K.');
    expect(url).toContain('&body=Line%20one%0A%0A');
    expect(decodeURIComponent(url.split('&body=')[1]!)).toBe('Line one\n\nبلاغ');
  });
});

describe('canReportRow', () => {
  it('never offers the guest their own row or a row without a name', () => {
    expect(canReportRow({ mine: true, name: 'Me M.' })).toBe(false);
    expect(canReportRow({ mine: false, name: null })).toBe(false);
    expect(canReportRow({ mine: false, name: '  ' })).toBe(false);
    expect(canReportRow({ mine: false, name: 'Ali K.' })).toBe(true);
  });
});
