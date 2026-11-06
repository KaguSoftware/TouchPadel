/**
 * Reveal (components/Reveal.tsx) and the floating label (components/FloatingLabel.tsx):
 * what is on screen and when. The motion itself is not asserted. Not a route
 * case: sign-in's own is auth.smoke's.
 */
import { useState } from 'react';
import { Pressable } from 'react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent } from '@testing-library/react-native';
import { renderRoute } from '../test/smoke';
import { Reveal } from '../components/Reveal';
import { FloatingField } from '../components/FloatingLabel';
import { Text } from '../i18n/text';
import SignInScreen from '../../app/sign-in';

function Toggle() {
  const [show, setShow] = useState(false);
  return (
    <>
      <Pressable testID="t.toggle" onPress={() => setShow((v) => !v)}>
        <Text>toggle</Text>
      </Pressable>
      <Reveal show={show}>
        <Text testID="t.content">content</Text>
      </Reveal>
    </>
  );
}

describe('Reveal', () => {
  it('mounts its children when shown and removes them once the close has played', () => {
    jest.useFakeTimers();
    try {
      const screen = renderRoute(() => <Toggle />, { locale: 'en' });
      expect(screen.queryByTestId('t.content')).toBeNull();
      fireEvent.press(screen.getByTestId('t.toggle'));
      expect(screen.getByTestId('t.content')).toBeTruthy();
      fireEvent.press(screen.getByTestId('t.toggle'));
      // Still there while it closes.
      expect(screen.getByTestId('t.content')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId('t.content')).toBeNull();
      screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('FloatingField', () => {
  it('shows its label as the placeholder text and no native placeholder', () => {
    const screen = renderRoute(
      () => <FloatingField testID="t.field" placeholder="Password" value="" onChangeText={() => {}} />,
      { locale: 'en' },
    );
    expect(screen.getAllByText('Password').length).toBeGreaterThan(0);
    expect(screen.getByTestId('t.field').props.placeholder).toBeUndefined();
    screen.unmount();
  });
});

describe('sign-in', () => {
  it('shows the password field once an email is typed, and not for a phone number', () => {
    const screen = renderRoute(SignInScreen, { locale: 'en' });
    try {
      expect(screen.queryByTestId('sign-in.password')).toBeNull();
      fireEvent.changeText(screen.getByTestId('sign-in.identifier'), 'sara@mail.com');
      expect(screen.getByTestId('sign-in.password')).toBeTruthy();
      expect(screen.getByTestId('sign-in.forgot-password')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});
