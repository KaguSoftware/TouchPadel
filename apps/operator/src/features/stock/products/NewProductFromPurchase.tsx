/**
 * Approve a new shop product a driver bought (0389, F-36; Majed 2026-11-01:
 * "a new product arriving from a driver purchase is recorded, and the manager
 * gets a message to approve the purchase of the new product and add it to the
 * products list").
 *
 * The driver's purchase already told the managers (staff push
 * purchase_to_receive, 0166); its line with a name and no product waits under
 * "Not for stock" on the purchase. Approve and add sends
 * app.create_shop_product with p_purchase_line_id: the product and its first
 * size are made in one transaction, the quantity bought goes into the shop
 * store at the price paid and the line is received. Refusing it is the line's
 * "Mark checked". A manager's new product is saved hidden (0246: launched
 * through the price protocol), as the Products page does.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { can, useAuth } from '../../../lib/auth';
import { useLocale, pickName } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field, Modal, Select, inputStyle } from '../../../components/ui';
import { BilingualFields } from '../../../components/inputs';
import { MessagePresenter } from '../../../components/kit';
import { keyForValues } from '../../wages/wagesLogic';
import { SK, fetchShopCatalogue } from '../stockKeys';
import type { PurchaseLine } from '../driverPurchasesLogic';
import { createProductArgs, sizeProblem, type SizeDraft } from './productsLogic';
import { digitsProblem } from '../decimalInput';

export function NewProductFromPurchase({ line, onClose, onDone }: { line: PurchaseLine; onClose: () => void; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { staff } = useAuth();
  const active = can(staff, 'launchDirectly');
  const catalogueQ = useQuery({ queryKey: SK.products, queryFn: fetchShopCatalogue });
  const sections = (catalogueQ.data?.sections ?? []).filter((s) => s.is_active);
  const label = (line.label ?? '').trim();
  const [sectionId, setSectionId] = useState('');
  const [name, setName] = useState({ en: label, ar: label });
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tried, setTried] = useState(false);
  const keys = useRef(new Map<string, string>());
  const section = sectionId || sections[0]?.id || '';
  const cost = line.qty > 0 ? Math.round(line.price_iqd / line.qty) : 0;
  const draft: SizeDraft = {
    nameEn: tr('ws.manager.stock.products.oneSizeEn'),
    nameAr: tr('ws.manager.stock.products.oneSizeAr'),
    price,
    sku: '',
    barcode: '',
    cost: String(cost),
    low: '',
  };
  const digits = digitsProblem(price);
  const problem = !name.en.trim() || !name.ar.trim() ? 'names' : digits ? 'digits' : sizeProblem(draft);

  async function approve() {
    setTried(true);
    if (problem || !section) return;
    setBusy(true);
    setError(null);
    try {
      const base = createProductArgs({ sectionId: section, productName: name, draft, supplierId: '', active, key: '', purchaseLineId: line.id });
      await appRpc('create_shop_product', {
        ...base,
        p_idempotency_key: keyForValues(keys.current, [base], () => `shop.product:${crypto.randomUUID()}`),
      });
      toast.ok(tr('ws.supplies.purchase.newProductDone', { name: isolate(name.en.trim()) }));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.supplies.purchase.newProductTitle', { name: isolate(label) })}
      onClose={onClose}
      dismissible={!busy}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={busy}
            disabled={!section}
            disabledReason={!section ? tr('ws.supplies.purchase.newProductNoSection') : undefined}
            data-testid="newProduct.approve"
            onClick={() => void approve()}
          >
            {tr('ws.supplies.purchase.newProductApprove')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-sm)' }}>
        {tr('ws.supplies.purchase.newProductLead', { qty: formatNumber(line.qty, locale) })}
      </p>
      {!active && <MessagePresenter tone="info" message={tr('ws.supplies.purchase.newProductHidden')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
      <Field label={tr('ws.supplies.purchase.newProductSection')}>
        <Select
          value={section}
          onChange={setSectionId}
          disabled={busy || sections.length === 0}
          options={sections.map((s) => ({ value: s.id, label: pickName(locale, s) }))}
        />
      </Field>
      <BilingualFields
        labelEn={tr('ws.manager.stock.products.productNameEn')}
        labelAr={tr('ws.manager.stock.products.productNameAr')}
        en={name.en}
        ar={name.ar}
        onEn={(v) => setName({ ...name, en: v })}
        onAr={(v) => setName({ ...name, ar: v })}
        maxLength={80}
        disabled={busy}
      />
      <Field
        label={tr('ws.supplies.purchase.newProductPrice')}
        error={tried && problem ? (problem === 'digits' ? tr('ws.manager.stock.englishDigits') : tr(`ws.manager.stock.products.problem.${problem}`)) : undefined}
      >
        <input
          style={inputStyle}
          dir="ltr"
          inputMode="numeric"
          value={price}
          disabled={busy}
          data-testid="newProduct.price"
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>
      <ErrorText error={error} />
    </Modal>
  );
}
