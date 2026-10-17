/**
 * `ws.assistantFree.*`: the free AI on the operator (owner call 2026-10-16). Every staff role
 * gets it in the assistant drawer; the owner picks it as "The free AI" in the chat's model
 * switch. It finds pages and explains how things work; it reads no business data and stores
 * nothing. Owned by the assistant lane; mirror every key in assistantFree.ar.ts.
 */
export const assistantFreeEn = {
  /** The model switch's extra button, and the badge on the free thread. */
  name: 'The free AI',
  badge: 'Free',
  hint: "finds pages, explains how things work, can't see your data",
  lead: "Free AI: finds pages and explains how things work in the app. It can't see sales, bookings or any other data.",
  starters: {
    title: 'Try asking',
    tasks: 'Where do I see my tasks?',
    break: 'How do I take a break?',
    incident: 'How do I report an incident?',
  },
  composer: {
    placeholder: 'Ask where something is or how to do it…',
    hint: 'Free. Answers come from the app guide, not from your data.',
  },
  /** The owner's way back from the free thread. */
  usePaid: 'Use the paid assistant',
  newChat: 'New chat',
  you: 'You',
  assistant: 'Free AI',
  thinking: 'Thinking…',
  goTo: 'Go to {page}',
  stopped: 'Stopped. The answer was cut short.',
  retry: 'Try again',
  errors: {
    /** Counted (countPhrase): the seconds the refusal's retry_after_s names. */
    minute: {
      zero: "You've asked a lot in a minute; try again in a moment.",
      one: "You've asked a lot in a minute; try again in a second.",
      two: "You've asked a lot in a minute; try again in two seconds.",
      few: "You've asked a lot in a minute; try again in {count} seconds.",
      many: "You've asked a lot in a minute; try again in {count} seconds.",
      other: "You've asked a lot in a minute; try again in {count} seconds.",
    },
    minuteSoon: "You've asked a lot in a minute; try again shortly.",
    day: "Today's free questions are used up; they come back tomorrow.",
    club: 'The free AI is busy right now; try again in a minute.',
    notConfigured: "The free AI isn't set up yet (GROQ_API_KEY).",
    timeout: 'The answer took too long and was stopped.',
    generic: "The free AI didn't answer. Check the connection and try again.",
  },
} as const;
