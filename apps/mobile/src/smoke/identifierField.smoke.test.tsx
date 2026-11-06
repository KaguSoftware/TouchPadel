/**
 * Sign-in's phone-or-email field (components/IdentifierField.tsx): the country
 * chip shows once what is typed is a phone number, and not for an email. The
 * slide itself is motion; this pins WHEN the chip is there and what the field
 * keeps. Not a route case: sign-in's own is auth.smoke's.
 */
import { useState } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent } from '@testing-library/react-native';
import { renderRoute } from '../test/smoke';
import { IdentifierField } from '../components/IdentifierField';

function Harness({ initial, onValue }: { initial: string; onValue: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <IdentifierField
      testID="x.identifier"
      value={value}
      onChangeText={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

function mount(initial: string) {
  const seen: string[] = [];
  const screen = renderRoute(() => <Harness initial={initial} onValue={(v) => seen.push(v)} />, {
    locale: 'en',
  });
  return { screen, seen };
}

describe('the sign-in identifier field', () => {
  it('shows no chip for an email or an empty field', () => {
    const a = mount('sara@mail.com');
    expect(a.screen.queryByTestId('x.identifier.country')).toBeNull();
    a.screen.unmount();
    const b = mount('');
    expect(b.screen.queryByTestId('x.identifier.country')).toBeNull();
    b.screen.unmount();
  });

  it("shows Iraq's chip for a local number and keeps the digits as written", () => {
    const { screen } = mount('07701234567');
    expect(screen.getByTestId('x.identifier.country')).toBeTruthy();
    expect(screen.getByTestId('x.identifier').props.value).toBe('0770 123 4567');
    screen.unmount();
  });

  it('moves a complete +code into the chip and keeps only the rest in the field', () => {
    const { screen, seen } = mount('');
    fireEvent.changeText(screen.getByTestId('x.identifier'), '+44');
    expect(screen.getByTestId('x.identifier.country')).toBeTruthy();
    expect(screen.getByTestId('x.identifier').props.value).toBe('');
    fireEvent.changeText(screen.getByTestId('x.identifier'), '7700900123');
    expect(seen[seen.length - 1]).toBe('+447700900123');
    screen.unmount();
  });

  it('takes the code back out on backspace at the start', () => {
    const { screen, seen } = mount('+447700900123');
    const input = screen.getByTestId('x.identifier');
    fireEvent(input, 'selectionChange', { nativeEvent: { selection: { start: 0, end: 0 } } });
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(seen[seen.length - 1]).toBe('+447700900123'.replace('+44', '+4'));
    screen.unmount();
  });

  it('makes the chip a button that opens the country sheet', () => {
    const { screen } = mount('0770');
    const chip = screen.getByTestId('x.identifier.country');
    expect(chip.props.accessibilityRole).toBe('button');
    // The sheet is SwiftUI on iOS (out of the RN tree): pressing must open it without error.
    expect(() => fireEvent.press(chip)).not.toThrow();
    screen.unmount();
  });

  it('fades the chip out when the number is cleared, then removes it', () => {
    jest.useFakeTimers();
    try {
      const { screen } = mount('+447700900123');
      fireEvent.changeText(screen.getByTestId('x.identifier'), '');
      // Still drawn while it fades (the field is now empty).
      expect(screen.getByTestId('x.identifier.country')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId('x.identifier.country')).toBeNull();
      screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the code when only the last digit is deleted', () => {
    const { screen, seen } = mount('+447');
    fireEvent.changeText(screen.getByTestId('x.identifier'), '');
    expect(seen[seen.length - 1]).toBe('+44');
    expect(screen.getByTestId('x.identifier.country')).toBeTruthy();
    screen.unmount();
  });
});
