/**
 * `WorldMove` — the world `MoveObject(object, oldX, oldY, newX, newY, …)`
 * (`doc/CSBwin-src/Code11f52.cpp:2831-3492`), as the port cuts it up: `moveObject` for
 * anything but the party and a monster set down, `moveParty` for the party,
 * `resolveMonsterDestination` for `MonsterSystem.moveMonster`, all three through the one
 * teleporter / pit / stairs loop, `resolveCellEffects`. With it are what only that loop
 * calls: `TeleportMonster` (`:2343`), `Levitating` (`:2452`) and `PitGoesSomewhere`
 * (`:2812`), and `d.SupressPitDamage`.
 *
 * Not the DSA's ten-argument `MoveObject` (`MoveObject.cpp:721`), which is
 * `moveObjectDsa` (`dsa/ops/move.ts`). A monster lifted on the party's level first meets the
 * missiles in its way through `CheckMoveFromMissile`, which is `MissileEncounter`'s.
 */
import { isAlive } from './rules';
import { DBType, isSamePosition, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID, getRoomType } from '../core/types';
import type { CreatureRecord, Item16Record, TeleporterRecord } from '../data/dungeonTypes';
import { monsterHorizontalSize, monsterLevitating } from '../data/tables/MonsterDesc';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { MonsterDamageResult } from './MonsterDamage';
import { DeleteMonsterWhy, deleteMonsterParameters } from './filterParameters';
import { setPackedBits } from './monsterTypes';
import { gatherThrownWeapons } from './ThrownWeapons';
import { StateOfFear } from './monsterTypes';
import { decodeMissileTimerWord8 } from './missileHelpers';
import type { TimerQueue } from './TimerQueue';
import type { MmRecord } from './MmRecord';
import { groupFacingsByte } from './monsterPosition';

/** `soundTELEPORT` (`doc/CSBwin-src/CSB.h:628`). */
const SOUND_TELEPORT = 17;

/**
 * What `MoveObject`'s loop knows about a monster group it is moving
 * (`doc/CSBwin-src/Code11f52.cpp:2831-3166`): where it stands (`oldX < 0`: nowhere
 * yet), the level its `ITEM16` belongs to (`AttachedLevel_4`), and whether it has none
 * (`!item16Attached`).
 */
interface MonsterMove {
  record: CreatureRecord;
  oldX: number;
  oldY: number;
  attachedLevel: number;
  noItem16: boolean;
  /** `MoveObject`'s `pmmr`, which the fall's `DamageMonsterGroup` takes (`:3132`). */
  mmr: MmRecord | undefined;
}

/**
 * `objectDBTypeD4` when `MoveObject` moves the party, its object `RNnul`
 * (`doc/CSBwin-src/Code11f52.cpp:2872-2877`).
 */
const PARTY_OBJECT_TYPE = -1;

/** What `resolveCellEffects` takes through the teleporters, pits and stairs. */
interface CellEffectsMove {
  /** `objectDBTypeD4`: the object's database, or `PARTY_OBJECT_TYPE`. */
  objectType: number;
  /** The object's corner. */
  objectPos: number;
  facing: number;
  /** A missile's direction, from its timer's word 8. */
  missileDir?: number;
  /** False for what levitates: a pit does not take it. */
  allowFall: boolean;
  /** The group, when a monster is moved. */
  monster?: MonsterMove;
  /** A teleporter taken first, whatever the square holds. */
  pretendTeleporter?: TeleporterRecord;
  /** `MoveObject`'s `oldX`: -1 keeps an item's corner through a teleporter (`:3035-3041`). */
  oldX?: number;
}

export class WorldMove {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
  }

  /**
   * `MoveObject(RNnul, oldX, oldY, newX, newY, pPretendTeleporter, NULL)`
   * (`doc/CSBwin-src/Code11f52.cpp:2831-3360`): the party moved on its own level, which
   * every caller has loaded (`d.LoadedLevel == d.partyLevel`). `oldX < 0` places the
   * party from nowhere (a step out of a stairwell, the arrival on a level), `newX < 0`
   * lifts it (the stairs). In CSBWin's order:
   *
   * - the missiles in the corners it leaves, `CheckMoveFromMissile(oldX, oldY, newX,
   *   newY)` with the cells as passed (`:2882-2888`), which end the move when one of
   *   them wiped out a group;
   * - the party set on the new square and taken through the teleporter and pit loop,
   *   its square and facing following every jump and fall (`:2889-3170`);
   * - nothing more when it is back on its square facing the same way (`:3229-3236`);
   * - a footprint when it left its square (`:3259-3282`);
   * - the old square's pads (`:3293-3303`), a monster where it landed deleted
   *   (`:3333-3343`), then the new square's pads (`:3344-3352`).
   *
   * On another level, CSBWin presses no pads there: it sets `d.newPartyLevel`
   * (`:3354-3359`), and the top of the next tick loads the level and places the party on
   * it (`Game.loadNewPartyLevel`). Until then `d.partyLevel` is the level it left.
   * Inside the move, the party's level follows every jump and fall, as `d.LoadedLevel`
   * does, so a champion the fall kills leaves their bones on the level they reach.
   */
  moveParty(oldX: number, oldY: number, newX: number, newY: number, pretendTeleporter?: TeleporterRecord): void {
    const party = this.ctx.party.state;
    const level = party.position.z | 0;
    if (oldX >= 0) {
      const to = newX >= 0 ? new Position(newX, newY, level) : null;
      if (this.ctx.systems.missileEncounter.checkPartyMoveFromMissile(new Position(oldX, oldY, level), to)) return;
    }
    let unchangedRoom = false;
    if (newX >= 0) {
      const oldFacing = party.facing; // `LOCAL_8`
      party.position = new Position(newX, newY, level);
      const landed = this.resolveCellEffects(party.position, {
        objectType: PARTY_OBJECT_TYPE, objectPos: 0, facing: party.facing, allowFall: true, pretendTeleporter,
      }).position;
      unchangedRoom = landed.z === level && landed.x === oldX && landed.y === oldY;
      if (unchangedRoom) {
        if (party.facing === oldFacing) return;
      } else if (party.champions.length !== 0) {
        this.ctx.footprints.recordPartyMove(
          this.ctx.state.tickCount, landed.z, landed.x, landed.y, party.magicFootprintsActive !== 0, oldX, oldY,
        );
      }
    }
    const actuators = this.ctx.systems.actuators;
    if (oldX >= 0) {
      actuators.triggerObjectMove(new Position(oldX, oldY, level), OBJECT_ID_NULL, false, unchangedRoom, party.facing);
    }
    if (newX < 0) return;
    const at = party.position;
    const monster = this.dungeon.findFirstMonster(at);
    if (monster !== OBJECT_ID_EOF) {
      const monsterDamage = this.ctx.systems.monsterDamage;
      const dmp = deleteMonsterParameters(DeleteMonsterWhy.DMW_Movement2, -1);
      monsterDamage.processMonsterDeleteFilter(at.z, at.x, at.y, dmp);
      monsterDamage.dropMonsterRemains(at.z, at.x, at.y, monster, 1, at.z, dmp.dropResidue < 2);
      monsterDamage.deleteMonster(at.z, at.x, at.y);
    }
    if (at.z === level) {
      actuators.triggerObjectMove(at, OBJECT_ID_NULL, true, unchangedRoom, party.facing);
      if (!unchangedRoom) gatherThrownWeapons(this.ctx, at);
    } else {
      // `LoadLevel(AttachedLevel_4); d.newPartyLevel = sw(curLevel);` (`:3356-3358`).
      party.position = new Position(at.x, at.y, level);
      this.ctx.loop.newPartyLevel = at.z;
    }
  }

  /**
   * `MoveObject(object, oldX, oldY, newX, newY, NULL, NULL)`
   * (`doc/CSBwin-src/Code11f52.cpp:2831-3492`) for anything that is not the party, on
   * level `level` (`d.LoadedLevel`, CSBWin's `AttachedLevel_4`). `oldX < 0` places an
   * object that lies nowhere, `newX < 0` lifts one without placing it.
   *
   * A monster is `MonsterSystem.moveMonster`'s, which a lift here is handed to. *Placing*
   * one is the monster branch (`:3362-3459`), which its callers call directly; it is
   * refused here.
   *
   * What is placed goes through the teleporter / pit loop (`resolveCellEffects`); a
   * levitating thing — a missile, a flying monster — neither falls nor presses a pad
   * (`RemoveObjectFromRoom` / `AddObjectToRoom` instead of `PlaceOrRemoveObjectInRoom`,
   * `:3307-3309`, `:3462-3464`), and a cloud is not levitating (`Levitating`,
   * `:2452-2472`), so it falls. `PlaceOrRemoveObjectInRoom`'s `unchangedRoom` is whether
   * the party stands on the square (`:3313-3328`, `:3468-3483`). A teleporter turns an
   * object's corner only when `oldX != -1` (`:3035-3041`); stairs take anything but a
   * missile down and out, and turn its corner whatever `oldX` is (`:3143-3166`). The
   * missile's timer is its caller's business.
   *
   * Returns CSBWin's `1` as `removed` when `CheckMoveFromMissile` destroyed the group,
   * and otherwise the ID as it was placed and where, or `null` for a lift or an
   * unchanged room (`:3215-3250`). For a missile, `newDir` is `d.NewDir`: its timer's
   * direction as `TeleportMissile` left it (`:2926-2933`, `:2427-2446`). The timer is
   * the one its record names, which inside `MissileTimer` is the copy
   * (`TimerQueue.getTimer`).
   */
  moveObject(
    object: ObjectID,
    oldX: number,
    oldY: number,
    newX: number,
    newY: number,
    level: number,
  ): { removed: boolean; placed: ObjectID | null; position: Position | null; newDir?: number } {
    const decoded = this.dungeon.rnMaps.decode(object);
    const type = decoded.category;
    if (type === DBType.CREATURE) {
      if (newX >= 0) throw new Error('moveObject: placing a monster is MonsterSystem.moveMonster');
      const { code } = this.ctx.systems.monsters.moveMonster(object, oldX, oldY, newX, newY, level);
      return { removed: code !== 0, placed: null, position: null };
    }
    const party = this.ctx.party.state;
    const levitated = this.levitating(object);
    const partyOn = (x: number, y: number, z: number): boolean =>
      z === (party.position.z | 0) && x === (party.position.x | 0) && y === (party.position.y | 0);

    let moved = object;
    let destination: Position | null = null;
    let newDir: number | undefined;
    if (newX >= 0) {
      let missileDir: number | undefined;
      if (type === DBType.MISSILE) {
        const missile = this.dungeon.getMissileRecord(object);
        const word8 = missile ? this.timers.getTimerWord8(missile.timerIndex) : null;
        if (word8 !== null) missileDir = decodeMissileTimerWord8(word8).dir;
      }
      const result = this.resolveCellEffects(new Position(newX, newY, level), {
        objectType: type, objectPos: decoded.position, facing: party.facing, missileDir, allowFall: !levitated, oldX,
      });
      destination = result.position;
      newDir = result.missileDir;
      const corner = result.objectPos & 0x3;
      moved = this.dungeon.rnMaps.setPos(object, corner);
      const unchangedRoom = destination.z === level && destination.x === oldX && destination.y === oldY;
      if (unchangedRoom && corner === decoded.position && type !== DBType.MISSILE) {
        return { removed: false, placed: null, position: null };
      }
    }

    if (oldX >= 0) this.removeFromRoom(moved, oldX, oldY, level, levitated);
    if (!destination) return { removed: false, placed: null, position: null };

    this.dungeon.addObjectToCell(destination, moved);
    if (type !== DBType.MISSILE) {
      this.ctx.systems.actuators.triggerObjectMove(
        destination, moved, true, partyOn(destination.x, destination.y, destination.z), party.facing,
      );
    }
    return { removed: false, placed: moved, position: destination, newDir };
  }

  /**
   * The removal half of `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:3292-3331`), for an
   * object or a group: a levitating one through `RemoveObjectFromRoom`, any other through
   * `PlaceOrRemoveObjectInRoom`, which releases a pad, with `unchangedRoom` = "the party
   * stands here". `mmr` is a group's `pmmr` (`MonsterSystem.moveMonster`).
   */
  removeFromRoom(object: ObjectID, oldX: number, oldY: number, level: number, levitated: boolean, mmr?: MmRecord): void {
    const old = new Position(oldX, oldY, level);
    mmr?.objectRemoved(object);
    this.dungeon.removeObjectFromCell(old, object);
    if (levitated) return;
    const party = this.ctx.party.state.position;
    const partyThere = level === (party.z | 0) && oldX === (party.x | 0) && oldY === (party.y | 0);
    this.ctx.systems.actuators.triggerObjectMove(old, object, false, partyThere, this.ctx.party.state.facing);
  }

  /**
   * The loop of `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2931-3166`) for a monster,
   * for `MonsterSystem.moveMonster`: the destination taken through teleporter chains, pit
   * falls and stairs by the same `resolveCellEffects` the party and every object go through.
   *
   * `oldX, oldY` on `level` is where the group stands (`oldX < 0`: it is being placed
   * from nowhere). Its `ITEM16` is attached when that is the party's level and the group
   * is in the dungeon (`item16Attached`, `:2899`), and every teleporter of a chain
   * rotates the group through that `ITEM16`, however far the chain has taken it (`:3023`).
   *
   * The result is CSBWin's locals at the end of the loop:
   *
   * - `code` is `LOCAL_14`, set only by `TeleportMonster` (`:3023`): `groupIndex + 2`
   *   for a fear-state-6 group on the party's level, 1 for any other teleport, 0 when
   *   none happened. A pit fall leaves it alone.
   * - `audible` is `LOCAL_26`, whether the last teleporter buzzed (`:3000`).
   * - `groupDied` is `LOCAL_18` (`:3134-3135`): the fall killed the whole group, and
   *   the loop stopped at the square below.
   * - `corner` is `objD7.pos()`: the stairs turn it (`:3159-3165`), nothing else does.
   */
  resolveMonsterDestination(
    destination: Position,
    monsterRn: ObjectID,
    oldX: number,
    oldY: number,
    mmr?: MmRecord,
  ): { position: Position; code: number; audible: boolean; groupDied: boolean; corner: number } {
    const rec = this.dungeon.getCreatureRecord(monsterRn);
    const decoded = this.dungeon.rnMaps.decode(monsterRn);
    const canFall = !this.levitating(monsterRn);
    const facing = rec?.facing ?? 0;
    const partyLevel = this.ctx.party.state.position.z;
    const item16Attached = destination.z === partyLevel && oldX >= 0;
    const result = this.resolveCellEffects(destination, {
      objectType: DBType.CREATURE,
      objectPos: decoded.position & 0x3,
      facing,
      allowFall: canFall,
      monster: rec ? { record: rec, oldX, oldY, attachedLevel: destination.z, noItem16: !item16Attached, mmr } : undefined,
    });
    return {
      position: result.position,
      code: result.teleportCode,
      audible: result.teleportAudible,
      groupDied: result.groupDied,
      corner: result.objectPos,
    };
  }

  private resolveCellEffects(start: Position, move: CellEffectsMove): {
    position: Position;
    objectPos: number;
    facing: number;
    missileDir?: number;
    moved: boolean;
    teleportAudible: boolean;
    /** `LOCAL_14`: `TeleportMonster`'s value for the last teleport, else 0. */
    teleportCode: number;
    /** `LOCAL_18`: a pit fall killed the whole group. */
    groupDied: boolean;
  } {
    const { objectType, objectPos, facing, missileDir, allowFall, monster, pretendTeleporter, oldX } = move;
    let position = new Position(start.x, start.y, start.z);
    let curFacing = facing & 0x3;
    let curPos = objectPos & 0x3;
    let curDir = missileDir;
    let moved = false;
    let teleportCode = 0;
    let groupDied = false;
    // `LOCAL_26 = DB1A2->audible()` — remembered because it decides TT_60 vs TT_61
    // if the monster then has to wait for its destination (Code11f52.cpp:3000).
    let teleportAudible = false;
    let forcedTeleporter = pretendTeleporter ?? null;

    for (let step = 0; step < 1000; step++) {
      const teleporter = forcedTeleporter ?? this.getActiveTeleporterAt(position);
      if (forcedTeleporter) forcedTeleporter = null;
      const canTeleport = objectType === PARTY_OBJECT_TYPE || objectType >= DBType.CREATURE;
      if (teleporter && canTeleport && this.teleporterAllowsObject(teleporter, objectType)) {
        const destination = this.getTeleporterDestination(teleporter);
        if (!destination) break;

        const rotation = teleporter.rotation & 0x3;
        const prev = position;

        if (objectType === PARTY_OBJECT_TYPE) {
          curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          teleportAudible = teleporter.sound;
        } else if (objectType === DBType.MISSILE) {
          if (teleporter.absoluteRotation) {
            curDir = rotation;
          } else {
            curDir = ((curDir ?? 0) + rotation) & 0x3;
            curPos = (curPos + rotation) & 0x3;
          }
        } else if (objectType === DBType.CREATURE) {
          teleportAudible = teleporter.sound;
          // `QueueSound(17, newX, newY, 1)` before `TeleportMonster`, on the destination
          // level that `LoadLevel` has just loaded (`:2990`, `:3018-3021`).
          if (teleporter.sound) this.ctx.sounds.queueSound(SOUND_TELEPORT, destination.x, destination.y, 1, destination.z);
          const result = monster ? this.teleportMonster(monster, teleporter) : null;
          if (result) {
            curFacing = result.facing & 0x3;
            teleportCode = result.code;
          } else {
            curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          }
        } else {
          if (!teleporter.absoluteRotation && oldX !== -1) {
            curPos = (curPos + rotation) & 0x3;
          }
        }

        position = destination;
        moved = true;
        // `d.partyX = newX; d.partyY = newY;`, the buzz at the party's new square, and
        // `SetPartyFacing` at every jump (`:2993-3012`).
        if (objectType === PARTY_OBJECT_TYPE) {
          this.ctx.party.state.position = position;
          if (teleporter.sound) this.ctx.sounds.queueSound(SOUND_TELEPORT, position.x, position.y, 0, position.z);
          this.ctx.party.setFacing(curFacing);
        }
        if (isSamePosition(prev, position)) break;
        continue;
      }

      if (allowFall && this.isActivePitAt(position)) {
        // `PitGoesSomewhere` (`doc/CSBwin-src/Code11f52.cpp:2812`) is exactly this
        // test: a pit with nothing under it is not a pit.
        const next = this.dungeon.incrementLevel(position, 1);
        if (!next) break;
        position = next;
        moved = true;
        // `d.partyX = newX; d.partyY = newY;` (`:3088-3091`), so a champion the fall kills
        // drops what they carry where the party landed.
        if (objectType === PARTY_OBJECT_TYPE) this.ctx.party.state.position = position;
        // The fall hurts (`doc/CSBwin-src/Code11f52.cpp:3088-3141`). A group is hurt
        // at `oldX, oldY`, where it is still linked: nothing has moved in the database yet.
        if (objectType === PARTY_OBJECT_TYPE) this.partyFallsIntoPit();
        else if (objectType === DBType.CREATURE && monster) {
          const hurt = this.monsterFallsIntoPit(monster);
          groupDied = hurt === MonsterDamageResult.ALL_MONSTERS_DIED;
          if (groupDied) break;
          if (hurt === MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED) {
            this.ctx.systems.monsterDamage.flushPendingDroppings(monster.record.creatureType, position.z, position.x, position.y);
          }
        }
        continue;
      }

      // The stairs (`:3143-3166`): a monster or an object — not the party, not a missile
      // — goes one level down unless bit 2 says the stairs go up, then one square out
      // through `ExitStairsDirection`, its corner turned to face the stairs. The loop
      // goes on from the square it lands on.
      const cellFlag = this.dungeon.getCellFlag(position);
      if (getRoomType(cellFlag) === RoomType.STAIRS && objectType >= DBType.CREATURE && objectType !== DBType.MISSILE) {
        if ((cellFlag & 0x04) === 0) {
          // `IncrementLevel` finds no level only in a malformed dungeon, where CSBWin would
          // `LoadLevel(-1)`; the object stays on the stairs instead.
          const below = this.dungeon.incrementLevel(position, 1);
          if (!below) break;
          position = below;
        }
        const exit = this.dungeon.getExitStairsDirection(position, this.ctx.party.state.facing, this.ctx.tables);
        position = new Position(position.x + this.ctx.tables.deltaX[exit]!, position.y + this.ctx.tables.deltaY[exit]!, position.z);
        const back = (exit + 2) & 0x3;
        curPos = ((((curPos - back + 1) & 2) >> 1) + back) & 0x3;
        moved = true;
        continue;
      }

      break;
    }

    return {
      position, objectPos: curPos, facing: curFacing, missileDir: curDir, moved, teleportAudible, teleportCode, groupDied,
    };
  }

  private getActiveTeleporterAt(position: Position): TeleporterRecord | null {
    const map = this.dungeon.getMap(position.z);
    if (!map) return null;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return null;
    const roomType = getRoomType(cellFlag);
    if (roomType !== RoomType.TELEPORTER) return null;
    if ((cellFlag & 0x08) === 0) return null;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category !== DBType.TELEPORTER) continue;
      return this.dungeon.getTeleporterRecord(rn);
    }

    return null;
  }

  /**
   * `newX = DB1A2->destX(); newY = DB1A2->destY(); curLevel = DB1A2->destLevel();
   * LoadLevel(curLevel)` (`doc/CSBwin-src/Code11f52.cpp:2986-2990`): the teleporter names
   * its map by number, not by depth, and the square by that map's own coordinates. A map
   * the dungeon does not have, which CSBWin would load past its levels, leaves the object
   * where it is.
   */
  private getTeleporterDestination(teleporter: TeleporterRecord): Position | null {
    const map = teleporter.destMap & 0xff;
    if (map >= this.dungeon.getMapCount()) return null;
    return new Position(teleporter.destX & 0x1f, teleporter.destY & 0x1f, map);
  }

  private teleporterAllowsObject(teleporter: TeleporterRecord, objectType: number): boolean {
    const scope = teleporter.scope & 0x3;
    if (objectType === PARTY_OBJECT_TYPE) return scope === 2 || scope === 3;
    if (objectType === DBType.CREATURE) return scope === 1 || scope === 3;
    return scope === 0 || scope === 2 || scope === 3;
  }

  /**
   * `d.SupressPitDamage` (`doc/CSBwin-src/Data.h:805`) — set for the length of one
   * deliberate climb down a rope, which costs stamina instead of blood.
   */
  private supressPitDamage = false;

  /** Run `move` with `d.SupressPitDamage` set, as `atk_CLIMBDOWN` does. */
  withSupressedPitDamage<T>(move: () => T): T {
    this.supressPitDamage = true;
    try {
      return move();
    } finally {
      this.supressPitDamage = false;
    }
  }

  /**
   * The party falls (`doc/CSBwin-src/Code11f52.cpp:3092-3121`).
   *
   * A climb down costs each living champion stamina in proportion to how loaded they
   * are — `25 * load / MaxLoad + 1` — which `AdjustStamina` turns into real damage
   * only if it exhausts them. An uncontrolled fall is `DamageAllCharacters(20, 48, 2)`
   * instead: mask 48 is the legs and feet, kind 2 halves the armour.
   *
   * CSBWin clears the flag here, not at the call site, because one climb can fall
   * through a whole chain of pits and only the first drop is free.
   *
   * Public so that `tools/` can watch the party fall.
   */
  partyFallsIntoPit(): void {
    const party = this.ctx.party.state;
    if (party.champions.length === 0) return;

    if (this.supressPitDamage) {
      for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
        const champ = party.champions[chIdx];
        if (!champ) continue;
        if (!isAlive(champ)) continue;
        const maxLoad = this.ctx.systems.characterStats.maxLoad(champ);
        if (maxLoad <= 0) continue;
        const load = this.ctx.systems.characterStats.characterLoad(champ);
        // `(25 * load) & 0xffff` first — CSBWin does the multiply in a word.
        const cost = Math.trunc(((25 * load) & 0xffff) / maxLoad) + 1;
        this.ctx.systems.championDamage.adjustStamina(chIdx, cost);
      }
    } else {
      const hurt = this.ctx.systems.championDamage.damageAllCharacters(20, 48, 2);
      if (hurt !== 0) {
        this.ctx.sounds.queueSound(6, party.position.x, party.position.y, 0, party.position.z);
      }
    }
    this.supressPitDamage = false;
  }

  /**
   * A monster group falls (`doc/CSBwin-src/Code11f52.cpp:3123-3139`):
   * `DamageMonsterGroup(pDB4, oldX, oldY, 20, 0, !item16Attached)` on the level its
   * `ITEM16` belongs to. `P5 = 0` defers the last member's death to `MoveObject`, which
   * deletes the group after the loop, and a dead member's droppings to `TAG00b522`,
   * which drops them where the group landed. A group placed from nowhere (`oldX < 0`)
   * is hurt at `(-1, 0)`, so its death clouds are not made (`CreateCloud`, `:1435`).
   */
  private monsterFallsIntoPit(monster: MonsterMove): number {
    return this.ctx.systems.monsterDamage.damageMonsterGroup(
      monster.record, monster.attachedLevel, monster.oldX, monster.oldY, 20, false, monster.noItem16, monster.mmr,
    );
  }

  private isActivePitAt(position: Position): boolean {
    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    const roomType = getRoomType(cellFlag);
    if (roomType !== RoomType.PIT) return false;
    if ((cellFlag & 0x08) === 0) return false;
    return (cellFlag & 0x01) === 0;
  }

  /**
   * `Levitating` (`doc/CSBwin-src/Code11f52.cpp:2452`): a missile, or a flying monster,
   * which neither falls nor presses a pad.
   */
  levitating(object: ObjectID): boolean {
    const type = this.dungeon.rnMaps.dbType(object);
    if (type === DBType.MISSILE) return true;
    if (type !== DBType.CREATURE) return false;
    const rec = this.dungeon.getCreatureRecord(object);
    const desc = rec ? this.ctx.tables.monsterDesc[rec.creatureType] : undefined;
    return desc !== undefined && monsterLevitating(desc);
  }

  /**
   * `TeleportMonster` (`doc/CSBwin-src/Code11f52.cpp:2343-2422`) — turn the group, and
   * each member's corner, as the teleporter says. The facing and position bytes are
   * the `ITEM16`'s unless `noItem16`, whatever level the chain has reached: CSBWin
   * passes `AttachedLevel_4` and `!item16Attached` for every teleporter (`:3023`).
   *
   * Returns `groupIndex() + 2` for a fear-state-6 group whose attached level is the
   * party's — read after the write, so with `noItem16` it is the new position byte —
   * and 1 otherwise. Whether the monster may live on the destination level is not
   * this function's business: `MoveObject` asks after the loop (`:3182`).
   */
  private teleportMonster(
    move: MonsterMove,
    teleporter: TeleporterRecord,
  ): { facing: number; code: number } {
    const monster = move.record;
    const item16 = move.noItem16 ? null : this.getMonsterItem16(monster, move.attachedLevel);
    const useItem16 = item16 !== null;
    const rotation = teleporter.rotation & 0x3;
    const absolute = teleporter.absoluteRotation;

    let facings = useItem16 ? (item16.facings & 0xff) : groupFacingsByte(monster.facing);
    let positions = useItem16 ? (item16.positions & 0xff) : (monster.groupIndex & 0xff);

    let newFacings = absolute ? rotation : (facings + rotation) & 0x3;
    let newPositions = positions;

    if (positions !== 0xff) {
      const desc = this.ctx.tables.monsterDesc[monster.creatureType];
      const horizontalSize = desc ? monsterHorizontalSize(desc) : 0;
      const numMonM1 = monster.numMonM1 & 0x3;
      let facingShift = facings & 0xff;
      let posShift = positions & 0xff;
      let posDelta = (newFacings + 4 - facingShift) & 0x3;

      for (let idx = 0; idx <= numMonM1; idx++) {
        const facingValue = absolute ? rotation : (facingShift + rotation) & 0x3;
        newFacings = setPackedBits(newFacings, idx, facingValue);

        if (horizontalSize === 0) {
          posDelta = absolute ? 0 : 1;
          if (posDelta !== 0) posDelta = rotation;
        }

        if (posDelta !== 0) {
          const newPos = (posShift + posDelta) & 0x3;
          newPositions = setPackedBits(newPositions, idx, newPos);
        }

        facingShift >>= 2;
        posShift >>= 2;
      }
    }

    if (useItem16) {
      item16.facings = newFacings & 0xff;
      if (positions !== 0xff) item16.positions = newPositions & 0xff;
    } else {
      monster.facing = newFacings & 0x3;
      // With no ITEM16 attached, `groupIndex` is the packed positions byte.
      if (positions !== 0xff) monster.groupIndex = newPositions & 0xff;
    }

    const partyLevel = this.ctx.party.state.position.z;
    const code = move.attachedLevel === partyLevel && monster.fear === StateOfFear.StateOfFear6
      ? monster.groupIndex + 2
      : 1;
    return { facing: newFacings & 0x3, code };
  }

  private getMonsterItem16(monster: CreatureRecord, level: number): Item16Record | null {
    const partyLevel = this.ctx.party.state.position.z;
    if (level !== partyLevel) return null;
    return this.dungeon.getAttachedItem16(monster);
  }
}
