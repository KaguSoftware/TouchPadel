import { useState } from 'react';
import { Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { PlusIcon } from '../../src/components/icons';
import { useFieldChain } from '../../src/components/fieldChain';
import { SkeletonList } from '../../src/components/states';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import {
  ItemCard,
  StepHead,
  StepProgress,
  TotalRow,
  type LineErrors,
} from '../../src/features/staff/supplies/PurchaseFormParts';
import { usePurchaseForm } from '../../src/features/staff/supplies/usePurchaseForm';
import {
  PURCHASE_ROLES,
  emptyFreeLine,
  purchaseTotal,
  validatePurchase,
  type PurchaseIssue,
  type PurchaseLineDraft,
} from '../../src/features/staff/supplies/logic';

/**
 * Record a purchase, step 2 of 3: What did you buy? (see `staff-purchase-new`).
 * One card a line: the lines ticked on the shopping list (prefilled with what
 * the list asked for, a pack line turned into the base unit stock is counted
 * in) and anything else added with "Add another item". The form always has one
 * item. The quantity is typed (below 1000 in pieces; grams and millilitres run
 * on), the price is a whole-IQD price each, or the amount paid for a line in
 * grams or millilitres. The total rides over the button and the green bar under
 * it shows the step.
 */
function ItemsStep() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const form = usePurchaseForm();
  const [issues, setIssues] = useState<PurchaseIssue[]>([]);
  // Next walks every line's amounts (and an extra line's name): three slots a line.
  const chain = useFieldChain(form.lines.length * 3);

  if (form.status.kind !== 'staff') return null;

  const editLine = (index: number, patch: Partial<PurchaseLineDraft>) => {
    form.setLines((all) =>
      all.map((l, i) => (i === index ? ({ ...l, ...patch } as PurchaseLineDraft) : l)),
    );
    setIssues((all) => all.filter((x) => !(x.line === index && x.field in patch)));
  };
  const removeLine = (index: number) => {
    form.setLines((all) => all.filter((_, i) => i !== index));
    setIssues([]);
  };

  const lineErrors = (index: number): LineErrors => {
    const out: LineErrors = {};
    for (const issue of issues.filter((i) => i.line === index)) {
      if (issue.field === 'label') {
        out.label = t(
          issue.code === 'tooLong'
            ? 'staff.supplies.purchase.form.errors.labelTooLong'
            : 'staff.supplies.purchase.form.errors.label',
        );
      } else if (issue.field === 'qty') {
        out.qty = t(
          issue.code === 'tooLong'
            ? 'staff.supplies.purchase.form.errors.qtyMax'
            : 'staff.supplies.purchase.form.errors.qty',
        );
      } else if (issue.field === 'price') {
        out.price = t('staff.supplies.purchase.form.errors.price');
      }
    }
    return out;
  };
  const formError = (): string | null => {
    const issue = issues.find((i) => i.line === undefined && i.field !== 'shop');
    if (!issue) return null;
    return t(
      issue.code === 'tooLong'
        ? 'staff.supplies.purchase.form.errors.tooMany'
        : 'staff.supplies.purchase.form.errors.lines',
    );
  };

  const next = () => {
    const found = validatePurchase({ lines: form.lines, shop: form.shop }, form.unitOf).filter(
      (i) => i.field !== 'shop',
    );
    setIssues(found);
    if (found.length > 0) return;
    router.push({
      pathname: '/staff-purchase-review',
      params: { itemIds: form.itemIds.join(',') },
    });
  };

  const bar = form.buyer ? (
    <>
      <TotalRow
        testID="staff-purchase-items.total"
        total={purchaseTotal(form.lines, form.unitOf)}
      />
      <Button
        testID="staff-purchase-items.next"
        label={t('staff.supplies.purchase.form.nextReview')}
        variant="primary"
        onPress={next}
      />
      <StepProgress step={2} />
    </>
  ) : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.form.title') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        error={formError()}
        bar={bar}
      >
        {form.venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {form.buyer ? (
          <>
            <StepHead title={t('staff.supplies.purchase.form.itemsTitle')} step={2} />
            {form.gone > 0 ? (
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 12.5,
                  lineHeight: 19,
                  color: colors.ambtext,
                }}
              >
                {t('staff.supplies.purchase.form.gone', { count: form.gone })}
              </Text>
            ) : null}
            {form.itemIds.length > 0 && !form.seeded ? <SkeletonList rows={2} height={96} /> : null}
            {form.lines.map((line, index) => (
              <ItemCard
                key={line.kind === 'list' ? line.itemId : `free-${index}`}
                index={index}
                count={form.lines.length}
                line={line}
                itemById={form.itemById}
                ingredientById={form.ingredientById}
                unitOf={form.unitOf}
                errors={lineErrors(index)}
                chain={chain}
                testPrefix="staff-purchase-items"
                onEdit={(patch) => editLine(index, patch)}
                onRemove={() => removeLine(index)}
              />
            ))}
            <Pressable
              testID="staff-purchase-items.line.add"
              accessibilityRole="button"
              accessibilityLabel={t('staff.supplies.purchase.form.addLine')}
              onPress={() => form.setLines((all) => [...all, emptyFreeLine()])}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.blue,
                borderRadius: radius.button + 2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <PlusIcon size={16} color={colors.blue} strokeWidth={2.6} />
              <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.blue }}>
                {t('staff.supplies.purchase.form.addLine')}
              </Text>
            </Pressable>
            {chain.bar}
          </>
        ) : (
          <Hint>{t('staff.supplies.purchase.list.mgmtNote')}</Hint>
        )}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffPurchaseItemsRoute() {
  return (
    <RequireStaff page="staff-purchase-items" roles={PURCHASE_ROLES}>
      <ItemsStep />
    </RequireStaff>
  );
}
