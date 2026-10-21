// pdf.js's worker module, imported onto the main thread by extract.ts (the
// shell loads the app from file://, where a module Worker is not an option).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
