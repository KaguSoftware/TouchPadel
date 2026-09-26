import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  canSendAgain,
  contentRefusalField,
  contentTone,
  contentWaitingCount,
  decisionIssue,
  decisionTone,
  draftFrom,
  readCampaignOptions,
  readContentDetail,
  readContentPage,
  reviseArgs,
  submitArgs,
  validateContent,
  type ContentDraft,
} from './contentLogic';

// Marketing content for the owners' approval, pure (wave5-addendum-2026-09-25
// §2.7, §5.2): the readers of app.content_page and app.content_detail, the
// send form's rules, and what a revision and "Send again" start from.

const header = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  title: 'Friday night padel',
  channel: 'instagram',
  planned_for: '2026-10-02',
  status: 'waiting',
  current_version: 2,
  author_name: 'Hanan',
  submitted_at: '2026-09-26T08:00:00Z',
  cover_image: 'v1/campaigns/a.jpg',
  menu_item_id: null,
  item_name_en: null,
  item_name_ar: null,
  campaign_id: null,
  campaign_name_en: null,
  campaign_name_ar: null,
  decided_by_name: null,
  decided_at: null,
  updated_at: '2026-09-26T08:00:00Z',
  ...over,
});

const detail = {
  content: header(),
  versions: [
    { version: 1, body: 'First caption', images: ['v1/campaigns/a.jpg', 'v1/campaigns/b.jpg'], media_link: null, note: 'Draft', submitted_by_name: 'Hanan', submitted_at: '2026-09-25T08:00:00Z', superseded_at: null, decision: 'changes', decided_by_name: 'Majed', decided_at: '2026-09-25T20:00:00Z', decision_note: 'Shorter, please' },
    { version: 2, body: 'Shorter caption', images: ['v1/campaigns/a.jpg'], media_link: 'https://example.com/reel', note: null, submitted_by_name: 'Hanan', submitted_at: '2026-09-26T08:00:00Z', superseded_at: null, decision: null, decided_by_name: null, decided_at: null, decision_note: null },
  ],
  can_decide: true,
  can_revise: false,
  can_withdraw: false,
};

describe('the readers', () => {
  it('reads app.content_page as returned; its waiting count is the owner’s badge', () => {
    const payload = { content: [header(), { title: 'no id' }], waiting_count: 1, total: 4 };
    const page = readContentPage(payload);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ id: 'k1', channel: 'instagram', plannedFor: '2026-10-02', status: 'waiting', currentVersion: 2, authorName: 'Hanan', coverImage: 'v1/campaigns/a.jpg' });
    expect(page.total).toBe(4);
    expect(contentWaitingCount(payload)).toBe(1);
    expect(contentWaitingCount(null)).toBe(0);
  });

  it('reads an unknown channel as Other and an unknown status as waiting', () => {
    const r = readContentPage({ content: [header({ channel: 'myspace', status: 'posted', current_version: 0 })] }).rows[0]!;
    expect(r.channel).toBe('other');
    expect(r.status).toBe('waiting');
    expect(r.currentVersion).toBe(1);
  });

  it('reads app.content_detail newest version first, with each round’s decision', () => {
    const d = readContentDetail(detail);
    expect(d.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(d.versions[1]).toMatchObject({ decision: 'changes', decisionNote: 'Shorter, please', images: ['v1/campaigns/a.jpg', 'v1/campaigns/b.jpg'] });
    expect(d.versions[0]).toMatchObject({ decision: null, mediaLink: 'https://example.com/reel' });
    expect(d).toMatchObject({ canDecide: true, canRevise: false, canWithdraw: false });
    expect(readContentDetail(undefined)).toEqual({ content: null, versions: [], canDecide: false, canRevise: false, canWithdraw: false });
  });

  it('marks what waits on someone amber, approved green and declined red', () => {
    expect(contentTone('waiting')).toBe('warn');
    expect(contentTone('changes')).toBe('warn');
    expect(contentTone('approved')).toBe('success');
    expect(contentTone('declined')).toBe('danger');
    expect(contentTone('withdrawn')).toBe('neutral');
    expect(decisionTone('approve')).toBe('success');
    expect(decisionTone('changes')).toBe('warn');
    expect(decisionTone('decline')).toBe('danger');
  });

  it('sends a closed post again as a new one, and never an open one', () => {
    expect(canSendAgain('approved')).toBe(true);
    expect(canSendAgain('declined')).toBe(true);
    expect(canSendAgain('withdrawn')).toBe(true);
    expect(canSendAgain('waiting')).toBe(false);
    expect(canSendAgain('changes')).toBe(false);
  });
});

describe('the owner’s decision', () => {
  it('needs a reason to ask for changes or to decline, never to approve', () => {
    expect(decisionIssue('approve', '')).toBeNull();
    expect(decisionIssue('changes', ' ')).toBe('required');
    expect(decisionIssue('decline', '')).toBe('required');
    expect(decisionIssue('decline', 'Off brand')).toBeNull();
    expect(decisionIssue('changes', 'x'.repeat(1001))).toBe('tooLong');
  });
});

describe('the send form', () => {
  const today = '2026-09-26';
  const good: ContentDraft = { title: 'Friday night padel', channel: 'instagram', plannedFor: '2026-10-02', body: 'Caption', images: [], link: '', note: '', about: 'none', aboutId: '' };

  it('passes a good post and asks for what is missing', () => {
    expect(validateContent(good, today)).toEqual([]);
    expect(validateContent(EMPTY_DRAFT, today)).toEqual([
      { field: 'title', code: 'required' },
      { field: 'channel', code: 'required' },
      { field: 'plannedFor', code: 'required' },
      { field: 'body', code: 'required' },
    ]);
  });

  it('refuses a past day, but keeps a stored one a revision leaves alone', () => {
    expect(validateContent({ ...good, plannedFor: '2026-09-25' }, today)).toEqual([{ field: 'plannedFor', code: 'past' }]);
    expect(validateContent({ ...good, plannedFor: today }, today)).toEqual([]);
    expect(validateContent({ ...good, plannedFor: '2026-09-20' }, today, '2026-09-20')).toEqual([]);
    expect(validateContent({ ...good, plannedFor: '2026-09-21' }, today, '2026-09-20')).toEqual([{ field: 'plannedFor', code: 'past' }]);
  });

  it('takes only a full https:// link, up to ten images and the server’s lengths', () => {
    expect(validateContent({ ...good, link: 'http://example.com' }, today)).toEqual([{ field: 'link', code: 'link' }]);
    expect(validateContent({ ...good, link: 'https://example.com/a b' }, today)).toEqual([{ field: 'link', code: 'link' }]);
    expect(validateContent({ ...good, link: ` https://example.com/${'a'.repeat(470)} ` }, today)).toEqual([]);
    expect(validateContent({ ...good, link: `https://example.com/${'a'.repeat(490)}` }, today)).toEqual([{ field: 'link', code: 'link' }]);
    expect(validateContent({ ...good, images: Array.from({ length: 11 }, (_, i) => `p${i}`) }, today)).toEqual([{ field: 'images', code: 'tooMany' }]);
    expect(validateContent({ ...good, title: 'ع'.repeat(121) }, today)).toEqual([{ field: 'title', code: 'tooLong' }]);
    expect(validateContent({ ...good, body: 'x'.repeat(4001) }, today)).toEqual([{ field: 'body', code: 'tooLong' }]);
    expect(validateContent({ ...good, note: 'x'.repeat(1001) }, today)).toEqual([{ field: 'note', code: 'tooLong' }]);
  });

  it('sends a new post trimmed, with blanks as NULL and the form’s key', () => {
    expect(submitArgs({ ...good, title: ' Friday night padel ', link: ' ', note: ' For Friday ' }, 'content.submit:k')).toEqual({
      p_title: 'Friday night padel',
      p_channel: 'instagram',
      p_planned_for: '2026-10-02',
      p_body: 'Caption',
      p_images: [],
      p_media_link: null,
      p_note: 'For Friday',
      p_menu_item_id: null,
      p_campaign_id: null,
      p_idempotency_key: 'content.submit:k',
    });
  });

  it('sends what else a new post is about, as the phone does, and asks for the choice once a kind is picked', () => {
    expect(submitArgs({ ...good, about: 'item', aboutId: 'm1' }, 'k')).toMatchObject({ p_menu_item_id: 'm1', p_campaign_id: null });
    expect(submitArgs({ ...good, about: 'campaign', aboutId: 'c1' }, 'k')).toMatchObject({ p_menu_item_id: null, p_campaign_id: 'c1' });
    expect(validateContent({ ...good, about: 'item', aboutId: '' }, today)).toEqual([{ field: 'about', code: 'required' }]);
    expect(contentRefusalField('ITEM_NOT_FOUND', null)).toBe('about');
    expect(contentRefusalField('CAMPAIGN_NOT_FOUND', null)).toBe('about');
    expect(readCampaignOptions({ campaigns: [{ campaign_id: 'c1', name_en: 'Ladies night', name_ar: 'ليلة السيدات' }, { name_en: 'no id' }] })).toEqual([
      { id: 'c1', nameEn: 'Ladies night', nameAr: 'ليلة السيدات' },
    ]);
  });

  it('sends a revision’s header fields only when they changed (NULL keeps the stored value)', () => {
    const before = { title: 'Friday night padel', channel: 'instagram' as const, plannedFor: '2026-10-02' };
    expect(reviseArgs('k1', good, before, 'content.revise:k')).toEqual({
      p_id: 'k1',
      p_body: 'Caption',
      p_images: [],
      p_media_link: null,
      p_note: null,
      p_title: null,
      p_channel: null,
      p_planned_for: null,
      p_idempotency_key: 'content.revise:k',
    });
    const changed = reviseArgs('k1', { ...good, title: 'Saturday padel', channel: 'tiktok', plannedFor: '2026-10-03' }, before, 'k');
    expect([changed.p_title, changed.p_channel, changed.p_planned_for]).toEqual(['Saturday padel', 'tiktok', '2026-10-03']);
  });

  it('starts a revision from the newest version, and “Send again” without its photos or its day', () => {
    const d = readContentDetail(detail);
    expect(draftFrom(d, 'revise')).toEqual({
      title: 'Friday night padel',
      channel: 'instagram',
      plannedFor: '2026-10-02',
      body: 'Shorter caption',
      images: ['v1/campaigns/a.jpg'],
      link: 'https://example.com/reel',
      note: '',
      about: 'none',
      aboutId: '',
    });
    // Each item claims its own photos (a path another item holds is PHOTO_PATH_INVALID).
    expect(draftFrom(d, 'again')).toMatchObject({ plannedFor: '', images: [], body: 'Shorter caption', note: '' });
  });

  it('marks the field a server refusal names', () => {
    expect(contentRefusalField('TEXT_TOO_LONG', 'title')).toBe('title');
    expect(contentRefusalField('TEXT_REQUIRED', 'body')).toBe('body');
    expect(contentRefusalField('INVALID_ARGUMENT', 'planned_for')).toBe('plannedFor');
    expect(contentRefusalField('INVALID_ARGUMENT', 'media_link')).toBe('link');
    expect(contentRefusalField('INVALID_ARGUMENT', 'images')).toBe('images');
    expect(contentRefusalField('PHOTO_PATH_INVALID', null)).toBe('images');
    expect(contentRefusalField('SUBMISSION_DECIDED', null)).toBeNull();
  });
});
