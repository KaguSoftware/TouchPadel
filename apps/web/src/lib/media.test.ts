import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isVideoPath, publicMediaUrl } from './media';

const ENV = { ...process.env };

describe('publicMediaUrl', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321/';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('builds the public bucket URL without a double slash', () => {
    expect(publicMediaUrl('items/abc/1.jpg')).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/menu-media/items/abc/1.jpg',
    );
  });

  it('encodes Arabic filenames and spaces per segment (slashes preserved)', () => {
    expect(publicMediaUrl('hero/قهوة الصباح.jpg')).toBe(
      'http://127.0.0.1:54321/storage/v1/object/public/menu-media/hero/' +
        encodeURIComponent('قهوة الصباح.jpg'),
    );
    expect(publicMediaUrl('items/x/my photo.png')).toContain('/items/x/my%20photo.png');
  });

  it('returns null for empty paths or a missing env', () => {
    expect(publicMediaUrl(null)).toBeNull();
    expect(publicMediaUrl('')).toBeNull();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(publicMediaUrl('items/a.jpg')).toBeNull();
  });
});

describe('isVideoPath', () => {
  it('detects video extensions case-insensitively', () => {
    expect(isVideoPath('hero/loop.MP4')).toBe(true);
    expect(isVideoPath('hero/loop.webm')).toBe(true);
    expect(isVideoPath('hero/still.jpg')).toBe(false);
    expect(isVideoPath(null)).toBe(false);
  });
});
