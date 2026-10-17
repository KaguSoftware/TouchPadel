import { useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StaffRole } from '@touch/core';
import {
  formatDayNumber,
  formatMonthShort,
  formatTime,
  formatWeekdayShort,
  countPhrase,
  isolate,
} from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, shadows, space, useTheme } from '../../src/theme';
import {
  CheckCircleIcon,
  ChevronIcon,
  ClockIcon,
  FistIcon,
  GlassBrokenIcon,
  HourglassIcon,
  MedicalIcon,
  MoreIcon,
  PinIcon,
  WarningIcon,
  type IconProps,
} from '../../src/components/icons';
import { Button, Field, Hint, MicroLabel, Screen } from '../../src/components/ui';
import { ErrorState, SkeletonList } from '../../src/components/states';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { usePullRefresh } from '../../src/lib/usePullRefresh';
import { useHeaderAddOptions } from '../../src/navigation/headerAdd';
import { Lead, MULTILINE_BOX, MULTILINE_TEXT } from '../../src/features/staff/checklists/parts';
import { Chip } from '../../src/features/staff/protocols/FormFields';
import { StoredPhotos } from '../../src/features/staff/supplies/StoredPhotos';
import { localName } from '../../src/features/staff/marketing/logic';
import { NightHeader } from '../../src/components/play';
import {
  fetchIncidentsPage,
  fetchMyIncidents,
  reviewIncident,
  type IncidentRow,
  type IncidentsFilter,
} from '../../src/features/staff/incidents/api';
import {
  INCIDENT_CAPS,
  INCIDENT_FILTERS,
  groupIncidentsByDay,
  ownReportLine,
  reviewsIncidents,
  validateReviewNote,
} from '../../src/features/staff/incidents/logic';

/** Each kind's icon, as the operator's cards draw them. */
const KIND_ICON: Record<IncidentRow['kind'], (p: IconProps) => ReactNode> = {
  accident: WarningIcon,
  injury: MedicalIcon,
  fight: FistIcon,
  damage: GlassBrokenIcon,
  other: MoreIcon,
};

/**
 * Incidents (wave5-addendum-2026-09-25 §2.6, §5.3; migration 0198).
 *
 *   every role        follows its own reports and the reviewer's note; the +
 *                     in the top bar opens the report form
 *                     (staff-incident-report.tsx)
 *   manager, owner    see the venue's reports instead, and review the open ones
 *                     with a note the reporter reads, never their own
 *                     (CANNOT_DECIDE_OWN)
 *
 * The report is immutable once sent (§8 Q12): corrections go in the review
 * note. Redacting is on the operator only (§5.1). `?id=` is a report a link
 * named, listed first and marked. Only the kind ever reaches a lock screen
 * (§2.3); the text and photos stay here.
 */
function IncidentsScreen() {
  const { t, locale, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addOptions = useHeaderAddOptions({
    testID: 'staff-incidents.add',
    label: t('staff.incidents.add'),
    onPress: () => router.push('/staff-incident-report'),
  });
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ id?: string }>();

  const role: StaffRole = status.kind === 'staff' ? status.staff.role : 'cashier';
  const reviews = reviewsIncidents(role);
  const venue = venueId ?? '';

  const [filter, setFilter] = useState<IncidentsFilter>('all');
  // "Today" and "Yesterday" on the day headers are read against when the page opened.
  const [nowMs] = useState(() => Date.now());

  // ── Reads ──────────────────────────────────────────────────────────────────
  const mine = useQuery({
    queryKey: staffKeys.myIncidents(venue),
    queryFn: () => fetchMyIncidents(venue),
    enabled: venue !== '' && !reviews,
  });
  const page = useQuery({
    queryKey: staffKeys.incidents(venue, filter),
    queryFn: () => fetchIncidentsPage(venue, filter),
    enabled: venue !== '' && reviews,
  });
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: staffKeys.myIncidents(venue) });
    for (const f of INCIDENT_FILTERS) {
      void queryClient.invalidateQueries({ queryKey: staffKeys.incidents(venue, f) });
    }
  };
  const pull = usePullRefresh(() => Promise.all([reviews ? page.refetch() : mine.refetch()]));

  // ── Review ─────────────────────────────────────────────────────────────────
  // The report open in the sheet; its review note starts empty each time.
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const openReport = (id: string) => {
    setOpenId(id);
    setNote('');
    setNoteError(null);
  };
  const closeReport = () => setOpenId(null);

  const review = useMutation({
    mutationKey: staffKeys.mutation('incident.review'),
    mutationFn: (v: { id: string; note: string }) => reviewIncident(v.id, v.note),
    onSuccess: () => {
      toast(t('staff.incidents.review.done'), 'success');
      setOpenId(null);
      setNote('');
      refreshAll();
    },
    onError: (err) => {
      setNoteError(t(mapStaffError(err)));
      refreshAll();
    },
  });

  const onReview = (id: string) => {
    const problem = validateReviewNote(note);
    if (problem) {
      setNoteError(
        t(
          problem === 'tooLong'
            ? 'staff.incidents.review.errors.noteTooLong'
            : 'staff.incidents.review.errors.note',
        ),
      );
      return;
    }
    setNoteError(null);
    review.mutate({ id, note: note.trim() });
  };

  if (status.kind !== 'staff') return null;

  const body = { fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut2 };
  const small = { fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut };

  const loadError = (testID: string, query: { error: unknown; refetch: () => unknown }) => (
    <ErrorState
      testID={testID}
      title={t('errors.loadFailedTitle')}
      message={t(mapStaffError(query.error))}
      retryLabel={t('common.retry')}
      onRetry={() => void query.refetch()}
    />
  );

  /** The place alone, as the card shows it; "where exactly" is in the sheet. */
  const placeOf = (r: IncidentRow): string =>
    r.place === 'court'
      ? localName(r.court_name_en, r.court_name_ar, locale) || t('work.incident.place.court')
      : t(`work.incident.place.${r.place}`);

  const whereOf = (r: IncidentRow): string => {
    const place = placeOf(r);
    return r.place_detail
      ? t('staff.incidents.list.where', { place, detail: isolate(r.place_detail) })
      : place;
  };

  /** Each kind's band, in the operator's colours (theme/tokens.ts `inc*`). */
  const kindLook: Record<IncidentRow['kind'], { bg: string; fg: string }> = {
    accident: { bg: colors.incAccidentTint, fg: colors.incAccident },
    injury: { bg: colors.incInjuryTint, fg: colors.incInjury },
    fight: { bg: colors.incFightTint, fg: colors.incFight },
    damage: { bg: colors.incDamageTint, fg: colors.incDamage },
    other: { bg: colors.incOtherTint, fg: colors.incOther },
  };

  /** A small icon square and the text beside it: the card's time and place. */
  const iconTile = (icon: ReactNode, children: ReactNode, shrink = false) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        flexShrink: shrink ? 1 : 0,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.cell - 2,
          backgroundColor: colors.sub,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flexShrink: 1 }}>{children}</View>
    </View>
  );

  /** The kind's band: its icon in a raised square, the name, and the icon again large and faint behind. */
  const band = (r: IncidentRow, big: boolean) => {
    const look = kindLook[r.kind];
    const KindIcon = KIND_ICON[r.kind];
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          padding: big ? space.l : space.m,
          backgroundColor: look.bg,
          overflow: 'hidden',
        }}
      >
        <View
          pointerEvents="none"
          style={{ position: 'absolute', end: -12, bottom: big ? -44 : -36, opacity: 0.1 }}
        >
          <KindIcon size={big ? 140 : 110} color={look.fg} />
        </View>
        <View
          style={{
            width: big ? 52 : 44,
            height: big ? 52 : 44,
            borderRadius: radius.cell,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: shadows.thumb,
          }}
        >
          <KindIcon size={big ? 26 : 22} color={look.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: big ? 20 : 17,
              lineHeight: big ? 26 : 23,
              color: look.fg,
            }}
          >
            {t(`work.incident.kind.${r.kind}`)}
          </Text>
          {big ? <Text style={{ ...small, color: look.fg }}>{whereOf(r)}</Text> : null}
        </View>
      </View>
    );
  };

  /** The time and the place on one line, each an icon square and its text. */
  const whenWhere = (r: IncidentRow) => {
    const at = new Date(r.occurred_at);
    return (
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: space.l,
          rowGap: space.s,
        }}
      >
        {iconTile(
          <ClockIcon size={16} color={colors.mut} />,
          <>
            <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
              {formatTime(at, locale)}
            </Text>
            <Text style={{ ...small, fontSize: 11.5, lineHeight: 15, fontFamily: fonts.body600 }}>
              {formatWeekdayShort(at, locale)} {formatDayNumber(at, locale)}{' '}
              {formatMonthShort(at, locale)}
            </Text>
          </>,
        )}
        {iconTile(
          <PinIcon size={16} color={colors.mut} />,
          <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
            {placeOf(r)}
          </Text>,
          true,
        )}
      </View>
    );
  };

  /** Where the review stands: a green "Reviewed by" or a dashed amber "waiting". */
  const statusBox = (r: IncidentRow, long: boolean) =>
    r.status === 'reviewed' ? (
      <View
        style={{
          gap: 4,
          paddingVertical: space.s,
          paddingHorizontal: space.sm,
          borderRadius: radius.cell,
          backgroundColor: colors.gtint,
          borderWidth: 1,
          borderColor: colors.gline,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CheckCircleIcon size={15} color={colors.gtext} />
          <Text
            style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13, color: colors.gtext }}
          >
            {t('staff.incidents.list.reviewedByName', {
              name: isolate(r.reviewed_by_name ?? '—'),
            })}
          </Text>
        </View>
        {long && r.review_note ? (
          <Text style={{ ...body, color: colors.gtext2 }}>{r.review_note}</Text>
        ) : null}
      </View>
    ) : (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: space.s,
          paddingHorizontal: space.sm,
          borderRadius: radius.cell,
          backgroundColor: colors.amb,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.ambstrong,
        }}
      >
        <HourglassIcon size={15} color={colors.ambtext} />
        <Text
          style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13, color: colors.ambtext }}
        >
          {t(long ? 'staff.incidents.list.waitingLong' : 'staff.incidents.list.waiting')}
        </Text>
      </View>
    );

  /**
   * One report as a card, exactly as the operator's (IncidentsPage MyReports):
   * the kind's band, the time and the place, where the review stands, and a
   * "Details" foot. The whole card opens the report in the sheet; what happened,
   * the photos and the review are read there.
   */
  const reportCard = (r: IncidentRow) => {
    const named = r.id === params.id;
    return (
      <Pressable
        key={r.id}
        testID={`staff-incidents.item.${r.id}`}
        accessibilityRole="button"
        onPress={() => openReport(r.id)}
        style={({ pressed }) => ({
          backgroundColor: colors.card,
          borderWidth: named ? 2 : 1,
          borderColor: named ? colors.blue : colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {band(r, false)}
        <View style={{ padding: space.m, gap: space.sm }}>
          {whenWhere(r)}
          {statusBox(r, false)}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.s,
            paddingVertical: 10,
            paddingHorizontal: space.m,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.blue }}>
            {t('staff.incidents.list.details')}
          </Text>
          <ChevronIcon size={16} color={colors.blue} />
        </View>
      </Pressable>
    );
  };

  /** A titled block in the sheet. */
  const sheetSection = (title: string, children: ReactNode) => (
    <View style={{ gap: 6 }}>
      <MicroLabel>{title}</MicroLabel>
      {children}
    </View>
  );

  /**
   * The report opened from its card, as the operator's MyIncidentModal (and,
   * for management, IncidentSheet): the card's band larger, the time and the
   * place, then what happened, who was involved, the photos, and the review,
   * with the review controls under it for whoever may review it.
   */
  const reportSheet = (r: IncidentRow) => {
    const withReporter = reviews;
    return (
      <View
        testID="staff-incidents.sheet"
        style={{ flex: 1, direction: dir, backgroundColor: colors.bg }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: space.xl,
            paddingTop: space.l,
            paddingBottom: space.s,
          }}
        >
          <Pressable
            testID="staff-incidents.sheet.close"
            accessibilityRole="button"
            hitSlop={12}
            onPress={closeReport}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontFamily: fonts.body700, fontSize: 17, color: colors.blue }}>
              {t('common.close')}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: space.l,
            paddingTop: space.s,
            paddingBottom: 40 + insets.bottom,
            gap: space.l,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View
            style={{
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.line,
              overflow: 'hidden',
              backgroundColor: colors.card,
            }}
          >
            {band(r, true)}
            <View style={{ padding: space.m, gap: space.sm }}>
              {whenWhere(r)}
              {withReporter && r.reported_by_name ? (
                <Text style={{ ...small, fontFamily: fonts.body600 }}>
                  {r.reported_by_role
                    ? t('staff.incidents.list.from', {
                        name: isolate(r.reported_by_name),
                        role: t(`op.roles.${r.reported_by_role as StaffRole}`),
                      })
                    : r.reported_by_name}
                </Text>
              ) : null}
            </View>
          </View>

          {sheetSection(
            t('staff.incidents.sheet.whatHappened'),
            r.redacted ? (
              <Text style={{ ...body, fontStyle: 'italic' }}>
                {t('staff.incidents.list.redacted')}
              </Text>
            ) : (
              <Text style={{ ...body, fontSize: 15, lineHeight: 22, color: colors.ink }}>
                {r.description}
              </Text>
            ),
          )}
          {r.people_involved
            ? sheetSection(
                t('staff.incidents.sheet.people'),
                <Text style={{ ...body, fontSize: 15, lineHeight: 22, color: colors.ink }}>
                  {r.people_involved}
                </Text>,
              )
            : null}
          {/* A redacted report keeps its photos only until protocol-action's next
              tick (0198 redact_incident); they are never shown again meanwhile. */}
          {r.photos.length > 0
            ? sheetSection(
                t('staff.incidents.sheet.photos'),
                r.redacted ? (
                  <Text style={small}>{t('staff.incidents.list.photosGoing')}</Text>
                ) : (
                  <StoredPhotos paths={r.photos} />
                ),
              )
            : null}
          {sheetSection(t('staff.incidents.sheet.review'), statusBox(r, true))}

          {withReporter && r.status === 'open' && r.can_review === false ? (
            <Text style={small}>
              {t(`staff.incidents.review.${ownReportLine(r.reported_by_role)}`)}
            </Text>
          ) : null}
          {withReporter && r.can_review && r.status === 'open' ? (
            <View style={{ gap: space.s }}>
              <Field
                testID="staff-incidents.review.note"
                label={t('staff.incidents.review.note')}
                value={note}
                onChangeText={(text) => {
                  setNote(text);
                  setNoteError(null);
                }}
                multiline
                boxStyle={MULTILINE_BOX}
                style={MULTILINE_TEXT}
                maxLength={INCIDENT_CAPS.note}
                error={noteError}
              />
              <Hint style={{ marginTop: 0 }}>{t('staff.incidents.review.noteHint')}</Hint>
              <Button
                testID="staff-incidents.review.confirm"
                label={t('staff.incidents.review.confirm')}
                variant="primary"
                busy={review.isPending}
                onPress={() => onReview(r.id)}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  };

  /**
   * The cards under a header for the day they happened, as the Play tab's Join
   * list: "Today", "Yesterday", else "Thu 14 Oct", with the day's count beside.
   * A report a link named is outlined on its card.
   */
  const byDay = (rows: readonly IncidentRow[]) => (
    <View>
      {groupIncidentsByDay(rows, nowMs).map((d) => {
        const noon = new Date(`${d.key}T12:00:00`);
        const title =
          d.daysAgo === 0
            ? t('staff.incidents.days.today')
            : d.daysAgo === 1
              ? t('staff.incidents.days.yesterday')
              : t('staff.incidents.days.day', {
                  weekday: formatWeekdayShort(noon, locale),
                  day: formatDayNumber(noon, locale),
                  month: formatMonthShort(noon, locale),
                });
        return (
          <View key={d.key} testID={`staff-incidents.day.${d.key}`}>
            <NightHeader
              title={title}
              line={countPhrase('staff.incidents.count.reports', d.rows.length, locale)}
            />
            <View style={{ gap: space.sm }}>{d.rows.map(reportCard)}</View>
          </View>
        );
      })}
    </View>
  );

  // ── One's own reports ───────────────────────────────────────────────────────
  const mineView = (
    <>
      <Lead>{t('staff.incidents.lead')}</Lead>
      {mine.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={96} />
      ) : mine.isError ? (
        loadError('staff-incidents.mine-error', mine)
      ) : (mine.data?.incidents ?? []).length === 0 ? (
        <Hint>{t('staff.incidents.mine.empty')}</Hint>
      ) : (
        byDay(mine.data?.incidents ?? [])
      )}
    </>
  );

  // ── Management's review list ────────────────────────────────────────────────
  const pageRows = page.data?.incidents ?? [];
  const reviewView = (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {INCIDENT_FILTERS.map((f) => (
          <Chip
            key={f}
            testID={`staff-incidents.filter.${f}`}
            label={t(`staff.incidents.review.filters.${f}`)}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>
      {page.isPending && venue !== '' ? (
        <SkeletonList rows={2} height={110} />
      ) : page.isError ? (
        loadError('staff-incidents.review-error', page)
      ) : pageRows.length === 0 ? (
        <Hint>
          {t(
            filter === 'open' ? 'staff.incidents.review.emptyOpen' : 'staff.incidents.review.empty',
          )}
        </Hint>
      ) : (
        byDay(pageRows)
      )}
    </>
  );

  const shown = reviews ? (page.data?.incidents ?? []) : (mine.data?.incidents ?? []);
  const opened = openId ? (shown.find((r) => r.id === openId) ?? null) : null;

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: t('staff.incidents.title'),
          ...addOptions,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        {venue === '' ? <Hint>{t('staff.shell.venue.none')}</Hint> : null}
        <View testID="staff-incidents.list" style={{ gap: space.sm }}>
          {reviews ? reviewView : mineView}
        </View>
      </ScrollView>
      {/* The platform's sheet on iOS, a full-screen slide on Android, as the
          assistant's settings; the modal sits outside the direction root. */}
      <Modal
        visible={opened !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}
        onRequestClose={closeReport}
      >
        {opened ? reportSheet(opened) : null}
      </Modal>
    </Screen>
  );
}

export default function StaffIncidentsRoute() {
  return (
    <RequireStaff>
      <IncidentsScreen />
    </RequireStaff>
  );
}
