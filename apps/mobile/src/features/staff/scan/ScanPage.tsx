/**
 * The staff phone's two camera pages (Phase 2 Milestone 4b), one component:
 *
 *   order_slip  app/staff-order-slip.tsx  the waiter photographs a handwritten
 *               order; it appears live on the till, which sends it to the kitchen
 *   receipt     app/staff-receipt.tsx     the driver or a manager photographs a
 *               supplier's receipt; a manager checks it in Goods in
 *
 * The camera opens straight from the photo tile (PhotoButton source="camera",
 * with a link to pick a saved photo instead). Send files the photo
 * (create_order_slip / create_receipt, one idempotency key per photo) and asks
 * receipt-scan to read it; how the reading went is the till's or Goods in's to
 * show, so the phone says "Sent" as soon as the paper is filed. Below, the
 * person's own log: today's slips (live on the `floor` channel: sent to the
 * kitchen or set aside), or the last 30 days' receipts. Every step is logged
 * on the server (audit_log order_slip.* / receipt.*).
 */
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space, useTheme } from '../../../theme';
import { Button, Card, ErrorText, Hint, MicroLabel, Screen } from '../../../components/ui';
import { ErrorState, SkeletonList } from '../../../components/states';
import { useToast } from '../../../components/overlays';
import { PhotoButton, type AttachedPhoto } from '../../../components/PhotoButton';
import { clearStaffIntentKey, staffIntentKey } from '../../../lib/idempotency';
import { usePullRefresh } from '../../../lib/usePullRefresh';
import { useStaffStatus } from '../StaffStatusProvider';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { GroupLabel, Tag } from '../checklists/parts';
import { useFloorLive } from '../calls/useFloorLive';
import { fetchMyReceipts, fetchMySlips, fileOrderSlip, fileReceipt, readScanned } from './api';
import { scanTone, type MyReceipt, type MySlip } from './logic';

export type ScanKind = 'order_slip' | 'receipt';

export function ScanPage({ kind }: { kind: ScanKind }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const slip = kind === 'order_slip';
  const route = slip ? 'staff-order-slip' : 'staff-receipt';
  const k = slip ? 'slip' : 'receipt';

  // Slips only: the till's send or set-aside shows up here without a pull.
  useFloorLive(slip && venue !== '');

  const logKey = slip ? staffKeys.myOrderSlips(venue) : staffKeys.myReceipts(venue);
  const log = useQuery<MySlip[] | MyReceipt[]>({
    queryKey: logKey,
    queryFn: () => (slip ? fetchMySlips(venue) : fetchMyReceipts(venue)),
    enabled: venue !== '',
    refetchInterval: 30_000,
  });
  const pull = usePullRefresh(() => log.refetch());

  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationKey: staffKeys.mutation(kind),
    mutationFn: async (path: string) => {
      const intent = `${kind}:${path}`;
      const key = staffIntentKey(intent, kind);
      const id = slip ? await fileOrderSlip(venue, path, key) : await fileReceipt(venue, path, key);
      clearStaffIntentKey(intent);
      // Not awaited: the paper is filed; the reading lands on the till or Goods in.
      void readScanned(slip ? { slip_id: id } : { receipt_id: id }).then(() =>
        queryClient.invalidateQueries({ queryKey: logKey }),
      );
      return id;
    },
    onSuccess: () => {
      toast(t(`staff.scan.${k}.sent`), 'success');
      setPhotos([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: logKey });
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    const path = photos[0]?.path;
    if (!path) {
      setError(t(`staff.scan.${k}.noPhoto`));
      return;
    }
    send.mutate(path);
  };

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const rows = log.data ?? [];

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t(`staff.scan.${k}.title`) }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <Card style={{ padding: space.m, gap: space.sm }}>
          <Text style={body}>{t(`staff.scan.${k}.lead`)}</Text>
          <View style={{ gap: space.xs }}>
            <GroupLabel>{t(`staff.scan.${k}.photo`)}</GroupLabel>
            <PhotoButton
              testID={`${route}.photo`}
              venueId={venue}
              folder={slip ? 'slips' : 'receipts'}
              photos={photos}
              onChange={setPhotos}
              max={1}
              source="camera"
              disabled={send.isPending || venue === ''}
            />
          </View>
          <ErrorText>{error}</ErrorText>
          <Button
            testID={`${route}.send`}
            label={t(`staff.scan.${k}.send`)}
            variant="primary"
            busy={send.isPending}
            onPress={onSend}
          />
        </Card>

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>{t(`staff.scan.${k}.mine`)}</MicroLabel>
        {log.isPending && venue !== '' ? (
          <SkeletonList rows={2} height={64} />
        ) : log.isError ? (
          <ErrorState
            testID={`${route}.error`}
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(log.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void log.refetch()}
          />
        ) : rows.length === 0 ? (
          <Hint>{t(`staff.scan.${k}.empty`)}</Hint>
        ) : (
          rows.map((row) => {
            const title = slip
              ? (row as MySlip).table_number
                ? t('staff.scan.slip.table', { number: isolate((row as MySlip).table_number!) })
                : t('staff.scan.slip.noTable')
              : (row as MyReceipt).supplier_name_read
                ? isolate((row as MyReceipt).supplier_name_read!)
                : t('staff.scan.receipt.supplier');
            const statusKey = (slip ? `ws.slips.status.${row.status}` : `ws.receipts.status.${row.status}`) as MessageKey;
            return (
              <Card key={row.id} style={{ padding: space.m, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s }}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.ink }}>{title}</Text>
                    <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
                      {row.created_at ? formatDateTime(new Date(row.created_at), locale) : ''}
                      {slip && (row as MySlip).line_count > 0
                        ? ` · ${t('staff.scan.slip.items', { count: (row as MySlip).line_count })}`
                        : ''}
                      {!slip && (row as MyReceipt).total_iqd_read !== null
                        ? ` · ${formatIQD((row as MyReceipt).total_iqd_read!, locale)}`
                        : ''}
                    </Text>
                  </View>
                  <Tag tone={scanTone(row.status)} label={t(statusKey)} />
                </View>
                {row.status === 'rejected' && row.rejected_reason ? (
                  <Text style={body}>{t(`staff.scan.${k}.setAside`, { reason: isolate(row.rejected_reason) })}</Text>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
