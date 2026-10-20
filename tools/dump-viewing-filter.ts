/**
 * The viewing filter at `DescribeObject`'s two sites, with two DSAs on its square, run
 * through `DsaSystem.processViewingFilter` against a genuine save (`csbgame7.dat`).
 *
 * 1. **Every DSA at the location runs** (`doc/CSBwin-src/Character.cpp:3490-3532`,
 *    `:3753-3787`): each loop goes on with `continue`, a filter call apiece, the second
 *    DSA after the first.
 * 2. **The description's parameter 0 is the phrase mask as it stands** (`:3779`): the
 *    second DSA sees the bit the first one's `&DESCRIBE` cleared (`ModifyDescription`,
 *    `:3814-3847`).
 * 3. **No parameter comes back into the mask**: a DSA that stores into parameter 0, with
 *    no `&DESCRIBE`, leaves the mask as it was (`:3783-3787` read nothing back).
 * 4. **At the scroll site, an object a DSA leaves in parameter 1 becomes the loop's own**
 *    (`:3523-3532`), and the loop goes on down that object's chain. The scroll it was
 *    given is such an object, so a DSA after the first runs only when the first stores an
 *    invalid object there; it then sees parameter 0 as 0 (`:3516`), whatever a
 *    `&DESCRIBE` did, and the scroll drawn is the one given.
 * 5. **A scroll a DSA names is the one drawn**, and the loop goes on down its chain.
 * 6. **`&DESCRIBE` with a location sets the phrase from every text at it** whose corner
 *    matches (`ModifyDescription`, `:3833-3847`), so the last wins, a hidden one and an
 *    empty one included, each read by `GetText` (`doc/CSBwin-src/AsciiDump.cpp:362-456`).
 * 7. **`GetText` is `DecodeText` at type `0x8001`** (`doc/CSBwin-src/CSBCode.cpp:5552-5733`),
 *    before its substitution, on every text in use in `dm-atari` and Conflux, but for the line
 *    feed `DecodeText` puts in front and code 28: `/` to `GetText`, a space to
 *    `DecodeText`, or a line feed in place of that space for a second one in a row.
 *
 * 8. **The eye clicked with an empty hand runs it too** (`TAG019036`,
 *    `doc/CSBwin-src/Character.cpp:4541-4595`, from `_ClickOnEye`, `Viewport.cpp:7264-7297`):
 *    every DSA at the location, each seeing parameter 0 as 0, the object as -1 and the
 *    champion whose inventory is open. Once a press: a second press while the eye is held
 *    runs nothing, and the next press after the release runs it again. With an object in
 *    hand the eye describes it instead, and this site runs nothing: the DSA sees the
 *    object, which the description's site passes.
 * 9. **With an object in hand it runs once a press, at the press** (`DescribeObject`, from
 *    `_ClickOnEye`, `Viewport.cpp:7293`): CSBWin draws the description or the scroll once,
 *    so the inventory composed again and again while the eye is held runs no DSA, and the
 *    next press after the release runs it again.
 * 10. **A scroll in the weapon hand of the inventory open is read** (`TAG0189d4`,
 *    `doc/CSBwin-src/Character.cpp:3866-3914`), in the scroll's site, at the events that
 *    draw that panel: the inventory's opening (`ShowHideInventory`,
 *    `doc/CSBwin-src/CSBCode.cpp:7563-7573`), the scroll entering the hand
 *    (`AddCharacterPossession`, `Character.cpp:2002-2009`), and the eye's release
 *    (`QuitPressingEye`, `CSBCode.cpp:7458-7473`); not at a compose, not with the
 *    inventory closed, and not at the ten-second update while the scroll shows
 *    (`doc/CSBwin-src/Code17818.cpp:435-443`). With the eye held and an empty hand, the
 *    ten-second update and poison run the eye's own site again (`Character.cpp:1483-1502`,
 *    `CSBCode.cpp:7279-7284`). In that hand the scroll is drawn rolled
 *    (`DisplayBackpackItem`, `Character.cpp:1188-1194`).
 * 11. **The mouth held with an empty hand shows food and water over the scroll**
 *    (`_FeedCharacter`, `doc/CSBwin-src/Character.cpp:4058-4075`), and runs nothing;
 *    `d.DisplayResurrectChestOrScroll` stays 2. While it is held the ten-second update
 *    draws food and water again (`Character.cpp:1483-1486`, `Code17818.cpp:435-443`) and
 *    the inventory will not close (`CSBCode.cpp:7498`); the release is `QuitPressingMouth`
 *    (`CSBCode.cpp:7449-7454`), whose `TAG0189d4` reads the scroll again. With food and
 *    water already shown, the mouth is not held.
 * 12. **The held eye and mouth hide the pointer** until the release: `STHideCursor(HC47)`
 *    in `_ClickOnEye` (`doc/CSBwin-src/Viewport.cpp:7282`) and `STShowCursor(HC47)` in
 *    `QuitPressingEye` (`doc/CSBwin-src/CSBCode.cpp:7472`); `HC5` for the mouth
 *    (`Character.cpp:4071-4072`, `CSBCode.cpp:7454`). The hide count `d.Word23118` is
 *    back to 0 after each (`doc/CSBwin-src/Mouse.cpp:1957-2002`).
 * 13. **A champion's death lets go of the held eye or mouth** when their inventory is
 *    open, and closes it (`KillCharacter`, `Character.cpp:2602-2627`): the pointer is
 *    back, and the buttons after 81 are not swallowed any more.
 * 14. **The eye held over an object clears the held object's name** (`ClearHeldObjectName`,
 *    `doc/CSBwin-src/Viewport.cpp:7291`: `wRectPos624` filled with colour 0,
 *    `:3313-3323`), and the release draws it again (`QuitPressingEye`,
 *    `doc/CSBwin-src/CSBCode.cpp:7468-7471`).
 *
 * Run: `npm test -- --only=dump-viewing-filter.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, locationRelToInteger, type ObjectID } from '../src/core/types';
import { DecodeText, GetText } from '../src/data/DecodeText';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { StkOp, ViewingFilterSite, type ViewingFilterResult } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';
import { gameTablesOf, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { drawCursorItem, handleInventoryToggle, handleMouseButton, handleMouseUnclick, releaseEyeOrMouth } from '../src/renderer/ui/Mouse';
import { drawCharacterStateEyePanel, drawInventoryScreen, getInventorySlotRect } from '../src/renderer/ui/Inventory';
import { drawObjectIcon } from '../src/renderer/ui/Draw';
import { drawHeldObjectName } from '../src/renderer/ui/Character';
import { VIEWPORT_X, VIEWPORT_Y, getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import type { UIState } from '../src/renderer/ui/UIState';
import { OBJNI_OPEN_SCROLL, OBJNI_SCROLL } from '../src/core/objectNameIndex';
import { tenSecondUpdate } from '../src/engine/PeriodicUpdates';

/** `ESL_VIEWINGFILTER` (`doc/CSBwin-src/CSB.h:1541`). */
const ESL_VIEWINGFILTER = 3;

/** Parameters 0 and 1 into globals `to` and `to + 1`. */
const params = (to: number): number[] => [
  ...int(2), ...int(10), op(StkOp.PARAM_FETCH), varFetch(10), globalStore(to), varFetch(11), globalStore(to + 1),
];
/** `&DESCRIBE`: phrase `index` enabled (`locr` -1) or disabled (-2), in `color`. */
const describe = (locr: number, index: number, color: number): number[] =>
  [...int(locr), ...int(index), ...int(color), op(StkOp.DESCRIBE)];
/**
 * `value` into parameter `index`: `&PARAM!` copies variables 0 to `index` into the
 * parameters from 0 (`doc/CSBwin-src/DSA.cpp:3001-3021`), and the ones left undefined
 * keep their parameters.
 */
const paramStore = (index: number, value: number): number[] =>
  [...int(value), varStore(index), ...int(index + 1), ...int(0), op(StkOp.PARAM_STORE)];

/** A game whose viewing filter's square holds one DSA per program, in order. */
const withFilter = (programs: number[][]): Game => withFilterDsas(ESL_VIEWINGFILTER, programs);

function view(game: Game, site: ViewingFilterSite, phraseMask: number, objectId: ObjectID): ViewingFilterResult | null {
  return game.systems.dsa.processViewingFilter({ site, phraseMask, objectId, selectedCharacter: 0 });
}

const hex = (n: number): string => `0x${(n >>> 0).toString(16)}`;

/* ------------------------------- 1, 2. the description, two DSAs ---------------- */
{
  const game = withFilter([
    [...params(0), ...describe(-2, 0, 5)],
    [...params(10)],
  ]);
  const object = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0);
  const result = view(game, ViewingFilterSite.DESCRIPTION, 0x4f, object);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`1. the first DSA sees mask ${hex(g[0])} and object ${g[1]}; the second `
    + `${g[10] === UNSET ? 'does not run' : `sees mask ${hex(g[10])} and object ${g[11]}`}; `
    + `the mask is ${hex(result?.phraseMask ?? -1)}, phrase 0's colour ${result?.phraseColorOverrides[0]}`);
  check(g[0] === 0x4f && g[1] === object, 'the first DSA sees the mask and the object given');
  check(g[10] !== UNSET, 'the second DSA at the location runs too');
  check(g[10] === 0x4e && g[11] === object, "2. the second sees the mask as the first one's &DESCRIBE left it");
  check(result?.phraseMask === 0x4e && result.phraseColorOverrides[0] === 5, "the description takes &DESCRIBE's mask and colour");
}

/* ------------------------------- 3. no parameter comes back --------------------- */
{
  const game = withFilter([[...paramStore(0, 0x1234)]]);
  const result = view(game, ViewingFilterSite.DESCRIPTION, 0x4f, game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0));
  console.log(`3. a DSA stores ${hex(0x1234)} into parameter 0, with no &DESCRIBE: the mask is ${hex(result?.phraseMask ?? -1)}`);
  check(result?.phraseMask === 0x4f, 'the mask is the one given, parameter 0 read nowhere');
}

/* ------------------------------- 4, 5. the scroll ------------------------------- */
{
  const scrollSite = (first: number[]): { g: number[]; drawn: number | undefined; scroll: ObjectID } => {
    const game = withFilter([[...params(0), ...first], [...params(10)]]);
    const scroll = game.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0);
    const result = view(game, ViewingFilterSite.SCROLL, 0, scroll);
    return { g: game.systems.dsa.getGlobalVariables(), drawn: result?.objectId, scroll };
  };
  const kept = scrollSite([]);
  console.log(`4. at the scroll, the first DSA sees parameter 0 ${kept.g[0]} and object ${kept.g[1]}, `
    + `leaves it, and the second ${kept.g[10] === UNSET ? 'does not run' : 'runs'}`);
  check(kept.g[0] === 0 && kept.g[1] === kept.scroll, 'the first DSA sees parameter 0 as 0, and the scroll');
  check(kept.g[10] === UNSET, "the loop goes on down the scroll's chain, and the second DSA does not run");
  check(kept.drawn === kept.scroll, 'the scroll drawn is the one given');
  const cleared = scrollSite([...describe(-1, 0, 5), ...paramStore(1, 0)]);
  console.log(`   when the first stores object 0 and enables phrase 0, the second sees parameter 0 `
    + `${cleared.g[10]}, and the scroll drawn is ${cleared.drawn} of ${cleared.scroll}`);
  check(cleared.g[10] === 0, "the second DSA runs, and sees parameter 0 as 0, whatever the first one's &DESCRIBE did");
  check(cleared.drawn === cleared.scroll, 'with no valid object named, the scroll drawn is the one given');
}
{
  const probe = freshGame();
  const scrolls = probe.ctx.dungeon.getData().databases.scrolls.records.length;
  const given = probe.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0);
  let named = OBJECT_ID_EOF as ObjectID;
  for (let i = 1; i < scrolls && named === OBJECT_ID_EOF; i++) {
    const rn = probe.ctx.dungeon.rnMaps.rn(DBType.SCROLL, i);
    if (probe.ctx.dungeon.getScrollRecord(rn) && probe.ctx.dungeon.getDBRecordLink(rn) === OBJECT_ID_EOF) named = rn;
  }
  if (named === OBJECT_ID_EOF) throw new Error('no scroll that ends its chain');
  const game = withFilter([
    [...params(0), ...paramStore(1, named)],
    [...params(10)],
  ]);
  const result = view(game, ViewingFilterSite.SCROLL, 0, given);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`5. the first DSA names scroll ${named}, which ends its chain: the scroll drawn is `
    + `${result?.objectId}, and the second DSA ${g[10] === UNSET ? 'does not run' : 'runs'}`);
  check(result?.objectId === named, 'the scroll a DSA names is the one drawn');
  check(g[10] === UNSET, "the loop goes on down the named scroll's chain, and the second DSA does not run");
}

/* ------------------------------- 6. &DESCRIBE's custom phrase ------------------- */
{
  /** `s` as a text record at corner `p` of `at`: its codes three to a word, ended by 31. */
  const addText = (game: Game, at: Position, p: number, s: string, visible: boolean): void => {
    const dungeon = game.ctx.dungeon;
    const data = dungeon.getData();
    const words = data.compressedText;
    const indirect = data.indirectTextIndex;
    if (!words || !indirect) throw new Error('the save holds no indirect text');
    const codes = [...s].map((c) => (c === ' ' ? 26 : c === '.' ? 27 : c === '/' ? 28 : c.charCodeAt(0) - 65));
    codes.push(31);
    while (codes.length % 3 !== 0) codes.push(31);
    indirect.push(words.length);
    for (let i = 0; i < codes.length; i += 3) words.push((codes[i]! << 10) | (codes[i + 1]! << 5) | codes[i + 2]!);
    const texts = data.databases.texts.records;
    texts.push({ nextObject: OBJECT_ID_EOF, textOffset: indirect.length - 1, visible });
    dungeon.addObjectToCell(at, dungeon.rnMaps.setPos(dungeon.rnMaps.rn(DBType.TEXT, texts.length - 1), p));
  };
  // The texts go on the last empty open square of the party's level; the filter's is the first.
  const probe = freshGame();
  const z = probe.ctx.party.state.position.z;
  const map = probe.ctx.dungeon.getMap(z)!;
  let at: Position | null = null;
  for (let x = map.descriptor.width - 1; x >= 0 && !at; x--) {
    for (let y = map.descriptor.height - 1; y >= 0 && !at; y--) {
      const p = new Position(x, y, z);
      if (((probe.ctx.dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
      if (probe.ctx.dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
      at = p;
    }
  }
  if (!at) throw new Error('no empty open square');
  const locr = (p: number): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p });
  const game = withFilter([[...describe(locr(1), 2, 9), ...describe(locr(2), 3, 9)]]);
  addText(game, at, 0, 'ANOTHER CORNER', true);
  addText(game, at, 1, 'FIRST', true);
  addText(game, at, 2, '', true);
  addText(game, at, 1, 'HIDDEN/LAST', false);
  const result = view(game, ViewingFilterSite.DESCRIPTION, 0x43, game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0));
  const phrases = result?.phraseTextOverrides ?? [];
  console.log(`6. texts at corner 1 "FIRST" then a hidden "HIDDEN/LAST", at corner 2 an empty one: `
    + `phrase 2 is ${JSON.stringify(phrases[2])}, phrase 3 ${JSON.stringify(phrases[3])}, the mask ${hex(result?.phraseMask ?? -1)}`);
  check(phrases[2] === 'HIDDEN/LAST', "the corner's last text wins, hidden or not, code 28 read as '/', no line feed in front");
  check(phrases[3] === '' && ((result?.phraseMask ?? 0) & 0x0c) === 0x0c, 'an empty text enables its phrase, empty');
}

/* ------------------------------- 7. GetText against DecodeText ------------------ */
{
  const tables = gameTablesOf(stockGraphics()).textDecode;
  for (const name of ['dm-atari', 'conflux-3.5-b8']) {
    const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`static/gamefiles/${name}/dungeon.dat`)));
    // A free record, linked to `RNnul`, keeps the index `ConvertToIndirectText` skipped.
    const records = data.databases.texts.records.filter((r) => r.nextObject !== OBJECT_ID_NULL);
    let same = 0;
    let slashes = 0;
    for (const record of records) {
      const got = GetText(data, record.textOffset, tables);
      // What `DecodeText` makes of the same codes: a line feed first, and code 28 a space,
      // or a line feed in its place for the second in a row.
      const want: number[] = [10];
      let run = 0;
      for (const c of got) {
        run = c === '/' ? run + 1 : 0;
        if (c !== '/') want.push(c.charCodeAt(0));
        else if (run === 2) want[want.length - 1] = 10;
        else want.push(32);
      }
      want.push(0);
      const decoded = DecodeText(data, record, 0x8001, 990, tables);
      if (decoded && decoded.join() === want.join()) same++;
      if (got.includes('/')) slashes++;
    }
    console.log(`7. ${name}: ${same} of ${records.length} texts, ${slashes} with code 28, read by GetText as DecodeText reads them`);
    check(same === records.length && records.length > 0, `every text in use in ${name} reads by GetText as by DecodeText`);
  }
}

/* ------------------------------- 8. the eye with an empty hand ----------------- */
{
  /** Parameters 0 to 2 into globals `to` to `to + 2`. */
  const params3 = (to: number): number[] => [
    ...int(3), ...int(10), op(StkOp.PARAM_FETCH),
    varFetch(10), globalStore(to), varFetch(11), globalStore(to + 1), varFetch(12), globalStore(to + 2),
  ];
  const game = withFilter([[...params3(0), ...describe(-1, 0, 5)], [...params3(10)]]);
  const party = game.ctx.party.state;
  const ui = newUIState(stockGraphics(), game.ctx);
  party.selectedCharacterIndex = 1;
  party.objectInHand = OBJECT_ID_NULL;
  const unset = (): void => {
    const g = game.systems.dsa.getGlobalVariables();
    for (const i of [0, 1, 2, 10, 11, 12]) g[i] = UNSET;
    game.systems.dsa.setGlobalVariables(g);
  };
  const ran = (): boolean => game.systems.dsa.getGlobalVariables()[0] !== UNSET;

  unset();
  handleMouseButton(ui, 71, 0, 0);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`8. the eye clicked with an empty hand: the first DSA sees ${hex(g[0])}, ${g[1]}, ${g[2]}; `
    + `the second ${g[10] === UNSET ? 'does not run' : `sees ${hex(g[10])}, ${g[11]}, ${g[12]}`}`);
  check(g[0] === 0 && g[1] === -1 && g[2] === 1,
    'the first DSA sees phrase mask 0, object -1 and the champion whose inventory is open');
  check(g[10] === 0 && g[11] === -1 && g[12] === 1,
    "the second runs too, and sees parameter 0 as 0 whatever the first one's &DESCRIBE did");
  unset();
  handleMouseButton(ui, 71, 0, 0);
  const again = ran();
  handleMouseUnclick(ui);
  handleMouseButton(ui, 71, 0, 0);
  const afterRelease = ran();
  handleMouseUnclick(ui);
  console.log(`   a second press while held ${again ? 'runs it' : 'runs nothing'}; `
    + `a press after the release ${afterRelease ? 'runs it' : 'runs nothing'}`);
  check(!again, 'a press while the eye is held runs nothing (_ClickOnEye returns on d.PressingEye)');
  check(afterRelease, 'the next press after the release runs it again');
  unset();
  party.objectInHand = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0);
  handleMouseButton(ui, 71, 0, 0);
  handleMouseUnclick(ui);
  // The description's site runs instead (section 9), and passes the object, not -1.
  const seen = game.systems.dsa.getGlobalVariables()[1];
  console.log(`   with an object in hand the DSA sees object ${seen}: the eye's own site ${seen === -1 ? 'runs' : 'runs nothing'}`);
  check(seen === party.objectInHand, 'with an object in hand, TAG019036 does not run, and the description sees the object');
}

/* ------------------------------- 9. the eye with an object in hand -------------- */
{
  const game = withFilter([[...params(0)]]);
  const party = game.ctx.party.state;
  const ui = newUIState(stockGraphics(), game.ctx);
  party.selectedCharacterIndex = 1;
  const unset = (): void => {
    const g = game.systems.dsa.getGlobalVariables();
    g[0] = UNSET;
    game.systems.dsa.setGlobalVariables(g);
  };
  const ran = (): boolean => game.systems.dsa.getGlobalVariables()[0] !== UNSET;
  for (const [what, inHand] of [
    ['a weapon', game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0)],
    ['a scroll', game.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0)],
  ] as const) {
    party.objectInHand = inHand;
    unset();
    handleMouseButton(ui, 71, 0, 0);
    const atPress = ran();
    unset();
    for (let i = 0; i < 3; i++) drawInventoryScreen(ui);
    const atCompose = ran();
    handleMouseUnclick(ui);
    unset();
    handleMouseButton(ui, 71, 0, 0);
    const again = ran();
    handleMouseUnclick(ui);
    console.log(`9. ${what} in hand: the press ${atPress ? 'runs it' : 'runs nothing'}, three composes `
      + `while held ${atCompose ? 'run it' : 'run nothing'}, the next press ${again ? 'runs it' : 'runs nothing'}`);
    check(atPress, `with ${what} in hand, the press runs the viewing filter`);
    check(!atCompose, `with ${what} in hand, composing the held eye's panel runs no DSA`);
    check(again, `with ${what} in hand, the next press after the release runs it again`);
  }
}

/* ------------------------------- 10. the scroll in the weapon hand -------------- */
{
  // The host's three members are the screen's, as `main.ts` wires them.
  let ui: UIState | null = null;
  const game = withFilterDsas(ESL_VIEWINGFILTER, [[...params(0)]], {
    drawCharacterState: (chIdx, charFlags) => { if (ui) drawCharacterStateEyePanel(ui, chIdx, charFlags); },
    pressingEye: () => ui?.pressingEye ?? false,
    displayResurrectChestOrScroll: () => ui?.displayResurrectChestOrScroll ?? 0,
  });
  const party = game.ctx.party.state;
  const graphics = stockGraphics();
  const cache = new Map();
  const theUi = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui = theUi;
  party.selectedCharacterIndex = -1;
  party.objectInHand = OBJECT_ID_NULL;
  const character = game.systems.character;
  character.removeCharacterPossession(1, 1);
  const scroll = game.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0);
  const unset = (): void => {
    const g = game.systems.dsa.getGlobalVariables();
    g[0] = UNSET;
    g[1] = UNSET;
    game.systems.dsa.setGlobalVariables(g);
  };
  /** The object the filter ran on, -1 at the eye's own site, or null when it did not run. */
  const seen = (): number | null => {
    const g = game.systems.dsa.getGlobalVariables();
    return g[0] === UNSET ? null : g[1]!;
  };
  const step = (what: string, act: () => void, want: number | null): void => {
    unset();
    act();
    const got = seen();
    console.log(`10. ${what}: ${got === null ? 'runs nothing' : got === -1 ? "runs the eye's site" : `runs on ${got}`}`);
    check(got === want, `${what}: ${want === null ? 'runs nothing' : want === -1 ? "the eye's site" : 'the scroll site, on the scroll'}`);
  };

  step('the scroll into a closed inventory\'s weapon hand', () => character.addCharacterPossession(1, scroll, 1), null);
  step('the inventory opened', () => handleInventoryToggle(theUi, 1), scroll);
  step('three composes', () => { for (let i = 0; i < 3; i++) drawInventoryScreen(theUi); }, null);
  check(theUi.displayResurrectChestOrScroll === 2, 'a scroll in the weapon hand leaves d.DisplayResurrectChestOrScroll 2');
  step('the ten-second update with the scroll shown', () => tenSecondUpdate(game.ctx), null);
  step('the eye pressed with an empty hand', () => handleMouseButton(theUi, 71, 0, 0), -1);
  step('the ten-second update with the eye held', () => tenSecondUpdate(game.ctx), -1);
  step('the eye released', () => handleMouseUnclick(theUi), scroll);
  step('the scroll out of the weapon hand', () => character.removeCharacterPossession(1, 1), null);
  check(theUi.weaponHandScroll === null, 'with the hand empty, nothing is kept');
  drawInventoryScreen(theUi);
  check(theUi.displayResurrectChestOrScroll === 0, 'with the hand empty, the panel is food and water');
  handleMouseButton(theUi, 71, 0, 0);
  step('poison with the eye held and food and water shown', () => game.systems.monsterAttack.poisonCharacter(1, 1), -1);
  handleMouseUnclick(theUi);
  step('the scroll back into the open inventory\'s weapon hand', () => character.addCharacterPossession(1, scroll, 1), scroll);

  // The icon: the slot drawn alone on a cleared screen is the rolled scroll's.
  const rect = getInventorySlotRect(theUi.uiTables.graphic232.iconDisplay, 1)!;
  const word612 = theUi.uiTables.graphic232.word612;
  const pixels = theUi.screenIndexBuffer.pixels;
  const slotPixels = (draw: () => void): string => {
    pixels.fill(0);
    draw();
    const out: number[] = [];
    for (let y = rect.y1; y <= rect.y2; y++) for (let x = rect.x1; x <= rect.x2; x++) out.push(pixels[y * 320 + x]!);
    return out.join();
  };
  const drawn = slotPixels(() => drawInventoryScreen(theUi));
  const rolled = slotPixels(() => drawObjectIcon(theUi, rect, OBJNI_SCROLL, word612));
  const unrolled = slotPixels(() => drawObjectIcon(theUi, rect, OBJNI_OPEN_SCROLL, word612));
  const blank = slotPixels(() => {});
  console.log(`    the weapon hand's icon is the ${drawn === rolled ? 'rolled' : drawn === unrolled ? 'unrolled' : 'unknown'} scroll`);
  check(rolled !== unrolled && rolled !== blank && drawn === rolled, "in the open inventory's weapon hand, the open scroll is drawn rolled");
}

/* ------------------------------- 11. the mouth held with an empty hand ---------- */
{
  let ui: UIState | null = null;
  const game = withFilterDsas(ESL_VIEWINGFILTER, [[...params(0)]], {
    drawCharacterState: (chIdx, charFlags) => { if (ui) drawCharacterStateEyePanel(ui, chIdx, charFlags); },
    pressingEye: () => ui?.pressingEye ?? false,
    pressingMouth: () => ui?.pressingMouth ?? false,
    displayResurrectChestOrScroll: () => ui?.displayResurrectChestOrScroll ?? 0,
  });
  const party = game.ctx.party.state;
  const graphics = stockGraphics();
  const cache = new Map();
  const theUi = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui = theUi;
  party.selectedCharacterIndex = -1;
  party.objectInHand = OBJECT_ID_NULL;
  const character = game.systems.character;
  character.removeCharacterPossession(1, 1);
  const scroll = game.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0);
  handleInventoryToggle(theUi, 1);
  const g = (): number[] => game.systems.dsa.getGlobalVariables();
  const unset = (): void => {
    const v = g();
    v[0] = UNSET;
    v[1] = UNSET;
    game.systems.dsa.setGlobalVariables(v);
  };
  const seen = (): number | null => (g()[0] === UNSET ? null : g()[1]!);
  // The eye panel's pixels, `wRectPos926` in the viewport.
  const r = theUi.uiTables.graphic232.wRectPos926;
  const pixels = theUi.screenIndexBuffer.pixels;
  const panel = (draw: () => void): string => {
    pixels.fill(0);
    draw();
    const out: number[] = [];
    for (let y = r.y1 + VIEWPORT_Y; y <= r.y2 + VIEWPORT_Y; y++) {
      for (let x = r.x1 + VIEWPORT_X; x <= r.x2 + VIEWPORT_X; x++) out.push(pixels[y * 320 + x]!);
    }
    return out.join();
  };
  // Food and water as an empty weapon hand shows them.
  const foodWater = panel(() => drawInventoryScreen(theUi));
  character.addCharacterPossession(1, scroll, 1);
  const scrollShown = panel(() => drawInventoryScreen(theUi));

  unset();
  handleMouseButton(theUi, 70, 0, 0);
  const atPress = seen();
  const held = theUi.pressingMouth;
  const heldPanel = panel(() => drawInventoryScreen(theUi));
  console.log(`11. the mouth pressed with an empty hand: ${held ? 'held' : 'not held'}, `
    + `the panel ${heldPanel === foodWater ? 'food and water' : heldPanel === scrollShown ? 'the scroll' : 'unknown'}, `
    + `${atPress === null ? 'runs nothing' : `runs on ${atPress}`}`);
  check(foodWater !== scrollShown, 'the food and water panel and the scroll panel differ');
  check(held, 'the mouth pressed with an empty hand and the scroll shown is held (d.PressingMouth)');
  check(heldPanel === foodWater, 'held, the panel is food and water');
  check(atPress === null, 'the press runs no viewing filter');
  check(theUi.displayResurrectChestOrScroll === 2, 'held, d.DisplayResurrectChestOrScroll stays 2');
  unset();
  tenSecondUpdate(game.ctx);
  check(seen() === null, 'the ten-second update with the mouth held runs nothing');
  check(panel(() => drawInventoryScreen(theUi)) === foodWater, 'after the ten-second update, the panel is still food and water');
  handleInventoryToggle(theUi, 1);
  check(party.selectedCharacterIndex === 1, 'with the mouth held, the inventory does not close (ShowHideInventory returns on d.PressingMouth)');
  unset();
  handleMouseUnclick(theUi);
  const atRelease = seen();
  console.log(`    the release: ${atRelease === null ? 'runs nothing' : `runs on ${atRelease}`}, `
    + `the panel ${panel(() => drawInventoryScreen(theUi)) === scrollShown ? 'the scroll' : 'not the scroll'}`);
  check(!theUi.pressingMouth && atRelease === scroll, "the release lets go, and TAG0189d4 runs the scroll's viewing filter");
  check(panel(() => drawInventoryScreen(theUi)) === scrollShown, 'released, the panel is the scroll again');

  character.removeCharacterPossession(1, 1);
  drawInventoryScreen(theUi);
  handleMouseButton(theUi, 70, 0, 0);
  console.log(`    with food and water shown, the mouth is ${theUi.pressingMouth ? 'held' : 'not held'}`);
  check(!theUi.pressingMouth, 'with food and water shown (d.DisplayResurrectChestOrScroll 0), the mouth is not held');
}

/* ------------------------------- 12, 13. the pointer, and a death while held ---- */
{
  // The host's members are the screen's, as `main.ts` wires them.
  let ui: UIState | null = null;
  const game = withFilterDsas(ESL_VIEWINGFILTER, [[...params(0)]], {
    drawCharacterState: (chIdx, charFlags) => { if (ui) drawCharacterStateEyePanel(ui, chIdx, charFlags); },
    pressingEye: () => ui?.pressingEye ?? false,
    pressingMouth: () => ui?.pressingMouth ?? false,
    displayResurrectChestOrScroll: () => ui?.displayResurrectChestOrScroll ?? 0,
    showHideInventory: (chIdx) => { if (ui) handleInventoryToggle(ui, chIdx); },
    releaseEyeOrMouth: () => { if (ui) releaseEyeOrMouth(ui); },
  });
  const party = game.ctx.party.state;
  const graphics = stockGraphics();
  const cache = new Map();
  const theUi = newUIState(graphics, game.ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui = theUi;
  party.selectedCharacterIndex = -1;
  party.objectInHand = OBJECT_ID_NULL;
  const character = game.systems.character;
  const scroll = game.ctx.dungeon.rnMaps.rn(DBType.SCROLL, 0);
  // A scroll in champion 1's weapon hand, so the mouth can be held over it.
  character.removeCharacterPossession(1, 1);
  character.addCharacterPossession(1, scroll, 1);
  theUi.hoverPoint = { x: 100, y: 60 };
  const pixels = theUi.screenIndexBuffer.pixels;
  const pointerDrawn = (): boolean => {
    pixels.fill(0);
    drawCursorItem(theUi, false);
    return pixels.some((v) => v !== 0);
  };
  handleInventoryToggle(theUi, 1);
  drawInventoryScreen(theUi);
  const before = pointerDrawn();
  handleMouseButton(theUi, 71, 0, 0);
  const eyeHeld = theUi.pressingEye && !pointerDrawn();
  handleMouseUnclick(theUi);
  const eyeReleased = pointerDrawn() && theUi.word23118 === 0;
  handleMouseButton(theUi, 70, 0, 0);
  const mouthHeld = theUi.pressingMouth && !pointerDrawn();
  handleMouseUnclick(theUi);
  const mouthReleased = pointerDrawn() && theUi.word23118 === 0;
  console.log(`12. the pointer: ${before ? 'drawn' : 'not drawn'}; the eye held ${eyeHeld ? 'hides it' : 'leaves it'}, `
    + `released ${eyeReleased ? 'shows it' : 'leaves it hidden'}; the mouth held ${mouthHeld ? 'hides it' : 'leaves it'}, `
    + `released ${mouthReleased ? 'shows it' : 'leaves it hidden'}`);
  check(before, 'with nothing held, the pointer is drawn');
  check(eyeHeld, 'the eye held hides the pointer (STHideCursor(HC47))');
  check(eyeReleased, "the eye's release shows it again, the hide count back to 0");
  check(mouthHeld, 'the mouth held with an empty hand hides the pointer (STHideCursor(HC5))');
  check(mouthReleased, "the mouth's release shows it again, the hide count back to 0");

  // The mouth on champion 1, whose scroll lets it be held; the eye on champion 2.
  for (const [what, button, chIdx] of [['mouth', 70, 1], ['eye', 71, 2]] as const) {
    if (party.selectedCharacterIndex !== chIdx) handleInventoryToggle(theUi, chIdx);
    drawInventoryScreen(theUi);
    handleMouseButton(theUi, button, 0, 0);
    const held = theUi.pressingEye || theUi.pressingMouth;
    game.systems.monsterAttack.killCharacter(chIdx);
    const released = !theUi.pressingEye && !theUi.pressingMouth;
    const closed = party.selectedCharacterIndex === -1;
    const shown = pointerDrawn() && theUi.word23118 === 0;
    theUi.diskMenuNeeded = false;
    handleMouseButton(theUi, 140, 0, 0);
    const disk = theUi.diskMenuNeeded;
    console.log(`13. champion ${chIdx} dies with the ${what} held: ${released ? 'let go' : 'still held'}, `
      + `the inventory ${closed ? 'closed' : 'open'}, the pointer ${shown ? 'shown' : 'hidden'}, `
      + `the disk icon ${disk ? 'answers' : 'swallowed'}`);
    check(held, `the ${what} is held before the death`);
    check(released, `the death lets go of the ${what}`);
    check(closed, "and closes the dead champion's inventory");
    check(shown, 'the pointer is back, the hide count 0');
    check(disk, 'the buttons after 81 are not swallowed');
  }

  // 14. Champion 0's inventory, a weapon in hand.
  const r = theUi.uiTables.graphic232.wRectPos624;
  const name = (): number[] => {
    pixels.fill(0);
    drawHeldObjectName(theUi);
    const out: number[] = [];
    for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) out.push(pixels[y * 320 + x]!);
    return out;
  };
  handleInventoryToggle(theUi, 0);
  party.objectInHand = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, 0);
  const shownBefore = name().some((v) => v !== 0);
  handleMouseButton(theUi, 71, 0, 0);
  const clearedHeld = theUi.pressingEye && name().every((v) => v === 0);
  handleMouseUnclick(theUi);
  const shownAfter = name().some((v) => v !== 0);
  party.objectInHand = OBJECT_ID_NULL;
  console.log(`14. wRectPos624 ${JSON.stringify([r.x1, r.x2, r.y1, r.y2])}; the held object's name `
    + `${shownBefore ? 'drawn' : 'blank'}, the eye held ${clearedHeld ? 'clears it' : 'leaves it'}, `
    + `released ${shownAfter ? 'draws it' : 'leaves it blank'}`);
  // Canary: the rectangle starts at `DrawNameOfHeldObject`'s pen x, 0xe9
  // (`doc/CSBwin-src/Code11f52.cpp:101-109`).
  check(r.x1 === 0xe9 && r.x2 === 319 && r.y1 === 33 && r.y2 === 38, 'wRectPos624 is the name line, from x 0xe9');
  check(shownBefore, "with a weapon in hand, its name is drawn");
  check(clearedHeld, "the eye held over it clears the name (ClearHeldObjectName)");
  check(shownAfter, "the release draws the name again (DrawNameOfHeldObject)");
}

finish();
