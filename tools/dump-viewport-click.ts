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
 * Run: `npx tsx tools/dump-viewport-click.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { Game } from '../src/engine/Game';
import { resolveEmptyHandedViewportClick, tryPickViewportObject } from '../src/renderer/ui/ViewportPicking';
import type { UIState } from '../src/renderer/ui/UIState';
import type { RectPos } from '../src/renderer/bytecode/BytecodeInterpreter';
import { check, fail, finish } from './lib/check';
import { VIEWPORT_Y } from '../src/renderer/ViewportGraphics';

const ALCOVE = new Position(5, 17, 2);
const PARTY = new Position(4, 17, 2);
const FACING_EAST = 1;

/** Viewport coordinates, as `ViewportRenderer` left them for this view. */
const BUTTON_4: RectPos = { x1: 104, x2: 119, y1: 82, y2: 90 };
const BUTTON_5: RectPos = { x1: 64, x2: 159, y1: 36, y2: 91 };
const UNSET: RectPos = { x1: 255, x2: 0, y1: 0, y2: 0 };

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return new Game(data);
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

  finish();
}

main();
