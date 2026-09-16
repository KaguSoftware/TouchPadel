/**
 * Financial home (/financial) — the landing screen of Management's Financial
 * section.
 *
 * The rail names the section's question: money in, money out, and whether the
 * cash agrees. This screen answers the first and the last before it lists the
 * screens:
 *
 *  1. **This month so far** — read straight from `panel_headline`, the RPC the
 *     management panel uses, so the two screens can never state different
 *     revenue for the same month. The figures are split the way they are
 *     counted: what was EARNED (revenue) and what was TAKEN (cash, card). The
 *     old band printed the three side by side, and an owner adding cash and
 *     card got a number that is not the revenue beside it — with nothing to
 *     say that it never will be (bookings are earned on the day they are
 *     played, payments land on the day they are taken).
 *  2. **Does the cash agree?** — the last few closed days, expected against
 *     counted, and the variance in words (short / over / matches). It was only
 *     visible inside the day-close screen at the moment of closing; afterwards
 *     no screen showed it at all. Tone only on a non-zero variance.
 *  3. **The screens**, one card each, as before.
 */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatIQD, formatTime, type Locale } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../lib/i18n';
import { QK, fetchOpenDay } from '../../lib/queries';
import { SectionHome } from '../../components/SectionHome';
import { Button, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, Panel, presetPeriod } from '../../components/kit';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { varianceMagnitude, varianceSign } from '../admin/dayCloseLogic';
import { figuresIn, mapFigures, type FigureKey, type PanelHeadline } from '../panel/figures';

type CardKey =
  | 'reports' | 'cashDrawer'
  | 'dayClose' | 'rates' | 'menuPrices';

/** How many closed days the cash card lists. A week is what an owner scans. */
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
    <SectionHome
      sectionKey="financial"
      fullWidth
      title={tr('ws.owner.financialHome.title')}
      card={(key) => tr(`ws.owner.financialHome.cards.${key as CardKey}`)}
      screensTitle={tr('ws.owner.financialHome.screens')}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))', alignItems: 'start' }}>
        <MonthSoFar />
        <RecentCloses />
      </div>
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}

function MonthSoFar() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const period = useMemo(() => presetPeriod('thisMonth'), []);

  const headlineQ = useQuery({
    queryKey: ['financial', 'headline', period.from, period.to],
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
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <FigureGroup title={tr('ws.owner.panel.earned')} hint={tr('ws.owner.panel.earnedHint')}>
            <Figure label={label(revenue!)} value={value(revenue!)} large />
          </FigureGroup>
          <FigureGroup title={tr('ws.owner.panel.taken')} hint={tr('ws.owner.panel.takenHint')}>
            <Figure label={label(cash!)} value={value(cash!)} />
            <Figure label={label(card!)} value={value(card!)} />
          </FigureGroup>
        </div>
      </AsyncStateWrapper>
    </Panel>
  );
}

function FigureGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h3>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</p>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: 'var(--tp-sp-3)', margin: 0 }}>{children}</dl>
    </section>
  );
}

function Figure({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <dt style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{label}</dt>
      <dd
        dir="ltr"
        style={{
          margin: 0,
          fontSize: large ? 'var(--tp-fs-2xl)' : 'var(--tp-fs-xl)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--tp-font-numeric)',
          textAlign: 'start',
        }}
      >
        {value}
      </dd>
    </div>
  );
}

/** The last closed days: expected, counted, and the variance in words. */
function RecentCloses() {
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

  return (
    <Panel
      title={<CardTitle icon="sun">{tr('ws.owner.financialHome.closes.title')}</CardTitle>}
      actions={
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/day-close' })}>
          {tr('ws.owner.financialHome.closes.open')}
        </Button>
      }
    >
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
          {(closesQ.data ?? []).map((d) => (
            <CloseRow key={d.id} day={d} locale={locale} />
          ))}
        </ul>
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
