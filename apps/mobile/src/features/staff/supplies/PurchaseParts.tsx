/**
 * The pieces the purchases list and a purchase's details page share: the
 * status band that heads a purchase (the tournament card's band: amber while
 * the goods are still to receive, green once delivered, the status as a pill at
 * its end) and the "Delivered" confirmation.
 */
import type { ReactNode } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { brand, radius, shadows, space, useTheme } from '../../../theme';
import { ReceiptIcon, CheckIcon } from '../../../components/icons';
import { useToast } from '../../../components/overlays';
import { LinkText } from '../../../components/ui';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { confirmPurchaseDelivery, type PurchaseRow } from './api';

/** The band across the top of a purchase: receipt icon and item count, then the status pill. */
export function PurchaseBand({ row }: { row: PurchaseRow }) {
  const { t } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  // Green once the goods are delivered or already taken into stock.
  const done = row.status === 'done' || row.delivered_at !== null;
  const label =
    row.status === 'done'
      ? t('work.purchase.status.done')
      : row.delivered_at !== null
        ? t('staff.supplies.purchase.list.deliveredPill')
        : t('work.purchase.status.to_receive');
  // Stronger than the app's pale amber and green washes, so the band reads at a glance.
  const dark = appearance === 'dark';
  const look = done
    ? dark
      ? { bg: '#3F5E1E', fg: '#B9DC8A', line: '#5F8433' }
      : { bg: '#BAD59A', fg: '#243B0C', line: '#8FB06A' }
    : dark
      ? { bg: '#6B4A12', fg: '#F3CC82', line: '#8A6420' }
      : { bg: '#EBCB8A', fg: '#4A3000', line: '#C9A55A' };
  const { bg, fg, line } = look;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingStart: 16,
        paddingEnd: 16,
        paddingTop: 11,
        paddingBottom: 11,
        backgroundColor: bg,
      }}
    >
      <ReceiptIcon size={18} color={fg} />
      <Text style={{ fontFamily: fonts.body800, fontSize: 13.5, color: fg }}>
        {t('staff.supplies.purchase.list.itemsCount', { count: row.lines.length })}
      </Text>
      <View style={{ flex: 1 }} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingStart: 10,
          paddingEnd: 10,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: line,
          // Dark mode wears the band's own colour at low strength; light, the card.
          backgroundColor: dark ? `${fg}29` : colors.card,
        }}
      >
        {done ? (
          <CheckIcon size={13} color={fg} strokeWidth={2.8} />
        ) : (
          <View
            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ambstrong }}
          />
        )}
        <Text style={{ fontFamily: fonts.body800, fontSize: 13, color: fg }}>{label}</Text>
      </View>
    </View>
  );
}

/** "Delivered": asks first, then confirms the goods are at the venue and refreshes the purchases. */
export function usePurchaseDelivery(venue: string) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const deliver = useMutation({
    mutationKey: staffKeys.mutation('purchase.deliver'),
    mutationFn: (id: string) => confirmPurchaseDelivery(id),
    onSuccess: () => {
      toast(t('staff.supplies.purchase.list.deliveredDone'), 'success');
      void queryClient.invalidateQueries({ queryKey: staffKeys.purchases(venue) });
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });
  const confirm = (id: string) => {
    Alert.alert(
      t('staff.supplies.purchase.list.deliveredConfirmTitle'),
      t('staff.supplies.purchase.list.deliveredConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('staff.supplies.purchase.list.markDelivered'),
          onPress: () => deliver.mutate(id),
        },
      ],
    );
  };
  return { confirm, busyId: deliver.isPending ? (deliver.variables ?? null) : null };
}

/**
 * A card under a header band of its own: Touch Blue in light, the page's blue in
 * dark, with a white title and, when given, one action at the band's end (the
 * review step's Edit and Retake).
 */
export function PurchaseSection({
  title,
  action,
  grouped,
  plain,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void; testID: string };
  /** Inside a `PurchaseGroup`: no card chrome of its own. */
  grouped?: boolean;
  /** Inside a group, below its first section: black title on the card, no blue band. */
  plain?: boolean;
  children?: ReactNode;
}) {
  const { colors, fonts, appearance } = useTheme();
  return (
    <View
      style={
        grouped
          ? { backgroundColor: colors.card }
          : {
              borderRadius: radius.card,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              overflow: 'hidden',
            }
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          paddingStart: 16,
          paddingEnd: 16,
          backgroundColor: plain ? colors.card : appearance === 'dark' ? colors.bg : brand.blue,
          ...(plain ? { borderTopWidth: 1, borderTopColor: colors.line } : null),
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily: fonts.display800,
            fontSize: 18,
            color: plain ? colors.ink : brand.white,
          }}
        >
          {title}
        </Text>
        {action ? (
          <LinkText
            testID={action.testID}
            label={action.label}
            color={plain ? colors.ink : brand.white}
            onPress={action.onPress}
          />
        ) : null}
      </View>
      {children ? <View style={{ padding: 16, gap: space.sm }}>{children}</View> : null}
    </View>
  );
}

/** Several `grouped` sections as one card, each keeping its own header band. */
export function PurchaseGroup({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

/**
 * A purchase's card: the status band on top and the body under it, held off the
 * page by a soft shadow instead of a border.
 */
export function PurchaseCard({
  row,
  testID,
  children,
}: {
  row: PurchaseRow;
  testID: string;
  children: ReactNode;
}) {
  const { colors, appearance } = useTheme();
  // The shadow sits on its own view: on the one that clips the band's corners it was cut
  // off square at the card's edge and read as a line against the next card.
  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius.card,
        backgroundColor: colors.card,
        // No border: a soft, wide shadow lifts the card off the page.
        boxShadow: appearance === 'dark' ? shadows.listCardDark : shadows.listCard,
      }}
    >
      <View style={{ borderRadius: radius.card, overflow: 'hidden' }}>
        <PurchaseBand row={row} />
        {children}
      </View>
    </View>
  );
}
