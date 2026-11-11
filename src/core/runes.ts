/**
 * The runes' names, as the manual gives them: no game file holds them, the magic panel
 * drawing the runes as glyphs of its font. A rune's code in the game is 96 plus its index
 * here (`doc/CSBwin-src/Magic.cpp:866`, `0x60 + 6 * row + n`): six of each row, power,
 * element, form and alignment, in the order the panel shows them.
 */
export const RUNE_NAMES: readonly string[] = [
    'LO', 'UM', 'ON', 'EE', 'PAL', 'MON',
    'YA', 'VI', 'OH', 'FUL', 'DES', 'ZO',
    'VEN', 'EW', 'KATH', 'IR', 'BRO', 'GOR',
    'KU', 'ROS', 'DAIN', 'NETA', 'RA', 'SAR',
];

/** The code of the first rune, `LO`. */
export const FIRST_RUNE = 96;
