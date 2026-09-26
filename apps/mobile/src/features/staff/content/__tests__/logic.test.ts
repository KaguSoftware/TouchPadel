import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import { staffKeys } from '../../keys';
import { staffIdemKey } from '../../../../lib/idempotency';
import type { ContentDetail, ContentItem } from '../api';
import {
  CONTENT_CHANNELS,
  CONTENT_ROLES,
  canSendAgain,
  contentAccess,
  contentArgs,
  currentVersion,
  draftFromDetail,
  emptyContentDraft,
  initialFilter,
  reviseArgs,
  sendAgainDraft,
  validateContent,
  validateDecision,
  type ContentDraft,
} from '../logic';

/**
 * Marketing content as rules (wave5-addendum-2026-09-25 §2.7, §5.3): the
 * checks mirror submit_content and revise_content (0199), and who sends and
 * decides mirrors their guards (§8 Q14: never a manager).
 */
const TODAY = '2026-09-26';

const item: ContentItem = {
  id: 'c-1',
  title: 'Friday latte post',
  channel: 'instagram',
  planned_for: '2026-09-20',
  status: 'changes',
  current_version: 2,
  author_name: 'Noor',
  menu_item_id: 'm-1',
  item_name_en: 'Latte',
  item_name_ar: 'لاتيه',
  campaign_id: null,
  campaign_name_en: null,
  campaign_name_ar: null,
  decided_by_name: null,
  decided_at: null,
  created_at: '2026-09-18T09:00:00Z',
  updated_at: '2026-09-19T09:00:00Z',
};

const detail: ContentDetail = {
  content: item,
  versions: [
    {
      version: 2,
      body: 'Friday is latte day.',
      images: ['v/campaigns/a.jpg'],
      media_link: 'https://example.com/reel',
      note: 'Shorter now',
      submitted_by_name: 'Noor',
      submitted_at: '2026-09-19T09:00:00Z',
      superseded_at: null,
      decision: 'changes',
      decided_by_name: 'Majed',
      decided_at: '2026-09-19T12:00:00Z',
      decision_note: 'Say what time',
    },
    {
      version: 1,
      body: 'Latte day.',
      images: [],
      media_link: null,
      note: null,
      submitted_by_name: 'Noor',
      submitted_at: '2026-09-18T09:00:00Z',
      superseded_at: '2026-09-19T09:00:00Z',
      decision: null,
      decided_by_name: null,
      decided_at: null,
      decision_note: null,
    },
  ],
  can_decide: false,
  can_revise: true,
  can_withdraw: true,
};

const ok: ContentDraft = {
  ...emptyContentDraft(),
  title: 'Friday latte post',
  channel: 'instagram',
  plannedFor: '2026-10-02',
  body: 'Friday is latte day.',
};

describe('who sends and who decides', () => {
  it('is marketing and the owners; a manager is neither', () => {
    expect([...CONTENT_ROLES].sort()).toEqual(['marketing', 'owner']);
    for (const role of STAFF_ROLES) {
      const access = contentAccess(role);
      expect(access.sends, role).toBe(role === 'marketing');
      expect(access.decides, role).toBe(role === 'owner');
    }
    expect(contentAccess('manager')).toEqual({ sends: false, decides: false });
  });

  it('opens the owner on what waits, and marketing on everything', () => {
    expect(initialFilter(contentAccess('owner'))).toBe('waiting');
    expect(initialFilter(contentAccess('marketing'))).toBe('all');
  });

  it('offers the ten channels of 0199', () => {
    expect(CONTENT_CHANNELS).toHaveLength(10);
    expect(CONTENT_CHANNELS).toContain('guest_site');
  });
});

describe('a new item', () => {
  it('passes when complete, and sends empty optional text as null', () => {
    expect(validateContent(ok, TODAY)).toEqual([]);
    expect(
      contentArgs({ ...ok, title: '  Friday latte post ', link: ' ', note: '' }, 'v-1'),
    ).toEqual({
      p_title: 'Friday latte post',
      p_channel: 'instagram',
      p_planned_for: '2026-10-02',
      p_body: 'Friday is latte day.',
      p_images: [],
      p_media_link: null,
      p_note: null,
      p_menu_item_id: null,
      p_campaign_id: null,
      p_venue_id: 'v-1',
    });
  });

  it('needs a title, a channel, a planned day and a caption', () => {
    expect(validateContent(emptyContentDraft(), TODAY)).toEqual([
      { field: 'title', code: 'required' },
      { field: 'channel', code: 'required' },
      { field: 'plannedFor', code: 'required' },
      { field: 'body', code: 'required' },
    ]);
  });

  it('plans it for today or later (INVALID_ARGUMENT hint planned_for)', () => {
    expect(validateContent({ ...ok, plannedFor: TODAY }, TODAY)).toEqual([]);
    expect(validateContent({ ...ok, plannedFor: '2026-09-25' }, TODAY)).toEqual([
      { field: 'plannedFor', code: 'past' },
    ]);
    expect(validateContent({ ...ok, plannedFor: 'soon' }, TODAY)).toEqual([
      { field: 'plannedFor', code: 'invalid' },
    ]);
  });

  it('takes only a full https:// link with no spaces (hint media_link)', () => {
    expect(validateContent({ ...ok, link: 'https://example.com/reel' }, TODAY)).toEqual([]);
    for (const link of [
      'http://example.com',
      'example.com',
      'https://exa mple.com',
      `https://${'x'.repeat(500)}`,
    ]) {
      expect(validateContent({ ...ok, link }, TODAY), link).toEqual([
        { field: 'link', code: 'invalid' },
      ]);
    }
  });

  it('keeps the caps: title 120, caption 4,000, note 1,000, ten images', () => {
    expect(validateContent({ ...ok, title: 'x'.repeat(121) }, TODAY)).toEqual([
      { field: 'title', code: 'tooLong' },
    ]);
    expect(validateContent({ ...ok, body: 'x'.repeat(4001) }, TODAY)).toEqual([
      { field: 'body', code: 'tooLong' },
    ]);
    expect(validateContent({ ...ok, note: 'x'.repeat(1001) }, TODAY)).toEqual([
      { field: 'note', code: 'tooLong' },
    ]);
    const images = Array.from({ length: 11 }, (_, i) => `p/${i}`);
    expect(validateContent({ ...ok, images }, TODAY)).toEqual([
      { field: 'images', code: 'tooLong' },
    ]);
  });

  it('names the item or the campaign it is about, one or the other', () => {
    expect(validateContent({ ...ok, linkKind: 'item', linkId: null }, TODAY)).toEqual([
      { field: 'linkId', code: 'required' },
    ]);
    const args = contentArgs({ ...ok, linkKind: 'campaign', linkId: 'k-1' }, 'v-1');
    expect(args.p_campaign_id).toBe('k-1');
    expect(args.p_menu_item_id).toBeNull();
  });
});

describe('the next version', () => {
  it('reads the version the item is on', () => {
    expect(currentVersion(detail)?.version).toBe(2);
  });

  it('prefills from the current version, images kept, note empty', () => {
    const draft = draftFromDetail(detail);
    expect(draft).toMatchObject({
      title: 'Friday latte post',
      channel: 'instagram',
      plannedFor: '2026-09-20',
      body: 'Friday is latte day.',
      link: 'https://example.com/reel',
      note: '',
      images: ['v/campaigns/a.jpg'],
      linkKind: 'item',
      linkId: 'm-1',
    });
  });

  it('leaves an untouched past planned day alone, and sends untouched header fields as null', () => {
    const draft = { ...draftFromDetail(detail), body: 'Friday is latte day, 8 to 11.' };
    expect(validateContent(draft, TODAY, item)).toEqual([]);
    expect(reviseArgs(draft, item)).toEqual({
      p_id: 'c-1',
      p_body: 'Friday is latte day, 8 to 11.',
      p_images: ['v/campaigns/a.jpg'],
      p_media_link: 'https://example.com/reel',
      p_note: null,
      p_title: null,
      p_channel: null,
      p_planned_for: null,
    });
  });

  it('checks a planned day that was changed, and sends it', () => {
    const moved = { ...draftFromDetail(detail), plannedFor: '2026-09-24' };
    expect(validateContent(moved, TODAY, item)).toEqual([{ field: 'plannedFor', code: 'past' }]);
    const later = {
      ...draftFromDetail(detail),
      plannedFor: '2026-10-03',
      channel: 'tiktok' as const,
    };
    expect(reviseArgs(later, item)).toMatchObject({
      p_planned_for: '2026-10-03',
      p_channel: 'tiktok',
      p_title: null,
    });
  });
});

describe('send again', () => {
  it('only from a closed item', () => {
    expect(canSendAgain('approved')).toBe(true);
    expect(canSendAgain('declined')).toBe(true);
    expect(canSendAgain('withdrawn')).toBe(true);
    expect(canSendAgain('waiting')).toBe(false);
    expect(canSendAgain('changes')).toBe(false);
  });

  it('carries the text and links, never the images, and drops a past planned day', () => {
    const again = sendAgainDraft({ ...detail, content: { ...item, status: 'approved' } }, TODAY);
    expect(again.images).toEqual([]);
    expect(again.plannedFor).toBe('');
    expect(again.body).toBe('Friday is latte day.');
    expect(again.linkId).toBe('m-1');
    const future = sendAgainDraft(
      { ...detail, content: { ...item, planned_for: '2026-10-09' } },
      TODAY,
    );
    expect(future.plannedFor).toBe('2026-10-09');
  });
});

describe('the owner’s decision', () => {
  it('needs a reason to ask for changes or to decline, and none to approve', () => {
    expect(validateDecision('approve', '')).toBeNull();
    expect(validateDecision('changes', ' ')).toBe('required');
    expect(validateDecision('decline', '')).toBe('required');
    expect(validateDecision('decline', 'Off brand')).toBeNull();
    expect(validateDecision('approve', 'x'.repeat(1001))).toBe('tooLong');
  });
});

describe('keys', () => {
  it('stay under the staff root', () => {
    expect(staffKeys.content('v', 'waiting')).toEqual(['staff', 'content', 'v', 'waiting']);
    expect(staffKeys.contentDetail('c-1')).toEqual(['staff', 'contentDetail', 'c-1']);
    expect(staffKeys.mutation('content.decide')).toEqual(['staff', 'mutation', 'content.decide']);
  });

  it('mint a content key as MOBILE:staff.content:<ulid>', () => {
    expect(staffIdemKey('content')).toMatch(/^MOBILE:staff\.content:[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
