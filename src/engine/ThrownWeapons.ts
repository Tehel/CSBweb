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
 * Tags are made whether or not the extra is on; only the gather reads them, and only
 * with it on. They are never saved: a load forgets them (`applyRuntimeSaveState`).
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

/** The quiver's slots, in the order a bow reloads from them (`EnableCharacterAction`). */
const QUIVER = [12, 7, 8, 9];
/** The pack's. */
const PACK = Array.from({ length: 17 }, (_, i) => 13 + i);

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

/** How many kinds of object `slot` takes: the descriptions its carry mask admits. */
function breadth(ctx: GameContext, slot: number): number {
  const mask = ctx.tables.carryLocation[slot] ?? 0;
  let kinds = 0;
  for (let i = 0; i < ctx.tables.objDescWord4.length; i++) {
    if (((ctx.tables.objDescWord4[i] ?? 0) & mask) !== 0) kinds++;
  }
  return kinds;
}

/**
 * Where an object goes when the slot it left is taken: the quiver, narrowest slot first,
 * so the three only small weapons fit fill before the one a club fits too, then the pack.
 */
function fallbackSlots(ctx: GameContext): number[] {
  const kinds = new Map(QUIVER.map((slot) => [slot, breadth(ctx, slot)]));
  return [...[...QUIVER].sort((a, b) => kinds.get(a)! - kinds.get(b)!), ...PACK];
}

/** Whether `slot` of `champion` is empty and takes `object`. */
function takes(ctx: GameContext, champion: Champion, slot: number, object: ObjectID): boolean {
  return getChampionPossession(champion, slot) === OBJECT_ID_NULL && fitsSlot(ctx, object, slot);
}

/**
 * The party has arrived on `at` and its pads have fired: with the extra on, every tagged
 * object lying there goes back to its thrower. It comes off the floor as a pick-up by
 * hand does (`tryPickViewportObject`), so a pad under it feels it go. Each goes first into
 * the slot it left, if that is free; then the rest, the one the fewest free slots take
 * first, each into the first free one that takes it (`fallbackSlots`), so a club is not
 * left out of the quiver by the daggers gathered with it. A dead thrower, or one with no
 * room, leaves it where it lies, still tagged.
 */
export function gatherThrownWeapons(ctx: GameContext, at: Position): void {
  if (!ctx.extras.gatherThrownWeapons || ctx.thrownWeapons.size === 0) return;
  const dungeon = ctx.dungeon;
  const party = ctx.party.state;
  const lying: { object: ObjectID; tag: ThrownWeaponTag; champion: Champion }[] = [];
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const tag = tagOf(ctx, rn);
    const champion = tag && party.champions[tag.chIdx];
    if (tag && champion && (champion.attributes.health | 0) !== 0) lying.push({ object: rn, tag, champion });
  }
  const take = (object: ObjectID, chIdx: number, slot: number): void => {
    if (!dungeon.removeObjectFromCell(at, object)) return;
    ctx.systems.actuators.triggerObjectMove(at, object, false, false, party.facing & 0x3);
    forgetThrownWeapon(ctx, object);
    ctx.systems.character.addCharacterPossession(chIdx, object, slot);
  };

  const rest = lying.filter(({ object, tag, champion }) => {
    if (!takes(ctx, champion, tag.slot, object)) return true;
    take(object, tag.chIdx, tag.slot);
    return false;
  });
  if (rest.length === 0) return;
  const fallback = fallbackSlots(ctx);
  const room = new Map(rest.map(({ object, champion }) =>
    [object, fallback.filter((slot) => takes(ctx, champion, slot, object)).length]));
  rest.sort((a, b) => room.get(a.object)! - room.get(b.object)!);
  for (const { object, tag, champion } of rest) {
    const slot = fallback.find((s) => takes(ctx, champion, s, object));
    if (slot !== undefined) take(object, tag.chIdx, slot);
  }
}
