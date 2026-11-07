/**
 * The staff phone's two camera pages (Phase 2 Milestone 4b), one component:
 *
 *   order_slip  app/(staff)/staff-order-slip.tsx  the waiter photographs a handwritten
 *               order; it appears live on the till, which sends it to the kitchen
 *   receipt     app/(staff)/staff-receipt.tsx     the driver or a manager photographs a
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
import { useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime, formatIQD, isolate, type MessageKey } from '@touch/i18n';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { Button, Card, ErrorText, Hint, LinkText, MicroLabel, Screen } from '../../../components/ui';
import { CameraIcon } from '../../../components/icons';
import { ErrorState, SkeletonList } from '../../../components/states';
import { useToast } from '../../../components/overlays';
import type { AttachedPhoto } from '../../../components/PhotoButton';
import { PhotoViewer, type PhotoOrigin } from '../../cafe/PhotoViewer';
import { mapErrorToKey } from '../../booking/errors';
import { PhotoError, pickPhoto, uploadStaffPhoto, type PhotoSource } from '../photo';
import { clearStaffIntentKey, staffIntentKey } from '../../../lib/idempotency';
import { usePullRefresh } from '../../../lib/usePullRefresh';
import { useStaffStatus } from '../StaffStatusProvider';
import { mapStaffError } from '../edge';
import { staffKeys } from '../keys';
import { useHeaderAddOptions } from '../../../navigation/headerAdd';
import { useBack } from '../../../navigation/back';
import { Tag } from '../checklists/parts';
import { useFloorLive } from '../calls/useFloorLive';
import { fetchMyReceipts, fetchMySlips, fileOrderSlip, fileReceipt, readScanned } from './api';
import { scanTone, type MyReceipt, type MySlip } from './logic';

export type ScanKind = 'order_slip' | 'receipt';

/**
 * Which half of the page shows. Order slips are two pages: the list ('log',
 * app/(staff)/staff-order-slip.tsx, a + in the bar) and the camera card
 * ('capture', app/(staff)/staff-order-slip-new.tsx, nothing under it). The
 * receipt page keeps both on one page.
 */
export type ScanPart = 'capture' | 'log' | 'both';

export function ScanPage({ kind, part = 'both' }: { kind: ScanKind; part?: ScanPart }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const slip = kind === 'order_slip';
  const router = useRouter();
  const back = useBack('/staff-order-slip');
  const showCapture = part !== 'log';
  const showLog = part !== 'capture';
  const route = slip ? (part === 'capture' ? 'staff-order-slip-new' : 'staff-order-slip') : 'staff-receipt';
  const k = slip ? 'slip' : 'receipt';
  const addOptions = useHeaderAddOptions(
    slip && part === 'log'
      ? {
          testID: 'staff-order-slip.add',
          label: t('staff.scan.slips.add'),
          onPress: () => router.push('/staff-order-slip-new'),
        }
      : null,
  );

  // Slips only: the till's send or set-aside shows up here without a pull.
  useFloorLive(slip && showLog && venue !== '');

  const logKey = slip ? staffKeys.myOrderSlips(venue) : staffKeys.myReceipts(venue);
  const log = useQuery<MySlip[] | MyReceipt[]>({
    queryKey: logKey,
    queryFn: () => (slip ? fetchMySlips(venue) : fetchMyReceipts(venue)),
    enabled: showLog && venue !== '',
    refetchInterval: 30_000,
  });
  const pull = usePullRefresh(() => log.refetch());

  // One photo per slip. `photo` is set once it has been uploaded; the pick and
  // the upload run together (`picking`), so Send is only ever offered for a
  // photo the server already holds.
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<{ text: string; settings?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = useRef(false);

  // The photo over the whole screen, the same viewer the café's item photos
  // open in: it grows out of the preview, pinch zooms, a drag lets go of it.
  const [viewing, setViewing] = useState(false);
  const [origin, setOrigin] = useState<PhotoOrigin | null>(null);
  const previewRef = useRef<ComponentRef<typeof View>>(null);
  const openViewer = () => {
    const node = previewRef.current;
    if (!node) {
      setOrigin(null);
      setViewing(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setOrigin(w > 0 && h > 0 ? { x, y, width: w, height: h } : null);
      setViewing(true);
    });
  };

  const take = async (source: PhotoSource) => {
    if (picked.current || venue === '' || send.isPending) return;
    picked.current = true;
    setPicking(true);
    setProblem(null);
    setError(null);
    try {
      const got = await pickPhoto(source);
      if (got) {
        const path = await uploadStaffPhoto(venue, slip ? 'slips' : 'receipts', got);
        setPhoto({ path, uri: got.uri });
      }
    } catch (err) {
      if (err instanceof PhotoError) {
        setProblem(
          err.code === 'permission'
            ? { text: t('staff.media.cameraOff'), settings: true }
            : { text: t('staff.media.unavailable') },
        );
      } else {
        const key = mapErrorToKey(err);
        setProblem({ text: t(key === 'errors.generic' ? 'staff.media.failed' : key) });
      }
    } finally {
      picked.current = false;
      setPicking(false);
    }
  };

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
      setPhoto(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: logKey });
      // The camera page has no list under it: back to the slips, with the new one in it.
      if (part === 'capture') back();
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const onSend = () => {
    setError(null);
    if (!photo) return;
    send.mutate(photo.path);
  };

  const body = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 19, color: colors.mut2 };
  const rows = log.data ?? [];

  return (
    <Screen pattern="blur" clearBar edges={[]}>
      <Stack.Screen
        options={{
          title: slip && part === 'log' ? t('staff.scan.slips.title') : t(`staff.scan.${k}.title`),
          ...addOptions,
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          showLog ? <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} /> : undefined
        }
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        {showCapture ? (
        <Card style={{ padding: space.m, gap: space.sm }}>
          {photo ? (
            <Pressable
              ref={previewRef}
              testID={`${route}.view`}
              accessibilityRole="imagebutton"
              accessibilityLabel={t('staff.media.photo', { n: 1 })}
              onPress={openViewer}
            >
              <Image
                testID={`${route}.preview`}
                source={{ uri: photo.uri }}
                resizeMode="cover"
                style={{ width: '100%', height: 200, borderRadius: radius.cell, backgroundColor: colors.sub }}
              />
            </Pressable>
          ) : (
            <View
              style={{
                height: 160,
                borderRadius: radius.card,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.line2,
                backgroundColor: colors.tint,
                alignItems: 'center',
                justifyContent: 'center',
                gap: space.xs,
                paddingHorizontal: space.m,
              }}
            >
              {picking ? (
                <ActivityIndicator color={colors.blue} />
              ) : (
                <CameraIcon size={34} color={colors.blue} strokeWidth={1.7} />
              )}
              <Text style={{ fontFamily: fonts.display800, fontSize: 14, color: colors.ink, textAlign: 'center' }}>
                {t(`staff.scan.${k}.tileTitle`)}
              </Text>
              <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut, textAlign: 'center' }}>
                {t(`staff.scan.${k}.tileHint`)}
              </Text>
            </View>
          )}
          {problem ? <ErrorText>{problem.text}</ErrorText> : null}
          {problem?.settings ? (
            <LinkText
              testID={`${route}.settings`}
              label={t('staff.media.openSettings')}
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
          <ErrorText>{error}</ErrorText>
          {photo ? (
            <>
              <Button
                testID={`${route}.retake`}
                label={t('staff.scan.retake')}
                variant="secondary"
                disabled={send.isPending || picking}
                busy={picking}
                onPress={() => void take('camera')}
              />
              <Button
                testID={`${route}.send`}
                label={t(`staff.scan.${k}.send`)}
                variant="cta"
                busy={send.isPending}
                onPress={onSend}
              />
            </>
          ) : (
            <>
              <Button
                testID={`${route}.take`}
                label={t('staff.scan.take')}
                variant="primary"
                busy={picking}
                disabled={venue === ''}
                onPress={() => void take('camera')}
              />
              <Button
                testID={`${route}.library`}
                label={t('staff.scan.library')}
                variant="secondary"
                disabled={picking || venue === ''}
                onPress={() => void take('library')}
              />
            </>
          )}
        </Card>
        ) : null}

        {showLog ? (
          <View testID={`${route}.list`} style={{ gap: space.sm }}>
        <MicroLabel style={{ paddingStart: 4, marginTop: showCapture ? space.s : 0 }}>{t(`staff.scan.${k}.mine`)}</MicroLabel>
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
          </View>
        ) : null}
      </ScrollView>
      {viewing && photo ? (
        <PhotoViewer url={photo.uri} testID={`${route}.photo`} origin={origin} onClose={() => setViewing(false)} />
      ) : null}
    </Screen>
  );
}
