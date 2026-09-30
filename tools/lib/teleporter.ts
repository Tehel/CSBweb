/**
 * Rig a teleporter for a scenario: a real teleporter record from `dungeon.dat` is taken
 * out of whatever cell holds it, put on `at`, opened to everything (scope 3), silenced,
 * aimed at `to` with no rotation, and `at` becomes an active teleporter square.
 */
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../../src/core/types';
import type { Game } from '../../src/engine/Game';

export function rigTeleporter(game: Game, at: Position, to: Position): void {
  const dungeon = game.ctx.dungeon;
  const records = dungeon.getData().databases.teleporters.records;
  const index = records.findIndex((r) => r.nextObject !== OBJECT_ID_NULL);
  const rn = ((DBType.TELEPORTER << 10) | index) as ObjectID;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, z);
        for (let o = dungeon.findFirstObject(p); o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) {
          if (decodeObjectID(o).category === DBType.TELEPORTER && decodeObjectID(o).index === index) {
            dungeon.removeObjectFromCell(p, o);
          }
        }
      }
    }
  }
  const rec = records[index]!;
  rec.scope = 3;
  rec.sound = false;
  rec.rotation = 0;
  rec.absoluteRotation = false;
  rec.destX = to.x;
  rec.destY = to.y;
  rec.destMap = dungeon.getMap(to.z)!.descriptor.level;
  dungeon.addObjectToCell(at, rn);
  const map = dungeon.getMap(at.z)!;
  map.cellFlags[at.x]![at.y] = (RoomType.TELEPORTER << 5) | 0x08 | (map.cellFlags[at.x]![at.y]! & 0x10);
}
