/**
 * The supplier price watch on the Products screen (0322): the "Supplier price
 * changes" panel, the row marker, and the size form's supplier link with what
 * the shop desk PC last read from it. The rules are in priceWatchLogic.ts.
 */
import { formatDateTime, formatIQD } from '@touch/i18n';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, Field, inputStyle } from '../../../components/ui';
import { Money, Panel, StatusBadge } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { PriceChangeButton } from '../../admin/promotions/PriceChangeStart';
import type { ProductLine } from '../../stock/products/productsLogic';
import type { PriceAlert, PriceWatchRow, ReadError, SupplierUrlProblem } from './priceWatchLogic';

/**
 * Every size whose supplier price is not its selling price. "Apply new price"
 * opens the size's own form with the supplier's price filled in; a size whose
 * price the caller cannot change (a manager, a product on sale) offers the
 * price change protocol instead, as the row does.
 */
export function SupplierPriceAlerts({
  alerts,
  priceLocked,
  onApply,
}: {
  alerts: readonly PriceAlert<ProductLine>[];
  priceLocked: (line: ProductLine) => boolean;
  onApply: (alert: PriceAlert<ProductLine>) => void;
}) {
  const { tr, locale } = useLocale();
  if (alerts.length === 0) return null;
  return (
    <Panel title={tr('ws.shop.priceWatch.panelTitle')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} data-testid="supplier-price-alerts">
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.shop.priceWatch.panelLead')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {alerts.map((a, i) => {
          const name = `${pickName(locale, a.line.product)} · ${pickName(locale, a.line.variant)}`;
          const when = a.watch.price_changed_at ?? a.watch.read_ok_at;
          const locked = priceLocked(a.line);
          return (
            <li
              key={a.line.variant.id}
              data-testid={`supplier-price-alert-${a.line.variant.id}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                paddingBlock: 'var(--tp-sp-1-5)',
                // A line between rows, not under the last one (the panel ends there).
                borderBlockEnd: i < alerts.length - 1 ? '1px solid var(--tp-border)' : undefined,
              }}
            >
              <span style={{ flex: '1 1 14rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <strong>
                  <bdi>{name}</bdi>
                </strong>
                {when && (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
                    {tr(a.watch.price_changed_at ? 'ws.shop.priceWatch.changedAt' : 'ws.shop.priceWatch.readAt', { time: formatDateTime(new Date(when), locale) })}
                  </span>
                )}
                {/* The latest read failed: the price below is the last one the
                    page confirmed. Apply stays, the person judges. */}
                {a.watch.last_error && a.watch.checked_at && (
                  <span style={{ color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-xs)' }} data-testid={`supplier-price-alert-failed-${a.line.variant.id}`}>
                    {tr('ws.shop.priceWatch.status.failed', {
                      time: formatDateTime(new Date(a.watch.checked_at), locale),
                      error: tr(`ws.shop.priceWatch.readError.${a.watch.last_error}` as const),
                    })}
                  </span>
                )}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.shop.priceWatch.shopPrice')}</span>
                <Money amount={a.line.variant.price_iqd} />
                {/* Points the reading way in either script. */}
                <Icon name="arrowEnd" size={13} style={{ color: 'var(--tp-muted-fg)', alignSelf: 'center' }} />
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.shop.priceWatch.supplierPrice')}</span>
                <Money amount={a.supplierPriceIqd} strong />
              </span>
              {locked ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.shop.priceWatch.lockedNote')}</span>
                  <PriceChangeButton
                    size="sm"
                    target={{ change: 'price', item: a.line.productId }}
                    label={tr('ws.pricing.changePrice')}
                    ariaLabel={tr('ws.pricing.changePriceFor', { name })}
                  />
                </span>
              ) : (
                <Button size="sm" kind="primary" icon="check" aria-label={tr('ws.shop.priceWatch.applyFor', { name })} onClick={() => onApply(a)}>
                  {tr('ws.shop.priceWatch.apply')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** "Supplier price: 30,000 IQD" beside a product whose supplier price is not its own. */
export function SupplierPriceMarker({ priceIqd }: { priceIqd: number }) {
  const { tr, locale } = useLocale();
  return <StatusBadge size="sm" tone="warn" label={tr('ws.shop.priceWatch.marker', { price: formatIQD(priceIqd, locale) })} />;
}

/**
 * "Supplier link not read" beside a size whose last read failed, so a link
 * that never reads (a homepage, a page priced per colour) is seen on the list,
 * not only inside the size's form. The reason is its tooltip; the row opens
 * the form, where WatchStatus says it in full.
 */
export function SupplierLinkNotRead({ error }: { error: ReadError }) {
  const { tr } = useLocale();
  const reason = tr(`ws.shop.priceWatch.readError.${error}` as const);
  return (
    <span style={{ display: 'inline-flex' }}>
      <StatusBadge size="sm" tone="warn" title={reason} label={tr('ws.shop.priceWatch.notRead')} />
      <span className="tp-sr-only">{reason}</span>
    </span>
  );
}

/**
 * The size form's supplier link, with what the shop desk PC last made of it.
 * The status is about the STORED link, so it is shown only while the field
 * still holds it.
 */
export function SupplierLinkField({
  value,
  onChange,
  problem,
  serverRefused,
  watch,
}: {
  value: string;
  onChange: (value: string) => void;
  problem: SupplierUrlProblem | null;
  /** The server said SUPPLIER_URL_INVALID to what the form let through. */
  serverRefused: boolean;
  watch: PriceWatchRow | null;
}) {
  const { tr } = useLocale();
  const error = problem ? tr(`ws.shop.priceWatch.problem.${problem}` as const) : serverRefused ? tr('ws.shop.priceWatch.problem.invalid') : undefined;
  const showStatus = watch !== null && value.trim() === watch.url;
  return (
    <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
      <Field label={tr('ws.shop.priceWatch.link')} optional hint={tr('ws.shop.priceWatch.linkHint')} error={error}>
        <input
          style={inputStyle}
          dir="ltr"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      {showStatus && <WatchStatus watch={watch} />}
    </div>
  );
}

function WatchStatus({ watch }: { watch: PriceWatchRow }) {
  const { tr, locale } = useLocale();
  const at = (iso: string) => formatDateTime(new Date(iso), locale);
  const price = (n: number) => formatIQD(Number(n), locale);
  const lines: { text: string; tone: 'muted' | 'warn' }[] = [];
  if (!watch.checked_at) {
    lines.push({ text: tr('ws.shop.priceWatch.status.notYet'), tone: 'muted' });
  } else if (watch.last_error) {
    lines.push({
      text: tr('ws.shop.priceWatch.status.failed', { time: at(watch.checked_at), error: tr(`ws.shop.priceWatch.readError.${watch.last_error}` as const) }),
      tone: 'warn',
    });
    if (watch.supplier_price_iqd !== null && watch.read_ok_at) {
      lines.push({ text: tr('ws.shop.priceWatch.status.lastGood', { price: price(watch.supplier_price_iqd), time: at(watch.read_ok_at) }), tone: 'muted' });
    }
  } else if (watch.supplier_price_iqd !== null) {
    lines.push({ text: tr('ws.shop.priceWatch.status.read', { time: at(watch.checked_at), price: price(watch.supplier_price_iqd) }), tone: 'muted' });
  }
  return (
    <div data-testid="supplier-link-status" style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)' }}>
      {lines.map((l) => (
        <span key={l.text} style={{ color: l.tone === 'warn' ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}>
          {l.text}
        </span>
      ))}
    </div>
  );
}
