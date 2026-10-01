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

  it('files a coach photo in a fresh random folder, never under an owner id (coaching R43)', () => {
    const a = mediaPath('coaches', null, 'webp');
    const b = mediaPath('coaches', null, 'webp');
    expect(a).toMatch(/^coaches\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/);
    // A new folder on every call, not just a new file name.
    expect(a.split('/')[1]).not.toBe(b.split('/')[1]);
    // An id handed in (a profile or a coach) never reaches the path.
    const withOwner = mediaPath('coaches', ITEM, 'jpg');
    expect(withOwner).not.toContain(ITEM);
    expect(withOwner).toMatch(/^coaches\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe('path predicates', () => {
  it('isMediaPath mirrors the conventions', () => {
    expect(isMediaPath(mediaPath('items', ITEM, 'webp'))).toBe(true);
    expect(isMediaPath(mediaPath('hero', null, 'webm'))).toBe(true);
    expect(isMediaPath(mediaPath('coaches', null, 'png'))).toBe(true);
    expect(isMediaPath('coaches/not-a-uuid/x.webp')).toBe(false);
    expect(isMediaPath(`coaches/${ITEM}/${ITEM}.mp4`)).toBe(false);
    expect(isMediaPath('items/not-a-uuid/x.webp')).toBe(false);
    expect(isMediaPath('../etc/passwd')).toBe(false);
  });

  it('isVideoPath keys on the extension', () => {
    expect(isVideoPath('hero/a.mp4')).toBe(true);
    expect(isVideoPath('hero/a.webp')).toBe(false);
    expect(isVideoPath(null)).toBe(false);
  });
});
