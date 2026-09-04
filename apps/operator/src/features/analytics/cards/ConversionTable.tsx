/**
 * Item conversion table: views (QR menu) → basket → sold (till).
 *
 * The two halves come from DIFFERENT populations — a guest who never scanned
 * still shows up in "sold" — so the card states that in `howToRead` and marks
 * rows with sales but no views rather than printing an impossible ratio.
 * Sortable, searchable, CSV-exportable, collapsed to 15 rows.
 *
 * This was a hand-rolled <table> with `<th onClick>` headers — no button, no
 * tabindex, no focus ring, so on the one screen an owner reads at a laptop the
 * sort could not be reached from the keyboard at all — literal ▲/▼ glyphs where
 * the rest of the app uses the chevron icon, and every figure start-aligned
 * beside the item names. It is DataTable now, which owns all three.
 */
import { useMemo, useState } from 'react';
import { pickLocale, type ItemConversion } from '@touch/core';
import { Button } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';
import { DataTable, ResultCount, SearchField, StatusBadge, type Column } from '../../../components/kit';
import { downloadCsv, toCsv } from '../csv';
import type { Formatters } from '../format';
import { CardShell, type CardState } from './CardShell';

type SortKey = 'name' | 'views' | 'carts' | 'sold' | 'conv';
const COLLAPSED = 15;


export function ConversionTable({
  rows,
  state,
  f,
  rangeLabel,
}: {
  rows: readonly ItemConversion[];
  state: CardState;
  f: Formatters;
  rangeLabel: string;
}) {
  const { tr, locale } = useLocale();
  const [sort, setSort] = useState<SortKey>('views');
  const [asc, setAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const named = useMemo(
    () => rows.map((r) => ({ ...r, name: pickLocale({ en: r.nameEn, ar: r.nameAr }, locale) || r.id })),
    [rows, locale],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle === '' ? named : named.filter((r) => r.name.toLowerCase().includes(needle));
    const dir = asc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name) * dir;
      const pick = (r: typeof a) => (sort === 'views' ? r.views : sort === 'carts' ? r.carts : sort === 'sold' ? r.sold : r.convPct);
      return (pick(a) - pick(b)) * dir;
    });
  }, [named, search, sort, asc]);

  const shown = expanded ? filtered : filtered.slice(0, COLLAPSED);

  type Row = (typeof named)[number];
  const columns: Column<Row>[] = [
    { key: 'name', header: tr('analytics.conversion.item'), sortable: true, truncate: true, truncateTitle: (r) => r.name },
    {
      key: 'views',
      header: tr('analytics.conversion.views'),
      sortable: true,
      numeric: true,
      render: (r) => (r.views === 0 ? <StatusBadge size="sm" tone="warn" label={tr('analytics.conversion.noViews')} /> : f.num(r.views)),
    },
    { key: 'carts', header: tr('analytics.conversion.carts'), sortable: true, numeric: true, render: (r) => f.num(r.carts) },
    { key: 'sold', header: tr('analytics.conversion.sold'), sortable: true, numeric: true, render: (r) => f.num(r.sold) },
    {
      key: 'conv',
      header: tr('analytics.conversion.conv'),
      sortable: true,
      numeric: true,
      // Two different populations: a guest who never scanned still lands in
      // "sold", so a ratio here would be arithmetic on incompatible counts.
      render: (r) => (r.views === 0 && r.sold > 0 ? <StatusBadge size="sm" tone="warn" label={tr('analytics.conversion.soldWithoutView')} /> : f.pct(r.convPct)),
    },
  ];


  function exportCsv() {
    const csv = toCsv(
      [
        tr('analytics.conversion.item'),
        tr('analytics.conversion.views'),
        tr('analytics.conversion.carts'),
        tr('analytics.conversion.sold'),
        tr('analytics.conversion.conv'),
      ],
      filtered.map((r) => [r.name, r.views, r.carts, r.sold, Math.round(r.convPct)]),
    );
    downloadCsv(`conversion-${rangeLabel}.csv`, csv);
  }

  return (
    <CardShell
      title={tr('analytics.conversion.title')}
      state={state === 'ready' && rows.length === 0 ? 'empty' : state}
      emptyKey="analytics.empty.conversion"
      note={tr('analytics.conversion.howToRead')}
      actions={
        <>
          {/* One search control in the app, not a bare input per card. */}
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={tr('analytics.conversion.searchItems')}
            aria-label={tr('analytics.conversion.searchItems')}
            style={{ inlineSize: '12rem' }}
          />
          <Button
            size="sm"
            onClick={() => {
              setSort('sold');
              setAsc(true);
            }}
          >
            {tr('analytics.conversion.leastSold')}
          </Button>
          <Button size="sm" icon="fileText" onClick={exportCsv}>
            {tr('analytics.conversion.csv')}
          </Button>
        </>
      }
    >
      <DataTable
        aria-label={tr('analytics.conversion.title')}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        dense
        sort={{ key: sort, dir: asc ? 'asc' : 'desc' }}
        // DataTable proposes a direction; this card keeps its own rule, because
        // "sort by views" means the most-viewed first and only "sort by name"
        // means A to Z. Nothing here decides what a figure is, only its order.
        onSort={(next) => {
          if (next.key === sort) {
            setAsc((v) => !v);
            return;
          }
          setSort(next.key as SortKey);
          setAsc(next.key === 'name');
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-2)' }}>
        <ResultCount shown={shown.length} total={named.length} />
        {filtered.length > COLLAPSED && (
          <Button kind="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? tr('analytics.conversion.showLess') : tr('analytics.conversion.showAll')}
          </Button>
        )}
      </div>
    </CardShell>
  );
}
