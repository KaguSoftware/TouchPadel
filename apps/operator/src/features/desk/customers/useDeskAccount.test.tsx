import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../../lib/i18n';
import { callEdge } from '../../../lib/edge';
import { useDeskAccount } from './deskAccount';

// The hook the desk dialogs call (0448): what it says, and the lesson
// screens' rule that an account a person already uses is left alone.

const info = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/edge', () => ({ callEdge: vi.fn() }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info }) }));

const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider>{children}</LocaleProvider>;
const edge = vi.mocked(callEdge);
const ask = () => renderHook(() => useDeskAccount(), { wrapper }).result.current;

beforeEach(() => {
  edge.mockReset();
  info.mockReset();
});

describe('useDeskAccount', () => {
  it('a new account: returned, and said', async () => {
    edge.mockResolvedValue({ id: 'c1', customer: { full_name: 'Ali', phone: '07701234567', gender: null } });
    const found = await ask()('Ali', '07701234567');
    expect(found).toMatchObject({ existing: false, claimed: false, check: false, incomplete: false, customer: { id: 'c1' } });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('is saved as a customer'));
  });

  it('a name alone: an incomplete customer, said as such', async () => {
    edge.mockResolvedValue({ id: 'c0', incomplete: true, customer: { full_name: 'Ali', phone: null, gender: null } });
    const found = await ask()('Ali', '');
    expect(found).toMatchObject({ incomplete: true, existing: false, customer: { id: 'c0', phone: null, incomplete: true } });
    expect(edge).toHaveBeenCalledWith('desk-customer-create', { fullName: 'Ali', preferredLang: 'en', ifExists: 'return' }, expect.anything());
    expect(info).toHaveBeenCalledWith(expect.stringContaining('by name only'));
  });

  it('the lesson screens: an account somebody uses in the app is left alone, silently', async () => {
    edge.mockResolvedValue({ id: 'c2', existing: true, claimed: true, customer: { full_name: 'Ali', phone: '07701234567', gender: 'male' } });
    expect(await ask()('Ali', '07701234567', { walkInsOnly: true })).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it("the lesson screens: the desk's own record of a walk-in is used", async () => {
    edge.mockResolvedValue({ id: 'c3', existing: true, claimed: false, customer: { full_name: 'Ali', phone: '07701234567', gender: null } });
    expect(await ask()('Ali', '07701234567', { walkInsOnly: true })).toMatchObject({ existing: true, claimed: false, customer: { id: 'c3' } });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Linked to the account of'));
  });

  it('quiet says nothing; no answer is null; nothing is asked without a name', async () => {
    edge.mockResolvedValue({ id: 'c4', customer: { full_name: 'Ali' } });
    expect(await ask()('Ali', '07701234567', { quiet: true })).not.toBeNull();
    expect(info).not.toHaveBeenCalled();
    edge.mockRejectedValue(new Error('down'));
    expect(await ask()('Ali', '07701234567')).toBeNull();
    edge.mockClear();
    expect(await ask()('', '07701234567')).toBeNull();
    expect(edge).not.toHaveBeenCalled();
  });
});
