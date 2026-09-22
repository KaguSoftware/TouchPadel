/**
 * Setup home (/setup) — the landing screen of the owner's Setup SECTION.
 *
 * The card grid, the role wall and the "no card back to this screen" rule all
 * live in components/SectionHome, shared with Financial and Observation.
 *
 * Not to be confused with features/setup/StationSetupScreen — that is the
 * first-run, pre-sign-in setup of the MACHINE.
 *
 * The screen answers two questions, in the /observation shape:
 *
 *  1. **Is anything set up in a way that will bite?** Setup screens are opened
 *     a few times a year, so nobody notices a half-finished one until a shift
 *     trips over it. Three checks, each from a read these screens already
 *     make, each with a button to the screen that fixes it:
 *       - Telegram is switched on but not reaching the group (no group, the
 *         example id, the last message failed or is stuck) — staff are not
 *         being told about orders and think they are. Switched OFF is a choice
 *         and is not raised.
 *       - an active manager or owner with no PIN cannot approve a discount or
 *         a void at the till, which stops a sale mid-shift.
 *       - one active owner: if that account is lost, nobody can manage staff.
 *     When nothing is wrong it says so plainly rather than disappearing.
 *  2. **Where do I go?** The section's screens as cards, each with one honest
 *     live line: accounts with access, courts open for booking, tables in use,
 *     what the guest home screen shows, when the business day starts.
 *  3. **Pair a kitchen screen.** Done once per kitchen screen, and only on the
 *     till computer, so it lives here and not in every till's sidebar
 *     (KitchenPairing).
 *
 * The old lead ("How the venue is configured. These screens are opened rarely
 * and changed deliberately…") described the screen to the person looking at
 * it, and is gone.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings } from '../../lib/settings';
import { SectionHome } from '../../components/SectionHome';
import { Button, Skeleton } from '../../components/ui';
import { Panel } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { CardTitle, MARK, MARK_FG, MARK_SOFT, type MarkTone } from '../ops/OpsVisuals';
import { STAFF_QUERY_KEY, approvesWithPin, type StaffRow } from './staff/staffModel';
import { useOutbox } from './telegram/OutboxList';
import { telegramHealth, type TelegramHealth } from './telegram/telegramStatus';
import { KitchenPairingPanel } from './KitchenPairing';

type CardKey = 'staff' | 'courts' | 'tables' | 'settings' | 'guestSite';

/** Telegram states that mean "switched on, and staff are still not being told". */
const TELEGRAM_BROKEN: readonly TelegramHealth[] = ['noGroup', 'failing', 'stuck'];

export function SetupHomeScreen() {
  const { tr, locale } = useLocale();
  const cafe = useCafeSettings();

  const staffQ = useQuery({ queryKey: STAFF_QUERY_KEY, queryFn: () => appRpc<StaffRow[]>('list_staff') });
  const courtsQ = useQuery({
    queryKey: ['courts', 'setupHome'],
    queryFn: async () => {
      const { count, error } = await supabase.from('courts').select('id', { count: 'exact', head: true }).eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const tablesQ = useQuery({
    queryKey: ['cafeTables', 'setupHome'],
    queryFn: async () => {
      const { count, error } = await supabase.from('cafe_tables').select('id', { count: 'exact', head: true }).eq('is_active', true);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const outboxQ = useOutbox();

  const figure = (label: MessageKey, n: number | undefined) =>
    n === undefined ? null : (
      <>
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(label)}</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(n, locale)}</strong>
      </>
    );
  const words = (label: MessageKey, value: string) => (
    <>
      <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(label)}</span>
      <strong>{value}</strong>
    </>
  );

  function status(key: string): ReactNode {
    switch (key as CardKey) {
      case 'staff':
        return figure('ws.owner.setupHome.status.staff', staffQ.data?.filter((s) => s.is_active).length);
      case 'courts':
        return figure('ws.owner.setupHome.status.courts', courtsQ.data);
      case 'tables':
        return figure('ws.owner.setupHome.status.tables', tablesQ.data);
      case 'settings': {
        if (!cafe.isSuccess) return null;
        const h = cafe.settings.analytics_business_day_start_hour;
        return words('ws.owner.setupHome.status.dayStarts', h === 0 ? tr('op.settings.calendarDay') : tr('op.settings.hour', { hour: String(h).padStart(2, '0') }));
      }
      case 'guestSite':
        return cafe.isSuccess ? words('ws.owner.setupHome.status.homeScreen', tr(`ws.owner.setupHome.heroMode.${cafe.settings.hero_mode}`)) : null;
      default:
        return null;
    }
  }

  return (
    <SectionHome
      sectionKey="setup"
      fullWidth
      title={tr('ws.owner.setupHome.title')}
      card={(key) => tr(`ws.owner.setupHome.cards.${key as CardKey}`)}
      status={status}
      screensTitle={tr('ws.owner.setupHome.screens')}
    >
      <WorthChecking staffQ={staffQ} outboxQ={outboxQ} cafe={cafe} />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
      <KitchenPairingPanel />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}

interface Check {
  key: string;
  /** A count to show, or an icon when the row is a state rather than a number. */
  count: number | null;
  icon: IconName;
  tone: MarkTone;
  title: string;
  hint: string;
  action: string;
  href: string;
}

type Q<T> = { data?: T; isPending: boolean; isError: boolean; refetch: () => unknown };

function WorthChecking({
  staffQ,
  outboxQ,
  cafe,
}: {
  staffQ: Q<StaffRow[]>;
  outboxQ: Q<{ status: 'queued' | 'sent' | 'failed' | 'skipped'; created_at: string }[]>;
  cafe: ReturnType<typeof useCafeSettings>;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const loading = staffQ.isPending || outboxQ.isPending || cafe.isLoading;
  const failed = [staffQ, outboxQ].filter((q) => q.isError);

  const rows: Check[] = [];
  if (cafe.isSuccess && outboxQ.data) {
    const health = telegramHealth({ enabled: cafe.settings.telegram_enabled, chatId: cafe.settings.telegram_chat_id }, outboxQ.data[0] ?? null, Date.now());
    if (TELEGRAM_BROKEN.includes(health)) {
      rows.push({
        key: 'telegram',
        count: null,
        icon: 'bell',
        tone: 'danger',
        title: tr('ws.owner.setupHome.checks.telegram'),
        hint: tr(`ws.owner.setupHome.checks.telegramHint.${health as 'noGroup' | 'failing' | 'stuck'}`),
        action: tr('ws.owner.setupHome.checks.telegramAction'),
        href: '/admin/telegram',
      });
    }
  }
  if (staffQ.data) {
    const active = staffQ.data.filter((s) => s.is_active);
    // Approvals only: a cashier without a PIN cannot take a break, but that is
    // their editor's note, not a setup gap.
    const noPin = active.filter((s) => approvesWithPin(s.role) && !s.has_pin).length;
    if (noPin > 0) {
      rows.push({
        key: 'pins',
        count: noPin,
        icon: 'lock',
        tone: 'warn',
        title: tr('ws.owner.setupHome.checks.noPin'),
        hint: tr('ws.owner.setupHome.checks.noPinHint'),
        action: tr('ws.owner.setupHome.checks.noPinAction'),
        href: '/admin/staff',
      });
    }
    if (active.filter((s) => s.role === 'owner').length === 1) {
      rows.push({
        key: 'owner',
        count: null,
        icon: 'shield',
        tone: 'neutral',
        title: tr('ws.owner.setupHome.checks.oneOwner'),
        hint: tr('ws.owner.setupHome.checks.oneOwnerHint'),
        action: tr('ws.owner.setupHome.checks.oneOwnerAction'),
        href: '/admin/staff',
      });
    }
  }

  const clear = !loading && failed.length === 0 && rows.length === 0;

  return (
    <Panel title={<CardTitle icon={clear ? 'checkCircle' : 'alert'}>{tr('ws.owner.setupHome.checks.title')}</CardTitle>}>
      {loading && rows.length === 0 ? (
        <Skeleton lines={1} blockSize="1.6rem" />
      ) : clear ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success }}>
          <Icon name="checkCircle" size={18} style={{ color: MARK.success, flex: '0 0 auto' }} />
          {tr('ws.owner.setupHome.checks.none')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {rows.map((r) => (
            <li key={r.key} data-check={r.key} style={rowStyle}>
              <span style={{ ...countBlock, background: MARK_SOFT[r.tone], color: MARK_FG[r.tone] }}>
                {r.count === null ? <Icon name={r.icon} size={18} style={{ color: MARK[r.tone] }} /> : formatNumber(r.count, locale)}
              </span>
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
                <strong>{r.title}</strong>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{r.hint}</span>
              </span>
              <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: r.href })}>
                {r.action}
              </Button>
            </li>
          ))}
          {/* A check that failed is not a check that passed: say so beside the rest. */}
          {failed.length > 0 && (
            <li style={rowStyle}>
              <span style={{ ...countBlock, background: MARK_SOFT.neutral, color: MARK_FG.neutral }}>
                <Icon name="alert" size={18} style={{ color: MARK.danger }} />
              </span>
              <span style={{ flex: '1 1 16rem', minInlineSize: 0, fontWeight: 600 }}>{tr('ws.owner.setupHome.checks.error')}</span>
              <Button size="sm" icon="refresh" onClick={() => failed.forEach((q) => void q.refetch())}>
                {tr('common.retry')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  flexWrap: 'wrap',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-2)',
  borderRadius: 'var(--tp-radius-ctl)',
  background: 'var(--tp-surface-2)',
} as const;

const countBlock = {
  display: 'grid',
  placeItems: 'center',
  minInlineSize: '3rem',
  blockSize: '2.5rem',
  paddingInline: 'var(--tp-sp-2)',
  borderRadius: 'var(--tp-radius-ctl)',
  fontSize: 'var(--tp-fs-lg)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
} as const;
