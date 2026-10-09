/**
 * `ws.guide.*`: the workspace guides (apps/operator features/guide), one per
 * worker workspace: the court desk, the till, the kitchen board and Touch
 * Shop. Mirror every key in guide.ar.ts.
 *
 * Shape: `chrome.*` is the dialog itself; `<workspace>.<section>.title` names
 * a tab; `<workspace>.<section>.<step>.{title, body}` is one step, and the step
 * id in guideContent.ts is `<workspace>.<section>.<step>`.
 *
 * A {placeholder} in a body is filled with the REAL label of the button it
 * names (guideContent.ts `params`), so a renamed button renames the guide too.
 * Key names (F2, 1–9) are never written in a sentence: they show as chips.
 * Single-line literals only (the assistant map indexes them).
 */
export const guideEn = {
  chrome: {
    open: 'Guide',
    title: '{workspace} guide',
    progress: '{done} of {total} learned',
    tabCount: '{done}/{total}',
    learned: 'I know this',
    goThere: 'Go there',
    startOver: 'Start over',
    close: 'Close',
    keys: 'Keys',
    badge: {
      managerPin: 'Manager’s PIN',
      ownPin: 'Your PIN',
      managerJob: 'Manager only',
      online: 'Needs a connection',
    },
  },

  courtDesk: {
    start: {
      title: 'Start of shift',
      shift: {
        title: 'Start your shift',
        body: 'Press {startShift} on Today or on the rail. The day’s first shift counts the cash in the desk’s box; a later one confirms what was handed over, or you type what you counted. If the day is not open yet, a manager opens it on Day close.',
      },
      board: {
        title: 'Read the Today board',
        body: '{arrivals} is at the top, then {courtsNow}, then {allBookings}. When open matches are on, the matches still looking for players come before the full list.',
      },
    },
    bookings: {
      title: 'Bookings',
      newBooking: {
        title: 'Book a court',
        body: 'Press {newBooking}. Find the guest by name or phone, or just type a name. Pick the court, the start and the length: the price shows before you save, and times already taken are marked.',
      },
      walkIn: {
        title: 'Walk-ins',
        body: 'Under {courtsNow}, a free court books it on the spot and a busy one opens its booking.',
      },
      calendar: {
        title: 'The calendar',
        body: 'Click a free slot to book it. The arrow keys move to the next or previous day (a month in the month view); D shows one day and M the whole month.',
      },
      change: {
        title: 'Move, shorten or extend',
        body: 'Drag a booking by its grip on the calendar, or open it and press {move}, {shorten} or {extend}. Each change asks for a reason.',
      },
      cancel: {
        title: 'Cancel a booking',
        body: 'Open the booking, press {cancel} and choose a reason. A booking that is completed, cancelled or a no-show can no longer change.',
      },
      series: {
        title: 'Weekly regulars',
        body: 'Press {newSeries} on the calendar. Every date is checked before anything is booked: skip or move the dates that clash, then book the series.',
      },
      block: {
        title: 'Block a court',
        body: 'For maintenance, press {blockCourt} on the calendar. A block stays within one day, and it is refused if a booking overlaps it.',
      },
      offline: {
        title: 'Booking without a connection',
        body: 'A booking made offline is saved on this station only. Do not promise the slot until it has synced.',
      },
    },
    arrivals: {
      title: 'Arrivals',
      arrived: {
        title: 'Mark arrived',
        body: 'Press {markArrived} when the players come in: one press, no reason. A booking that has started with nobody marked stays near the top, under {late}.',
      },
      noShow: {
        title: 'No-show and completed',
        body: 'Once the slot has started, open the booking and press {noShow} or {completed}.',
      },
    },
    money: {
      title: 'Taking payment',
      fee: {
        title: 'Take the court fee',
        body: 'On the booking, press {cash} or {card}. For cash, type the amount handed over and the change to give shows.',
      },
      cafe: {
        title: 'Add their café bill',
        body: '{addCafeBill} moves a table’s open bill onto the booking, so they pay for the court and the café together.',
      },
      unpaid: {
        title: 'Played, not paid',
        body: 'Games that ended with the court fee still open are listed under {toSettle} on Today. Open each one and take the payment.',
      },
      closeBill: {
        title: 'Nothing owed',
        body: 'When nothing is owed on a booking’s open bill, press {closeBill} so the day can close.',
      },
      deposit: {
        title: 'App deposits',
        body: 'A deposit paid in the app shows as {paidOnline}. Take only the rest.',
      },
      overpaid: {
        title: 'Overpaid',
        body: 'If a booking was paid more than it owes, a manager refunds the difference at the till, and then the bill can close.',
      },
    },
    customers: {
      title: 'Customers',
      find: {
        title: 'Find a customer',
        body: 'Search by phone, name or email. The record shows their bookings, their flags and the staff notes.',
      },
      create: {
        title: 'Create a customer',
        body: 'A new customer is a real guest account, which the customer can claim later in the app.',
      },
      flags: {
        title: 'Flags and staff notes',
        body: 'Flags show on the guest’s bookings and tabs. Staff notes are for staff only: the guest never sees them.',
      },
    },
    matches: {
      title: 'Open matches',
      start: {
        title: 'Start an open match',
        body: 'Choose {openMatch} in the new booking, or press {startMatch} on Today. Then press {copyLink} and share the invite.',
      },
      players: {
        title: 'Players',
        body: 'Under {players}, add players, mark each one arrived or no-show, and take each share.',
      },
      writeOff: {
        title: 'Write off a share',
        body: '{writeOff} clears a player’s share without payment. A manager’s PIN authorises it.',
      },
      callOff: {
        title: 'Call off or cancel',
        body: 'Call off a match that is short of players: nobody pays, and every player must be marked first. Cancel a match while it is still filling.',
      },
    },
    more: {
      title: 'Tasks and breaks',
      tasks: {
        title: 'My tasks',
        body: 'Your steps in tournaments, new items and price changes are on My tasks.',
      },
      incident: {
        title: 'Report an incident',
        body: 'Report an incident, an injury, a fight or damage, with photos. A manager reviews every report.',
      },
      break: {
        title: 'Take a break',
        body: 'Press {goOnBreak} and enter your PIN. A colleague can cover the station with their own PIN, and your PIN ends the break.',
      },
    },
    end: {
      title: 'End of shift',
      shift: {
        title: 'End your shift',
        body: 'Press {endShift} and count the box without seeing the amount expected. The difference shows only after you sign with your PIN.',
      },
      signOut: {
        title: 'Sign out',
        body: 'If your shift is still open, signing out offers to end it first. Signing out anyway leaves it open until a manager closes it.',
      },
    },
  },

  cashier: {
    start: {
      title: 'Start of shift',
      day: {
        title: 'Is the day open?',
        body: 'If no business day is open, the till says so and takes no orders. A manager opens the day on Day close.',
      },
      shift: {
        title: 'Start your shift',
        body: 'At the top of the till, check the amount it asks about. If it is in the drawer, press {confirm}; if not, press {different} and type what you counted.',
      },
      others: {
        title: 'Someone else’s shift is still open',
        body: 'Count their drawer and close their shift with a manager’s PIN, then start yours.',
      },
      sound: {
        title: 'Sound',
        body: 'If the {turnOnSound} strip shows, press it so waiter calls and scanned orders chime. Starting your shift turns sound on by itself.',
      },
    },
    orders: {
      title: 'Taking an order',
      floor: {
        title: 'The floor plan',
        body: 'Green tables have an open tab. Tap a green table to add to its tab, or a free table to open a tab there.',
      },
      courts: {
        title: 'Courts',
        body: 'Switch to {courts} to open a tab on a court booking.',
      },
      newTab: {
        title: 'New tab',
        body: 'Press {newTab} to open a tab for a table, a name or a booking.',
      },
      items: {
        title: 'Add items',
        body: 'Pick a category or search the menu. An item with one size and no extras goes straight into the basket; anything else opens a sheet to choose from.',
      },
      notes: {
        title: 'Notes for the kitchen',
        body: 'The note button on a basket line offers ready-made notes, or type one the way the kitchen should read it.',
      },
      send: {
        title: 'Send to the kitchen',
        body: 'Press {send}. Lines you have not sent are lost if you switch to another tab, so the till asks first.',
      },
      calls: {
        title: 'Waiter calls',
        body: 'Press {ack} when you go to the table, then {done} once it is handled.',
      },
      slips: {
        title: 'Scanned orders',
        body: 'Check the order against the photo, then press {send} or {setAside}.',
      },
    },
    pay: {
      title: 'Payment',
      cash: {
        title: 'Cash',
        body: 'Press {cash}, type the amount handed over and give the change shown.',
      },
      card: {
        title: 'Card',
        body: 'Press {card}, take the payment on the card machine, then record the amount it approved.',
      },
      split: {
        title: 'Part payments and splits',
        body: 'Turn on {partial} to take part of the bill, or press {split} to share it evenly or by item.',
      },
      promo: {
        title: 'Promotions',
        body: 'Press {applyPromo}. A tab takes one promotion.',
      },
      charge: {
        title: 'Charge to a booking',
        body: '{chargeBooking} moves the café tab onto a court booking, so the guest pays for the court and the café in one go.',
      },
      bill: {
        title: 'The bill',
        body: 'Press {bill} to show the bill on screen, and print it from there.',
      },
    },
    fix: {
      title: 'Corrections',
      discount: {
        title: 'Discount',
        body: 'Press {discount}, then a manager enters their PIN and you give a reason.',
      },
      price: {
        title: 'Change a price',
        body: 'Tap the line, press {override}, then a manager enters their PIN and you give a reason.',
      },
      void: {
        title: 'Void a sent line',
        body: 'Press {void} on the line. It is recorded as waste, never deleted. If the tab already has payments, a manager refunds them first.',
      },
      refund: {
        title: 'Refunds',
        body: 'Only a manager signed in on the till can refund a payment.',
      },
      merge: {
        title: 'Merge tabs',
        body: 'On {openTabs}, press {merge} and choose the tab that stays. A merge cannot be undone.',
      },
      remove: {
        title: 'Remove an empty tab',
        body: 'A tab with nothing on it can be removed from {openTabs}, with a reason.',
      },
      drawer: {
        title: 'Open the drawer by hand',
        body: 'On {cashDrawer}, press {openDrawer} and give the reason.',
      },
      offline: {
        title: 'Working offline',
        body: 'Orders, payments, voids and refunds made offline are saved on the till and sent when the connection returns. Merging tabs, opening the drawer and shifts need the connection.',
      },
    },
    more: {
      title: 'Tasks and breaks',
      tasks: {
        title: 'My tasks',
        body: 'Your steps in new items, tournaments and price changes are on My tasks.',
      },
      incident: {
        title: 'Report an incident',
        body: 'Report an incident, an injury, a fight or damage, with photos. A manager reviews every report.',
      },
      break: {
        title: 'Take a break',
        body: 'Press {goOnBreak} and enter your PIN. A colleague can cover the till with their own PIN, and your PIN ends the break.',
      },
    },
    end: {
      title: 'End of shift',
      openTabs: {
        title: 'Open tabs stop the day closing',
        body: 'The day cannot close while a tab is open. Before you leave, check {openTabs} and settle what is yours.',
      },
      shift: {
        title: 'End your shift',
        body: 'On {cashDrawer}, press {endShift} and count the drawer without seeing the amount expected. Sign with your PIN; the difference shows after that.',
      },
      signOut: {
        title: 'Sign out',
        body: 'If your shift is still open, signing out offers to end it first. Signing out anyway leaves it open until a manager closes it.',
      },
    },
  },

  prep: {
    start: {
      title: 'Start of shift',
      sound: {
        title: 'Turn on sound',
        body: 'If the amber {turnOnSound} strip shows across the top, press it. Without sound, new orders and late tickets do not chime.',
      },
      connection: {
        title: 'Check the connection',
        body: 'The pill in the header should read {live}. Anything else means new tickets may reach this screen late.',
      },
    },
    tickets: {
      title: 'Reading a ticket',
      source: {
        title: 'Where tickets come from',
        body: 'Orders sent from the till and by guests on the website arrive here, oldest first. Each card says which: {till} or {web}.',
      },
      card: {
        title: 'What a card shows',
        body: 'The table or court, the ticket’s age against its target, who sent it, and each item with its size, its extras and the notes.',
      },
      band: {
        title: 'The colour band',
        body: 'The band across the top of a card goes from {onTime} to {gettingLate} to {late}. Work the most urgent first.',
      },
    },
    work: {
      title: 'Working a ticket',
      start: {
        title: 'Start',
        body: 'Press {start} on a ticket when you begin it.',
      },
      tick: {
        title: 'Tick items',
        body: 'Tap an item to tick it ready, or use the key for the item under the cursor. The other kitchen screens see the ticks.',
      },
      ready: {
        title: 'Ready',
        body: 'Press {ready} when the whole ticket is done. A ticket nobody has started can go straight to {ready}.',
      },
      complete: {
        title: 'Complete',
        body: 'Press {complete} once it has gone out. It fades and leaves the board after {minutes} minutes.',
      },
    },
    alerts: {
      title: 'Late tickets',
      stale: {
        title: 'Not started in time',
        body: 'A ticket not started within {seconds} seconds is marked {stale}, gets a red ring and joins the count in the red banner. It chimes every {repeat} seconds until someone starts it.',
      },
      voided: {
        title: 'Voided lines',
        body: 'When the till voids a line, it disappears from its ticket.',
      },
    },
    keys: {
      title: 'Keys',
      tickets: {
        title: 'Move between tickets',
        body: 'Pick a ticket by its place on the board, or step to the next or previous one. In Arabic the arrows follow the reading direction.',
      },
      items: {
        title: 'Items, deselect and this guide',
        body: 'Move between a ticket’s items, tick the one under the cursor, deselect the ticket, or open this guide.',
      },
      layout: {
        title: 'Arabic keyboard',
        body: 'The keys work by their place on the keyboard, so they do the same with an Arabic layout.',
      },
    },
    problems: {
      title: 'Problems',
      offline: {
        title: 'No internet',
        body: 'Tickets keep arriving from the till over the local network. Ticking items comes back when the connection does.',
      },
      error: {
        title: 'Tickets could not be loaded',
        body: 'The board tries again by itself every {seconds} seconds. If it keeps failing, check this screen’s network connection.',
      },
    },
    tasks: {
      title: 'My tasks',
      open: {
        title: 'Your steps',
        body: '{myTasks} in the header opens your steps and ideas; {backToBoard} brings you back here.',
      },
    },
  },

  shop: {
    start: {
      title: 'Start of shift',
      shift: {
        title: 'Start your shift',
        body: 'The first payment asks you to start your shift at this PC: confirm the amount in the drawer, or type what you counted. If the day is not open yet, ask a manager to open it.',
      },
    },
    sell: {
      title: 'Selling',
      find: {
        title: 'Find a product',
        body: 'Scan the barcode, search by name, SKU or barcode, or tap a product. A product out of stock is greyed out.',
      },
      basket: {
        title: 'The sale',
        body: 'Change a quantity with the plus and minus buttons, remove a line, or press {clear} to start again.',
      },
      pay: {
        title: 'Cash or card',
        body: 'Press {cash} or {card}. Every sale is paid on the spot, and the receipt prints by itself.',
      },
      unfinished: {
        title: 'Unfinished sales',
        body: 'A sale rung up but not paid waits under {unfinished}. Press {resume} to take the payment.',
      },
      offline: {
        title: 'Selling offline',
        body: 'A sale made without a connection is saved on this PC and goes through when the connection is back.',
      },
    },
    stock: {
      title: 'Stock',
      onHand: {
        title: 'On hand and history',
        body: '{shopStock} lists what the shop holds; a row’s history shows every movement. Use the rail for goods in and counts.',
      },
      receive: {
        title: 'Goods in',
        body: 'Enter what arrived. The stock goes up as soon as you record it.',
      },
      counts: {
        title: 'Stock counts',
        body: 'Start a count and enter what you see: the recorded amount stays hidden. Then finish the count, or discard it.',
      },
    },
    products: {
      title: 'Products',
      products: {
        title: 'Sections, products and sizes',
        body: 'Add sections, then products with their SKU, barcode, price and supplier, and then their sizes.',
      },
      prices: {
        title: 'Prices and going on sale',
        body: 'Change a price in the product’s edit form. A new product goes on sale as soon as you save it.',
      },
      suppliers: {
        title: 'Suppliers',
        body: 'Keep the shop’s suppliers here, so each product can name the one it comes from.',
      },
      priceWatch: {
        title: 'Supplier price changes',
        body: 'Paste the supplier’s product page in a size’s {link}, one page per size. The shop desk PC reads it every hour and tells the owner and the shop staff on their phones when the price changes. The size then appears under {panel}: {apply} fills the new price in, and Save applies it.',
      },
    },
    end: {
      title: 'End of shift',
      drawer: {
        title: 'Open the drawer by hand',
        body: 'On {cashDrawer}, press {openDrawer} and give the reason.',
      },
      break: {
        title: 'Take a break',
        body: 'Press {goOnBreak} and enter your PIN. Your PIN ends the break.',
      },
      unpaid: {
        title: 'No unpaid sales',
        body: 'The day cannot close while a shop sale is unpaid. Take every payment under {unfinished} before you leave.',
      },
      shift: {
        title: 'End your shift',
        body: 'Press {endShift} and count the drawer without seeing the amount expected. Sign with your PIN; the difference shows after that.',
      },
      signOut: {
        title: 'Sign out',
        body: 'If your shift is still open, signing out offers to end it first. Signing out anyway leaves it open until a manager closes it.',
      },
    },
  },
} as const;
