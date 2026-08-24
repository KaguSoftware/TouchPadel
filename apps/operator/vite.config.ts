import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // base './': the built SPA is loaded from file:// inside the Electron shell —
  // locally-bundled renderer, zero-network boot (design-arch.md §2).
  base: './',
  server: {
    port: 5174,
    strictPort: true,
  },
});
