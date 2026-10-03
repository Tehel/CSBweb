/**
 * `MakeMoreRoomInDB` (`doc/CSBwin-src/Character.cpp:182-358`): a database is full and a new
 * object needs a record, so throw an object of that database out of the dungeon and hand
 * its record over. `FindEmptyDB<n>Entry` calls it when `FindEmptyDBEntry` finds no free
 * record (`CSBCode.cpp:4942-5084`); here, `DungeonState.findEmptyDBEntry` does.
 *
 * CSBWin first `Enlarge`s the database up to `db.Max`, 8000 records for most
 * (`data.cpp:813-876`, `CSB.h:1646`), and only a database at that size gets here. The
 * port's databases stop at 1024, the ten-bit index of its `ObjectID`, so its `Enlarge`
 * always fails at this point (`DEBT.md` D16).
 *
 * The sweep is the Atari original's (`TAG009d9e`). It goes level by level from
 * `d.LevelCleared[db]`, the level it last took from, leaving the party's level for last,
 * and there sparing the 11×11 squares around the party. In each square it walks the
 * floor chain, stopping at the first actuator that is not disabled, and takes the first
 * object of the database that is not `important()`: a monster group is deleted and drops
 * what it carries, a missile ends where it flies, an item is lifted out of the square.
 * Only floor chains are walked, never chests, possessions or the champions' hands.
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../core/types';
import { getActuatorType } from '../data/actuatorHelpers';
import type { GameContext } from './GameContext';

/**
 * `rnD5.pos(0)`, for a group or a missile, which `DeleteDBEntry` has thrown out with its
 * slot: CSBWin returns that free slot, which names no record, and `FindEmptyDB<n>Entry`'s
 * `GetRecordAddressDB<n>` then reads none (`doc/CSBwin-src/data.cpp:1011-1014`,
 * `CSBCode.cpp:4847`). The port names the freed record anew, `RN(dbType, index)`, as the
 * Atari original's RN, the record's own number, still named it (`DEBT.md` H). A record
 * `DeleteDBEntry` left alone, "Cloned!!!", keeps its slot, and that is returned.
 */
function freedRecord(ctx: GameContext, dbType: DBType, rn: ObjectID, index: number): ObjectID {
    const rnMaps = ctx.dungeon.rnMaps;
    if (rnMaps.dbType(rn) === dbType) return rnMaps.setPos(rn, 0);
    return rnMaps.rn(dbType, index);
}

/** `MakeMoreRoomInDB(dbType)`: the freed record's ID at corner 0, or `RNnul`. */
export function makeMoreRoomInDB(ctx: GameContext, dbType: DBType): ObjectID {
    const dungeon = ctx.dungeon;
    // `index = db.Enlarge(dbType); if (index != -1) return RN(dbType,index);` (`:214-218`):
    // the port's database is at its 1024 already.
    if (dbType === DBType.CLOUD) return OBJECT_ID_NULL;
    const party = ctx.party.state.position;
    const partyLevel = party.z | 0;
    const numLevel = dungeon.getMapCount();
    let level = ctx.levelCleared[dbType];
    if (partyLevel === level) {
        level++;
        if (level >= numLevel) level = 0;
    }
    const start = level;
    for (;;) {
        const size = dungeon.getMapDimensions(level)!;
        for (let x = 0; x < size.width; x++) {
            for (let y = 0; y < size.height; y++) {
                if (level === partyLevel && ((x - (party.x | 0) + 5) & 0xffff) <= 10
                    && ((y - (party.y | 0) + 5) & 0xffff) <= 10) continue;
                const at = new Position(x, y, level);
                for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
                    const type = ctx.dungeon.rnMaps.dbType(rn);
                    if (type === DBType.ACTUATOR) {
                        if (getActuatorType(dungeon.getActuatorRecord(rn)!) === 0) continue;
                        break;
                    }
                    if (type !== dbType) continue;
                    const index = dungeon.rnMaps.idx(rn);
                    switch (dbType) {
                        case DBType.CREATURE: {
                            // Designer-planted monsters stay.
                            if (dungeon.getCreatureRecord(rn)!.important) continue;
                            // `ProcessMonsterDeleteFilter(…, DMW_MakeRoom)` is not ported
                            // (`DEBT.md` G2), so `dropResidue` is its default, `0 < 2`. The
                            // delay of -1 drops what the group carries and no droppings.
                            const monsterDamage = ctx.systems.monsterDamage;
                            monsterDamage.dropMonsterRemains(level, x, y, rn, -1, level, true);
                            monsterDamage.deleteMonster(level, x, y);
                            ctx.levelCleared[dbType] = level & 0xff;
                            return freedRecord(ctx, dbType, rn, index);
                        }
                        case DBType.MISSILE: {
                            // `TAG00e156`: the missile's timer goes (`Code11f52.cpp:1545-1551`),
                            // then `RemoveObjectFromRoom` and `ProcessObjectFromMissile`, which
                            // the port's `processObjectFromMissile` does together.
                            ctx.timers.deleteTimer(dungeon.getMissileRecord(rn)!.timerIndex);
                            ctx.systems.timer.processObjectFromMissile(rn, null, at);
                            ctx.levelCleared[dbType] = level & 0xff;
                            return freedRecord(ctx, dbType, rn, index);
                        }
                        case DBType.CLOTHING:
                        case DBType.WEAPON:
                        case DBType.MISC:
                        case DBType.POTION: {
                            const important = dbType === DBType.CLOTHING ? dungeon.getClothingRecord(rn)!.important
                                : dbType === DBType.WEAPON ? dungeon.getWeaponRecord(rn)!.important
                                    : dbType === DBType.MISC ? dungeon.getMiscRecord(rn)!.important
                                        : dungeon.getPotionRecord(rn)!.important;
                            if (important) continue;
                            ctx.systems.worldMove.moveObject(rn, x, y, -1, 0, level);
                            break;
                        }
                        default:
                            // A text, scroll, chest, door or teleporter record is handed over
                            // where it lies, still in its chain (`default:` falls to
                            // `tag00a000`). No caller of the port asks for one.
                            break;
                    }
                    ctx.levelCleared[dbType] = level & 0xff;
                    return ctx.dungeon.rnMaps.setPos(rn, 0);
                }
            }
        }
        if (level === partyLevel || numLevel <= 1) {
            ctx.levelCleared[dbType] = level & 0xff;
            return OBJECT_ID_NULL;
        }
        do {
            level++;
            if (level >= numLevel) level = 0;
        } while (level === partyLevel);
        if (level === start) level = partyLevel;
    }
}
