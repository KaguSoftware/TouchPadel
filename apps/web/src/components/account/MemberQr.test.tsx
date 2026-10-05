import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { t } from '@touch/i18n';
import { QR_INK, QR_PAPER, QUIET_MODULES, memberToken, qrModules } from '@touch/core/loyalty';
import { TEST_CARD } from '@/test/accountFakes';
import { MemberCardView } from './MemberCardView';
import { MemberQr } from './MemberQr';

/**
 * The member QR is a machine mark: black on white with the quiet zone, whatever the site's
 * mode, and drawn from the same geometry as the operator's table cards. The card around it
 * rotates the token on the card's step and counts down to the next one.
 */
describe('MemberQr', () => {
  it('draws the token black on white with a four-module quiet zone', () => {
    const value = 'TP-8F3K2QXM-123456';
    render(<MemberQr value={value} label="Member QR" />);
    const svg = screen.getByRole('img', { name: 'Member QR' });
    const size = qrModules(value).size;
    const box = size + 2 * QUIET_MODULES;
    expect(svg.getAttribute('viewBox')).toBe(`${-QUIET_MODULES} ${-QUIET_MODULES} ${box} ${box}`);
    const rect = svg.querySelector('rect');
    const path = svg.querySelector('path');
    expect(rect?.getAttribute('fill')).toBe(QR_PAPER);
    expect(rect?.getAttribute('width')).toBe(String(box));
    expect(path?.getAttribute('fill')).toBe(QR_INK);
    expect(path?.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    expect(svg.getAttribute('data-token')).toBe(value);
  });

  it('redraws for a new value', () => {
    const { rerender } = render(<MemberQr value="TP-8F3K2QXM-000001" label="QR" />);
    const before = screen.getByRole('img').querySelector('path')?.getAttribute('d');
    rerender(<MemberQr value="TP-8F3K2QXM-999999" label="QR" />);
    expect(screen.getByRole('img').querySelector('path')?.getAttribute('d')).not.toBe(before);
  });
});

describe.each(['en', 'ar'] as const)('MemberCardView (%s)', (locale) => {
  it('shows the current token, the member code and the phone, and rotates on the step', () => {
    let now = 59_000; // 1 s before the 60 s boundary of a 30 s step
    const clock = () => now;
    vi.useFakeTimers();
    try {
      render(
        <MemberCardView locale={locale} card={TEST_CARD} phone="+9647701234567" now={clock} />,
      );
      const qr = () =>
        screen.getByRole('img', { name: t(locale, 'loyalty.web.account.card.qrLabel') });
      expect(qr().getAttribute('data-token')).toBe(memberToken(TEST_CARD, 59_000).token);
      expect(screen.getByText('8F3K2QXM')).toBeTruthy();
      expect(screen.getByText('0770 123 4567')).toBeTruthy();
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');

      now = 61_000;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(qr().getAttribute('data-token')).toBe(memberToken(TEST_CARD, 61_000).token);
      expect(memberToken(TEST_CARD, 61_000).token).not.toBe(memberToken(TEST_CARD, 59_000).token);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the phone line out when the account has none', () => {
    render(<MemberCardView locale={locale} card={TEST_CARD} phone={null} />);
    expect(screen.queryByText(t(locale, 'loyalty.web.account.card.sayNumber'))).toBeNull();
  });
});
