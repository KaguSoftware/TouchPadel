/**
 * Goods in ▸ "Added by staff" (docs/design/protocols/wave5-addendum-2026-09-25
 * §2.8.2 D5, §5.2; Majed's answer #5, §8 Q23-Q24). The heads, the cashier and
 * the desk add what arrived on the phone (app.log_stock). They never see or
 * type a cost, so each line was booked at an estimate: the last delivery's
 * cost, else the pack price, else nothing ("needs a cost"). This card is where
 * a manager checks those estimates and sets the real cost.
 *
 * It lists the last 14 days of staff additions, and anything older that still
 * has a line with no cost. Lines needing a cost come first; additions that are
 * all costed fold behind one button, so on a quiet day the card is one line.
 * It renders nothing while there is nothing to show, like the driver's
 * purchases above it.
 *
 * "Set cost" opens inline on the line, never in a dialog: a cost per base unit
 * or per pack, saved through app.price_logged_stock, which revalues only what
 * is still on the shelf (the line, its batch and that batch's moved copies);
 * what was already used keeps the estimate. A delivery typed in on Goods in is
 * not a staff addition and never shows here (the RPC refuses it, I13).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { pickName, useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { Panel, SegmentedControl, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { decimalKeystroke } from './decimalInput';
import { IngredientName, useStockFormat, useStoreName } from './stockUi';
import { costPerBaseUnit, linesNeedingCost, logNeedsCost, readStaffLogs, type StaffLog, type StaffLogLine } from './storeLogic';
import { SK, STAFF_LOG_DAYS, fetchIngredients, fetchStaffLogs, type IngredientRow } from './stockKeys';

interface Editing {
  lineId: string;
  per: 'unit' | 'pack';
  value: string;
}

export function StaffLogs() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const q = useQuery({ queryKey: SK.staffLogs, queryFn: fetchStaffLogs, refetchInterval: 60_000 });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredientOf = useMemo(() => new Map((ingredientsQ.data ?? []).map((i) => [i.id, i])), [ingredientsQ.data]);
  const logs = useMemo(() => readStaffLogs(q.data ?? []), [q.data]);
  const [showCosted, setShowCosted] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  if (q.isError && logs.length === 0) {
    return (
      <Panel title={<CardTitle icon="phone">{tr('ws.stores.staffLogs.title')}</CardTitle>} data-testid="staff-logs">
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" busy={q.isFetching} onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      </Panel>
    );
  }
  if (logs.length === 0) return null;

  const needing = logs.filter(logNeedsCost);
  const costed = logs.filter((l) => !logNeedsCost(l));
  const toCost = linesNeedingCost(logs);
  const shown = showCosted ? logs : needing;

  // Nothing waits for a cost: one quiet line above Goods in's own form, not a
  // card that pushes it down. It opens into the card when asked.
  if (needing.length === 0 && !showCosted) {
    return (
      <div
        data-testid="staff-logs"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}
      >
        <Icon name="phone" size={14} />
        <span>
          <strong style={{ color: 'var(--tp-fg)' }}>{tr('ws.stores.staffLogs.title')}</strong>
          {' · '}
          {tr('ws.stores.staffLogs.allCosted', { days: fmt.num(STAFF_LOG_DAYS) })}
        </span>
        <Button size="sm" kind="ghost" icon="chevronDown" aria-expanded={false} onClick={() => setShowCosted(true)} data-testid="staff-logs-toggle">
          {tr('ws.stores.staffLogs.showCosted', { count: fmt.num(costed.length) })}
        </Button>
      </div>
    );
  }

  return (
    <Panel
      title={<CardTitle icon="phone">{tr('ws.stores.staffLogs.title')}</CardTitle>}
      actions={toCost > 0 ? <StatusBadge tone="warn" label={tr('ws.stores.staffLogs.needCost', { count: fmt.num(toCost) })} /> : undefined}
      data-testid="staff-logs"
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)', maxInlineSize: '70ch' }}>
        {tr('ws.stores.staffLogs.lead')}
      </p>
      {needing.length === 0 && !showCosted && (
        <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success }}>
          {tr('ws.stores.staffLogs.allCosted', { days: fmt.num(STAFF_LOG_DAYS) })}
        </p>
      )}
      {shown.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {shown.map((log) => (
            <LogRow key={log.id} log={log} ingredientOf={ingredientOf} editing={editing} onEdit={setEditing} locale={locale} />
          ))}
        </ul>
      )}
      {costed.length > 0 && (
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <Button size="sm" kind="ghost" icon={showCosted ? 'chevronUp' : 'chevronDown'} aria-expanded={showCosted} onClick={() => setShowCosted((v) => !v)} data-testid="staff-logs-toggle">
            {showCosted ? tr('ws.stores.staffLogs.hideCosted') : tr('ws.stores.staffLogs.showCosted', { count: fmt.num(costed.length) })}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function LogRow({
  log,
  ingredientOf,
  editing,
  onEdit,
  locale,
}: {
  log: StaffLog;
  ingredientOf: Map<string, IngredientRow>;
  editing: Editing | null;
  onEdit: (e: Editing | null) => void;
  locale: 'en' | 'ar';
}) {
  const { tr } = useLocale();
  const storeName = useStoreName();
  const when = log.received_at ? formatDateTime(new Date(log.received_at), locale) : '—';
  return (
    <li data-log={log.id} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
        <bdi style={{ fontWeight: 600 }}>{tr('ws.stores.staffLogs.by', { name: isolate(log.staffName ?? '—'), when })}</bdi>
        <span style={{ color: 'var(--tp-muted-fg)' }}>{storeName(log.location)}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {log.lines.map((line) => (
          <LineRow
            key={line.id}
            deliveryId={log.id}
            line={line}
            ingredient={ingredientOf.get(line.ingredient_id)}
            editing={editing?.lineId === line.id ? editing : null}
            onEdit={onEdit}
          />
        ))}
      </ul>
    </li>
  );
}

function LineRow({
  deliveryId,
  line,
  ingredient,
  editing,
  onEdit,
}: {
  deliveryId: string;
  line: StaffLogLine;
  ingredient: IngredientRow | undefined;
  editing: Editing | null;
  onEdit: (e: Editing | null) => void;
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const unit = ingredient?.unit ?? '';
  const packSize = ingredient && ingredient.pack_size !== null && ingredient.pack_size > 0 ? ingredient.pack_size : null;
  const needs = line.cost_source === 'none';
  const cost = editing ? costPerBaseUnit(editing.value, editing.per, packSize) : null;
  const invalid = editing !== null && editing.value.trim() !== '' && cost === null;

  async function save() {
    if (cost === null) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('price_logged_stock', { p_delivery_id: deliveryId, p_lines: [{ delivery_line_id: line.id, unit_cost_iqd: cost }] });
      toast.ok(tr('ws.stores.staffLogs.saved'));
      onEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-line={line.id}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 14rem', minInlineSize: 0 }}>
          <IngredientName name={ingredient ? pickName(locale, ingredient) : tr('ws.manager.stock.alerts.unknownIngredient')} strong />
          <bdi style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{unit ? fmt.qty(line.qty_received, unit) : fmt.num(line.qty_received)}</bdi>
        </span>
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end', textAlign: 'end' }}>
          {needs ? (
            <StatusBadge size="sm" tone="warn" label={tr('ws.stores.staffLogs.source.none')} />
          ) : (
            <>
              <bdi style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {tr('ws.stores.staffLogs.costPer', { cost: fmt.cost(line.unit_cost_iqd), unit: unit ? fmt.one(unit) : '' })}
              </bdi>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`ws.stores.staffLogs.source.${line.cost_source}`)}</span>
            </>
          )}
        </span>
        {!editing && (
          <Button
            size="sm"
            kind={needs ? 'soft' : 'ghost'}
            icon="tag"
            onClick={() => onEdit({ lineId: line.id, per: 'unit', value: '' })}
            data-testid={`set-cost-${line.id}`}
          >
            {needs ? tr('ws.stores.staffLogs.setCost') : tr('ws.stores.staffLogs.changeCost')}
          </Button>
        )}
      </div>
      {editing && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
            {packSize !== null && (
              <Field label={tr('ws.stores.staffLogs.per')} group style={{ marginBlockEnd: 0 }}>
                <SegmentedControl<'unit' | 'pack'>
                  value={editing.per}
                  onChange={(per) => onEdit({ ...editing, per })}
                  options={[
                    { value: 'unit', label: tr('ws.stores.staffLogs.perUnit', { unit: fmt.one(unit) }), disabled: busy },
                    { value: 'pack', label: tr('ws.stores.staffLogs.perPack', { size: fmt.qty(packSize, unit) }), disabled: busy },
                  ]}
                />
              </Field>
            )}
            <Field
              label={packSize === null ? tr('ws.manager.stock.goodsIn.costPer', { unit: fmt.one(unit) }) : tr('ws.stores.staffLogs.cost')}
              required
              style={{ marginBlockEnd: 0, inlineSize: '11rem' }}
              error={invalid ? tr('ws.stores.staffLogs.problem') : undefined}
            >
              <input
                style={inputStyle}
                dir="ltr"
                inputMode="decimal"
                autoFocus
                value={editing.value}
                disabled={busy}
                aria-invalid={invalid || undefined}
                onChange={(e) => onEdit({ ...editing, value: decimalKeystroke(e.target.value) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cost !== null) void save();
                  if (e.key === 'Escape') onEdit(null);
                }}
              />
            </Field>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
              <Button kind="primary" size="sm" icon="check" busy={busy} disabled={cost === null} onClick={() => void save()} data-testid={`save-cost-${line.id}`}>
                {tr('ws.stores.staffLogs.save')}
              </Button>
              <Button size="sm" kind="ghost" disabled={busy} onClick={() => onEdit(null)}>
                {tr('ws.stores.staffLogs.cancel')}
              </Button>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.stores.staffLogs.revalues')}</p>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
        </div>
      )}
    </li>
  );
}
