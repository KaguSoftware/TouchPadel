import { describe, it, expect } from 'vitest';
import { mayNavigateTo, mayOpenExternally, shouldRecoverToRenderer, type NavigationPolicy } from './window-security';

// The window had no will-navigate handler at all, so nothing stopped the
// renderer moving the top-level frame to remote content with the preload — and
// therefore window.touch: the durable write queue, the PIN unlock, the printer
// — still attached. And setWindowOpenHandler passed any string straight to
// shell.openExternal, which hands it to the OS protocol handler.

const prod: NavigationPolicy = { isDev: false };
const dev: NavigationPolicy = { isDev: true, devServerUrl: 'http://localhost:5174' };

describe('mayNavigateTo', () => {
  it('allows the packaged renderer on file:', () => {
    expect(mayNavigateTo('file:///C:/app/resources/renderer/index.html', prod)).toBe(true);
  });

  it('allows the dev server origin in development', () => {
    expect(mayNavigateTo('http://localhost:5174/till', dev)).toBe(true);
  });

  it('refuses the dev server origin in a packaged build', () => {
    expect(mayNavigateTo('http://localhost:5174/till', prod)).toBe(false);
  });

  it('refuses a different port on the same host', () => {
    // Origin comparison, not a host prefix: another local server is not us.
    expect(mayNavigateTo('http://localhost:3000/', dev)).toBe(false);
  });

  it.each([
    'https://evil.example/phish',
    'http://evil.example/',
    'data:text/html,<script>1</script>',
    'javascript:alert(1)',
    'about:blank',
  ])('refuses %s', (url) => {
    expect(mayNavigateTo(url, dev)).toBe(false);
    expect(mayNavigateTo(url, prod)).toBe(false);
  });

  it('refuses a string that is not a URL at all', () => {
    expect(mayNavigateTo('not a url', prod)).toBe(false);
    expect(mayNavigateTo('', prod)).toBe(false);
  });
});

describe('mayOpenExternally', () => {
  it('allows https in a shipped build', () => {
    expect(mayOpenExternally('https://core.telegram.org/bots', prod)).toBe(true);
  });

  it('refuses plain http in a shipped build', () => {
    expect(mayOpenExternally('http://example.com', prod)).toBe(false);
  });

  it('allows plain http in development', () => {
    // Supabase Studio and local docs.
    expect(mayOpenExternally('http://127.0.0.1:54323', dev)).toBe(true);
  });

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'smb://attacker/share',
    'ms-msdt:/id',
    'javascript:alert(1)',
    'vscode://file/etc/passwd',
  ])('refuses the OS-handler scheme in %s', (url) => {
    // shell.openExternal hands these to Windows, which will happily act on them.
    expect(mayOpenExternally(url, prod)).toBe(false);
    expect(mayOpenExternally(url, dev)).toBe(false);
  });

  it('refuses junk', () => {
    expect(mayOpenExternally('', prod)).toBe(false);
    expect(mayOpenExternally('https:// broken', prod)).toBe(false);
  });
});

describe('shouldRecoverToRenderer', () => {
  const renderer = 'file:///C:/Program%20Files/Touch%20Padel/resources/renderer/index.html';
  const failed = (url: string, errorCode = -6, isMainFrame = true) => ({ url, errorCode, isMainFrame });

  it('recovers a reload of a stale history path (the Windows white screen)', () => {
    expect(shouldRecoverToRenderer(failed('file:///C:/till'), renderer)).toBe(true);
  });

  it('recovers the macOS spelling of the same path', () => {
    expect(
      shouldRecoverToRenderer(failed('file:///till'), 'file:///Applications/Touch.app/Contents/Resources/renderer/index.html'),
    ).toBe(true);
  });

  it('does not reload index.html into itself when the renderer is missing', () => {
    expect(shouldRecoverToRenderer(failed(renderer), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed(`${renderer}#/till`), renderer)).toBe(false);
  });

  it('ignores superseded loads, subframes and non-file URLs', () => {
    expect(shouldRecoverToRenderer(failed('file:///C:/till', -3), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed('file:///C:/till', -6, false), renderer)).toBe(false);
    expect(shouldRecoverToRenderer(failed('http://localhost:5174/till', -102), renderer)).toBe(false);
  });
});
