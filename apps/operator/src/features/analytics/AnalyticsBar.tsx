/**
 * The sticky bar both analytics tabs share (operator-slice.md §5.1, reworked
 * 2026-09-13). Two lines: the Courts | Cafe strip with the section jump-nav on
 * its inline-end side, then ONE filter row: period (custom dates only when
 * "custom" is chosen), the comparison basis, the court filter on the Courts
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
 */
import { useCallback, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BUSINESS_DAY_START_OPTIONS, RANGE_PRESETS, isIsoDate, type CompareBasis, type RangePreset } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { Button, ErrorText, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
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
  prev: 'analytics.deck.prev',
  '4w': 'analytics.deck.w4',
  '52w': 'analytics.deck.w52',
};

const HINT_KEY: Record<CompareBasis, MessageKey> = {
  prev: 'analytics.deck.compareHint.prev',
  '4w': 'analytics.deck.compareHint.w4',
  '52w': 'analytics.deck.compareHint.w52',
};

const bar: CSSProperties = {
  position: 'sticky',
  // <main> is the scroll container and carries paddingBlock --tp-sp-4; a
  // sticky offset is measured from the scrollport's CONTENT edge, so 0 would
  // park the stuck bar a full --tp-sp-4 below the top of the pane.
  insetBlockStart: 'calc(-1 * var(--tp-sp-4))',
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
  borderBlockEnd: '1px solid var(--tp-border)',
  marginInline: 'calc(-1 * var(--tp-sp-4))',
  paddingInline: 'var(--tp-sp-4)',
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
  deck,
  courts,
}: {
  tab: AnalyticsTab;
  search: AnalyticsSearch;
  setSearch: (next: Partial<AnalyticsSearch>) => void;
  zones: readonly ZoneDef[];
  compareBasis: CompareBasis;
  /** Absent while a tab has no data hook yet (nothing to put behind More). */
  deck?: BarDeck;
  /** Courts tab: the court filter's options. */
  courts?: readonly { id: string; label: string }[];
}) {
  const { tr } = useLocale();
  const setSetting = useSetCafeSetting();
  const [customFrom, setCustomFrom] = useState(search.from ?? '');
  const [customTo, setCustomTo] = useState(search.to ?? '');
  // "Custom" chosen but no valid pair applied yet: the inputs are shown and the
  // control reads Custom, while the URL still carries the previous preset.
  const [editingCustom, setEditingCustom] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreId = useId();
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const customValid = isIsoDate(customFrom) && isIsoDate(customTo) && customFrom <= customTo;
  const nonDefault = (deck ? Number(deck.startHour !== 4) : 0) + (deck?.cafe ? Number(deck.cafe.excludedIds.length > 0) : 0);

  return (
    <div style={bar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <AnalyticsTabs value={tab} />
        {zones.length > 0 && <ZoneNav zones={zones} />}
      </div>

      <div style={row}>
        <Group label={tr('ws.reports.filters.period')}>
          <SegmentedControl<RangePreset>
            aria-label={tr('ws.reports.filters.period')}
            value={editingCustom ? 'custom' : search.range}
            onChange={(preset) => {
              if (preset === 'custom') {
                if (customValid) setSearch({ range: 'custom', from: customFrom, to: customTo });
                else setEditingCustom(true);
                return;
              }
              setEditingCustom(false);
              setSearch({ range: preset, from: undefined, to: undefined });
            }}
            options={RANGE_PRESETS.map((preset) =>
              preset === 'custom'
                ? { value: preset, label: tr('analytics.deck.custom') }
                : { value: preset, label: tr(PRESET_KEY[preset as Exclude<RangePreset, 'custom'>]) },
            )}
          />
        </Group>

        {/* The date inputs used to take 300px of the row on every visit; they
            only exist while a custom period is being chosen or is in force. */}
        {(search.range === 'custom' || editingCustom) && (
          <Group label={`${tr('analytics.deck.from')} / ${tr('analytics.deck.to')}`}>
            <input type="date" style={small} value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} aria-label={tr('analytics.deck.from')} />
            <input type="date" style={small} value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} aria-label={tr('analytics.deck.to')} />
            <Button
              disabled={!customValid}
              onClick={() => {
                setEditingCustom(false);
                setSearch({ range: 'custom', from: customFrom, to: customTo });
              }}
              style={{ minBlockSize: 'var(--tp-row-h)', fontSize: 'var(--tp-fs-sm)' }}
            >
              {tr('analytics.deck.apply')}
            </Button>
          </Group>
        )}

        <Group label={tr('analytics.deck.compare')} tip={tr(HINT_KEY[compareBasis])}>
          <Select<CompareBasis>
            value={compareBasis}
            onChange={(cmp) => setSearch({ cmp })}
            options={(['prev', '4w', '52w'] as const).map((b) => ({ value: b, label: tr(BASIS_KEY[b]) }))}
            style={small}
            aria-label={tr('analytics.deck.compare')}
          />
        </Group>

        {courts && (
          <Group label={tr('ws.reports.filters.court')}>
            <Select<string>
              value={search.court ?? ''}
              onChange={(court) => setSearch({ court: court || undefined })}
              options={[{ value: '', label: tr('ws.reports.filters.allCourts') }, ...courts.map((c) => ({ value: c.id, label: c.label }))]}
              style={small}
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
                <Select<string>
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
