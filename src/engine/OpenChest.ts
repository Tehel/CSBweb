/**
 * The open chest, `d.objOpenChest` and `d.rnChestContents` on `ctx.interface`:
 * `ShowChestContents` and `RepackChest` (`doc/CSBwin-src/Character.cpp:3042`, `:3113`),
 * and the interface halves of the events that open and repack it, `DrawCharacterState`'s
 * eye panel, `TAG0189d4`, `DescribeObject`, `DisplayFoodWater` and `TAG019036`. What
 * those draw is the screen's (`src/renderer/ui/Inventory.ts`). Nothing that composes the
 * screen opens or repacks a chest.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import type { GameContext } from './GameContext';
import { getChampionPossession } from '../core/charDesc';
import { emptyChestContents } from './InterfaceState';

/**
 * `ShowChestContents` (`doc/CSBwin-src/Character.cpp:3042`) — the state half: the chest
 * becomes `d.objOpenChest`, its objects `d.rnChestContents`, and every link is cleared,
 * each object's and the chest's own, so the objects belong to the chest's slots alone
 * until `repackChest` (`:3069-3103`). The drawing is the screen's (`drawChestPanel`).
 * A chest already open is left as it is (`:3051`); a record that is no chest opens none.
 */
export function showChestContents(ctx: GameContext, objChest: ObjectID): void {
  const ui = ctx.interface;
  if (ui.openChestId === objChest) return;
  const chest = ctx.dungeon.getContainerRecord(objChest);
  if (!chest) {
    ui.openChestId = null;
    ui.openChestContents = emptyChestContents();
    return;
  }

  ui.openChestId = objChest;
  const contents = emptyChestContents();
  let cursor = chest.containedObject;
  let index = 0;
  while (cursor !== OBJECT_ID_EOF && cursor !== OBJECT_ID_NULL && index < contents.length) {
    contents[index++] = cursor;
    cursor = ctx.dungeon.getDBRecordLink(cursor);
  }
  ui.openChestContents = contents;

  for (const item of contents) {
    if (item !== OBJECT_ID_NULL) {
      ctx.dungeon.setDBRecordLink(item, OBJECT_ID_EOF);
    }
  }
  chest.containedObject = OBJECT_ID_EOF;
}

/**
 * `RepackChest` (`doc/CSBwin-src/Character.cpp:3113`) — link the open chest's objects back
 * into it, in slot order, and close it. `RemoveCharacterPossession` calls it when the
 * chest leaves the weapon hand of the champion whose inventory is open (`:1911-1919`),
 * and so do the inventory hidden (`ShowHideInventory`, `doc/CSBwin-src/CSBCode.cpp:7517`),
 * the eye and the mouth (`describeObject`, `displayFoodWater`, `tag019036`, and
 * `QuitPressingEye`, `:7464`), `TAG02076e` (`Character.cpp:5149`) and a save before it
 * writes the file (`GameSaves.save`).
 */
export function repackChest(ctx: GameContext): void {
  const ui = ctx.interface;
  if (ui.openChestId === null) return;
  const chest = ctx.dungeon.getContainerRecord(ui.openChestId);
  if (!chest) {
    ui.openChestId = null;
    ui.openChestContents = emptyChestContents();
    return;
  }

  chest.containedObject = OBJECT_ID_EOF;
  let previous: ObjectID | null = null;
  for (const item of ui.openChestContents) {
    if (item === OBJECT_ID_NULL) continue;
    ctx.dungeon.setDBRecordLink(item, OBJECT_ID_EOF);
    if (previous === null) {
      chest.containedObject = item;
    } else {
      ctx.dungeon.setDBRecordLink(previous, item);
    }
    previous = item;
  }

  ui.openChestId = null;
  ui.openChestContents = emptyChestContents();
}

/**
 * `DrawCharacterState`'s eye panel (`doc/CSBwin-src/Character.cpp:1483-1502`), for the
 * champion whose inventory is open, its interface half: with the mouth held,
 * `DisplayFoodWater`; with the eye held and an empty hand, `TAG019036`; with neither,
 * `TAG0189d4`. What they draw is the screen's (`drawCharacterStateEyePanel`,
 * `src/renderer/ui/Inventory.ts`).
 */
export function drawCharacterStateEyePanel(ctx: GameContext): void {
  if (ctx.interface.pressingMouth) {
    displayFoodWater(ctx);
  } else if (ctx.interface.pressingEye) {
    if (ctx.party.state.objectInHand === OBJECT_ID_NULL) tag019036(ctx);
  } else {
    tag0189d4(ctx);
  }
}

/**
 * `TAG0189d4` (`doc/CSBwin-src/Character.cpp:3866-3914`), its interface half: with a
 * candidate of the Hall of Champions, `TAG0189a8`'s `d.DisplayResurrectChestOrScroll = 5`
 * (`:3856`); otherwise 4 for a chest in the weapon hand of the champion whose inventory
 * is open, 2 for a scroll and 0 for anything else, and `DescribeObject(objD7, 0)` for the
 * first two, `DisplayFoodWater` for the rest. What it draws is the screen's (`tag0189d4`,
 * `src/renderer/ui/Inventory.ts`).
 */
export function tag0189d4(ctx: GameContext): void {
  const party = ctx.party.state;
  if (party.potentialChampionIndex >= 0) {
    ctx.interface.displayResurrectChestOrScroll = 5;
    return;
  }
  const champion = party.champions[party.selectedCharacterIndex];
  if (!champion) return;
  let objD7 = getChampionPossession(champion, 1);
  ctx.interface.displayResurrectChestOrScroll = 0;
  const dbType = objD7 === OBJECT_ID_NULL ? -1 : ctx.dungeon.rnMaps.dbType(objD7);
  if (dbType === DBType.CHEST) {
    ctx.interface.displayResurrectChestOrScroll = 4;
  } else if (dbType === DBType.SCROLL) {
    ctx.interface.displayResurrectChestOrScroll = 2;
  } else {
    objD7 = OBJECT_ID_NULL;
  }
  if (objD7 === OBJECT_ID_NULL) displayFoodWater(ctx);
  else describeObject(ctx, objD7);
}

/**
 * `DescribeObject(object, P2)` (`doc/CSBwin-src/Character.cpp:3424`), its interface half:
 * with the eye or the mouth held the open chest is repacked (`:3457-3465`), and a chest
 * is opened (`:3548-3550`). The description, and a scroll's viewing filter, are the
 * screen's (`describeObject`, `src/renderer/ui/Inventory.ts`).
 */
export function describeObject(ctx: GameContext, object: ObjectID): void {
  if (ctx.interface.pressingEye || ctx.interface.pressingMouth) repackChest(ctx);
  if (ctx.dungeon.rnMaps.dbType(object) === DBType.CHEST) showChestContents(ctx, object);
}

/** `DisplayFoodWater` (`doc/CSBwin-src/Viewport.cpp:7240-7256`), its interface half: `RepackChest` (`:7248`). */
export function displayFoodWater(ctx: GameContext): void {
  repackChest(ctx);
}

/** `TAG019036` (`doc/CSBwin-src/Character.cpp:4519`), its interface half: `RepackChest` (`:4532`). */
export function tag019036(ctx: GameContext): void {
  repackChest(ctx);
}
