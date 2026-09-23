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
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
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
import { useStockFormat } from '../stockUi';
import {
  SK,
  fetchIngredients,
  fetchOnHand,
  fetchShopCatalogue,
  fetchSuppliers,
  type ShopSectionRow,
  type SupplierRow,
} from '../stockKeys';
import { flattenCatalogue, matchesProductLine, sizeArgs, sizeProblem, type ProductLine, type SizeDraft } from './productsLogic';

type Editing =
  | { mode: 'newProduct' }
  | { mode: 'addSize'; line: ProductLine }
  | { mode: 'editSize'; line: ProductLine };

export function ProductsAdmin() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);

  const catalogueQ = useQuery({ queryKey: SK.products, queryFn: fetchShopCatalogue });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });

  const sections = catalogueQ.data?.sections ?? [];
  const lines = useMemo(
    () =>
      catalogueQ.data
        ? flattenCatalogue(catalogueQ.data, ingredientsQ.data ?? [], onHandQ.data ?? [], suppliersQ.data ?? [])
        : [],
    [catalogueQ.data, ingredientsQ.data, onHandQ.data, suppliersQ.data],
  );
  const rows = lines.filter((l) => matchesProductLine(l, search));
  const status = asyncStatus(catalogueQ, (d) => d.sections.length === 0 || d.products.length === 0);

  const columns: Column<ProductLine>[] = [
    {
      key: 'product',
      header: tr('ws.manager.stock.products.product'),
      render: (l) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>
            <bdi>{pickName(locale, l.product)}</bdi>
          </strong>
          <bdi style={{ color: 'var(--tp-muted-fg)' }}>{pickName(locale, l.variant)}</bdi>
          {!l.product.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.stock.products.hidden')} />}
        </span>
      ),
    },
    { key: 'sku', header: tr('ws.manager.stock.products.sku'), render: (l) => (l.variant.sku ? <bdi dir="ltr">{l.variant.sku}</bdi> : '—') },
    { key: 'barcode', header: tr('ws.manager.stock.products.barcode'), render: (l) => (l.variant.barcode ? <bdi dir="ltr">{l.variant.barcode}</bdi> : '—') },
    { key: 'price', header: tr('ws.manager.stock.products.price'), numeric: true, render: (l) => <Money amount={l.variant.price_iqd} /> },
    {
      key: 'onHand',
      header: tr('ws.manager.stock.onHand.table.onHand'),
      numeric: true,
      render: (l) =>
        l.ingredientId === null ? (
          <StatusBadge size="sm" tone="warn" label={tr('ws.manager.stock.products.notTracked')} />
        ) : (
          <bdi>{fmt.qty(l.onHand ?? 0, 'pc')}</bdi>
        ),
    },
    { key: 'supplier', header: tr('ws.manager.stock.ingredients.supplier'), truncate: true, render: (l) => (l.supplier ? <bdi>{l.supplier.name}</bdi> : '—') },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (l) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }}>
          <Button size="sm" kind="ghost" icon="plus" onClick={() => setEditing({ mode: 'addSize', line: l })}>
            {tr('ws.manager.stock.products.addSize')}
          </Button>
          <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing({ mode: 'editSize', line: l })}>
            {tr('op.common.edit')}
          </Button>
        </span>
      ),
    },
  ];

  const noSections = catalogueQ.isSuccess && sections.length === 0;

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.products')}
        subtitle={tr('ws.manager.stock.products.lead')}
        actions={
          <Button kind="primary" icon="plus" disabled={sections.length === 0} disabledReason={tr('ws.manager.stock.products.needSection')} onClick={() => setEditing({ mode: 'newProduct' })}>
            {tr('ws.manager.stock.products.add')}
          </Button>
        }
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
              title={tr('ws.manager.stock.products.noSections')}
              body={tr('ws.manager.stock.products.noSectionsBody')}
              action={
                <Button kind="primary" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/categories' })}>
                  {tr('ws.manager.stock.products.openSections')}
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
          <span style={{ inlineSize: '18rem', maxInlineSize: '100%' }}>
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
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['stock'] });
            void queryClient.invalidateQueries({ queryKey: ['menu'] });
            void queryClient.invalidateQueries({ queryKey: ['adminMenu'] });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SizeForm({
  editing,
  sections,
  suppliers,
  onDone,
  onCancel,
}: {
  editing: Editing;
  sections: readonly ShopSectionRow[];
  suppliers: readonly SupplierRow[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const line = editing.mode === 'newProduct' ? null : editing.line;
  const editSize = editing.mode === 'editSize' ? editing.line : null;

  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [productName, setProductName] = useState({ en: '', ar: '' });
  const [draft, setDraft] = useState<SizeDraft>({
    nameEn: editSize?.variant.name_en ?? (editing.mode === 'newProduct' ? tr('ws.manager.stock.products.oneSizeEn') : ''),
    nameAr: editSize?.variant.name_ar ?? (editing.mode === 'newProduct' ? tr('ws.manager.stock.products.oneSizeAr') : ''),
    price: editSize ? String(editSize.variant.price_iqd) : '',
    sku: editSize?.variant.sku ?? '',
    barcode: editSize?.variant.barcode ?? '',
    cost: editSize?.packCostIqd != null ? String(editSize.packCostIqd) : '',
    low: editSize?.lowStockThreshold != null ? String(editSize.lowStockThreshold) : '',
  });
  const [supplierId, setSupplierId] = useState(editSize?.supplier?.id ?? line?.supplier?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const problem = sizeProblem(draft);
  const productMissing = editing.mode === 'newProduct' && (!productName.en.trim() || !productName.ar.trim() || !sectionId);
  const set = (part: Partial<SizeDraft>) => setDraft((d) => ({ ...d, ...part }));
  const dirty = editing.mode !== 'editSize' || JSON.stringify(draft) !== JSON.stringify({
    nameEn: editSize!.variant.name_en,
    nameAr: editSize!.variant.name_ar,
    price: String(editSize!.variant.price_iqd),
    sku: editSize!.variant.sku ?? '',
    barcode: editSize!.variant.barcode ?? '',
    cost: editSize!.packCostIqd != null ? String(editSize!.packCostIqd) : '',
    low: editSize!.lowStockThreshold != null ? String(editSize!.lowStockThreshold) : '',
  }) || supplierId !== (editSize!.supplier?.id ?? '') || editSize!.ingredientId === null;

  /** Modal `canClose`: asked before the exit plays (see IngredientForm). */
  async function confirmDiscard() {
    return !(dirty && editing.mode === 'editSize') || confirm({
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
        });
      }
      await appRpc('upsert_retail_variant', {
        p_item_id: itemId,
        ...sizeArgs(draft, supplierId),
        ...(editSize ? { p_id: editSize.variant.id, p_is_default: editSize.variant.is_default, p_sort_order: editSize.variant.sort_order } : {}),
        ...(editing.mode === 'newProduct' ? { p_is_default: true } : {}),
        ...(editing.mode === 'addSize' ? { p_sort_order: editing.line.variant.sort_order + 1 } : {}),
      });
      toast.ok(tr('op.toast.saved'));
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
      subtitle={editSize && editSize.ingredientId === null ? tr('ws.manager.stock.products.notTrackedHint') : undefined}
      canClose={confirmDiscard}
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
            disabled={productMissing || problem !== null || !dirty}
            disabledReason={productMissing ? tr('ws.manager.disabled.namesRequired') : (problemText(problem) ?? tr('ws.manager.stock.ingredients.form.nothingChanged'))}
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
      <BilingualFields
        labelEn={tr('ws.manager.stock.products.sizeNameEn')}
        labelAr={tr('ws.manager.stock.products.sizeNameAr')}
        en={draft.nameEn}
        ar={draft.nameAr}
        onEn={(nameEn) => set({ nameEn })}
        onAr={(nameAr) => set({ nameAr })}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', columnGap: 'var(--tp-sp-2-5)', marginBlockStart: 'var(--tp-sp-2)' }}>
        <Field label={tr('ws.manager.stock.products.price')} error={problem === 'price' && draft.price.trim() ? problemText('price') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.price} onChange={(e) => set({ price: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.cost')} optional hint={tr('ws.manager.stock.products.costHint')} error={problem === 'cost' ? problemText('cost') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.cost} onChange={(e) => set({ cost: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.sku')} optional error={problem === 'sku' ? problemText('sku') : undefined}>
          <input style={inputStyle} dir="ltr" value={draft.sku} onChange={(e) => set({ sku: e.target.value })} />
        </Field>
        <Field label={tr('ws.manager.stock.products.barcode')} optional hint={tr('ws.manager.stock.products.barcodeHint')} error={problem === 'barcode' ? problemText('barcode') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.barcode} onChange={(e) => set({ barcode: e.target.value })} />
        </Field>
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
        <Field label={tr('ws.manager.stock.products.low')} optional hint={tr('ws.manager.stock.products.lowHint')} error={problem === 'low' ? problemText('low') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={draft.low} onChange={(e) => set({ low: e.target.value })} />
        </Field>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
