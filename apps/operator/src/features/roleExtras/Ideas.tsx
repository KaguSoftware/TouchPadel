/**
 * Ideas from the team (role spec #65; build-contracts-2026-09-23 §5.4).
 *
 * A barista or a chef assistant sends a new-item idea from the phone. It waits
 * for the head of their team (head barista for the bar, head chef for the
 * kitchen), and management sees every team's. Whoever reviews it either starts
 * a product release from it — the head becomes the run's starter, submits the
 * proposal prefilled from the idea, photos carried over — or declines it with
 * a reason the author reads.
 *
 * Two surfaces share this file: /tasks for the heads, and the New item card on
 * /protocols for management. Start differs between them (a form on /tasks, a
 * `?start=product_release&idea=` link on /protocols), so the caller passes it
 * as `onStart`; Decline is the same everywhere (app.decline_release_idea).
 *
 * The list is QK.ideasToReview, app.release_ideas_to_review as returned; a
 * decline or a start refreshes ['ideas'] and ['protocols'].
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { DescriptionList, StatusBadge } from '../../components/kit';
import { ChevronForward } from '../../components/icons';
import { PhotoViewer, StaffPhotoThumb } from '../checklists/StaffPhoto';
import { useStockFormat } from '../stock/stockUi';
import { RK } from './keys';
import { fetchIdeasToReview } from './api';
import { bilingual, list, readIdeasToReview, str, type IdeaRow } from './roleExtrasLogic';

const REASON_MAX = 1000;

/** The waiting ideas the caller may review; off for a role that reviews none. */
export function useIdeasToReview(enabled = true) {
  return useQuery({ queryKey: QK.ideasToReview, queryFn: fetchIdeasToReview, enabled, refetchInterval: 60_000 });
}

/** Ingredient names for an idea's recipe lines: the idea stores ids only. */
function useIngredientNames(enabled: boolean) {
  const q = useQuery({
    queryKey: RK.phone('ingredients'),
    queryFn: () => appRpc<unknown>('staff_ingredient_options', {}),
    enabled,
    staleTime: 5 * 60_000,
  });
  return useMemo(() => {
    const names = new Map<string, { en: string; ar: string }>();
    const payload = q.data as { ingredients?: unknown } | undefined;
    for (const i of list(payload?.ingredients)) {
      if (typeof i.id === 'string') names.set(i.id, { en: str(i.name_en) ?? '', ar: str(i.name_ar) ?? '' });
    }
    return names;
  }, [q.data]);
}

export function ideaName(idea: Pick<IdeaRow, 'nameEn' | 'nameAr'>, locale: 'en' | 'ar'): string {
  return bilingual(locale, idea.nameEn, idea.nameAr);
}

/**
 * The waiting ideas as a list, each opening its sheet. `onStart` hands the
 * idea to the caller's start (the sheet closes first).
 */
export function IdeasToReviewList({ onStart, compact }: { onStart: (idea: IdeaRow) => void; compact?: boolean }) {
  const { tr, locale } = useLocale();
  const q = useIdeasToReview();
  const { ideas } = readIdeasToReview(q.data);
  const [open, setOpen] = useState<IdeaRow | null>(null);

  if (q.isError) return <ErrorText error={q.error} />;
  if (ideas.length === 0) {
    return q.isPending ? null : <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.rolePages.ideas.none')}</p>;
  }
  return (
    <>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
        {ideas.map((idea) => (
          <li key={idea.id}>
            <button
              type="button"
              onClick={() => setOpen(idea)}
              data-testid={`idea-${idea.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--tp-sp-2)',
                inlineSize: '100%',
                paddingBlock: compact ? 'var(--tp-sp-1-5)' : 'var(--tp-sp-2)',
                paddingInline: 'var(--tp-sp-2)',
                border: '1px solid var(--tp-border)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-surface)',
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
                textAlign: 'start',
              }}
            >
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  <bdi>{ideaName(idea, locale) || tr('ws.rolePages.ideas.untitled')}</bdi>
                </span>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.rolePages.ideas.from', {
                    name: isolate(idea.authorName ?? '—'),
                    team: tr(`work.team.${idea.team}`),
                    time: idea.submittedAt ? formatDateTime(new Date(idea.submittedAt), locale) : '',
                  })}
                </span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexShrink: 0, color: 'var(--tp-muted-fg)' }}>
                {idea.photos.length > 0 && (
                  <StatusBadge size="sm" tone="neutral" icon="frame" dot={false} label={formatNumber(idea.photos.length, locale)} />
                )}
                <ChevronForward size={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <IdeaSheet
          idea={open}
          onClose={() => setOpen(null)}
          onStart={(idea) => {
            setOpen(null);
            onStart(idea);
          }}
        />
      )}
    </>
  );
}

/**
 * "N ideas from the team" — the line the New item card on /protocols carries,
 * opening the same list in a dialog. Renders nothing while none wait.
 */
export function IdeasFromTeamButton({ onStart }: { onStart: (idea: IdeaRow) => void }) {
  const { tr, locale } = useLocale();
  const q = useIdeasToReview();
  const { count } = readIdeasToReview(q.data);
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <Button size="sm" kind="soft" icon="spark" onClick={() => setOpen(true)} data-testid="ideas-from-team">
        {tr('ws.rolePages.ideas.fromTeam', { count: formatNumber(count, locale) })}
      </Button>
      {open && (
        <Modal title={tr('ws.rolePages.ideas.title')} onClose={() => setOpen(false)} size="lg">
          <IdeasToReviewList
            onStart={(idea) => {
              setOpen(false);
              onStart(idea);
            }}
          />
        </Modal>
      )}
    </>
  );
}

/** One idea: what the author sent, its photos, Start and Decline. */
export function IdeaSheet({ idea, onClose, onStart }: { idea: IdeaRow; onClose: () => void; onStart: (idea: IdeaRow) => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const fmt = useStockFormat();
  const names = useIngredientNames(idea.lines.some((l) => l.ingredientId));
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState(false);

  const decline = useMutation({
    mutationFn: () => appRpc('decline_release_idea', { p_id: idea.id, p_reason: reason.trim() }),
    onSuccess: () => {
      toast.ok(tr('ws.rolePages.ideas.declined'));
      void qc.invalidateQueries({ queryKey: ['ideas'] });
      void qc.invalidateQueries({ queryKey: ['protocols'] });
      onClose();
    },
  });

  const lineName = (l: IdeaRow['lines'][number]) => {
    if (l.ingredientId) {
      const n = names.get(l.ingredientId);
      if (n) return bilingual(locale, n.en, n.ar);
    }
    return l.label ?? '—';
  };
  const lineQty = (l: IdeaRow['lines'][number]) => (l.qty === null ? '' : l.unit ? fmt.qty(l.qty, l.unit) : fmt.num(l.qty));

  const details: ({ label: string; value: ReactNode } | null | false | '')[] = [
    idea.itemKind && { label: tr('ws.rolePages.ideas.kind'), value: tr(`work.item.kind.${idea.itemKind}`) },
    idea.sizes.length > 0 && {
      label: tr('ws.rolePages.ideas.sizes'),
      value: <bdi>{idea.sizes.map((s) => bilingual(locale, s.nameEn, s.nameAr)).join(' · ')}</bdi>,
    },
    idea.audience && { label: tr('ws.rolePages.ideas.audience'), value: <span dir="auto">{idea.audience}</span> },
    idea.inspiration && { label: tr('ws.rolePages.ideas.inspiration'), value: <span dir="auto">{idea.inspiration}</span> },
    idea.link && {
      label: tr('ws.rolePages.ideas.link'),
      value: (
        <a href={idea.link} target="_blank" rel="noreferrer" dir="ltr" style={{ overflowWrap: 'anywhere' }}>
          {idea.link}
        </a>
      ),
    },
    idea.notes && { label: tr('ws.rolePages.ideas.notes'), value: <span dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{idea.notes}</span> },
  ];
  const shown = details.filter((d): d is { label: string; value: ReactNode } => Boolean(d));

  return (
    <Modal
      title={ideaName(idea, locale) || tr('ws.rolePages.ideas.untitled')}
      subtitle={tr('ws.rolePages.ideas.from', {
        name: isolate(idea.authorName ?? '—'),
        team: tr(`work.team.${idea.team}`),
        time: idea.submittedAt ? formatDateTime(new Date(idea.submittedAt), locale) : '',
      })}
      onClose={onClose}
      dismissible={!decline.isPending}
      size="lg"
      footer={(close) =>
        declining ? (
          <>
            <Button onClick={() => setDeclining(false)} disabled={decline.isPending}>
              {tr('ws.rolePages.ideas.back')}
            </Button>
            <Button kind="danger" busy={decline.isPending} disabled={reason.trim() === ''} onClick={() => decline.mutate()}>
              {tr('ws.rolePages.ideas.declineConfirm')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>{tr('ws.rolePages.ideas.close')}</Button>
            <Button kind="danger" onClick={() => setDeclining(true)} data-testid="idea-decline">
              {tr('ws.rolePages.ideas.decline')}
            </Button>
            <Button kind="primary" icon="plus" onClick={() => onStart(idea)} data-testid="idea-start">
              {tr('ws.rolePages.ideas.start')}
            </Button>
          </>
        )
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {shown.length > 0 && <DescriptionList items={shown} columns={2} />}
        {idea.lines.length > 0 && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <strong style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.rolePages.ideas.lines')}</strong>
            <ul style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-0)' }}>
              {idea.lines.map((l, i) => (
                <li key={i}>
                  <bdi>{lineName(l)}</bdi>
                  {lineQty(l) && <span style={{ color: 'var(--tp-muted-fg)' }}> · {lineQty(l)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {idea.photos.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            {idea.photos.map((p, i) => (
              <StaffPhotoThumb key={p} path={p} label={tr('ws.rolePages.ideas.photo', { n: formatNumber(i + 1, locale) })} onClick={() => setViewing(true)} />
            ))}
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.rolePages.ideas.photosCarried')}</span>
          </div>
        )}
        {declining && (
          <Field label={tr('ws.rolePages.ideas.reason')} hint={tr('ws.rolePages.ideas.reasonHint')} required>
            <textarea
              autoFocus
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              dir="auto"
              style={{ ...inputStyle, minBlockSize: '5rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>
        )}
        <ErrorText error={decline.error} />
      </div>
      {viewing && <PhotoViewer title={ideaName(idea, locale) || tr('ws.rolePages.ideas.untitled')} paths={idea.photos} onClose={() => setViewing(false)} />}
    </Modal>
  );
}
