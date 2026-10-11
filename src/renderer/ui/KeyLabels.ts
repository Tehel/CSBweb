/**
 * A key's label: what the player's keyboard prints on it, in the game's font, for the
 * settings' KEYS tab (`SettingsKeys.ts`). Only the label depends on the layout: a binding
 * is the physical key, its `KeyboardEvent.code` (`Keyboard.ts`), so no layout needs other
 * bindings.
 *
 * Where the browser gives the layout (`navigator.keyboard.getLayoutMap()`, the page's
 * `keyboardLayout` hook), a key that types a character is labelled with it. Elsewhere the
 * player picks QWERTY or AZERTY, and the character is that layout's (`LAYOUT_CHARS`).
 *
 * The font draws `!` to `?`, A to Z and `[ \ ] ^ _` (graphic 0x22d, `TextRenderer.ts`),
 * and a label is upper case. A character outside that is named in letters (`CHAR_NAMES`),
 * or else the key is (`CODE_NAMES`). A digit key is its digit, which every layout prints
 * on it, shifted or not; so is the keypad's, `KP 8`. A key that types nothing is named
 * (SPACE, TAB, F1, LEFT).
 */

/** The layouts a player can pick where the browser does not say. */
export type KeyLabelLayout = 'qwerty' | 'azerty';

export const KEY_LABEL_LAYOUTS: readonly KeyLabelLayout[] = ['qwerty', 'azerty'];

/** What a layout map is: a code's unshifted character, as `KeyboardLayoutMap` gives it. */
export type KeyboardLayoutMap = ReadonlyMap<string, string>;

/** The longest label, so a slot is this many characters wide. */
export const KEY_LABEL_CHARS = 11;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The characters the punctuation keys type, unshifted, on a US and a French keyboard. */
const US_PUNCTUATION: Readonly<Record<string, string>> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\',
};
const FR_PUNCTUATION: Readonly<Record<string, string>> = {
  Backquote: '²', Minus: ')', Equal: '=', BracketLeft: '^', BracketRight: '$', Backslash: '*',
  Semicolon: 'm', Quote: 'ù', Comma: ';', Period: ':', Slash: '!', IntlBackslash: '<', KeyM: ',',
};
/** AZERTY swaps A and Q, Z and W; its M is where QWERTY's semicolon is. */
const FR_LETTERS: Readonly<Record<string, string>> = { KeyA: 'q', KeyQ: 'a', KeyZ: 'w', KeyW: 'z' };

/** Each layout's character for a code that types one, the digits aside. */
export const LAYOUT_CHARS: Readonly<Record<KeyLabelLayout, KeyboardLayoutMap>> = {
  qwerty: new Map([
    ...[...LETTERS].map((c): [string, string] => [`Key${c}`, c.toLowerCase()]),
    ...Object.entries(US_PUNCTUATION),
  ]),
  azerty: new Map([
    ...[...LETTERS].map((c): [string, string] => [`Key${c}`, FR_LETTERS[`Key${c}`] ?? c.toLowerCase()]),
    ...Object.entries(FR_PUNCTUATION),
  ]),
};

/** The keys that type no character, or whose character is the keypad's. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: 'SPACE', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BACKSPACE', Escape: 'ESC',
  Pause: 'PAUSE', Insert: 'INSERT', Delete: 'DELETE', Home: 'HOME', End: 'END',
  PageUp: 'PAGE UP', PageDown: 'PAGE DOWN',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  ShiftLeft: 'SHIFT', ShiftRight: 'R SHIFT', CapsLock: 'CAPS LOCK', ContextMenu: 'MENU',
  NumLock: 'NUM LOCK', ScrollLock: 'SCROLL LOCK', PrintScreen: 'PRINT',
  NumpadEnter: 'KP ENTER', NumpadAdd: 'KP +', NumpadSubtract: 'KP -', NumpadMultiply: 'KP *',
  NumpadDivide: 'KP /', NumpadDecimal: 'KP .', NumpadEqual: 'KP =', NumpadComma: 'KP ,',
};

/** The characters of the common layouts the font cannot draw, named. */
const CHAR_NAMES: Readonly<Record<string, string>> = {
  '`': 'BACKQUOTE', '~': 'TILDE', '@': 'AT', '|': 'BAR', '{': 'LEFT BRACE', '}': 'RIGHT BRACE',
  '²': 'SQUARE', 'µ': 'MU', '§': 'SECTION', '£': 'POUND', '°': 'DEGREE', '¨': 'DIAERESIS',
  'à': 'A GRAVE', 'ä': 'A UMLAUT', 'ç': 'C CEDILLA', 'é': 'E ACUTE',
  'è': 'E GRAVE', 'ì': 'I GRAVE', 'ñ': 'N TILDE', 'ò': 'O GRAVE',
  'ö': 'O UMLAUT', 'ù': 'U GRAVE', 'ü': 'U UMLAUT', 'ß': 'SHARP S', 'å': 'A RING',
  'æ': 'AE', 'ø': 'O SLASH',
};

/** A punctuation key named, where neither its character nor a name of it can be drawn. */
const CODE_NAMES: Readonly<Record<string, string>> = {
  Backquote: 'BACKQUOTE', Minus: 'MINUS', Equal: 'EQUALS', BracketLeft: 'L BRACKET',
  BracketRight: 'R BRACKET', Backslash: 'BACKSLASH', Semicolon: 'SEMICOLON', Quote: 'QUOTE',
  Comma: 'COMMA', Period: 'PERIOD', Slash: 'SLASH', IntlBackslash: 'ISO KEY', IntlRo: 'RO',
  IntlYen: 'YEN',
};

/** Whether the game's font draws every character of `s`, as `drawText` upper-cases it. */
export function fontDraws(s: string): boolean {
  return /^[ -?A-Z[\\\]^_]*$/.test(s);
}

/**
 * The label of the key `code`, from the browser's layout map where there is one, else
 * from `layout`'s. `''` is no key: an empty slot.
 */
export function keyLabel(code: string, layout: KeyLabelLayout, layoutMap: KeyboardLayoutMap | null): string {
  if (code === '') return '';
  const digit = /^(Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1] === 'Numpad' ? `KP ${digit[2]}` : digit[2];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named = NAMED_KEYS[code];
  if (named) return named;
  const char = (layoutMap ?? LAYOUT_CHARS[layout]).get(code);
  if (char !== undefined && char.length === 1) {
    const upper = char.toUpperCase();
    if (upper.length === 1 && fontDraws(upper)) return upper;
    const name = CHAR_NAMES[char] ?? CHAR_NAMES[char.toLowerCase()];
    if (name) return name;
  }
  return CODE_NAMES[code] ?? code.toUpperCase().slice(0, KEY_LABEL_CHARS);
}
