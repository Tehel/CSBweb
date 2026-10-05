/**
 * The cursor filter (`doc/CSBwin-src/MoveObject.cpp:797-865`) at its six `TouchWall` sites
 * (`Mouse.cpp:421-583`), run through `ActuatorSystem.touchWall` with DSAs on its square,
 * against a genuine save (`csbgame7.dat`). Each test square holds actuators on its side 0,
 * and the hand or the square the object they want.
 *
 * 1. **A dungeon with no filter takes the key** off the hand, and deletes it (`:561-568`).
 * 2. **Every DSA at the location runs**, each with a count of 6 and the
 *    `CURSORFILTER_PACKET` (`CSB.h:1517-1526`): the object, the type, the level, the wall's
 *    square and the side touched (`Mouse.cpp:552-559`).
 * 3. **A DSA's rewrite is what the next one sees, and what the site does**: a `type` of
 *    `CURSORFILTER_Cancel` (20) leaves the key in the hand (`:560`).
 * 4. **The DSAs run on the caller's parameters**: `CursorFilter` has no
 *    `NEWDSAPARAMETERS`, so the last packet is left there.
 * 5. **The torch holder's two**: `TakeFromTorchHolder` (12) for the object it holds, and
 *    `PlaceInTorchHolder` (13) for the one in the hand, each cancelled to nothing done
 *    (`:421-450`).
 * 6. **The swap's two**: `SwapRemove` (14) for the hand's object, which cancels the swap,
 *    then `SwapReplace` (15) for the square's, which cannot (`:479-507`).
 * 7. **The gift's**: `GiftFromGod` (16) on an empty hand, `RNnul` (0xFFFF), cancelled to
 *    no gift (`:575-589`); and after a key taken by the same touch, `RNempty` (0), the
 *    local `objectInHand` the key leaves (`:567`).
 * 8. **Nobody owns the cursor**, a party with no champion yet on the shipped dungeon: a
 *    pushbutton and a gift answer nothing, only a portrait would (`:357-360`).
 *
 * And the hand's three, each cancelled to nothing done:
 *
 * 9. **The throw**: `Throw` (5) for the hand's object, with the side thrown to and no
 *    square (`Mouse.cpp:689-694`), run through `MouseSystem.throwObjectFromCursor`.
 * 10. **The pick-up**: `PickFromFloor` (2) for the object clicked, the level, its square
 *    and the viewport button, its position relative to the party (`:827-835`), run
 *    through `tryPickViewportObject`. A cancel makes no tick due (`:840`).
 * 11. **The drop**: `DropObject` (7) for the hand's object, the level, the square it falls
 *    on and its absolute position (`:874-882`), run through
 *    `MouseSystem.dropObjectFromCursor`: on the party's square, and in the alcove ahead,
 *    which is the square ahead's facing side.
 *
 * And the champion's three:
 *
 * 12. **The clothing click**: `PlaceOnCharacter` (3) for the hand's object, `RNnul` when
 *    it is empty, with the champion and the slot; a cancel leaves both as they were
 *    (`CSBCode.cpp:6966-6972`). Once the slot is emptied, `PickFromCharacter` (4) for what
 *    it held, whose cancel nothing reads (`:6982-6991`). Run through
 *    `handleClothingClick`, on champion 0's ready hand.
 * 13. **The mouth**: `Eat` (8) for the object eaten, whose cancel nothing reads
 *    (`Character.cpp:4471-4479`), run through `handleMouthPress`.
 *
 * Run: `npx tsx tools/dump-cursor-filter.ts`
 */
import { readFileSync } from 'node:fs';

import { OBJNI_APPLE } from '../src/core/objectNameIndex';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import type { DungeonData } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { CursorFilterType, StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { GetBasicObjectType } from '../src/engine/objectIndex';
import { handleMouthPress } from '../src/renderer/ui/Feeding';
import { resolveObjectNameIndex } from '../src/renderer/ui/Objects';
import { handleClothingClick } from '../src/renderer/ui/Mouse';
import { tryPickViewportObject } from '../src/renderer/ui/ViewportPicking';
import { VIEWPORT_Y } from '../src/renderer/ViewportGraphics';
import { freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { newGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';

/** `ESL_CURSORFILTER` (`doc/CSBwin-src/CSB.h:1544`). */
const ESL_CURSORFILTER = 9;
const WORDS = 6;
/** `MISSILE_TYPE_ROCK`, a gift that is a rock (`src/engine/missileHelpers.ts`). */
const ROCK = 54;

/** The parameter count, then the packet, into globals `to` on. */
const report = (to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: WORDS }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** The packet's `type` set to `CURSORFILTER_Cancel`. */
const cancel: number[] = [
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...int(CursorFilterType.Cancel), varStore(11), ...int(WORDS), ...int(10), op(StkOp.PARAM_STORE),
];
/** Globals `from` on: the count and the six words. */
const packet = (g: number[], from = 0): string => g.slice(from, from + 1 + WORDS).join();

/** An empty square of the party's level other than the filter's: the test wall. */
function wallSquare(game: Game): Position {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  const map = dungeon.getMap(z)!;
  for (let x = map.descriptor.width - 1; x >= 0; x--) {
    for (let y = map.descriptor.height - 1; y >= 0; y--) {
      const p = new Position(x, y, z);
      if (dungeon.findFirstObject(p) === OBJECT_ID_EOF) return p;
    }
  }
  throw new Error('no empty square');
}

/** A new misc object of `miscType`, on no square. */
function misc(game: Game, miscType = 0): ObjectID {
  const data: DungeonData = game.ctx.dungeon.getData();
  data.databases.misc.records.push({ nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType });
  return game.ctx.dungeon.rnMaps.rn(DBType.MISC, data.databases.misc.records.length - 1);
}

const basicType = (game: Game, rn: ObjectID): number =>
  GetBasicObjectType(game.ctx.dungeon, game.ctx.tables.objDescObjectType, rn);

/** An actuator of `type` and `value` on side 0 of `at`, before anything else there. */
function actuator(game: Game, at: Position, type: number, value: number): void {
  const data: DungeonData = game.ctx.dungeon.getData();
  data.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: type | (value << 7), word4: 0, word6: 0 });
  game.ctx.dungeon.addObjectToCell(at, game.ctx.dungeon.rnMaps.rn(DBType.ACTUATOR, data.databases.actuators.records.length - 1));
}

/** The objects on `at` that are not actuators. */
function objectsAt(game: Game, at: Position): ObjectID[] {
  const dungeon = game.ctx.dungeon;
  const found: ObjectID[] = [];
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) found.push(rn);
  }
  return found;
}

/** A game whose filter runs `programs`, its test wall, and the packet `type` for `rn` there. */
function scene(programs: number[][] | null) {
  const game = programs ? withFilterDsas(ESL_CURSORFILTER, programs) : freshGame();
  const at = wallSquare(game);
  const expect = (type: number, rn: number): string => [WORDS, rn, type, at.z, at.x, at.y, 0].join();
  const touch = (): number[] => {
    game.systems.actuators.touchWall(at, 0);
    return game.systems.dsa.getGlobalVariables();
  };
  return { game, at, expect, touch, party: game.ctx.party.state };
}

/** The lock: a type-4 actuator wanting the object in the hand. */
function lock(programs: number[][] | null) {
  const s = scene(programs);
  const key = misc(s.game);
  actuator(s.game, s.at, 4, basicType(s.game, key));
  s.party.objectInHand = key;
  return { ...s, key };
}

{
  const { party, touch } = lock(null);
  touch();
  check(party.objectInHand === OBJECT_ID_NULL, '1. with no filter, the lock takes the key');
}

{
  const { party, touch, expect, key } = lock([report(0), report(10)]);
  const g = touch();
  console.log(`TakeKey: DSA 0 ${packet(g)}, DSA 1 ${packet(g, 10)}`);
  check(packet(g) === expect(CursorFilterType.TakeKey, key), '2. DSA 0 has the count and the packet');
  check(packet(g, 10) === expect(CursorFilterType.TakeKey, key), '2. DSA 1 runs too, on the same packet');
  check(party.objectInHand === OBJECT_ID_NULL, '2. the key is taken');
}

{
  const { game, party, touch, expect, key } = lock([cancel, report(0)]);
  const g = touch();
  check(packet(g) === expect(CursorFilterType.Cancel, key), '3. DSA 1 sees DSA 0\'s cancel');
  check(party.objectInHand === key, '3. a cancelled take leaves the key in the hand');
  const after = Array.from({ length: WORDS }, (_, i) => game.systems.dsa.getParameter(i));
  check(after.join() === expect(CursorFilterType.Cancel, key).split(',').slice(1).join(),
    '4. the caller\'s parameters keep the last packet');
}

/** The torch holder: a type-13 actuator wanting an object of the apple's type. */
for (const cancelled of [false, true]) {
  const take = scene([[...report(0), ...(cancelled ? cancel : [])]]);
  const torch = misc(take.game);
  actuator(take.game, take.at, 13, basicType(take.game, torch));
  take.game.ctx.dungeon.addObjectToCell(take.at, torch);
  const g = take.touch();
  check(packet(g) === take.expect(CursorFilterType.TakeFromTorchHolder, torch), `5. ${cancelled ? 'cancelled ' : ''}TakeFromTorchHolder's packet`);
  check((take.party.objectInHand === torch) === !cancelled, `5. the holder's object ${cancelled ? 'stays' : 'is taken'}`);

  const place = scene([[...report(0), ...(cancelled ? cancel : [])]]);
  const held = misc(place.game);
  actuator(place.game, place.at, 13, basicType(place.game, held));
  place.party.objectInHand = held;
  const h = place.touch();
  check(packet(h) === place.expect(CursorFilterType.PlaceInTorchHolder, held), `5. ${cancelled ? 'cancelled ' : ''}PlaceInTorchHolder's packet`);
  check((place.party.objectInHand === held) === cancelled, `5. the hand's object ${cancelled ? 'stays' : 'is placed'}`);
}

/** The swap: a type-16 actuator wanting the hand's object, an object on the square. */
for (const cancelled of [false, true]) {
  const s = scene([[...report(0), ...(cancelled ? cancel : [])]]);
  const held = misc(s.game);
  const lying = misc(s.game, 1);
  actuator(s.game, s.at, 16, basicType(s.game, held));
  s.game.ctx.dungeon.addObjectToCell(s.at, lying);
  s.party.objectInHand = held;
  const g = s.touch();
  if (cancelled) {
    check(packet(g) === s.expect(CursorFilterType.SwapRemove, held), '6. SwapRemove\'s packet, for the hand\'s object');
    check(s.party.objectInHand === held && objectsAt(s.game, s.at).join() === String(lying), '6. a cancelled SwapRemove swaps nothing');
  } else {
    check(packet(g) === s.expect(CursorFilterType.SwapReplace, lying), '6. SwapReplace\'s packet, for the square\'s object');
    check(s.party.objectInHand === lying && objectsAt(s.game, s.at).join() === String(held), '6. the swap is made');
  }
}

/** The gift: a type-12 actuator giving a rock. */
for (const cancelled of [false, true]) {
  const s = scene([[...report(0), ...(cancelled ? cancel : [])]]);
  actuator(s.game, s.at, 12, ROCK);
  const g = s.touch();
  check(packet(g) === s.expect(CursorFilterType.GiftFromGod, OBJECT_ID_NULL), `7. ${cancelled ? 'cancelled ' : ''}GiftFromGod's packet, for RNnul`);
  check((s.party.objectInHand === OBJECT_ID_NULL) === cancelled, `7. the gift is ${cancelled ? 'not given' : 'given'}`);
}

{
  const s = lock([report(0)]);
  actuator(s.game, s.at, 12, ROCK);
  const g = s.touch();
  check(packet(g) === s.expect(CursorFilterType.GiftFromGod, 0), '7. after a key taken, the gift\'s packet carries RNempty');
  check(s.party.objectInHand !== OBJECT_ID_NULL, '7. and the gift is given');
}

{
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync('static/gamefiles/dm-atari/dungeon.dat'))), stockGraphics());
  const at = wallSquare(game);
  actuator(game, at, 1, 0);
  actuator(game, at, 12, ROCK);
  const party = game.ctx.party.state;
  const fired = game.systems.actuators.touchWall(at, 0);
  console.log(`no champion: cursorOwner ${party.cursorOwner ?? -1}, fired ${fired}, hand ${party.objectInHand}`);
  check(party.champions.length === 0 && (party.cursorOwner ?? -1) === -1, '8. the new game has no champion, so nobody owns the cursor');
  check(!fired, '8. the pushbutton does not fire');
  check(party.objectInHand === OBJECT_ID_NULL, '8. and the gift is not given');
}

/** The packet the hand's sites send: the count and the six words. */
const hand = (type: number, rn: number, p1: number, p2 = 0, p3 = 0, p4 = 0): string => [WORDS, rn, type, p1, p2, p3, p4].join();

for (const cancelled of [false, true]) {
  const game = withFilterDsas(ESL_CURSORFILTER, [[...report(0), ...(cancelled ? cancel : [])]]);
  const party = game.ctx.party.state;
  const thrown = misc(game);
  party.cursorOwner = 0;
  party.objectInHand = thrown;
  const launched = game.systems.mouse.throwObjectFromCursor(1);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`Throw${cancelled ? ', cancelled' : ''}: ${packet(g)}, launched ${launched}`);
  check(packet(g) === hand(CursorFilterType.Throw, thrown, 1),
    `9. ${cancelled ? 'cancelled ' : ''}Throw's packet, the side thrown to and no square`);
  check(launched === !cancelled && (party.objectInHand === thrown) === cancelled, `9. the object is ${cancelled ? 'kept' : 'thrown'}`);
}

for (const cancelled of [false, true]) {
  const game = withFilterDsas(ESL_CURSORFILTER, [[...report(0), ...(cancelled ? cancel : [])]]);
  const party = game.ctx.party.state;
  const at = party.position;
  const lying = game.ctx.dungeon.rnMaps.setPos(misc(game), party.facing & 3);
  game.ctx.dungeon.addObjectToCell(at, lying);
  party.cursorOwner = 0;
  party.objectInHand = OBJECT_ID_NULL;
  game.ctx.loop.clockTick = false;
  const ui = newUIState(stockGraphics(), game.ctx);
  const button = { x1: 10, x2: 20, y1: 10, y2: 20 };
  const none = { x1: 255, x2: 0, y1: 0, y2: 0 };
  ui.context.viewportObjectButtons = [button, none, none, none, none, none];
  ui.context.viewportObjectRNs = [lying, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF];
  const picked = tryPickViewportObject(ui, 15, 15 + VIEWPORT_Y);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`PickFromFloor${cancelled ? ', cancelled' : ''}: ${packet(g)}, picked ${picked}`);
  check(packet(g) === hand(CursorFilterType.PickFromFloor, lying, at.z, at.x, at.y, 0),
    `10. ${cancelled ? 'cancelled ' : ''}PickFromFloor's packet, the square and the button`);
  check(picked === !cancelled && (party.objectInHand === lying) === !cancelled
    && objectsAt(game, at).includes(lying) === cancelled, `10. the object is ${cancelled ? 'left' : 'picked up'}`);
  check(game.ctx.loop.clockTick === !cancelled, `10. ${cancelled ? 'no tick is' : 'a tick is'} made due`);
}

for (const [pos, ahead] of [[1, false], [4, true]] as const) {
  for (const cancelled of [false, true]) {
    const game = withFilterDsas(ESL_CURSORFILTER, [[...report(0), ...(cancelled ? cancel : [])]]);
    const party = game.ctx.party.state;
    const facing = party.facing & 3;
    const at = ahead ? [party.position.north, party.position.east, party.position.south, party.position.west][facing] : party.position;
    const dropped = misc(game);
    party.cursorOwner = 0;
    party.objectInHand = dropped;
    const done = game.systems.mouse.dropObjectFromCursor(pos);
    const g = game.systems.dsa.getGlobalVariables();
    const absolute = (facing + (ahead ? 2 : pos)) & 3;
    console.log(`DropObject at ${pos}${cancelled ? ', cancelled' : ''}: ${packet(g)}, dropped ${done}`);
    check(packet(g) === hand(CursorFilterType.DropObject, dropped, at.z, at.x, at.y, absolute),
      `11. ${cancelled ? 'cancelled ' : ''}DropObject's packet at ${pos}, the square and the position it falls on`);
    const onSquare = objectsAt(game, at).some((rn) => game.ctx.dungeon.rnMaps.idx(rn) === game.ctx.dungeon.rnMaps.idx(dropped));
    check(done === !cancelled && (party.objectInHand === dropped) === cancelled && onSquare === !cancelled,
      `11. the object is ${cancelled ? 'kept' : 'dropped'} at ${pos}`);
  }
}

/** `GLOBALFETCH` (`DsaSystem`'s `DsaCommand`): global `index` onto the stack. */
const globalFetch = (index: number): number => 19 | (index << 6);
/** The packet the call before left in globals 0 on, kept in globals 20 on, then this call's. */
const keep: number[] = [
  ...Array.from({ length: 1 + WORDS }, (_, i) => [globalFetch(i), globalStore(20 + i)]).flat(),
  ...report(0),
];
/** 16 added to `type`: `PlaceOnCharacter` (3) becomes 19, `PickFromCharacter` (4) `Cancel` (20). */
const shift: number[] = [
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  varFetch(11), ...int(CursorFilterType.Cancel - CursorFilterType.PickFromCharacter), op(StkOp.PLUS), varStore(11),
  ...int(WORDS), ...int(10), op(StkOp.PARAM_STORE),
];

/** Champion 0's ready hand holding `held` or nothing, and the hand `inHand`, before a click on it. */
function clothing(programs: number[][], held: boolean, inHand: boolean) {
  const game = withFilterDsas(ESL_CURSORFILTER, programs);
  const party = game.ctx.party.state;
  const ui = newUIState(stockGraphics(), game.ctx);
  ui.partyState = party;
  const character = game.systems.character;
  character.removeCharacterPossession(0, 0);
  const apple = misc(game);
  if (held) character.addCharacterPossession(0, apple, 0);
  party.cursorOwner = 0;
  party.selectedCharacterIndex = -1;
  party.objectInHand = inHand ? apple : OBJECT_ID_NULL;
  handleClothingClick(ui, 0);
  return { g: game.systems.dsa.getGlobalVariables(), apple, party, slot: party.champions[0]!.possessions[0] };
}

for (const cancelled of [false, true]) {
  const { g, apple, party, slot } = clothing([[...report(0), ...(cancelled ? cancel : [])]], false, true);
  console.log(`PlaceOnCharacter${cancelled ? ', cancelled' : ''}: ${packet(g)}, hand ${party.objectInHand}, slot ${slot}`);
  check(packet(g) === hand(CursorFilterType.PlaceOnCharacter, apple, 0, 0), `12. ${cancelled ? 'cancelled ' : ''}PlaceOnCharacter's packet, the champion and the slot`);
  check(cancelled
    ? party.objectInHand === apple && slot === OBJECT_ID_NULL
    : party.objectInHand === OBJECT_ID_NULL && slot === apple, `12. the object is ${cancelled ? 'kept' : 'placed'}`);
}

{
  const { g, apple, party, slot } = clothing([keep], true, false);
  console.log(`PlaceOnCharacter then PickFromCharacter: ${packet(g, 20)}, ${packet(g)}`);
  check(packet(g, 20) === hand(CursorFilterType.PlaceOnCharacter, OBJECT_ID_NULL, 0, 0), '12. an empty hand\'s click sends PlaceOnCharacter for RNnul');
  check(packet(g) === hand(CursorFilterType.PickFromCharacter, apple, 0, 0), '12. then PickFromCharacter for what the slot held');
  check(party.objectInHand === apple && slot === OBJECT_ID_NULL, '12. which is taken');
}

{
  const { g, apple, party, slot } = clothing([shift, report(0)], true, false);
  check(packet(g) === hand(CursorFilterType.Cancel, apple, 0, 0), '12. a DSA cancels PickFromCharacter');
  check(party.objectInHand === apple && slot === OBJECT_ID_NULL, '12. and the object is taken all the same');
}

{
  const game = withFilterDsas(ESL_CURSORFILTER, [[...report(0), ...cancel]]);
  const party = game.ctx.party.state;
  const ui = newUIState(stockGraphics(), game.ctx);
  ui.partyState = party;
  let food = misc(game);
  for (let miscType = 1; resolveObjectNameIndex(ui, food) !== OBJNI_APPLE; miscType++) {
    game.ctx.dungeon.getData().databases.misc.records.pop();
    food = misc(game, miscType);
  }
  const apple = food;
  party.cursorOwner = 0;
  party.selectedCharacterIndex = 0;
  party.objectInHand = apple;
  handleMouthPress(ui);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`Eat, cancelled: ${packet(g)}, hand ${party.objectInHand}`);
  check(packet(g) === hand(CursorFilterType.Eat, apple, 0), '13. Eat\'s packet, the object eaten and nothing else');
  check(party.objectInHand === OBJECT_ID_NULL, '13. a cancel does not stop the eating');
}

finish();
