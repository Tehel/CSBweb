# CSBWin Magic Selection Reference (Sourced)

This document captures verified magic UI/selection behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Caster tab input

- `HandleMagicClick` uses hardcoded x ranges for caster tabs when `clickY <= 48` (not button tables), and otherwise uses `SearchButtonList(d.buttons18060)` to map rune/command buttons (`doc/CSBwin-src/Magic.cpp`).

## Rune selection and casting

- `MagicSelection` treats button `108` as cast, otherwise uses `button-101` to pick rune (0..5) or backspace, and flashes rectangles from `Word18552` before calling `TAG01b990`/`BackspaceMagicSelection` (`doc/CSBwin-src/Magic.cpp`).
- `TAG01b990` computes rune mana cost from `Byte19010[24]` and scales by `Byte19016[6]` for subsequent runes, writes incantation bytes as `96 + 6*pos + button`, advances `byte33`, and updates the UI (spell menu chars, selection, character state) (`doc/CSBwin-src/CSBCode.cpp`).

## Spell UI drawing

- `DisplayMagicSelection` draws the 4 incantation slots at x positions `232 + 9*(i+1)` (first at 241), y `70`, color `4`, background `0`, using the incantation bytes or space (`doc/CSBwin-src/Magic.cpp`).
- `DrawSpellMenuCharacters` draws the 6 rune letters for a group at x positions `225 + 14*(i+1)` (first at 239), y `58`, color `4`, background `0`, with rune codes starting at `96 + 6*group` (`doc/CSBwin-src/CSBCode.cpp`).
- `SelectMagicCaster` blits basic graphic `9` into `Word12` when selecting the first magic caster (from `-1`), and clears `Word12` when `chIdx == -1` (`doc/CSBwin-src/Magic.cpp`).
