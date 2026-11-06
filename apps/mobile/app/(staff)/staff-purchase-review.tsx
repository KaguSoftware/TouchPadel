import { useState } from 'react';
import { Alert, Image, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD, isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { clearStaffIntentKey, staffIntentKey } from '../../src/lib/idempotency';
import { PurchaseSection } from '../../src/features/staff/supplies/PurchaseParts';
import {
  StepHead,
  StepProgress,
  TotalRow,
} from '../../src/features/staff/supplies/PurchaseFormParts';
import { usePurchaseForm } from '../../src/features/staff/supplies/usePurchaseForm';
import { SHOPPING_LIST_STATUSES, recordPurchase } from '../../src/features/staff/supplies/api';
import {
  PURCHASE_ROLES,
  formatQty,
  intentFor,
  lineName,
  lineTotal,
  purchaseArgs,
  purchaseTotal,
  validatePurchase,
} from '../../src/features/staff/supplies/logic';

/**
 * Record a purchase, step 3 of 3: Check and save (see `staff-purchase-new`).
 * Shop, items and receipt read back, each with a way to change it (Edit goes
 * back to that step's page), the total over Save. Saving is one
 * `record_purchase` (one purchase per shop); the manager receives it into stock
 * in Goods in, and the page returns to the purchases list.
 */
function ReviewStep() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = usePurchaseForm();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    for (const s of SHOPPING_LIST_STATUSES) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.shopping(form.venue, s) });
    }
    void queryClient.invalidateQueries({ queryKey: staffKeys.purchases(form.venue) });
    void queryClient.invalidateQueries({ queryKey: staffKeys.work(form.venue) });
  };

  const save = useMutation({
    mutationKey: staffKeys.mutation('purchase'),
    mutationFn: ({ args, intent }: { args: ReturnType<typeof purchaseArgs>; intent: string }) =>
      recordPurchase(args, staffIntentKey(intent, 'purchase')),
    onSuccess: (_data, { intent }) => {
      clearStaffIntentKey(intent);
      toast(t('staff.supplies.purchase.form.saved'), 'success');
      refresh();
      router.dismissTo('/staff-purchase');
    },
    onError: (err) => {
      setError(t(mapStaffError(err)));
      // A line bought meanwhile (SHOPPING_ITEM_NOT_OPEN) shows as gone on refresh.
      refresh();
    },
  });

  if (form.status.kind !== 'staff') return null;

  const params = { itemIds: form.itemIds.join(',') };
  const goTo = (pathname: '/staff-purchase-new' | '/staff-purchase-items') =>
    router.dismissTo({ pathname, params });

  const send = () => {
    const args = purchaseArgs(
      { lines: form.lines, shop: form.shop },
      form.venue,
      form.receipt[0]?.path ?? null,
      form.unitOf,
    );
    save.mutate({ args, intent: intentFor('purchase', args) });
  };

  const onSave = () => {
    setError(null);
    const found = validatePurchase({ lines: form.lines, shop: form.shop }, form.unitOf);
    if (found.length > 0 || !form.venue) {
      // Send the driver to the page that holds the problem.
      if (found.some((i) => i.field === 'shop')) goTo('/staff-purchase-new');
      else if (found.length > 0) goTo('/staff-purchase-items');
      return;
    }
    if (form.receipt.length === 0) {
      Alert.alert(
        t('staff.supplies.purchase.form.noReceiptTitle'),
        t('staff.supplies.purchase.form.noReceiptBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('staff.supplies.purchase.form.saveAnyway'), onPress: send },
        ],
      );
      return;
    }
    send();
  };

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const bar = form.buyer ? (
    <>
      <TotalRow
        testID="staff-purchase-review.total"
        total={purchaseTotal(form.lines, form.unitOf)}
      />
      <Button
        testID="staff-purchase-review.save"
        label={t('staff.supplies.purchase.form.save')}
        variant="primary"
        busy={save.isPending}
        onPress={onSave}
      />
      <StepProgress step={3} />
    </>
  ) : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.form.title') }} />
      <ScreenWithBar
        contentContainerStyle={{ paddingTop: space.m, gap: space.sm }}
        error={error}
        bar={bar}
      >
        {form.venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {form.buyer ? (
          <>
            <StepHead title={t('staff.supplies.purchase.form.reviewTitle')} step={3} />
            <PurchaseSection
              title={t('staff.supplies.purchase.form.sectionShop')}
              action={{
                label: t('staff.supplies.purchase.form.edit'),
                onPress: () => goTo('/staff-purchase-new'),
                testID: 'staff-purchase-review.edit-shop',
              }}
            >
              <Text style={{ fontFamily: fonts.body800, fontSize: 15, color: colors.ink }}>
                {form.shop.trim()
                  ? isolate(form.shop.trim())
                  : t('staff.supplies.purchase.list.noShop')}
              </Text>
            </PurchaseSection>
            <PurchaseSection
              title={t('staff.supplies.purchase.form.sectionItems')}
              action={{
                label: t('staff.supplies.purchase.form.edit'),
                onPress: () => goTo('/staff-purchase-items'),
                testID: 'staff-purchase-review.edit-items',
              }}
            >
              {form.lines.map((line, i) => {
                const item = line.kind === 'list' ? form.itemById.get(line.itemId) : undefined;
                const name =
                  line.kind === 'list' ? (item ? lineName(item, locale) : '') : line.label.trim();
                const unit = form.unitOf(line);
                const qty = Number(line.qty.replace(',', '.'));
                return (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: space.s,
                    }}
                  >
                    <Text
                      style={{
                        flexShrink: 1,
                        fontFamily: fonts.body700,
                        fontSize: 15,
                        color: colors.ink,
                      }}
                    >
                      {name}
                      <Text
                        style={{ fontFamily: fonts.body400, color: colors.mut }}
                      >{` · ${formatQty(t, locale, Number.isFinite(qty) ? qty : 0, unit)}`}</Text>
                    </Text>
                    <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.gtext }}>
                      {formatIQD(lineTotal(line, unit) ?? 0, locale)}
                    </Text>
                  </View>
                );
              })}
            </PurchaseSection>
            <PurchaseSection
              title={t('staff.supplies.purchase.form.receipt')}
              action={{
                label: t('staff.supplies.purchase.form.retake'),
                onPress: () => goTo('/staff-purchase-new'),
                testID: 'staff-purchase-review.retake',
              }}
            >
              {form.receipt[0] ? (
                <Image
                  source={{ uri: form.receipt[0].uri }}
                  accessibilityLabel={t('staff.media.photo', { n: 1 })}
                  resizeMode="cover"
                  style={{
                    width: '100%',
                    height: 170,
                    borderRadius: radius.cell,
                    backgroundColor: colors.sub,
                  }}
                />
              ) : (
                <Text style={body}>{t('staff.supplies.purchase.list.noReceipt')}</Text>
              )}
            </PurchaseSection>
          </>
        ) : (
          <Hint>{t('staff.supplies.purchase.list.mgmtNote')}</Hint>
        )}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffPurchaseReviewRoute() {
  return (
    <RequireStaff page="staff-purchase-review" roles={PURCHASE_ROLES}>
      <ReviewStep />
    </RequireStaff>
  );
}
