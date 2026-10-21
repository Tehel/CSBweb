# CSBWin Reference Index

This index links the CSBWin-sourced reference docs under `doc/`.

## The tree: CSBWin 20230608

`doc/CSBwin-src/` is `CSBwin_SRC_20230608.7z` from dianneandpaul.net/CSBwin/, the main
line's last source and the build the author plays ("Version 2023.06.08", `CSBwin.rc:313`),
with the CRs of its source and text files removed and nothing else changed. It is not ours,
so it is git-ignored: `npm run fetch-csbwin-src` (`tools/fetch-csbwin-src.ts`) fetches it,
from the site or the Wayback Machine's copy, checks the archive's SHA-256 and writes the tree. No commit holds the tree.
`doc/CSBWIN_SYMBOL_INDEX.tsv` is built from it, and every citation in `doc/`, `src/` and `tools/` names its lines (`doc/PLAN_ARCHIVE.md`'s
are mapped by script and unreviewed).

The port followed `CSBwin_SRC_20160923.zip` before it, from its first commit to Debt C157's:
those commits fetch it with their own `npm run fetch-csbwin-src` (`tools/fetch-csbwin-src.mjs`,
pinned to that archive). Their citations of `SaveGame.cpp`, `RC4.cpp` and `CSBCode.cpp` name
the lines of a reformatted copy no commit keeps, up to 193 lines off the archive's. It is
"Version 15.9", a side branch of
`CSBwin_SRC_20160325` (15.8) whose only change is accessors for a monster's `word20`, so it
behaves as 15.8. Every change between the two that alters what the port has is ported, but
for the utility's stop on a word-10 saved game (`DEBT.md` H). The rest changes nothing the
port has: the 64-bit port (`uintptr_t`, and typed structs in `Chaos.cpp` and `Hint.cpp`,
whose allocator fixes are in code the port never had), `TranslateLanguage` hooks (`DEBT.md`
G21), the playfile (G29), and the Linux and Raspberry Pi front-ends. None of the port's
deliberate divergences (`DEBT.md` H, and the exceptions `CLAUDE.md` names) is a code path
that 2023 changed.

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
- `doc/CSBWIN_SAVEGAME_REFERENCE.md` - Extended features and save/load structures: the sixteen blocks in write order, how much of each the port writes and reads, and the tools that prove it.
- `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` - Everything before the party is in the dungeon: the title animation and `ShrinkBLT`, the dungeon entrance and the synthetic 5x5 level behind its doors, the 31-frame door animation, the credits scroll, and how "Resume" differs from the in-game disk icon.
- `doc/CSBWIN_MENU_REFERENCE.md` - The disk icon and the menu system behind it: graphic 0, the four button layouts, text metrics, the modal loop and its press animation, the four save slots, and this port's deliberate divergences.
- `doc/CSBWIN_HINT_ORACLE_REFERENCE.md` - Chaos Strikes Back's Hint Oracle: the `hcsb.hct` format (location table, hint records, compressed pages), which hints apply to a square, and the menu's limits, and the screen: its builds, fades, texts, buttons and click queue.

## Other CSBWin-sourced docs

- `doc/ACTUATORS.md` - DB3 actuator format and behavior.
- `doc/GRAPHICS_MAPPINGS.md` - Wall/door bitmap indices and rectangle mappings.
- `doc/VIEWPORT_RENDERING.md` - Narrative rendering overview tied to CSBWin behavior.
- `doc/PROVEN_FACTS.md` - Specific verified facts with source references.
- `doc/SAVES.md` - Not CSBWin-sourced: the port's saves. A save as a CSBWin `.dat` in a row of IndexedDB, the dungeon check on an import, the playthrough (`d.RandomGameID`), F5 and F9, the dialog behind the disk icon, and the evidence for each.
- `doc/UI_MODULE_MAP.md` - Which `src/renderer/ui/` module ports which CSBWin UI file.
- `doc/ATARI_ST_DISK_REFERENCE.md` - Not CSBWin-sourced: the six Atari ST disks of DM (1.0 twice, 1.1, 1.2 English and German, 1.3 French). The boot chain, the FTL logo (`SWOOSH.IMG`: its picture codec, palette script and sound), what each version changes in `graphics.dat` and `dungeon.dat`, and which versions CSBWin's files are (1.0's graphics, 1.1's dungeon; the Crack Switch (In) among the differences). `doc/dm-versions.html` is its version history, to read.
- `doc/3D2D1D.md` - The 3D2D1D dungeon: the vertical moves and gravity, the two `extendedFlags` bits CSBWin reads them from, and the two keys.
- `doc/MONSTER_BEHAVIOUR.md` - Plain-language account of monster decision-making: senses, moods, the turn as a decision tree, per-type differences, and what remains unexplained.
- `doc/monster-behaviour.html` - The same text as a formatted, self-contained page. Open it straight from disk; no external fonts, scripts or stylesheets.
