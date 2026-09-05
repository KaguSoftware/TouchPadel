/**
 * Paired EN/AR ticker rows: add / remove / reorder (SortButtons), max 12 rows
 * of 120 chars (ticker.ts). The parent owns the rows; this is a pure editor.
 */
import { useLocale } from '../../../lib/i18n';
import { Button, inputStyle } from '../../../components/ui';
import { SortButtons } from '../../../components/inputs';
import { TICKER_MAX_LEN, TICKER_MAX_ROWS, type TickerRow } from './ticker';

export function TickerEditor({
  rows,
  onChange,
}: {
  rows: readonly TickerRow[];
  onChange: (next: TickerRow[]) => void;
}) {
  const { tr } = useLocale();
  const full = rows.length >= TICKER_MAX_ROWS;

  function update(i: number, patch: Partial<TickerRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function swap(i: number, j: number) {
    const next = [...rows];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    onChange(next);
  }

  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto auto',
            gap: 'var(--tp-sp-1-5)',
            alignItems: 'center',
            marginBlockEnd: 'var(--tp-sp-1-5)',
          }}
        >
          <input
            style={inputStyle}
            dir="ltr"
            aria-label={tr('op.hero.phraseEn')}
            placeholder={tr('op.hero.phraseEn')}
            maxLength={TICKER_MAX_LEN}
            value={row.en}
            onChange={(e) => update(i, { en: e.target.value })}
          />
          <input
            style={inputStyle}
            dir="rtl"
            lang="ar"
            aria-label={tr('op.hero.phraseAr')}
            placeholder={tr('op.hero.phraseAr')}
            maxLength={TICKER_MAX_LEN}
            value={row.ar}
            onChange={(e) => update(i, { ar: e.target.value })}
          />
          <SortButtons
            onUp={() => swap(i, i - 1)}
            onDown={() => swap(i, i + 1)}
            disabledUp={i === 0}
            disabledDown={i === rows.length - 1}
          />
          <Button
            kind="ghost"
            onClick={() => remove(i)}
            aria-label={tr('op.common.remove')}
            title={tr('op.common.remove')}
          >
            ✕
          </Button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2-5)' }}>
        <Button disabled={full} onClick={() => onChange([...rows, { en: '', ar: '' }])}>
          {tr('op.hero.addPhrase')}
        </Button>
        {full && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('op.hero.tickerFull', { max: TICKER_MAX_ROWS })}
          </span>
        )}
      </div>
    </div>
  );
}
