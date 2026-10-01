import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD, formatNumber } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Field, Hint, MicroLabel, Screen } from '../src/components/ui';
import { SkeletonList } from '../src/components/states';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { ListCard } from '../src/features/staff/protocols/parts';
import {
  FLOOR_ROLES,
  MAX_QTY,
  NOTE_MAX,
  activeGroups,
  addLine,
  defaultVariant,
  initialChoices,
  itemById,
  localName,
  missingGroups,
  toggleChoice,
  type MenuGroup,
  type MenuItem,
} from '../src/features/staff/floor/logic';
import { newLineKey } from '../src/features/staff/floor/drafts';
import { ChoiceRow, Stepper, useFloorMenu } from '../src/features/staff/floor/parts';
import { useTableOrder } from '../src/features/staff/floor/useTableOrder';
import { useBack } from '../src/navigation/back';

/**
 * Place an order, an item's sheet (0251): the size, the options (each group
 * says whether it needs a choice and how many it takes; an option can bring
 * another group in, like Iced → ice level), a note for the kitchen and how
 * many. "Add" is refused, with the group named, until every group that needs
 * a choice has one: the same rule add_order_items checks on the send.
 * Presented as a sheet (app/_layout.tsx) over the table's menu.
 */
function ItemSheet({ item, tableId }: { item: MenuItem; tableId: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { venueId } = useStaffStatus();
  const { update } = useTableOrder(venueId ?? '', tableId);
  // Back to the table's menu, which is also where a sheet opened cold belongs.
  const back = useBack({ pathname: '/staff-order-menu', params: { table: tableId } });

  const [variantId, setVariantId] = useState(() => defaultVariant(item).id);
  const [chosen, setChosen] = useState<string[]>(() => initialChoices(item));
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const groups = activeGroups(item, chosen);
  const missing = missingGroups(item, chosen);
  const plus = (delta: number) => (delta > 0 ? `+${formatIQD(delta, locale)}` : null);

  const rule = (g: MenuGroup) =>
    g.min_select >= 1 && g.max_select === 1
      ? t('staff.floor.item.required')
      : g.min_select >= 1
        ? t('staff.floor.item.chooseAtLeast', { count: formatNumber(g.min_select, locale) })
        : g.max_select > 1
          ? t('staff.floor.item.upTo', { count: formatNumber(g.max_select, locale) })
          : t('staff.floor.item.optional');

  const onAdd = () => {
    if (missing.length > 0) {
      setTried(true);
      return;
    }
    update((d) => addLine(d, { itemId: item.id, variantId, qty, modifierIds: chosen, note }, newLineKey()));
    back();
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: localName(item, locale) }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 110 + insets.bottom, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {!item.orderable ? <Hint>{t('staff.floor.item.notOrderable')}</Hint> : null}

        {item.variants.length > 1 ? (
          <View style={{ gap: space.xs }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.floor.item.size')}</MicroLabel>
            <ListCard>
              {item.variants.map((v, i) => (
                <ChoiceRow
                  key={v.id}
                  testID={`staff-order-item.size.${v.id}`}
                  label={localName(v, locale)}
                  trailing={formatIQD(v.price_iqd, locale)}
                  selected={variantId === v.id}
                  onPress={() => setVariantId(v.id)}
                  last={i === item.variants.length - 1}
                />
              ))}
            </ListCard>
          </View>
        ) : null}

        {groups.map((g) => {
          const short = tried && missing.some((m) => m.id === g.id);
          return (
            <View key={g.id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingStart: 4, paddingEnd: 4 }}>
                <MicroLabel>{localName(g, locale)}</MicroLabel>
                <Text
                  style={{
                    fontFamily: short ? fonts.body700 : fonts.body600,
                    fontSize: 12,
                    color: short ? colors.redtext : colors.mut,
                  }}
                >
                  {rule(g)}
                </Text>
              </View>
              <ListCard>
                {g.modifiers.map((m, i) => (
                  <ChoiceRow
                    key={m.id}
                    testID={`staff-order-item.option.${m.id}`}
                    label={localName(m, locale)}
                    trailing={plus(m.price_delta_iqd)}
                    selected={chosen.includes(m.id)}
                    multi={g.max_select > 1}
                    onPress={() => setChosen((c) => toggleChoice(item, g, c, m.id))}
                    last={i === g.modifiers.length - 1}
                  />
                ))}
              </ListCard>
            </View>
          );
        })}

        <Field
          testID="staff-order-item.note"
          label={t('staff.floor.item.note')}
          placeholder={t('staff.floor.item.notePlaceholder')}
          value={note}
          onChangeText={setNote}
          maxLength={NOTE_MAX}
          returnKeyType="done"
          dense
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15, color: colors.ink }}>{t('staff.floor.item.qty')}</Text>
          <Stepper
            testID="staff-order-item.qty"
            value={qty}
            onChange={setQty}
            max={MAX_QTY}
            lessLabel={t('staff.floor.item.less')}
            moreLabel={t('staff.floor.item.more')}
          />
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
        {tried && missing[0] ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.redtext }}>
            {t('staff.floor.item.missing', { group: localName(missing[0], locale) })}
          </Text>
        ) : null}
        <Button
          testID="staff-order-item.add"
          label={
            qty > 1
              ? t('staff.floor.item.addCount', { count: formatNumber(qty, locale) })
              : t('staff.floor.item.add')
          }
          variant="cta"
          disabled={!item.orderable}
          onPress={onAdd}
        />
      </View>
    </Screen>
  );
}

function ItemRoute() {
  const { t } = useLocale();
  const { venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ table?: string; item?: string }>();
  const menu = useFloorMenu(venueId ?? '');
  const item = menu.data ? itemById(menu.data, params.item ?? '') : undefined;
  if (item && params.table) return <ItemSheet key={item.id} item={item} tableId={params.table} />;
  return (
    <Screen edges={[]}>
      <View style={{ paddingTop: space.m }}>
        {menu.isPending ? <SkeletonList rows={3} height={52} /> : <Hint>{t('errors.notFound')}</Hint>}
      </View>
    </Screen>
  );
}

export default function StaffOrderItemRoute() {
  return (
    <RequireStaff roles={FLOOR_ROLES}>
      <ItemRoute />
    </RequireStaff>
  );
}
