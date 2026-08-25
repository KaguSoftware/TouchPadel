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
import { useLocale } from '../../lib/i18n';
import { useSetCafeSetting } from '../../lib/settings';
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
  zIndex: 20,
  background: 'var(--tp-bg)',
  borderBlockEnd: '1px solid var(--tp-border)',
  paddingBlock: '0.6rem',
  marginBlockEnd: '1rem',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  alignItems: 'flex-end',
};

const groupLabel: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--tp-muted-fg)',
  marginBlockEnd: '0.2rem',
};

const small: CSSProperties = { ...inputStyle, inlineSize: 'auto', fontSize: '0.85rem', paddingBlock: '0.3rem' };

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
        <span style={groupLabel}>{tr('analytics.title')}</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {RANGE_PRESETS.filter((p): p is Exclude<RangePreset, 'custom'> => p !== 'custom').map((preset) => (
            <Button
              key={preset}
              kind={search.range === preset ? 'primary' : 'default'}
              aria-pressed={search.range === preset}
              onClick={() => setSearch({ range: preset, from: undefined, to: undefined })}
              style={{ paddingBlock: '0.3rem', paddingInline: '0.6rem', fontSize: '0.85rem' }}
            >
              {tr(PRESET_KEY[preset])}
            </Button>
          ))}
          <Button
            kind={search.range === 'custom' ? 'primary' : 'default'}
            onClick={() => setSearch({ range: 'custom', from: customFrom, to: customTo })}
            disabled={search.range !== 'custom' && !customValid}
            style={{ paddingBlock: '0.3rem', paddingInline: '0.6rem', fontSize: '0.85rem' }}
          >
            {tr('analytics.deck.custom')}
          </Button>
        </div>
      </div>

      <div>
        <span style={groupLabel}>{tr('analytics.deck.from')} / {tr('analytics.deck.to')}</span>
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <input type="date" style={small} value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} aria-label={tr('analytics.deck.from')} />
          <input type="date" style={small} value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} aria-label={tr('analytics.deck.to')} />
          <Button
            disabled={!customValid}
            onClick={() => setSearch({ range: 'custom', from: customFrom, to: customTo })}
            style={{ paddingBlock: '0.3rem', paddingInline: '0.6rem', fontSize: '0.85rem' }}
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
        <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--tp-muted-fg)', maxInlineSize: '14rem' }}>
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
          options={[1, 1.5, 2, 2.5, 3, 4].map((n) => ({ value: String(n), label: `× ${n}` }))}
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
        {data.autoRefreshActive && (
          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--tp-accent)' }}>●</span>
        )}
      </div>

      <div>
        <span style={groupLabel}>&nbsp;</span>
        <Button onClick={() => setExcludedOpen(true)} style={{ paddingBlock: '0.3rem', fontSize: '0.85rem' }}>
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
