import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';

/**
 * Open matches (docs/design/open-matches/guest.md §4.12–§4.18), as a stack of
 * its own with its own native bar, so the bar and its back button leave with the
 * page at the swipe's speed. Why, and the first screen's back:
 * src/navigation/groupStack.tsx. Each screen carries its own session guard. The
 * invite link's landing (app/m/[token].tsx) stays on the root stack and replaces
 * itself with the match.
 */
export default function MatchesLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="match/[id]" />
      <Stack.Screen name="match-new" />
      {/* The report is a modal over the match, like the terms gate. */}
      <Stack.Screen name="match-report" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
