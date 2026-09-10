/**
 * Financial home (/financial) — the landing screen of Management's Financial
 * section.
 *
 * The section answers one question in three tenses: what came in (revenue and
 * its two sources), whether the cash agrees (drawer, day close), and what the
 * prices will produce next (rates, menu, stock value). The cards follow that
 * order rather than alphabetical or by screen type.
 *
 * The band above them is the month so far, read straight from `panel_headline`
 * — the same RPC the management panel uses, at the same period, so the two
 * screens can never state different revenue for the same month. It is a
 * READING, not a summary the owner is meant to act on here: every figure is a
 * link into the panel, which is where comparison and drill-through live.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { SectionHome } from '../../components/SectionHome';
import { Button, Skeleton } from '../../components/ui';
import { Panel, presetPeriod } from '../../components/kit';
import { figuresIn, mapFigures, type PanelHeadline } from '../panel/figures';

type CardKey =
  | 'revenue'
  | 'courtIncome'
  | 'cafeSales'
  | 'cashDrawer'
  | 'dayClose'
  | 'rates'
  | 'menuPrices'
  | 'stockValue';

export function FinancialHomeScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const period = useMemo(() => presetPeriod('thisMonth'), []);

  const headlineQ = useQuery({
    queryKey: ['financial', 'headline', period.from, period.to],
    queryFn: () =>
      appRpc<PanelHeadline>('panel_headline', {
        p_from: period.from,
        p_to: period.to,
        p_compare: 'none',
      }),
    refetchInterval: 60_000,
  });
  const figures = useMemo(() => mapFigures(headlineQ.data), [headlineQ.data]);

  return (
    <SectionHome
      sectionKey="financial"
      title={tr('ws.owner.financialHome.title')}
      lead={tr('ws.owner.financialHome.lead')}
      card={(key) => tr(`ws.owner.financialHome.cards.${key as CardKey}`)}
    >
      <Panel
        title={tr('ws.owner.financialHome.headline.title')}
        actions={
          <Button
            size="sm"
            kind="ghost"
            iconEnd="arrowUpRight"
            onClick={() => void navigate({ to: '/panel' })}
          >
            {tr('ws.owner.financialHome.headline.openPanel')}
          </Button>
        }
      >
        {headlineQ.isPending ? (
          <Skeleton lines={1} blockSize="1.6rem" />
        ) : (
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
              gap: 'var(--tp-sp-4)',
              margin: 0,
            }}
          >
            {figuresIn('headline').map((meta) => {
              const f = figures.get(meta.key);
              return (
                <div key={meta.key} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  <dt
                    style={{
                      fontSize: 'var(--tp-fs-sm)',
                      color: 'var(--tp-muted-fg)',
                      fontWeight: 600,
                    }}
                  >
                    {tr(`ws.owner.panel.figures.${meta.key}`)}
                  </dt>
                  <dd
                    dir="ltr"
                    style={{
                      margin: 0,
                      fontSize: 'var(--tp-fs-xl)',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      fontFamily: 'var(--tp-font-numeric)',
                    }}
                  >
                    {/* Nothing estimated: a figure the server did not send reads
                        as absent, never as zero. */}
                    {f?.value == null ? '—' : formatIQD(f.value, locale)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </Panel>
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}
