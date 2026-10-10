import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';

/**
 * Lessons with a coach, the guest's side (docs/design/coaching/guest.md §4.8), as
 * a stack of its own with its own native bar, so the bar and its back button
 * leave with the page at the swipe's speed. Why, and the first screen's back:
 * src/navigation/groupStack.tsx. The browsing screens are public; the review,
 * the lesson and My lessons carry their own session guard.
 */
export default function CoachingLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="coaches" />
      {/* Transparent from the push's first frame: the coach page's photo
          runs under the bar, and a bar drawn opaque until the screen's own
          options land flashed a white strip (coach/[id].tsx). */}
      <Stack.Screen
        name="coach/[id]"
        options={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }}
      />
      <Stack.Screen name="classes" />
      <Stack.Screen name="class/[id]" />
      {/* The private lesson page runs its blue header under a transparent
          bar from the first frame; its other states set a plain one. */}
      <Stack.Screen
        name="lesson-times"
        options={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }}
      />
      {/* The review runs the same blue header under a transparent bar. */}
      <Stack.Screen
        name="lesson-review"
        options={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }}
      />
      <Stack.Screen name="lesson/[id]" />
      <Stack.Screen name="my-lessons" />
    </Stack>
  );
}
