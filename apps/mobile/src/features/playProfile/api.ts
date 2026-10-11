import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { playProfileOf, surveyArgs, type PlayAnswers, type PlayProfile } from './logic';

type Client = SupabaseClient<Database>;

/**
 * `app.set_my_play_profile` (0334, contracts §4.1): the three answers, each
 * null when skipped (all three null = the survey was skipped), always stamping
 * `play_survey_at`. Answers `{play_level, play_years, play_wants,
 * play_survey_at}`. A value outside the vocabulary is INVALID_PLAY_PROFILE,
 * which this client cannot send: the screen only offers the vocabulary.
 *
 * The read is the own-profile row (PROFILE_COLUMNS in features/profile/api.ts
 * carries the four columns), so there is no read here.
 */
export async function setMyPlayProfile(client: Client, answers: PlayAnswers): Promise<PlayProfile> {
  const app = client.schema('app');
  // The generated Args type every argument as optional `string` / `string[]`,
  // with no null; a skipped question IS a null (contracts §4.1: every argument
  // is sent, nulls included), so the call goes through an untyped view.
  const rpc = app.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc.call(app, 'set_my_play_profile', surveyArgs(answers));
  if (error) throw error;
  const saved = playProfileOf(data);
  // The server always answers the four keys; fall back to what was sent, stamped now.
  return saved ?? { ...answers, answeredAt: new Date().toISOString() };
}
