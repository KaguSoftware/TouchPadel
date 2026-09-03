/**
 * COGS + gross margin per menu item (SOW L538-540) — v_item_margin, costed
 * from the latest batch (pack cost fallback). Low/negative margins surface
 * first; a menu that quietly loses money per sale is what this page catches.
 */
import { useQuery } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { card } from '../../components/ui';
import { SK } from './stockKeys';

interface MarginRow {
  variant_id: string;
  item_name_en: string;
  item_name_ar: string;
  variant_name_en: string;
  variant_name_ar: string;
  price_iqd: number;
  cogs_iqd: number;
  margin_iqd: number;
  margin_percent: number | null;
}

export function Margins() {
  const { tr, locale } = useLocale();

  const marginsQ = useQuery({
    queryKey: SK.margins,
    queryFn: async (): Promise<MarginRow[]> => {
      const { data, error } = await supabase
        .from('v_item_margin')
        .select('*')
        .order('margin_percent', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as MarginRow[];
    },
  });
  const rows = marginsQ.data ?? [];

  return (
    <div style={{ maxInlineSize: '46rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.marginsTitle')}</h2>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>
        {tr('op.stock.marginsHint')}
      </p>
      <div style={card}>
        <table style={{ inlineSize: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ color: 'var(--tp-muted-fg)' }}>
              <th style={{ textAlign: 'start' }}>{tr('op.stock.item')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.price')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.cogs')}</th>
              <th style={{ textAlign: 'end' }}>{tr('op.stock.margin')}</th>
              <th style={{ textAlign: 'end' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.margin_iqd < 0;
              const thin = !bad && (r.margin_percent ?? 100) < 30;
              return (
                <tr key={r.variant_id} style={{ borderBlockStart: '1px solid var(--tp-border)' }}>
                  <td style={{ paddingBlock: '0.3rem' }}>
                    {pickName(locale, { name_en: r.item_name_en, name_ar: r.item_name_ar })}{' '}
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
                      ({pickName(locale, { name_en: r.variant_name_en, name_ar: r.variant_name_ar })})
                    </span>
                  </td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                    {formatIQD(r.price_iqd, locale)}
                  </td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                    {formatIQD(r.cogs_iqd, locale)}
                  </td>
                  <td
                    style={{
                      textAlign: 'end',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      color: bad ? 'var(--tp-danger)' : thin ? 'var(--tp-accent-2)' : 'inherit',
                    }}
                  >
                    {formatIQD(r.margin_iqd, locale)}
                  </td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                    {r.margin_percent ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {marginsQ.isSuccess && rows.length === 0 && (
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.stock.noRecipes')}</p>
        )}
      </div>
    </div>
  );
}
