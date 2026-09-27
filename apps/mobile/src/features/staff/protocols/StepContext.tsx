/**
 * What a step's actor or decider needs to see beside the form (§2.9-§2.13):
 * the recipe to test, the cost to make each size, the figures behind a price
 * or promotion change, the tournament a court or marketing step serves, and
 * the bookings a plan's times would move. Each is shown only when its read
 * was made (useStepReads decides who may ask).
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { formatDateTime, formatIQD, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space } from '../../../theme';
import { Hint } from '../../../components/ui';
import { mapStaffError } from '../edge';
import { bilingual } from './logic';
import { Muted, Section, Strong } from './parts';
import type { StepDetail } from './types';
import type { StepReads } from './useStepReads';

export function StepContext({ detail, reads }: { detail: StepDetail; reads: StepReads }) {
  const { t, locale } = useLocale();
  const money = (n: number | null | undefined) => (typeof n === 'number' ? formatIQD(n, locale) : t('staff.protocols.common.none'));
  const name = (en: string | null | undefined, ar: string | null | undefined) => bilingual(locale, en, ar) ?? '';
  const when = (from: string, to: string) =>
    `${formatDateTime(new Date(from), locale)} – ${formatDateTime(new Date(to), locale)}`;
  const failed = (err: unknown) => <Hint>{t(mapStaffError(err))}</Hint>;
  const key = detail.step.step_key;
  const out: ReactNode[] = [];

  if (reads.testContext.data) {
    out.push(
      <Section key="test" title={t('staff.protocols.context.recipe')}>
        {reads.testContext.data.sizes.map((s) => (
          <View key={s.variant_id} style={{ gap: 2 }}>
            <Strong>{name(s.name_en, s.name_ar)}</Strong>
            {s.lines.map((l, i) => (
              <Muted key={`${l.ingredient_id}-${i}`}>
                {t('staff.protocols.context.line', {
                  qty: formatNumber(l.qty, locale),
                  unit: l.unit,
                  name: name(l.name_en, l.name_ar),
                })}
              </Muted>
            ))}
          </View>
        ))}
      </Section>,
    );
  } else if (reads.testContext.isError) out.push(<View key="test-e">{failed(reads.testContext.error)}</View>);

  if (reads.cost.data) {
    const c = reads.cost.data;
    out.push(
      <Section key="cost" title={t('staff.protocols.context.cost')}>
        {c.sizes.map((s) => (
          <Muted key={s.variant_id}>
            {`${name(s.name_en, s.name_ar)}: ${s.cost_known ? money(s.cost_iqd) : t('staff.protocols.context.costUnknown')}`}
          </Muted>
        ))}
        {c.unknown_lines.length > 0 ? (
          <Hint>{t('staff.protocols.context.costUnknownLines', { labels: isolate(c.unknown_lines.join(', ')) })}</Hint>
        ) : null}
      </Section>,
    );
  } else if (reads.cost.isError) out.push(<View key="cost-e">{failed(reads.cost.error)}</View>);

  if (reads.numbers.data) {
    const n = reads.numbers.data;
    const rows: ReactNode[] = [];
    n.sizes.forEach((s, i) => {
      rows.push(
        <View key={`s${i}`} style={{ gap: 1 }}>
          <Strong style={{ fontSize: 13 }}>
            {s.variant_id === null
              ? t('staff.protocols.context.newSize', { name: name(s.name_en, s.name_ar), next: money(s.new_price_iqd) })
              : t('staff.protocols.context.sizeLine', {
                  name: name(s.name_en, s.name_ar),
                  current: money(s.current_price_iqd),
                  next: money(s.new_price_iqd),
                })}
          </Strong>
          {s.cost_known ? (
            <Muted>
              {t('staff.protocols.context.costLine', {
                cost: money(s.cost_iqd),
                before: money(s.margin_before_iqd),
                after: money(s.margin_after_iqd),
              })}
            </Muted>
          ) : null}
          <Muted>
            {t('staff.protocols.context.sales30', {
              units: formatNumber(s.units_30d, locale),
              revenue: money(s.revenue_30d_iqd),
            })}
          </Muted>
        </View>,
      );
    });
    n.addons.forEach((a) => {
      rows.push(
        <View key={a.modifier_id} style={{ gap: 1 }}>
          <Strong style={{ fontSize: 13 }}>
            {t('staff.protocols.context.addonLine', {
              group: name(a.group_name_en, a.group_name_ar),
              name: name(a.name_en, a.name_ar),
              current: money(a.current_delta_iqd),
              next: money(a.new_delta_iqd),
            })}
          </Strong>
          <Muted>
            {t('staff.protocols.context.addonSales', {
              count: formatNumber(a.count_30d, locale),
              revenue: money(a.revenue_30d_iqd),
            })}
          </Muted>
        </View>,
      );
    });
    if (n.promotion) {
      rows.push(
        <View key="promo" style={{ gap: 1 }}>
          <Strong style={{ fontSize: 13 }}>
            {t('staff.protocols.context.promotionLine', {
              current: n.promotion.current_value === null ? t('staff.protocols.common.none') : formatNumber(n.promotion.current_value, locale),
              next: n.promotion.new_value === null ? t('staff.protocols.common.none') : formatNumber(n.promotion.new_value, locale),
            })}
          </Strong>
          <Muted>
            {t('staff.protocols.context.promotionCost', {
              cost: money(n.promotion.discount_cost_30d_iqd),
              units: formatNumber(n.promotion.units_30d, locale),
            })}
          </Muted>
        </View>,
      );
    }
    if (n.rate) {
      n.rate.durations.forEach((d) =>
        rows.push(
          <Muted key={`r${d.duration_min}`}>
            {t('staff.protocols.context.rateLine', {
              minutes: formatNumber(d.duration_min, locale),
              current: money(d.current_price_iqd),
              next: money(d.new_price_iqd),
            })}
          </Muted>,
        ),
      );
      rows.push(
        <Muted key="rate-sales">
          {t('staff.protocols.context.rateSales', {
            count: formatNumber(n.rate.bookings_30d, locale),
            revenue: money(n.rate.revenue_30d_iqd),
          })}
        </Muted>,
      );
    }
    if (n.featured) {
      rows.push(
        <View key="featured" style={{ gap: 1 }}>
          <Strong style={{ fontSize: 13 }}>
            {t('staff.protocols.context.featuredLine', {
              current: formatNumber(n.featured.current_pct ?? 0, locale),
              next: formatNumber(n.featured.new_pct ?? 0, locale),
            })}
          </Strong>
          {n.featured.current_hero_mode !== 'featured' ? <Muted>{t('staff.protocols.context.featuredOff')}</Muted> : null}
          <Muted>
            {t('staff.protocols.context.featuredCost', {
              units: formatNumber(n.featured.units_30d, locale),
              cost: money(n.featured.discount_cost_30d_iqd),
            })}
          </Muted>
        </View>,
      );
    }
    out.push(
      <Section key="numbers" title={t('staff.protocols.context.numbers')}>
        <View style={{ gap: space.s }}>{rows}</View>
      </Section>,
    );
  } else if (reads.numbers.isError) out.push(<View key="numbers-e">{failed(reads.numbers.error)}</View>);

  if (reads.tournament.data && key === 'marketing') {
    const c = reads.tournament.data;
    out.push(
      <Section key="tournament" title={t('staff.protocols.context.tournament')}>
        <Strong>{bilingual(locale, c.name.en, c.name.ar) ?? ''}</Strong>
        <Muted>
          {[
            c.tournamentClass ? t('staff.protocols.context.tournamentClass', { class: c.tournamentClass }) : null,
            c.format ? t(`staff.protocols.option.format.${c.format}` as MessageKey) : null,
            c.capacity
              ? t(
                  c.capacity.unit === 'pairs'
                    ? 'staff.protocols.context.capacityPairs'
                    : 'staff.protocols.context.capacityPlayers',
                  { count: formatNumber(c.capacity.count, locale) },
                )
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
        {c.ranges.map((r, i) => (
          <Muted key={i}>
            {`${r.courtNames.map((n) => bilingual(locale, n.en, n.ar)).filter(Boolean).join(locale === 'ar' ? '، ' : ', ')}: ${when(r.from, r.to)}`}
          </Muted>
        ))}
      </Section>,
    );
  } else if (reads.tournament.isError) out.push(<View key="tournament-e">{failed(reads.tournament.error)}</View>);

  if (reads.feasibility.data) {
    const f = reads.feasibility.data;
    out.push(
      <Section key="feasibility" title={t('staff.protocols.context.feasibility')}>
        {f.ranges.filter((r) => r.bookings > 0).length === 0 ? (
          <Muted>{t('staff.protocols.context.feasibilityNone')}</Muted>
        ) : (
          f.ranges
            .filter((r) => r.bookings > 0)
            .map((r, i) => (
              <Muted key={`${r.court_id}-${i}`}>
                {t('staff.protocols.context.feasibilityLine', {
                  court: name(r.court_name_en, r.court_name_ar),
                  when: when(r.from, r.to),
                  bookings: formatNumber(r.bookings, locale),
                  guests: formatNumber(r.guests, locale),
                })}
              </Muted>
            ))
        )}
      </Section>,
    );
  } else if (reads.feasibility.isError) out.push(<View key="feasibility-e">{failed(reads.feasibility.error)}</View>);

  if (out.length === 0) return null;
  return <View style={{ gap: space.sm }}>{out}</View>;
}
