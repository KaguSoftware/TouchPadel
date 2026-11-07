import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { isolate } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Field, Hint, Screen } from '../../src/components/ui';
import { ScreenWithBar } from '../../src/components/BottomBar';
import { PhotoButton } from '../../src/components/PhotoButton';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { StepHead, StepProgress } from '../../src/features/staff/supplies/PurchaseFormParts';
import {
  patchPurchaseDraft,
  resetPurchaseDraft,
} from '../../src/features/staff/supplies/purchaseDraft';
import { usePurchaseForm } from '../../src/features/staff/supplies/usePurchaseForm';
import { CAPS, PURCHASE_ROLES, matchShops } from '../../src/features/staff/supplies/logic';

/**
 * Record a purchase, step 1 of 3 (build-contracts-2026-09-23 §6.1, §2.24.10;
 * plan #70), opened from the + on the purchases page. Each step is a screen of
 * the staff stack, so the native back button, the edge swipe and the slide are
 * the system's own on every step:
 *
 *   1. Where did you buy? (this page) The shop, typed with suggestions from
 *      earlier purchases (the menu hides when nothing matches), and the receipt.
 *   2. `staff-purchase-items`: What did you buy? One card a line.
 *   3. `staff-purchase-review`: Check and save, the total over Save.
 *
 * What is typed lives in `purchaseDraft.ts`; this page clears it when it opens.
 * The ticked shopping-list lines (`?itemIds=`) ride along from page to page.
 * Nothing here touches the till, the drawer or day close.
 */
function ShopStep() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const form = usePurchaseForm();
  const [focused, setFocused] = useState(false);
  const [tooLong, setTooLong] = useState(false);

  // A purchase left half done never carries over into the next one.
  useEffect(() => {
    resetPurchaseDraft();
  }, []);

  if (form.status.kind !== 'staff') return null;

  const suggestions = focused ? matchShops(form.shops, form.shop) : [];

  const next = () => {
    if (form.shop.trim().length > CAPS.shop) {
      setTooLong(true);
      return;
    }
    router.push({
      pathname: '/staff-purchase-items',
      params: { itemIds: form.itemIds.join(',') },
    });
  };

  const bar = form.buyer ? (
    <>
      <Button
        testID="staff-purchase-new.next"
        label={t('staff.supplies.purchase.form.nextItems')}
        variant="primary"
        onPress={next}
      />
      <StepProgress step={1} />
    </>
  ) : null;

  return (
    <Screen pattern="blur" clearBar edges={[]}>
      <Stack.Screen options={{ title: t('staff.supplies.purchase.form.title') }} />
      <ScreenWithBar contentContainerStyle={{ paddingTop: space.m, gap: space.sm }} bar={bar}>
        {form.venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {form.buyer ? (
          <>
            <StepHead title={t('staff.supplies.purchase.form.shopTitle')} step={1} />
            <View style={{ gap: space.s }}>
              <Field
                testID="staff-purchase-new.shop"
                label={t('staff.supplies.purchase.form.shop')}
                value={form.shop}
                onChangeText={(value) => {
                  patchPurchaseDraft({ shopTyped: value });
                  setTooLong(false);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                error={tooLong ? t('staff.supplies.purchase.form.errors.shopTooLong') : null}
              />
              {suggestions.length > 0 ? (
                <View
                  testID="staff-purchase-new.shop.suggestions"
                  style={{
                    borderWidth: 1,
                    borderColor: colors.line2,
                    borderRadius: radius.cell,
                    backgroundColor: colors.card,
                    overflow: 'hidden',
                  }}
                >
                  <Text
                    style={{
                      paddingStart: 14,
                      paddingTop: 10,
                      paddingBottom: 4,
                      fontFamily: fonts.body800,
                      fontSize: 11.5,
                      color: colors.mut,
                    }}
                  >
                    {t('staff.supplies.purchase.form.suggestions')}
                  </Text>
                  {suggestions.map((name, i) => (
                    <Pressable
                      key={name}
                      testID={`staff-purchase-new.shop.suggestion.${i}`}
                      accessibilityRole="button"
                      onPress={() => {
                        patchPurchaseDraft({ shopTyped: name });
                        setFocused(false);
                      }}
                      style={({ pressed }) => ({
                        minHeight: 48,
                        justifyContent: 'center',
                        paddingStart: 14,
                        paddingEnd: 14,
                        backgroundColor: pressed ? colors.sub : colors.card,
                      })}
                    >
                      <Text style={{ fontFamily: fonts.body700, fontSize: 16, color: colors.ink }}>
                        {isolate(name)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>

            <PhotoButton
              testID="staff-purchase-new.receipt"
              venueId={form.venue}
              folder="receipts"
              photos={form.receipt}
              onChange={(receipt) => patchPurchaseDraft({ receipt })}
              max={1}
              hero={{
                title: t('staff.supplies.purchase.form.photoTitle'),
                hint: t('staff.supplies.purchase.form.photoHint'),
              }}
            />
          </>
        ) : (
          <Hint>{t('staff.supplies.purchase.list.mgmtNote')}</Hint>
        )}
      </ScreenWithBar>
    </Screen>
  );
}

export default function StaffPurchaseNewRoute() {
  return (
    <RequireStaff page="staff-purchase-new" roles={PURCHASE_ROLES}>
      <ShopStep />
    </RequireStaff>
  );
}
