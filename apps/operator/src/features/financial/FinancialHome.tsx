/**
 * Financial home (/financial) — the landing screen of Management's Financial
 * section: money in, money out, and whether the cash agrees.
 *
 * Management rebuild (2026-10-17): the nine cards that repeated the rail are
 * gone; what they carried live (the safe's balance, wages due, coach
 * statements waiting) now sits in the sections below, each line linking to
 * the tab where it is handled. In the order an owner asks:
 *
 *  1. **Needs you** — online deposits whose refund failed or stalled, with
 *     Retry and "Settled another way" (contract §6). Shown only when a row
 *     waits or deposits are on, so it is the first thing when it matters.
 *  2. **This month so far** — read straight from `panel_headline`, the RPC the
 *     management panel uses, so the two screens can never state different
 *     revenue for the same month. Split the way the money is counted: what
 *     was EARNED (revenue) and what was TAKEN (cash, card), because bookings
 *     are earned on the day they are played and payments land on the day
 *     they are taken.
 *  3. **The cash** — what is in the safe (0343), then the last closed days,
 *     expected against counted, and the variance in words.
 *  4. **Coming due** — wages due now (the rail's own read), and this month's
 *     coach statements to approve and to pay.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatIQD, formatNumber, formatTime, type Locale, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { QK, fetchOpenDay } from '../../lib/queries';
import { Button, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, PageHeader, Panel, ViewMore, useListCap } from '../../components/kit';
import { useReportPeriod } from '../reports/ReportParts';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { varianceMagnitude, varianceSign } from '../admin/dayCloseLogic';
import { figuresIn, mapFigures, type FigureKey, type PanelHeadline } from '../panel/figures';
import { DepositAttentionPanel } from '../deposits/DepositAttentionPanel';
import { fetchWagesDue } from '../wages/api';
import { wagesDueCount } from '../wages/wagesLogic';
import { useCoachingCaps } from '../coaching/useCoaching';
import { useCoachStatements } from '../reports/coaches/statementKeys';
import { statementCounts } from '../reports/coaches/statementsLogic';
import { SK, fetchOverview } from '../safe/api';
import { readOverview } from '../safe/safeLogic';

/** How many closed days the cash section lists. A week is what an owner scans. */
export const RECENT_CLOSES = 7;

export interface ClosedDay {
  id: string;
  business_date: string;
  closed_at: string;
  cash_expected_iqd: number | null;
  cash_counted_iqd: number | null;
  cash_variance_iqd: number | null;
}

export function FinancialHomeScreen() {
  const { tr } = useLocale();
  return (
    <div>
      <PageHeader title={tr('ws.owner.financialHome.title')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-5)' }}>
        {/* Online deposits (build-contracts-2026-09-27 §6): refunds a person must see to. */}
        <DepositAttentionPanel />
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(26rem, 1fr))', alignItems: 'start' }}>
          <MonthSoFar />
          <TheCash />
        </div>
        <ComingDue />
      </div>
    </div>
  );
}

function MonthSoFar() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  // The venue's business month, re-read each render: at 00:30 on the 1st the
  // venue still trades on the 30th, and a till left here past midnight must
  // not keep polling last month. The station calendar did both wrong.
  const { period, ready } = useReportPeriod();

  const headlineQ = useQuery({
    queryKey: ['financial', 'headline', period.from, period.to],
    enabled: ready,
    queryFn: () =>
      appRpc<PanelHeadline>('panel_headline', {
        p_from: period.from,
        p_to: period.to,
        p_compare: 'none',
      }),
    refetchInterval: 60_000,
  });
  const figures = useMemo(() => mapFigures(headlineQ.data), [headlineQ.data]);
  const label = (key: FigureKey) => tr(`ws.owner.panel.figures.${key}`);
  // Nothing estimated: a figure the server did not send reads as absent, never as zero.
  const value = (key: FigureKey) => {
    const f = figures.get(key);
    return f?.value == null ? '—' : formatIQD(f.value, locale);
  };
  const [revenue, cash, card] = figuresIn('headline').map((m) => m.key);

  return (
    <Panel
      title={<CardTitle icon="banknote">{tr('ws.owner.financialHome.headline.title')}</CardTitle>}
      actions={
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/panel' })}>
          {tr('ws.owner.financialHome.headline.openPanel')}
        </Button>
      }
    >
      <AsyncStateWrapper
        status={headlineQ.isError ? 'error' : headlineQ.data ? 'ready' : 'loading'}
        error={headlineQ.error}
        onRetry={() => void headlineQ.refetch()}
        skeleton={<Skeleton lines={3} blockSize="1.4rem" />}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-5)', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
          <FigureBlock caption={tr('ws.owner.panel.earned')} hint={tr('ws.owner.panel.earnedHint')}>
            <Figure label={label(revenue!)} value={value(revenue!)} large />
          </FigureBlock>
          <FigureBlock caption={tr('ws.owner.panel.taken')} hint={tr('ws.owner.panel.takenHint')}>
            <Figure label={label(cash!)} value={value(cash!)} />
            <Figure label={label(card!)} value={value(card!)} />
          </FigureBlock>
        </div>
      </AsyncStateWrapper>
    </Panel>
  );
}

/** A caption over the figures it names: earned, or taken in payments. */
function FigureBlock({ caption, hint, children }: { caption: string; hint: string; children: ReactNode }) {
  return (
    <section aria-label={caption} style={{ display: 'grid', gap: 'var(--tp-sp-2)', alignContent: 'start' }}>
      <div>
        <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{caption}</h3>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '40ch' }}>{hint}</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2) var(--tp-sp-5)' }}>{children}</div>
    </section>
  );
}

/** One figure: its name, then the server's amount. */
function Figure({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{label}</span>
      <span
        dir="ltr"
        style={{
          fontSize: large ? 'var(--tp-fs-2xl)' : 'var(--tp-fs-xl)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--tp-font-numeric)',
          textAlign: 'start',
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** The cash: what is in the safe, then the last closed days, expected against counted. */
function TheCash() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const closesQ = useQuery({
    queryKey: ['financial', 'recentCloses'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ClosedDay[]> => {
      const { data, error } = await supabase
        .from('day_sessions')
        .select('id, business_date, closed_at, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd')
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false })
        .limit(RECENT_CLOSES);
      if (error) throw error;
      return (data ?? []) as ClosedDay[];
    },
  });
  const openDay = dayQ.data;
  const cap = useListCap(closesQ.data ?? []);
  // The safe page's own read (0343), so the two agree.
  const safeQ = useQuery({ queryKey: SK.overview(null), queryFn: () => fetchOverview(null), refetchInterval: 60_000 });
  const safeBalance = safeQ.isSuccess ? readOverview(safeQ.data).balanceIqd : null;

  return (
    <Panel
      title={<CardTitle icon="drawer">{tr('ws.owner.financialHome.cash.title')}</CardTitle>}
      actions={
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/day-close' })}>
          {tr('ws.owner.financialHome.closes.open')}
        </Button>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlockEnd: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-3)', borderBlockEnd: '1px solid var(--tp-border)' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.financialHome.status.inSafe')}</span>
          <strong dir="ltr" data-testid="financial.safe.status" style={{ fontSize: 'var(--tp-fs-xl)', fontVariantNumeric: 'tabular-nums', textAlign: 'start' }}>
            {safeBalance === null ? '—' : formatIQD(safeBalance, locale)}
          </strong>
        </div>
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" style={{ marginInlineStart: 'auto' }} onClick={() => void navigate({ to: '/safe' })}>
          {tr('ws.owner.financialHome.cash.openSafe')}
        </Button>
      </div>
      <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr('ws.owner.financialHome.closes.title')}</h3>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>
        {openDay?.opened_at
          ? tr('ws.owner.financialHome.closes.dayOpen', { time: formatTime(new Date(openDay.opened_at), locale) })
          : dayQ.isSuccess
            ? tr('ws.owner.financialHome.closes.dayNotOpen')
            : tr('ws.owner.financialHome.closes.lead')}
      </p>
      <AsyncStateWrapper
        status={closesQ.isError ? 'error' : closesQ.data ? (closesQ.data.length === 0 ? 'empty' : 'ready') : 'loading'}
        error={closesQ.error}
        onRetry={() => void closesQ.refetch()}
        skeleton={<Skeleton lines={4} blockSize="1.2rem" />}
        emptyContent={<p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.financialHome.closes.empty')}</p>}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {cap.shown.map((d) => (
            <CloseRow key={d.id} day={d} locale={locale} />
          ))}
        </ul>
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
      </AsyncStateWrapper>
    </Panel>
  );
}

function CloseRow({ day: d, locale }: { day: ClosedDay; locale: Locale }) {
  const { tr } = useLocale();
  const counted = d.cash_counted_iqd != null && d.cash_variance_iqd != null;
  const sign = counted ? varianceSign(d.cash_variance_iqd!) : null;
  const amount = counted ? formatIQD(varianceMagnitude(d.cash_variance_iqd!), locale) : '';
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--tp-sp-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-2)',
        borderBlockEnd: '1px solid var(--tp-border)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <span style={{ fontWeight: 600, minInlineSize: '8rem' }}>
        <bdi>{formatDate(new Date(`${d.business_date}T12:00:00Z`), locale, 'UTC')}</bdi>
      </span>
      <span style={{ color: 'var(--tp-muted-fg)', flex: '1 1 12rem' }}>
        {tr('ws.owner.financialHome.closes.expected')} <bdi>{d.cash_expected_iqd == null ? '—' : formatIQD(d.cash_expected_iqd, locale)}</bdi>
        {' · '}
        {tr('ws.owner.financialHome.closes.counted')} <bdi>{d.cash_counted_iqd == null ? '—' : formatIQD(d.cash_counted_iqd, locale)}</bdi>
      </span>
      <span
        style={{
          marginInlineStart: 'auto',
          fontWeight: 700,
          color: sign === null ? 'var(--tp-muted-fg)' : sign === 'exact' ? MARK_FG.success : sign === 'short' ? MARK_FG.danger : MARK_FG.warn,
        }}
      >
        <bdi>
          {sign === null
            ? tr('ws.owner.financialHome.closes.notCounted')
            : sign === 'exact'
              ? tr('ws.manager.dayClose.varianceExact')
              : tr(sign === 'short' ? 'ws.manager.dayClose.varianceShort' : 'ws.manager.dayClose.varianceOver', { amount })}
        </bdi>
      </span>
    </li>
  );
}

/**
 * What is owed soon: wages due now (the rail's Pay badge reads the same) and
 * this month's coach statements waiting to be approved or paid. A line shows
 * for each the owner may act on; zero is said as zero, so the section does
 * not jump about from one day to the next.
 */
function ComingDue() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const wagesOn = can(staff, 'manageWages');
  const wagesQ = useQuery({ queryKey: QK.wagesDue, queryFn: fetchWagesDue, enabled: wagesOn, refetchInterval: 60_000 });
  const { settleCoaches } = useCoachingCaps();
  const statementsQ = useCoachStatements(null, settleCoaches);
  const coachPay = statementsQ.data ? statementCounts(statementsQ.data.statements) : null;
  const n = (v: number) => formatNumber(v, locale);

  const lines: { key: string; label: MessageKey; value: ReactNode; open: MessageKey; to: string }[] = [];
  if (wagesOn && wagesQ.isSuccess) {
    lines.push({ key: 'wages', label: 'ws.owner.financialHome.due.wages', value: n(wagesDueCount(wagesQ.data)), open: 'ws.owner.financialHome.due.openWages', to: '/wages' });
  }
  if (settleCoaches && coachPay) {
    lines.push({
      key: 'coachPay',
      label: 'ws.owner.financialHome.due.coachPay',
      value: (
        <span data-testid="financial.coachPay.status">
          {tr('ws.owner.financialHome.status.toApprove')} {n(coachPay.toApprove)} · {tr('ws.owner.financialHome.status.toPay')} {n(coachPay.toPay)}
        </span>
      ),
      open: 'ws.owner.financialHome.due.openCoachPay',
      to: '/reports/coaches',
    });
  }
  if (lines.length === 0) return null;

  return (
    <Panel title={<CardTitle icon="clock">{tr('ws.owner.financialHome.due.title')}</CardTitle>}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {lines.map((line, i) => (
          <li
            key={line.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-3)',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-2)',
              borderBlockStart: i > 0 ? '1px solid var(--tp-border)' : undefined,
            }}
          >
            <span style={{ color: 'var(--tp-muted-fg)', minInlineSize: '12rem' }}>{tr(line.label)}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{line.value}</strong>
            <Button size="sm" kind="ghost" iconEnd="arrowUpRight" style={{ marginInlineStart: 'auto' }} onClick={() => void navigate({ to: line.to as never })}>
              {tr(line.open)}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
