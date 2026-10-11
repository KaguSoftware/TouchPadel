import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';

/**
 * Tournaments, the guest's side (tournaments plan §5.2), as a stack of its own
 * with its own native bar, so the bar and its back button leave with the page at
 * the swipe's speed. Why, and the first screen's back: src/navigation/groupStack.tsx.
 * The list moved to the Play tab (2026-10-11, play-coaches contracts §1), so the
 * detail is the group's only, and so its first, screen.
 */
export default function TournamentsLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="tournament/[id]" />
    </Stack>
  );
}
