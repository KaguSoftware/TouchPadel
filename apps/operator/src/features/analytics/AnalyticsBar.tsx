/**
 * The sticky bar both analytics tabs share (operator-slice.md §5.1, reworked
 * 2026-09-13). Two lines: the Courts | Cafe strip with the section jump-nav on
 * its inline-end side, then ONE filter row: period (one date field, the
 * shared DateRangePicker), the comparison basis, the court filter on the Courts
 * tab, and a "Settings" disclosure for the once-a-month settings. Range,
 * compare and court live in the URL (`AnalyticsSearch`); the business-day hour
 * and the exclusions are cafe-wide settings.
 *
 * The disclosure used to be called "More", which said nothing about what was
 * behind it; it is named for what it holds, and counts the settings that are
 * not at their default ("Settings (1 changed)") because each one changes
 * every figure on the page.
 *
 * Explanations (what a comparison basis means, what the business day is) sit
 * behind info buttons; STATE (a failed setting write) stays visible on the row.
 *
 * Compare with (owner, 2026-10-22): last month, last year, or a window the
 * owner picks. Choosing Custom writes the window compared with now, so the
 * page never waits on a half-made choice, and a second date field (the same
 * DateRangePicker as the period) appears to move it.
 */
import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BUSINESS_DAY_START_OPTIONS, COMPARE_BASES, RANGE_PRESETS, businessTodayISO, resolveRange, type CompareBasis, type DateRange, type RangePreset } from '@touch/core';
import { VENUE_TZ, type MessageKey } from '@touch/i18n';
import { Button, ErrorText, inputStyle } from '../../components/ui';
import { SelectMenu } from '../../components/SelectMenu';
import { DateRangePicker } from '../../components/DateRangePicker';
import { InfoTip } from '../../components/InfoTip';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { useSetCafeSetting } from '../../lib/settings';
import { AnalyticsTabs, type AnalyticsTab } from './AnalyticsTabs';
import { ExcludedItemsModal } from './ExcludedItemsModal';
import { MorePanel } from './MorePanel';
import { ZoneNav } from './ZoneNav';
import type { ZoneDef } from './Zone';
import type { AnalyticsSearch } from './search';
import type { MenuSnapshotRow } from './shape';

const PRESET_KEY: Record<Exclude<RangePreset, 'custom'>, MessageKey> = {
  today: 'analytics.deck.today',
  '7d': 'analytics.deck.d7',
  '30d': 'analytics.deck.d30',
  '90d': 'analytics.deck.d90',
};

const BASIS_KEY: Record<CompareBasis, MessageKey> = {
  month: 'analytics.deck.month',
  year: 'analytics.deck.year',
  custom: 'analytics.deck.custom',
};

const HINT_KEY: Record<CompareBasis, MessageKey> = {
  month: 'analytics.deck.compareHint.month',
  year: 'analytics.deck.compareHint.year',
  custom: 'analytics.deck.compareHint.custom',
};

const bar: CSSProperties = {
  position: 'sticky',
  // <main> is the scroll container and carries paddingBlock --tp-sp-4; a
  // sticky offset is measured from the scrollport's CONTENT edge, so 0 would
  // park the stuck bar a full --tp-sp-4 below the top of the pane.
  insetBlockStart: 'calc(-1 * var(--tp-sp-4))',
  zIndex: 'var(--tp-z-section-bar)',
  // The ground is .tp-glass-bar's, not this object's: it is frosted where the
  // browser can do it and falls back to the opaque --tp-bg where it cannot.
  borderBlockEnd: '1px solid var(--tp-border)',
  // Edge to edge: out past the frame's own inline padding (--tp-sp-4) AND
  // <main>'s (--tp-sp-5), so the bar meets the rail and the screen's edge; the
  // same amount goes back in as padding so its content stays on the page grid.
  marginInline: 'calc(-1 * (var(--tp-sp-4) + var(--tp-sp-5)))',
  paddingInline: 'calc(var(--tp-sp-4) + var(--tp-sp-5))',
  paddingBlock: 'var(--tp-sp-2-5)',
  marginBlockEnd: 'var(--tp-sp-3)',
  display: 'grid',
  gap: 'var(--tp-sp-2-5)',
};

const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: 'var(--tp-sp-3)',
  rowGap: 'var(--tp-sp-2)',
};

const groupLabel: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-0)',
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  color: 'var(--tp-muted-fg)',
  minBlockSize: '1.25rem',
};

const band: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minBlockSize: 'var(--tp-row-h)' };

const small: CSSProperties = { ...inputStyle, inlineSize: 'auto', fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1-5)' };
/** Paired with `small` on a control that stands on the frosted bar. */
const GLASS_CTL = 'tp-glass-ctl';

/** One labelled control group: the label line, then the control band. */
function Group({ label, tip, children, style }: { label?: ReactNode; tip?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', alignContent: 'start', ...style }}>
      <span style={groupLabel} aria-hidden={label === undefined || undefined}>
        {label ?? ' '}
        {tip && <InfoTip content={tip} style={{ marginBlock: '-0.35rem' }} />}
      </span>
      <div style={band}>{children}</div>
    </div>
  );
}

/** The once-a-month settings behind "More"; the cafe block only exists on the cafe tab. */
export interface BarDeck {
  startHour: number;
  cafe?: {
    excludedIds: readonly string[];
    menu: readonly MenuSnapshotRow[];
  };
}

export function AnalyticsBar({
  tab,
  search,
  setSearch,
  zones,
  compareBasis,
  compareRange,
  deck,
  courts,
}: {
  /** The Courts | Cafe strip; absent on a page with no tabs (Insights, 0360). */
  tab?: AnalyticsTab;
  search: AnalyticsSearch;
  setSearch: (next: Partial<AnalyticsSearch>) => void;
  zones: readonly ZoneDef[];
  compareBasis: CompareBasis;
  /** The window the page compares with now: Custom starts from it. */
  compareRange?: DateRange;
  /** Absent while a tab has no data hook yet (nothing to put behind More). */
  deck?: BarDeck;
  /** Courts tab: the court filter's options. */
  courts?: readonly { id: string; label: string }[];
}) {
  const { tr } = useLocale();
  const setSetting = useSetCafeSetting();
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreId = useId();
  const closeMore = useCallback(() => setMoreOpen(false), []);
  // The business day the presets count back from, the same one the data hooks use.
  const todayISO = businessTodayISO(new Date(), deck?.startHour ?? 4, VENUE_TZ);
  const presets = RANGE_PRESETS.filter((p): p is Exclude<RangePreset, 'custom'> => p !== 'custom').map((p) => ({
    key: p,
    label: tr(PRESET_KEY[p]),
    period: resolveRange({ range: p }, todayISO).range,
  }));
  const nonDefault = (deck ? Number(deck.startHour !== 4) : 0) + (deck?.cafe ? Number(deck.cafe.excludedIds.length > 0) : 0);

  return (
    <div id="analytics-bar" className="tp-glass-bar" style={bar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        {tab ? <AnalyticsTabs value={tab} /> : <span />}
        {zones.length > 0 && <ZoneNav zones={zones} />}
      </div>

      <div style={row}>
        {/* One field for the period (DateRangePicker, 2026-10-19). A chip keeps
            the rolling preset in the URL; any other range is written as custom dates. */}
        <Group label={tr('ws.reports.filters.period')}>
          <DateRangePicker
            aria-label={tr('ws.reports.filters.period')}
            value={resolveRange({ range: search.range, from: search.from, to: search.to }, todayISO).range}
            presets={presets}
            today={todayISO}
            max={todayISO}
            onChange={(next, key) =>
              key ? setSearch({ range: key as RangePreset, from: undefined, to: undefined }) : setSearch({ range: 'custom', from: next.from, to: next.to })
            }
            style={small}
            className={GLASS_CTL}
          />
        </Group>

        <Group label={tr('analytics.deck.compare')} tip={tr(HINT_KEY[compareBasis])}>
          <SelectMenu<CompareBasis>
            value={compareBasis}
            onChange={(cmp) => {
              if (cmp === compareBasis) return;
              if (cmp === 'custom') {
                // Start from the window compared with now; the field below moves it.
                if (compareRange) setSearch({ cmp, cmpFrom: compareRange.from, cmpTo: compareRange.to });
                return;
              }
              setSearch({ cmp, cmpFrom: undefined, cmpTo: undefined });
            }}
            options={COMPARE_BASES.map((b) => ({ value: b, label: tr(BASIS_KEY[b]) }))}
            style={small}
            className={GLASS_CTL}
            aria-label={tr('analytics.deck.compare')}
          />
        </Group>

        {compareBasis === 'custom' && compareRange && (
          <Group label={tr('analytics.deck.compareDates')}>
            <DateRangePicker
              aria-label={tr('analytics.deck.compareDates')}
              value={compareRange}
              today={todayISO}
              max={todayISO}
              onChange={(next) => setSearch({ cmp: 'custom', cmpFrom: next.from, cmpTo: next.to })}
              style={small}
              className={GLASS_CTL}
            />
          </Group>
        )}

        {courts && (
          <Group label={tr('ws.reports.filters.court')}>
            <SelectMenu<string>
              value={search.court ?? ''}
              onChange={(court) => setSearch({ court: court || undefined })}
              options={[{ value: '', label: tr('ws.reports.filters.allCourts') }, ...courts.map((c) => ({ value: c.id, label: c.label }))]}
              style={small}
              className={GLASS_CTL}
              aria-label={tr('ws.reports.filters.court')}
            />
          </Group>
        )}

        {deck && (
          <Group>
            <button
              ref={moreRef}
              type="button"
              className="tp-btn"
              data-kind="ghost"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              onClick={() => setMoreOpen((v) => !v)}
              style={{ minBlockSize: 'var(--tp-row-h)', fontSize: 'var(--tp-fs-sm)', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}
            >
              {nonDefault > 0 ? tr('ws.analytics.settings.count', { n: nonDefault }) : tr('ws.analytics.settings.title')}
              <Icon name="chevronDown" size={14} />
            </button>
            <MorePanel id={moreId} open={moreOpen} anchorRef={moreRef} onClose={closeMore} label={tr('ws.analytics.settings.title')}>
              <Group label={tr('analytics.deck.businessDay')} tip={tr('analytics.notices.businessDayLine', { hour: String(deck.startHour).padStart(2, '0') })}>
                <SelectMenu<string>
                  value={String(deck.startHour)}
                  onChange={(hour) => setSetting.mutate({ key: 'analytics_business_day_start_hour', value: Number(hour) })}
                  options={BUSINESS_DAY_START_OPTIONS.map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
                  disabled={setSetting.isPending}
                  style={small}
                  aria-label={tr('analytics.deck.businessDay')}
                />
              </Group>
              <ErrorText error={setSetting.error} />
              {deck.cafe && (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                  <span style={groupLabel}>{tr('analytics.deck.excluded')}</span>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.settings.excludedHint')}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setMoreOpen(false);
                      setExcludedOpen(true);
                    }}
                    style={{ justifySelf: 'start' }}
                  >
                    {deck.cafe.excludedIds.length > 0
                      ? tr('ws.analytics.settings.excludedCount', { n: deck.cafe.excludedIds.length })
                      : tr('ws.analytics.settings.excludedNone')}
                  </Button>
                </div>
              )}
            </MorePanel>
          </Group>
        )}
      </div>

      {excludedOpen && deck?.cafe && (
        <ExcludedItemsModal menu={deck.cafe.menu} excludedIds={deck.cafe.excludedIds} onClose={() => setExcludedOpen(false)} />
      )}
    </div>
  );
}
