import { Stack } from 'expo-router';
import { useGroupStackOptions } from '../../src/navigation/groupStack';
import { withAssistantFab } from '../../src/features/assistant/AssistantFab';

/**
 * The staff pages Today opens, as a stack of their own with their own native
 * bar, so the bar and its back button leave with the page at the swipe's speed
 * on the way back to Today, which draws no bar (owner, 2026-10-11). Why, and the
 * first screen's back: src/navigation/groupStack.tsx. Today itself (app/staff.tsx)
 * and a group's sheet over it (app/staff-group.tsx) stay on the root stack.
 *
 * `screenLayout` draws the owner's assistant button INSIDE each page, so it
 * slides in and out with its page; an overlay over the whole stack followed the
 * pathname, which only changes once the navigation has happened, and so lagged
 * every push and pop.
 */
export default function StaffLayout() {
  const screenOptions = useGroupStackOptions();
  return (
    <Stack screenOptions={screenOptions} screenLayout={withAssistantFab}>
      {/* Place an order (0251): an item's size and options, as the platform's sheet over the table's menu. */}
      <Stack.Screen
        name="staff-order-item"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.75, 1],
          sheetGrabberVisible: true,
        }}
      />
    </Stack>
  );
}
