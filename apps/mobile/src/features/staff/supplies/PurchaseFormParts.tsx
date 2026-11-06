/**
 * The pieces of the purchase form's three pages: the step's title with "Step n
 * of 3", the bar's total and its green progress bar, and an item's card with
 * its inputs (build-contracts-2026-09-23 §6.1; plan #70).
 */
import { Platform, Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { formatIQD } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../../theme';
import { ErrorText, Hint } from '../../../components/ui';
import { CloseIcon } from '../../../components/icons';
import type { FieldChain } from '../../../components/fieldChain';
import type { IngredientOption, ShoppingItem } from './api';
import {
  boughtUnit,
  formatQty,
  isPricedEach,
  lineName,
  lineTotal,
  type PurchaseField,
  type PurchaseLineDraft,
  type ShoppingUnit,
} from './logic';

/** The step's title and "Step n of 3" under the native bar. */
export function StepHead({ title, step }: { title: string; step: 1 | 2 | 3 }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: space.s,
      }}
    >
      <Text
        style={{ flexShrink: 1, fontFamily: fonts.display800, fontSize: 22, color: colors.ink }}
      >
        {title}
      </Text>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut }}>
        {t('staff.supplies.purchase.form.stepOf', { n: step })}
      </Text>
    </View>
  );
}

/** One green bar under the buttons: a third, two thirds, then full. */
export function StepProgress({ step }: { step: 1 | 2 | 3 }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 3, now: step }}
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}
    >
      <View
        style={{
          width: `${(step / 3) * 100}%`,
          height: '100%',
          borderRadius: 3,
          backgroundColor: brand.green,
        }}
      />
    </View>
  );
}

/** "Total paid" over the buttons, with a line under it. */
export function TotalRow({ testID, total }: { testID: string; total: number }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
      >
        <Text style={{ fontFamily: fonts.body800, fontSize: 20, color: colors.ink }}>
          {t('staff.supplies.purchase.form.total')}
        </Text>
        <Text
          testID={testID}
          style={{ fontFamily: fonts.body800, fontSize: 20, color: colors.gtext }}
        >
          {formatIQD(total, locale)}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: colors.line }} />
    </>
  );
}

/**
 * An item card's input: a small label over a plain box (the page's own ground
 * inside the card), the typed text in bold. The quantity and price read as Latin
 * digits whatever the language.
 */
export function ItemInput({
  label,
  error,
  textColor,
  latin,
  testID,
  ...input
}: TextInputProps & {
  label: string;
  error?: string | null;
  textColor?: string;
  latin?: boolean;
  testID: string;
}) {
  const { colors, fonts } = useTheme();
  const { dir } = useLocale();
  // Digits (and Latin text) read left to right even in an Arabic layout, the way Field does it.
  const ltr =
    dir === 'rtl' &&
    (latin === true ||
      (/^[A-Za-z0-9.,\s]+$/.test(String(input.value ?? '')) && String(input.value ?? '') !== ''));
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.mut2 }}>{label}</Text>
      <TextInput
        {...input}
        testID={testID}
        placeholderTextColor={colors.fnt}
        style={{
          height: 50,
          borderWidth: 1.5,
          borderColor: error ? colors.redline : colors.line2,
          borderRadius: radius.cell,
          backgroundColor: colors.bg,
          paddingStart: 14,
          paddingEnd: 14,
          paddingTop: 0,
          paddingBottom: 0,
          fontFamily: fonts.body700,
          fontSize: 17,
          color: textColor ?? colors.ink,
          ...Platform.select({
            android: { includeFontPadding: false, textAlignVertical: 'center' as const },
            default: null,
          }),
          // The paragraph's own direction decides the side the text starts on.
          writingDirection: ltr ? 'ltr' : dir,
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export type LineErrors = Partial<Record<PurchaseField, string>>;

/**
 * One item of the purchase: its name (a list line's own, or "New item" for one
 * added here) with a tag and a ✕ to take it off (not while it is the only one),
 * the amounts, and, for a price each, what the line was paid.
 */
export function ItemCard({
  index,
  count,
  line,
  itemById,
  ingredientById,
  unitOf,
  errors,
  chain,
  testPrefix,
  onEdit,
  onRemove,
}: {
  index: number;
  count: number;
  line: PurchaseLineDraft;
  itemById: Map<string, ShoppingItem>;
  ingredientById: Map<string, IngredientOption>;
  unitOf: (line: PurchaseLineDraft) => ShoppingUnit | null;
  errors: LineErrors;
  chain: FieldChain;
  /** `<route>` — the card's ids are `<route>.line.<n>…`. */
  testPrefix: string;
  onEdit: (patch: Partial<PurchaseLineDraft>) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const item = line.kind === 'list' ? itemById.get(line.itemId) : undefined;
  const ingredient = item?.ingredient_id ? ingredientById.get(item.ingredient_id) : undefined;
  const bought = item ? boughtUnit(item, ingredient) : { unit: null, qty: null };
  const unitWord = bought.unit ? t(`staff.supplies.units.many.${bought.unit}`) : null;
  const priced = isPricedEach(unitOf(line));
  const extra = line.kind === 'free';
  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  return (
    <View
      testID={`${testPrefix}.line.${index}`}
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        overflow: 'hidden',
      }}
    >
      {/* The header band, like the operator's panels: the item's name, its tag, and a ✕ to take it off. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.s,
          minHeight: 52,
          paddingStart: 16,
          paddingEnd: 8,
          backgroundColor: appearance === 'dark' ? colors.bg : brand.blue,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexShrink: 1 }}>
          <Text
            style={{
              flexShrink: 1,
              fontFamily: fonts.display800,
              fontSize: 18,
              color: brand.white,
            }}
          >
            {extra ? t('staff.supplies.purchase.form.newItem') : item ? lineName(item, locale) : ''}
          </Text>
          <View
            style={{
              paddingStart: 10,
              paddingEnd: 10,
              paddingTop: 3,
              paddingBottom: 3,
              borderRadius: radius.pill,
              backgroundColor: extra ? colors.amb : colors.card,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 11.5,
                color: extra ? colors.ambtext : colors.blue,
              }}
            >
              {t(
                extra
                  ? 'staff.supplies.purchase.form.extra'
                  : 'staff.supplies.purchase.form.fromList',
              )}
            </Text>
          </View>
        </View>
        {count > 1 ? (
          <Pressable
            testID={`${testPrefix}.line.${index}.remove`}
            accessibilityRole="button"
            accessibilityLabel={t('staff.supplies.purchase.form.remove')}
            hitSlop={8}
            onPress={onRemove}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.18)',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <CloseIcon size={16} color={brand.white} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ padding: space.m, gap: space.sm }}>
        {line.kind === 'free' ? (
          <ItemInput
            {...chain.field(index * 3)}
            testID={`${testPrefix}.line.${index}.label`}
            label={t('staff.supplies.purchase.form.label')}
            value={line.label}
            onChangeText={(label) => onEdit({ label })}
            error={errors.label}
          />
        ) : null}
        {item ? (
          <Text style={body}>
            {t('staff.supplies.purchase.form.listAsked', {
              qty: formatQty(t, locale, item.qty, item.unit),
            })}
          </Text>
        ) : null}
        {item?.unit === 'pack' && item.ingredient_id && unitWord ? (
          <Hint style={{ marginTop: 0 }}>
            {t('staff.supplies.purchase.form.packHint', { unit: unitWord })}
          </Hint>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <View style={{ width: 112 }}>
            <ItemInput
              {...chain.field(index * 3 + 1, 'numeric')}
              testID={`${testPrefix}.line.${index}.qty`}
              label={
                unitWord
                  ? t('staff.supplies.purchase.form.bought', { unit: unitWord })
                  : t('staff.supplies.purchase.form.quantity')
              }
              value={line.qty}
              onChangeText={(qty) => onEdit({ qty })}
              keyboardType="decimal-pad"
              maxLength={7}
              latin
              error={errors.qty}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ItemInput
              {...chain.field(index * 3 + 2, 'numeric')}
              testID={`${testPrefix}.line.${index}.price`}
              label={t(
                priced
                  ? 'staff.supplies.purchase.form.priceEach'
                  : 'staff.supplies.purchase.form.paid',
              )}
              value={line.price}
              onChangeText={(price) => onEdit({ price })}
              keyboardType="number-pad"
              latin
              textColor={colors.gtext}
              error={errors.price}
            />
          </View>
        </View>
      </View>
      {/* The footer: what the line was paid, divided from the amounts by a line. */}
      {priced ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingStart: space.m,
            paddingEnd: space.m,
            paddingTop: space.sm,
            paddingBottom: space.sm,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>
            {t('staff.supplies.purchase.form.lineTotal')}
          </Text>
          <Text
            testID={`${testPrefix}.line.${index}.total`}
            style={{ fontFamily: fonts.body800, fontSize: 17, color: colors.gtext }}
          >
            {formatIQD(lineTotal(line, unitOf(line)) ?? 0, locale)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
