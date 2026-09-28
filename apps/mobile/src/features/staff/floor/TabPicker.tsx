/**
 * Where an order goes: one of the table's open tabs, or a new one with an
 * optional guest name. On the menu page and again on the review, so the
 * waiter confirms it right before sending.
 *
 * TEST IDs derive from the required `testID`: `${testID}.tab.<tabId>`,
 * `${testID}.new` and `${testID}.name`.
 */
import { View } from 'react-native';
import { formatNumber, isolate } from '@touch/i18n';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space } from '../../../theme';
import { Field } from '../../../components/ui';
import { ListCard } from '../protocols/parts';
import { ChoiceRow } from './parts';
import { LABEL_MAX, localName, tabItemCount, tabName, type FloorTab, type Target } from './logic';

export function TabPicker({
  testID,
  tabs,
  target,
  label,
  onTarget,
  onLabel,
  disabled,
}: {
  testID: string;
  tabs: readonly FloorTab[];
  target: Target | null;
  label: string;
  onTarget: (t: Target) => void;
  onLabel: (label: string) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLocale();
  const sep = locale === 'ar' ? '، ' : ', ';

  const nameOf = (tab: FloorTab, i: number) => {
    const n = tabName(tab, i);
    return 'label' in n ? isolate(n.label) : t('staff.floor.menu.tabNumbered', { n: formatNumber(n.n, locale) });
  };
  const detailOf = (tab: FloorTab) => {
    const count = tabItemCount(tab);
    if (count === 0) return t('staff.floor.menu.tabEmpty');
    const names = tab.lines
      .slice(0, 3)
      .map((l) => `${formatNumber(l.qty, locale)} × ${localName(l, locale)}`)
      .join(sep);
    return `${t('staff.floor.menu.tabItems', { count: formatNumber(count, locale) })} · ${names}${tab.lines.length > 3 ? '…' : ''}`;
  };

  return (
    <ListCard>
      {tabs.map((tab, i) => (
        <ChoiceRow
          key={tab.id}
          testID={`${testID}.tab.${tab.id}`}
          label={nameOf(tab, i)}
          detail={detailOf(tab)}
          selected={target?.kind === 'tab' && target.tabId === tab.id}
          disabled={disabled}
          onPress={() => onTarget({ kind: 'tab', tabId: tab.id })}
        />
      ))}
      <ChoiceRow
        testID={`${testID}.new`}
        label={t('staff.floor.menu.newTab')}
        selected={target?.kind === 'new'}
        disabled={disabled}
        onPress={() => onTarget({ kind: 'new' })}
        last
      >
        <View style={{ marginTop: space.xs }}>
          <Field
            testID={`${testID}.name`}
            label={t('staff.floor.menu.guestName')}
            placeholder={t('staff.floor.menu.guestNamePlaceholder')}
            value={label}
            onChangeText={onLabel}
            maxLength={LABEL_MAX}
            autoCapitalize="words"
            returnKeyType="done"
            editable={!disabled}
            dense
          />
        </View>
      </ChoiceRow>
    </ListCard>
  );
}
