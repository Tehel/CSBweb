# CSBWin Magic Selection Reference (Sourced)

This document captures verified magic UI/selection behavior from the CSBWin C++ source under `doc/CSBwin-src/`.

## Caster tab input

- `HandleMagicClick` uses hardcoded x ranges for caster tabs when `clickY <= 48` (not button tables), and otherwise uses `SearchButtonList(d.buttons18060)` to map rune/command buttons (`doc/CSBwin-src/Magic.cpp:589-709`).
- The ranges are those of the tabs `DrawSpellControls` draws, 12 pixels wide and 14 apart: before the caster at `233 + 14*i`, after it at `266 + 14*i`; the caster's own tab (`233 + 14*c` to `277 + 14*c`) and the gaps pick nobody. With caster 3, any `clickX <= 244` picks champion 0. `clickX` 512-515 pick champions 0-3 outright (`doc/CSBwin-src/Magic.cpp:596-686`).
- A click at `y <= 48` returns without searching the keypad, whatever it picked. A pick is applied only if it is below `d.NumCharacter`, and `SelectMagicCaster` then refuses a champion whose `HP()` is 0 (`doc/CSBwin-src/Magic.cpp:689-698`, `:724`).

## Rune selection and casting

- `MagicSelection` treats button `108` as cast, otherwise uses `button-101` to pick rune (0..5) or backspace, and flashes rectangles from `Word18552` before calling `TAG01b990`/`BackspaceMagicSelection` (`doc/CSBwin-src/Magic.cpp:545-575`).
- The cast button checks nothing but `incantation[0] != 0`, then sets `d.clockTick = CastMagic(0)` (`doc/CSBwin-src/Magic.cpp:556-567`). `CastMagic` clears the incantation and `byte33` unless `CastSpell` returned 3, which it turns into 0 (`:945-956`).
- `TAG01b990` computes rune mana cost from `Byte19010[24]` and, for a rune after the first, `(cost * Byte19016[first - 96]) >> 3`, so a remainder is dropped. A cost above the mana refuses the rune. It writes incantation bytes as `96 + 6*pos + button`, advances `byte33` as `(byte33 + 1) & 3`, and updates the UI (spell menu chars, selection, character state) (`doc/CSBwin-src/CSBCode.cpp:8963-8995`).
- `BackspaceMagicSelection` clears the rune at `(byte33 + 3) & 3` and gives no mana back (`doc/CSBwin-src/Magic.cpp:806-822`).

## Spell UI drawing

- `DrawSpellControls` clears `Word20242` to 0, then inverts plane 2 (`vblFlashButn`, index 4 over black) of the caster's tab, `y 0x2a-0x31`, with the name at `(x1 + 2, 0x30)` in colour 0 on 4, and of each other champion's below `d.NumCharacter` whose `HP()` is not 0, `y 0x2a-0x30` (`doc/CSBwin-src/Character.cpp:4984-5087`).

- `DisplayMagicSelection` draws the 4 incantation slots at x positions `232 + 9*(i+1)` (first at 241), y `70`, color `4`, background `0`, using the incantation bytes or space (`doc/CSBwin-src/Magic.cpp`).
- `DrawSpellMenuCharacters` draws the 6 rune letters for a group at x positions `225 + 14*(i+1)` (first at 239), y `58`, color `4`, background `0`, with rune codes starting at `96 + 6*group` (`doc/CSBwin-src/CSBCode.cpp`).
- `SelectMagicCaster` blits basic graphic `9` into `Word12` when selecting the first magic caster (from `-1`), and clears `Word12` when `chIdx == -1` (`doc/CSBwin-src/Magic.cpp`).
