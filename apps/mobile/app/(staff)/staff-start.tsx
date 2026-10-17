import { useState, type ComponentType, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PRICE_CHANGE_KINDS,
  TOURNAMENT_VARIANTS,
  priceChangeKinds,
  randomPromoCode,
  startForm,
  startableKinds,
  validateStart,
  type FieldIssue,
  type LessonChangeKind,
  type PriceChangeKind,
  type ProtocolKind,
  type StaffRole,
  type TournamentVariant,
} from '@touch/core';
import { formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, ErrorText, Field, Hint, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import {
  ChevronIcon,
  PeopleIcon,
  SparkIcon,
  TagIcon,
  TrophyIcon,
  type IconProps,
} from '../../src/components/icons';
import { PhotoButton, type AttachedPhoto } from '../../src/components/PhotoButton';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import type { PhotoFolder } from '../../src/features/staff/photo';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import {
  fetchCafeCategories,
  fetchCourts,
  fetchIngredients,
  fetchPriceTargets,
  ingredientList,
  startProtocol,
} from '../../src/features/staff/protocols/api';
import { draftFromRecord, emptyDraft, recordFromDraft, setAt, type Draft } from '../../src/features/staff/protocols/assemble';
import { FormFields, type FieldPicker } from '../../src/features/staff/protocols/FormFields';
import { WEEKDAY_KEYS } from '../../src/features/staff/protocols/labels';
import {
  START_ROLES,
  bilingual,
  completeRenames,
  parseVariant,
  phoneStartChanges,
  priceProposeStart,
  startDecidedByStarter,
  targetKindOf,
  titlesFromRecord,
  type FixedRow,
} from '../../src/features/staff/protocols/logic';
import { ListCard, Muted, Section, Strong, serverIssue, useRefreshProtocols } from '../../src/features/staff/protocols/parts';
import type { PriceTargets } from '../../src/features/staff/protocols/types';
import { useAttachedPhotos } from '../../src/features/staff/protocols/useStepReads';
import { fetchIdeasToReview } from '../../src/features/staff/ideas/api';
import type { ReviewIdea } from '../../src/features/staff/ideas/logic';
import { searchField } from '../../src/components/fieldKeyboard';
import { TonePill, TournamentPlanStep, TYPE_TONE } from '../../src/features/staff/protocols/TournamentPlanStep';
import { newPlanId } from '../../src/features/staff/protocols/tournamentDraft';
import { parsePlanStep, phoneSteps } from '../../src/features/staff/protocols/tournamentSteps';
import { HiringStart } from '../../src/features/staff/protocols/HiringStart';
import { parseHiringStep } from '../../src/features/staff/protocols/hiringSteps';

/**
 * Start a protocol (build-contracts-2026-09-23 §6.1
 * `staff-start.tsx?kind=&variant=&change=&itemId=&addonId=&promotionId=&ruleId=`,
 * plus `ideaId` for a head starting a new item from their team's idea, #65).
 *
 * The kinds offered are the role's (`startableKinds`, the twin of the
 * `start_protocol` guard): a new item for the heads and management, a
 * tournament for management and the court desk (#67), hiring for management,
 * a price or promotion change for management and marketing, whose kinds are
 * `priceChangeKinds` (marketing never `shop_launch`). A start is the first
 * step's record, sent with the run (§2.8), so this page is that step's form.
 */

/** One choice in a ListCard: the choices are one list, split by hairlines, not a stack of cards. */
function ChoiceRow({
  testID,
  title,
  hint,
  onPress,
  last,
}: {
  testID: string;
  title: string;
  hint?: string | null;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        padding: space.m,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.sub,
        backgroundColor: pressed ? colors.sub : 'transparent',
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>{title}</Text>
        {hint ? <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>{hint}</Text> : null}
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

type Tone = 'blue' | 'green' | 'ink' | 'amber';

/** Each kind keeps its own icon and colour, on its variants and changes too. */
const KIND_LOOK: Record<ProtocolKind, { icon: ComponentType<IconProps>; tone: Tone }> = {
  product_release: { icon: SparkIcon, tone: 'green' },
  tournament: { icon: TrophyIcon, tone: 'blue' },
  hiring: { icon: PeopleIcon, tone: 'amber' },
  price_promo: { icon: TagIcon, tone: 'ink' },
};

/**
 * One choice of a short picker (what to start, the tournament type, the kind
 * of change) as its own card: a coloured icon badge, the title and its hint.
 * The long lists (the item or rule a change is aimed at) stay ChoiceRows.
 */
function ChoiceCard({
  testID,
  icon: Icon,
  tone,
  title,
  tag,
  hint,
  onPress,
}: {
  testID: string;
  icon: ComponentType<IconProps>;
  tone: Tone;
  title: string;
  /** A small label beside the title (a tournament type's kind). */
  tag?: ReactNode;
  hint?: string | null;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const badge = {
    blue: { bg: colors.tint, fg: colors.blue },
    green: { bg: colors.gtint, fg: colors.gstrong },
    ink: { bg: colors.sub, fg: colors.ink },
    amber: { bg: colors.amb, fg: colors.ambtext },
  }[tone];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
        padding: space.m,
        backgroundColor: pressed ? colors.sub : colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          backgroundColor: badge.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={22} color={badge.fg} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
          <Text style={{ fontFamily: fonts.display800, fontSize: 15.5, lineHeight: 20, color: colors.ink }}>{title}</Text>
          {tag}
        </View>
        {hint ? <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut }}>{hint}</Text> : null}
      </View>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.sub,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ChevronIcon size={14} color={colors.mut} />
      </View>
    </Pressable>
  );
}

/** The list a price or promotion change is aimed at. */
function TargetChooser({
  change,
  targets,
  onPick,
}: {
  change: PriceChangeKind;
  targets: PriceTargets;
  onPick: (id: string | null) => void;
}) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const kind = targetKindOf(change);
  const q = query.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const rows: { id: string; title: string; hint: string | null }[] = [];
  if (kind === 'item' || kind === 'featured') {
    for (const it of targets.items ?? []) {
      const prices = it.sizes.map((s) => formatIQD(s.price_iqd, locale)).join(' · ');
      const tags = [
        t(it.category_kind === 'shop' ? 'staff.protocols.start.shopItem' : 'staff.protocols.start.cafeItem'),
        it.is_active === false ? t('staff.protocols.start.hiddenItem') : null,
      ].filter(Boolean);
      rows.push({ id: it.menu_item_id, title: bilingual(locale, it.name_en, it.name_ar) ?? '', hint: [tags.join(' · '), prices].filter(Boolean).join('\n') });
    }
  }
  if (kind === 'promotion') {
    for (const p of targets.promotions ?? []) {
      rows.push({
        id: p.promotion_id,
        title: bilingual(locale, p.name_en, p.name_ar) ?? '',
        hint: t(p.enabled ? 'staff.protocols.start.promotionOn' : 'staff.protocols.start.promotionOff'),
      });
    }
  }
  if (kind === 'rule') {
    for (const r of targets.rules ?? []) {
      const court = bilingual(locale, r.court_name_en, r.court_name_ar);
      const when = t('staff.protocols.start.ruleNow', {
        days: r.days_of_week.map((d) => (WEEKDAY_KEYS[d] ? t(WEEKDAY_KEYS[d]) : String(d))).join(' '),
        from: r.start_time.slice(0, 5),
        to: r.end_time.slice(0, 5),
      });
      rows.push({ id: r.rule_id, title: r.name, hint: [court, when].filter(Boolean).join(' · ') });
    }
  }
  const featuredId = kind === 'featured' && typeof targets.featured_item_id === 'string' ? targets.featured_item_id : null;
  const featured = featuredId ? (targets.items ?? []).find((i) => i.menu_item_id === featuredId) : undefined;
  const shown = rows.filter((r) => matches(r.title));
  return (
    <View style={{ gap: space.s }}>
      <Strong>{t(`staff.protocols.start.targetTitle.${change as Exclude<PriceChangeKind, 'addon_price' | 'promotion' | LessonChangeKind>}`)}</Strong>
      {kind === 'featured' ? (
        featured ? (
          <ListCard>
            <ChoiceRow
              testID="staff-start.target.featured"
              title={t('staff.protocols.start.keepFeatured', { name: bilingual(locale, featured.name_en, featured.name_ar) ?? '' })}
              hint={t('staff.protocols.start.featuredNow', { pct: String(targets.featured_discount_pct ?? 0) })}
              onPress={() => onPick(null)}
              last
            />
          </ListCard>
        ) : (
          <Hint>{t('staff.protocols.start.featuredNone')}</Hint>
        )
      ) : null}
      {kind === 'rule' ? (
        <ListCard>
          <ChoiceRow testID="staff-start.target.new" title={t('staff.protocols.start.newRate')} onPress={() => onPick(null)} last />
        </ListCard>
      ) : null}
      {rows.length > 8 ? (
        <Field
          {...searchField}
          testID="staff-start.target.search"
          placeholder={t('staff.protocols.start.targetSearch')}
          value={query}
          onChangeText={setQuery}
          dense
        />
      ) : null}
      {rows.length === 0 && kind !== 'rule' ? <Hint>{t('staff.protocols.start.targetNone')}</Hint> : null}
      {shown.length > 0 ? (
        <ListCard>
          {shown.map((r, i) => (
            <ChoiceRow
              key={r.id}
              testID={`staff-start.target.${r.id}`}
              title={r.title}
              hint={r.hint}
              onPress={() => onPick(r.id)}
              last={i === shown.length - 1}
            />
          ))}
        </ListCard>
      ) : null}
    </View>
  );
}

interface FormSetup {
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  change: PriceChangeKind | null;
  draft: Draft;
  fixed: Record<string, { key: string; rows: FixedRow[] }>;
  hidden: string[];
  idea: ReviewIdea | null;
}

function StartForm({
  setup,
  role,
  venueId,
  initialPhotos,
  targets,
}: {
  setup: FormSetup;
  role: StaffRole;
  venueId: string;
  initialPhotos: AttachedPhoto[];
  targets: PriceTargets | undefined;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useLocalSearchParams<{ depth?: string }>();
  const toast = useToast();
  const refresh = useRefreshProtocols();
  const { kind, variant, change } = setup;
  const form = startForm(kind, { variant, change });
  const byOwner = role === 'owner';
  const decides = startDecidedByStarter(kind, role);
  const [draft, setDraft] = useState<Draft>(setup.draft);
  const [photos, setPhotos] = useState<AttachedPhoto[]>(initialPhotos);
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  // One start is one intent until it lands (§6.4).
  const [intent] = useState(() => `start:${kind}:${Date.now().toString(36)}`);
  const fixedKeys = Object.fromEntries(Object.entries(setup.fixed).map(([p, f]) => [p, f.key]));
  const promotionChange = change === 'promotion' || change === 'promotion_edit';
  // The featured discount's item, named (its id is picked, never typed).
  const featuredItem =
    change === 'featured_discount' ? (targets?.items ?? []).find((i) => i.menu_item_id === draft.menu_item_id) : undefined;

  const ingredients = useQuery({
    queryKey: staffKeys.ingredients(venueId),
    queryFn: () => fetchIngredients(venueId),
    select: ingredientList,
    enabled: kind === 'product_release',
  });
  const categories = useQuery({
    queryKey: staffKeys.cafeCategories(venueId),
    queryFn: () => fetchCafeCategories(venueId),
    enabled: (kind === 'product_release' && decides) || promotionChange,
  });
  const courts = useQuery({
    queryKey: staffKeys.courts(venueId),
    queryFn: () => fetchCourts(venueId),
    enabled: kind === 'tournament' || change === 'rate' || promotionChange,
  });
  // A promotion's item scope lists the venue's items on sale.
  const items = useQuery({
    queryKey: staffKeys.priceTargets(venueId, 'featured_discount'),
    queryFn: () => fetchPriceTargets(venueId, 'featured_discount'),
    enabled: promotionChange,
  });

  const option = (id: string, en: string | null | undefined, ar: string | null | undefined) => ({
    value: id,
    label: bilingual(locale, en, ar) ?? '',
  });
  const pickers: Record<string, FieldPicker> = {};
  if (ingredients.data) pickers['lines.ingredient_id'] = { options: ingredients.data.map((i) => option(i.id, i.name_en, i.name_ar)) };
  if (categories.data) {
    pickers.category_id = { options: categories.data.map((c) => option(c.id, c.name_en, c.name_ar)) };
    pickers['promotion.scope.categoryIds'] = pickers.category_id;
  }
  if (courts.data) {
    const list = { options: courts.data.map((c) => option(c.id, c.name_en, c.name_ar)) };
    pickers['ranges.court_ids'] = list;
    pickers['rule.court_id'] = list;
    pickers['promotion.scope.courtIds'] = list;
  }
  if (items.data?.items) {
    pickers['promotion.scope.itemIds'] = { options: items.data.items.map((i) => option(i.menu_item_id, i.name_en, i.name_ar)) };
  }

  const hints: Record<string, string> = {
    lines: t('staff.protocols.form.lineIngredientOrLabel'),
    sizes: t('staff.protocols.form.sizeName'),
  };
  if (kind === 'product_release' && decides) hints.category_id = t('staff.protocols.start.categoryHint');
  if (change === 'price') hints.prices = t('staff.protocols.start.pricesHint');
  if (change === 'shop_launch') hints.prices = t('staff.protocols.start.shopPricesHint');
  if (change === 'addon_price') hints.addons = t('staff.protocols.start.addonHint');
  // Wave 5 (§2.2, #9): what a rename asks for, and what it keeps.
  if (change === 'price') hints.renames = t('staff.protocols.start.renamesHint');
  if (change === 'addon_price') hints.renames = t('staff.protocols.start.addonRenamesHint');

  const start = useMutation({
    mutationKey: staffKeys.mutation('start'),
    mutationFn: (args: { record: Record<string, unknown>; en: string | null; ar: string | null }) =>
      startProtocol({
        kind,
        variant,
        titleEn: args.en,
        titleAr: args.ar,
        data: setup.idea ? { idea_id: setup.idea.id } : {},
        record: args.record,
        photos: photos.map((p) => p.path),
        venueId,
        idempotencyKey: staffIntentKey(intent, 'start'),
      }),
    onSuccess: (result) => {
      clearStaffIntentKey(intent);
      toast(t(result.auto ? 'staff.protocols.start.startedAuto' : 'staff.protocols.start.started'), 'success');
      void refresh();
      // Each choice was its own page; take them off so back from the run
      // goes where the start began, not to a picker.
      const steps = stepDepth(params.depth);
      if (steps > 0) router.dismiss(steps);
      router.replace({ pathname: '/staff-run', params: { id: result.run_id } });
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      const issue = serverIssue(err);
      if (issue) setIssues((all) => [...all, issue]);
    },
  });

  const onSubmit = () => {
    setError(null);
    // A rename's empty language keeps today's name, and a row that renames
    // nothing is dropped with the untouched fixed rows (wave 5 §2.2, #9).
    const record = recordFromDraft(form.fields, completeRenames(draft, setup.fixed.renames), { fixedKeys });
    const fallback = titlesFromRecord(kind, record);
    const typedEn = titleEn.trim() || null;
    const typedAr = titleAr.trim() || null;
    const en = typedEn ?? (typedAr ? null : fallback.en);
    const ar = typedAr ?? (typedEn ? null : fallback.ar);
    const found = validateStart(
      { kind, variant, change, titleEn: en, titleAr: ar, record, byOwner },
      { submitterDecides: decides, photos: photos.length },
    );
    setIssues(found);
    if (found.length > 0) {
      setError(t('staff.protocols.step.checkForm'));
      return;
    }
    start.mutate({ record, en, ar });
  };

  const titleIssue = issues.find((i) => i.field === 'title');
  const titleHint = [
    t(byOwner ? 'staff.protocols.start.titleHintOwner' : 'staff.protocols.start.titleHint'),
    kind === 'product_release' || kind === 'tournament' ? t('staff.protocols.start.titleFromName') : null,
  ]
    .filter(Boolean)
    .join(' ');

  // A new item's or a tournament's title falls back to the name typed in the
  // form, so it is asked for after the form, where "leave it empty to use the
  // name" makes sense. A hire or a price change has no name to fall back on:
  // its title is its subject and comes first.
  const titleAfterForm = kind === 'product_release' || kind === 'tournament';
  const titleSection = (
    <Section title={t('staff.protocols.start.titleSection')}>
      <Field
        testID="staff-start.field.title_en"
        label={t('staff.protocols.field.en')}
        value={titleEn}
        onChangeText={(v) => {
          setTitleEn(v);
          setIssues((all) => all.filter((i) => i.field !== 'title'));
        }}
        maxLength={120}
      />
      <Field
        testID="staff-start.field.title_ar"
        label={t('staff.protocols.field.ar')}
        value={titleAr}
        onChangeText={(v) => {
          setTitleAr(v);
          setIssues((all) => all.filter((i) => i.field !== 'title'));
        }}
        maxLength={120}
        error={titleIssue ? t(`op.errors.${titleIssue.code}` as MessageKey) : null}
      />
      <Hint>{titleHint}</Hint>
    </Section>
  );

  return (
    <>
      {setup.idea ? (
        <Hint>{t('staff.protocols.start.fromIdea', { name: isolate(setup.idea.author_name ?? '') })}</Hint>
      ) : null}
      {titleAfterForm ? null : titleSection}
      <Section title={t(`work.protocol.kind.${kind}`)}>
        {change ? <Strong>{t(`work.protocol.change.${change}`)}</Strong> : null}
        <FormFields
          testID="staff-start"
          fields={form.fields}
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setIssues((all) => all.filter((i) => i.field === 'title'));
          }}
          issues={issues}
          hidden={new Set(setup.hidden)}
          pickers={pickers}
          fixed={setup.fixed}
          hints={hints}
          deciderFields={decides}
          disabled={start.isPending}
        />
        {promotionChange ? (
          <Button
            testID="staff-start.draw-code"
            label={t('staff.protocols.form.drawCode')}
            variant="ghost"
            onPress={() =>
              setDraft((d) =>
                setAt(d, ['promotion', 'public_code'], randomPromoCode((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)))),
              )
            }
            style={{ alignSelf: 'flex-start' }}
          />
        ) : null}
        {featuredItem ? <Muted>{bilingual(locale, featuredItem.name_en, featuredItem.name_ar) ?? ''}</Muted> : null}
      </Section>
      {titleAfterForm ? titleSection : null}
      {form.photoFolder && form.photosMax > 0 ? (
        <Section title={t('staff.protocols.start.photosTitle')}>
          <PhotoButton
            testID="staff-start.photo"
            venueId={venueId}
            folder={form.photoFolder as PhotoFolder}
            photos={photos}
            onChange={setPhotos}
            max={form.photosMax}
            disabled={start.isPending}
          />
        </Section>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button testID="staff-start.submit" label={t('staff.protocols.start.submit')} variant="cta" busy={start.isPending} onPress={onSubmit} />
    </>
  );
}

/** The idea's form and photos once they are read; a start from nothing needs neither. */
function StartFromSetup(props: {
  setup: FormSetup;
  role: StaffRole;
  venueId: string;
  targets: PriceTargets | undefined;
}) {
  const photos = useAttachedPhotos(props.setup.idea?.photos ?? []);
  if (!photos) return <SkeletonList rows={2} height={64} />;
  return <StartForm {...props} initialPhotos={photos} />;
}

/** How many choice pages sit above the first start page (the `depth` param). */
function stepDepth(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Each choice (the kind, the tournament type, the change, its target) opens
 * the next step as a page of its own, so the native back goes back one step
 * at a time to the first choice (owner, 2026-10-16). The choices travel as
 * params, the same ones a link from elsewhere uses.
 */
function StartScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{
    kind?: string;
    variant?: string;
    change?: string;
    itemId?: string;
    addonId?: string;
    promotionId?: string;
    ruleId?: string;
    ideaId?: string;
    /** `none`: the change's own choice without a listed target (a new rate, the featured item kept). */
    target?: string;
    depth?: string;
    /** A tournament start: the plan its pages share (tournamentDraft.ts) and the page. */
    plan?: string;
    step?: string;
    /** A hiring step opened again from the Check page: its button goes back there. */
    ret?: string;
  }>();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const kinds = startableKinds(role);
  // Lesson prices are started on the operator, where the lesson types are
  // (coaching 0285): neither the list nor a link starts one here.
  const changes = phoneStartChanges(priceChangeKinds(role));
  const paramKind = kinds.find((k) => k === params.kind) ?? null;
  const kind: ProtocolKind | null = paramKind ?? (kinds.length === 1 ? kinds[0]! : null);
  const variant: TournamentVariant | null = parseVariant(params.variant);
  const change: PriceChangeKind | null = changes.find((c) => c === params.change) ?? null;
  // A link may name the target (a price change from an item); add-ons are all listed anyway.
  const paramTarget = params.itemId ?? params.promotionId ?? params.ruleId ?? null;
  const targetId = paramTarget;
  const hasTarget = paramTarget !== null || params.target === 'none';
  const venue = venueId ?? '';
  const [linkPlan] = useState(newPlanId);

  const targetKind = change ? targetKindOf(change) : 'none';
  const needsTargets = kind === 'price_promo' && change !== null && change !== 'promotion';
  const targets = useQuery({
    queryKey: staffKeys.priceTargets(venue, change ?? ''),
    queryFn: () => fetchPriceTargets(venue, change as string),
    enabled: venue !== '' && needsTargets,
  });
  const ideaId = kind === 'product_release' && typeof params.ideaId === 'string' ? params.ideaId : null;
  const ideas = useQuery({
    queryKey: staffKeys.ideasToReview(venue),
    queryFn: () => fetchIdeasToReview(venue),
    enabled: venue !== '' && ideaId !== null,
  });

  // Plain, not useMemo: the choices are params now, and the React Compiler memoizes it.
  const setup = ((): FormSetup | null => {
    if (!kind) return null;
    if (kind === 'tournament' && !variant) return null;
    if (kind === 'price_promo') {
      if (!change) return null;
      if (needsTargets && !targets.data) return null;
      if ((targetKind === 'item' || targetKind === 'promotion') && !hasTarget) return null;
      if ((targetKind === 'rule' || targetKind === 'featured') && !hasTarget) return null;
      const s = priceProposeStart(change, targets.data, targetId);
      return { kind, variant: null, change, draft: s.draft, fixed: s.fixed, hidden: s.hidden, idea: null };
    }
    const form = startForm(kind, { variant });
    if (ideaId) {
      if (!ideas.data) return null;
      const idea = ideas.data.ideas.find((i) => i.id === ideaId) ?? null;
      if (idea) {
        return { kind, variant, change: null, draft: draftFromRecord(form.fields, idea.record), fixed: {}, hidden: [], idea };
      }
    }
    const draft = emptyDraft(form.fields);
    if (kind === 'tournament') draft.capacity = { unit: 'players', count: '' };
    return { kind, variant, change: null, draft, fixed: {}, hidden: [], idea: null };
  })();

  const offeredChanges = PRICE_CHANGE_KINDS.filter((c) => changes.includes(c));

  /** The next step, as a page over this one. */
  const next = (step: Record<string, string>) =>
    router.push({
      pathname: '/staff-start',
      params: {
        ...(kind ? { kind } : {}),
        ...(variant ? { variant } : {}),
        ...(change ? { change } : {}),
        ...(typeof params.ideaId === 'string' ? { ideaId: params.ideaId } : {}),
        ...step,
        depth: String(stepDepth(params.depth) + 1),
      },
    });
  const pickTarget = (id: string | null) => {
    if (id === null) return next({ target: 'none' });
    if (targetKind === 'promotion') return next({ promotionId: id });
    if (targetKind === 'rule') return next({ ruleId: id });
    return next({ itemId: id });
  };

  const body = (() => {
    if (!role || !venueId) return <SkeletonList rows={2} height={72} />;
    if (params.kind && !paramKind && !kind) return <Hint>{t('staff.protocols.start.notAllowed')}</Hint>;
    if (!kind) {
      return (
        <View style={{ gap: space.s }}>
          <Strong>{t('staff.protocols.start.lead')}</Strong>
          {kinds.map((k) => (
            <ChoiceCard
              key={k}
              testID={`staff-start.kind.${k}`}
              icon={KIND_LOOK[k].icon}
              tone={KIND_LOOK[k].tone}
              title={t(`work.protocol.kind.${k}`)}
              hint={t(`staff.protocols.start.kindHint.${k}`)}
              onPress={() => next(k === 'hiring' ? { kind: k, plan: newPlanId(), step: 'role' } : { kind: k })}
            />
          ))}
        </View>
      );
    }
    if (kind === 'tournament' && !variant) {
      return (
        <View style={{ gap: space.s }}>
          <Strong>{t('staff.protocols.start.variantTitle')}</Strong>
          {TOURNAMENT_VARIANTS.map((v) => (
            <ChoiceCard
              key={v}
              testID={`staff-start.field.variant.${v}`}
              icon={KIND_LOOK.tournament.icon}
              tone={KIND_LOOK.tournament.tone}
              title={t(`work.protocol.variant.${v}`)}
              tag={<TonePill label={t(`ws.tournaments.start.typeTag.${v}`)} tone={TYPE_TONE[v]} />}
              hint={t(`staff.protocols.start.variantHint.${v}`)}
              onPress={() => next({ variant: v, plan: newPlanId(), step: phoneSteps(v)[0]! })}
            />
          ))}
        </View>
      );
    }
    if (kind === 'price_promo' && !change) {
      return (
        <View style={{ gap: space.s }}>
          <Strong>{t('staff.protocols.start.changeTitle')}</Strong>
          {offeredChanges.map((c) => (
            <ChoiceCard
              key={c}
              testID={`staff-start.change.${c}`}
              icon={KIND_LOOK.price_promo.icon}
              tone={KIND_LOOK.price_promo.tone}
              title={t(`work.protocol.change.${c}`)}
              onPress={() => next({ change: c })}
            />
          ))}
        </View>
      );
    }
    if (kind === 'price_promo' && change && needsTargets && !targets.data) {
      return targets.isError ? (
        <ErrorState
          testID="staff-start.targets-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(targets.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void targets.refetch()}
        />
      ) : (
        <SkeletonList rows={3} height={72} />
      );
    }
    if (kind === 'price_promo' && change && targets.data && !hasTarget && targetKind !== 'addons' && targetKind !== 'none') {
      return <TargetChooser change={change} targets={targets.data} onPick={pickTarget} />;
    }
    if (ideaId && ideas.isPending) return <SkeletonList rows={2} height={72} />;
    if (!setup) return <SkeletonList rows={2} height={72} />;
    return (
      <>
        {ideaId && !setup.idea ? <Hint>{t('staff.protocols.start.ideaGone')}</Hint> : null}
        <StartFromSetup
          key={`${kind}:${variant ?? ''}:${change ?? ''}:${targetId ?? ''}`}
          setup={setup}
          role={role}
          venueId={venueId}
          targets={targets.data}
        />
      </>
    );
  })();

  // A hire: Role, The job, Pay, Check, a page each.
  if (kind === 'hiring' && role && venueId) {
    return (
      <HiringStart
        planId={typeof params.plan === 'string' ? params.plan : linkPlan}
        step={parseHiringStep(params.step)}
        depth={stepDepth(params.depth)}
        returnTo={params.ret === 'check' ? 'check' : null}
        byOwner={role === 'owner'}
        venueId={venueId}
      />
    );
  }

  // A tournament, once its type is picked: the plan's steps, a page each.
  if (kind === 'tournament' && variant && role && venueId) {
    return (
      <TournamentPlanStep
        planId={typeof params.plan === 'string' ? params.plan : linkPlan}
        variant={variant}
        step={parsePlanStep(params.step, variant)}
        depth={stepDepth(params.depth)}
        byOwner={role === 'owner'}
        venueId={venueId}
      />
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: kind && kinds.length > 1 ? t(`work.protocol.kind.${kind}`) : t('staff.protocols.start.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </Screen>
  );
}

export default function StaffStartRoute() {
  return (
    <RequireStaff roles={START_ROLES}>
      <StartScreen />
    </RequireStaff>
  );
}
