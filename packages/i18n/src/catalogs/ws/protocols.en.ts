/**
 * `ws.protocols.*` — the Protocols page, run and step sheets, step forms, decisions, How it works
 * and the /tasks forms.
 * Owned by lane D (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in protocols.ar.ts.
 */
export const protocolsEn = {
  title: 'Protocols',
  // D1's placeholder: the route exists so other screens can link to it before
  // the page itself lands (D2), which replaces this empty state.
  placeholder: {
    title: 'Protocols are not ready yet',
    body: 'New items, tournaments, hiring and price or promo changes will be started and decided here.',
  },
} as const;
