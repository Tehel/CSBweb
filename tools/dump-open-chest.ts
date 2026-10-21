/**
 * The open chest, `d.objOpenChest`, opened and repacked at CSBWin's events and at none
 * other: a screen is never composed here, so nothing that draws can open or repack it.
 *
 * 1. **The engine alone** (a headless `Game`, its host the null one): a chest put in the
 *    weapon hand of the champion whose inventory is open sets `CHARFLAG_chestOrScroll`
 *    (`doc/CSBwin-src/Character.cpp:2002-2009`), and its `DrawCharacterState` runs
 *    `TAG0189d4` (`:1497-1500`), whose `DescribeObject` opens it (`:3911`, `:3550`):
 *    its objects leave the chest's chain for `d.rnChestContents`, and
 *    `d.DisplayResurrectChestOrScroll` is 4. Taken out of the hand, `RemoveCharacterPossession`
 *    repacks it (`:1911-1919`), every object back in its chain.
 * 2. **The inventory** (`ShowHideInventory`, `doc/CSBwin-src/CSBCode.cpp:7478`): shown,
 *    its `DrawCharacterState` opens the weapon hand's chest; hidden, `RepackChest` (`:7517`).
 * 3. **The eye** (`_ClickOnEye`, `doc/CSBwin-src/Viewport.cpp:7264`): pressed with another
 *    chest on the cursor, `DescribeObject(d.objectInHand, 1)` repacks the hand's
 *    (`Character.cpp:3457-3465`) and opens the cursor's; released, `QuitPressingEye`
 *    repacks the cursor's (`CSBCode.cpp:7464`) and its `TAG0189d4` opens the hand's again.
 *    Pressed with an empty cursor, `TAG019036` repacks it (`Character.cpp:4532`).
 * 4. **The mouth** (`_FeedCharacter`, `Character.cpp:4058-4075`): pressed with an empty
 *    cursor, `DisplayFoodWater` repacks it (`Viewport.cpp:7248`); released,
 *    `QuitPressingMouth`'s `TAG0189d4` (`CSBCode.cpp:7449-7454`) opens it again.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import type { Game } from '../src/engine/Game';
import { handleMouthPress } from '../src/renderer/ui/Feeding';
import { handleEyePress, handleInventoryToggle, handleMouseUnclick } from '../src/renderer/ui/Mouse';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { stockGame, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

/** How many objects the chest's own chain holds. */
function chestContents(game: Game, chest: ObjectID): number {
  const record = game.ctx.dungeon.getContainerRecord(chest);
  let n = 0;
  for (let rn = record?.containedObject ?? OBJECT_ID_EOF; rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = game.ctx.dungeon.getDBRecordLink(rn)) n++;
  return n;
}

/** Every chest lying in a cell of `dungeon.dat` with at least one object in it, taken off its cell. */
function takeChests(game: Game): ObjectID[] {
  const chests: { chest: ObjectID; cell: Position }[] = [];
  for (let level = 0; level < game.ctx.dungeon.getMapCount(); level++) {
    const map = game.ctx.dungeon.getMap(level);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const cell = new Position(x, y, level);
        for (let rn = game.ctx.dungeon.findFirstObject(cell); rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
          if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CHEST && chestContents(game, rn) >= 1) chests.push({ chest: rn, cell });
        }
      }
    }
  }
  for (const { chest, cell } of chests) game.ctx.dungeon.removeObjectFromCell(cell, chest);
  return chests.map(({ chest }) => chest);
}

function newParty(): { game: Game; chests: ObjectID[] } {
  const game = stockGame();
  game.systems.hallOfChampions.addChampion(testChampion(0, { name: 'DAROO', attributes: { mana: 0, maxMana: 0 } }));
  const chests = takeChests(game);
  if (chests.length < 2) throw new Error('dungeon.dat has two chests with objects in them');
  return { game, chests };
}

function state(game: Game, chests: ObjectID[]): string {
  const iface = game.ctx.interface;
  const open = iface.openChestId === null ? 'none' : `chest ${chests.indexOf(iface.openChestId)}`;
  return `open ${open}, panel ${iface.displayResurrectChestOrScroll}, chains ${chests.slice(0, 2).map((c) => chestContents(game, c)).join('/')}`;
}

/* ---------------------------------------------------------- 1. the engine alone ---- */
console.log('=== the engine alone: a chest into and out of the weapon hand ===');
{
  const { game, chests } = newParty();
  const chest = chests[0]!;
  const packed = chestContents(game, chest);
  const party = game.ctx.party.state;
  party.selectedCharacterIndex = 0;
  game.systems.character.addCharacterPossession(0, chest, 1);
  console.log(`  into the hand:   ${state(game, chests)} (packed ${packed})`);
  check(game.ctx.interface.openChestId === chest && chestContents(game, chest) === 0,
    'AddCharacterPossession\'s DrawCharacterState opens it (TAG0189d4, Character.cpp:3911): its objects leave its chain');
  check(game.ctx.interface.openChestContents.filter((o) => o !== OBJECT_ID_NULL).length === packed,
    'and every one of them is in d.rnChestContents');
  check(game.ctx.interface.displayResurrectChestOrScroll === 4, 'd.DisplayResurrectChestOrScroll is 4 (Character.cpp:3888)');
  game.systems.character.removeCharacterPossession(0, 1);
  console.log(`  out of the hand: ${state(game, chests)}`);
  check(game.ctx.interface.openChestId === null && chestContents(game, chest) === packed,
    'RemoveCharacterPossession repacks it (Character.cpp:1911-1919)');
  check(game.ctx.interface.displayResurrectChestOrScroll === 0, 'and its DrawCharacterState\'s TAG0189d4 leaves the panel food and water');

  party.selectedCharacterIndex = -1;
  game.systems.character.addCharacterPossession(0, chest, 1);
  check(game.ctx.interface.openChestId === null && chestContents(game, chest) === packed,
    'into the hand of a champion whose inventory is closed, nothing opens it (Character.cpp:2002)');
}

/* ------------------------------------------- 2-4. the inventory, the eye, the mouth ---- */
console.log('');
console.log('=== the inventory, the eye and the mouth, with no screen composed ===');
{
  const { game, chests } = newParty();
  const [chest, other] = [chests[0]!, chests[1]!];
  const packed = chestContents(game, chest);
  const otherPacked = chestContents(game, other);
  const party = game.ctx.party.state;
  game.systems.character.addCharacterPossession(0, chest, 1);
  const ui = newUIState(stockGraphics(), game.ctx);

  handleInventoryToggle(ui, 0);
  console.log(`  inventory shown:     ${state(game, chests)}`);
  check(party.selectedCharacterIndex === 0 && game.ctx.interface.openChestId === chest && chestContents(game, chest) === 0,
    'ShowHideInventory\'s DrawCharacterState opens the weapon hand\'s chest');
  check(game.ctx.interface.displayResurrectChestOrScroll === 4, 'and the panel is the chest\'s');

  party.objectInHand = other;
  handleEyePress(ui);
  console.log(`  eye on a chest:      ${state(game, chests)}`);
  check(game.ctx.interface.openChestId === other && chestContents(game, other) === 0 && chestContents(game, chest) === packed,
    'the eye\'s DescribeObject repacks the hand\'s chest and opens the cursor\'s (Character.cpp:3464, :3550)');
  handleMouseUnclick(ui);
  console.log(`  eye released:        ${state(game, chests)}`);
  check(chestContents(game, other) === otherPacked && game.ctx.interface.openChestId === chest && chestContents(game, chest) === 0,
    'QuitPressingEye repacks the cursor\'s chest and its TAG0189d4 opens the hand\'s again (CSBCode.cpp:7464-7465)');

  party.objectInHand = OBJECT_ID_NULL;
  handleEyePress(ui);
  console.log(`  eye, empty cursor:   ${state(game, chests)}`);
  check(game.ctx.interface.openChestId === null && chestContents(game, chest) === packed,
    'with an empty cursor, TAG019036 repacks it (Character.cpp:4532)');
  handleMouseUnclick(ui);
  check(game.ctx.interface.openChestId === chest && chestContents(game, chest) === 0, 'and the release opens it again');

  handleMouthPress(ui);
  console.log(`  mouth held:          ${state(game, chests)}`);
  check(game.ctx.interface.pressingMouth && game.ctx.interface.openChestId === null && chestContents(game, chest) === packed,
    'the mouth held with an empty cursor: DisplayFoodWater repacks it (Viewport.cpp:7248)');
  handleMouseUnclick(ui);
  console.log(`  mouth released:      ${state(game, chests)}`);
  check(game.ctx.interface.openChestId === chest && chestContents(game, chest) === 0,
    'QuitPressingMouth\'s TAG0189d4 opens it again (CSBCode.cpp:7452)');

  handleInventoryToggle(ui, 0);
  console.log(`  inventory hidden:    ${state(game, chests)}`);
  check(party.selectedCharacterIndex === -1 && game.ctx.interface.openChestId === null && chestContents(game, chest) === packed,
    'ShowHideInventory hiding it repacks the chest (CSBCode.cpp:7517)');
}

finish();
