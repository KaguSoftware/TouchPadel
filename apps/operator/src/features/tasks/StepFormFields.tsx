/**
 * The body of any protocol form on /tasks: a start (the first step's record)
 * or one open step. It picks the field list from `@touch/core/protocols`,
 * loads the choices its id fields need, and draws the photos the step takes.
 *
 * Where a field's choices come from (build-contracts-2026-09-23 §6.1, the
 * phone's reads, which the operator mirrors):
 *   - a recipe line's ingredient: app.staff_ingredient_options (no cost, §2.5);
 *   - a test's sizes: app.release_test_context (§2.9);
 *   - courts: the active courts every desk screen reads;
 *   - a campaign draft: marketing's own app.my_campaign_drafts (§2.17);
 *   - a price or promo change's targets: app.price_promo_targets (§2.13), and
 *     a promotion's scope from the menu and courts every staff session reads.
 */
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  priceChangeKinds,
  randomPromoCode,
  type FieldIssue,
  type PriceChangeKind,
  type ProtocolKind,
  type StepForm,
  type TournamentVariant,
} from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchActiveCourts } from '../../lib/queries';
import { useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button, Field, Select } from '../../components/ui';
import { bilingual, list, str } from '../roleExtras/roleExtrasLogic';
import { RK } from '../roleExtras/keys';
import { TK } from './keys';
import { ProtocolForm, type FormOption } from './ProtocolForm';
import { PhotoField } from './PhotoField';
import { emptyDraft, type Draft } from './formModel';
import { deriveDraft, needsTargets, readTargets, startDraft, targetSources } from './priceLogic';

export interface StepFormFieldsProps {
  kind: ProtocolKind;
  stepKey: string | null;
  form: StepForm;
  variant?: TournamentVariant | null;
  /** Price or promo propose: the change kind, and whether the form may still switch it. */
  change?: PriceChangeKind | null;
  changeLocked?: boolean;
  onChangeKind?: (change: PriceChangeKind) => void;
  /** The run, for a step's context read (a test's sizes). */
  runId?: string | null;
  draft: Draft;
  onDraft: (next: Draft) => void;
  photos: string[];
  onPhotos: (next: string[]) => void;
  issues?: readonly FieldIssue[];
  disabled?: boolean;
}

/** Fields the operator never draws on /tasks: the kind picker is drawn above, a category is the decider's. */
const HIDDEN = new Set(['change', 'category_id', 'reservation_ids']);

function has(form: StepForm, path: string): boolean {
  const [head, ...rest] = path.split('.');
  let fields = form.fields;
  let def = fields.find((f) => f.name === head);
  for (const name of rest) {
    fields = def?.fields ?? [];
    def = fields.find((f) => f.name === name);
  }
  return Boolean(def);
}

export function StepFormFields(props: StepFormFieldsProps) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const { form, kind, stepKey, draft } = props;
  const isPropose = kind === 'price_promo' && stepKey === 'propose';
  const change = props.change ?? null;

  const wantIngredients = has(form, 'lines.ingredient_id');
  const wantCourts = has(form, 'ranges.court_ids') || has(form, 'rule.court_id') || has(form, 'promotion.scope.courtIds');
  const wantMenu = has(form, 'promotion.scope.categoryIds');
  const wantCampaigns = has(form, 'campaign_id');
  const wantTestSizes = kind === 'product_release' && stepKey === 'test' && Boolean(props.runId);
  const wantTargets = isPropose && change !== null && needsTargets(change);

  const ingredientsQ = useQuery({
    queryKey: RK.phone('ingredients'),
    queryFn: () => appRpc<unknown>('staff_ingredient_options', {}),
    enabled: wantIngredients,
    staleTime: 5 * 60_000,
  });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, enabled: wantCourts });
  const menuQ = useQuery({
    queryKey: TK.options('menu'),
    enabled: wantMenu,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [cats, items] = await Promise.all([
        supabase.from('menu_categories').select('id, name_en, name_ar').eq('is_active', true).order('sort_order'),
        supabase.from('menu_items').select('id, name_en, name_ar').eq('is_active', true).order('sort_order'),
      ]);
      if (cats.error) throw cats.error;
      if (items.error) throw items.error;
      return { categories: (cats.data ?? []) as unknown[], items: (items.data ?? []) as unknown[] };
    },
  });
  const campaignsQ = useQuery({
    queryKey: TK.options('campaignDrafts'),
    queryFn: () => appRpc<unknown>('my_campaign_drafts', {}),
    enabled: wantCampaigns,
    retry: false,
  });
  const testQ = useQuery({
    queryKey: TK.context('release_test_context', props.runId ?? ''),
    queryFn: () => appRpc<unknown>('release_test_context', { p_run_id: props.runId }),
    enabled: wantTestSizes,
  });
  const targetsQ = useQuery({
    queryKey: TK.targets(change ?? ''),
    queryFn: () => appRpc<unknown>('price_promo_targets', { p_change: change }),
    enabled: wantTargets,
  });
  const targets = useMemo(() => (targetsQ.data === undefined ? null : readTargets(targetsQ.data)), [targetsQ.data]);

  // A test's servings start as one of each size, so the head only changes counts.
  const testSizes = useMemo(() => list((testQ.data as { sizes?: unknown } | undefined)?.sizes), [testQ.data]);
  useEffect(() => {
    if (!wantTestSizes || testSizes.length === 0) return;
    const servings = Array.isArray(draft.servings) ? (draft.servings as Draft[]) : [];
    if (servings.some((s) => typeof s.variant_id === 'string' && s.variant_id !== '')) return;
    props.onDraft({ ...draft, servings: testSizes.map((s) => ({ variant_id: str(s.variant_id) ?? '', count: 1 })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTestSizes, testSizes]);

  // The featured discount opens on what is stored today.
  useEffect(() => {
    if (!isPropose || change !== 'featured_discount' || !targets) return;
    if (draft.menu_item_id || draft.discount_pct !== null) return;
    props.onDraft(startDraft(change, form.fields, draft, targets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  const sources = useMemo(() => {
    const out: Record<string, FormOption[]> = {};
    const named = (rows: unknown[]) =>
      rows
        .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string')
        .map((r) => ({ value: r.id as string, label: bilingual(locale, str(r.name_en), str(r.name_ar)) }));
    if (ingredientsQ.data) {
      out['lines.ingredient_id'] = list((ingredientsQ.data as { ingredients?: unknown }).ingredients).map((i) => ({
        value: str(i.id) ?? '',
        label: bilingual(locale, str(i.name_en), str(i.name_ar)),
      }));
    }
    if (courtsQ.data) {
      const courts = courtsQ.data.map((c) => ({ value: c.id, label: bilingual(locale, c.name_en, c.name_ar) }));
      out['ranges.court_ids'] = courts;
      out['rule.court_id'] = courts;
      out['promotion.scope.courtIds'] = courts;
    }
    if (menuQ.data) {
      out['promotion.scope.categoryIds'] = named(menuQ.data.categories);
      out['promotion.scope.itemIds'] = named(menuQ.data.items);
    }
    if (campaignsQ.data) {
      out.campaign_id = list((campaignsQ.data as { drafts?: unknown }).drafts).map((d) => ({
        value: str(d.id) ?? '',
        label: bilingual(locale, str(d.name_en), str(d.name_ar)) || '—',
      }));
    }
    if (testSizes.length > 0) {
      out['servings.variant_id'] = testSizes.map((s) => ({ value: str(s.variant_id) ?? '', label: bilingual(locale, str(s.name_en), str(s.name_ar)) }));
    }
    if (targets) Object.assign(out, targetSources(targets, draft, locale));
    return out;
  }, [ingredientsQ.data, courtsQ.data, menuQ.data, campaignsQ.data, testSizes, targets, draft, locale]);

  const hints: Record<string, string> = {
    'lines.label': tr('ws.team.tasks.form.hint.label'),
    'servings.count': tr('ws.team.tasks.form.hint.servings'),
    rule_id: tr('ws.team.tasks.form.hint.ruleId'),
    discount_pct: tr('ws.team.tasks.form.hint.discountPct'),
    'promotion.value': tr('ws.team.tasks.form.hint.promotionValue'),
    'promotion.public_code': tr('ws.team.tasks.form.hint.publicCode'),
    'rule.prices': tr('ws.team.tasks.form.hint.rulePrices'),
  };

  const onDraft = (next: Draft) => props.onDraft(isPropose && change ? deriveDraft(change, draft, next, targets) : next);
  const photoIssue = (props.issues ?? []).some((i) => i.field === 'photos');
  const kinds = priceChangeKinds(staff?.role);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {isPropose && (
        <Field label={tr('ws.team.tasks.form.field.change')} required>
          <Select<PriceChangeKind>
            value={change ?? ''}
            disabled={props.disabled || props.changeLocked}
            placeholder={tr('ws.team.tasks.form.choose')}
            onChange={(c) => props.onChangeKind?.(c)}
            options={kinds.map((k) => ({ value: k, label: tr(`work.protocol.change.${k}`) }))}
          />
        </Field>
      )}
      {isPropose && change === null ? null : (
        <>
          {wantTargets && targetsQ.isSuccess && Object.values(targetSources(targets!, draft, locale)).every((o) => o.length === 0) && (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.team.tasks.form.noTargets')}</p>
          )}
          <ProtocolForm
            fields={form.fields}
            draft={draft}
            onChange={onDraft}
            sources={sources}
            hidden={HIDDEN}
            hints={hints}
            issues={props.issues}
            disabled={props.disabled}
          />
          {isPropose && (change === 'promotion' || change === 'promotion_edit') && (
            <div style={{ marginBlockStart: 'calc(-1 * var(--tp-sp-2))', marginBlockEnd: 'var(--tp-sp-3)' }}>
              <Button
                size="sm"
                kind="ghost"
                icon="refresh"
                disabled={props.disabled}
                onClick={() => {
                  // Drawn from the promotion codes' own alphabet, as the phone does (§2.13).
                  const code = randomPromoCode((n) => crypto.getRandomValues(new Uint8Array(n)));
                  const promotion = (draft.promotion as Draft | null) ?? emptyDraft([]);
                  onDraft({ ...draft, promotion: { ...promotion, public_code: code } });
                }}
                data-testid="promotion.code.random"
              >
                {tr('ws.team.tasks.form.randomCode')}
              </Button>
            </div>
          )}
        </>
      )}
      {form.photoFolder && form.photosMax > 0 && (
        <PhotoField
          folder={form.photoFolder}
          paths={props.photos}
          onChange={props.onPhotos}
          min={form.photosMin}
          max={form.photosMax}
          disabled={props.disabled}
          error={photoIssue ? tr('ws.team.tasks.photos.countIssue') : undefined}
        />
      )}
    </div>
  );
}
