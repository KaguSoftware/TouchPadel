/**
 * One incident report, as management reads it (wave5-addendum-2026-09-25
 * §2.6.2, §5.2): everything the reporter wrote, the photos by signed URL
 * (ten minutes, StaffPhoto), and the review.
 *
 *  - **Review.** A note is required and the reporter reads it (app.review_incident);
 *    corrections go here too, because a report is never edited after filing.
 *    Nobody reviews their own report: the row says so instead of offering it.
 *  - **Redact** (the owner). Replaces what happened, who was involved, where
 *    exactly and the review note with a marker, now; the photos go at the next
 *    cleanup. The footer's outlined Redact leads to a red confirm that says
 *    what goes and what stays, because it cannot be undone.
 *
 * The sheet reads the row the list already holds (app.incidents_page returns
 * every field); it closes after a write, and the list refetches.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { DescriptionList, MessagePresenter, StatusBadge } from '../../components/kit';
import { StaffPhoto } from '../checklists/StaffPhoto';
import { refusalCode } from '../protocols/errors';
import { isStaleRefusal } from '../deductions/deductionsLogic';
import { IK } from './api';
import { NOTE_MAX, incidentTone, onlyManagerReviews, placeText, reviewIssue, type IncidentRow } from './incidentsLogic';

const sectionHead = { fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1)' } as const;
// fit-content: a short line in the other script sits beside its label instead
// of floating at the far end of a 68ch box.
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', inlineSize: 'fit-content', maxInlineSize: '68ch', margin: 0 } as const;

export function IncidentSheet({ row, onClose }: { row: IncidentRow; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'read' | 'redact'>('read');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const noteIssue = reviewIssue(note);
  const reviewable = row.status === 'open' && row.canReview;

  const done = (message: string) => {
    toast.ok(message);
    void qc.invalidateQueries({ queryKey: IK.all });
    onClose();
  };
  // Reviewed by someone else meanwhile: the message stays, and the sheet
  // (which reads the list's row) catches up behind it.
  const caughtUp = (e: unknown) => isStaleRefusal(refusalCode(e)) && void qc.invalidateQueries({ queryKey: IK.all });
  const review = useMutation({
    mutationFn: () => appRpc('review_incident', { p_id: row.id, p_note: note.trim() }),
    onSuccess: () => done(tr('ws.incidents.sheet.reviewed', { name: isolate(row.reportedByName ?? '') })),
    onError: caughtUp,
  });
  const redact = useMutation({
    mutationFn: () => appRpc('redact_incident', { p_id: row.id }),
    onSuccess: () => done(tr('ws.incidents.sheet.redacted')),
    onError: caughtUp,
  });
  const busy = review.isPending || redact.isPending;
  const title = `${tr(`work.incident.kind.${row.kind}`)} · ${placeText(row, locale, (p) => tr(`work.incident.place.${p}`))}`;

  return (
    <Modal
      title={title}
      titleAfter={<StatusBadge size="sm" tone={incidentTone(row.status)} label={tr(`work.incident.status.${row.status}`)} />}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      footer={(close) =>
        mode === 'redact' ? (
          <>
            <Button onClick={() => setMode('read')} disabled={busy}>
              {tr('ws.incidents.sheet.keep')}
            </Button>
            <Button kind="danger" busy={redact.isPending} style={{ marginInlineStart: 'auto' }} onClick={() => redact.mutate()} data-testid="incidents.redact.confirm">
              {tr('ws.incidents.sheet.redactConfirm')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              {tr('common.close')}
            </Button>
            {row.canRedact && !row.redacted && (
              <Button icon="eyeOff" onClick={() => setMode('redact')} disabled={busy} data-testid="incidents.redact">
                {tr('ws.incidents.sheet.redact')}
              </Button>
            )}
            {reviewable && (
              <Button
                kind="primary"
                icon="check"
                busy={review.isPending}
                data-testid="incidents.review.confirm"
                onClick={() => {
                  setTried(true);
                  if (noteIssue === null) review.mutate();
                }}
              >
                {tr('ws.incidents.sheet.markReviewed')}
              </Button>
            )}
          </>
        )
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <DescriptionList
          columns={2}
          items={[
            { label: tr('ws.incidents.sheet.happened'), value: row.occurredAt ? formatDateTime(new Date(row.occurredAt), locale) : '—' },
            {
              label: tr('ws.incidents.sheet.reportedBy'),
              value: (
                <span>
                  <bdi style={{ fontWeight: 600 }}>{row.reportedByName ?? '—'}</bdi>
                  {row.reportedByRole && <span style={{ color: 'var(--tp-muted-fg)' }}> · {tr(`op.roles.${row.reportedByRole}`)}</span>}
                  {row.reportedAt && <span style={{ display: 'block', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{formatDateTime(new Date(row.reportedAt), locale)}</span>}
                </span>
              ),
            },
          ]}
        />

        {mode === 'redact' && <MessagePresenter tone="refused" icon="eyeOff" message={tr('ws.incidents.sheet.redactBody')} />}

        <section>
          <h3 style={sectionHead}>{tr('ws.incidents.sheet.whatHappened')}</h3>
          {row.redacted ? (
            <p style={{ ...prose, color: 'var(--tp-muted-fg)', fontStyle: 'italic' }}>{tr('ws.incidents.redactedText')}</p>
          ) : (
            <p dir="auto" style={prose}>
              {row.description}
            </p>
          )}
        </section>

        {!row.redacted && row.peopleInvolved && (
          <section>
            <h3 style={sectionHead}>{tr('ws.incidents.sheet.people')}</h3>
            <p dir="auto" style={prose}>
              {row.peopleInvolved}
            </p>
          </section>
        )}

        {row.photos.length > 0 && (
          <section>
            <h3 style={sectionHead}>{tr('ws.incidents.sheet.photos', { count: formatNumber(row.photos.length, locale) })}</h3>
            {row.redacted ? (
              <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.incidents.sheet.photosGoing')}</p>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))' }}>
                {row.photos.map((p, i) => (
                  <StaffPhoto key={p} path={p} alt={tr('ws.incidents.sheet.photoAlt', { n: formatNumber(i + 1, locale) })} style={{ minBlockSize: '8rem' }} />
                ))}
              </div>
            )}
          </section>
        )}

        <section style={{ borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)' }}>
          {/* The note field names itself; the heading is for the review as read. */}
          {!(reviewable && mode === 'read') && <h3 style={sectionHead}>{tr('ws.incidents.sheet.review')}</h3>}
          {row.status === 'reviewed' ? (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
              <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
                {tr('ws.incidents.reviewedBy', { name: isolate(row.reviewedByName ?? '—'), time: row.reviewedAt ? formatDateTime(new Date(row.reviewedAt), locale) : '' })}
              </span>
              {row.reviewNote && (
                <p dir="auto" style={prose}>
                  {row.reviewNote}
                </p>
              )}
            </div>
          ) : reviewable && mode === 'read' ? (
            <Field
              label={tr('ws.incidents.sheet.note')}
              hint={tr('ws.incidents.sheet.noteHint')}
              required
              error={tried && noteIssue ? tr(noteIssue === 'required' ? 'ws.incidents.sheet.noteRequired' : 'op.errors.TEXT_TOO_LONG') : undefined}
              style={{ marginBlockEnd: 0 }}
            >
              <textarea
                value={note}
                rows={3}
                maxLength={NOTE_MAX}
                dir="auto"
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
                data-testid="incidents.review.note"
              />
            </Field>
          ) : row.status === 'open' ? (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(onlyManagerReviews(row.reportedByRole) ? 'ws.incidents.sheet.ownReportOwner' : 'ws.incidents.sheet.ownReport')}</p>
          ) : null}
        </section>

        <ErrorText error={review.error ?? redact.error} />
      </div>
    </Modal>
  );
}
