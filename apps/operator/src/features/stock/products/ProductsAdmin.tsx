/**
 * Touch Shop products (Phase 2 item 5; 0144/0145).
 *
 * One row per SIZE: product, size, SKU, barcode, price, on hand, supplier. A
 * product is a menu item in a shop section, so it rings up on the till like any
 * item; each size owns its own stock row (unit pc), created by
 * app.upsert_retail_variant in the same transaction as the size itself, so
 * goods-in, the count and the ledger see it at once.
 *
 * "New product" creates the item (app.upsert_menu_item) and its first size;
 * "Add size" and "Edit" go through app.upsert_retail_variant. A size made in
 * the menu editor shows "Not tracked" until it is saved here once.
 *
 * Shop sections themselves are made in the menu (section type: Shop); with
 * none yet, the empty state says so and links there.
 *
 * A MANAGER'S PRICES GO TO THE OWNER (#51, #53, build-contracts-2026-09-23
 * §5.5). A manager's new product is saved hidden, and its sizes and prices
 * stay theirs to edit until it has been on sale; "Put on sale" then sends it
 * to the owner as a shop_launch change. Once on sale, its prices are
 * read-only and "Add size" gives way to "Change the price"; the SKU, barcode,
 * supplier, pack cost and low-stock level stay editable (the price goes back
 * unchanged, which upsert_variant's lock lets through).
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.2, #9): a launched size's names lock
 * with its price. They go back as stored, and the one lock note above the
 * price says both change through "Change the price".
 *
 * Supplier price watch (0322, docs/design/shop/supplier-price-watch-2026-10-08.md):
 * a size may carry its supplier's product page link; the shop desk PC reads
 * it hourly. A size whose supplier price is not its own is listed at the top
 * under "Supplier price changes" and marked on its row; "Apply new price"
 * opens its form with the supplier's price filled in (Save applies it, through
 * the same upsert_retail_variant). The link is saved with
 * app.set_shop_price_watch after the size, and only when it changed.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { can, useAuth } from '../../../lib/auth';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, inputStyle, Select } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ResultCount,
  SearchField,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { BilingualFields } from '../../../components/inputs';
import { Icon } from '../../../components/icons';
import { PriceChangeButton, PriceLockNote, usePriceChangeStart } from '../../admin/promotions/PriceChangeStart';
import { isRenameRefusal } from '../../admin/addons/addonsLogic';
import { useStockFormat } from '../stockUi';
import { ShopSectionDialog } from '../../shop/ShopSectionDialog';
import { PRICE_WATCHES_KEY, fetchPriceWatches } from '../../shop/priceWatch/priceWatchData';
import { alertsFor, checkSupplierUrl, type PriceWatchRow } from '../../shop/priceWatch/priceWatchLogic';
import { SupplierLinkField, SupplierLinkNotRead, SupplierPriceAlerts, SupplierPriceMarker } from '../../shop/priceWatch/PriceWatchUi';
import {
  SK,
  fetchIngredients,
  fetchOnHand,
  fetchShopCatalogue,
  fetchSuppliers,
  type ShopSectionRow,
  type SupplierRow,
} from '../stockKeys';
import {
  flattenCatalogue,
  matchesProductLine,
  productLock,
  sizeArgs,
  sizeProblem,
  supplierLinkToSave,
  type ProductLine,
  type SizeDraft,
} from './productsLogic';

type Caps = { editLaunchedPrices: boolean; launchDirectly: boolean };

type Editing =
  | { mode: 'newProduct' }
  | { mode: 'addSize'; line: ProductLine }
  /** `suggestedPrice`: "Apply new price", the supplier's price filled in. */
  | { mode: 'editSize'; line: ProductLine; suggestedPrice?: number };

export function ProductsAdmin() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  const caps: Caps = { editLaunchedPrices: can(staff?.role, 'editLaunchedPrices'), launchDirectly: can(staff?.role, 'launchDirectly') };
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  // 0246: the shop's sections are made here, never in the café's menu editor.
  const [newSection, setNewSection] = useState(false);

  const catalogueQ = useQuery({ queryKey: SK.products, queryFn: fetchShopCatalogue });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });
  // No watches (or a server without 0322) is no panel and no link status, never an error.
  const watchesQ = useQuery({ queryKey: PRICE_WATCHES_KEY, queryFn: fetchPriceWatches });

  const sections = catalogueQ.data?.sections ?? [];
  const lines = useMemo(
    () =>
      catalogueQ.data
        ? flattenCatalogue(catalogueQ.data, ingredientsQ.data ?? [], onHandQ.data ?? [], suppliersQ.data ?? [])
        : [],
    [catalogueQ.data, ingredientsQ.data, onHandQ.data, suppliersQ.data],
  );
  const rows = lines.filter((l) => matchesProductLine(l, search));
  const watchOf = useMemo(() => new Map((watchesQ.data ?? []).map((w) => [w.variant_id, w])), [watchesQ.data]);
  const alerts = useMemo(() => alertsFor(lines, watchesQ.data ?? []), [lines, watchesQ.data]);
  const supplierPriceOf = new Map(alerts.map((a) => [a.line.variant.id, a.supplierPriceIqd]));
  const status = asyncStatus(catalogueQ, (d) => d.sections.length === 0 || d.products.length === 0);

  const columns: Column<ProductLine>[] = [
    {
      key: 'product',
      header: tr('ws.manager.stock.products.product'),
      render: (l) => {
        const failed = watchOf.get(l.variant.id)?.last_error;
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>
              <bdi>{pickName(locale, l.product)}</bdi>
            </strong>
            <bdi style={{ color: 'var(--tp-muted-fg)' }}>{pickName(locale, l.variant)}</bdi>
            {!l.product.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.stock.products.hidden')} />}
            {supplierPriceOf.has(l.variant.id) ? (
              <SupplierPriceMarker priceIqd={supplierPriceOf.get(l.variant.id)!} />
            ) : (
              // A link whose last read failed: seen on the list, explained in the form.
              failed && <SupplierLinkNotRead error={failed} />
            )}
          </span>
        );
      },
    },
    { key: 'sku', header: tr('ws.manager.stock.products.sku'), render: (l) => (l.variant.sku ? <bdi dir="ltr">{l.variant.sku}</bdi> : '—') },
    { key: 'barcode', header: tr('ws.manager.stock.products.barcode'), render: (l) => (l.variant.barcode ? <bdi dir="ltr">{l.variant.barcode}</bdi> : '—') },
    // The header already says IQD, as the menu list's does; with the unit in
    // every cell too, each price broke onto a second line ("50,000" / "IQD").
    { key: 'price', header: tr('ws.manager.stock.products.price'), numeric: true, render: (l) => <Money amount={l.variant.price_iqd} unit={false} /> },
    {
      key: 'onHand',
      header: tr('ws.manager.stock.onHand.table.onHand'),
      numeric: true,
      render: (l) =>
        l.ingredientId === null ? (
          <StatusBadge size="sm" tone="warn" label={tr('ws.manager.stock.products.notTracked')} />
        ) : (
          // A count and its unit are one reading ("6" / "قطعة" split in Arabic).
          <bdi style={{ whiteSpace: 'nowrap' }}>{fmt.qty(l.onHand ?? 0, 'pc')}</bdi>
        ),
    },
    { key: 'supplier', header: tr('ws.manager.stock.ingredients.supplier'), truncate: true, render: (l) => (l.supplier ? <bdi>{l.supplier.name}</bdi> : '—') },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (l) => {
        const lock = productLock(l, caps);
        const name = pickName(locale, l.product);
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }}>
            {lock.putOnSale && (
              <PriceChangeButton
                size="sm"
                kind="ghost"
                target={{ change: 'shop_launch', item: l.productId }}
                label={tr('ws.pricing.putOnSale')}
                ariaLabel={tr('ws.pricing.putOnSaleFor', { name })}
              />
            )}
            {lock.priceLocked ? (
              <PriceChangeButton
                size="sm"
                kind="ghost"
                target={{ change: 'price', item: l.productId }}
                label={tr('ws.pricing.changePrice')}
                ariaLabel={tr('ws.pricing.changePriceFor', { name })}
              />
            ) : (
              <Button size="sm" kind="ghost" icon="plus" onClick={() => setEditing({ mode: 'addSize', line: l })}>
                {tr('ws.manager.stock.products.addSize')}
              </Button>
            )}
            <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing({ mode: 'editSize', line: l })}>
              {tr('op.common.edit')}
            </Button>
          </span>
        );
      },
    },
  ];

  const noSections = catalogueQ.isSuccess && sections.length === 0;

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.products')}
        subtitle={tr('ws.manager.stock.products.lead')}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button icon="plus" onClick={() => setNewSection(true)} data-testid="shop-section-add">
              {tr('ws.shop.sections.add')}
            </Button>
            <Button kind="primary" icon="plus" disabled={sections.length === 0} disabledReason={tr('ws.manager.stock.products.needSection')} onClick={() => setEditing({ mode: 'newProduct' })}>
              {tr('ws.manager.stock.products.add')}
            </Button>
          </span>
        }
      >
        {!caps.launchDirectly && <PriceLockNote message={tr('ws.pricing.products.note')} />}
      </PageHeader>
      <SupplierPriceAlerts
        alerts={alerts}
        priceLocked={(l) => productLock(l, caps).priceLocked}
        onApply={(a) => setEditing({ mode: 'editSize', line: a.line, suggestedPrice: a.supplierPriceIqd })}
      />
      <AsyncStateWrapper
        status={status}
        error={catalogueQ.error}
        onRetry={() => void catalogueQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          noSections ? (
            <EmptyState
              icon="tag"
              title={tr('ws.shop.sections.empty')}
              body={tr('ws.shop.sections.emptyBody')}
              action={
                <Button kind="primary" icon="plus" onClick={() => setNewSection(true)}>
                  {tr('ws.shop.sections.add')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="tag"
              title={tr('ws.manager.stock.products.empty')}
              body={tr('ws.manager.stock.products.emptyBody')}
              action={
                <Button kind="primary" icon="plus" onClick={() => setEditing({ mode: 'newProduct' })}>
                  {tr('ws.manager.stock.products.add')}
                </Button>
              }
            />
          )
        }
      >
        <Toolbar end={<ResultCount shown={rows.length} total={lines.length} />}>
          {/* 18rem clipped the placeholder ("…or barcoc"). */}
          <span style={{ inlineSize: '21rem', maxInlineSize: '100%' }}>
            <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.stock.products.search')} />
          </span>
        </Toolbar>
        {rows.length === 0 ? (
          <EmptyState kind="filtered" onClearFilters={() => setSearch('')} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(l) => l.variant.id}
            onRowClick={(l) => setEditing({ mode: 'editSize', line: l })}
            aria-label={tr('op.stockNav.products')}
          />
        )}
      </AsyncStateWrapper>

      {editing && (
        <SizeForm
          key={editing.mode === 'newProduct' ? 'new' : `${editing.mode}-${editing.line.variant.id}`}
          editing={editing}
          sections={sections}
          suppliers={(suppliersQ.data ?? []).filter((s) => s.is_active)}
          watch={editing.mode === 'editSize' ? (watchOf.get(editing.line.variant.id) ?? null) : null}
          caps={caps}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['stock'] });
            void queryClient.invalidateQueries({ queryKey: ['menu'] });
            void queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {newSection && <ShopSectionDialog onClose={() => setNewSection(false)} />}
    </div>
  );
}

function SizeForm({
  editing,
  sections,
  suppliers,
  watch,
  caps,
  onDone,
  onCancel,
}: {
  editing: Editing;
  sections: readonly ShopSectionRow[];
  suppliers: readonly SupplierRow[];
  /** The size's supplier price watch, if it has one (0322). */
  watch: PriceWatchRow | null;
  caps: Caps;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const start = usePriceChangeStart();
  const line = editing.mode === 'newProduct' ? null : editing.line;
  const editSize = editing.mode === 'editSize' ? editing.line : null;
  // A manager's new product is saved hidden (LAUNCH_VIA_PROTOCOL otherwise).
  const newHidden = editing.mode === 'newProduct' && !caps.launchDirectly;
  const priceLocked = line !== null && productLock(line, caps).priceLocked;
  // Only an existing size has stored names to keep; a new one is named freely.
  const nameLocked = editSize !== null && productLock(editSize, caps).nameLocked;
  // "Apply new price": only offered where the price is editable, so a locked
  // form never shows a figure it would not send.
  const suggestedPrice = editing.mode === 'editSize' && !priceLocked ? editing.suggestedPrice : undefined;

  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [productName, setProductName] = useState({ en: '', ar: '' });
  const [draft, setDraft] = useState<SizeDraft>({
    nameEn: editSize?.variant.name_en ?? (editing.mode === 'newProduct' ? tr('ws.manager.stock.products.oneSizeEn') : ''),
    nameAr: editSize?.variant.name_ar ?? (editing.mode === 'newProduct' ? tr('ws.manager.stock.products.oneSizeAr') : ''),
    price: suggestedPrice !== undefined ? String(suggestedPrice) : editSize ? String(editSize.variant.price_iqd) : '',
    sku: editSize?.variant.sku ?? '',
    barcode: editSize?.variant.barcode ?? '',
    cost: editSize?.packCostIqd != null ? String(editSize.packCostIqd) : '',
    low: editSize?.lowStockThreshold != null ? String(editSize.lowStockThreshold) : '',
  });
  const [supplierId, setSupplierId] = useState(editSize?.supplier?.id ?? line?.supplier?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Untouched until edited: a watch that loads after the form opened fills the
  // field then, instead of reading as "link removed" and deleting it on Save.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const link = linkDraft ?? watch?.url ?? '';
  const linkCheck = checkSupplierUrl(link);
  const linkChange = supplierLinkToSave(link, watch?.url ?? null);
  // The server's own check said no: said under the link, not again below.
  const linkRefused = error instanceof AppRpcError && error.code === 'SUPPLIER_URL_INVALID';

  const problem = sizeProblem(draft);
  const productMissing = editing.mode === 'newProduct' && (!productName.en.trim() || !productName.ar.trim() || !sectionId);
  const set = (part: Partial<SizeDraft>) => setDraft((d) => ({ ...d, ...part }));
  // The size itself changed (a new size always has); the link is apart, so a
  // link-only edit does not resend the size.
  const sizeDirty = editing.mode !== 'editSize' || JSON.stringify(draft) !== JSON.stringify({
    nameEn: editSize!.variant.name_en,
    nameAr: editSize!.variant.name_ar,
    price: String(editSize!.variant.price_iqd),
    sku: editSize!.variant.sku ?? '',
    barcode: editSize!.variant.barcode ?? '',
    cost: editSize!.packCostIqd != null ? String(editSize!.packCostIqd) : '',
    low: editSize!.lowStockThreshold != null ? String(editSize!.lowStockThreshold) : '',
  }) || supplierId !== (editSize!.supplier?.id ?? '') || editSize!.ingredientId === null;
  const dirty = sizeDirty || linkChange !== null;
  // Leaving asks only about what the person changed here: "Apply new price"
  // opens with the price filled in (dirty, so Save applies it), and a size
  // made in the menu editor is always resent; neither is an edit to lose.
  const [opened] = useState(() => ({ draft, supplierId }));
  const leaveDirty = JSON.stringify(draft) !== JSON.stringify(opened.draft) || supplierId !== opened.supplierId || (linkDraft !== null && linkChange !== null);

  /**
   * True when there is nothing unsaved to lose, or the manager chose to lose
   * it. Also the Modal's `canClose`: asked before the exit plays (see IngredientForm).
   */
  async function mayLeave() {
    return !(leaveDirty && editing.mode === 'editSize') || confirm({
      title: tr('ws.kit.actions.dirtyLeave'),
      body: tr('ws.kit.actions.dirtyLeaveBody'),
      confirmLabel: tr('ws.kit.actions.dirtyLeaveConfirm'),
      cancelLabel: tr('ws.kit.actions.dirtyLeaveCancel'),
      kind: 'danger',
      // Beside "Keep editing", not pushed to the far edge (owner call,
      // 2026-09-23). Rulebook 7.8 spreads a destructive confirm; this one
      // loses only an unsaved draft, never stored data, and Cancel still
      // autofocuses so Enter and Esc both keep the edits.
      pairActions: true,
      requireChoice: true,
    });
  }

  /** "Change the price" from the form: the start leaves this screen. */
  async function changePrice() {
    if (start && line && (await mayLeave())) start({ change: 'price', item: line.productId });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let itemId = line?.productId ?? null;
      if (editing.mode === 'newProduct') {
        itemId = await appRpc<string>('upsert_menu_item', {
          p_category_id: sectionId,
          p_name_en: productName.en.trim(),
          p_name_ar: productName.ar.trim(),
          ...(newHidden ? { p_is_active: false } : {}),
        });
      }
      const saved = !sizeDirty
        ? null
        : await appRpc<{ variant_id: string } | null>('upsert_retail_variant', {
            p_item_id: itemId,
            ...sizeArgs(draft, supplierId),
            ...(editSize ? { p_id: editSize.variant.id, p_is_default: editSize.variant.is_default, p_sort_order: editSize.variant.sort_order } : {}),
            ...(editing.mode === 'newProduct' ? { p_is_default: true } : {}),
            ...(editing.mode === 'addSize' ? { p_sort_order: editing.line.variant.sort_order + 1 } : {}),
          });
      const variantId = editSize?.variant.id ?? saved?.variant_id;
      if (linkChange && variantId) {
        try {
          await appRpc('set_shop_price_watch', { p_variant_id: variantId, p_url: linkChange.url });
        } catch (e) {
          // The size is saved. An edit stays open (Save again only resends
          // it); a new product or size must not be saved twice, so it closes
          // and says the link did not take.
          if (editing.mode === 'editSize') throw e;
          toast.err(e);
        }
      }
      toast.ok(tr(newHidden ? 'ws.pricing.savedHidden' : 'op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const problemText = (p: typeof problem) => (p ? tr(`ws.manager.stock.products.problem.${p}` as const) : undefined);
  const title =
    editing.mode === 'newProduct'
      ? tr('ws.manager.stock.products.add')
      : editing.mode === 'addSize'
        ? tr('ws.manager.stock.products.addSizeTo', { name: pickName(locale, editing.line.product) })
        : tr('ws.manager.stock.products.editTitle', { name: `${pickName(locale, editing.line.product)} · ${pickName(locale, editing.line.variant)}` });

  return (
    <Modal
      title={title}
      subtitle={
        newHidden
          ? tr('ws.pricing.products.newHint')
          : editSize && editSize.ingredientId === null
            ? tr('ws.manager.stock.products.notTrackedHint')
            : undefined
      }
      canClose={mayLeave}
      onClose={onCancel}
      dismissible={!busy}
      size="lg"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={busy}
            disabled={productMissing || problem !== null || !linkCheck.ok || !dirty}
            disabledReason={
              productMissing
                ? tr('ws.manager.disabled.namesRequired')
                : (problemText(problem) ?? (!linkCheck.ok ? tr(`ws.shop.priceWatch.problem.${linkCheck.error}` as const) : tr('ws.manager.stock.ingredients.form.nothingChanged')))
            }
            onClick={() => void save()}
          >
            {tr('ws.kit.actions.save')}
          </Button>
        </>
      )}
    >
      {editing.mode === 'newProduct' && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-3)' }}>
          <Field label={tr('ws.manager.stock.products.section')}>
            <Select
              value={sectionId}
              onChange={setSectionId}
              options={sections.map((s) => ({ value: s.id, label: pickName(locale, s) }))}
            />
          </Field>
          <BilingualFields
            labelEn={tr('ws.manager.stock.products.productNameEn')}
            labelAr={tr('ws.manager.stock.products.productNameAr')}
            en={productName.en}
            ar={productName.ar}
            onEn={(en) => setProductName((n) => ({ ...n, en }))}
            onAr={(ar) => setProductName((n) => ({ ...n, ar }))}
          />
        </div>
      )}
      {/* A size on sale renames only through a price change (§2.2.2), so its
          names read as text, not as boxes that look editable and are not. */}
      {nameLocked ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', columnGap: 'var(--tp-sp-2-5)' }} data-testid="product-size-names-locked">
          <LockedValue label={tr('ws.manager.stock.products.sizeNameEn')}>
            <bdi dir="ltr">{draft.nameEn}</bdi>
          </LockedValue>
          <LockedValue label={tr('ws.manager.stock.products.sizeNameAr')}>
            <bdi dir="rtl">{draft.nameAr}</bdi>
          </LockedValue>
        </div>
      ) : (
        <BilingualFields
          labelEn={tr('ws.manager.stock.products.sizeNameEn')}
          labelAr={tr('ws.manager.stock.products.sizeNameAr')}
          en={draft.nameEn}
          ar={draft.nameAr}
          onEn={(nameEn) => set({ nameEn })}
          onAr={(nameAr) => set({ nameAr })}
        />
      )}
      {/* Said just above the greyed Price, the field it explains. It used to
          sit under all six fields, read only after the manager had tried it. */}
      {priceLocked && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-3)' }}>
          <PriceLockNote message={tr('ws.pricing.products.priceLocked')} style={{ flex: '1 1 20rem' }} />
          {start && (
            <Button size="sm" iconEnd="arrowUpRight" onClick={() => void changePrice()}>
              {tr('ws.pricing.changePrice')}
            </Button>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', columnGap: 'var(--tp-sp-2-5)', marginBlockStart: 'var(--tp-sp-3)' }}>
        {priceLocked ? (
          <LockedValue label={tr('ws.manager.stock.products.price')}>
            <Money amount={Number.parseInt(draft.price, 10)} strong />
          </LockedValue>
        ) : (
          <Field
            label={tr('ws.manager.stock.products.price')}
            hint={
              suggestedPrice !== undefined && editSize && draft.price === String(suggestedPrice)
                ? tr('ws.shop.priceWatch.filledNote', { old: formatIQD(editSize.variant.price_iqd, locale) })
                : undefined
            }
            error={problem === 'price' && draft.price.trim() ? problemText('price') : undefined}
          >
            <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.price} onChange={(e) => set({ price: e.target.value })} />
          </Field>
        )}
        <Field label={tr('ws.manager.stock.products.cost')} optional hint={tr('ws.manager.stock.products.costHint')} error={problem === 'cost' ? problemText('cost') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.cost} onChange={(e) => set({ cost: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.sku')} optional error={problem === 'sku' ? problemText('sku') : undefined}>
          <input style={inputStyle} dir="ltr" value={draft.sku} onChange={(e) => set({ sku: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.barcode')} optional hint={tr('ws.manager.stock.products.barcodeHint')} error={problem === 'barcode' ? problemText('barcode') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.barcode} onChange={(e) => set({ barcode: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.low')} optional hint={tr('ws.manager.stock.products.lowHint')} error={problem === 'low' ? problemText('low') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.low} onChange={(e) => set({ low: e.target.value })} />
        </Field>
        {/* Last in the grid, right above the supplier link: the two supplier
            fields read as one group. */}
        <Field label={tr('ws.manager.stock.ingredients.supplier')} optional>
          <Select
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: '', label: tr('ws.manager.stock.products.noSupplier') },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </Field>
      </div>
      <SupplierLinkField
        value={link}
        onChange={(v) => {
          setLinkDraft(v);
          if (linkRefused) setError(null);
        }}
        problem={linkCheck.ok ? null : linkCheck.error}
        serverRefused={linkRefused}
        watch={watch}
      />
      {/* A rename refused by the server's lock (the size went on sale since
          this form opened) says where a rename goes now. */}
      {isRenameRefusal(error) ? (
        <PriceLockNote message={tr('ws.pricing.renameViaProtocol')} style={{ marginBlockStart: 'var(--tp-sp-2)' }} />
      ) : (
        <ErrorText error={linkRefused ? null : error} />
      )}
    </Modal>
  );
}

/**
 * A value the form shows but cannot change here (a locked price or size
 * name): its label as a field's, and the value as text beside a lock, never a
 * greyed box that looks editable.
 */
function LockedValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Field label={label} group>
      <div role="group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', minBlockSize: '2.25rem', color: 'var(--tp-fg)' }}>
        <Icon name="lock" size={13} style={{ color: 'var(--tp-muted-fg)', flexShrink: 0 }} />
        {children}
      </div>
    </Field>
  );
}
