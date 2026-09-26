/**
 * One content item and every version of it (wave5-addendum-2026-09-25
 * §2.7.2, §5.2), from app.content_detail. The owner and marketing open the
 * same sheet and get different footers:
 *
 *  - **The owner** (can_decide): Approve, Ask for changes or Decline. The two
 *    that send it back need a reason, which marketing reads; the outlined
 *    buttons lead to the reason and its confirm (Decline's red, Ask for
 *    changes' blue: asking for changes is part of the job, not a loss). The
 *    decision is on the version the owner is reading, so a newer one sent in
 *    the meantime is refused, never silently decided. The owner never edits
 *    the text.
 *  - **Marketing**: Revise (the form opens prefilled with this version) and
 *    Withdraw while it waits or changes were asked; Send again once it is
 *    closed, which starts a new item from this one.
 *
 * The newest version is open; earlier ones fold under it, each with the
 * decision and reason it got. Images are read by signed URL (ten minutes,
 * StaffPhoto). The link is shown as text with Copy and never opened here
 * (§2.7.1: a reel's link, not something the till should follow).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { StaffPhoto } from '../checklists/StaffPhoto';
import { bilingual } from '../roleExtras/roleExtrasLogic';
import { dayLabel } from '../deductions/venueDate';
import { isStaleRefusal } from '../deductions/deductionsLogic';
import { refusalCode } from '../protocols/errors';
import { CK } from './api';
import {
  NOTE_MAX,
  canSendAgain,
  contentTone,
  decisionIssue,
  decisionTone,
  readContentDetail,
  type ContentDecision,
  type ContentDetail,
  type ContentRow,
  type ContentVersion,
} from './contentLogic';

type Mode = 'read' | 'changes' | 'decline' | 'withdraw';

const sectionHead = { fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1)' } as const;
const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;
/** Staff free text as typed: one measure for every block, so captions, notes and reasons line up in either direction. */
// fit-content: a short line in the other script sits beside its label instead
// of floating at the far end of a 68ch box.
const prose = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', inlineSize: 'fit-content', maxInlineSize: '68ch', margin: 0 } as const;

export function ContentSheet({
  id,
  viewer,
  fallback,
  onClose,
  onRevise,
  onSendAgain,
}: {
  id: string;
  /** Whose panel opened it: the owner's on /marketing, or marketing's on /tasks. */
  viewer: 'owner' | 'marketing';
  /** The list's row, shown while the detail loads. */
  fallback: ContentRow | null;
  onClose: () => void;
  /** Marketing: open the form on this item's newest version. */
  onRevise?: (detail: ContentDetail) => void;
  /** Marketing: start a new item from this closed one. */
  onSendAgain?: (detail: ContentDetail) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('read');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const q = useQuery({ queryKey: CK.detail(id), queryFn: () => appRpc<unknown>('content_detail', { p_id: id }) });
  const detail = readContentDetail(q.data);
  const head = detail.content ?? fallback;
  const current = detail.versions[0] ?? null;

  const finish = (message: string) => {
    toast.ok(message);
    void qc.invalidateQueries({ queryKey: CK.all });
    onClose();
  };
  const decide = useMutation({
    mutationFn: (decision: ContentDecision) =>
      appRpc('decide_content', { p_id: id, p_version: current?.version ?? head?.currentVersion ?? 1, p_decision: decision, p_note: note.trim() === '' ? null : note.trim() }),
    onSuccess: (_d, decision) => finish(tr(`ws.content.sheet.done.${decision}`, { name: isolate(head?.authorName ?? '') })),
    // A newer version arrived, or someone decided first: the message stays and
    // the sheet reloads to show what is there now.
    onError: (e) => isStaleRefusal(refusalCode(e)) && void qc.invalidateQueries({ queryKey: CK.all }),
  });
  const withdraw = useMutation({
    mutationFn: () => appRpc('withdraw_content', { p_id: id }),
    onSuccess: () => finish(tr('ws.content.sheet.withdrawn')),
    onError: (e) => isStaleRefusal(refusalCode(e)) && void qc.invalidateQueries({ queryKey: CK.all }),
  });
  const busy = decide.isPending || withdraw.isPending;
  const reasonDecision: ContentDecision | null = mode === 'changes' ? 'changes' : mode === 'decline' ? 'decline' : null;
  const issue = reasonDecision ? decisionIssue(reasonDecision, note) : null;
  const sendsAgain = viewer === 'marketing' && head !== null && canSendAgain(head.status) && onSendAgain !== undefined;

  const back = () => {
    setMode('read');
    setTried(false);
    decide.reset();
    withdraw.reset();
  };

  const footer = (close: () => void) => {
    if (mode === 'changes' || mode === 'decline') {
      return (
        <>
          <Button onClick={back} disabled={busy}>
            {tr('common.back')}
          </Button>
          <Button
            kind={mode === 'decline' ? 'danger' : 'primary'}
            busy={decide.isPending}
            style={mode === 'decline' ? { marginInlineStart: 'auto' } : undefined}
            data-testid="content.decide.confirm"
            onClick={() => {
              setTried(true);
              if (issue === null) decide.mutate(mode);
            }}
          >
            {tr(mode === 'decline' ? 'ws.content.sheet.declineConfirm' : 'ws.content.sheet.changesConfirm')}
          </Button>
        </>
      );
    }
    if (mode === 'withdraw') {
      return (
        <>
          <Button onClick={back} disabled={busy}>
            {tr('ws.content.sheet.keep')}
          </Button>
          <Button kind="danger" busy={withdraw.isPending} style={{ marginInlineStart: 'auto' }} onClick={() => withdraw.mutate()} data-testid="content.withdraw.confirm">
            {tr('ws.content.sheet.withdrawConfirm')}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button onClick={close} disabled={busy}>
          {tr('common.close')}
        </Button>
        {detail.canDecide && (
          <>
            <Button icon="undo" onClick={() => setMode('changes')} disabled={busy} data-testid="content.decide.changes">
              {tr('work.content.decision.changes')}
            </Button>
            <Button icon="x" onClick={() => setMode('decline')} disabled={busy} data-testid="content.decide.decline">
              {tr('work.content.decision.decline')}
            </Button>
            <Button kind="primary" icon="check" busy={decide.isPending} onClick={() => decide.mutate('approve')} data-testid="content.decide.approve">
              {tr('ws.content.sheet.approveVersion', { n: formatNumber(current?.version ?? head?.currentVersion ?? 1, locale) })}
            </Button>
          </>
        )}
        {detail.canWithdraw && (
          <Button icon="ban" onClick={() => setMode('withdraw')} disabled={busy} data-testid="content.withdraw">
            {tr('ws.content.sheet.withdraw')}
          </Button>
        )}
        {detail.canRevise && onRevise && (
          <Button kind="primary" icon="note" onClick={() => onRevise(detail)} disabled={busy} data-testid="content.revise">
            {tr('ws.content.sheet.revise')}
          </Button>
        )}
        {sendsAgain && (
          <Button icon="repeat" onClick={() => onSendAgain?.(detail)} disabled={busy} data-testid="content.again">
            {tr('ws.content.sheet.sendAgain')}
          </Button>
        )}
      </>
    );
  };

  return (
    <Modal
      title={head?.title || tr('ws.content.title')}
      titleAfter={head ? <StatusBadge size="sm" tone={contentTone(head.status)} label={tr(`work.content.status.${head.status}`)} /> : undefined}
      subtitle={head ? <HeadLine row={head} /> : undefined}
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      footer={footer}
    >
      {q.isError && q.data === undefined ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('common.retry')}
          </Button>
        </div>
      ) : q.data === undefined ? (
        <Skeleton lines={6} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          {head && (bilingual(locale, head.itemNameEn, head.itemNameAr) || bilingual(locale, head.campaignNameEn, head.campaignNameAr)) && (
            <p style={{ ...muted, margin: 0 }}>
              {[
                bilingual(locale, head.itemNameEn, head.itemNameAr) ? tr('ws.content.sheet.item', { name: isolate(bilingual(locale, head.itemNameEn, head.itemNameAr)) }) : null,
                bilingual(locale, head.campaignNameEn, head.campaignNameAr) ? tr('ws.content.sheet.campaign', { name: isolate(bilingual(locale, head.campaignNameEn, head.campaignNameAr)) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {mode === 'withdraw' && <MessagePresenter tone="refused" icon="ban" message={tr('ws.content.sheet.withdrawBody')} />}

          {current && <VersionBlock version={current} newest />}

          {reasonDecision && (
            <Field
              label={tr(reasonDecision === 'decline' ? 'ws.content.sheet.declineReason' : 'ws.content.sheet.changesReason')}
              hint={tr('ws.content.sheet.reasonHint', { name: isolate(head?.authorName ?? '') })}
              required
              error={tried && issue ? tr(issue === 'required' ? 'op.errors.REASON_REQUIRED' : 'op.errors.TEXT_TOO_LONG') : undefined}
              style={{ marginBlockEnd: 0 }}
            >
              <textarea
                autoFocus
                value={note}
                rows={3}
                maxLength={NOTE_MAX}
                dir="auto"
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
                style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical', fontFamily: 'inherit' }}
                data-testid="content.decide.note"
              />
            </Field>
          )}

          {detail.versions.length > 1 && <EarlierVersions versions={detail.versions.slice(1)} />}

          {viewer === 'owner' && head?.status === 'waiting' && !detail.canDecide && (
            <p style={{ ...muted, margin: 0 }}>{tr('ws.content.sheet.ownPost')}</p>
          )}
          <ErrorText error={decide.error ?? withdraw.error} />
        </div>
      )}
    </Modal>
  );
}

/** "Instagram · for 30 Sep 2026 · by Hanan": the channel, the day it is planned for, and who wrote it. */
function HeadLine({ row }: { row: ContentRow }) {
  const { tr, locale } = useLocale();
  return (
    <span>
      {[
        tr(`work.content.channel.${row.channel}`),
        row.plannedFor ? tr('ws.content.plannedFor', { date: dayLabel(row.plannedFor, locale) }) : null,
        row.authorName ? tr('ws.content.byName', { name: isolate(row.authorName) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

/** One version: who sent it, what became of it, the caption as typed, the images, the link and the note. */
function VersionBlock({ version: v, newest, folded }: { version: ContentVersion; newest?: boolean; folded?: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const when = (iso: string | null) => (iso ? formatDateTime(new Date(iso), locale) : '');
  const copy = (link: string) => {
    const done = () => toast.ok(tr('ws.content.sheet.copied'));
    const failed = () => toast.info(tr('ws.content.sheet.copyFailed'));
    try {
      void navigator.clipboard.writeText(link).then(done, failed);
    } catch {
      failed();
    }
  };
  return (
    <section data-testid={`content.version.${v.version}`} style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {folded ? (
        // The folded row above already names the version, its outcome and when.
        <span style={muted}>{tr('ws.content.sheet.sentBy', { name: isolate(v.submittedByName ?? '—'), time: when(v.submittedAt) })}</span>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: newest ? 'var(--tp-fs-md)' : 'var(--tp-fs-sm)', fontWeight: 700 }}>{tr('ws.content.sheet.version', { n: formatNumber(v.version, locale) })}</h3>
          <span style={muted}>{tr('ws.content.sheet.sentBy', { name: isolate(v.submittedByName ?? '—'), time: when(v.submittedAt) })}</span>
          {v.decision && <StatusBadge size="sm" tone={decisionTone(v.decision)} label={tr(`ws.content.sheet.decided.${v.decision}`)} />}
          {!v.decision && v.supersededAt && <StatusBadge size="sm" tone="neutral" label={tr('ws.content.sheet.superseded')} />}
        </div>
      )}
      {v.decision && v.decidedAt && (
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-0)',
            paddingBlock: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface-2)',
          }}
        >
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.content.sheet.decidedBy', { name: isolate(v.decidedByName ?? '—'), time: when(v.decidedAt) })}</span>
          {v.decisionNote && (
            <p dir="auto" style={prose}>
              {v.decisionNote}
            </p>
          )}
        </div>
      )}
      <div>
        <h4 style={sectionHead}>{tr('ws.content.sheet.caption')}</h4>
        <p dir="auto" style={prose}>
          {v.body}
        </p>
      </div>
      {v.images.length > 0 && (
        <div>
          <h4 style={sectionHead}>{tr('ws.content.sheet.images', { count: formatNumber(v.images.length, locale) })}</h4>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
            {v.images.map((p, i) => (
              <StaffPhoto key={p} path={p} alt={tr('ws.content.sheet.imageAlt', { n: formatNumber(i + 1, locale) })} style={{ minBlockSize: '8rem' }} />
            ))}
          </div>
        </div>
      )}
      {v.mediaLink && (
        <div>
          <h4 style={sectionHead}>{tr('ws.content.sheet.link')}</h4>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <bdi dir="ltr" style={{ fontFamily: 'var(--tp-font-numeric)', fontSize: 'var(--tp-fs-sm)', overflowWrap: 'anywhere', userSelect: 'all' }}>
              {v.mediaLink}
            </bdi>
            <Button size="sm" kind="ghost" onClick={() => copy(v.mediaLink!)} data-testid={`content.copy.${v.version}`}>
              {tr('ws.content.sheet.copy')}
            </Button>
          </span>
        </div>
      )}
      {v.note && (
        <div>
          <h4 style={sectionHead}>{tr('ws.content.sheet.note')}</h4>
          <p dir="auto" style={prose}>
            {v.note}
          </p>
        </div>
      )}
    </section>
  );
}

/** The versions before the newest, folded: each opens to what it said and what the owner answered. */
function EarlierVersions({ versions }: { versions: readonly ContentVersion[] }) {
  const { tr, locale } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section style={{ borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <h3 style={sectionHead}>{tr('ws.content.sheet.earlier', { count: formatNumber(versions.length, locale) })}</h3>
      {versions.map((v) => {
        const expanded = open === v.version;
        const label: MessageKey = v.decision ? `ws.content.sheet.decided.${v.decision}` : 'ws.content.sheet.superseded';
        return (
          <div key={v.version} style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <button
              type="button"
              className="tp-row"
              data-clickable="true"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : v.version)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                inlineSize: '100%',
                paddingBlock: 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-3)',
                border: '1px solid var(--tp-border)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface)',
                color: 'inherit',
                font: 'inherit',
                textAlign: 'start',
                cursor: 'pointer',
              }}
            >
              <strong>{tr('ws.content.sheet.version', { n: formatNumber(v.version, locale) })}</strong>
              <StatusBadge size="sm" tone={v.decision ? decisionTone(v.decision) : 'neutral'} label={tr(label)} />
              <span style={{ ...muted, marginInlineStart: 'auto' }}>{v.submittedAt ? formatDateTime(new Date(v.submittedAt), locale) : ''}</span>
              <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
            {expanded && (
              <div style={{ paddingInlineStart: 'var(--tp-sp-4)' }}>
                <VersionBlock version={v} folded />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
