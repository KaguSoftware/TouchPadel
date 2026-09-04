/**
 * Category strip + item grid (spec CategoryGrid / MenuItemGrid / MenuItemTile).
 *
 * Tiles are var(--tp-tile-min-block) (72px) tall with 44px targets. Two visibly different disabled
 * looks, each with a text label (never colour alone):
 *   `unavailable`     staff-marked, temporary — dashed border, "set by staff"
 *   `blockedByStock`  stock-derived — solid muted ground, "Out of stock"
 * and a third inert look when no tab is active (tiles visible, not clickable).
 * Roving tabindex with arrow keys; Enter/Space adds; context menu opens the sheet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Kbd } from '../../components/kit';
import { Icon } from '../../components/icons';
import { moveInGrid } from './keymap';
import { quickVariant } from './quickAdd';
import { deriveTileState, tileInteractive, type TileState } from './tileState';
import type { CategoryRow, ItemRow } from './tillData';
import { muted, sectionTitle } from './tillStyles';

export function CategoryStrip({
  categories,
  activeId,
  filtering,
  onSelect,
}: {
  categories: readonly CategoryRow[];
  activeId: string | null;
  /** A text filter is active — no category is highlighted. */
  filtering: boolean;
  onSelect: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  return (
    // A venue with many categories must never squeeze the item grid to nothing:
    // the strip keeps at most three rows and scrolls, the grid keeps the rest.
    <div
      role="group"
      aria-label={tr('ws.cashier.till.categories')}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--tp-sp-1-5)',
        flexShrink: 0,
        maxBlockSize: '8.75rem',
        overflowY: 'auto',
      }}
    >
      {categories.map((c, i) => {
        const active = c.id === activeId && !filtering;
        return (
          <button
            key={c.id}
            type="button"
            className="tp-btn"
            data-kind={active ? 'primary' : 'default'}
            data-size="lg"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            style={{ minBlockSize: 'var(--tp-touch)', gap: 'var(--tp-sp-2)' }}
          >
            {i < 9 && <Kbd>{i + 1}</Kbd>}
            {pickName(locale, c)}
          </button>
        );
      })}
    </div>
  );
}

const TILE_LOOK: Record<TileState, React.CSSProperties> = {
  ready: { background: 'var(--tp-surface)', border: '1px solid var(--tp-border)' },
  noTab: { background: 'var(--tp-surface)', border: '1px solid var(--tp-border)', opacity: 0.6, cursor: 'not-allowed' },
  unavailable: {
    background: 'var(--tp-surface)',
    border: '1px dashed var(--tp-border-strong)',
    color: 'var(--tp-muted-fg)',
    cursor: 'not-allowed',
  },
  blockedByStock: {
    background: 'var(--tp-surface-3)',
    border: '1px solid var(--tp-border)',
    color: 'var(--tp-muted-fg)',
    cursor: 'not-allowed',
  },
};

export function MenuItemGrid({
  items,
  availability,
  hasActiveTab,
  today,
  onPick,
  onOpenSheet,
  emptyText,
}: {
  items: readonly ItemRow[];
  availability: Readonly<Record<string, boolean>>;
  hasActiveTab: boolean;
  today: string;
  onPick: (item: ItemRow) => void;
  onOpenSheet: (item: ItemRow) => void;
  emptyText: string;
}) {
  const { tr, locale, dir } = useLocale();
  const gridRef = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (focusIndex >= items.length) setFocusIndex(0);
  }, [items.length, focusIndex]);

  const columns = useCallback((): number => {
    const el = gridRef.current;
    if (!el) return 1;
    const tpl = getComputedStyle(el).gridTemplateColumns;
    const n = tpl ? tpl.split(' ').filter(Boolean).length : 1;
    return Math.max(1, n);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = moveInGrid(e.key, focusIndex, items.length, columns(), dir);
    if (next === null) return;
    e.preventDefault();
    setFocusIndex(next);
    refs.current[next]?.focus();
  }

  if (items.length === 0) {
    return <p style={{ ...muted, paddingBlock: 'var(--tp-sp-4)' }}>{emptyText}</p>;
  }

  return (
    <div
      ref={gridRef}
      role="group"
      aria-label={tr('ws.cashier.till.items')}
      onKeyDown={onKeyDown}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))',
        gap: 'var(--tp-sp-1-5)',
        alignContent: 'start',
      }}
    >
      {items.map((item, i) => {
        const state = deriveTileState({
          orderable: availability[item.id],
          soldOut: item.sold_out,
          unavailableOn: item.unavailable_on,
          hasActiveTab,
          today,
        });
        const interactive = tileInteractive(state);
        const defVariant = item.menu_item_variants.find((v) => v.is_default) ?? item.menu_item_variants[0];
        const quick = quickVariant(item) !== null;
        const hint =
          state === 'unavailable'
            ? tr('ws.cashier.till.tile.unavailableHint')
            : state === 'blockedByStock'
              ? tr('ws.cashier.till.tile.blockedByStockHint')
              : state === 'noTab'
                ? tr('ws.cashier.till.noActiveTabBody')
                : quick
                  ? tr('ws.cashier.till.tile.quick')
                  : tr('ws.cashier.till.tile.sheet');
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className="tp-tile"
            data-state={state}
            disabled={!interactive}
            tabIndex={i === focusIndex ? 0 : -1}
            title={hint}
            onFocus={() => setFocusIndex(i)}
            onClick={() => onPick(item)}
            // Right-click (or long-press on a touch till) still opens the
            // sheet for notes/qty on a quick-addable item.
            onContextMenu={(e) => {
              e.preventDefault();
              if (interactive) onOpenSheet(item);
            }}
            style={{
              display: 'grid',
              alignContent: 'space-between',
              gap: 'var(--tp-sp-1-5)',
              textAlign: 'start',
              // 72px, in px so it can never drift with the reading root — the
              // floor DESIGN.md names for a till tile.
              minBlockSize: 'var(--tp-tile-min-block)',
              paddingBlock: 'var(--tp-sp-2-5)',
              paddingInline: 'var(--tp-sp-2-5)',
              borderRadius: 'var(--tp-radius-panel)',
              color: 'var(--tp-fg)',
              font: 'inherit',
              ...TILE_LOOK[state],
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
              <bdi>{pickName(locale, item)}</bdi>
            </span>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 'var(--tp-sp-1-5)' }}>
              {defVariant && (
                <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>
                  {item.menu_item_variants.length > 1 && <span>{tr('ws.cashier.till.tile.from')} </span>}
                  <bdi>{formatIQD(defVariant.price_iqd, locale)}</bdi>
                </span>
              )}
              {state === 'unavailable' && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-warn-fg)' }}>
                  <Icon name="eyeOff" size={12} /> {tr('ws.cashier.till.tile.unavailable')}
                </span>
              )}
              {state === 'blockedByStock' && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-danger-fg)' }}>
                  <Icon name="package" size={12} /> {tr('ws.cashier.till.tile.blockedByStock')}
                </span>
              )}
              {state === 'ready' && !quick && <Icon name="more" size={14} style={{ color: 'var(--tp-muted-fg)' }} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Legend under the grid: the two disabled looks, named. */
export function TileLegend() {
  const { tr } = useLocale();
  const chip: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--tp-sp-1)',
    fontSize: 'var(--tp-fs-xs)',
    color: 'var(--tp-muted-fg)',
  };
  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-1-5)' }} aria-hidden="true">
      <span style={sectionTitle}>{tr('ws.cashier.till.items')}</span>
      <span style={chip}>
        <span style={{ inlineSize: 'var(--tp-sp-3)', blockSize: 'var(--tp-sp-3)', border: '1px dashed var(--tp-border-strong)', borderRadius: 'var(--tp-radius-sm)' }} />
        {tr('ws.cashier.till.tile.unavailable')}
      </span>
      <span style={chip}>
        <span style={{ inlineSize: 'var(--tp-sp-3)', blockSize: 'var(--tp-sp-3)', background: 'var(--tp-surface-3)', border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-sm)' }} />
        {tr('ws.cashier.till.tile.blockedByStock')}
      </span>
    </div>
  );
}
