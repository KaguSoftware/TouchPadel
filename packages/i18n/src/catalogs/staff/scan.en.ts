/**
 * `staff.scan.*` — the staff phone's two camera pages (Phase 2 Milestone 4b): a waiter's
 * handwritten order slip (app/staff-order-slip.tsx, to the till) and a supplier's receipt
 * (app/staff-receipt.tsx, to Goods in), with each page's own log. The statuses the pages show
 * are the operator's words (`ws.slips.status.*`, `ws.receipts.status.*`), so the phone and
 * the till say the same thing. Mirror every key in scan.ar.ts.
 */
export const staffScanEn = {
  take: 'Take photo',
  library: 'Choose a saved photo',
  retake: 'Retake photo',
  slips: {
    title: 'Slips',
    add: 'Scan an order',
  },
  rows: {
    slip: 'Scan an order',
    receipt: 'Scan a receipt',
  },
  slip: {
    tileTitle: 'Photograph the paper slip',
    tileHint: 'The till reads it and sends it to the kitchen',
    title: 'Scan an order',
    send: 'Send to the café cashier',
    sent: 'Sent. The café cashier has it.',
    mine: 'My slips today',
    empty: 'Nothing sent today.',
    table: 'Table {number}',
    noTable: 'No table',
    items: 'Items: {count}',
    setAside: 'Set aside: {reason}',
  },
  receipt: {
    tileTitle: 'Photograph the receipt',
    tileHint: 'A manager checks it in Goods in',
    title: 'Scan a receipt',
    send: 'Send to Goods in',
    sent: 'Sent. A manager will check it in Goods in.',
    mine: 'My receipts',
    empty: 'No receipts sent in the last 30 days.',
    supplier: 'Supplier not read',
    setAside: 'Set aside: {reason}',
  },
} as const;
