/**
 * Setup › Loyalty › Drink card (0445): the club's stamp card. Every paid unit of an item in the
 * stamping menu sections earns a stamp on a member's settled bill (an item a card privilege made
 * free does not), and a full card frees the dearest stamping item on their next bill.
 *
 * The owner sets it (app.set_stamp_card): on or off, the stamps to a free drink (the club's
 * standard, 2..20), the stamping sections, and the items in them that never stamp (water, tea, a
 * plain espresso). The manager reads it (app.stamp_card_settings); a server without 0445 shows no
 * panel. A card whose "Faster drink card" privilege fills it sooner is named under the size, so
 * the owner sees every size a guest can have in one place (the privilege itself is edited in
 * Card privileges).
 *
 * Online only, like the rest of the page. Logic in loyaltyLogic.ts (stampCardDraft, …).
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import type { LoyaltyAdminTier, StampCardSettings } from '@touch/core/loyalty';
import { useLocale, pickName } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, Field, Skeleton } from '../../components/ui';
import { Panel } from '../../components/kit';
import { ChipPicker } from '../../components/ChipPicker';
import { useAdminMenu } from '../admin/menu/useAdminMenu';
import { UnitInput } from '../admin/settings/settingsFields';
import {
  STAMP_SIZE_MAX,
  excludableItems,
  menuKnown,
  stampCardDraft,
  stampCardErrors,
  stampCardPayload,
  stampSizesByCard,
  type StampCardDraft,
} from './loyaltyLogic';
import { invalidateLoyaltyAdmin, setStampCard, useStampCard } from './useLoyalty';

const K = 'ws.loyalty.setup';
const S = `${K}.stampCard` as const;

const hint = { margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' } as const;

/** The panel, or nothing on a server without the drink card. */
export function StampCardPanel({ canEdit, tiers }: { canEdit: boolean; tiers: LoyaltyAdminTier[] }) {
  const { tr } = useLocale();
  const q = useStampCard();
  if (q.data === null) return null;
  return (
    <Panel title={tr(`${S}.title`)} data-testid="loyalty-stamp-card">
      {q.data ? (
        <StampCardForm key={JSON.stringify(q.data)} saved={q.data} canEdit={canEdit} tiers={tiers} />
      ) : q.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <Skeleton lines={4} />
      )}
    </Panel>
  );
}

function StampCardForm({ saved, canEdit, tiers }: { saved: StampCardSettings; canEdit: boolean; tiers: LoyaltyAdminTier[] }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const menu = useAdminMenu();
  const draft0 = useMemo(() => stampCardDraft(saved), [saved]);
  const [d, setD] = useState<StampCardDraft>(draft0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const known = useMemo(() => menuKnown(menu.data ?? null), [menu.data]);
  const errors = touched ? stampCardErrors(d, known) : {};
  const dirty = JSON.stringify(d) !== JSON.stringify(draft0);
  const readOnly = !canEdit || busy;
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const standard = Number(d.size) || saved.size;
  const byCard = stampSizesByCard(tiers, standard);
  const items = menu.data ? excludableItems(menu.data.items, d) : [];

  async function save() {
    setTouched(true);
    if (Object.keys(stampCardErrors(d, known)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await setStampCard(stampCardPayload(d, known));
      invalidateLoyaltyAdmin(qc);
      toast.ok(tr(`${K}.saved`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <p style={{ ...hint, fontSize: 'var(--tp-fs-sm)', maxInlineSize: '70ch' }}>{tr(`${S}.lead`)}</p>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Switch checked={d.enabled} onChange={(enabled) => setD({ ...d, enabled })} label={tr(`${S}.enabled`)} disabled={readOnly} />
        <p style={hint}>{tr(`${S}.enabledHint`)}</p>
      </div>
      <Field
        label={tr(`${S}.size`)}
        hint={tr(`${S}.sizeHint`)}
        error={errors.size ? tr(`${S}.errors.size`) : undefined}
        style={{ marginBlockEnd: 0, maxInlineSize: '22rem' }}
      >
        <UnitInput
          unit={tr(`${S}.unit`)}
          value={d.size}
          onChange={(size) => setD({ ...d, size })}
          maxLength={String(STAMP_SIZE_MAX).length}
          disabled={readOnly}
          data-testid="stamp-card-size"
        />
      </Field>
      {byCard.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }} data-testid="stamp-card-by-card">
          {byCard.map((c) => (
            <li key={c.tier.id} style={{ fontSize: 'var(--tp-fs-sm)' }}>
              {tr(`${S}.byCard`, { card: pickName(locale, c.tier), n: formatNumber(c.size, locale) })}{' '}
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{tr(`${S}.byCardHint`)}</span>
            </li>
          ))}
        </ul>
      )}
      {menu.data ? (
        <>
          <Field
            label={tr(`${S}.categories`)}
            hint={tr(`${S}.categoriesHint`)}
            error={errors.categories ? tr(`${S}.errors.categories`) : undefined}
            group
            style={{ marginBlockEnd: 0 }}
          >
            <ChipPicker
              label={tr('ws.loyalty.setup.perks.menuSections')}
              options={menu.data.categories.map((c) => ({ id: c.id, label: pickName(locale, c) }))}
              selected={d.category_ids}
              disabled={readOnly}
              flush
              testId="stamp-card-categories"
              onToggle={(id) => setD({ ...d, category_ids: toggle(d.category_ids, id) })}
            />
          </Field>
          <Field label={tr(`${S}.excluded`)} hint={tr(`${S}.excludedHint`)} group style={{ marginBlockEnd: 0 }}>
            {items.length === 0 ? (
              <p style={hint}>{tr(`${S}.excludedEmpty`)}</p>
            ) : (
              <ChipPicker
                label={tr('ws.loyalty.setup.perks.menuItems')}
                options={items.map((i) => ({ id: i.id, label: pickName(locale, i) }))}
                selected={d.excluded_item_ids}
                disabled={readOnly}
                flush
                testId="stamp-card-excluded"
                onToggle={(id) => setD({ ...d, excluded_item_ids: toggle(d.excluded_item_ids, id) })}
              />
            )}
          </Field>
        </>
      ) : menu.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
          <ErrorText error={menu.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void menu.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <Skeleton lines={2} />
      )}
      <ErrorText error={error} />
      {canEdit && (
        <div>
          <Button kind="primary" busy={busy} disabled={!dirty || !reachable} onClick={() => void save()} data-testid="stamp-card-save">
            {tr(`${S}.save`)}
          </Button>
        </div>
      )}
    </div>
  );
}
