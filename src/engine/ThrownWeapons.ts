/**
 * An extra (`DEBT.md` X), not CSBWin's: what a champion's THROW or SHOOT sends off comes
 * back to them when the party arrives on the square it lies on, an idea from *Legend of
 * Grimrock*. An object thrown from the cursor never does.
 *
 * The attack tags the object (`tagThrownWeapon`). It keeps its `ObjectID` all the way: in
 * the missile, on the floor where it lands, and among a monster's possessions when a hit
 * absorbs it, which the monster drops when it dies. A tag names the record it was made
 * for, and only `DungeonState.findEmptyDBEntry` puts a new record object in a slot, so a
 * record freed or taken by `MakeMoreRoomInDB` and handed out again does not inherit it.
 * Taking the object into the hand or a champion's slot drops the tag
 * (`forgetThrownWeapon`).
 *
 * Tags are made whether or not the extras are on; only the gather reads them, and only
 * with them on. They are never saved: a load forgets them (`applyRuntimeSaveState`).
 */
import { OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID, type Position } from '../core/types';
import type { DatabaseRecord } from '../data/dungeonTypes';
import type { GameContext } from './GameContext';
import { getChampionPossession, type Champion } from './gameTypes';
import { DescIndex } from './objectIndex';

/** Who threw an object, from which slot, and the record it was then. */
export interface ThrownWeaponTag {
  readonly chIdx: number;
  readonly slot: number;
  readonly record: DatabaseRecord;
}

/** Every tag of the game, by object (`GameContext.thrownWeapons`). */
export type ThrownWeaponTags = Map<ObjectID, ThrownWeaponTag>;

/** The quiver, in the order a bow reloads from it (`EnableCharacterAction`), then the pack. */
const FALLBACK_SLOTS = [12, 7, 8, 9, ...Array.from({ length: 17 }, (_, i) => 13 + i)];

/** Champion `chIdx`'s attack has sent `object` off from `slot`. */
export function tagThrownWeapon(ctx: GameContext, object: ObjectID, chIdx: number, slot: number): void {
  const record = ctx.dungeon.getRecord(object);
  if (record) ctx.thrownWeapons.set(object, { chIdx, slot, record });
}

/** `object` was taken into the hand or a champion's slot: it is nobody's thrown weapon now. */
export function forgetThrownWeapon(ctx: GameContext, object: ObjectID): void {
  ctx.thrownWeapons.delete(object);
}

/** The tag of `object`, if it still names the record it was made for. */
function tagOf(ctx: GameContext, object: ObjectID): ThrownWeaponTag | null {
  const tag = ctx.thrownWeapons.get(object);
  if (!tag) return null;
  if (ctx.dungeon.getRecord(object) === tag.record) return tag;
  ctx.thrownWeapons.delete(object);
  return null;
}

/** Whether `object`'s carry mask lets it into `slot` (`canPlaceInSlot`'s test). */
function fitsSlot(ctx: GameContext, object: ObjectID, slot: number): boolean {
  const descIndex = DescIndex(ctx.dungeon, object);
  if (descIndex === -1) return false;
  return ((ctx.tables.objDescWord4[descIndex] ?? 0) & (ctx.tables.carryLocation[slot] ?? 0)) !== 0;
}

/** The slot it left if that is free and takes it, else the first free one that does, or -1. */
function slotFor(ctx: GameContext, champion: Champion, object: ObjectID, left: number): number {
  for (const slot of [left, ...FALLBACK_SLOTS]) {
    if (getChampionPossession(champion, slot) !== OBJECT_ID_NULL) continue;
    if (fitsSlot(ctx, object, slot)) return slot;
  }
  return -1;
}

/**
 * The party has arrived on `at` and its pads have fired: with the extras on, every tagged
 * object lying there goes back to its thrower. It comes off the floor as a pick-up by
 * hand does (`tryPickViewportObject`), so a pad under it feels it go, and into the slot
 * it left or the first that takes it. A dead thrower, or one with no room, leaves it
 * where it lies, still tagged.
 */
export function gatherThrownWeapons(ctx: GameContext, at: Position): void {
  if (!ctx.extras || ctx.thrownWeapons.size === 0) return;
  const dungeon = ctx.dungeon;
  const lying: ObjectID[] = [];
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (tagOf(ctx, rn)) lying.push(rn);
  }
  const party = ctx.party.state;
  for (const object of lying) {
    const tag = tagOf(ctx, object)!;
    const champion = party.champions[tag.chIdx];
    if (!champion || (champion.attributes.health | 0) === 0) continue;
    const slot = slotFor(ctx, champion, object, tag.slot);
    if (slot === -1) continue;
    if (!dungeon.removeObjectFromCell(at, object)) continue;
    ctx.systems.actuators.triggerObjectMove(at, object, false, false, party.facing & 0x3);
    forgetThrownWeapon(ctx, object);
    ctx.systems.character.addCharacterPossession(tag.chIdx, object, slot);
  }
}
