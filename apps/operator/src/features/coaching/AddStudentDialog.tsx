/**
 * Add student (docs/design/coaching/operator.md §5.10.7), opened from the
 * roster's footer and from the lesson screen's `?customer=` hand-back. One
 * app.desk_add_student call: a group session takes the student on this
 * lesson (`p_lesson_id`), a course session signs them up for the course
 * (`p_course_id`), joining from the next session to start; the price is the
 * server's (C-15), shown on the roster once it refetches.
 *
 * The student is a customer found in the search (the booking dialog's
 * CustomerPicker, with its typed-query mirror into the name and phone boxes,
 * the AddSeatDialog pattern), or a typed name and phone. A typed student stays
 * as typed on every staff surface, and a typed phone that matches an account
 * is linked only once its owner confirms it (C-21, R44, R68). **Create
 * customer** and **Find in the directory** leave for the customer screens in
 * attach mode, which hand the customer back through
 * `/desk/lessons/$id?customer=<id>`.
 *
 * Works with coaching switched off at the branch (the desk stages, R51).
 * Online only (CD-6); one key per draft (the customer, or the typed name and
 * phone), sent again on a retry of that same draft, a new one once it is
 * edited, all cleared after a success (OP-11). A failure with no answer
 * re-reads the lessons and says the last attempt may have gone through; a
 * `duplicate` answer says the student was already added.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber, isolate, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter } from '../../components/kit';
import { tradingDateOf } from '../desk/calendar/monthLogic';
import { CustomerPicker, type PickedCustomer } from '../desk/customers/CustomerPicker';
import { nameFromQuery, phoneFromQuery, sanitizeName, sanitizePhone } from '../desk/deskLogic';
import type { CustomerRecord } from '../desk/deskTypes';
import { nightWindow } from '../desk/useTradingNight';
import { coachingErrorText, countOf, nowOf } from './lessonLogic';
import { readAddedStudent, type LessonInfo } from './lessonPayloads';
import {
  STUDENT_NAME_MAX,
  STUDENT_PHONE_MAX_DIGITS,
  STUDENT_PHONE_MIN_DIGITS,
  addStudentBlock,
  addStudentTarget,
  joinsFrom,
  studentFieldOf,
  studentPhoneInvalid,
} from './lessonScreenLogic';
import { invalidateLessonBooking, useDeskLessons, useDraftIdemKeys } from './useCoaching';
import { mayHaveLanded } from './startLessonLogic';

export interface AddStudentDialogProps {
  lesson: LessonInfo;
  /** A customer handed back from search or create (`/desk/lessons/$id?customer=`), picked on open. */
  customerId?: string;
  onClose: () => void;
  /** After a success (the dialog has already invalidated the lesson reads). */
  onAdded?: () => void;
}

export function AddStudentDialog({ lesson, customerId, onClose, onAdded }: AddStudentDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { reachable } = useStationReach();
  const idem = useDraftIdemKeys('add');
  // OP-11: the last attempt got no answer, so it may have gone through.
  const [maybeLanded, setMaybeLanded] = useState(false);

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  // The phone's box says it is not a number once the desk leaves it, not at the first digit.
  const [phoneLeft, setPhoneLeft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A customer handed back from search or create arrives as an id: read the
  // record (the key the booking screen shares) and pick them once it lands.
  const handedQ = useQuery({
    queryKey: ['customer', customerId ?? ''],
    enabled: Boolean(customerId),
    queryFn: async () =>
      (await appRpc('customer_record', { p_customer_id: customerId })) as CustomerRecord,
  });
  const handed = handedQ.data ?? null;
  useEffect(() => {
    if (!handed) return;
    setCustomer({
      id: handed.customer.id,
      name: handed.customer.full_name,
      phone: handed.customer.phone,
      flags: handed.flags ?? [],
    });
  }, [handed]);

  // R51: the desk stages lessons while coaching is off at the branch. The
  // lesson's night envelope (the desk calendar's own key) says whether it is.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const hours = settingsQ.data?.opening_hours;
  const nightSpan = settingsQ.data
    ? nightWindow(tradingDateOf(lesson.start_at, tz, hours), tz, hours)
    : null;
  const deskQ = useDeskLessons(nightSpan?.start, nightSpan?.end, nightSpan !== null);
  const stagingOff = deskQ.data?.coaching_enabled === false;

  const course = lesson.course;
  const joins = joinsFrom(course, nowOf(lesson.server_now));
  const block = addStudentBlock({ reachable, customerPicked: customer !== null, name, phone });
  const serverField = studentFieldOf(error);
  const nameLine = tr('ws.coaching.add.nameTooLong', {
    max: formatNumber(STUDENT_NAME_MAX, locale),
  });
  const phoneLine = tr('ws.coaching.add.phoneInvalid', {
    min: formatNumber(STUDENT_PHONE_MIN_DIGITS, locale),
    max: formatNumber(STUDENT_PHONE_MAX_DIGITS, locale),
  });
  const nameError =
    (customer === null && block === 'nameTooLong') || serverField === 'name' ? nameLine : undefined;
  const phoneError =
    (customer === null && phoneLeft && studentPhoneInvalid(phone)) || serverField === 'phone'
      ? phoneLine
      : undefined;
  const blocked =
    block === 'offline'
      ? tr('ws.coaching.offline.needsConnection')
      : block === 'needsStudent'
        ? tr('ws.coaching.add.needsStudent')
        : block === 'nameTooLong'
          ? nameLine
          : block === 'phoneInvalid'
            ? phoneLine
            : undefined;

  async function add() {
    if (blocked !== undefined) return;
    setBusy(true);
    setError(null);
    setMaybeLanded(false);
    const student = {
      p_customer_id: customer?.id ?? null,
      p_name: customer ? null : name.trim(),
      p_phone: customer ? null : phone.trim() || null,
    };
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = readAddedStudent(
        await appRpc('desk_add_student', {
          ...addStudentTarget(lesson),
          ...student,
          p_idempotency_key: idem.keyFor(JSON.stringify(student)),
        }),
      );
      idem.reset();
      invalidateLessonBooking(qc);
      const who = isolate(customer?.name ?? name.trim());
      if (out.duplicate) toast.info(tr('ws.coaching.add.alreadyAdded', { name: who }));
      else
        toast.ok(
          out.places_left === 0
            ? tr(course ? 'ws.coaching.add.addedFullCourse' : 'ws.coaching.add.addedFull', {
                name: who,
              })
            : tr('ws.coaching.add.added', { name: who }),
        );
      onAdded?.();
      onClose();
    } catch (e) {
      setError(e);
      if (mayHaveLanded(e)) {
        setMaybeLanded(true);
        invalidateLessonBooking(qc);
      }
    } finally {
      setBusy(false);
    }
  }

  const attach = { attach: 'lesson', lesson: lesson.id } as never;

  return (
    <Modal
      title={tr(course ? 'ws.coaching.add.titleCourse' : 'ws.coaching.add.title')}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="userPlus"
            busy={busy}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            onClick={() => void add()}
          >
            {tr('ws.coaching.add.submit')}
          </Button>
        </>
      )}
    >
      {stagingOff && (
        <MessagePresenter
          tone="info"
          message={tr('ws.coaching.common.stagingOff')}
          style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
        />
      )}
      {course && joins && (
        <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          {tr('ws.coaching.add.joinsFrom', {
            n: formatNumber(joins.sessionNo, locale),
            sessions: countOf('sessions', joins.sessions, locale),
          })}
        </p>
      )}
      <CustomerPicker
        value={customer}
        disabled={busy}
        autoFocus={!customerId}
        onQueryChange={(q) => {
          if (!nameTouched) setName(nameFromQuery(q));
          if (!phoneTouched) setPhone(phoneFromQuery(q));
        }}
        onChange={(next) => {
          setCustomer(next);
          setError(null);
        }}
      />
      {customer === null && (
        <>
          <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
            <Field label={tr('ws.coaching.add.name')} required error={nameError}>
              <input
                style={inputStyle}
                value={name}
                disabled={busy}
                maxLength={STUDENT_NAME_MAX}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(sanitizeName(e.target.value));
                  if (serverField === 'name') setError(null);
                }}
              />
            </Field>
            <Field label={tr('ws.coaching.add.phone')} optional error={phoneError}>
              <input
                style={inputStyle}
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                maxLength={30}
                value={phone}
                disabled={busy}
                onChange={(e) => {
                  setPhoneTouched(true);
                  setPhone(sanitizePhone(e.target.value));
                  if (serverField === 'phone') setError(null);
                }}
                onBlur={() => setPhoneLeft(true)}
              />
            </Field>
          </div>
          <p
            style={{
              marginBlockEnd: 'var(--tp-sp-2)',
              fontSize: 'var(--tp-fs-sm)',
              color: 'var(--tp-muted-fg)',
            }}
          >
            {tr('ws.coaching.add.typedHint')}
          </p>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button
              size="sm"
              kind="ghost"
              icon="userPlus"
              disabled={busy}
              onClick={() => void navigate({ to: '/desk/customers/new', search: attach })}
            >
              {tr('ws.coaching.add.createCustomer')}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              icon="search"
              disabled={busy}
              onClick={() => void navigate({ to: '/desk/customers', search: attach })}
            >
              {tr('ws.coaching.add.findInDirectory')}
            </Button>
          </div>
        </>
      )}
      <ErrorText
        error={serverField ? null : error}
        message={
          error && !serverField ? coachingErrorText(error, tr, {}, { scope: 'lesson' }) : null
        }
      />
      {maybeLanded && <MessagePresenter tone="info" message={tr('ws.coaching.add.maybeLanded')} />}
    </Modal>
  );
}
