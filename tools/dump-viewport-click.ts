/**
 * An empty-handed click in the viewport: which of the six viewport buttons it touches.
 *
 * `HandleClickInViewport` (`doc/CSBwin-src/Mouse.cpp:1053-1135`) tests the door switch,
 * then buttons 0..5 in order, and the first hit wins. 0-4 are the objects drawn in the
 * cells ahead; 5 is the front wall's decoration (`CSBCode.cpp:3299`). An alcove's
 * objects are drawn *inside* its decoration, so the order is what lets a player take an
 * object out of an alcove at all — and button 5 of an alcove touches nothing
 * (`if (d.FacingAlcove == 0) TouchWallF1()`, `Mouse.cpp:1123-1128`).
 *
 * The port tested the wall decoration first and the objects last. That went unnoticed
 * while a wall click that touched no actuator fell through to the pickup; once it
 * stopped falling through, a click on an object in an alcove did nothing.
 *
 * The buttons are the ones the renderer records for this very alcove — level 2, the
 * party at (4,17) facing east — read off the live app. The dispatch is what is under
 * test, not the renderer, so they are written into the context by hand.
 *
 * A click that touches no button makes a sound on the bare stone ahead
 * (`Mouse.cpp:1138-1157`): not an alcove, `d.CellTypeJustAhead` stone, the cell's flags
 * `(cf & 5) == 0`, and the click within x 33-189, y 44-150. `d.CellTypeJustAhead` comes
 * from the port's own `SummarizeRoomInfo` over the real cell, so that a closed imaginary
 * false wall (level 2, (7,9)) shows the two tests disagreeing. The sound is checked down
 * to the sample the host is asked to play.
 *
 * Run: `npx tsx tools/dump-viewport-click.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID } from '../src/core/types';
import { RoomType } from '../src/renderer/bytecode/Types';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { Game } from '../src/engine/Game';
import { resolveEmptyHandedViewportClick, tryPickViewportObject } from '../src/renderer/ui/ViewportPicking';
import type { UIState } from '../src/renderer/ui/UIState';
import type { RectPos } from '../src/renderer/bytecode/BytecodeInterpreter';
import { newGame, stockGraphics } from './lib/game';
import { check, fail, finish } from './lib/check';
import { VIEWPORT_Y } from '../src/renderer/ViewportGraphics';

const ALCOVE = new Position(5, 17, 2);
const PARTY = new Position(4, 17, 2);
const FACING_NORTH = 0;
const FACING_EAST = 1;
const FACING_WEST = 3;

/** Viewport coordinates, as `ViewportRenderer` left them for this view. */
const BUTTON_4: RectPos = { x1: 104, x2: 119, y1: 82, y2: 90 };
const BUTTON_5: RectPos = { x1: 64, x2: 159, y1: 36, y2: 91 };
const UNSET: RectPos = { x1: 255, x2: 0, y1: 0, y2: 0 };

/** Every `playSound` the host is asked for: the SND item and the distance. */
const played: Array<[number, number]> = [];

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return newGame(data, stockGraphics(), { playSound: (soundId, _rateIdx, distance) => played.push([soundId, distance ?? -1]) });
}

/** The items (not actuators, not text) in a cell, first to last. */
function itemsAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.dungeonState.findFirstObject(cell); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    if (decodeObjectID(rn).category >= DBType.WEAPON) out.push(rn);
  }
  return out;
}

function makeUI(game: Game, rn: ObjectID, facingAlcove: boolean): UIState {
  return {
    dungeonState: game.dungeonState,
    partyState: game.party.state,
    context: {
      facingAlcove,
      doorSwitchRects: [],
      viewportObjectButtons: [UNSET, UNSET, UNSET, UNSET, { ...BUTTON_4 }, { ...BUTTON_5 }].map((b) => ({ ...b })),
      viewportObjectRNs: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, rn],
    },
  } as unknown as UIState;
}

/** `roomData[17]`, the cell ahead, as `DrawViewport` summarises it. */
function summaryAhead(game: Game): SummarizeRoomData {
  const party = game.party.state;
  const ahead = [party.position.north, party.position.east, party.position.south, party.position.west][party.facing & 3];
  const rslt: SummarizeRoomData = {
    x: ahead.x,
    y: ahead.y,
    relativeCellNumber: 17,
    skinNumber: 0,
    roomType: 0,
    championPortraitOrdinal: 0,
    graphicRoomType: 0,
    rn2: 0xfffe,
    decorations: [0, 0, 0],
    text: [0xfffe, 0xfffe, 0xfffe],
  };
  summarizeRoomInfoCsbwin(rslt, game.dungeonState, party.position, party.facing & 3);
  return rslt;
}

/** The party facing a face with nothing drawn on it: no object, no decoration. */
function bareUI(game: Game, facingAlcove: boolean): UIState {
  const roomData: SummarizeRoomData[] = [];
  roomData[17] = summaryAhead(game);
  return {
    dungeonState: game.dungeonState,
    partyState: game.party.state,
    context: {
      facingAlcove,
      doorSwitchRects: [],
      viewportObjectButtons: [UNSET, UNSET, UNSET, UNSET, UNSET, UNSET].map((b) => ({ ...b })),
      viewportObjectRNs: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
      roomData,
    },
  } as unknown as UIState;
}

/** A screen point at the centre of a viewport rectangle. */
function centre(r: RectPos): [number, number] {
  return [(r.x1 + r.x2) >> 1, ((r.y1 + r.y2) >> 1) + VIEWPORT_Y];
}

function main(): void {
  const game = makeGame();
  game.party.state.position = PARTY;
  game.party.state.facing = FACING_EAST;
  game.party.state.cursorOwner = 0;
  game.party.state.objectInHand = OBJECT_ID_NULL;

  // The canary: the alcove holds one item, on the face the party looks at.
  const items = itemsAt(game, ALCOVE);
  const rn = items[0];
  console.log(['alcove', 'items', 'face'].join('\t'));
  console.log([`(${ALCOVE.x},${ALCOVE.y},${ALCOVE.z})`, items.length, rn === undefined ? '-' : decodeObjectID(rn).position].join('\t'));
  if (rn === undefined) {
    fail('the level-2 alcove at (5,17) should hold an item');
    finish();
    return;
  }
  check(decodeObjectID(rn).position === ((FACING_EAST + 2) & 3), 'on the west face, the one a party facing east sees');

  // Why the order matters: the object's button lies wholly inside the wall's.
  check(
    BUTTON_4.x1 >= BUTTON_5.x1 && BUTTON_4.x2 <= BUTTON_5.x2 && BUTTON_4.y1 >= BUTTON_5.y1 && BUTTON_4.y2 <= BUTTON_5.y2,
    "an alcove's object button lies inside its wall button, so wall-first would swallow every pickup",
  );

  const [objX, objY] = centre(BUTTON_4);
  const wallX = BUTTON_5.x1 + 2;
  const wallY = BUTTON_5.y1 + 2 + VIEWPORT_Y;

  console.log('');
  console.log(['click', 'facing alcove', 'touches'].join('\t'));
  const row = (what: string, alcove: boolean, x: number, y: number): string | null => {
    const got = resolveEmptyHandedViewportClick(makeUI(game, rn, alcove), x, y);
    console.log([what, alcove, String(got)].join('\t'));
    return got;
  };
  check(row('object in the alcove', true, objX, objY) === 'object', 'an object drawn inside button 5 is button 4 — the objects are tested first');
  check(row('the alcove around it', true, wallX, wallY) === null, "an alcove's own wall touches nothing");
  check(row('a decorated wall', false, wallX, wallY) === 'wall', 'the same rectangle on any other decoration touches the wall');
  check(row('off every button', true, 2, 2 + VIEWPORT_Y) === null, 'a click on no button touches nothing');

  // And the pickup itself, end to end from the click point.
  const ui = makeUI(game, rn, true);
  const picked = tryPickViewportObject(ui, objX, objY);
  console.log('');
  console.log(['picked', 'in hand', 'left in alcove'].join('\t'));
  console.log([picked, game.party.state.objectInHand, itemsAt(game, ALCOVE).length].join('\t'));
  check(picked, 'the click picks the object up');
  check(game.party.state.objectInHand === rn, 'into the hand');
  check(itemsAt(game, ALCOVE).length === items.length - 1, 'and out of the alcove');

  // The bare stone.
  console.log('');
  console.log(['party', 'facing', 'ahead', 'cf', 'cellTypeJustAhead', 'alcove', 'click', 'touches'].join('\t'));
  const stone = (party: Position, facing: number, alcove: boolean, x: number, y: number): string | null => {
    game.party.state.position = party;
    game.party.state.facing = facing;
    const ui = bareUI(game, alcove);
    const ahead = ui.context!.roomData[17];
    const cf = game.dungeonState.getMap(party.z)?.cellFlags[ahead.x]?.[ahead.y] ?? -1;
    const got = resolveEmptyHandedViewportClick(ui, x, y);
    console.log([`(${party.x},${party.y},${party.z})`, facing, `(${ahead.x},${ahead.y})`, `0x${cf.toString(16)}`, ahead.roomType, alcove, `${x},${y}`, String(got)].join('\t'));
    return got;
  };
  check(stone(PARTY, FACING_WEST, false, 111, 97) === 'stone', 'bare stone ahead: the click is heard');
  check(stone(PARTY, FACING_WEST, false, 33, 44) === 'stone', 'the corner (33,44) is inside');
  check(stone(PARTY, FACING_WEST, false, 189, 150) === 'stone', 'the corner (189,150) is inside');
  check(stone(PARTY, FACING_WEST, false, 32, 97) === null, 'x 32 is outside');
  check(stone(PARTY, FACING_WEST, false, 190, 97) === null, 'x 190 is outside');
  check(stone(PARTY, FACING_WEST, false, 111, 43) === null, 'y 43 is outside');
  check(stone(PARTY, FACING_WEST, false, 111, 151) === null, 'y 151 is outside');
  check(stone(PARTY, FACING_EAST, true, 111, 97) === null, 'an alcove is silent (d.FacingAlcove)');
  check(stone(PARTY, FACING_NORTH, false, 111, 97) === null, 'open floor ahead is silent (d.CellTypeJustAhead)');
  check(stone(new Position(7, 24, 2), FACING_NORTH, false, 111, 97) === 'stone', 'a closed solid false wall is stone');
  const imaginary = new Position(7, 10, 2);
  game.party.state.position = imaginary;
  game.party.state.facing = FACING_NORTH;
  check(summaryAhead(game).roomType === RoomType.STONE, 'a closed imaginary false wall summarises as stone');
  check(stone(imaginary, FACING_NORTH, false, 111, 97) === null, 'but is silent: (cf & 5) != 0');

  // And the sound: ordinal 4, at the party, with no delay.
  game.party.state.position = PARTY;
  const queued: number[][] = [];
  const queueSound = game.sounds.queueSound.bind(game.sounds);
  game.sounds.queueSound = (ordinal, mapX, mapY, deltaTime) => {
    queued.push([ordinal, mapX, mapY, deltaTime]);
    queueSound(ordinal, mapX, mapY, deltaTime);
  };
  played.length = 0;
  game.handleStoneClick();
  const item = game.ctx.tables.sound1772[4]?.word0;
  console.log('');
  console.log(['queued', 'played', 'ordinal 4 is item'].join('\t'));
  console.log([JSON.stringify(queued), JSON.stringify(played), item].join('\t'));
  check(JSON.stringify(queued) === JSON.stringify([[4, PARTY.x, PARTY.y, 0]]), 'QueueSound(4, d.partyX, d.partyY, 0)');
  check(item === 536, "ordinal 4 is SND item 536 (doc/PROVEN_FACTS.md, the impact sounds)");
  check(JSON.stringify(played) === JSON.stringify([[536, 0]]), 'the host plays item 536 at distance 0');

  finish();
}

main();
