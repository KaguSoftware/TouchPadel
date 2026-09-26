/**
 * Marketing's send form (wave5-addendum-2026-09-25 §2.7, §5.1): a new post
 * for the owners' approval, the next version of one they asked to change, or
 * a closed one sent again as a new item.
 *
 * Title, channel and the day it is planned for; the caption; images from this
 * computer through the phone's own upload (PhotoField, folder `campaigns`, up
 * to ten, re-encoded and stripped of location data); an optional https:// link
 * for a video or a design file; and a note to the owner about this round. The
 * consent line is the contract's: anyone recognisable in a photo is asked
 * first.
 *
 * A new post may also be about a menu item or a campaign, as on the phone
 * (§2.7); a revision keeps the item's own.
 *
 * It opens inline in the Content section rather than as a dialog. The key
 * follows what is sent: a retry of the same post reuses it, an edit mints a
 * new one, and it goes with the form after a success.
 */
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, isolateLtr, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import { DateField } from '../../components/inputs';
import { Icon } from '../../components/icons';
import { PhotoField } from '../tasks/PhotoField';
import { refusalCode, refusalHint } from '../protocols/errors';
import { venueToday } from '../deductions/venueDate';
import { CK, fetchAboutCampaigns, fetchAboutItems } from './api';
import {
  BODY_MAX,
  CONTENT_ABOUTS,
  CONTENT_CHANNELS,
  IMAGES_MAX,
  LINK_MAX,
  NOTE_MAX,
  TITLE_MAX,
  contentRefusalField,
  reviseArgs,
  submitArgs,
  validateContent,
  type ContentAbout,
  type ContentChannel,
  type ContentDraft,
  type ContentField,
  type ContentIssueCode,
  type ContentRow,
} from './contentLogic';

/** What the form is doing: a new item (possibly prefilled from a closed one), or the next version of one. */
export type ContentFormMode = { kind: 'new'; draft: ContentDraft } | { kind: 'revise'; row: ContentRow; draft: ContentDraft };

const ISSUE_KEY: Record<ContentIssueCode, MessageKey> = {
  required: 'ws.content.form.issue.required',
  tooLong: 'ws.content.form.issue.tooLong',
  past: 'ws.content.form.issue.past',
  link: 'ws.content.form.issue.link',
  tooMany: 'ws.content.form.issue.tooMany',
};
const LIMIT: Partial<Record<ContentField, number>> = { title: TITLE_MAX, body: BODY_MAX, note: NOTE_MAX, images: IMAGES_MAX };
/** The one scheme a link may have, kept left to right inside an Arabic sentence. */
const SCHEME = isolateLtr('https://');

export function ContentForm({ mode, onClose }: { mode: ContentFormMode; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const today = useMemo(() => venueToday(), []);
  const [draft, setDraft] = useState<ContentDraft>(mode.draft);
  const [tried, setTried] = useState(false);
  const revising = mode.kind === 'revise';
  /** One key per post as sent: kept for a retry of it, renewed by an edit (claim_replay compares no payload). */
  const key = useRef<{ sig: string; key: string } | null>(null);
  const keyFor = (args: unknown): string => {
    const sig = JSON.stringify(args);
    if (key.current?.sig !== sig) key.current = { sig, key: `${revising ? 'content.revise' : 'content.submit'}:${crypto.randomUUID()}` };
    return key.current.key;
  };

  const aboutKind = draft.about === 'none' ? null : draft.about;
  const aboutQ = useQuery({
    queryKey: CK.about(aboutKind ?? 'item'),
    queryFn: () => (aboutKind === 'campaign' ? fetchAboutCampaigns() : fetchAboutItems()),
    enabled: !revising && aboutKind !== null,
    staleTime: 5 * 60_000,
  });
  const aboutName = (o: { nameEn: string; nameAr: string }) => (locale === 'ar' ? o.nameAr || o.nameEn : o.nameEn || o.nameAr);

  const issues = validateContent(draft, today, revising ? mode.row.plannedFor : null);
  const send = useMutation({
    mutationFn: () =>
      mode.kind === 'revise'
        ? appRpc('revise_content', reviseArgs(mode.row.id, draft, mode.row, keyFor(reviseArgs(mode.row.id, draft, mode.row, ''))))
        : appRpc('submit_content', submitArgs(draft, keyFor(submitArgs(draft, '')))),
    onSuccess: () => {
      toast.ok(tr(revising ? 'ws.content.form.revised' : 'ws.content.form.sent'));
      void qc.invalidateQueries({ queryKey: CK.all });
      onClose();
    },
  });

  const serverField = contentRefusalField(refusalCode(send.error), refusalHint(send.error));
  const errorOf = (field: ContentField): string | undefined => {
    const issue = tried ? issues.find((i) => i.field === field) : undefined;
    if (issue) return tr(ISSUE_KEY[issue.code], { limit: formatNumber(LIMIT[field] ?? 0, locale), scheme: SCHEME });
    if (serverField === field && send.error) return tr(`ws.content.form.refused.${field}` as MessageKey, { scheme: SCHEME });
    return undefined;
  };
  const set = (patch: Partial<ContentDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (send.isError) send.reset();
  };
  const busy = send.isPending;

  return (
    <form
      noValidate
      data-testid="content.form"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (issues.length === 0 && !busy) send.mutate();
      }}
    >
      <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-3)' }}>
        {revising ? tr('ws.content.form.reviseTitle', { n: formatNumber(mode.row.currentVersion + 1, locale) }) : tr('ws.content.form.newTitle')}
      </h3>
      <Field label={tr('ws.content.form.title')} required error={errorOf('title')}>
        <input value={draft.title} maxLength={TITLE_MAX} dir="auto" disabled={busy} onChange={(e) => set({ title: e.target.value })} style={inputStyle} data-testid="content.form.title" />
      </Field>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
        <Field label={tr('ws.content.form.channel')} required error={errorOf('channel')} style={{ flex: '1 1 14rem' }}>
          <Select<ContentChannel>
            value={draft.channel}
            placeholder={tr('ws.content.form.chooseChannel')}
            disabled={busy}
            options={CONTENT_CHANNELS.map((c) => ({ value: c, label: tr(`work.content.channel.${c}`) }))}
            onChange={(c) => set({ channel: c })}
          />
        </Field>
        <Field label={tr('ws.content.form.plannedFor')} required hint={tr('ws.content.form.plannedForHint')} error={errorOf('plannedFor')} style={{ flex: '1 1 12rem' }}>
          <DateField value={draft.plannedFor} min={today} disabled={busy} onChange={(v) => set({ plannedFor: v })} />
        </Field>
      </div>
      <Field label={tr('ws.content.form.body')} required error={errorOf('body')}>
        <textarea
          value={draft.body}
          rows={6}
          maxLength={BODY_MAX}
          dir="auto"
          disabled={busy}
          onChange={(e) => set({ body: e.target.value })}
          style={{ ...inputStyle, minBlockSize: '8rem', resize: 'vertical', fontFamily: 'inherit' }}
          data-testid="content.form.body"
        />
      </Field>
      <PhotoField folder="campaigns" paths={draft.images} onChange={(images) => set({ images })} min={0} max={IMAGES_MAX} disabled={busy} error={errorOf('images')} />
      <p style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', marginBlock: 'calc(-1 * var(--tp-sp-2)) var(--tp-sp-4)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        <Icon name="users" size={16} style={{ marginBlockStart: '0.1rem' }} />
        {tr('ws.content.form.consentHint')}
      </p>
      <Field label={tr('ws.content.form.link')} optional hint={tr('ws.content.form.linkHint', { scheme: SCHEME })} error={errorOf('link')}>
        <input
          value={draft.link}
          type="url"
          inputMode="url"
          maxLength={LINK_MAX}
          dir="ltr"
          placeholder="https://"
          disabled={busy}
          onChange={(e) => set({ link: e.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label={tr('ws.content.form.note')} optional hint={tr('ws.content.form.noteHint')} error={errorOf('note')}>
        <textarea
          value={draft.note}
          rows={2}
          maxLength={NOTE_MAX}
          dir="auto"
          disabled={busy}
          onChange={(e) => set({ note: e.target.value })}
          style={{ ...inputStyle, minBlockSize: '3.5rem', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      {!revising && (
        <Field label={tr('ws.content.form.about')} optional group error={errorOf('about')}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <SegmentedControl<ContentAbout>
              size="sm"
              aria-label={tr('ws.content.form.about')}
              value={draft.about}
              onChange={(about) => set({ about, aboutId: '' })}
              options={CONTENT_ABOUTS.map((a) => ({ value: a, label: tr(`ws.content.form.abouts.${a}`) }))}
            />
            {aboutKind && (
              <div style={{ minInlineSize: '18rem' }}>
                <Select<string>
                  value={draft.aboutId}
                  placeholder={aboutQ.isPending ? tr('common.loading') : tr(aboutKind === 'item' ? 'ws.content.form.chooseItem' : 'ws.content.form.chooseCampaign')}
                  disabled={busy || aboutQ.isPending}
                  options={(aboutQ.data ?? []).map((o) => ({ value: o.id, label: aboutName(o) }))}
                  onChange={(aboutId) => set({ aboutId })}
                />
              </div>
            )}
            {aboutQ.isError && <ErrorText error={aboutQ.error} style={{ marginBlock: 0 }} />}
          </div>
        </Field>
      )}
      {send.isError && serverField === null && <ErrorText error={send.error} />}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button kind="ghost" onClick={onClose} disabled={busy}>
          {tr('common.cancel')}
        </Button>
        <Button kind="primary" type="submit" icon="check" busy={busy} data-testid="content.form.submit">
          {tr(revising ? 'ws.content.form.reviseSubmit' : 'ws.content.form.submit')}
        </Button>
      </div>
    </form>
  );
}
