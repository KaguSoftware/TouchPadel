import { describe, expect, it } from 'vitest';
import { isMediaPath, isVideoPath, mediaPath } from './storage';

const ITEM = '11111111-2222-4333-8444-555555555555';

describe('mediaPath', () => {
  it('nests item and category media under the owner id', () => {
    expect(mediaPath('items', ITEM, 'webp')).toMatch(
      new RegExp(`^items/${ITEM}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(mediaPath('categories', ITEM, 'webp')).toMatch(/^categories\//);
  });

  it('puts hero media in a flat folder and allows video', () => {
    expect(mediaPath('hero', null, 'mp4')).toMatch(/^hero\/[0-9a-f-]{36}\.mp4$/);
  });

  it('refuses owner-less item media', () => {
    expect(() => mediaPath('items', null, 'webp')).toThrow();
  });

  it('never reuses a name', () => {
    expect(mediaPath('hero', null, 'webp')).not.toBe(mediaPath('hero', null, 'webp'));
  });
});

describe('path predicates', () => {
  it('isMediaPath mirrors the conventions', () => {
    expect(isMediaPath(mediaPath('items', ITEM, 'webp'))).toBe(true);
    expect(isMediaPath(mediaPath('hero', null, 'webm'))).toBe(true);
    expect(isMediaPath('items/not-a-uuid/x.webp')).toBe(false);
    expect(isMediaPath('../etc/passwd')).toBe(false);
  });

  it('isVideoPath keys on the extension', () => {
    expect(isVideoPath('hero/a.mp4')).toBe(true);
    expect(isVideoPath('hero/a.webp')).toBe(false);
    expect(isVideoPath(null)).toBe(false);
  });
});
