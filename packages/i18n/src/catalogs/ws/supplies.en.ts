/**
 * `ws.supplies.*` — Goods in from the driver, Made today, the day-close checklists section, From
 * marketing, the Setup checks and the Daily checklists card; for the role spec, the checklists'
 * "Needs a photo", Goods in's delivered state and /marketing's "Requests to marketing".
 * Owned by lane I (docs/design/protocols/build-contracts-2026-09-23.md §4).
 * Mirror every key in supplies.ar.ts.
 */
export const suppliesEn = {
  /** A shopping-list unit the stock units (op.stock.unit) do not have. */
  unit: {
    pack: 'packs',
  },
  // Stock ▸ Goods in: the purchases the driver recorded (app.purchases_to_receive).
  driver: {
    title: 'Bought by the driver',
    badge: '{count} to receive',
    lead: 'The driver recorded these at the shop. Open one to check what arrived and put it into stock.',
    items: 'Items: {count}',
    noShop: 'Shop not given',
    receive: 'Receive',
    // The driver's Delivered on the phone (app.confirm_purchase_delivery). {time} is the time
    // alone on the day of the purchase, else the date and time.
    delivered: 'Delivered {time} by {name}',
    deliveredNoName: 'Delivered {time}',
    notDelivered: 'Delivery not confirmed yet',
  },
  // Goods in opened on one purchase (?purchase=<id>): app.receive_purchase and
  // app.acknowledge_purchase_line.
  purchase: {
    title: 'Receive what the driver bought',
    back: 'Back to Goods in',
    gone: 'This purchase is not waiting to be received',
    goneBody: 'Someone may have received it already. Purchases still to receive are listed on Goods in.',
    boughtBy: 'Bought by',
    where: 'Where',
    when: 'When',
    paid: 'Paid',
    delivery: 'Delivery',
    receipt: 'See the receipt',
    receiptTitle: 'Receipt',
    noReceipt: 'No receipt photo',
    stockTitle: 'Into stock',
    stockLead: 'Each line starts at what the driver bought. Change it if less arrived. The cost per unit is what was paid for the line, divided by the amount bought.',
    bought: 'Bought {qty}',
    costEach: 'Paid {amount}, {cost} per {unit}',
    received: 'Received ({unit})',
    receivedInvalid: 'Enter a number, 0 or more.',
    short: 'Short by {qty}',
    over: 'More than was bought',
    supplierBlank: 'Blank: filed under the shop, {shop}.',
    receiveBtn: 'Receive into stock',
    receiveDisabled: {
      switchedOff: 'Mark the switched-off lines checked first.',
      invalid: 'Fix the amounts marked in red first.',
    },
    receivedToast: 'Received. Stock is updated.',
    ingredientSwitchedOff: 'An ingredient on this purchase was switched off. Mark that line checked, then receive the rest.',
    notStockTitle: 'Not for stock',
    notStockLead: 'Things the venue does not keep in stock, like cleaning supplies. Mark each one checked once you have seen it.',
    switchedOff: 'This ingredient was switched off after it was bought, so it cannot go into stock. Mark it checked, or switch the ingredient back on in Ingredients.',
    acknowledge: 'Mark checked',
    acknowledgedToast: 'Marked checked.',
    confirmSwitchedOffTitle: 'Mark {name} checked?',
    confirmSwitchedOffBody: 'It will not go into stock, and this cannot be undone.',
    doneTitle: 'Already done',
  },
  // Stock ▸ Waste and production: app.production_log_today.
  madeToday: {
    title: 'Made today',
    lead: 'Batches recorded today, here or on the kitchen’s phones.',
    empty: 'Nothing made yet today.',
    time: 'Time',
    item: 'Item',
    amount: 'Made',
    who: 'Who',
  },
  // Day close: app.checklist_day_state. A warning, never a block.
  dayClose: {
    title: 'Checklists not finished',
    badge: '{count} open',
    lead: 'Nobody ticked these lines on the day you are closing. You can still close it.',
    list: '{role} · {slot}',
    progress: '{done} of {total} done',
    more: '+{count} more',
  },
  // The Daily checklists card on /protocols, its sheet and the owner's editor.
  checklists: {
    title: 'Daily checklists',
    summary: '{done} of {total} lists finished today',
    allDone: 'Every list is finished today.',
    noneTitle: 'No lists to tick today',
    noneOwner: 'Write an opening and a closing list for each role. Staff tick them on their phones.',
    noneManager: 'The owner writes an opening and a closing list for each role. Staff tick them on their phones.',
    row: '{role} · {slot}',
    progress: '{done} of {total}',
    finished: 'Finished',
    moreLists: '+{count} more',
    open: 'See today',
    edit: 'Edit the lists',
    write: 'Write a list',
    tabToday: 'Today',
    tabEdit: 'Edit the lists',
    todayLead: 'One shared list per role. Each tick shows who made it and when. Lists are ticked on the phone.',
    notOpened: 'Nobody has opened this list today.',
    ticked: '{name} · {time}',
    noTemplates: 'No lists yet.',
    // A line that needs a photo (checklist_photos). {line} is the line's text.
    photoNeeded: 'Needs a photo',
    seePhoto: 'See the photo: {line}',
    hidePhoto: 'Hide the photo: {line}',
    photoAlt: 'Photo for: {line}',
    editor: {
      pick: 'Choose a list',
      noList: 'No list',
      lineCount: 'Lines: {count}',
      heading: '{role} · {slot}',
      nameEn: 'Name (English)',
      nameAr: 'Name (Arabic)',
      defaultName: '{role}: {slot}',
      lines: 'Lines',
      count: '{count} of {max}',
      lineEn: 'Line {n}, English',
      lineAr: 'Line {n}, Arabic',
      addLine: 'Add a line',
      removeLine: 'Remove line {n}',
      photo: 'Needs a photo',
      photoCount: 'Needs a photo: {count}',
      photoLead: 'Switch on “Needs a photo” for a line that has to be shown done, like a cleaned counter. Staff can tick it only by taking a photo on the phone, and the photo shows here under Today.',
      full: 'A list holds at most {max} lines.',
      emptyList: 'No lines yet. A list with no lines is not shown to anyone.',
      both: 'Write it in both English and Arabic.',
      tooLong: 'At most {max} characters.',
      keepsToday: 'A list someone already opened today keeps its lines. Your change shows from the next one.',
      save: 'Save the list',
      saved: 'List saved.',
      discard: 'Discard changes',
      reload: 'Load the latest',
      invalid: 'Fix the boxes marked in red first.',
    },
  },
  // /marketing: the drafts marketing suggested (app.marketing_suggestions).
  fromMarketing: {
    filter: 'From marketing',
    waiting: 'New from marketing: {count}',
    from: 'From {name}',
    fromUnknown: 'From marketing',
    note: 'Note: {note}',
    photos: 'Photos ({count})',
    photosTitle: 'Photos from marketing',
  },
  // /marketing: what staff asked marketing for (app.marketing_requests_page). Read-only.
  requests: {
    title: 'Requests to marketing',
    lead: 'Staff ask marketing for something from their phones, like a post about a new item, and marketing answers there. This list is for reading only.',
    waitingBadge: '{count} waiting',
    filterLabel: 'Which requests',
    filter: {
      open: 'Waiting',
      answered: 'Answered',
      all: 'All',
    },
    empty: {
      open: 'Nothing is waiting for marketing.',
      answered: 'Marketing has not answered a request yet.',
      all: 'Nobody has asked marketing for anything yet.',
    },
    about: 'About {item}',
    wantBy: 'Wanted by {date}',
    wantByLate: 'Wanted by {date}, now past',
    photos: 'Photos ({count})',
    photosTitle: 'Photos: {title}',
    answeredBy: 'Answer from {name} · {time}',
    more: 'Showing {shown} of {total}.',
  },
  // A work photo opened from a signed URL (Goods in's receipt, marketing's photos, a
  // request's photos, a checklist line's photo).
  photo: {
    loading: 'Opening the photo…',
    error: 'This photo could not be opened.',
    alt: 'Photo {n}',
  },
  // Setup ▸ Worth checking.
  setup: {
    noPar: 'Prepared items with no par level',
    noParHint: 'The kitchen’s “What to make today” list never asks for these until each has a par level.',
    noParAction: 'Open Ingredients',
  },
} as const;
