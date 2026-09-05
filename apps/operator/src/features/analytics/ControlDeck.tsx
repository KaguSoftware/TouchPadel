/**
 * Sticky control deck: range presets + custom dates, comparison basis, business
 * day start (owner setting), covers multiplier, auto-refresh and the exclusion
 * list — with the zone jump-nav on the inline-end side (operator-slice.md §5.1).
 *
 * The range/compare live in the URL (`AnalyticsSearch`); the covers multiplier
 * and the refresh interval are per-device preferences in localStorage; the
 * business-day hour and the exclusions are café-wide settings.
 */
import { useState, type CSSProperties } from 'react';
import { BUSINESS_DAY_START_OPTIONS, RANGE_PRESETS, isIsoDate, type CompareBasis, type RangePreset } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { Button, ErrorText, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { useLocale } from '../../lib/i18n';
import { useSetCafeSetting } from '../../lib/settings';
import { COVERS_MULTIPLIER_OPTIONS } from '../../lib/coversMultiplier';
import { ExcludedItemsModal } from './ExcludedItemsModal';
import { ZoneNav } from './ZoneNav';
import { REFRESH_OPTIONS, type AnalyticsData } from './useAnalyticsData';
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

const deck: CSSProperties = {
  position: 'sticky',
  insetBlockStart: 0,
  // A sticky in-content toolbar, which is what --tp-z-table-head names. The
  // literal 20 it carried is the navigation rail's own layer, so the deck and
  // the primary navigation were claiming the same plane.
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
  borderBlockEnd: '1px solid var(--tp-border)',
  paddingBlock: 'var(--tp-sp-2-5)',
  marginBlockEnd: 'var(--tp-sp-4)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--tp-sp-3)',
  alignItems: 'flex-end',
};

// 12px all-caps with tracking is the worst case for reading at arm's length in
// a bright room (11.7); weight and colour carry the label instead, matching the
// table headers and description lists everywhere else in the operator.
const groupLabel: CSSProperties = {
  display: 'block',
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  color: 'var(--tp-muted-fg)',
  marginBlockEnd: 'var(--tp-sp-1)',
};

const small: CSSProperties = { ...inputStyle, inlineSize: 'auto', fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1-5)' };

export function ControlDeck({
  search,
  setSearch,
  data,
  menu,
}: {
  search: AnalyticsSearch;
  setSearch: (next: Partial<AnalyticsSearch>) => void;
  data: AnalyticsData;
  menu: readonly MenuSnapshotRow[];
}) {
  const { tr } = useLocale();
  const setSetting = useSetCafeSetting();
  const [customFrom, setCustomFrom] = useState(search.from ?? data.range.from);
  const [customTo, setCustomTo] = useState(search.to ?? data.range.to);
  const [excludedOpen, setExcludedOpen] = useState(false);

  const customValid = isIsoDate(customFrom) && isIsoDate(customTo) && customFrom <= customTo;

  return (
    <div style={deck}>
      <div>
        {/* This group used to be labelled with the page's own name, which is now
            the h1 above the deck. */}
        <span style={groupLabel}>{tr('ws.reports.filters.period')}</span>
        {/* Five mutually exclusive choices are a SegmentedControl everywhere else
            in this app; a row of buttons each flipping to kind="primary" when
            chosen was a fourth "pick one of N" vocabulary, and it spent the
            accent reserved for a screen's single primary action five times over.
            Accessible names and aria-pressed are unchanged — SegmentedControl
            renders buttons too. */}
        <SegmentedControl<RangePreset>
          aria-label={tr('ws.reports.filters.period')}
          size="sm"
          value={search.range}
          onChange={(preset) =>
            preset === 'custom'
              ? setSearch({ range: 'custom', from: customFrom, to: customTo })
              : setSearch({ range: preset, from: undefined, to: undefined })
          }
          options={RANGE_PRESETS.map((preset) =>
            preset === 'custom'
              ? { value: preset, label: tr('analytics.deck.custom'), disabled: search.range !== 'custom' && !customValid }
              : { value: preset, label: tr(PRESET_KEY[preset as Exclude<RangePreset, 'custom'>]) },
          )}
        />
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.from')} / {tr('analytics.deck.to')}</span>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
          <input type="date" style={small} value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} aria-label={tr('analytics.deck.from')} />
          <input type="date" style={small} value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} aria-label={tr('analytics.deck.to')} />
          <Button
            disabled={!customValid}
            onClick={() => setSearch({ range: 'custom', from: customFrom, to: customTo })}
            style={{ paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-sm)' }}
          >
            {tr('analytics.deck.apply')}
          </Button>
        </div>
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.compare')}</span>
        <Select<CompareBasis>
          value={data.compareBasis}
          onChange={(cmp) => setSearch({ cmp })}
          options={(['prev', '4w', '52w'] as const).map((b) => ({ value: b, label: tr(BASIS_KEY[b]) }))}
          style={small}
        />
        <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '14rem' }}>
          {tr(HINT_KEY[data.compareBasis])}
        </span>
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.businessDay')}</span>
        <Select<string>
          value={String(data.startHour)}
          onChange={(hour) => setSetting.mutate({ key: 'analytics_business_day_start_hour', value: Number(hour) })}
          options={BUSINESS_DAY_START_OPTIONS.map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
          disabled={setSetting.isPending}
          style={small}
        />
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.covers')}</span>
        <Select<string>
          value={String(data.coversMultiplier)}
          onChange={(v) => data.setCoversMultiplier(Number(v))}
          options={COVERS_MULTIPLIER_OPTIONS.map((n) => ({ value: String(n), label: `× ${n}` }))}
          style={small}
        />
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.refresh')}</span>
        <Select<string>
          value={String(data.refreshMinutes)}
          onChange={(v) => data.setRefreshMinutes(Number(v))}
          options={REFRESH_OPTIONS.map((n) => ({
            value: String(n),
            label: n === 0 ? tr('analytics.deck.refreshOff') : tr('analytics.deck.min', { n }),
          }))}
          disabled={!data.live}
          style={small}
        />
        {/* Decorative reinforcement of the interval in the Select beside it, so
            it is hidden from assistive tech rather than left as a colour-only
            signal with no name (13). */}
        {data.autoRefreshActive && (
          <span aria-hidden="true" style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-accent)' }}>●</span>
        )}
      </div>

      <div>
        <span style={groupLabel}>&nbsp;</span>
        <Button onClick={() => setExcludedOpen(true)} style={{ paddingBlock: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('analytics.deck.excluded')}
          {data.excludedIds.length > 0 ? ` (${data.excludedIds.length})` : ''}
        </Button>
      </div>

      <div style={{ marginInlineStart: 'auto' }}>
        <span style={groupLabel}>{tr('analytics.deck.jumpTo')}</span>
        <ZoneNav />
      </div>

      <ErrorText error={setSetting.error} />

      {excludedOpen && (
        <ExcludedItemsModal menu={menu} excludedIds={data.excludedIds} onClose={() => setExcludedOpen(false)} />
      )}
    </div>
  );
}
