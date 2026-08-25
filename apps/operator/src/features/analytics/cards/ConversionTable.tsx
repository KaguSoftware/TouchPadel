/**
 * Item conversion table: views (QR menu) → basket → sold (till).
 *
 * The two halves come from DIFFERENT populations — a guest who never scanned
 * still shows up in "sold" — so the card states that in `howToRead` and marks
 * rows with sales but no views rather than printing an impossible ratio.
 * Sortable, searchable, CSV-exportable, collapsed to 15 rows.
 */
import { useMemo, useState } from 'react';
import { pickLocale, type ItemConversion } from '@touch/core';
import { Button, inputStyle } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';
import { downloadCsv, toCsv } from '../csv';
import type { Formatters } from '../format';
import { CardShell, Chip, type CardState } from './CardShell';

type SortKey = 'name' | 'views' | 'carts' | 'sold' | 'conv';
const COLLAPSED = 15;

const th: React.CSSProperties = {
  textAlign: 'start',
  fontSize: '0.75rem',
  color: 'var(--tp-muted-fg)',
  fontWeight: 600,
  paddingBlock: '0.25rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { fontSize: '0.82rem', paddingBlock: '0.22rem', borderBlockStart: '1px solid var(--tp-border)' };

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

  function head(key: SortKey, label: string) {
    return (
      <th
        scope="col"
        style={th}
        onClick={() => {
          if (sort === key) setAsc((v) => !v);
          else {
            setSort(key);
            setAsc(key === 'name');
          }
        }}
        aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {sort === key ? (asc ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

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
          <input
            style={{ ...inputStyle, inlineSize: '10rem', fontSize: '0.8rem', paddingBlock: '0.25rem' }}
            placeholder={tr('analytics.conversion.searchItems')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={tr('analytics.conversion.searchItems')}
          />
          <Button
            onClick={() => {
              setSort('sold');
              setAsc(true);
            }}
            style={{ fontSize: '0.8rem', paddingBlock: '0.25rem' }}
          >
            {tr('analytics.conversion.leastSold')}
          </Button>
          <Button onClick={exportCsv} style={{ fontSize: '0.8rem', paddingBlock: '0.25rem' }}>
            {tr('analytics.conversion.csv')}
          </Button>
        </>
      }
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {head('name', tr('analytics.conversion.item'))}
              {head('views', tr('analytics.conversion.views'))}
              {head('carts', tr('analytics.conversion.carts'))}
              {head('sold', tr('analytics.conversion.sold'))}
              {head('conv', tr('analytics.conversion.conv'))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.name}</td>
                <td style={td}>{r.views === 0 ? <Chip tone="warn">{tr('analytics.conversion.noViews')}</Chip> : f.num(r.views)}</td>
                <td style={td}>{f.num(r.carts)}</td>
                <td style={td}>{f.num(r.sold)}</td>
                <td style={td}>
                  {r.views === 0 && r.sold > 0 ? (
                    <Chip tone="warn">{tr('analytics.conversion.soldWithoutView')}</Chip>
                  ) : (
                    f.pct(r.convPct)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > COLLAPSED && (
        <Button kind="ghost" onClick={() => setExpanded((v) => !v)} style={{ fontSize: '0.8rem', marginBlockStart: '0.4rem' }}>
          {expanded ? tr('analytics.conversion.showLess') : tr('analytics.conversion.showAll')}
        </Button>
      )}
    </CardShell>
  );
}
