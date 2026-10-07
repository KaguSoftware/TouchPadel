/**
 * `staff.assistant.*`: the owner's assistant on the phone (app/staff-assistant*.tsx, Today's
 * highlighted entry). The desktop's words (`ws.owner.assistant.*`) are reused in meaning, shortened
 * for a thumb: the model and the spend sit behind the chat's settings sheet; no pinning or
 * re-check on the phone yet. Mirror every key
 * in assistant.ar.ts.
 */
export const staffAssistantEn = {
  title: 'Assistant',
  /** Today's entry button: the one highlighted control on the page. */
  entry: {
    title: 'Ask the assistant',
    hint: 'Sales, bookings, stock, in plain words',
  },
  empty: {
    title: 'Ask about the business',
    body: 'It reads your live figures and says what it read. Choose what it may look at, then ask.',
    try: 'Try asking',
  },
  suggestions: {
    yesterday: 'How did we do yesterday?',
    stock: 'What is running low or about to expire?',
    courts: 'Which courts are empty this week?',
    staff: 'Who is on break right now?',
  },
  composer: {
    placeholder: 'Ask a question',
    send: 'Send',
    stop: 'Stop',
    stopped: 'Stopped. What was read is kept; the answer was cut short.',
    billed: 'Each question is billed to the venue’s AI allowance.',
  },
  model: {
    title: 'Model',
    default: 'Default',
    chatSaved: 'Model updated for this chat',
    next: 'Applies to the next answer.',
    defaultIs: 'Applies to the next answer. Default is {model}.',
  },
  /** The chat's settings sheet, opened from the header: what was spent, and the model. */
  settings: {
    open: 'Chat settings',
    title: 'Chat settings',
    done: 'Done',
    spend: 'Spending',
    month: 'This month',
    chat: 'This chat',
    cap: 'of {cap} monthly cap',
    loadFailed: 'Spending could not be loaded.',
  },
  scopes: {
    title: 'It may read',
    cafe: 'Cafe',
    courts: 'Courts',
    money: 'Money',
    stock: 'Stock',
    staff: 'Staff',
    customers: 'Customers',
    audit: 'Audit log',
    marketing: 'Marketing',
    engagement: 'Guest activity',
    settings: 'Settings',
    system: 'System',
    howto: 'Help',
    docs: 'Documents',
    tables: 'Any table',
    turnOn: 'Turn on {scope}',
    turnOnHint: 'The assistant said this is off for this chat. Turning it on asks your last question again.',
    saved: 'Updated',
  },
  message: {
    assistant: 'Assistant',
    reading: 'Reading the data…',
    unverifiedOne: '1 figure could not be checked against the data read this turn.',
    unverifiedMany: '{n} figures could not be checked against the data read this turn.',
    gateRetried: 'The first draft used figures that were not in the data; this is the restated answer.',
    sources: 'Sources read: {n}',
    sourcesOne: 'Read 1 source',
    failed: 'could not be read',
    job: 'This needs a longer job. Open the assistant on the desktop app to see the estimate and run it.',
    retry: 'Ask again',
  },
  errors: {
    AUTH_REQUIRED: 'Your session has ended. Sign in again to ask.',
    FORBIDDEN: 'Only the owner can use the assistant.',
    NOT_CONFIGURED: 'No AI key is configured for this venue, so nothing was asked or billed.',
    LLM_DAILY_QUOTA: 'Today’s question limit is reached. It resets with the business day.',
    LLM_MONTHLY_CAP: 'This month’s AI spending cap is reached. Raise it in Venue settings on the desktop app.',
    RATE_LIMITED: 'The AI vendor is busy. Wait a moment and ask again.',
    UPSTREAM: 'The AI vendor did not answer. What was read is kept; ask again.',
    TIMEOUT: 'The answer took longer than 50 seconds and was stopped. What was read is kept.',
    INVALID_REQUEST: 'The question could not be sent as written.',
    ASSISTANT_MODEL_NOT_PRICED: 'The chosen model has no rates in the pricing table, so nothing was asked or billed.',
    UNKNOWN: 'The assistant could not answer. Ask again.',
  },
  chats: {
    title: 'Chats',
    open: 'Chats',
    new: 'New chat',
    empty: 'No chats yet. Ask something to start one.',
    untitled: 'Untitled chat',
    reads: 'Reads: {scopes}',
    loadFailed: 'The chats could not be loaded.',
  },
  thread: {
    loadFailed: 'This chat could not be loaded.',
    notFound: 'This chat is not in your list.',
  },
} as const;
