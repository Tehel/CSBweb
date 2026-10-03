/**
 * The mastery lines at the top of the eye panel — "NOVICE FIGHTER", "` MASTER WIZARD".
 *
 * `drawAttributePanel` prints one line per role above the six attributes
 * (`doc/CSBwin-src/Character.cpp:4590-4605`):
 *
 *     D5W = DetermineMastery(D4W, D7W|0x8000);
 *     D5W = Smaller(16, D5W);
 *     if (D5W == 1) continue;
 *     StrCpy(LOCAL_24, TranslateLanguage(d.Pointer16770[D5W]));
 *     StrCat(LOCAL_24, " ");
 *     StrCat(LOCAL_24, TranslateLanguage(d.Pointer16596[D7W]));
 *     TextToViewport(108, D6W, COLOR_13, LOCAL_24, false);
 *
 * Three things in those six lines can silently print nothing at all, and no golden frame
 * covers this panel — none of the five captured states has a champion with earned
 * experience showing its inventory — so only a tool sees them:
 *
 *   1. **`d.Pointer16770` is a code table, not a data table** (`doc/CSBwin-src/CSBCode.cpp:370`).
 *      It is one of the rare things in this port that is *not* extracted from
 *      `graphics.dat`, and it sat empty here, so every line was skipped by the
 *      `if (!masteryLabel) continue;` guard while the attributes below it drew fine.
 *   2. **The six master ranks start with `` ` `` and `a`..`e`** — in the DM font
 *      (graphic `0x22d`) those codes hold the rune glyphs for Lo, Um, On, Ee, Ux and Mon.
 *      Our `drawTextLineIndex` upper-cases its argument, which CSBWin's
 *      `TextOut_OneLine` does not (`doc/CSBwin-src/Graphics.cpp:335` indexes the font with
 *      the raw byte), so `a MASTER` would come out as `A MASTER` — an 'A', not the rune.
 *      Hence `drawTextLineIndexRaw`. The last check below is the canary for that.
 *   3. **The `0x8000`** — the printed rank is the *earned* one, so a temporary adjustment
 *      from a spell or potion must not move it.
 *
 * A later section draws the whole inventory of a Hall of Champions candidate: the held
 * eye must put the panel over the Resurrect menu, as `_ClickOnEye` does.
 *
 * The last section is the object panel, where the same rune glyphs prefix a potion's name
 * with its power once the champion is past mastery 1 as a priest
 * (`doc/CSBwin-src/Character.cpp:3599-3615`), and must reach the font raw as well.
 *
 * What to look for in the output: a line for every role whose mastery exceeds 1, at
 * x=108 / y=58+7n in viewport coordinates, matching the string spelled out here
 * independently; nothing on those rows for a champion with no experience; and the rune
 * ranks differing from their upper-cased selves.
 *
 * Run: `npx tsx tools/dump-mastery-panel.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, Direction, OBJECT_ID_NULL, Position, TilePosition, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { initialPartyState } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import type { Champion } from '../src/engine/gameTypes';
import { ensureSkills, determineMastery } from '../src/engine/skills';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw, loadFontData } from '../src/renderer/csbwin/TextRenderer';
import type { FontData } from '../src/renderer/csbwin/TextRenderer';
import { VIEWPORT_X, VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { type UIState } from '../src/renderer/ui/UIState';
import { MASTERY_LABELS, drawAttributePanel } from '../src/renderer/ui/Character';
import { drawInventoryScreen, drawObjectInfoPanel } from '../src/renderer/ui/Inventory';
import { getObjectDisplayName, getObjectName, resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import { OBJNI_EMPTY_FLASK, OBJNI_WATER_FLASK } from '../src/core/objectNameIndex';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { graphicsTablesOf, newGame, presetHeroesOf } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';

const SCREEN_W = 320;
const SCREEN_H = 200;
/** `TextToViewport(108, …)`: the viewport sits at screen x 0, and a glyph starts at the pen. */
const LINE_X = VIEWPORT_X + 108;
/** `D6W = 58; … D6W += 7;` */
const LINE_Y0 = 58;
const LINE_DY = 7;
/** `TextOut_OneLine` starts the glyph at `y - 4` and the font is six rows tall. */
const GLYPH_TOP = -4;
const GLYPH_ROWS = 6;
const GLYPH_W = 6;

/** The mastery `DetermineMastery` returns once a role holds `exp` experience. */
function masteryOfExperience(exp: number): number {
  let mastery = 1;
  let value = exp;
  while (value >= 500) {
    value = Math.floor(value / 2);
    mastery++;
  }
  return mastery;
}

/** The least experience that reaches `mastery`: 500 << (mastery - 2). */
function experienceForMastery(mastery: number): number {
  return 500 * Math.pow(2, mastery - 2);
}

/** The strip of pixels one panel line occupies, as a comparable string. */
function lineStrip(pixels: Uint8Array, lineIndex: number, widthChars: number): string {
  const y = VIEWPORT_Y + LINE_Y0 + lineIndex * LINE_DY + GLYPH_TOP;
  const out: string[] = [];
  for (let row = 0; row < GLYPH_ROWS; row++) {
    for (let col = 0; col < widthChars * GLYPH_W; col++) {
      out.push((pixels[(y + row) * SCREEN_W + LINE_X + col] ?? 0).toString(16));
    }
  }
  return out.join('');
}

/** The same strip, drawn on its own from a string spelled out in this tool. */
function expectedStrip(font: FontData, lineIndex: number, text: string, raw: boolean): string {
  const buffer = createPaletteIndexViewportBuffer(SCREEN_W, SCREEN_H, 0);
  const draw = raw ? drawTextLineIndexRaw : drawTextLineIndex;
  draw(buffer, font, LINE_X, VIEWPORT_Y + LINE_Y0 + lineIndex * LINE_DY, 13, null, text);
  return lineStrip(buffer.pixels, lineIndex, text.length);
}

/** How many pixels of a glyph are lit, straight out of `graphics.dat` item `0x22d`. */
function glyphWeight(font: FontData, code: number): number {
  let lit = 0;
  for (let row = 0; row < GLYPH_ROWS; row++) {
    const byte = font.bytes[code + row * 128] ?? 0;
    for (let col = 0; col < GLYPH_W; col++) if ((byte >> col) & 1) lit++;
  }
  return lit;
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = graphicsTablesOf(graphics).ui;
  const objectTables = graphicsTablesOf(graphics).objects;
  const font = loadFontData(graphics);

  // ---------------------------------------------------------------- the label table
  console.log('=== d.Pointer16770, and whether the font can draw it ===');
  console.log(['mastery', 'label', 'lit pixels per glyph'].join('\t'));
  const CSBWIN_LABELS: Array<[number, string]> = [
    [2, 'NEOPHYTE'], [3, 'NOVICE'], [4, 'APPRENTICE'], [5, 'JOURNEYMAN'],
    [6, 'CRAFTSMAN'], [7, 'ARTISAN'], [8, 'ADEPT'], [9, 'EXPERT'],
    [10, '` MASTER'], [11, 'a MASTER'], [12, 'b MASTER'], [13, 'c MASTER'],
    [14, 'd MASTER'], [15, 'e MASTER'], [16, 'ARCHMASTER'],
  ];
  for (const [mastery, label] of CSBWIN_LABELS) {
    const weights = [...label].map((ch) => glyphWeight(font, ch.charCodeAt(0) & 0x7f));
    console.log([mastery, label, weights.join(',')].join('\t'));
    check(MASTERY_LABELS[mastery] === label, `Pointer16770[${mastery}] is "${label}"`);
    // Every glyph the rank uses must actually exist in the font, or the line prints blanks.
    const firstChar = label.charCodeAt(0) & 0x7f;
    check(glyphWeight(font, firstChar) > 0, `the font has a glyph for "${label[0]}" (0x${firstChar.toString(16)})`);
  }
  check(MASTERY_LABELS.length === 17, 'the table is Pointer16770[17]');
  check((MASTERY_LABELS[0] ?? 'x') === '' && (MASTERY_LABELS[1] ?? 'x') === '',
    'slots 0 and 1 stay empty — CSBWin never reads them');
  console.log('');

  // ---------------------------------------------------------------- a real champion
  const heroes = presetHeroesOf(data, graphics).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 1) throw new Error('dungeon.dat carries no equipped preset hero');
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescWord4: objectTables.objDescWord4,
  };
  const champion: Champion = createChampionFromPreset(
    heroes[0],
    0,
    assignPresetHeroPossessions(heroes[0].inventory, addTables),
  );
  // The game's own party, so that the object panel reaches its systems.
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  const party = game.ctx.party;
  party.setState(initialPartyState(new Position(1, 1, 0), Direction.NORTH));
  party.addChampion(champion);
  party.state.selectedCharacterIndex = 0;

  const ui: UIState = newUIState(graphics, game.ctx);
  ui.partyState = party.state;

  /** Draw the panel for the champion as it stands and hand back the screen buffer. */
  function renderPanel(): Uint8Array {
    const buffer = createPaletteIndexViewportBuffer(SCREEN_W, SCREEN_H, 0);
    ui.screenIndexBuffer = buffer;
    drawAttributePanel(ui, champion);
    return buffer.pixels;
  }

  /** Put exactly `exp` experience on role `role` and clear the other three. */
  function setRoleExperience(role: number, exp: number, tempAdjust = 0): void {
    const skills = ensureSkills(champion.skills ?? []);
    for (let i = 0; i < 4; i++) {
      skills[i].experience = i === role ? exp : 0;
      skills[i].tempAdjust = i === role ? tempAdjust : 0;
    }
    for (let i = 4; i < skills.length; i++) {
      skills[i].experience = 0;
      skills[i].tempAdjust = 0;
    }
    champion.skills = skills;
  }

  // ------------------------------------------------- every rank, actually on screen
  console.log(`=== the panel line for ${champion.name}, rank by rank ===`);
  console.log(['role', 'experience', 'mastery', 'line drawn at x=108', 'pixels match'].join('\t'));
  const ROLES = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
  for (let mastery = 2; mastery <= 16; mastery++) {
    const role = (mastery - 2) % 4;
    const exp = experienceForMastery(mastery);
    setRoleExperience(role, exp);

    check(masteryOfExperience(exp) === mastery, `${exp} experience is mastery ${mastery}`);
    check(determineMastery(champion, role | 0x8000) === mastery,
      `DetermineMastery agrees at mastery ${mastery}`);

    const expected = `${MASTERY_LABELS[mastery]} ${ROLES[role]}`;
    const pixels = renderPanel();
    // The role's line is the only one printed, so it lands on the first row.
    const got = lineStrip(pixels, 0, expected.length);
    const want = expectedStrip(font, 0, expected, true);
    console.log([ROLES[role], exp, mastery, expected, got === want ? 'yes' : 'NO'].join('\t'));
    check(got === want, `"${expected}" is drawn on the panel`);
    check(/[^0]/.test(got), `"${expected}" leaves lit pixels behind`);
  }
  console.log('');

  // ---------------------------------------------------- mastery 1 prints nothing
  console.log('=== a champion with no experience ===');
  setRoleExperience(0, 0);
  check(determineMastery(champion, 0 | 0x8000) === 1, 'no experience is mastery 1');
  let blankPixels = renderPanel();
  for (let line = 0; line < 4; line++) {
    const strip = lineStrip(blankPixels, line, 16);
    console.log(`line ${line}: ${/[^0]/.test(strip) ? 'SOMETHING DRAWN' : 'empty'}`);
    check(!/[^0]/.test(strip), `mastery 1 leaves panel line ${line} empty`);
  }
  console.log('');

  // ------------------------------------------------- four roles, four stacked lines
  console.log('=== all four roles at once ===');
  const skills = ensureSkills(champion.skills ?? []);
  for (let role = 0; role < 4; role++) skills[role].experience = experienceForMastery(role + 2);
  champion.skills = skills;
  const fourPixels = renderPanel();
  for (let role = 0; role < 4; role++) {
    const expected = `${MASTERY_LABELS[role + 2]} ${ROLES[role]}`;
    const got = lineStrip(fourPixels, role, expected.length);
    const want = expectedStrip(font, role, expected, true);
    console.log([`line ${role}`, expected, got === want ? 'ok' : 'MISMATCH'].join('\t'));
    check(got === want, `line ${role} is "${expected}", seven pixels below the last`);
  }
  console.log('');

  // --------------------------------------------------------- the 0x8000 in the call
  console.log('=== 0x8000: a temporary adjustment must not move the printed rank ===');
  // Mastery 3 earned, plus enough tempAdjust to reach mastery 5 if it counted.
  setRoleExperience(1, experienceForMastery(3), experienceForMastery(5));
  const earned = determineMastery(champion, 1 | 0x8000);
  const withTemp = determineMastery(champion, 1);
  console.log(`earned rank = ${earned} (${MASTERY_LABELS[earned]}), `
    + `rank with the adjustment = ${withTemp} (${MASTERY_LABELS[withTemp]})`);
  check(withTemp > earned, 'the adjustment really would change the rank if it were counted');
  const tempPixels = renderPanel();
  const earnedLine = `${MASTERY_LABELS[earned]} ${ROLES[1]}`;
  check(lineStrip(tempPixels, 0, earnedLine.length) === expectedStrip(font, 0, earnedLine, true),
    'the panel prints the earned rank, not the adjusted one');
  console.log('');

  // ------------------------------------------- the canary for drawTextLineIndexRaw
  console.log('=== the rune ranks are not their upper-cased selves ===');
  console.log(['rank', 'raw', 'upper-cased', 'differ'].join('\t'));
  for (let mastery = 10; mastery <= 15; mastery++) {
    const label = MASTERY_LABELS[mastery] ?? '';
    const raw = expectedStrip(font, 0, label, true);
    const upper = expectedStrip(font, 0, label, false);
    const differ = raw !== upper;
    console.log([label, /[^0]/.test(raw) ? 'drawn' : 'BLANK', /[^0]/.test(upper) ? 'drawn' : 'BLANK',
      differ ? 'yes' : 'NO'].join('\t'));
    // `` ` `` upper-cases to itself, so only 'a'..'e' can prove the point — but every one
    // of them must, or the rune glyph is being lost to `toUpperCase()`.
    if (mastery > 10) {
      check(differ, `"${label}" needs the raw text path — upper-casing changes its glyphs`);
    }
  }

  // ------------------------------------- the eye over a Hall of Champions candidate
  // `TAG0189d4` puts the Resurrect / Reincarnate menu where the panel goes
  // (`doc/CSBwin-src/Character.cpp:3856`), but the eye is button 71 and has no
  // `PotentialCharacterOrdinal` gate (`doc/CSBwin-src/Mouse.cpp:1659-1664`): `_ClickOnEye`
  // draws the panel over the menu (`doc/CSBwin-src/Viewport.cpp:7257`) and leaves
  // `d.DisplayResurrectChestOrScroll` at 5; `QuitPressingEye` calls `TAG0189d4` again
  // (`doc/CSBwin-src/CSBCode.cpp:7399`). So this needs the whole inventory drawn, with
  // graphic 40 really there to cover the panel.
  console.log('=== the eye held over a candidate\'s Resurrect menu ===');
  const cache = new Map();
  ui.getGraphicBitmap = (n, format) => getCachedGraphicBitmap(graphics, cache, n, format);
  setRoleExperience(0, experienceForMastery(4));
  const candidateLine = `${MASTERY_LABELS[4]} ${ROLES[0]}`;
  function renderInventory(): Uint8Array {
    const buffer = createPaletteIndexViewportBuffer(SCREEN_W, SCREEN_H, 0);
    ui.screenIndexBuffer = buffer;
    drawInventoryScreen(ui);
    return buffer.pixels;
  }
  // The reference: the same champion, already in the party, eye held. The text lands on
  // graphic 20, the panel's own background, so a line drawn on zeros would not match.
  ui.pressingEye = true;
  const wantLine = lineStrip(renderInventory(), 0, candidateLine.length);
  check(/[^0]/.test(wantLine), 'the reference panel is drawn');
  party.state.potentialChampionIndex = 0;
  ui.pressingEye = false;
  const menuPixels = renderInventory();
  const menuLine = lineStrip(menuPixels, 0, candidateLine.length);
  console.log(`eye released: menu state ${ui.displayResurrectChestOrScroll}, `
    + `mastery line ${menuLine === wantLine ? 'drawn' : 'covered by the menu'}`);
  check(ui.displayResurrectChestOrScroll === 5, 'a candidate\'s inventory shows the Resurrect menu');
  check(menuLine !== wantLine, 'the menu, not the panel, is on the mastery line');
  ui.pressingEye = true;
  const eyePixels = renderInventory();
  const eyeLine = lineStrip(eyePixels, 0, candidateLine.length);
  console.log(`eye held:     menu state ${ui.displayResurrectChestOrScroll}, `
    + `mastery line ${eyeLine === wantLine ? 'drawn' : 'covered by the menu'}`);
  check(eyeLine === wantLine, `the held eye shows "${candidateLine}" over the menu`);
  check(ui.displayResurrectChestOrScroll === 5, '_ClickOnEye leaves DisplayResurrectChestOrScroll at 5');
  ui.pressingEye = false;
  renderInventory();
  check(ui.displayResurrectChestOrScroll === 5, 'releasing the eye brings the menu back');
  party.state.potentialChampionIndex = -1;
  console.log('');

  // ------------------------------------------ a potion's power, as a rune before its name
  // `doc/CSBwin-src/Character.cpp:3599-3615`: once the selected champion is past mastery 1
  // as a priest, the object panel prefixes a potion's name with the character
  // `95 + strength()/40` — `` ` `` and `a`..`e`, the six power-rune glyphs — and prints
  // the lot with `TextToViewport(134, 68, COLOR_13, …)`. The same raw-text trap as the
  // rune ranks above: upper-cased, UM and ON come out as 'A' and 'B'.
  console.log('=== a potion\'s power rune on the object panel ===');
  const NAME_X = VIEWPORT_X + 134;
  const NAME_Y = VIEWPORT_Y + 68;
  const PRIEST = 2;
  /** Each character cell of the name line, as the five-bit rows lit in colour 13. */
  function nameCells(pixels: Uint8Array, count: number): string[] {
    const cells: string[] = [];
    for (let i = 0; i < count; i++) {
      const rows: number[] = [];
      for (let row = 0; row < GLYPH_ROWS; row++) {
        let bits = 0;
        for (let col = 0; col < 5; col++) {
          const px = pixels[(NAME_Y + GLYPH_TOP + row) * SCREEN_W + NAME_X + GLYPH_W * i + col];
          if (px === 13) bits |= 0x10 >> col;
        }
        rows.push(bits);
      }
      cells.push(rows.join(','));
    }
    return cells;
  }
  /** The same rows, straight out of the font for `code`. */
  function fontCell(code: number): string {
    const rows: number[] = [];
    for (let row = 0; row < GLYPH_ROWS; row++) rows.push((font.bytes[code + row * 128] ?? 0) & 0x1f);
    return rows.join(',');
  }

  let potionId: ObjectID = OBJECT_ID_NULL;
  let potionNameIndex = -1;
  const potionRecords = data.databases.potions.records;
  for (let i = 0; i < potionRecords.length; i++) {
    const id = game.ctx.dungeon.rnMaps.setPos(game.ctx.dungeon.rnMaps.rn(DBType.POTION, i), TilePosition.NORTH);
    const nameIndex = resolveObjectNameIndex(ui, id);
    if (nameIndex >= 0 && nameIndex !== OBJNI_WATER_FLASK && nameIndex !== OBJNI_EMPTY_FLASK) {
      potionId = id;
      potionNameIndex = nameIndex;
      break;
    }
  }
  check(potionNameIndex >= 0, 'dungeon.dat holds a potion that is neither water nor an empty flask');
  const potion = ui.ctx.dungeon.getPotionRecord(potionId);
  if (!potion) throw new Error('no potion record');
  const savedPower = potion.power;
  const potionName = getObjectName(ui, potionNameIndex);
  function renderObjectPanel(): Uint8Array {
    const buffer = createPaletteIndexViewportBuffer(SCREEN_W, SCREEN_H, 0);
    ui.screenIndexBuffer = buffer;
    drawObjectInfoPanel(ui, potionId);
    return buffer.pixels;
  }

  // Mastery 1 as a priest: the plain name.
  setRoleExperience(PRIEST, 0);
  potion.power = 120;
  check(getObjectDisplayName(ui, potionId, potionNameIndex) === potionName,
    'a champion at priest mastery 1 sees no power rune');
  // A neophyte priest (mastery 2) sees it.
  setRoleExperience(PRIEST, experienceForMastery(2));
  check(determineMastery(champion, PRIEST) === 2, 'the champion is a neophyte priest');

  console.log(['power', 'code', 'rune drawn', 'name drawn', 'upper-cased would differ'].join('\t'));
  for (const power of [20, 60, 100, 140, 180, 220, 250]) {
    potion.power = power;
    const code = 95 + Math.floor(power / 40);
    const expected = `${String.fromCharCode(code)} ${potionName}`;
    check(getObjectDisplayName(ui, potionId, potionNameIndex) === expected,
      `power ${power} names the potion "${expected}"`);
    const cells = nameCells(renderObjectPanel(), expected.length);
    const runeOk = cells[0] === fontCell(code);
    const nameOk = [...expected].every((ch, i) => cells[i] === fontCell(ch.charCodeAt(0) & 0x7f));
    const upperDiffers = fontCell(String.fromCharCode(code).toUpperCase().charCodeAt(0)) !== fontCell(code);
    console.log([power, code, runeOk ? 'yes' : 'NO', nameOk ? 'yes' : 'NO', upperDiffers ? 'yes' : 'no'].join('\t'));
    check(runeOk, `power ${power} draws glyph 0x${code.toString(16)}, not its upper-cased self`);
    check(nameOk, `power ${power} draws "${expected}" glyph for glyph at (134, 68)`);
  }
  potion.power = savedPower;
  console.log('');

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
