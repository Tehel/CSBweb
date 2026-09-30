/**
 * What `MoveObject` returns for a monster, and what its callers do with it
 * (`doc/CSBwin-src/Code11f52.cpp:2796-3424`; DEBT.md C24).
 *
 *  1. A teleport on the party's level returns 1 — `LOCAL_14` is `TeleportMonster`'s
 *     value (`:2988`, `:2384`) — starts the group's timers where it lands and deletes
 *     those at the square it left (`:3401-3421`).
 *  2. The AI stops on it: every `MoveObject` caller in the AI returns on a non-zero
 *     value and re-aims `timer_70` only when it is 0, and then at `d.NewX, d.NewY`
 *     (`Monster.cpp:2440-2449`). The port went on, re-aimed its timer at the teleporter
 *     and set `ubPrevX/Y`.
 *  3. A teleport onto the party's level from another is `LOCAL_14 = 1` plus the attach's
 *     `LOCAL_14++` (`:3376`), so 2, and `ClearAttacking_DeleteMovementTimers` runs on
 *     `d.Item16[0]` (`:3411-3413`) — another group's slot, a CSBWin quirk kept.
 *  4. A pit that kills the whole group: `DamageMonsterGroup(…, oldX, oldY, 20, P5 = 0,
 *     …)` defers the death (`:3095-3100`), and `MoveObject` deletes the group after the
 *     loop (`:3147-3176`). The port applied the damage at the pit square, where no group
 *     stood, so nothing was deleted and the group walked on below.
 *  5. A teleporter to a level the group's type may not live on: the teleport happens and
 *     the group is deleted after the loop (`:3147`). The port refused the teleport and
 *     left the group on the teleporter.
 *  6. `CreateMonster` on the party's level returns `RNnul` and makes no sound, because
 *     the attach makes `MoveObject` return 1 (`Monster.cpp:222-231`); a generator queues
 *     its own sound when it is audible (`Timer.cpp:1797-1800`).
 *
 * The squares are real open squares of `dungeon.dat`; the teleporters are real teleporter
 * records moved onto them and re-aimed, and the pit is a real one.
 *
 * Run: `npx tsx tools/dump-monster-move-code.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { SMS_ATTACKING } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import type { AiConst, AiFrame } from '../src/engine/MonsterAI';
import { TimerFunction } from '../src/engine/TimerQueue';
import { monsterLevitating } from '../src/data/tables/MonsterDesc';
import { graphicsTablesOf, newGame } from './lib/game';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { rigTeleporter } from './lib/teleporter';

const DELTAS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

async function main(): Promise<void> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const objectTables = graphicsTablesOf(graphics).objects;
  const walks = (type: number): boolean => !monsterLevitating(objectTables.monsterDesc[type]!);

  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    const game = newGame(data, graphics);
    game.setRandomSeed(0x12345678);
    return game;
  };

  const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  const roomType = (game: Game, p: Position): number => (game.ctx.dungeon.getCellFlag(p) >> 5) & 7;
  const inBounds = (game: Game, p: Position): boolean => {
    const map = game.ctx.dungeon.getMap(p.z);
    return !!map && p.x >= 0 && p.y >= 0 && p.x < map.descriptor.width && p.y < map.descriptor.height;
  };
  const emptyOpen = (game: Game, p: Position): boolean =>
    inBounds(game, p) && roomType(game, p) === RoomType.OPEN && game.ctx.dungeon.findFirstObject(p) === OBJECT_ID_EOF;
  /** Empty open squares of level `z`, in scan order, none of them in `not`. */
  const opens = (game: Game, z: number, not: Position[] = []): Position[] => {
    const map = game.ctx.dungeon.getMap(z)!;
    const out: Position[] = [];
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, z);
        if (emptyOpen(game, p) && !not.some((q) => same(p, q))) out.push(p);
      }
    }
    return out;
  };
  /** An empty open square of `z` with an empty open neighbour: `[square, neighbour]`. */
  const pairOn = (game: Game, z: number, not: Position[] = []): [Position, Position] => {
    for (const p of opens(game, z, not)) {
      for (const [dx, dy] of DELTAS) {
        const n = new Position(p.x + dx, p.y + dy, z);
        if (emptyOpen(game, n) && !not.some((q) => same(n, q))) return [p, n];
      }
    }
    throw new Error(`no two open squares side by side on level ${z}`);
  };
  const typeOn = (game: Game, ...levels: number[]): number => {
    for (let t = 0; t < 27; t++) {
      if (walks(t) && levels.every((z) => game.ctx.dungeon.monsterAllowedOnLevel(t, z))) return t;
    }
    return -1;
  };
  const partyOn = (game: Game, z: number, not: Position[]): void => {
    const far = opens(game, z, not).find((p) => not.every((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 4));
    if (!far) throw new Error(`nowhere to stand the party on level ${z}`);
    game.ctx.party.state.position = far;
    game.systems.monsters.loadPartyLevel(z);
  };
  const teleporter = rigTeleporter;
  const aiTimersAt = (game: Game, p: Position): number => game.ctx.timers.getTimers().filter((t) =>
    t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
    && t.uByte6 === p.x && t.uByte7 === p.y && t.level === p.z).length;
  const make = (game: Game, type: number, at: Position, members = 1): ObjectID => {
    const rn = createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: members - 1, facing: 0,
      mapX: at.x, mapY: at.y, level: at.z, invisible: false, drawAsSize4: false,
    });
    if (rn === null) throw new Error(`could not make a type-${type} group at (${at.x},${at.y}) L${at.z}`);
    return rn;
  };
  const levelWith = (game: Game, ok: (z: number) => boolean): number => {
    for (let z = 0; z < game.ctx.dungeon.getMapCount(); z++) if (ok(z)) return z;
    throw new Error('no level fits');
  };
  const anyGroupAt = (game: Game, p: Position): boolean => game.ctx.dungeon.findFirstMonster(p) !== OBJECT_ID_EOF;

  /* ------------------------------------ 1-2. a teleport, and the AI step onto it ---- */
  {
    const game = await makeGame();
    const z = levelWith(game, (l) => typeOn(game, l) >= 0);
    const [tp, from] = pairOn(game, z);
    const dest = opens(game, z, [tp, from]).find((p) => Math.abs(p.x - tp.x) + Math.abs(p.y - tp.y) > 3)!;
    partyOn(game, z, [tp, from, dest]);
    teleporter(game, tp, dest);
    const rn = make(game, typeOn(game, z), from);
    const before = aiTimersAt(game, from);
    const moved = game.systems.monsters.moveMonster(rn, from.x, from.y, tp.x, tp.y, z);
    console.log(`1. (${from.x},${from.y}) -> teleporter (${tp.x},${tp.y}) -> (${dest.x},${dest.y}) L${z}: code ${moved.code}, `
      + `at (${moved.position.x},${moved.position.y}), AI timers ${before} at the old square -> ${aiTimersAt(game, from)}, `
      + `${aiTimersAt(game, dest)} where it landed`);
    check(moved.code === 1, 'a teleport returns 1 (TeleportMonster)');
    check(same(moved.position, dest) && anyGroupAt(game, dest), 'the group is where the teleporter sent it');
    check(before > 0 && aiTimersAt(game, from) === 0 && aiTimersAt(game, dest) > 0,
      'its timers start where it landed and are gone from where it was');

    // The same step taken by the AI (`Monster.cpp:2440-2449`).
    const game2 = await makeGame();
    partyOn(game2, z, [tp, from, dest]);
    teleporter(game2, tp, dest);
    const rn2 = make(game2, typeOn(game2, z), from);
    const monster = game2.ctx.dungeon.getCreatureRecord(rn2)!;
    const slot = game2.ctx.dungeon.getAttachedItem16(monster)!;
    slot.ubPrevX = 77;
    slot.ubPrevY = 77;
    const timer = { uByte6: from.x, uByte7: from.y, level: z } as AiFrame['timer'];
    const frame = { timer, timePerMove: 0, sinceLastUpdate: 0, bool36: false } as unknown as AiFrame;
    const c = { monsterRn: rn2, monster, slot, mapX: from.x, mapY: from.y, level: z } as unknown as AiConst;
    const ai = game2.systems.monsterAI as unknown as { stepOrDefer(f: AiFrame, c: AiConst, x: number, y: number): boolean };
    const goOn = ai.stepOrDefer(frame, c, tp.x, tp.y);
    console.log(`2. the AI steps onto it: goes on ${goOn}, timer_70 at (${timer.uByte6},${timer.uByte7}), `
      + `ubPrev (${slot.ubPrevX},${slot.ubPrevY})`);
    check(!goOn, 'the AI stops on a non-zero MoveObject');
    check(timer.uByte6 === from.x && timer.uByte7 === from.y, 'and does not re-aim timer_70');
    check(slot.ubPrevX === 77 && slot.ubPrevY === 77, 'nor set ubPrevX/Y');
  }

  /* ------------------------------ 3. a teleport onto the party's level: slot 0 ---- */
  {
    const game = await makeGame();
    const count = game.ctx.dungeon.getMapCount();
    let a = -1;
    let b = -1;
    for (let i = 0; i < count && a < 0; i++) {
      for (let j = 0; j < count && a < 0; j++) if (i !== j && typeOn(game, i, j) >= 0) { a = i; b = j; }
    }
    const type = typeOn(game, a, b);
    const dest = opens(game, a)[0]!;
    partyOn(game, a, [dest]);
    const [tp, from] = pairOn(game, b);
    teleporter(game, tp, dest);
    const rn = make(game, type, from);
    const slot0 = game.ctx.dungeon.getItem16Pool()[0]!;
    const owner = slot0.word0;
    for (let i = 0; i < 4; i++) slot0.singleMonsterStatus[i] = (slot0.singleMonsterStatus[i] ?? 0) | SMS_ATTACKING;
    const moved = game.systems.monsters.moveMonster(rn, from.x, from.y, tp.x, tp.y, b);
    const mine = game.ctx.dungeon.getCreatureRecord(rn)!.groupIndex;
    const attacking = slot0.singleMonsterStatus.filter((s) => (s & SMS_ATTACKING) !== 0).length;
    console.log(`3. L${b} teleporter -> party's L${a}: code ${moved.code}, the group took slot ${mine}; `
      + `slot 0 (group ${owner}) members still attacking: ${attacking}`);
    check(moved.code === 2, "a teleport onto the party's level is 1, and the attach adds 1");
    check(owner >= 0 && mine !== 0, 'slot 0 belongs to another group');
    check(attacking === 0, "ClearAttacking_DeleteMovementTimers clears slot 0's attacking bits");
  }

  /* -------------------------------------------- 4. a pit that kills the group ---- */
  {
    const game = await makeGame();
    const dungeon = game.ctx.dungeon;
    let found: { pit: Position; from: Position; below: Position; type: number } | null = null;
    for (let z = 0; z < dungeon.getMapCount() && !found; z++) {
      const map = dungeon.getMap(z)!;
      for (let x = 0; x < map.descriptor.width && !found; x++) {
        for (let y = 0; y < map.descriptor.height && !found; y++) {
          const pit = new Position(x, y, z);
          const flag = dungeon.getCellFlag(pit);
          if (((flag >> 5) & 7) !== RoomType.PIT || (flag & 0x08) === 0 || (flag & 0x01) !== 0) continue;
          const below = dungeon.incrementLevel(pit, 1);
          if (!below) continue;
          const type = typeOn(game, z, below.z);
          if (type < 0 || anyGroupAt(game, below)) continue;
          for (const [dx, dy] of DELTAS) {
            const from = new Position(x + dx, y + dy, z);
            if (emptyOpen(game, from)) { found = { pit, from, below, type }; break; }
          }
        }
      }
    }
    if (!found) throw new Error('no open pit with a floor below and an open square beside it');
    const { pit, from, below, type } = found;
    partyOn(game, pit.z, [pit, from]);
    const rn = make(game, type, from);
    const monster = dungeon.getCreatureRecord(rn)!;
    const slot = monster.groupIndex;
    monster.hp[0] = 1;
    const moved = game.systems.monsters.moveMonster(rn, from.x, from.y, pit.x, pit.y, pit.z);
    const freed = dungeon.getItem16Pool()[slot]!.word0 < 0;
    console.log(`4. a 1-HP group (${from.x},${from.y}) -> pit (${pit.x},${pit.y}) L${pit.z} -> (${below.x},${below.y}) L${below.z}: `
      + `code ${moved.code}, a group below ${anyGroupAt(game, below)}, beside ${anyGroupAt(game, from)}, `
      + `record freed ${monster.nextObject === OBJECT_ID_NULL}, ITEM16 freed ${freed}`);
    check(moved.code === 1, 'the move returns 1');
    check(!anyGroupAt(game, below) && !anyGroupAt(game, from) && !anyGroupAt(game, pit), 'the group is nowhere');
    check(monster.nextObject === OBJECT_ID_NULL && freed, 'its record and ITEM16 slot are freed');
  }

  /* ------------------------------ 5. a teleporter to a level it may not live on ---- */
  {
    const game = await makeGame();
    const count = game.ctx.dungeon.getMapCount();
    let z = -1;
    let bad = -1;
    for (let i = 0; i < count && z < 0; i++) {
      const t = typeOn(game, i);
      if (t < 0) continue;
      for (let j = 0; j < count; j++) if (!game.ctx.dungeon.monsterAllowedOnLevel(t, j)) { z = i; bad = j; break; }
    }
    const type = typeOn(game, z);
    const [tp, from] = pairOn(game, z);
    const dest = opens(game, bad)[0]!;
    partyOn(game, z, [tp, from]);
    teleporter(game, tp, dest);
    const rn = make(game, type, from);
    const monster = game.ctx.dungeon.getCreatureRecord(rn)!;
    const moved = game.systems.monsters.moveMonster(rn, from.x, from.y, tp.x, tp.y, z);
    console.log(`5. type ${type} (${from.x},${from.y}) L${z} -> teleporter -> (${dest.x},${dest.y}) L${bad}, where it is not allowed: `
      + `code ${moved.code}, on the teleporter ${anyGroupAt(game, tp)}, beside it ${anyGroupAt(game, from)}, `
      + `at the destination ${anyGroupAt(game, dest)}, record freed ${monster.nextObject === OBJECT_ID_NULL}`);
    check(moved.code === 1, 'the move returns 1');
    check(!anyGroupAt(game, tp) && !anyGroupAt(game, from) && !anyGroupAt(game, dest), 'the group is nowhere');
    check(monster.nextObject === OBJECT_ID_NULL, 'its record is freed');
  }

  /* --------------------------------- 6. CreateMonster on the party's level ---- */
  {
    const game = await makeGame();
    const z = levelWith(game, (l) => typeOn(game, l) >= 0);
    const at = opens(game, z)[0]!;
    partyOn(game, z, [at]);
    const sounds: number[] = [];
    const queue = game.ctx.sounds.queueSound.bind(game.ctx.sounds);
    game.ctx.sounds.queueSound = (ordinal, x, y, dt, level) => { sounds.push(ordinal); queue(ordinal, x, y, dt, level); };
    const made = game.systems.monsters.createMonster({
      value: typeOn(game, z), hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: at.x, mapY: at.y, level: z, invisible: false, drawAsSize4: false,
    });
    console.log(`6. CreateMonster at (${at.x},${at.y}) on the party's L${z}: returned ${made}, group there ${anyGroupAt(game, at)}, `
      + `sounds [${sounds.join(',')}]`);
    check(made === null && anyGroupAt(game, at), "it returns RNnul, although the group is there");
    check(sounds.length === 0, 'and queues no sound');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
