/**
 * Setup home (/setup) — the landing screen of the owner's Setup section, now a
 * printed row of its rail (management rebuild, 2026-10-17).
 *
 * Not to be confused with features/setup/StationSetupScreen — that is the
 * first-run, pre-sign-in setup of the MACHINE.
 *
 * Setup screens are opened a few times a year, so the screen answers three
 * questions, in order:
 *
 *  1. **Is anything set up in a way that will bite?** Each check reads what
 *     the setup screens already read, with a button to the screen that fixes
 *     it:
 *       - Telegram is switched on but not reaching the group (no group, the
 *         example id, the last message failed or is stuck). Switched OFF is a
 *         choice and is not raised.
 *       - an active manager or owner with no PIN cannot approve a discount or
 *         a void at the till, which stops a sale mid-shift.
 *       - one active owner: if that account is lost, nobody can manage staff.
 *       - anyone who can sign in still on Kitchen (prep), retired by 0155.
 *       - a prepared item with no par level: the kitchen's "What to make
 *         today" never asks for it (build-contracts-2026-09-23 §5.5).
 *       - stock staff added on the phone with no cost on record
 *         (wave5-addendum-2026-09-25 D5).
 *       - cashiers and desk staff with no PIN of their own.
 *     When nothing is wrong it says so plainly rather than disappearing.
 *  2. **Where is the setting I want?** "Find a setting": the Go to search
 *     (components/GoToPalette.tsx), limited to Setup, on the page itself.
 *  3. **How is the venue set up?** One line each, with where to change it:
 *     accounts with access, coaches and lesson types on sale, courts open for
 *     booking, when the business day starts, branches, what the guest home
 *     screen shows, tables in use.
 *
 * The grid of one card per screen is gone (it repeated the rail), and pairing
 * a kitchen screen moved to Devices › Kitchen screens.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useVenue } from '../../lib/venue';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings } from '../../lib/settings';
import { Button, Skeleton } from '../../components/ui';
import { PageHeader, Panel, SearchField, ViewMore, useListCap } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { CardTitle, MARK, MARK_FG, MARK_SOFT, type MarkTone } from '../ops/OpsVisuals';
import { STAFF_QUERY_KEY, approvesWithPin, onRetiredRole, type StaffRow } from './staff/staffModel';
import { useOutbox } from './telegram/OutboxList';
import { telegramHealth, type TelegramHealth } from './telegram/telegramStatus';
import { SK as STOCK_KEYS, fetchNeedsCostCount } from '../stock/stockKeys';
import { canAccess, permissionsFor, useAuth } from '../../lib/auth';
import { useTabOpen } from '../../lib/navAccess';
import { rowShown } from '../../lib/workspaces';
import { T_EN, T_AR, buildGoToEntries, rankEntries } from '../../components/GoToPalette';
import { holdersWithoutPin } from '../tillShift/tillShiftLogic';
import { useCoachesAdmin, useCoachingCaps } from '../coaching/useCoaching';
import { onSaleCount } from './coaches/lessonTypeLogic';
import { teachingHere } from './coaches/coachesLogic';


/** Telegram states that mean "switched on, and staff are still not being told". */
const TELEGRAM_BROKEN: readonly TelegramHealth[] = ['noGroup', 'failing', 'stuck'];

export function SetupHomeScreen() {
  const { tr, locale } = useLocale();
  const cafe = useCafeSettings();

  const staffQ = useQuery({ queryKey: STAFF_QUERY_KEY, queryFn: () => appRpc<StaffRow[]>('list_staff') });
  const { venues, branchId } = useVenue();
  // Coaching (operator.md §5.3.3): the Coaches card's line, from coaches_admin; none on a server without it.
  const coachingCaps = useCoachingCaps();
  const coachesQ = useCoachesAdmin(branchId, { enabled: coachingCaps.manageCoaches });
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
  // Counted, not listed: the fix is on Ingredients, which lists them.
  const noParQ = useQuery({
    queryKey: ['stock', 'setupHome', 'preparedNoPar'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('ingredients')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'prepared')
        .eq('is_active', true)
        .is('par_level', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Wave 5: staff additions with no cost, counted; Goods in lists them.
  const needsCostQ = useQuery({ queryKey: STOCK_KEYS.needsCost, queryFn: fetchNeedsCostCount });

  const count = (n: number | undefined) => (n === undefined ? undefined : formatNumber(n, locale));
  const coaches = coachingCaps.manageCoaches ? coachesQ.data : null;
  const dayStart = cafe.isSuccess ? cafe.settings.analytics_business_day_start_hour : null;
  const glance: GlanceRow[] = [
    { key: 'staff', label: 'ws.owner.setupHome.status.staff', value: count(staffQ.data?.filter((s) => s.is_active).length), to: '/admin/staff', place: 'ws.shell.nav.staff' },
    ...(coaches
      ? [
          {
            key: 'coaches',
            label: 'ws.owner.setupHome.status.coaches' as MessageKey,
            value: `${formatNumber(teachingHere(coaches.coaches).length, locale)} · ${tr('ws.owner.setupHome.status.lessonTypesOnSale')} ${formatNumber(onSaleCount(coaches.lesson_types), locale)}`,
            to: '/admin/coaches',
            place: 'ws.shell.nav.coaches' as MessageKey,
          },
        ]
      : []),
    { key: 'courts', label: 'ws.owner.setupHome.status.courts', value: count(courtsQ.data), to: '/admin/courts', place: 'ws.shell.nav.courts' },
    {
      key: 'dayStarts',
      label: 'ws.owner.setupHome.status.dayStarts',
      value: dayStart === null ? undefined : dayStart === 0 ? tr('op.settings.calendarDay') : tr('op.settings.hour', { hour: String(dayStart).padStart(2, '0') }),
      to: '/admin/settings/day',
      place: 'ws.shell.nav.businessDay',
    },
    { key: 'branches', label: 'ws.owner.setupHome.status.branches', value: count(venues.length || undefined), to: '/admin/branches', place: 'ws.shell.nav.branches' },
    {
      key: 'homeScreen',
      label: 'ws.owner.setupHome.status.homeScreen',
      value: cafe.isSuccess ? tr(`ws.owner.setupHome.heroMode.${cafe.settings.hero_mode}`) : undefined,
      to: '/admin/hero',
      place: 'ws.shell.nav.guestSite',
    },
    { key: 'tables', label: 'ws.owner.setupHome.status.tables', value: count(tablesQ.data), to: '/admin/qr', place: 'ws.shell.nav.tables' },
  ];

  return (
    <div>
      <PageHeader title={tr('ws.owner.setupHome.title')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-5)', maxInlineSize: 'var(--tp-measure-wide)' }}>
        <WorthChecking staffQ={staffQ} outboxQ={outboxQ} noParQ={noParQ} needsCostQ={needsCostQ} cafe={cafe} />
        <FindASetting />
        <AtAGlance rows={glance} />
      </div>
    </div>
  );
}

interface GlanceRow {
  key: string;
  label: MessageKey;
  /** Undefined while its read is out; the row waits rather than saying zero. */
  value: string | undefined;
  to: string;
  /** The page's name, on the button that opens it. */
  place: MessageKey;
}

/**
 * "Find a setting": Go to on the page itself. Every section, since the page
 * map (2026-10-17) put each setting beside what it sets: court settings under
 * Courts, the menu under Café & shop, the club under Settings.
 */
function FindASetting() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canOpenTab = useTabOpen(true);
  const [query, setQuery] = useState('');
  const entries = useMemo(
    () => buildGoToEntries('management', (k) => tr(k), [T_EN, T_AR], (row) => rowShown(row, (p) => canAccess(staff, p), canOpenTab), canOpenTab),
    [tr, staff, canOpenTab],
  );
  const results = query.trim() ? rankEntries(entries, query).slice(0, 8) : [];
  return (
    <Panel title={<CardTitle icon="search">{tr('ws.owner.setupHome.find.title')}</CardTitle>}>
      <SearchField value={query} onChange={setQuery} placeholder={tr('ws.owner.setupHome.find.placeholder')} size="lg" />
      {query.trim() !== '' &&
        (results.length === 0 ? (
          <p role="status" style={{ color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-3)' }}>
            {tr('ws.shell.goTo.none', { query: query.trim() })}
          </p>
        ) : (
          <ul aria-label={tr('ws.shell.goTo.results')} style={{ listStyle: 'none', margin: 0, padding: 0, marginBlockStart: 'var(--tp-sp-3)', display: 'grid' }}>
            {results.map((entry) => (
              <li key={entry.id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                <Link
                  to={entry.to as never}
                  search={(entry.search ?? {}) as never}
                  className="tp-goto-option"
                  style={{ textDecoration: 'none', color: 'inherit', borderBlockEnd: 'none' }}
                >
                  <span style={{ fontWeight: 600 }}>{entry.label}</span>
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{entry.trail}</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Panel>
  );
}

/** How the venue is set up, one line each, with the page that changes it. */
function AtAGlance({ rows }: { rows: readonly GlanceRow[] }) {
  const { tr } = useLocale();
  const navigate = useNavigate();
  return (
    <Panel title={<CardTitle icon="sliders">{tr('ws.owner.setupHome.glance')}</CardTitle>}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {rows.map((row, i) => (
          <li
            key={row.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-3)',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-1-5)',
              borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
            }}
          >
            <span style={{ color: 'var(--tp-muted-fg)', minInlineSize: '14rem' }}>{tr(row.label)}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{row.value ?? '—'}</strong>
            <Button size="sm" kind="ghost" iconEnd="arrowUpRight" style={{ marginInlineStart: 'auto' }} onClick={() => void navigate({ to: row.to as never })}>
              {tr(row.place)}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
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
  noParQ,
  needsCostQ,
  cafe,
}: {
  staffQ: Q<StaffRow[]>;
  outboxQ: Q<{ status: 'queued' | 'sent' | 'failed' | 'skipped'; created_at: string }[]>;
  noParQ: Q<number>;
  needsCostQ: Q<number>;
  cafe: ReturnType<typeof useCafeSettings>;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const loading = staffQ.isPending || outboxQ.isPending || noParQ.isPending || needsCostQ.isPending || cafe.isLoading;
  const failed = [staffQ, outboxQ, noParQ, needsCostQ].filter((q) => q.isError);

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
    const retired = onRetiredRole(staffQ.data);
    if (retired > 0) {
      rows.push({
        key: 'retiredRole',
        count: retired,
        icon: 'users',
        tone: 'warn',
        title: tr('ws.owner.setupHome.checks.retiredRole'),
        hint: tr('ws.owner.setupHome.checks.retiredRoleHint'),
        action: tr('ws.owner.setupHome.checks.retiredRoleAction'),
        href: '/admin/staff',
      });
    }
  }

  if (noParQ.data) {
    rows.push({
      key: 'noPar',
      count: noParQ.data,
      icon: 'cake',
      tone: 'warn',
      title: tr('ws.supplies.setup.noPar'),
      hint: tr('ws.supplies.setup.noParHint'),
      action: tr('ws.supplies.setup.noParAction'),
      href: '/stock/ingredients',
    });
  }

  if (needsCostQ.data) {
    rows.push({
      key: 'needsCost',
      count: needsCostQ.data,
      icon: 'tag',
      tone: 'warn',
      title: tr('ws.stores.setup.needsCost'),
      hint: tr('ws.stores.setup.needsCostHint'),
      action: tr('ws.stores.setup.needsCostAction'),
      href: '/stock/receive',
    });
  }

  // Wave 5, till shifts: people who hold a shift with no PIN of their own
  // close it with a manager's (§5.2). From the permission map, not a role list.
  const shiftNoPin = staffQ.data ? holdersWithoutPin(staffQ.data, (role) => permissionsFor(role).takeCourtPayment, approvesWithPin) : 0;
  if (shiftNoPin > 0) {
    rows.push({
      key: 'shiftNoPin',
      count: shiftNoPin,
      icon: 'lock',
      tone: 'warn',
      title: tr('ws.tillShift.setup.noPin'),
      hint: tr('ws.tillShift.setup.noPinHint'),
      action: tr('ws.tillShift.setup.noPinAction'),
      href: '/admin/staff',
    });
  }

  const clear = !loading && failed.length === 0 && rows.length === 0;
  const cap = useListCap(rows);

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
        <>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {cap.shown.map((r) => (
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
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </>
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
