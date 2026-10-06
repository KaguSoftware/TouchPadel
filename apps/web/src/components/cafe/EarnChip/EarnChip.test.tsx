import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { formatNumber, t } from '@touch/i18n';
import { memberToken } from '@touch/core/loyalty';
import { __resetGuestLinksForTests } from '@/lib/account/linkGuest';
import { TEST_CARD, fakeAccountClient, testLoyalty } from '@/test/accountFakes';
import { EarnChip } from './EarnChip';

/**
 * The café's "earn points" chip against fake clients: the account client (the member) and the
 * café's anonymous client (the table session). Linking goes through the CAFÉ client with a
 * token the account client's card made; nothing here may break the café when it fails.
 */

const SARA = { id: 'u1', phone: '9647701234567', user_metadata: { given_name: 'Sara' } };

function fakeCafe(
  answer: { data: unknown; error: { message: string } | null } = {
    data: { linked: true, display_name: 'Sara A.' },
    error: null,
  },
) {
  const rpc = vi.fn(async () => answer);
  return { cafe: { schema: vi.fn(() => ({ rpc })) }, rpc };
}

beforeEach(() => {
  __resetGuestLinksForTests();
  window.sessionStorage.clear();
});

describe.each(['en', 'ar'] as const)('EarnChip (%s)', (locale) => {
  it('signed out: a chip to the account page with the way back', async () => {
    const { client } = fakeAccountClient();
    const { cafe, rpc } = fakeCafe();
    render(
      <EarnChip
        locale={locale}
        cafe={cafe as never}
        sessionId="s1"
        getAccount={() => client as never}
      />,
    );
    const link = await screen.findByRole('link', {
      name: t(locale, 'loyalty.web.cafeChip.signIn'),
    });
    expect(link.getAttribute('href')).toBe(`/${locale}/account?return=${encodeURIComponent('/')}`);
    // Signed out, the café client only asks whether loyalty is on; nothing is linked.
    expect(rpc.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['loyalty_public']);
  });

  it('signed out while loyalty is off: no chip at all', async () => {
    const { client } = fakeAccountClient();
    const { cafe } = fakeCafe({ data: { enabled: false }, error: null });
    const { container } = render(
      <EarnChip locale={locale} cafe={cafe as never} sessionId="s1" getAccount={() => client as never} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('signed in: links the café session through the café client, once, and shows the balance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { client } = fakeAccountClient({ user: SARA });
    const { cafe, rpc } = fakeCafe();
    const { unmount } = render(
      <EarnChip
        locale={locale}
        cafe={cafe as never}
        sessionId="s1"
        getAccount={() => client as never}
      />,
    );
    expect(
      await screen.findByText(t(locale, 'loyalty.web.cafeChip.earning', { name: 'Sara A.' })),
    ).toBeTruthy();
    expect(
      screen.getByText(
        t(locale, 'loyalty.web.cafeChip.balance', { points: formatNumber(1250, locale) }),
      ),
    ).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('link_guest_session', {
      p_member_token: memberToken(TEST_CARD, 1_700_000_000_000).token,
    });

    // A second mount in the same guest session does not link again.
    unmount();
    render(
      <EarnChip
        locale={locale}
        cafe={cafe as never}
        sessionId="s1"
        getAccount={() => client as never}
      />,
    );
    await screen.findByText(t(locale, 'loyalty.web.cafeChip.earning', { name: 'Sara A.' }));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a failed link is a quiet line with a retry, and the retry links', async () => {
    const { client } = fakeAccountClient({ user: SARA });
    const failing = fakeCafe({ data: null, error: { message: 'MEMBER_CODE_EXPIRED' } });
    render(
      <EarnChip
        locale={locale}
        cafe={failing.cafe as never}
        sessionId="s2"
        getAccount={() => client as never}
      />,
    );
    const retry = await screen.findByRole('button', {
      name: t(locale, 'loyalty.web.cafeChip.retry'),
    });
    expect(screen.queryByRole('alert')).toBeNull();
    failing.rpc.mockResolvedValueOnce({
      data: { linked: true, display_name: 'Sara A.' },
      error: null,
    } as never);
    fireEvent.click(retry);
    expect(
      await screen.findByText(t(locale, 'loyalty.web.cafeChip.earning', { name: 'Sara A.' })),
    ).toBeTruthy();
    expect(failing.rpc).toHaveBeenCalledTimes(2);
  });

  it('a token the server answers {linked: false} (0308: counted, not raised) is a failed link too', async () => {
    const { client } = fakeAccountClient({ user: SARA });
    const refused = fakeCafe({ data: { linked: false, error: 'MEMBER_CODE_INVALID' }, error: null });
    render(
      <EarnChip
        locale={locale}
        cafe={refused.cafe as never}
        sessionId="s5"
        getAccount={() => client as never}
      />,
    );
    expect(
      await screen.findByRole('button', { name: t(locale, 'loyalty.web.cafeChip.retry') }),
    ).toBeTruthy();
    expect(
      screen.queryByText(t(locale, 'loyalty.web.cafeChip.earning', { name: '' })),
    ).toBeNull();
  });

  it('renders nothing while loyalty is switched off, unbound, or without an account client', async () => {
    const off = fakeAccountClient({
      user: SARA,
      rpc: { my_loyalty: { data: testLoyalty({ enabled: false }), error: null } },
    });
    const { cafe, rpc } = fakeCafe();
    const { container, rerender } = render(
      <EarnChip
        locale={locale}
        cafe={cafe as never}
        sessionId="s3"
        getAccount={() => off.client as never}
      />,
    );
    await waitFor(() => expect(off.rpc).toHaveBeenCalledWith('my_loyalty', undefined));
    expect(container.textContent).toBe('');
    expect(rpc).not.toHaveBeenCalled();

    rerender(
      <EarnChip
        locale={locale}
        cafe={cafe as never}
        sessionId={null}
        getAccount={() => off.client as never}
      />,
    );
    expect(container.textContent).toBe('');
    rerender(
      <EarnChip locale={locale} cafe={cafe as never} sessionId="s4" getAccount={() => null} />,
    );
    expect(container.textContent).toBe('');
  });
});
