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
import {
  BUSINESS_DAY_START_OPTIONS,
  RANGE_PRESETS,
  isIsoDate,
  type CompareBasis,
  type RangePreset,
} from '@touch/core';
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
  /*
   * NOT 0. <main> is the scroll container and it carries paddingBlock:
   * --tp-sp-4; a sticky child's offset is measured from the scrollport's
   * CONTENT edge, so `inset-block-start: 0` parked the stuck deck a full
   * --tp-sp-4 below the top of the pane with the grid scrolling visibly
   * through the strip above it. Cancelling that padding puts the deck flush
   * against the top of the pane. Unstuck it changes nothing: a sticky offset
   * only applies once the element is actually stuck.
   */
  insetBlockStart: 'calc(-1 * var(--tp-sp-4))',
  // A sticky in-content toolbar, which is what --tp-z-table-head names. The
  // literal 20 it carried is the navigation rail's own layer, so the deck and
  // the primary navigation were claiming the same plane.
  zIndex: 'var(--tp-z-table-head)',
  background: 'var(--tp-bg)',
  borderBlockEnd: '1px solid var(--tp-border)',
  // Bleed back over the page's own inline padding and re-add it inside, so the
  // stuck bar and its rule span the full pane instead of floating as a slab
  // with cards sliding past down both sides.
  marginInline: 'calc(-1 * var(--tp-sp-4))',
  paddingInline: 'var(--tp-sp-4)',
  paddingBlock: 'var(--tp-sp-2-5)',
  marginBlockEnd: 'var(--tp-sp-4)',
  display: 'grid',
  gap: 'var(--tp-sp-2)',
};

/**
 * The controls themselves. Every group below is label-over-control with a
 * fixed control band, so this can align on `flex-start` and have every label
 * land on one line and every control on another. It could not before: groups
 * were bare divs of whatever height their contents came to (the compare group
 * carried a three-line hint, the refresh group a live dot, the period group a
 * 28px segmented control against 40px selects), and `flex-end` then staggered
 * every label by the difference.
 */
const row: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: 'var(--tp-sp-3)',
  rowGap: 'var(--tp-sp-2-5)',
};

// 12px all-caps with tracking is the worst case for reading at arm's length in
// a bright room (11.7); weight and colour carry the label instead, matching the
// table headers and description lists everywhere else in the operator.
const groupLabel: CSSProperties = {
  display: 'block',
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  color: 'var(--tp-muted-fg)',
};

/** The one control band every group's control is centred in. */
const band: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-1)',
  minBlockSize: 'var(--tp-row-h)',
};

const small: CSSProperties = {
  ...inputStyle,
  inlineSize: 'auto',
  fontSize: 'var(--tp-fs-sm)',
  paddingBlock: 'var(--tp-sp-1-5)',
};
/** Buttons default to 2.25rem; the selects beside them stand on --tp-row-h. */
const deckButton: CSSProperties = { minBlockSize: 'var(--tp-row-h)', fontSize: 'var(--tp-fs-sm)' };

/**
 * One labelled control group. `label` is omitted only for the exclusions
 * button, which names itself — the empty line is still rendered so the group
 * keeps the same two-row height as its neighbours and stays on the grid.
 */
function DeckGroup({
  label,
  children,
  style,
}: {
  label?: string;
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', alignContent: 'start', ...style }}>
      <span style={groupLabel} aria-hidden={label === undefined || undefined}>
        {label ?? '\u00a0'}
      </span>
      <div style={band}>{children}</div>
    </div>
  );
}

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
      <div style={row}>
        {/* This group used to be labelled with the page's own name, which is now
            the h1 above the deck. */}
        <DeckGroup label={tr('ws.reports.filters.period')}>
          {/* Five mutually exclusive choices are a SegmentedControl everywhere else
              in this app; a row of buttons each flipping to kind="primary" when
              chosen was a fourth "pick one of N" vocabulary, and it spent the
              accent reserved for a screen's single primary action five times over.
              Accessible names and aria-pressed are unchanged — SegmentedControl
              renders buttons too. `md`, not `sm`: at `sm` this stood 28px against
              the 40px selects beside it and read as a different class of thing. */}
          <SegmentedControl<RangePreset>
            aria-label={tr('ws.reports.filters.period')}
            value={search.range}
            onChange={(preset) =>
              preset === 'custom'
                ? setSearch({ range: 'custom', from: customFrom, to: customTo })
                : setSearch({ range: preset, from: undefined, to: undefined })
            }
            options={RANGE_PRESETS.map((preset) =>
              preset === 'custom'
                ? {
                    value: preset,
                    label: tr('analytics.deck.custom'),
                    disabled: search.range !== 'custom' && !customValid,
                  }
                : {
                    value: preset,
                    label: tr(PRESET_KEY[preset as Exclude<RangePreset, 'custom'>]),
                  },
            )}
          />
        </DeckGroup>

        <DeckGroup label={`${tr('analytics.deck.from')} / ${tr('analytics.deck.to')}`}>
          <input
            type="date"
            style={small}
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label={tr('analytics.deck.from')}
          />
          <input
            type="date"
            style={small}
            value={customTo}
            min={customFrom}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label={tr('analytics.deck.to')}
          />
          <Button
            disabled={!customValid}
            onClick={() => setSearch({ range: 'custom', from: customFrom, to: customTo })}
            style={deckButton}
          >
            {tr('analytics.deck.apply')}
          </Button>
        </DeckGroup>

        <DeckGroup label={tr('analytics.deck.compare')}>
          {/* The basis hint used to hang under this select, making the group
              three lines taller than every other one and knocking the whole
              deck out of alignment. It is one line under the controls now. */}
          <Select<CompareBasis>
            value={data.compareBasis}
            onChange={(cmp) => setSearch({ cmp })}
            options={(['prev', '4w', '52w'] as const).map((b) => ({
              value: b,
              label: tr(BASIS_KEY[b]),
            }))}
            style={small}
          />
        </DeckGroup>

        <DeckGroup label={tr('analytics.deck.businessDay')}>
          <Select<string>
            value={String(data.startHour)}
            onChange={(hour) =>
              setSetting.mutate({ key: 'analytics_business_day_start_hour', value: Number(hour) })
            }
            options={BUSINESS_DAY_START_OPTIONS.map((h) => ({
              value: String(h),
              label: `${String(h).padStart(2, '0')}:00`,
            }))}
            disabled={setSetting.isPending}
            style={small}
          />
        </DeckGroup>

        <DeckGroup label={tr('analytics.deck.covers')}>
          <Select<string>
            value={String(data.coversMultiplier)}
            onChange={(v) => data.setCoversMultiplier(Number(v))}
            options={COVERS_MULTIPLIER_OPTIONS.map((n) => ({ value: String(n), label: `× ${n}` }))}
            style={small}
          />
        </DeckGroup>

        <DeckGroup label={tr('analytics.deck.refresh')}>
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
        </DeckGroup>

        {/* The exclusions button names itself; DeckGroup still renders the empty
            label line so it keeps the deck's two-row rhythm. */}
        <DeckGroup>
          <Button onClick={() => setExcludedOpen(true)} style={deckButton}>
            {tr('analytics.deck.excluded')}
            {data.excludedIds.length > 0 ? ` (${data.excludedIds.length})` : ''}
          </Button>
        </DeckGroup>

        <DeckGroup label={tr('analytics.deck.jumpTo')} style={{ marginInlineStart: 'auto' }}>
          <ZoneNav />
        </DeckGroup>
      </div>

      {/*
        Everything that used to hang under an individual control and stagger the
        row. One muted line, below the controls, always exactly one line tall.
      */}
      <p
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 'var(--tp-sp-3)',
          rowGap: 'var(--tp-sp-1)',
          fontSize: 'var(--tp-fs-xs)',
          color: 'var(--tp-muted-fg)',
        }}
      >
        <span>{tr(HINT_KEY[data.compareBasis])}</span>
        {data.autoRefreshActive && (
          <span style={{ color: 'var(--tp-accent)' }}>
            {/* Was a bare aria-hidden bullet: a colour-only signal with no name.
                It says what it means now, so it is not hidden any more. */}
            <span aria-hidden="true">● </span>
            {tr('analytics.deck.refresh')} · {tr('analytics.deck.min', { n: data.refreshMinutes })}
          </span>
        )}
      </p>

      <ErrorText error={setSetting.error} />

      {excludedOpen && (
        <ExcludedItemsModal
          menu={menu}
          excludedIds={data.excludedIds}
          onClose={() => setExcludedOpen(false)}
        />
      )}
    </div>
  );
}
