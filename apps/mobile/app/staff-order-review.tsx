import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, Hint, LinkText, MicroLabel, Screen } from '../src/components/ui';
import { SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { ListCard } from '../src/features/staff/protocols/parts';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  FLOOR_ROLES,
  activeGroups,
  draftCount,
  itemById,
  localName,
  sendArgs,
  sendIntent,
  sendIssue,
  setQty,
  type DraftLine,
  type MenuCategory,
} from '../src/features/staff/floor/logic';
import { clearDraft } from '../src/features/staff/floor/drafts';
import { placeFloorOrder } from '../src/features/staff/floor/api';
import { Stepper, useFloorMenu } from '../src/features/staff/floor/parts';
import { TabPicker } from '../src/features/staff/floor/TabPicker';
import { useTableOrder } from '../src/features/staff/floor/useTableOrder';
import { useBack } from '../src/navigation/back';

/**
 * Place an order, the review (0251): the tab it goes on (changeable here, the
 * last moment to catch the wrong tab), each line with its size, options and
 * note, a count that can go down to nothing, and Send. Send is
 * place_floor_order under one key per intent (the same order retried is sent
 * once); the kitchen has it the moment it answers, and the phone goes back to
 * the tables. A new tab with nothing on it can be opened on its own.
 */
function ReviewScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const params = useLocalSearchParams<{ table?: string }>();
  const tableId = params.table ?? '';
  const { floor, table, draft, target, update } = useTableOrder(venue, tableId);
  const menu = useFloorMenu(venue);
  const [error, setError] = useState<string | null>(null);
  const addMore = useBack({ pathname: '/staff-order-menu', params: { table: tableId } });

  const lines = draft?.lines ?? [];
  const count = draftCount(draft);
  const effective = draft ? { ...draft, target } : null;
  const issue = effective ? sendIssue(effective) : target?.kind === 'new' ? null : 'empty';

  const send = useMutation({
    mutationKey: staffKeys.mutation('floor_order'),
    mutationFn: async () => {
      const d = effective ?? { tableId, target, label: '', lines: [] };
      const intent = sendIntent(d);
      const key = staffIntentKey(intent, 'floor_order');
      const res = await placeFloorOrder(sendArgs(d), key);
      clearStaffIntentKey(intent);
      return res;
    },
    onSuccess: (res) => {
      toast(t(res.order_id ? 'staff.floor.review.sent' : 'staff.floor.review.opened'), 'success');
      clearDraft(tableId);
      void queryClient.invalidateQueries({ queryKey: staffKeys.floor(venue) });
      router.dismissTo('/staff-order');
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    if (issue) {
      setError(t(`staff.floor.review.issues.${issue}`));
      return;
    }
    send.mutate();
  };

  const describe = (line: DraftLine, menuData: MenuCategory[] | undefined) => {
    const item = menuData ? itemById(menuData, line.itemId) : undefined;
    if (!item) return { name: '…', detail: '' };
    const variant = item.variants.find((v) => v.id === line.variantId);
    const options = activeGroups(item, line.modifierIds)
      .flatMap((g) => g.modifiers)
      .filter((m) => line.modifierIds.includes(m.id))
      .map((m) => localName(m, locale));
    const parts = [
      item.variants.length > 1 && variant ? localName(variant, locale) : null,
      ...options,
      line.note ? `“${isolate(line.note)}”` : null,
    ].filter(Boolean);
    return { name: localName(item, locale), detail: parts.join(locale === 'ar' ? '، ' : ', ') };
  };

  const sendLabel =
    count > 0
      ? t('staff.floor.review.sendCount', { count: formatNumber(count, locale) })
      : target?.kind === 'new'
        ? t('staff.floor.menu.openTab')
        : t('staff.floor.review.send');

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: table
            ? `${t('staff.floor.review.title')} · ${t('staff.floor.menu.title', { number: isolate(table.table_number) })}`
            : t('staff.floor.review.title'),
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 120 + insets.bottom, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {floor.isPending ? (
          <SkeletonList rows={1} height={60} />
        ) : table ? (
          <View style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.floor.review.goesOn')}</MicroLabel>
            <TabPicker
              testID="staff-order-review.target"
              tabs={table.tabs}
              target={target}
              label={draft?.label ?? ''}
              onTarget={(next) => update((d) => ({ ...d, target: next }))}
              onLabel={(label) => update((d) => ({ ...d, label }))}
              disabled={send.isPending}
            />
          </View>
        ) : (
          <Hint>{t('errors.notFound')}</Hint>
        )}

        <View style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingStart: 4 }}>
            <MicroLabel>{t('staff.floor.review.title')}</MicroLabel>
            <LinkText testID="staff-order-review.add-more" label={t('staff.floor.review.addMore')} onPress={addMore} />
          </View>
          {lines.length === 0 ? (
            <Hint>{t(target?.kind === 'new' ? 'staff.floor.review.emptyNew' : 'staff.floor.review.empty')}</Hint>
          ) : (
            <ListCard>
              {lines.map((line, i) => {
                const { name, detail } = describe(line, menu.data);
                return (
                  <View
                    key={line.key}
                    testID={`staff-order-review.line.${line.key}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingStart: space.l,
                      paddingEnd: space.sm,
                      paddingTop: 10,
                      paddingBottom: 10,
                      borderBottomWidth: i === lines.length - 1 ? 0 : 1,
                      borderBottomColor: colors.sub,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 20, color: colors.ink }}>{name}</Text>
                      {detail ? (
                        <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 17, color: colors.mut }}>{detail}</Text>
                      ) : null}
                    </View>
                    {/* Down to 0 removes the line: one control, no separate delete. */}
                    <Stepper
                      testID={`staff-order-review.qty.${line.key}`}
                      value={line.qty}
                      min={0}
                      onChange={(n) => update((d) => setQty(d, line.key, n))}
                      lessLabel={line.qty === 1 ? t('staff.floor.review.remove') : t('staff.floor.item.less')}
                      moreLabel={t('staff.floor.item.more')}
                      disabled={send.isPending}
                    />
                  </View>
                );
              })}
            </ListCard>
          )}
        </View>
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          start: 0,
          end: 0,
          bottom: 0,
          gap: space.xs,
          paddingTop: space.sm,
          paddingBottom: space.sm + insets.bottom,
          paddingStart: space.l,
          paddingEnd: space.l,
          backgroundColor: colors.bg,
          borderTopWidth: 1,
          borderTopColor: colors.line,
        }}
      >
        <ErrorText>{error}</ErrorText>
        <Button
          testID="staff-order-review.send"
          label={sendLabel}
          variant="cta"
          busy={send.isPending}
          disabled={!table}
          onPress={onSend}
        />
      </View>
    </Screen>
  );
}

export default function StaffOrderReviewRoute() {
  return (
    <RequireStaff roles={FLOOR_ROLES}>
      <ReviewScreen />
    </RequireStaff>
  );
}
