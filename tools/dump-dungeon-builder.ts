/**
 * `tools/lib/dungeonBuilder.ts`, the dungeon taken apart and put back together, against
 * DM's own: the builder a merged dungeon is made with (`tools/build-theron-quest.ts`),
 * proven on a dungeon this repository holds.
 *
 * 1. DM's `dungeon.dat`, decomposed, composed, written (`buildDungeonFile`) and read back,
 *    is the same dungeon: every level, square, chain, record and text, the links and
 *    indices aside (`canonical`). Composed twice, the same bytes.
 * 2. A new game on it plays as one on the original: the same champion and moves, the
 *    party where the original's is at every eighth tick, and the dungeon the same at the
 *    end, monsters and all.
 * 3. A level grown on its north and west sides (`growLevel`): each square keeps its place
 *    in the dungeon, every actuator aimed on the level and every teleporter aimed into it
 *    follows, and a party set down on the same square of the dungeon walks the same way.
 * 4. DSAs (`BWorld.dsas`, `BLevel.dsaSelectors`, `dsaActuator`): DM's dungeon given a DSA
 *    and a wall decoration of `CSBgraphics.dat`, written and read back, is the same world,
 *    `DSAIndex`, `DSALevelIndex`, the actuators' selectors, states and parameters. In
 *    play, a pad aimed at the DSA's square runs it at each step on, which flips the DSA's
 *    state, kept by its actuator (local state 0), from 0 to 1 and back.
 *
 * Run: `npm test -- --only=dump-dungeon-builder.ts`
 */
import { DBType, Direction, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { ActuatorAction } from '../src/data/actuatorHelpers';
import { buildDungeonFile } from '../src/data/DungeonFileWriter';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { ActuatorRecord, DungeonData, TeleporterRecord } from '../src/data/dungeonTypes';
import type { Game } from '../src/engine/Game';
import { MovementAction } from '../src/engine/gameTypes';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { next } from './lib/dsa';
import {
  actuator, actuatorAims, canonical, compose, decompose, DSA_GRAPHIC, DSA_NONE, dsaActuator, growLevel, squaresOf, type BWorld,
} from './lib/dungeonBuilder';
import { newGame, runVbl, stockDungeon, stockGraphics, TICK_DUE } from './lib/game';

const reread = (data: DungeonData): DungeonData =>
  new DungeonLoader().loadDungeonDat(buildDungeonFile(data, { dmRules: true }));

/** A game on `data`, the party set down at `at` if given, a champion, then `moves`. */
function play(data: DungeonData, at: Position | null, moves: MovementAction[], ticks: number): { game: Game; trace: string[] } {
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x2468ace0);
  game.systems.hallOfChampions.addChampion(testChampion(0));
  if (at) game.ctx.party.state.position = at;
  const trace: string[] = [];
  const party = game.ctx.party.state;
  for (let n = 0; n < moves.length * 8 + ticks; n++) {
    if (n % 8 === 0) {
      const map = game.ctx.dungeon.getData().maps[party.position.z].descriptor;
      trace.push(`${party.position.z}:${map.offsetX + party.position.x},${map.offsetY + party.position.y}/${party.facing}`);
      if (n / 8 < moves.length) game.enqueueMovement(moves[n / 8]);
    }
    runVbl(game, TICK_DUE);
  }
  return { game, trace };
}

const WALK = [MovementAction.TURN_RIGHT, MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD,
  MovementAction.TURN_LEFT, MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD, MovementAction.TURN_LEFT,
  MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD];

function rebuilt(): void {
  console.log('=== DM, decomposed and composed ===');
  const original = stockDungeon();
  const world = decompose(original);
  const composed = compose(world);
  const back = reread(composed);
  const bytes = buildDungeonFile(composed, { dmRules: true });
  const again = buildDungeonFile(compose(decompose(stockDungeon())), { dmRules: true });
  console.log(['levels', world.levels.length, 'slots', original.rnMaps.length, '->', composed.rnMaps.length,
    'records', original.header.objectCounts.slice(0, 11).join(' '), '->', composed.header.objectCounts.slice(0, 11).join(' '),
    'file', bytes.length].join(' '));
  check(canonical(decompose(back)) === canonical(world), 'written and read back, it is DM\'s dungeon, square for square');
  check(bytes.length === again.length && bytes.every((b, i) => b === again[i]), 'and composed twice, the same bytes');

  const a = play(stockDungeon(), null, WALK, 400);
  const b = play(reread(composed), null, WALK, 400);
  console.log(['original', a.trace.slice(-1)[0], 'rebuilt', b.trace.slice(-1)[0], 'tick', a.game.ctx.state.tickCount].join(' '));
  check(a.trace.join(' ') === b.trace.join(' '), `a new game on it walks as the original's: ${a.trace.length} places`);
  check(canonical(decompose(a.game.ctx.dungeon.getData())) === canonical(decompose(b.game.ctx.dungeon.getData())),
    'and after 480 ticks the dungeon is the same, monsters and all');
  console.log('');
}

/** Level `z`'s actuator targets and the teleporters aimed into it, in the dungeon's own squares. */
function aims(world: BWorld, z: number): string[] {
  const out: string[] = [];
  const d = world.levels[z].descriptor;
  for (const [x, y, chain] of squaresOf(world.levels[z])) {
    const stone = (world.levels[z].cellFlags[x][y] >> 5) === 0;
    for (const object of chain) {
      if (object.db !== 3 || !actuatorAims(object.record as ActuatorRecord, stone)) continue;
      const word6 = (object.record as ActuatorRecord).word6;
      out.push(`${d.offsetX + x},${d.offsetY + y} ${(object.record as ActuatorRecord).word2} -> ` +
        `${d.offsetX + ((word6 >> 6) & 31)},${d.offsetY + ((word6 >> 11) & 31)}`);
    }
  }
  world.levels.forEach((level, from) => {
    for (const [x, y, chain] of squaresOf(level)) {
      for (const object of chain) {
        const t = object.record as TeleporterRecord;
        const o = level.descriptor;
        if (object.db === 1 && t.destMap === z) {
          out.push(`${from}:${o.offsetX + x},${o.offsetY + y} => ${d.offsetX + t.destX},${d.offsetY + t.destY}`);
        }
      }
    }
  });
  return out;
}

function grown(): void {
  console.log('=== DM\'s level 6, grown one row north and two columns west ===');
  const z = 6;
  const world = decompose(stockDungeon());
  const before = aims(world, z);
  const { offsetX, offsetY, width, height } = world.levels[z].descriptor;
  const squares = world.levels[z].cells.map((column) => JSON.stringify(column));
  growLevel(world, z, 'north', 1, 0);
  growLevel(world, z, 'west', 2, 0);
  const d = world.levels[z].descriptor;
  const after = aims(world, z);
  // Nothing on the level is an actuator that does not aim at its own; the ones that do,
  // in the dungeon's squares, are where they were, and so are the teleporters' arrivals.
  const shiftedSquares = world.levels[z].cells.slice(2).map((column) => JSON.stringify(column.slice(1)));
  console.log(['was', `${width}x${height} at (${offsetX},${offsetY})`, 'now', `${d.width}x${d.height} at (${d.offsetX},${d.offsetY})`,
    'aims compared', before.length].join(' '));
  check(d.width === width + 2 && d.height === height + 1 && d.offsetX === offsetX - 2 && d.offsetY === offsetY - 1,
    'the level is two columns wider and a row taller, its offset two and one back');
  check(JSON.stringify(after) === JSON.stringify(before) && before.length > 0,
    'every actuator on it and every teleporter into it aims at the same square of the dungeon');
  check(JSON.stringify(shiftedSquares.map((c) => JSON.parse(c).length)) === JSON.stringify(squares.map((c) => JSON.parse(c).length)),
    'and every square holds what it held');

  // The first open square of level 6 the walk leaves for three others or more, and the
  // same square of the dungeon on the grown level, two columns and a row further in.
  const original = stockDungeon();
  let found: { sx: number; sy: number; a: ReturnType<typeof play> } | null = null;
  for (const [sx, sy] of squaresOf(decompose(original).levels[z])) {
    if ((original.maps[z].cellFlags[sx][sy] >> 5) !== 1) continue;
    const a = play(stockDungeon(), new Position(sx, sy, z), WALK, 100);
    if (new Set(a.trace).size > 3) { found = { sx, sy, a }; break; }
  }
  if (!found) throw new Error('no square of level 6 to walk from');
  const { sx, sy, a } = found;
  const b = play(reread(compose(world)), new Position(sx + 2, sy + 1, z), WALK, 100);
  console.log(['from', `(${sx},${sy})`, 'original', a.trace.join(' '), '| grown', b.trace.join(' ')].join(' '));
  check(a.trace.join(' ') === b.trace.join(' '),
    'a party set down on the same square of the dungeon walks the same squares');
  console.log('');
}

function withDsas(): void {
  console.log('=== DM with a DSA and a wall decoration of CSBgraphics.dat ===');
  const world = decompose(stockDungeon());
  const level = world.levels[0];
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const empty = (x: number, y: number): boolean =>
    level.cellFlags[x]?.[y] !== undefined && level.cellFlags[x][y] >> 5 === RoomType.OPEN && level.cells[x][y].length === 0;
  // Two squares of empty floor side by side, the party on the first facing the second,
  // the pad and the DSA on the second, and a wall beside the first.
  let found: { sx: number; sy: number; facing: Direction } | null = null;
  for (const [sx, sy] of squaresOf(level)) {
    if (found || !empty(sx, sy)) continue;
    const facing = [0, 1, 2, 3].find((d) => empty(sx + DX[d], sy + DY[d]));
    const walled = [0, 1, 2, 3].some((d) => level.cellFlags[sx + DX[d]]?.[sy + DY[d]] !== undefined &&
      level.cellFlags[sx + DX[d]][sy + DY[d]] >> 5 === RoomType.STONE);
    if (facing !== undefined && walled) found = { sx, sy, facing };
  }
  if (!found) throw new Error('no two squares of empty floor beside a wall on level 0');
  const { sx, sy, facing } = found;
  const ahead = { x: sx + DX[facing], y: sy + DY[facing] };
  // The wall, for the decoration: the first stone square round the party.
  const wall = [Direction.NORTH, Direction.EAST, Direction.SOUTH, Direction.WEST]
    .map((d) => ({ x: sx + DX[d], y: sy + DY[d], face: (d + 2) % 4 }))
    .find(({ x, y }) => level.cellFlags[x][y] >> 5 === RoomType.STONE);
  if (!wall) throw new Error('no wall beside the party');
  world.dsas = [];
  world.dsas[3] = {
    description: 'flips at each run', state: 0, localState: 0, groupId: 0, numStates: 2, firstDisplayedState: 0,
    states: [
      { actions: [{ column: 0, program: Uint16Array.from([next(1)]) }] },
      { actions: [{ column: 0, program: Uint16Array.from([next(-1)]) }] },
    ],
  };
  level.dsaSelectors = new Array<number>(32).fill(DSA_NONE);
  level.dsaSelectors[5] = 3;
  level.dsaSelectors[9] = DSA_GRAPHIC;
  level.cells[ahead.x][ahead.y].push(
    actuator({ type: 3, action: ActuatorAction.SET, target: ahead }),
    dsaActuator({ selector: 5, parameterB: 0x2abcd }),
  );
  level.cells[wall.x][wall.y].push(dsaActuator({ selector: 9, parameterA: 0x30007 }, wall.face));

  const back = decompose(reread(compose(world)));
  const records = back.levels[0].cells[ahead.x][ahead.y].map((o) => o.record as ActuatorRecord);
  const decoration = back.levels[0].cells[wall.x][wall.y].map((o) => o.record as ActuatorRecord);
  console.log(['DSAs', back.dsas?.map((dsa, i) => (dsa ? i : null)).filter((i) => i !== null).join(','),
    'selectors', back.levels[0].dsaSelectors?.map((dsa, i) => (dsa !== DSA_NONE ? `${i}:${dsa}` : null)).filter(Boolean).join(' '),
    'DSA actuator', records.map((r) => `${r.word2.toString(16)}/${r.word4.toString(16)}/${r.word6.toString(16)}/${r.word8 ?? 0}`).join(' '),
    'decoration', decoration.map((r) => `${r.word2.toString(16)}/${r.word4.toString(16)}/${r.word8 ?? 0}`).join(' ')].join(' '));
  check(canonical(back) === canonical(world), 'written and read back, the DSA, the selectors and the actuators are the same');
  check(back.levels.slice(1).every((l) => !l.dsaSelectors), 'and the other levels name no DSA');

  const game = newGame(reread(compose(world)), stockGraphics());
  game.systems.hallOfChampions.addChampion(testChampion(0));
  game.ctx.party.state.position = new Position(sx, sy, 0);
  game.ctx.party.state.facing = facing;
  const states: number[] = [];
  const stateOf = (): number => {
    const dungeon = game.ctx.dungeon;
    for (let rn = dungeon.findFirstObject(new Position(ahead.x, ahead.y, 0)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const record = dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR ? dungeon.getActuatorRecord(rn) : null;
      if (record && (record.word2 & 0x7f) === 47) return (record.word2 >> 12) & 15;
    }
    throw new Error('the DSA actuator is gone');
  };
  for (const move of [MovementAction.MOVE_FORWARD, MovementAction.MOVE_BACKWARD, MovementAction.MOVE_FORWARD, MovementAction.MOVE_BACKWARD]) {
    game.enqueueMovement(move);
    for (let n = 0; n < 24; n++) runVbl(game, TICK_DUE);
    states.push(stateOf());
  }
  console.log(`  its state after each move, on and off the pad: ${states.join(' ')}`);
  check(states.join(' ') === '1 1 0 0', 'a pad aimed at its square runs it at each step on, and its state flips');
  console.log('');
}

function main(): void {
  rebuilt();
  grown();
  withDsas();
  finish();
}

main();
