/**
 * Work photos (build-contracts-2026-09-23 §6.9, §6.10).
 *
 *   * the import boundary: photo.ts is the only file that names
 *     expo-image-picker or expo-image-manipulator, and it never value-imports
 *     either — they are required inside try/catch, the Court3D / expo-gl rule,
 *     so a binary built before them fails safe instead of crashing a route;
 *   * the pick flow: camera permission, cancel, re-encode to a capped JPEG;
 *   * the upload order: the slot first, then the bytes to exactly that path;
 *   * the native config: the picker plugin without the microphone, both
 *     languages' permission prompts, the privacy manifest and the blocked
 *     Android permissions.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImagePickerOptions } from 'expo-image-picker';
import {
  MAX_EDGE,
  PICK_OPTIONS,
  PhotoError,
  extFor,
  fitWithin,
  photosAvailable,
  pickPhoto,
  setPhotoNativeForTests,
  staffPhotoUrl,
  uploadStaffPhoto,
  type PhotoDeps,
  type PhotoNative,
} from '../photo';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '../../../..');
const PHOTO = readFileSync(join(here, '../photo.ts'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sources(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe('the picker import boundary', () => {
  it('no file but photo.ts names expo-image-picker or expo-image-manipulator', () => {
    const naming = [...sources(join(APP, 'src')), ...sources(join(APP, 'app'))]
      .filter((f) => !f.includes(`${sep}__tests__${sep}`))
      .filter((f) => /['"]expo-image-(picker|manipulator)['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(APP, f).split(sep).join('/'));
    expect(naming).toEqual(['src/features/staff/photo.ts']);
  });

  it('photo.ts imports their types only, and requires them inside try/catch', () => {
    for (const mod of ['expo-image-picker', 'expo-image-manipulator']) {
      const imports = [
        ...PHOTO.matchAll(new RegExp(`^import\\s+([^;]*?)\\s+from '${mod}';`, 'gm')),
      ];
      expect(imports.length, mod).toBeGreaterThan(0);
      for (const m of imports) expect(m[1], mod).toMatch(/^type\s/);
      expect(PHOTO).not.toMatch(new RegExp(`import\\('${mod}'\\)`));
    }
    const body = PHOTO.slice(PHOTO.indexOf('function loadNative('));
    expect(body).toMatch(
      /^[^]*?try\s*\{[^]*?require\('expo-image-picker'\)[^]*?require\('expo-image-manipulator'\)[^]*?\}\s*catch\s*\{\s*return null;/,
    );
  });

  it('loads nothing from react-native when the module loads', () => {
    expect(PHOTO).not.toMatch(
      /^import\s+(?!type\s)[^;]*from '(react-native|expo[^']*|\.\.\/\.\.\/lib\/supabase)';/m,
    );
  });
});

// ── pick ───────────────────────────────────────────────────────────────────────

function fakeNative(over: Partial<PhotoNative['picker']> = {}) {
  const asset = {
    uri: 'file:///cache/raw.heic',
    width: 4032,
    height: 3024,
    assetId: null,
    type: 'image' as const,
  };
  const picker = {
    requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
    launchCameraAsync: vi.fn(async (_o: ImagePickerOptions) => ({
      canceled: false as const,
      assets: [asset],
    })),
    launchImageLibraryAsync: vi.fn(async (_o: ImagePickerOptions) => ({
      canceled: false as const,
      assets: [asset],
    })),
    ...over,
  };
  const reencode = vi.fn(
    async (_uri: string, resize: { width: number } | { height: number } | null) => ({
      uri: 'file:///cache/out.jpg',
      width: resize && 'width' in resize ? resize.width : 1536,
      height: 1536,
    }),
  );
  const n = { picker, reencode } as unknown as PhotoNative;
  return { n, picker, reencode };
}

describe('pickPhoto', () => {
  afterEach(() => setPhotoNativeForTests(undefined));

  it('uses the §6.9 options', () => {
    expect(PICK_OPTIONS).toEqual({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.7,
      exif: false,
      base64: false,
    });
  });

  it('asks for the camera, then re-encodes to a JPEG inside MAX_EDGE', async () => {
    const { n, picker, reencode } = fakeNative();
    setPhotoNativeForTests(n);
    const photo = await pickPhoto('camera');
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalledOnce();
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(PICK_OPTIONS);
    expect(reencode).toHaveBeenCalledWith('file:///cache/raw.heic', { width: MAX_EDGE }, 0.7);
    expect(photo).toEqual({
      uri: 'file:///cache/out.jpg',
      width: MAX_EDGE,
      height: 1536,
      mime: 'image/jpeg',
    });
  });

  it('opens the library without a permission prompt', async () => {
    const { n, picker } = fakeNative();
    setPhotoNativeForTests(n);
    expect(await pickPhoto('library')).not.toBeNull();
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(PICK_OPTIONS);
  });

  it('re-encodes a small photo without resizing it, so its metadata still goes', async () => {
    const small = {
      uri: 'file:///cache/s.png',
      width: 800,
      height: 600,
      assetId: null,
      type: 'image' as const,
    };
    const { n, reencode } = fakeNative({
      launchImageLibraryAsync: vi.fn(async () => ({ canceled: false as const, assets: [small] })),
    });
    setPhotoNativeForTests(n);
    expect((await pickPhoto('library'))?.mime).toBe('image/jpeg');
    expect(reencode).toHaveBeenCalledWith('file:///cache/s.png', null, 0.7);
  });

  it('resolves null when the person cancels', async () => {
    const { n, reencode } = fakeNative({
      launchCameraAsync: vi.fn(async () => ({ canceled: true as const, assets: null })),
    });
    setPhotoNativeForTests(n);
    expect(await pickPhoto('camera')).toBeNull();
    expect(reencode).not.toHaveBeenCalled();
  });

  it('throws permission when the camera is switched off, and opens nothing', async () => {
    const { n, picker } = fakeNative({
      requestCameraPermissionsAsync: vi.fn(async () => ({ granted: false })),
    });
    setPhotoNativeForTests(n);
    await expect(pickPhoto('camera')).rejects.toMatchObject({ code: 'permission' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('throws unavailable on a binary without the picker', async () => {
    setPhotoNativeForTests(null);
    expect(photosAvailable()).toBe(false);
    const err = await pickPhoto('library').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoError);
    expect((err as PhotoError).code).toBe('unavailable');
  });

  it('fits the long edge, either way round', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE });
    expect(fitWithin(3024, 4032)).toEqual({ height: MAX_EDGE });
    expect(fitWithin(2048, 2048)).toBeNull();
    expect(fitWithin(0, 0)).toBeNull();
  });

  it('names the slot extension from the mime type', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png')).toBe('png');
    expect(extFor('image/webp')).toBe('webp');
  });
});

// ── upload ─────────────────────────────────────────────────────────────────────

describe('uploadStaffPhoto', () => {
  const VENUE = 'c0000000-0000-4000-8000-000000000001';
  const PATH = `${VENUE}/receipts/11111111-2222-4333-8444-555555555555.jpg`;
  const photo = { uri: 'file:///cache/out.jpg', width: 10, height: 10, mime: 'image/jpeg' };
  let calls: string[];
  let rpc: ReturnType<typeof vi.fn>;
  let upload: ReturnType<typeof vi.fn>;
  let deps: PhotoDeps;

  beforeEach(() => {
    calls = [];
    rpc = vi.fn(async () => {
      calls.push('slot');
      return { data: { path: PATH, bucket: 'staff-media', expires_at: 'x' }, error: null };
    });
    upload = vi.fn(async () => {
      calls.push('upload');
      return { data: { path: PATH }, error: null };
    });
    const bytes = new ArrayBuffer(4);
    deps = {
      client: {
        schema: () => ({ rpc }),
        storage: { from: (bucket: string) => ({ upload, bucket }) },
      } as unknown as PhotoDeps['client'],
      fetch: vi.fn(async () => {
        calls.push('read');
        return { arrayBuffer: async () => bytes };
      }),
    };
  });

  it('mints the slot, then uploads the bytes to exactly that path', async () => {
    expect(await uploadStaffPhoto(VENUE, 'receipts', photo, deps)).toBe(PATH);
    expect(rpc).toHaveBeenCalledWith('staff_media_slot', {
      p_venue_id: VENUE,
      p_folder: 'receipts',
      p_ext: 'jpg',
    });
    expect(upload).toHaveBeenCalledWith(PATH, expect.any(ArrayBuffer), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(calls).toEqual(['slot', 'read', 'upload']);
  });

  it('uploads nothing when the slot is refused', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'UPLOAD_LIMIT' } });
    await expect(uploadStaffPhoto(VENUE, 'steps', photo, deps)).rejects.toMatchObject({
      message: 'UPLOAD_LIMIT',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('throws the storage refusal instead of returning a path', async () => {
    upload.mockResolvedValueOnce({
      data: null,
      error: { message: 'new row violates row-level security policy' },
    });
    await expect(uploadStaffPhoto(VENUE, 'steps', photo, deps)).rejects.toMatchObject({
      message: expect.stringContaining('row-level security'),
    });
  });

  it('reads a stored photo through a 10-minute signed URL', async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://x/signed' },
      error: null,
    }));
    const client = {
      storage: { from: () => ({ createSignedUrl }) },
    } as unknown as PhotoDeps['client'];
    expect(await staffPhotoUrl(PATH, client)).toBe('https://x/signed');
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 600);
  });
});

// ── native config ──────────────────────────────────────────────────────────────

describe('the native config (§6.10)', () => {
  it('declares the picker without the microphone, the prompts in both languages, and the privacy types', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { default: appConfig } = await import('../../../../app.config');
    warn.mockRestore();
    const config = appConfig({ config: {} } as never);

    const plugin = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as
      [string, Record<string, unknown>] | undefined;
    expect(plugin?.[1]).toEqual({
      photosPermission: 'Touch Padel uses your photos only when you attach a work photo.',
      cameraPermission: 'Touch Padel uses the camera only when you take a work photo.',
      microphonePermission: false,
    });

    expect(config.locales).toEqual({ en: './locales/ios.en.json', ar: './locales/ios.ar.json' });
    for (const lang of ['en', 'ar'] as const) {
      const file = JSON.parse(readFileSync(join(APP, `locales/ios.${lang}.json`), 'utf8')) as {
        ios: Record<string, string>;
      };
      expect(Object.keys(file)).toEqual(['ios']);
      expect(Object.keys(file.ios).sort()).toEqual([
        'NSCameraUsageDescription',
        'NSPhotoLibraryUsageDescription',
      ]);
      if (lang === 'ar')
        for (const v of Object.values(file.ios)) expect(v).toMatch(/[\u0600-\u06FF]/);
      else {
        expect(file.ios.NSCameraUsageDescription).toBe(plugin?.[1].cameraPermission);
        expect(file.ios.NSPhotoLibraryUsageDescription).toBe(plugin?.[1].photosPermission);
      }
    }

    const collected = (config.ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? []) as Record<
      string,
      unknown
    >[];
    for (const type of [
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypeOtherUserContent',
    ]) {
      expect(collected.find((c) => c.NSPrivacyCollectedDataType === type)).toEqual({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      });
    }

    expect(config.android?.blockedPermissions).toEqual([
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
    ]);
    expect(config.version).toBe('1.0.0');
  });
});
