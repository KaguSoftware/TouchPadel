import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';

/**
 * Coach mode (docs/design/coaching/guest.md §4.13), as a stack of its own with
 * its own native bar, so the bar and its back button leave with the page at the
 * swipe's speed on the way back to Profile or the staff hub (owner, 2026-10-11).
 * Why, and the first screen's back: src/navigation/groupStack.tsx. Each screen
 * carries its own RequireCoach.
 */
export default function CoachModeLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="coach-mode" />
      <Stack.Screen name="coach-mode-hours" />
      <Stack.Screen name="coach-mode-lesson" />
      <Stack.Screen name="coach-mode-new" />
      <Stack.Screen name="coach-mode-book" />
      <Stack.Screen name="coach-mode-statements" />
    </Stack>
  );
}
