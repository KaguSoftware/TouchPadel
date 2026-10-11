import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';

/**
 * Tournaments, the guest's side (tournaments plan §5.2), as a stack of its own
 * with its own native bar, so the bar and its back button leave with the page at
 * the swipe's speed. Why, and the first screen's back: src/navigation/groupStack.tsx.
 */
export default function TournamentsLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="tournaments" />
      <Stack.Screen name="tournament/[id]" />
    </Stack>
  );
}
