/**
 * The incident report form (wave5-addendum-2026-09-25 §2.6, §5.2): what
 * happened, when, where (a court names which), what happened in words, who was
 * involved, and up to six photos. The desk and the till fill it in minutes
 * after something went wrong, often with the guest still there, so it asks in
 * the order a person tells it and nothing more.
 *
 * The privacy hint is the contract's sentence ("Write only what is needed. Do
 * not add phone numbers."): a report may name a guest, and it is kept a year.
 * Photos go to the `incidents` folder through the same upload the phone uses
 * (PhotoField), which the uploader and management may read.
 *
 * The idempotency key follows what is sent: a retry of the same report
 * reuses it, and an edit or a success (when the form clears for the next
 * report) mints a new one.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { fetchActiveCourts } from '../../lib/queries';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { Icon } from '../../components/icons';
import { PhotoField } from '../tasks/PhotoField';
import { refusalCode, refusalHint } from '../protocols/errors';
import { venueWallValue, wallValueToDate } from '../deductions/venueDate';
import { IK } from './api';
import {
  AHEAD_MS,
  BACK_MS,
  DESCRIPTION_MAX,
  DETAIL_MAX,
  INCIDENT_KINDS,
  INCIDENT_PLACES,
  PEOPLE_MAX,
  PHOTOS_MAX,
  reportArgs,
  reportRefusalField,
  validateReport,
  type IncidentKind,
  type IncidentPlace,
  type ReportDraft,
  type ReportField,
  type ReportIssueCode,
} from './incidentsLogic';

const blankDraft = (): ReportDraft => ({
  kind: '',
  when: venueWallValue(),
  place: '',
  courtId: '',
  placeDetail: '',
  description: '',
  people: '',
  photos: [],
});

const ISSUE_KEY: Record<ReportIssueCode, MessageKey> = {
  required: 'ws.incidents.form.issue.required',
  whenRange: 'ws.incidents.form.issue.whenRange',
  tooLong: 'ws.incidents.form.issue.tooLong',
  tooMany: 'ws.incidents.form.issue.tooMany',
};

const LIMIT: Partial<Record<ReportField, number>> = { description: DESCRIPTION_MAX, people: PEOPLE_MAX, placeDetail: DETAIL_MAX, photos: PHOTOS_MAX };

export function ReportIncidentForm({ onSent, onCancel }: { onSent?: () => void; onCancel?: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ReportDraft>(blankDraft);
  const [tried, setTried] = useState(false);
  /** One key per report as sent: kept for a retry of it, renewed by an edit or a success (claim_replay compares no payload). */
  const key = useRef<{ sig: string; key: string } | null>(null);
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, enabled: draft.place === 'court' });

  // The window's ends on the venue's clock, for the picker's bounds, taken
  // when the form opens (or clears); the server checks the same window
  // against its own now.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const bounds = useMemo(
    () => ({ min: venueWallValue(new Date(openedAt - BACK_MS)), max: venueWallValue(new Date(openedAt + AHEAD_MS)) }),
    [openedAt],
  );

  const occurredAt = wallValueToDate(draft.when);
  const issues = validateReport(draft, occurredAt, new Date());

  const send = useMutation({
    mutationFn: () => {
      const at = occurredAt ?? new Date();
      const sig = JSON.stringify(reportArgs(draft, at, ''));
      if (key.current?.sig !== sig) key.current = { sig, key: `incident.submit:${crypto.randomUUID()}` };
      return appRpc('submit_incident', reportArgs(draft, at, key.current.key));
    },
    onSuccess: () => {
      key.current = null;
      toast.ok(tr('ws.incidents.form.sent'));
      setDraft(blankDraft());
      setOpenedAt(Date.now());
      setTried(false);
      void qc.invalidateQueries({ queryKey: IK.all });
      onSent?.();
    },
  });

  const serverField = reportRefusalField(refusalCode(send.error), refusalHint(send.error));
  const errorOf = (field: ReportField): string | undefined => {
    const issue = tried ? issues.find((i) => i.field === field) : undefined;
    if (issue) return tr(ISSUE_KEY[issue.code], { limit: formatNumber(LIMIT[field] ?? 0, locale) });
    if (serverField === field && send.error) return tr(`ws.incidents.form.refused.${field}` as MessageKey);
    return undefined;
  };
  const set = (patch: Partial<ReportDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (send.isError) send.reset();
  };
  const busy = send.isPending;

  return (
    <form
      noValidate
      data-testid="incidents.form"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (issues.length === 0 && occurredAt && !busy) send.mutate();
      }}
    >
      <Field label={tr('ws.incidents.form.kind')} required group error={errorOf('kind')}>
        <SegmentedControl<IncidentKind | ''>
          value={draft.kind}
          onChange={(k) => set({ kind: k })}
          options={INCIDENT_KINDS.map((k) => ({ value: k, label: tr(`work.incident.kind.${k}`), disabled: busy }))}
        />
      </Field>

      <Field label={tr('ws.incidents.form.when')} required hint={tr('ws.incidents.form.whenHint')} error={errorOf('when')}>
        <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="datetime-local"
            value={draft.when}
            min={bounds.min}
            max={bounds.max}
            disabled={busy}
            onChange={(e) => set({ when: e.target.value })}
            style={{ ...inputStyle, inlineSize: 'auto', minInlineSize: '14rem' }}
            data-testid="incidents.form.when"
          />
          <Button size="sm" kind="ghost" icon="clock" disabled={busy} onClick={() => set({ when: venueWallValue() })}>
            {tr('ws.incidents.form.now')}
          </Button>
        </span>
      </Field>

      <Field label={tr('ws.incidents.form.place')} required group error={errorOf('place')}>
        <SegmentedControl<IncidentPlace | ''>
          value={draft.place}
          onChange={(p) => set({ place: p, courtId: p === 'court' ? draft.courtId : '' })}
          options={INCIDENT_PLACES.map((p) => ({ value: p, label: tr(`work.incident.place.${p}`), disabled: busy }))}
        />
      </Field>

      {draft.place === 'court' && (
        <Field label={tr('ws.incidents.form.court')} required error={errorOf('courtId')}>
          <Select<string>
            value={draft.courtId}
            placeholder={courtsQ.isPending ? tr('common.loading') : tr('ws.incidents.form.chooseCourt')}
            disabled={busy}
            options={(courtsQ.data ?? []).map((c) => ({ value: c.id, label: (locale === 'ar' ? c.name_ar || c.name_en : c.name_en || c.name_ar) ?? '' }))}
            onChange={(v) => set({ courtId: v })}
          />
        </Field>
      )}
      {courtsQ.isError && <ErrorText error={courtsQ.error} />}

      <Field label={tr('ws.incidents.form.placeDetail')} optional error={errorOf('placeDetail')}>
        <input
          value={draft.placeDetail}
          maxLength={DETAIL_MAX}
          dir="auto"
          disabled={busy}
          placeholder={tr('ws.incidents.form.placeDetailPlaceholder')}
          onChange={(e) => set({ placeDetail: e.target.value })}
          style={inputStyle}
        />
      </Field>

      {/* The contract's privacy line, once, above the two fields it is about. */}
      <p
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          alignItems: 'flex-start',
          marginBlockEnd: 'var(--tp-sp-3)',
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-3)',
          borderRadius: 'var(--tp-radius-ctl)',
          background: 'var(--tp-surface-2)',
          fontSize: 'var(--tp-fs-sm)',
        }}
        data-testid="incidents.form.privacy"
      >
        <Icon name="shield" size={16} style={{ color: 'var(--tp-muted-fg)', marginBlockStart: '0.1rem' }} />
        {tr('ws.incidents.form.privacyHint')}
      </p>

      <Field label={tr('ws.incidents.form.description')} required error={errorOf('description')}>
        <textarea
          value={draft.description}
          rows={4}
          maxLength={DESCRIPTION_MAX}
          dir="auto"
          disabled={busy}
          onChange={(e) => set({ description: e.target.value })}
          style={{ ...inputStyle, minBlockSize: '6rem', resize: 'vertical', fontFamily: 'inherit' }}
          data-testid="incidents.form.description"
        />
      </Field>

      <Field label={tr('ws.incidents.form.people')} optional hint={tr('ws.incidents.form.peopleHint')} error={errorOf('people')}>
        <textarea
          value={draft.people}
          rows={2}
          maxLength={PEOPLE_MAX}
          dir="auto"
          disabled={busy}
          onChange={(e) => set({ people: e.target.value })}
          style={{ ...inputStyle, minBlockSize: '3.5rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>

      <PhotoField folder="incidents" paths={draft.photos} onChange={(photos) => set({ photos })} min={0} max={PHOTOS_MAX} disabled={busy} error={errorOf('photos')} />

      {send.isError && serverField === null && <ErrorText error={send.error} />}

      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {onCancel && (
          <Button kind="ghost" onClick={onCancel} disabled={busy}>
            {tr('common.cancel')}
          </Button>
        )}
        <Button kind="primary" type="submit" icon="check" busy={busy} data-testid="incidents.form.submit">
          {tr('ws.incidents.form.submit')}
        </Button>
      </div>
    </form>
  );
}
