/**
 * The party's world `MoveObject(RNnul, oldX, oldY, newX, newY, …)`
 * (`doc/CSBwin-src/Code11f52.cpp:2796-3325`), from each of its callers.
 *
 * Every caller passes its own cells, and `MoveObject` does the rest in one order:
 * `CheckMoveFromMissile(oldX, oldY, newX, newY)` with those cells (`:2847-2853`); the
 * party set on the new square and taken through the pits, where a fall hurts with the
 * party already on the square below (`:3053-3086`); nothing more when it is back on its
 * square facing the same way (`:3194-3201`); a footprint when it left it (`:3224-3247`);
 * the old square's pads (`:3258-3268`); then on its level the new square's pads
 * (`:3309-3317`), and on another nothing more until the top of the next tick, which
 * makes the arrival, `LoadPartyLevel` and `MoveObject(RNnul, -1, 0, x, y)`
 * (`d.newPartyLevel`, `CSBCode.cpp:618-623`), which leaves a second footprint and presses
 * the pads there. Each case records those steps, runs the top of the tick (`tick` in the
 * record), and compares them with that order:
 *
 *  1. the step onto a pit (`CSBCode.cpp:8324`), past a fireball in the square it leaves;
 *  2. the climb down (`Attack.cpp:2032`), which passes the pit, not the square below, so
 *     the second half-step meets a fireball in the pit's square;
 *  3. the DSA teleport onto the pit (`DSA.cpp:4604`), which passes the party's square twice;
 *  4. the wiggle of the square the party stands on (`Timer.cpp:2443`), as its pit opens,
 *     and 5. as nothing happens: the missiles in the party's own square are still met;
 *  6. the step into stairs (`CSBCode.cpp:8212`, `:7774`): lifted twice, then arriving on
 *     the stairs of the other level;
 *  7. a turn, which is not a `MoveObject` and leaves no footprint;
 *  8. a champion the fall kills leaves their bones on the square below, where the party
 *     is by then.
 *
 * Run: `npx tsx tools/dump-party-move.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DBType, Direction, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, decodeObjectID, type LocationRel, type ObjectID,
} from '../src/core/types';
import { RN_FIREBALL } from '../src/core/spellRn';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import { emptyPossessions, MovementAction, type Champion } from '../src/engine/gameTypes';
import { DELTA_X, DELTA_Y } from '../src/engine/MonsterPerception';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 500, maxHealth: 500, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

const at = (p: Position): string => `${p.z}(${p.x},${p.y})`;

/**
 * A game with four champions, one per corner, and a log of the party move's steps. Each
 * loads its own `dungeon.dat`: the engine changes the data it is given.
 */
function makeGame(): { game: Game; log: string[] } {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, stockGraphics());
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.addChampion(champion(i));
  const log: string[] = [];
  const party = game.party.state;

  const missiles = game.missileEncounter;
  const check = missiles.checkPartyMoveFromMissile.bind(missiles);
  missiles.checkPartyMoveFromMissile = (from, to) => {
    log.push(`missile ${at(from)}->${to ? at(to) : 'none'}`);
    return check(from, to);
  };
  const wm = game.worldMove as unknown as { partyFallsIntoPit(): void };
  const fall = wm.partyFallsIntoPit.bind(wm);
  wm.partyFallsIntoPit = () => {
    log.push(`fall at ${at(party.position)}`);
    fall();
  };
  const prints = game.footprints;
  const record = prints.recordPartyMove.bind(prints);
  prints.recordPartyMove = (time, level, x, y, magic) => {
    log.push(`footprint ${at(new Position(x, y, level))}`);
    record(time, level, x, y, magic);
  };
  const actuators = game.ctx.systems.actuators;
  const pads = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    if (object === OBJECT_ID_NULL) log.push(`${place ? 'place' : 'remove'} ${at(position)} ${unchangedRoom ? 'same' : 'moved'}`);
    return pads(position, object, place, unchangedRoom, facing);
  };
  const monsters = game.monsterSystem;
  const load = monsters.loadPartyLevel.bind(monsters);
  monsters.loadPartyLevel = (level) => {
    log.push(`load ${level}`);
    load(level);
  };
  return { game, log };
}

function isEmptyOpen(game: Game, p: Position): boolean {
  const map = game.dungeonState.getMap(p.z);
  if (!map || p.x < 0 || p.y < 0 || p.x >= map.descriptor.width || p.y >= map.descriptor.height) return false;
  return ((map.cellFlags[p.x]![p.y]! >> 5) & 7) === RoomType.OPEN && game.dungeonState.findFirstObject(p) === OBJECT_ID_EOF;
}

/**
 * An open pit that leads somewhere, with an empty floor square `from` which the party,
 * facing `facing`, steps into it, and an empty floor square below.
 */
function findPit(game: Game): { pit: Position; from: Position; facing: Direction; below: Position } {
  const dungeon = game.dungeonState;
  for (let z = 1; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]![y]!;
        if (((flag >> 5) & 7) !== RoomType.PIT || (flag & 0x09) !== 0x08) continue;
        const pit = new Position(x, y, z);
        if (dungeon.findFirstObject(pit) !== OBJECT_ID_EOF) continue;
        const below = dungeon.incrementLevel(pit, 1);
        if (!below || !isEmptyOpen(game, below)) continue;
        for (let facing = 0; facing < 4; facing++) {
          const from = new Position(x - DELTA_X[facing]!, y - DELTA_Y[facing]!, z);
          if (isEmptyOpen(game, from)) return { pit, from, facing: facing as Direction, below };
        }
      }
    }
  }
  throw new Error('no open pit with an empty floor square beside it and below it');
}

/**
 * Stairs, an empty square `from` which the party steps into them, and the stairs on the
 * other level, where `TraverseStairway` stands the party (`d.partyX = x`,
 * `CSBCode.cpp:7776-7777`).
 */
function findStairs(game: Game): { stairs: Position; from: Position; facing: Direction; next: Position } {
  const dungeon = game.dungeonState;
  for (let z = 1; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]![y]!;
        if (((flag >> 5) & 7) !== RoomType.STAIRS) continue;
        const stairs = new Position(x, y, z);
        const next = dungeon.incrementLevel(stairs, (flag & 4) !== 0 ? -1 : 1);
        if (!next) continue;
        for (let facing = 0; facing < 4; facing++) {
          const from = new Position(x - DELTA_X[facing]!, y - DELTA_Y[facing]!, z);
          if (isEmptyOpen(game, from)) return { stairs, from, facing: facing as Direction, next };
        }
      }
    }
  }
  throw new Error('no stairs with an empty square before them');
}

/** Stand the party on `p`, facing `facing`, with its level loaded and the log cleared. */
function stand(game: Game, log: string[], p: Position, facing: Direction): void {
  game.party.state.position = p;
  game.party.setFacing(facing);
  game.monsterSystem.loadPartyLevel(p.z);
  log.length = 0;
}

/** A fireball in flight in `p`, corner `corner`, its timer not yet due. */
function launch(game: Game, p: Position, corner: number): ObjectID {
  const before = new Set<ObjectID>();
  for (let rn = game.dungeonState.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) before.add(rn);
  if (!game.magic.launchMissile(RN_FIREBALL, p.x, p.y, p.z, corner, Direction.NORTH, 40, 10, 1, game.timerSystem.now + 9, true)) {
    throw new Error('missile not launched');
  }
  for (let rn = game.dungeonState.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    if (!before.has(rn) && decodeObjectID(rn).category === DBType.MISSILE) return rn;
  }
  throw new Error('missile not placed');
}

function inCell(game: Game, p: Position, rn: ObjectID): boolean {
  for (let r = game.dungeonState.findFirstObject(p); r !== OBJECT_ID_EOF; r = game.dungeonState.getDBRecordLink(r)) {
    if (r === rn) return true;
  }
  return false;
}

/** The top of the next tick, `Game.loadNewPartyLevel`, marked in the record. */
function tick(game: Game, log: string[]): void {
  log.push('tick');
  game.loadNewPartyLevel();
}

function compare(label: string, log: string[], expected: string[]): void {
  console.log(`${label}:\n  ${log.join('\n  ') || '(nothing)'}`);
  check(log.join('|') === expected.join('|'), `${label}: in MoveObject's order (expected ${expected.join(', ') || 'nothing'})`);
}

/** What the fall onto the square below does, arrival included. */
const fallTail = (old: Position, below: Position): string[] => [
  `fall at ${at(below)}`, `footprint ${at(below)}`, `remove ${at(old)} moved`,
  'tick', `load ${below.z}`, `footprint ${at(below)}`, `place ${at(below)} moved`,
];

const probe = makeGame().game;
const { pit, from, facing, below } = findPit(probe);
console.log(`the pit at ${at(pit)}, stepped into facing ${facing} from ${at(from)}, drops to ${at(below)}\n`);

/* ------------------------------------------------ 1. the step onto the pit ------ */
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  const fireball = launch(game, from, 2);
  log.length = 0;
  game.move(MovementAction.MOVE_FORWARD);
  tick(game, log);
  compare('1. the step onto the pit', log, [`missile ${at(from)}->${at(pit)}`, ...fallTail(from, below)]);
  check(!inCell(game, from, fireball), 'the fireball in the square the party leaves is met');
}

/* ------------------------------------------------ 2. the climb down ------------- */
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  // The pit's corner the head of the party leaves in the second half-step:
  // `whoLeavesNewCell[tailPosLeft]` (`Code11f52.cpp:2640-2660`).
  const fireball = launch(game, pit, (facing + 3) & 3);
  log.length = 0;
  const climb = game.attackSystem as unknown as { climbDownIntoPit(target: Position): void };
  climb.climbDownIntoPit(pit);
  tick(game, log);
  compare('2. the climb down', log, [`missile ${at(from)}->${at(pit)}`, ...fallTail(from, below)]);
  check(!inCell(game, pit, fireball), 'the fireball in the pit\'s square is met by the second half-step');
}

/* ------------------------------------------------ 3. the DSA teleport ----------- */
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  const dsa = (game as unknown as { dsaSystem: { teleportParty(locr: LocationRel): void } }).dsaSystem;
  dsa.teleportParty({ l: game.dungeonState.getMap(pit.z)!.descriptor.level, x: pit.x, y: pit.y, p: 0 });
  tick(game, log);
  compare('3. the DSA teleport onto the pit', log, [`missile ${at(from)}->${at(from)}`, ...fallTail(from, below)]);
}

/* ------------------------------------------------ 4-5. the wiggle --------------- */
{
  const { game, log } = makeGame();
  stand(game, log, pit, facing);
  const wiggle = game.timerSystem as unknown as { wiggleEverything(x: number, y: number, level: number): void };
  wiggle.wiggleEverything(pit.x, pit.y, pit.z);
  tick(game, log);
  compare('4. the wiggle of the party\'s square as its pit opens', log, [`missile ${at(pit)}->${at(pit)}`, ...fallTail(pit, below)]);
}
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  const fireball = launch(game, from, 1);
  log.length = 0;
  const wiggle = game.timerSystem as unknown as { wiggleEverything(x: number, y: number, level: number): void };
  wiggle.wiggleEverything(from.x, from.y, from.z);
  tick(game, log);
  compare('5. the wiggle of the party\'s square as nothing happens', log, [`missile ${at(from)}->${at(from)}`, 'tick']);
  check(!inCell(game, from, fireball), 'the fireball in a champion\'s corner of that square is met');
}

/* ------------------------------------------------ 6. the step into stairs ------- */
{
  const { game, log } = makeGame();
  const s = findStairs(game);
  stand(game, log, s.from, s.facing);
  game.move(MovementAction.MOVE_FORWARD);
  const held = game.party.state.position;
  tick(game, log);
  compare(`6. the step into the stairs at ${at(s.stairs)}`, log, [
    `missile ${at(s.from)}->none`, `remove ${at(s.from)} moved`,
    `missile ${at(s.stairs)}->none`, `remove ${at(s.stairs)} moved`,
    'tick', `load ${s.next.z}`, `footprint ${at(s.next)}`, `place ${at(s.next)} moved`,
  ]);
  check(
    at(held) === at(new Position(s.next.x, s.next.y, s.from.z)),
    'until the tick, the party is on the new square with its old level (TraverseStairway, CSBCode.cpp:7775-7781)',
  );
  check(at(game.party.state.position) === at(s.next), `the party stands on the stairs below, ${at(s.next)}`);
}

/* ------------------------------------------------ 7. a turn --------------------- */
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  game.move(MovementAction.TURN_RIGHT);
  tick(game, log);
  compare('7. a turn', log, ['tick']);
}

/* ------------------------------------------------ 8. a death in the fall -------- */
{
  const { game, log } = makeGame();
  stand(game, log, from, facing);
  game.party.state.champions[0]!.attributes.health = 1;
  game.move(MovementAction.MOVE_FORWARD);
  const bonesBelow = game.dungeonState.findFirstObject(below) !== OBJECT_ID_EOF;
  const bonesAbove = game.dungeonState.findFirstObject(from) !== OBJECT_ID_EOF;
  console.log(`8. a champion at 1 HP falls: alive ${game.party.state.champions[0]!.alive}, `
    + `something at ${at(below)} ${bonesBelow}, at ${at(from)} ${bonesAbove}`);
  check(!game.party.state.champions[0]!.alive, 'the fall kills the champion');
  check(bonesBelow && !bonesAbove, 'and their bones lie on the square below, where the party landed');
}

finish();
