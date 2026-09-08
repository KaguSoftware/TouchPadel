import { describe, it, expect } from 'vitest';
import { campaignTone, isEditable, nextStatuses, type CampaignStatus } from './marketingTypes';

const ALL: CampaignStatus[] = ['draft', 'scheduled', 'live', 'ended', 'cancelled'];

describe('nextStatuses', () => {
  it('mirrors the lifecycle app.set_campaign_status enforces', () => {
    expect(nextStatuses('draft')).toEqual(['scheduled', 'cancelled']);
    expect(nextStatuses('scheduled')).toEqual(['live', 'draft', 'cancelled']);
    expect(nextStatuses('live')).toEqual(['ended', 'cancelled']);
  });

  it('offers nothing from a terminal state', () => {
    expect(nextStatuses('ended')).toEqual([]);
    expect(nextStatuses('cancelled')).toEqual([]);
  });

  it('never offers a move the server would refuse', () => {
    // draft -> live is the one an impatient owner reaches for; the server
    // raises BAD_TRANSITION, so the button must not exist.
    expect(nextStatuses('draft')).not.toContain('live');
    // Nothing ever returns to draft from live.
    expect(nextStatuses('live')).not.toContain('draft');
    // A campaign never moves to the state it is already in.
    for (const s of ALL) expect(nextStatuses(s)).not.toContain(s);
  });
});

describe('isEditable', () => {
  it('allows editing only before the message goes out', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('scheduled')).toBe(true);
    // CAMPAIGN_LOCKED in 0073: people have already received it.
    expect(isEditable('live')).toBe(false);
    expect(isEditable('ended')).toBe(false);
    expect(isEditable('cancelled')).toBe(false);
  });
});

describe('campaignTone', () => {
  it('gives every status a tone', () => {
    for (const s of ALL) expect(campaignTone(s)).toBeTruthy();
  });

  it('reserves success for what is actually running', () => {
    expect(campaignTone('live')).toBe('success');
    expect(campaignTone('ended')).toBe('neutral');
  });
});
