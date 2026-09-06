import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A `<link rel="preload" as="font">` only warms the face that follows it when
 * the preload's request mode matches the font's own, and the two disagree
 * across the surfaces this SPA is opened on. Over http a font is fetched in
 * CORS mode, so the preload needs `crossorigin` or the dev server hands the
 * same file over twice. The packaged build is opened with `loadFile`, and a
 * `file://` font fetch is not CORS mode: there the attribute is the thing that
 * breaks the match, and the kiosk fetches both boot faces a second time while
 * the frame the preload exists to protect waits on the download it was
 * supposed to have warmed. Nothing in the markup is right for both, and only
 * build output is ever loaded from `file://` — index.html keeps the attribute
 * for `vite dev` and this drops it on the way out.
 */
function fontPreloadWithoutCors(): Plugin {
  return {
    name: 'touch:font-preload-without-cors',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(/(<link\s+rel="preload"[^>]*\bas="font"[^>]*?)\s+crossorigin/g, '$1'),
  };
}

export default defineConfig({
  plugins: [react(), fontPreloadWithoutCors()],
  // base './': the built SPA is loaded from file:// inside the Electron shell —
  // locally-bundled renderer, zero-network boot (design-arch.md §2).
  base: './',
  server: {
    port: 5174,
    strictPort: true,
  },
});
