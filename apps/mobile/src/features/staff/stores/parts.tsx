/**
 * Pieces the three store pages share (wave5-addendum-2026-09-25 §5.3): the
 * inline notice, the item finder, one line of a log or a move, and the unit a
 * quantity is typed in. Every id is minted by the page and passed in; a piece
 * derives its children's ids from it (`${testID}.<child>`), never on its own.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { ErrorText, Field, Hint, LinkText, SegmentedControl } from '../../../components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../../components/states';
import { ChevronIcon } from '../../../components/icons';
import { localName } from '../checklists/logic';
import { Tag } from '../checklists/parts';
import { formatQty } from '../supplies/logic';
import { parseQty } from '../supplies/production';
import { mapStaffError } from '../edge';
import {
  isCapped,
  lineBaseQty,
  pickMatches,
  unitChoices,
  type LineDraft,
  type LineUnit,
  type PickItem,
  type PickList,
} from './logic';

/** A quantity in the item's unit: "2,000 g", "12 pieces". */
export function useQtyText(): (qty: number, unit: string) => string {
  const { t, locale } = useLocale();
  return (qty, unit) => formatQty(t, locale, qty, unit);
}

/**
 * A sentence the page needs read before anything else (a count already
 * waiting, the driver's purchases the manager has yet to take in): the amber
 * ground and a full hairline, the Tag's "waiting" family. Never a side stripe.
 */
export function Notice({ children, testID }: { children: ReactNode; testID: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{
        paddingStart: space.m,
        paddingEnd: space.m,
        paddingTop: space.sm,
        paddingBottom: space.sm,
        borderRadius: radius.cell,
        borderWidth: 1,
        borderColor: colors.ambline,
        backgroundColor: colors.amb,
      }}
    >
      <Text
        style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ambtext }}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * The finder: a search field and, under it, the items it matches (or the
 * whole list when it is short). Pressing one hands it to the page, which adds
 * a line; the search clears so the next item is one more word away.
 *
 * `aside` is the one fact a row carries on its end (what the source holds, for
 * a move). The read's own states live here too, so a page never shows a
 * finder over a list that failed to load.
 */
export function ItemFinder({
  testID,
  list,
  loading,
  error,
  onRetry,
  query,
  onQuery,
  taken,
  onPick,
  aside,
  showKind = false,
  emptyTitle,
  emptyBody,
}: {
  /** The page's route (`staff-stock-log`): the field is `.find`, a row `.item.<ingredientId>`. */
  testID: string;
  list: PickList | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  query: string;
  onQuery: (q: string) => void;
  /** Items already on the form, left out of the matches. */
  taken: ReadonlySet<string>;
  onPick: (item: PickItem) => void;
  aside?: (item: PickItem) => string | null;
  /** Tag shop stock, for a role that logs both kinds. */
  showKind?: boolean;
  emptyTitle: string;
  emptyBody: string;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();

  if (loading) return <SkeletonList rows={2} height={48} />;
  if (error) {
    return (
      <ErrorState
        testID={`${testID}.pick-error`}
        title={t('errors.loadFailedTitle')}
        message={t(mapStaffError(error))}
        retryLabel={t('common.retry')}
        onRetry={onRetry}
      />
    );
  }
  const items = list?.items ?? [];
  if (items.length === 0) {
    return <EmptyState testID={`${testID}.pick-empty`} title={emptyTitle} message={emptyBody} />;
  }
  const matches = pickMatches(items, query, taken);
  const typed = query.trim() !== '';
  // Nothing typed and nothing offered: say how to find one, unless every item is already on the form.
  const hint = typed
    ? t('staff.stores.noMatch')
    : matches.length === 0 && items.some((i) => !taken.has(i.ingredient_id))
      ? t('staff.stores.findHint')
      : null;

  return (
    <View>
      <Field
        testID={`${testID}.find`}
        label={t('staff.stores.find')}
        value={query}
        onChangeText={onQuery}
        autoCorrect={false}
        dense
      />
      {matches.length > 0 ? (
        <View
          style={{
            marginTop: space.s,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.cell,
            overflow: 'hidden',
          }}
        >
          {matches.map((item, i) => {
            const side = aside?.(item) ?? null;
            return (
              <Pressable
                key={item.ingredient_id}
                testID={`${testID}.item.${item.ingredient_id}`}
                accessibilityRole="button"
                accessibilityLabel={
                  side ? `${localName(item, locale)}, ${side}` : localName(item, locale)
                }
                onPress={() => onPick(item)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  paddingStart: space.m,
                  paddingEnd: space.m,
                  paddingTop: 11,
                  paddingBottom: 11,
                  minHeight: 44,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.sub,
                  backgroundColor: pressed ? colors.sub : colors.card,
                })}
              >
                <Text
                  style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}
                >
                  {localName(item, locale)}
                </Text>
                {showKind && item.kind === 'retail' ? (
                  <Tag label={t('staff.checklists.stock.filter.retail')} />
                ) : null}
                {side ? (
                  <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                    {side}
                  </Text>
                ) : null}
                <ChevronIcon size={14} color={colors.fnt} />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Hint>{hint}</Hint>
      )}
      {isCapped(list) ? <Hint>{t('staff.stores.capped')}</Hint> : null}
    </View>
  );
}

/**
 * The unit a quantity is typed in, when the item comes in packs: its base
 * unit or packs. One unit is no choice, so it shows no control.
 */
export function UnitToggle({
  testID,
  item,
  value,
  onChange,
}: {
  testID: string;
  item: Pick<PickItem, 'unit' | 'pack_size'>;
  value: LineUnit;
  onChange: (unit: LineUnit) => void;
}) {
  const { t } = useLocale();
  const choices = unitChoices(item);
  if (choices.length < 2) return null;
  return (
    <SegmentedControl<LineUnit>
      testID={testID}
      fit
      options={choices.map((u) => ({
        value: u,
        label: t(
          u === 'pack'
            ? 'staff.supplies.units.many.pack'
            : `staff.supplies.units.many.${item.unit}`,
        ),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * "1 pack = 500 g", and once an amount is typed "5 packs = 2,500 g": what a
 * line in packs comes to, so nobody multiplies in their head.
 */
export function PackNote({ line }: { line: Pick<LineDraft, 'item' | 'qty' | 'unit'> }) {
  const { t } = useLocale();
  const qtyText = useQtyText();
  if (line.unit !== 'pack' || !line.item.pack_size) return null;
  const base = lineBaseQty(line);
  const packs = parseQty(line.qty);
  return (
    <Hint style={{ marginTop: space.xs }}>
      {base !== null && packs !== null
        ? t('staff.stores.packTotal', {
            packs: qtyText(packs, 'pack'),
            qty: qtyText(base, line.item.unit),
          })
        : t('staff.stores.packSize', { qty: qtyText(line.item.pack_size, line.item.unit) })}
    </Hint>
  );
}

export interface LineErrors {
  qty?: string | null;
  expiry?: string | null;
  kind?: string | null;
}

/**
 * One line of a log or a move: the item, Remove, How much and its unit, the
 * fact under it (what the source holds), and for a log the use-by date behind
 * a link, since most deliveries have none worth typing.
 */
export function LineEditor({
  testID,
  line,
  onChange,
  onRemove,
  errors,
  note,
  expiry,
}: {
  /** The page's route: children are `.qty.<id>`, `.unit.<id>`, `.remove.<id>`, `.expiry.<id>`. */
  testID: string;
  line: LineDraft;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  errors: LineErrors;
  /** A fact under the amount (what the source store holds). */
  note?: string | null;
  /** The use-by field (Add to stock only): its example day. */
  expiry?: { example: string } | null;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const id = line.item.ingredient_id;
  const packs = unitChoices(line.item).length > 1;
  const unitWord = t(`staff.supplies.units.many.${line.item.unit}` as MessageKey);

  return (
    <View style={{ gap: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s,
        }}
      >
        <Text style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
          {localName(line.item, locale)}
        </Text>
        <LinkText
          testID={`${testID}.remove.${id}`}
          label={t('staff.stores.remove')}
          color={colors.redtext}
          onPress={onRemove}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Field
            testID={`${testID}.qty.${id}`}
            label={packs ? t('staff.stores.qty') : `${t('staff.stores.qty')} (${unitWord})`}
            value={line.qty}
            onChangeText={(qty) => onChange({ qty })}
            keyboardType="decimal-pad"
            latin
            dense
            accessibilityLabel={`${localName(line.item, locale)}, ${t('staff.stores.qty')}`}
          />
        </View>
        <UnitToggle
          testID={`${testID}.unit.${id}`}
          item={line.item}
          value={line.unit}
          onChange={(unit) => onChange({ unit })}
        />
      </View>
      <PackNote line={line} />
      {/* A refused amount names the figure itself, so the note steps aside. */}
      {note && !errors.qty ? <Hint style={{ marginTop: space.xs }}>{note}</Hint> : null}
      <ErrorText>{errors.qty ?? errors.kind ?? null}</ErrorText>
      {expiry ? (
        line.expiryOpen ? (
          <View>
            <Field
              testID={`${testID}.expiry.${id}`}
              label={t('staff.stores.log.expiry')}
              value={line.expiry}
              onChangeText={(value) => onChange({ expiry: value })}
              keyboardType="numbers-and-punctuation"
              latin
              dense
              error={errors.expiry ?? null}
            />
            {errors.expiry ? null : (
              <Hint style={{ marginTop: space.xs }}>
                {t('staff.stores.log.expiryHint', { example: expiry.example })}
              </Hint>
            )}
          </View>
        ) : (
          <LinkText
            testID={`${testID}.expiry-add.${id}`}
            label={t('staff.stores.log.expiryAdd')}
            onPress={() => onChange({ expiryOpen: true })}
            style={{ marginTop: space.s }}
          />
        )
      ) : null}
    </View>
  );
}
