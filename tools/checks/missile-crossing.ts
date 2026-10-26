/**
 * A thrown object and a monster crossing head-on: the monster steps west from B into A
 * on the tick a falchion flying east is in A, before or after the missile's timer runs.
 *
 * Whichever goes first, CSBWin makes them meet when the monster is in the missile's lane:
 *
 *   - the monster first, from the corner of B away from A: it lands in A in the same
 *     corner (`MoveObject` keeps the group's positions byte), and the missile's next
 *     timer finds it there (`doc/CSBwin-src/Timer.cpp:258-272`);
 *   - the missile first: it enters B at the corner nearest A, and the monster leaving B
 *     meets it there (`CheckMoveFromMissile`, `doc/CSBwin-src/Code11f52.cpp:2737-2789`);
 *   - the monster first, from the corner of B nearest A: `CheckMoveFromMissile`'s second
 *     cell. The head of the column takes a half step into A, and meets a missile in A's
 *     corner across the boundary (`:2705-2724`, `:2791-2806`). The encounter is called
 *     with the monster's square as `objX, objY` and the missile's as `missileX, missileY`,
 *     and its monster arm looks the group up at the monster's square,
 *     `FindFirstMonster(objX, objY)` (`:1996`), not the missile's, where there is none.
 *
 * A monster in the other lane never meets it; one spread over its cell (positions 255)
 * always does. The scenario runs the cross on the tick the missile enters A, the tick it
 * moves to A's far corner, and the tick it leaves A.
 *
 * Run: `npm test -- --only=missile-crossing.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import type { ObjectID } from '../../src/core/types';
import type { Game } from '../../src/engine/Game';
import { MonsterType } from '../../src/engine/monsterTypes';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { monsterAbsorbsDaggersEtc, monsterHorizontalSize, monsterInvincible, monsterNonMaterial } from '../../src/data/tables/MonsterDesc';
import { graphicsTablesOf, newGame, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';
import { createMonsterAt } from '../lib/createMonster';
import { testChampion } from '../lib/champion';

const EAST = 1;
const WEAPON_FALCHION = 9;
const graphics = stockGraphics();
const objectTables = graphicsTablesOf(graphics).objects;
const roomType = (flags: number): number => (flags >> 5) & 0x7;

type Arena = { game: Game; L: Position; A: Position; B: Position; rn: ObjectID };

function makeArena(): Arena | null {
  const game = newGame(stockDungeon(), graphics);
  game.setRandomSeed(0x2468ace0);
  game.systems.hallOfChampions.addChampion(testChampion(0, {
    attributes: { health: 500, maxHealth: 500, stamina: 500, maxStamina: 500, mana: 0, maxMana: 0 },
  }));
  const d = game.ctx.dungeon;
  for (let level = 0; level < d.getMapCount(); level++) {
    const map = d.getMap(level)!;
    const open = (x: number, y: number): boolean => {
      const f = map.cellFlags[x]?.[y] ?? 0;
      return roomType(f) === RoomType.OPEN && (f & 0x10) === 0;
    };
    let row: Position | null = null;
    for (let x = 1; x + 2 < map.descriptor.width && !row; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        if (open(x, y) && open(x + 1, y) && open(x + 2, y)) { row = new Position(x, y, level); break; }
      }
    }
    if (!row) continue;
    let party: Position | null = null;
    for (let x = 1; x < map.descriptor.width - 1 && !party; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        if (Math.abs(y - row.y) >= 3 && open(x, y)) { party = new Position(x, y, level); break; }
      }
    }
    if (!party) continue;
    for (let type = 0; type < objectTables.monsterDesc.length; type++) {
      const desc = objectTables.monsterDesc[type];
      if (!desc || type === MonsterType.mon_BlackFlame || monsterHorizontalSize(desc) !== 0) continue;
      if (monsterNonMaterial(desc) || monsterInvincible(desc) || monsterAbsorbsDaggersEtc(desc)) continue;
      if (!d.monsterAllowedOnLevel(type, level)) continue;
      game.ctx.party.state.position = party;
      game.systems.monsters.loadPartyLevel(level);
      const B = new Position(row.x + 2, row.y, level);
      const rn = createMonsterAt(game, {
        value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 3,
        mapX: B.x, mapY: B.y, level, invisible: false, drawAsSize4: false,
      });
      if (rn === null) continue;
      d.getCreatureRecord(rn)!.hp[0] = 900;
      game.ctx.timers.deleteMonsterMovementTimers(B.x, B.y, level);
      return { game, L: row, A: new Position(row.x + 1, row.y, level), B, rn };
    }
  }
  return null;
}

function missileAt(game: Game, cell: Position): string {
  const d = game.ctx.dungeon;
  for (let o = d.findFirstObject(cell); o !== OBJECT_ID_EOF; o = d.getDBRecordLink(o)) {
    if (d.rnMaps.dbType(o) === DBType.MISSILE) {
      const t = game.ctx.timers.getTimer(d.getMissileRecord(o)!.timerIndex);
      return `corner ${d.rnMaps.pos(o)} ${t?.function === TimerFunction.TT_MISSILE0 ? 'M0' : 'M'}`;
    }
  }
  return '-';
}

function run(launchCorner: number, monsterCorner: number, crossTick: number, monsterFirst: boolean): { hit: boolean; trace: string } {
  const arena = makeArena()!;
  const { game, L, A, B, rn } = arena;
  const d = game.ctx.dungeon;
  const item16 = d.getAttachedItem16(d.getCreatureRecord(rn)!)!;
  item16.positions = monsterCorner;
  const db = d.getData().databases.weapons;
  db.records.push({
    nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
    cursed: false, important: false, weaponType: WEAPON_FALCHION,
  });
  db.count++;
  const falchion = d.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
  const t0 = game.ctx.state.tickCount;
  game.systems.magic.launchThrownMissile(falchion, L, launchCorner, EAST, 255, 255, 0, t0);
  const trace: string[] = [];
  for (let i = 0; i < 6; i++) {
    const cross = i === crossTick;
    if (cross && monsterFirst) game.systems.monsters.moveMonster(rn, B.x, B.y, A.x, A.y, A.z);
    game.systems.timer.processTimers();
    if (cross && !monsterFirst) game.systems.monsters.moveMonster(rn, B.x, B.y, A.x, A.y, A.z);
    trace.push(`t${i}: L ${missileAt(game, L)} | A ${missileAt(game, A)} | B ${missileAt(game, B)}`);
    game.ctx.state.tickCount++;
  }
  const hp = d.getCreatureRecord(rn)?.hp[0];
  return { hit: hp !== undefined && hp < 900, trace: trace.join('; ') };
}

function main(): void {
  if (!makeArena()) {
    check(false, 'a level with three open squares in a row and a plain monster');
    finish();
    return;
  }
  // Launched from L at corner 1 (north-east), the falchion flies along the north row;
  // from corner 2 (south-east), along the south row.
  for (const launchCorner of [1, 2]) {
    const lane = launchCorner === 1 ? [0, 1] : [2, 3];
    for (const monsterCorner of [0, 1, 2, 3, 255]) {
      const expected = monsterCorner === 255 || lane.includes(monsterCorner);
      for (const crossTick of [1, 2, 3]) {
        for (const monsterFirst of [true, false]) {
          const { hit, trace } = run(launchCorner, monsterCorner, crossTick, monsterFirst);
          const label = `${launchCorner === 1 ? 'north' : 'south'} lane, monster at corner ${monsterCorner} of B, ` +
            `cross at t${crossTick}, ${monsterFirst ? 'monster' : 'missile'} first`;
          console.log(`${label}: ${hit ? 'hit' : 'miss'}`);
          if (hit !== expected) console.log(`  ${trace}`);
          check(hit === expected, `${label}: ${expected ? 'they meet' : 'they pass'}`);
        }
      }
    }
  }
  finish();
}

main();
