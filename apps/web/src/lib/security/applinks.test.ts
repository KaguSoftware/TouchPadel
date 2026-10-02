import { describe, expect, it } from 'vitest';
import { GET as appleAssociation } from '../../../app/.well-known/apple-app-site-association/route';
import { APPLE_APP_ID, LINK_PATHS } from './applinks';

/**
 * The links the app may claim (SEC-18; open matches, guest.md §4.19; coaching, guest.md
 * §4.12). The auth links, the open-match invite and the coach link, each in its three
 * spellings, go to the app; the café table route `/t/*` never does, and nothing claims the
 * whole site.
 */
describe('app links', () => {
  it('claims the auth links, the open-match invite and the coach link, bare and under both locales', () => {
    for (const path of [
      '/auth/*',
      '/en/auth/*',
      '/ar/auth/*',
      '/m/*',
      '/en/m/*',
      '/ar/m/*',
      '/c/*',
      '/en/c/*',
      '/ar/c/*',
    ]) {
      expect(LINK_PATHS).toContain(path);
    }
    expect(LINK_PATHS).toHaveLength(9);
  });

  it('never claims the café table route or the whole site', () => {
    for (const path of LINK_PATHS) {
      expect(path).not.toMatch(/^(\/(en|ar))?\/t\//);
      expect(path).not.toBe('/*');
    }
    expect(LINK_PATHS).not.toContain('/t/*');
  });

  it('serves the same paths in the apple-app-site-association file', async () => {
    const res = appleAssociation();
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = (await res.json()) as {
      applinks: { apps: unknown[]; details: { appID: string; paths: string[] }[] };
    };
    expect(body.applinks.apps).toEqual([]);
    expect(body.applinks.details).toEqual([{ appID: APPLE_APP_ID, paths: LINK_PATHS }]);
    expect(body.applinks.details[0]?.paths).toEqual(
      expect.arrayContaining(['/c/*', '/en/c/*', '/ar/c/*']),
    );
    expect(APPLE_APP_ID).toMatch(/\.com\.kagu\.touchpadel$/);
  });
});
