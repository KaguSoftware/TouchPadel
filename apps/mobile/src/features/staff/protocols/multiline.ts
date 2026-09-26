/**
 * A multi-line Field's box and text, for every note, reason and decline on
 * the protocol pages and the DecisionBar.
 *
 * The shared Field pins its box to one line's height, so a multi-line field
 * gave the person two cramped lines to write a reason in. These let the box
 * start at about five lines and grow with what is typed:
 * `boxStyle={MULTILINE_BOX}` and `style={MULTILINE_TEXT}` (Field hands `style`
 * to the input and `boxStyle` to the bordered row).
 *
 * Types only from react-native, so this stays a plain module.
 */
import type { TextStyle, ViewStyle } from 'react-native';

// The one pair for the staff phone: checklists/parts.tsx re-exports it for the
// daily pages, so every multi-line box opens and grows alike: about five
// lines, growing to about eleven, then it scrolls.
export const MULTILINE_BOX: ViewStyle = {
  height: 'auto',
  minHeight: 104,
  maxHeight: 220,
  paddingTop: 10,
  paddingBottom: 10,
  alignItems: 'stretch',
};

export const MULTILINE_TEXT: TextStyle = { textAlignVertical: 'top' };
