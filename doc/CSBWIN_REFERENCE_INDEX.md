# CSBWin Reference Index

This index links the CSBWin-sourced reference docs under `doc/`.

## Core CSBWin references

- `doc/CSBWIN_ARCHITECTURE.md` - High-level architecture and system overview (sourced from CSBWin code).
- `doc/CSBWIN_RENDERING_REFERENCE.md` - Rendering pipeline, graphics memory, and opcode/blitting details.
- `doc/CSBWIN_VIEWPORT_REFERENCE.md` - Generated viewport bytecode/opcode tables and cell programs.
- `doc/CSBWIN_UI_REFERENCE.md` - UI layout and drawing behavior verified from CSBWin.
- `doc/CSBWIN_TIMERS_REFERENCE.md` - Timer scheduling, dedupe rules, and door/false-wall timers.
- `doc/CSBWIN_MOVEMENT_REFERENCE.md` - Movement blocking rules and collision constraints.
- `doc/CSBWIN_INPUT_REFERENCE.md` - Mouse routing, viewport interaction, and throw gating.
- `doc/CSBWIN_MAGIC_REFERENCE.md` - Magic UI selection, rune entry, and caster tabs.
- `doc/CSBWIN_MESSAGES_REFERENCE.md` - Scrolling message area: queue, word wrap, 4 rows, timeouts, colours.
- `doc/CSBWIN_MISSILES_REFERENCE.md` - Missile timers, movement, and encounter resolution.
- `doc/CSBWIN_ATTACK_REFERENCE.md` - The champion's own attacks: the ATTACKPARAMETERS block and its filter, the physical damage chain, every attack type, and the attack menu.
- `doc/CSBWIN_MONSTERS_REFERENCE.md` - Monster data model (MONSTERDESC/DB4/ITEM16), group lifecycle, AI timers, attack tables.
- `doc/CSBWIN_CHAMPION_LIFECYCLE_REFERENCE.md` - The champion from creation to resurrection: the ATTRIBUTE (maximum, current, minimum) triple, AddCharacter and the Hall of Champions, KillCharacter and bones, the Vi altar, reincarnation, potions, pit falls.
- `doc/CSBWIN_DSA_REFERENCE.md` - DSA loading, timers, and STKOP behaviors.
- `doc/CSBWIN_DECORATIONS_REFERENCE.md` - Wall/floor decoration eligibility and rendering rules.
- `doc/CSBWIN_SAVEGAME_REFERENCE.md` - Extended features and save/load structures.
- `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` - Everything before the party is in the dungeon: the title animation and `ShrinkBLT`, the dungeon entrance and the synthetic 5x5 level behind its doors, the 31-frame door animation, the credits scroll, and how "Resume" differs from the in-game disk icon.
- `doc/CSBWIN_MENU_REFERENCE.md` - The disk icon and the menu system behind it: graphic 0, the four button layouts, text metrics, the modal loop and its press animation, the four save slots, and this port's deliberate divergences.
- `doc/CSBWIN_HINT_ORACLE_REFERENCE.md` - Chaos Strikes Back's Hint Oracle: the `hcsb.hct` format (location table, hint records, compressed pages), which hints apply to a square, and the menu's limits.

## Other CSBWin-sourced docs

- `doc/ACTUATORS.md` - DB3 actuator format and behavior.
- `doc/GRAPHICS_MAPPINGS.md` - Wall/door bitmap indices and rectangle mappings.
- `doc/VIEWPORT_RENDERING.md` - Narrative rendering overview tied to CSBWin behavior.
- `doc/PROVEN_FACTS.md` - Specific verified facts with source references.
- `doc/UI_MODULE_MAP.md` - Which `src/renderer/ui/` module ports which CSBWin UI file.
- `doc/ATARI_ST_DISK_REFERENCE.md` - Not CSBWin-sourced: the English 1.2 Atari ST disk. The boot chain, the FTL logo (`SWOOSH.IMG`: its picture codec, palette script and sound), and how the 1.2 `graphics.dat` and `dungeon.dat` differ from the ones we ship (the Crack Switch (In) among them).
- `doc/3D2D1D.md` - The 3D2D1D dungeon: the vertical moves and gravity our CSBWin source hardwires off, the two `extendedFlags` bits the 2019 exe reads them from, and the two keys (`DEBT.md` X5).
- `doc/MONSTER_BEHAVIOUR.md` - Plain-language account of monster decision-making: senses, moods, the turn as a decision tree, per-type differences, and what remains unexplained.
- `doc/monster-behaviour.html` - The same text as a formatted, self-contained page. Open it straight from disk; no external fonts, scripts or stylesheets.
