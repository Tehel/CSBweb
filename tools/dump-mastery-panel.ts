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
 * What to look for in the output: a line for every role whose mastery exceeds 1, at
 * x=108 / y=58+7n in viewport coordinates, matching the string spelled out here
 * independently; nothing on those rows for a champion with no experience; and the rune
 * ranks differing from their upper-cased selves.
 *
 * Run: `npx tsx tools/dump-mastery-panel.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, Position } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party } from '../src/engine/Party';
import { CharacterStats } from '../src/engine/CharacterStats';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import type { Champion } from '../src/engine/gameTypes';
import { ensureSkills, determineMastery } from '../src/engine/skills';
import { createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { drawTextLineIndex, drawTextLineIndexRaw, loadFontData } from '../src/renderer/csbwin/TextRenderer';
import type { FontData } from '../src/renderer/csbwin/TextRenderer';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { VIEWPORT_X, VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { MASTERY_LABELS, drawAttributePanel } from '../src/renderer/ui/Character';
import { newContext } from './lib/game';
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
  const uiTables = extractUITables(graphics);
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
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
  const heroes = (data.presetHeroes ?? []).filter((h) => (h.inventory?.length ?? 0) > 0);
  if (heroes.length < 1) throw new Error('dungeon.dat carries no equipped preset hero');
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescCarryMask: objectTables.objDescCarryMask,
  };
  const champion: Champion = createChampionFromPreset(
    heroes[0],
    0,
    assignPresetHeroPossessions(heroes[0].inventory, addTables),
  );
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  party.addChampion(champion);
  party.state.selectedCharacterIndex = 0;

  const dungeon = new DungeonState(data);
  const ui: UIState = createUIState(graphics, dungeon, {
    getGraphicBitmap: () => null,
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.objectTables = objectTables;
  ui.fontData = font;
  ui.partyState = party.state;
  ui.characterStats = new CharacterStats(newContext(data, graphics, { dungeon, party, random: new CsbRandom(0x12345678) }));

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

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
