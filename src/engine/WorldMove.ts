/**
 * `WorldMove` — the world `MoveObject(object, oldX, oldY, newX, newY, …)`
 * (`doc/CSBwin-src/Code11f52.cpp:2796-3457`), as the port cuts it up: `moveObject` for
 * anything but the party and a monster set down, `moveParty` for the party,
 * `resolveMonsterDestination` for `MonsterSystem.moveMonster`, all three through the one
 * teleporter / pit / stairs loop, `resolveCellEffects`. With it are what only that loop
 * calls: `TeleportMonster` (`:2308`), `Levitating` (`:2417`) and `PitGoesSomewhere`
 * (`:2777`), and `d.SupressPitDamage`.
 *
 * Not the DSA's ten-argument `MoveObject` (`MoveObject.cpp:721`), which is
 * `DsaSystem.moveObjectDsa`. A monster lifted on the party's level first meets the
 * missiles in its way through `CheckMoveFromMissile`, which is `MissileEncounter`'s.
 */
import { decodeObjectID, encodeObjectID, DBType, Direction, isSamePosition, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';
import type { CreatureRecord, Item16Record, TeleporterRecord } from '../data/dungeonTypes';
import { monsterHorizontalSize, monsterLevitating } from '../renderer/csbwin/ObjectTables';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { MonsterDamageResult } from './MonsterDamage';
import { DELTA_X, DELTA_Y } from './MonsterPerception';
import { setPackedBits } from './MonsterSystem';
import { StateOfFear } from './monsterTypes';
import { decodeMissileTimerWord8 } from './missileHelpers';
import { getPartyDistance } from './Party';
import type { TimerQueue } from './TimerQueue';

/**
 * What `MoveObject`'s loop knows about a monster group it is moving
 * (`doc/CSBwin-src/Code11f52.cpp:2796-3131`): where it stands (`oldX < 0`: nowhere
 * yet), the level its `ITEM16` belongs to (`AttachedLevel_4`), and whether it has none
 * (`!item16Attached`).
 */
interface MonsterMove {
  record: CreatureRecord;
  oldX: number;
  oldY: number;
  attachedLevel: number;
  noItem16: boolean;
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
   * (`doc/CSBwin-src/Code11f52.cpp:2796-3325`): the party moved on its own level, which
   * every caller has loaded (`d.LoadedLevel == d.partyLevel`). `oldX < 0` places the
   * party from nowhere (a step out of a stairwell, the arrival on a level), `newX < 0`
   * lifts it (the stairs). In CSBWin's order:
   *
   * - the missiles in the corners it leaves, `CheckMoveFromMissile(oldX, oldY, newX,
   *   newY)` with the cells as passed (`:2847-2853`), which end the move when one of
   *   them wiped out a group;
   * - the party set on the new square and taken through the teleporter and pit loop,
   *   its square and facing following every jump and fall (`:2854-3135`);
   * - nothing more when it is back on its square facing the same way (`:3194-3201`);
   * - a footprint when it left its square (`:3224-3247`);
   * - the old square's pads (`:3258-3268`), a monster where it landed deleted
   *   (`:3298-3308`), then the new square's pads (`:3309-3317`).
   *
   * On another level, CSBWin sets `d.newPartyLevel` instead of pressing the pads
   * (`:3319-3324`), and the top of the next tick places the party there. The port does
   * that at once, in `arriveOnPartyLevel` (DEBT.md C57).
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
      const landed = this.resolveCellEffects(
        party.position, -1, 0, party.facing, undefined, true, undefined, pretendTeleporter,
      ).position;
      unchangedRoom = landed.z === level && landed.x === oldX && landed.y === oldY;
      if (unchangedRoom) {
        if (party.facing === oldFacing) return;
      } else if (party.champions.length !== 0) {
        this.ctx.footprints.recordPartyMove(
          this.ctx.state.tickCount, landed.z, landed.x, landed.y, party.magicFootprintsActive !== 0,
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
      // `ProcessMonsterDeleteFilter` is not ported (DEBT.md G2), so `dropResidue` is its
      // default, `0 < 2`.
      const monsterDamage = this.ctx.systems.monsterDamage;
      monsterDamage.dropMonsterRemains(at.z, at.x, at.y, monster, 1, at.z, true);
      monsterDamage.deleteMonster(at.z, at.x, at.y);
    }
    if (at.z === level) {
      actuators.triggerObjectMove(at, OBJECT_ID_NULL, true, unchangedRoom, party.facing);
    } else {
      this.arriveOnPartyLevel();
    }
  }

  /**
   * `tag0006a4` (`doc/CSBwin-src/CSBCode.cpp:618-623`), which CSBWin runs at the top of
   * the tick after the party reached another level: `LoadPartyLevel(d.newPartyLevel)`,
   * then `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)`, which takes the party
   * through the square it stands on again, leaves a second footprint and presses its
   * pads. The port runs both as soon as the party is on the level, and leaves the
   * `DiscardAllInput` to the tick (`loadPartyLevelOnArrival`, DEBT.md C57).
   */
  arriveOnPartyLevel(): void {
    this.ctx.systems.monsters.loadPartyLevelOnArrival();
    const at = this.ctx.party.state.position;
    this.moveParty(-1, 0, at.x, at.y);
  }

  /**
   * `MoveObject(object, oldX, oldY, newX, newY, NULL, NULL)`
   * (`doc/CSBwin-src/Code11f52.cpp:2796-3457`) for anything that is not the party, on
   * level `level` (`d.LoadedLevel`, CSBWin's `AttachedLevel_4`). `oldX < 0` places an
   * object that lies nowhere, `newX < 0` lifts one without placing it.
   *
   * A monster may be lifted here — `CheckMoveFromMissile` on the party's level
   * (`:2847-2853`), then the removal (`:3258-3296`); nothing of the monster branch runs
   * for `newX < 0` (`:3297`). *Placing* a monster is that branch
   * (`:3327-3424`), which is `MonsterSystem.moveMonster`; it is refused here.
   *
   * What is placed goes through the teleporter / pit loop (`resolveCellEffects`); a
   * levitating thing — a missile, a flying monster — neither falls nor presses a pad
   * (`RemoveObjectFromRoom` / `AddObjectToRoom` instead of `PlaceOrRemoveObjectInRoom`,
   * `:3272-3274`, `:3427-3429`), and a cloud is not levitating (`Levitating`,
   * `:2417-2437`), so it falls. `PlaceOrRemoveObjectInRoom`'s `unchangedRoom` is whether
   * the party stands on the square (`:3278-3293`, `:3433-3448`). A teleporter turns an
   * object's corner only when `oldX != -1` (`:3000-3006`); stairs take anything but a
   * missile down and out, and turn its corner whatever `oldX` is (`:3108-3131`). The
   * missile's timer is its caller's business.
   *
   * Returns CSBWin's `1` as `removed` when `CheckMoveFromMissile` destroyed the group,
   * and otherwise the ID as it was placed and where, or `null` for a lift or an
   * unchanged room (`:3180-3215`). For a missile, `newDir` is `d.NewDir`: its timer's
   * direction as `TeleportMissile` left it (`:2891-2898`, `:2392-2411`). The timer is
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
    const decoded = decodeObjectID(object);
    const type = decoded.category;
    if (type === DBType.CREATURE && newX >= 0) {
      throw new Error('moveObject: placing a monster is MonsterSystem.moveMonster');
    }
    const party = this.ctx.party.state;
    const levitated = type === DBType.MISSILE
      || (type === DBType.CREATURE && this.isMonsterLevitating(this.dungeon.getCreatureRecord(object)));
    const partyOn = (x: number, y: number, z: number): boolean =>
      z === (party.position.z | 0) && x === (party.position.x | 0) && y === (party.position.y | 0);

    if (oldX >= 0 && type === DBType.CREATURE && level === (party.position.z | 0)) {
      const to = newX >= 0 ? new Position(newX, newY, level) : null;
      if (this.ctx.systems.missileEncounter.checkMonsterMoveFromMissile(new Position(oldX, oldY, level), to, object)) {
        return { removed: true, placed: null, position: null };
      }
    }

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
      const result = this.resolveCellEffects(
        new Position(newX, newY, level), type, decoded.position, party.facing, missileDir, !levitated, undefined, undefined, oldX,
      );
      destination = result.position;
      newDir = result.missileDir;
      const corner = result.objectPos & 0x3;
      moved = encodeObjectID(corner, type, decoded.index);
      const unchangedRoom = destination.z === level && destination.x === oldX && destination.y === oldY;
      if (unchangedRoom && corner === decoded.position && type !== DBType.MISSILE) {
        return { removed: false, placed: null, position: null };
      }
    }

    if (oldX >= 0) {
      const old = new Position(oldX, oldY, level);
      this.dungeon.removeObjectFromCell(old, object);
      if (!levitated) this.ctx.systems.actuators.triggerObjectMove(old, moved, false, partyOn(oldX, oldY, level), party.facing);
    }
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
   * The loop of `MoveObject` (`doc/CSBwin-src/Code11f52.cpp:2896-3131`) for a monster,
   * for `MonsterSystem.moveMonster`: the destination taken through teleporter chains, pit
   * falls and stairs by the same `resolveCellEffects` the party and every object go through.
   *
   * `oldX, oldY` on `level` is where the group stands (`oldX < 0`: it is being placed
   * from nowhere). Its `ITEM16` is attached when that is the party's level and the group
   * is in the dungeon (`item16Attached`, `:2864`), and every teleporter of a chain
   * rotates the group through that `ITEM16`, however far the chain has taken it (`:2988`).
   *
   * The result is CSBWin's locals at the end of the loop:
   *
   * - `code` is `LOCAL_14`, set only by `TeleportMonster` (`:2988`): `groupIndex + 2`
   *   for a fear-state-6 group on the party's level, 1 for any other teleport, 0 when
   *   none happened. A pit fall leaves it alone.
   * - `audible` is `LOCAL_26`, whether the last teleporter buzzed (`:2965`).
   * - `groupDied` is `LOCAL_18` (`:3099-3100`): the fall killed the whole group, and
   *   the loop stopped at the square below.
   * - `corner` is `objD7.pos()`: the stairs turn it (`:3124-3130`), nothing else does.
   */
  resolveMonsterDestination(
    destination: Position,
    monsterRn: ObjectID,
    oldX: number,
    oldY: number,
  ): { position: Position; code: number; audible: boolean; groupDied: boolean; corner: number } {
    const rec = this.dungeon.getCreatureRecord(monsterRn);
    const decoded = decodeObjectID(monsterRn);
    const canFall = !this.isMonsterLevitating(rec);
    const facing = rec?.facing ?? 0;
    const partyLevel = this.ctx.party.state.position.z;
    const item16Attached = destination.z === partyLevel && oldX >= 0;
    const result = this.resolveCellEffects(
      destination,
      DBType.CREATURE,
      decoded.position & 0x3,
      facing,
      undefined,
      canFall,
      rec ? { record: rec, oldX, oldY, attachedLevel: destination.z, noItem16: !item16Attached } : undefined,
    );
    return {
      position: result.position,
      code: result.teleportCode,
      audible: result.teleportAudible,
      groupDied: result.groupDied,
      corner: result.objectPos,
    };
  }

  private resolveCellEffects(
    start: Position,
    objectType: number,
    objectPos: number,
    facing: number,
    missileDir: number | undefined,
    allowFall: boolean,
    monster?: MonsterMove,
    pretendTeleporter?: TeleporterRecord,
    /** `MoveObject`'s `oldX`: -1 keeps an item's corner through a teleporter (`:3000-3006`). */
    oldX?: number,
  ): {
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
    let position = new Position(start.x, start.y, start.z);
    let curFacing = facing & 0x3;
    let curPos = objectPos & 0x3;
    let curDir = missileDir;
    let moved = false;
    let teleportCode = 0;
    let groupDied = false;
    // `LOCAL_26 = DB1A2->audible()` — remembered because it decides TT_60 vs TT_61
    // if the monster then has to wait for its destination (Code11f52.cpp:2965).
    let teleportAudible = false;
    let forcedTeleporter = pretendTeleporter ?? null;

    for (let step = 0; step < 1000; step++) {
      const teleporter = forcedTeleporter ?? this.getActiveTeleporterAt(position);
      if (forcedTeleporter) forcedTeleporter = null;
      const canTeleport = objectType < 0 || objectType >= DBType.CREATURE;
      if (teleporter && canTeleport && this.teleporterAllowsObject(teleporter, objectType)) {
        const destination = this.getTeleporterDestination(teleporter);
        if (!destination) break;

        const rotation = teleporter.rotation & 0x3;
        const prev = position;

        if (objectType === -1) {
          curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
          teleportAudible = teleporter.sound;
          if (teleporter.sound) {
            const distance = getPartyDistance(this.ctx.party.state, position.x, position.y, position.z);
            if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 0, distance);
          }
        } else if (objectType === DBType.MISSILE) {
          if (teleporter.absoluteRotation) {
            curDir = rotation;
          } else {
            curDir = ((curDir ?? 0) + rotation) & 0x3;
            curPos = (curPos + rotation) & 0x3;
          }
        } else if (objectType === DBType.CREATURE) {
          const result = monster ? this.teleportMonster(monster, teleporter) : null;
          if (result) {
            curFacing = result.facing & 0x3;
            teleportCode = result.code;
            teleportAudible = teleporter.sound;
            if (teleporter.sound) {
              const distance = getPartyDistance(this.ctx.party.state, position.x, position.y, position.z);
              if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 1, distance);
            }
          } else {
            curFacing = teleporter.absoluteRotation ? rotation : (curFacing + rotation) & 0x3;
            teleportAudible = teleporter.sound;
            if (teleporter.sound) {
              const distance = getPartyDistance(this.ctx.party.state, position.x, position.y, position.z);
              if (distance !== null) this.ctx.host.playSound(SoundIndex.TELEPORT, 1, distance);
            }
          }
        } else {
          if (!teleporter.absoluteRotation && oldX !== -1) {
            curPos = (curPos + rotation) & 0x3;
          }
        }

        position = destination;
        moved = true;
        // `d.partyX = newX; d.partyY = newY;` and `SetPartyFacing` at every jump (`:2958-2977`).
        if (objectType === -1) {
          this.ctx.party.state.position = position;
          this.ctx.party.setFacing(curFacing);
        }
        if (isSamePosition(prev, position)) break;
        continue;
      }

      if (allowFall && this.isActivePitAt(position)) {
        // `PitGoesSomewhere` (`doc/CSBwin-src/Code11f52.cpp:2777`) is exactly this
        // test: a pit with nothing under it is not a pit.
        const next = this.dungeon.incrementLevel(position, 1);
        if (!next) break;
        position = next;
        moved = true;
        // `d.partyX = newX; d.partyY = newY;` (`:3053-3056`), so a champion the fall kills
        // drops what they carry where the party landed.
        if (objectType === -1) this.ctx.party.state.position = position;
        // The fall hurts (`doc/CSBwin-src/Code11f52.cpp:3053-3106`). A group is hurt
        // at `oldX, oldY`, where it is still linked: nothing has moved in the database yet.
        if (objectType === -1) this.partyFallsIntoPit();
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

      // The stairs (`:3108-3131`): a monster or an object — not the party, not a missile
      // — goes one level down unless bit 2 says the stairs go up, then one square out
      // through `ExitStairsDirection`, its corner turned to face the stairs. The loop
      // goes on from the square it lands on.
      const cellFlag = this.dungeon.getCellFlag(position);
      if (((cellFlag >> 5) & 0x7) === RoomType.STAIRS && objectType >= DBType.CREATURE && objectType !== DBType.MISSILE) {
        if ((cellFlag & 0x04) === 0) {
          // `IncrementLevel` finds no level only in a malformed dungeon, where CSBWin would
          // `LoadLevel(-1)`; the object stays on the stairs instead.
          const below = this.dungeon.incrementLevel(position, 1);
          if (!below) break;
          position = below;
        }
        const exit = this.dungeon.getExitStairsDirection(position, this.ctx.party.state.facing as Direction);
        position = new Position(position.x + DELTA_X[exit]!, position.y + DELTA_Y[exit]!, position.z);
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
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.TELEPORTER) return null;
    if ((cellFlag & 0x08) === 0) return null;

    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      const decoded = decodeObjectID(rn);
      if (decoded.category !== DBType.TELEPORTER) continue;
      return this.dungeon.getTeleporterRecord(rn);
    }

    return null;
  }

  private getTeleporterDestination(teleporter: TeleporterRecord): Position | null {
    const destLevel = teleporter.destMap & 0xff;
    const destX = teleporter.destX & 0x1f;
    const destY = teleporter.destY & 0x1f;

    for (let idx = 0; idx < this.dungeon.getMapCount(); idx++) {
      const map = this.dungeon.getMap(idx as number);
      if (!map) continue;
      const desc = map.descriptor;
      if (desc.level !== destLevel) continue;
      if (destX < 0 || destY < 0) continue;
      if (destX >= desc.width || destY >= desc.height) continue;
      return new Position(destX, destY, idx as number);
    }

    return null;
  }

  private teleporterAllowsObject(teleporter: TeleporterRecord, objectType: number): boolean {
    const scope = teleporter.scope & 0x3;
    if (objectType === -1) return scope === 2 || scope === 3;
    if (objectType === DBType.CREATURE) return scope === 1 || scope === 3;
    return scope === 0 || scope === 2 || scope === 3;
  }

  /**
   * `d.SupressPitDamage` (`doc/CSBwin-src/Data.h:790`) — set for the length of one
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
   * The party falls (`doc/CSBwin-src/Code11f52.cpp:3057-3086`).
   *
   * A climb down costs each living champion stamina in proportion to how loaded they
   * are — `25 * load / MaxLoad + 1` — which `AdjustStamina` turns into real damage
   * only if it exhausts them. An uncontrolled fall is `DamageAllCharacters(20, 48, 2)`
   * instead: mask 48 is the legs and feet, kind 2 halves the armour.
   *
   * CSBWin clears the flag here, not at the call site, because one climb can fall
   * through a whole chain of pits and only the first drop is free.
   */
  private partyFallsIntoPit(): void {
    const party = this.ctx.party.state;
    if (party.champions.length === 0) return;

    if (this.supressPitDamage) {
      for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
        const champ = party.champions[chIdx];
        if (!champ) continue;
        if ((champ.attributes?.health ?? 0) === 0) continue;
        const maxLoad = this.ctx.systems.characterStats.maxLoad(champ);
        if (maxLoad <= 0) continue;
        const load = this.ctx.systems.characterStats.characterLoad(champ);
        // `(25 * load) & 0xffff` first — CSBWin does the multiply in a word.
        const cost = Math.trunc(((25 * load) & 0xffff) / maxLoad) + 1;
        this.ctx.systems.monsterAttack.adjustStamina(chIdx, cost);
      }
    } else {
      const hurt = this.ctx.systems.monsterAttack.damageAllCharacters(20, 48, 2);
      if (hurt !== 0) {
        this.ctx.sounds.queueSound(6, party.position.x, party.position.y, 0);
      }
    }
    this.supressPitDamage = false;
  }

  /**
   * A monster group falls (`doc/CSBwin-src/Code11f52.cpp:3088-3104`):
   * `DamageMonsterGroup(pDB4, oldX, oldY, 20, 0, !item16Attached)` on the level its
   * `ITEM16` belongs to. `P5 = 0` defers the last member's death to `MoveObject`, which
   * deletes the group after the loop, and a dead member's droppings to `TAG00b522`,
   * which drops them where the group landed. A group placed from nowhere (`oldX < 0`)
   * is hurt at `(-1, 0)`, so its death clouds are not made (`CreateCloud`, `:1400`).
   */
  private monsterFallsIntoPit(monster: MonsterMove): number {
    return this.ctx.systems.monsterDamage.damageMonsterGroup(
      monster.record, monster.attachedLevel, monster.oldX, monster.oldY, 20, false, monster.noItem16,
    );
  }

  private isActivePitAt(position: Position): boolean {
    const map = this.dungeon.getMap(position.z);
    if (!map) return false;
    const cellFlag = map.cellFlags[position.x]?.[position.y];
    if (cellFlag === undefined) return false;
    const roomType = (cellFlag >> 5) & 0x7;
    if (roomType !== RoomType.PIT) return false;
    if ((cellFlag & 0x08) === 0) return false;
    return (cellFlag & 0x01) === 0;
  }

  private isMonsterLevitating(rec: CreatureRecord | null): boolean {
    if (!rec) return false;
    const desc = this.ctx.tables.monsterDesc[rec.creatureType];
    if (!desc) return false;
    return monsterLevitating(desc);
  }

  /**
   * `TeleportMonster` (`doc/CSBwin-src/Code11f52.cpp:2308-2387`) — turn the group, and
   * each member's corner, as the teleporter says. The facing and position bytes are
   * the `ITEM16`'s unless `noItem16`, whatever level the chain has reached: CSBWin
   * passes `AttachedLevel_4` and `!item16Attached` for every teleporter (`:2988`).
   *
   * Returns `groupIndex() + 2` for a fear-state-6 group whose attached level is the
   * party's — read after the write, so with `noItem16` it is the new position byte —
   * and 1 otherwise. Whether the monster may live on the destination level is not
   * this function's business: `MoveObject` asks after the loop (`:3147`).
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

    let facings = useItem16 ? (item16!.facings & 0xff) : this.encodeFacingByte(monster.facing);
    let positions = useItem16 ? (item16!.positions & 0xff) : (monster.groupIndex & 0xff);

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
      item16!.facings = newFacings & 0xff;
      if (positions !== 0xff) item16!.positions = newPositions & 0xff;
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

  private encodeFacingByte(facing: number): number {
    const face = facing & 0x3;
    return (face | (face << 2) | (face << 4) | (face << 6)) & 0xff;
  }
}
