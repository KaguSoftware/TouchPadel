/**
 * `staff.scan.*` — the staff phone's two camera pages (Phase 2 Milestone 4b): a waiter's
 * handwritten order slip (app/staff-order-slip.tsx, to the till) and a supplier's receipt
 * (app/staff-receipt.tsx, to Goods in), with each page's own log. The statuses the pages show
 * are the operator's words (`ws.slips.status.*`, `ws.receipts.status.*`), so the phone and
 * the till say the same thing. Mirror every key in scan.ar.ts.
 */
export const staffScanEn = {
  rows: {
    slip: 'Scan an order',
    receipt: 'Scan a receipt',
  },
  slip: {
    title: 'Scan an order',
    lead: 'Photograph the order slip, flat and in good light, with the table number on it. The till checks it and sends it to the kitchen.',
    photo: 'Order slip',
    send: 'Send to the till',
    sent: 'Sent. The till has it.',
    noPhoto: 'Take a photo of the slip first.',
    mine: 'My slips today',
    empty: 'Nothing sent today.',
    table: 'Table {number}',
    noTable: 'No table',
    items: 'Items: {count}',
    setAside: 'Set aside: {reason}',
  },
  receipt: {
    title: 'Scan a receipt',
    lead: 'Photograph a supplier’s receipt or invoice, flat and in good light. A manager checks it in Goods in and puts it into stock.',
    photo: 'Receipt photo',
    send: 'Send to Goods in',
    sent: 'Sent. A manager will check it in Goods in.',
    noPhoto: 'Take a photo of the receipt first.',
    mine: 'My receipts',
    empty: 'No receipts sent in the last 30 days.',
    supplier: 'Supplier not read',
    setAside: 'Set aside: {reason}',
  },
} as const;
