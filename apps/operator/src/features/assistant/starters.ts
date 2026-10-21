/**
 * The ready questions (owner call 2026-10-20). A new chat opens on six topic
 * cards, each naming what it reads; pressing one of its questions sets the
 * chat to exactly those scopes and asks, so the owner never pays for context
 * the question does not need. Under the newest answer, "Ask next" offers
 * follow-ups for the scope that answer actually read. The words live in the
 * catalog (`ws.owner.assistant.starters.*`, `ws.owner.assistant.followUps.*`);
 * this file only says which keys go where.
 */
import { toolByName, type AssistantScope } from '@touch/core/assistant/tools';

export interface StarterTopic {
  /** `ws.owner.assistant.starters.<key>.title` and `.questions.<q>`. */
  key: 'cafe' | 'courts' | 'money' | 'stock' | 'staff' | 'howto';
  /** What the chat reads when one of its questions is pressed. */
  scopes: readonly AssistantScope[];
  questions: readonly string[];
  /** --tp-card-<n>: green, violet, rose, sky, teal, gold. */
  card: 1 | 2 | 3 | 4 | 5 | 6;
}

export const STARTER_TOPICS: readonly StarterTopic[] = [
  { key: 'cafe', scopes: ['cafe', 'money'], questions: ['takings', 'bestSellers', 'slowItems'], card: 1 },
  { key: 'courts', scopes: ['courts'], questions: ['fullToday', 'emptyHours', 'noShows'], card: 2 },
  { key: 'money', scopes: ['money'], questions: ['weekCompare', 'refunds'], card: 3 },
  { key: 'stock', scopes: ['stock'], questions: ['runningLow', 'waste'], card: 4 },
  { key: 'staff', scopes: ['staff'], questions: ['onShift', 'late'], card: 5 },
  { key: 'howto', scopes: ['howto'], questions: ['deposit', 'addStaff'], card: 6 },
];

/** Follow-up keys per scope, most useful first. */
const FOLLOW_UPS: Partial<Record<AssistantScope, readonly string[]>> = {
  cafe: ['compareLastWeek', 'byItem', 'byHour'],
  courts: ['compareLastWeek', 'byCourt', 'byHour'],
  money: ['compareLastWeek', 'byMethod', 'byDay'],
  stock: ['whatToOrder', 'wasteByItem'],
  staff: ['byPerson', 'compareLastWeek'],
  customers: ['topCustomers', 'compareLastWeek'],
  marketing: ['didItWork', 'compareLastWeek'],
  howto: ['stepByStep', 'whoCanDoIt'],
};
const GENERIC = ['explainMore', 'compareLastWeek'] as const;

/**
 * Up to three follow-ups for an answer: from the scope of the first tool it
 * read (the business it was about), else from the chat's first business
 * scope, else two generic ones.
 */
export function followUpsFor(toolNames: readonly string[], chatScopes: readonly AssistantScope[]): string[] {
  const read = toolNames.map((n) => toolByName(n)?.scope).find((s): s is AssistantScope => !!s && !!FOLLOW_UPS[s]);
  const fromChat = chatScopes.find((s) => s !== 'howto' && s !== 'system' && !!FOLLOW_UPS[s]) ?? chatScopes.find((s) => !!FOLLOW_UPS[s]);
  const scope = read ?? fromChat;
  return [...(scope ? FOLLOW_UPS[scope]! : GENERIC)].slice(0, 3);
}
