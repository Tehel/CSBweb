/**
 * Every engine sound is queued by its ordinal, through `QueueSound`
 * (`doc/CSBwin-src/CSBCode.cpp:1819`), which looks it up in `d.sound1772` and decides from
 * the level and the distance whether, and how loud, the host plays it.
 *
 * One case per CSBWin call:
 *
 *  1. The door button: `QueueSound(1, d.partyX, d.partyY, 1)` (`Mouse.cpp:1079`).
 *  2. A wall switch: `QueueSound(1, d.partyX, d.partyY, 1)` (`Mouse.cpp:542`).
 *  3. A pressure pad: `QueueSound(soundPRESSUREPAD, mapX, mapY, 1)` (`Code11f52.cpp:3864`),
 *     on the pad's level, so a pad pressed on another level than the party's is not heard.
 *  4. The party through a teleporter: `QueueSound(soundTELEPORT, d.partyX, d.partyY, 0)`,
 *     once `d.partyX` and `d.partyY` are the destination's (`Code11f52.cpp:2960-2965`).
 *  5. A group through a teleporter: `QueueSound(17, newX, newY, 1)`, at the destination
 *     and on its level (`Code11f52.cpp:2955`, `:2983-2986`).
 *  6. A door's step: `QueueSound(2, x, y, 1)` on the timer's level (`Timer.cpp:1375`),
 *     heard beside the door, not six squares away (ordinal 2's `byte7`), nor from another
 *     level.
 *  7. The gulp: `QueueSound(fp.gulp, d.partyX, d.partyY, 0)` (`Character.cpp:4483-4486`),
 *     with `fp.gulp = 8` (`:4126`).
 *
 * The wall bump's `QueueSound(18, …)` is `tools/dump-party-collision.ts`'s.
 *
 * Each row is what `queueSound` received, `[ordinal, x, y, deltaTime, level]` (`-` for a
 * caller on the party's level), and what the host was asked to play,
 * `[SND item, rate variant, distance]`. The squares are real ones from `dungeon.dat`: the
 * first audible door button, wall switch, party pad and teleporter it holds.
 *
 * Run: `npx tsx tools/dump-queue-sound.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PotionType } from '../src/core/constants';
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import {
  ActuatorAction,
  getActuatorAction,
  getActuatorType,
  getActuatorValue,
  isActuatorAudible,
  isActuatorOnceOnly,
} from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { TeleporterRecord } from '../src/data/dungeonTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Game } from '../src/engine/Game';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { handleMouthPress } from '../src/renderer/ui/Feeding';
import { createUIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { newGame, stockGraphics } from './lib/game';

/** North, east, south, west: `DELTA_X` / `DELTA_Y`. */
const DELTAS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const graphics = stockGraphics();

interface Scene {
  game: Game;
  /** `[ordinal, x, y, deltaTime, level]`, `-` for no level. */
  queued: Array<Array<number | string>>;
  /** `[SND item, rate variant, distance]`. */
  played: number[][];
}

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `C${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function scene(): Scene {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const played: number[][] = [];
  const game = newGame(data, graphics, {
    playSound: (soundId, rateIdx, distance) => played.push([soundId, rateIdx ?? 0, distance ?? -1]),
  });
  game.setRandomSeed(0x12345678);
  game.party.state.champions = [champion(0)];
  const queued: Array<Array<number | string>> = [];
  const queueSound = game.sounds.queueSound.bind(game.sounds);
  game.sounds.queueSound = (ordinal, mapX, mapY, deltaTime, level) => {
    queued.push([ordinal, mapX, mapY, deltaTime, level ?? '-']);
    queueSound(ordinal, mapX, mapY, deltaTime, level);
  };
  return { game, queued, played };
}

function inBounds(game: Game, p: Position): boolean {
  const map = game.dungeonState.getMap(p.z);
  return !!map && p.x >= 0 && p.y >= 0 && p.x < map.descriptor.width && p.y < map.descriptor.height;
}

function roomType(game: Game, p: Position): number {
  return (game.dungeonState.getCellFlag(p) >> 5) & 7;
}

function emptyOpen(game: Game, p: Position): boolean {
  return inBounds(game, p) && roomType(game, p) === RoomType.OPEN && game.dungeonState.findFirstObject(p) === OBJECT_ID_EOF;
}

/** Every square of the dungeon, level by level, in scan order. */
function* squares(game: Game): Generator<Position> {
  for (let z = 0; z < game.dungeonState.getMapCount(); z++) {
    const map = game.dungeonState.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) yield new Position(x, y, z);
    }
  }
}

/** The objects of `category` on a square, with their positions in the cell. */
function objectsAt(game: Game, p: Position, category: number): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.dungeonState.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    if (decodeObjectID(rn).category === category) out.push(rn);
  }
  return out;
}

const json = (v: unknown): string => JSON.stringify(v);

function row(label: string, s: Scene): void {
  console.log([label, json(s.queued), json(s.played)].join('\t'));
}

function clear(s: Scene): void {
  s.queued.length = 0;
  s.played.length = 0;
}

function stand(game: Game, at: Position, facing: number): void {
  game.party.state.position = at;
  game.party.setFacing(facing);
}

function main(): void {
  console.log(['case', 'queued [ordinal, x, y, deltaTime, level]', 'played [item, rate, distance]'].join('\t'));

  /* ------------------------------------------------------------ 1. the door button ---- */
  {
    const s = scene();
    const { game } = s;
    let at: { party: Position; facing: number } | null = null;
    for (const p of squares(game)) {
      if (at) break;
      if (roomType(game, p) !== RoomType.DOOR) continue;
      const door = game.dungeonState.findFirstDoor(p);
      if (door === OBJECT_ID_EOF || !game.dungeonState.getDoorRecordByIndex(decodeObjectID(door).index)?.hasButton) continue;
      // `nsDoor != (facing & 1)` (`Mouse.cpp:1063-1066`): an east-west door is faced from the south.
      const facing = (game.dungeonState.getCellFlag(p) & 0x8) !== 0 ? 0 : 1;
      const party = new Position(p.x - DELTAS[facing][0], p.y - DELTAS[facing][1], p.z);
      if (inBounds(game, party)) at = { party, facing };
    }
    if (!at) throw new Error('no door button in dungeon.dat');
    stand(game, at.party, at.facing);
    const clicked = game.handleDoorSwitchClick();
    row(`1. door button, party (${at.party.x},${at.party.y}) L${at.party.z}`, s);
    check(clicked, 'the click reaches the door button');
    check(json(s.queued) === json([[1, at.party.x, at.party.y, 1, '-']]), 'the door button queues QueueSound(1, d.partyX, d.partyY, 1)');
    check(json(s.played) === json([[534, 0, 0]]), 'ordinal 1 is SND item 534, at distance 0');
  }

  /* ------------------------------------------------------------- 2. a wall switch ---- */
  {
    const s = scene();
    const { game } = s;
    let at: { party: Position; facing: number } | null = null;
    for (const p of squares(game)) {
      if (at) break;
      if (roomType(game, p) !== RoomType.STONE) continue;
      for (const rn of objectsAt(game, p, DBType.ACTUATOR)) {
        const rec = game.dungeonState.getActuatorRecord(rn)!;
        if (getActuatorType(rec) !== 1 || getActuatorAction(rec) === ActuatorAction.CONSTPRESSURE || !isActuatorAudible(rec)) continue;
        // The switch is on side `side` of the wall; the party stands on that side, facing it.
        const side = decodeObjectID(rn).position & 3;
        const party = new Position(p.x + DELTAS[side][0], p.y + DELTAS[side][1], p.z);
        if (!emptyOpen(game, party)) continue;
        at = { party, facing: (side + 2) & 3 };
        break;
      }
    }
    if (!at) throw new Error('no audible type-1 wall switch in dungeon.dat');
    stand(game, at.party, at.facing);
    const fired = game.handleWallClick();
    row(`2. wall switch, party (${at.party.x},${at.party.y}) L${at.party.z}`, s);
    check(fired, 'the click fires the switch');
    check(json(s.queued) === json([[1, at.party.x, at.party.y, 1, '-']]), 'the wall switch queues QueueSound(1, d.partyX, d.partyY, 1)');
    check(json(s.played) === json([[534, 0, 0]]), 'and the host plays item 534 at distance 0');
  }

  /* ------------------------------------------------------------ 3. a pressure pad ---- */
  {
    const s = scene();
    const { game } = s;
    let pad: { at: Position; facing: number } | null = null;
    for (const p of squares(game)) {
      if (pad) break;
      if (roomType(game, p) !== RoomType.OPEN) continue;
      for (const rn of objectsAt(game, p, DBType.ACTUATOR)) {
        const rec = game.dungeonState.getActuatorRecord(rn)!;
        // Type 3, the party's own pad (`Code11f52.cpp:3796-3812`), pressed facing any way
        // when its value is 0, and pressed again as often as the party steps on it.
        if (getActuatorType(rec) !== 3 || getActuatorValue(rec) !== 0 || isActuatorOnceOnly(rec) || !isActuatorAudible(rec)) continue;
        if (getActuatorAction(rec) === ActuatorAction.CONSTPRESSURE) continue;
        pad = { at: p, facing: 0 };
        break;
      }
    }
    if (!pad) throw new Error('no audible party pad in dungeon.dat');
    const { at } = pad;
    stand(game, at, pad.facing);
    game.triggerObjectMove(at, OBJECT_ID_NULL, true, false, pad.facing);
    row(`3a. pad (${at.x},${at.y}) L${at.z}, the party on it`, s);
    check(json(s.queued) === json([[1, at.x, at.y, 1, at.z]]), "the pad queues QueueSound(soundPRESSUREPAD, mapX, mapY, 1) on its own level");
    check(json(s.played) === json([[534, 0, 0]]), 'and the party on it hears item 534');

    // The same press, with the party on another level, as a group or an object pressing a
    // pad there would be: `d.LoadedLevel != d.partyLevel`, so `QueueSound` returns.
    clear(s);
    const elsewhere = at.z === 0 ? 1 : 0;
    game.party.state.position = new Position(at.x, at.y, elsewhere);
    game.triggerObjectMove(at, OBJECT_ID_NULL, true, false, pad.facing);
    row(`3b. pad (${at.x},${at.y}) L${at.z}, the party on L${elsewhere}`, s);
    check(json(s.queued) === json([[1, at.x, at.y, 1, at.z]]), 'queued on the pad\'s level');
    check(s.played.length === 0, 'and not heard from another level');
  }

  /* ---------------------------------------------------------- 4-5. a teleporter ---- */
  // The first audible teleporter that takes everything (scope 3) to an empty open square
  // of its own level, with an empty open square beside it to step from.
  const findTeleporter = (game: Game): { tp: Position; from: Position; dest: Position } => {
    for (const p of squares(game)) {
      if (roomType(game, p) !== RoomType.TELEPORTER || (game.dungeonState.getCellFlag(p) & 0x8) === 0) continue;
      const rec: TeleporterRecord | null = objectsAt(game, p, DBType.TELEPORTER)
        .map((rn) => game.dungeonState.getTeleporterRecord(rn)).find((r) => r !== null) ?? null;
      if (!rec || !rec.sound || (rec.scope & 3) !== 3) continue;
      const dest = new Position(rec.destX, rec.destY, p.z);
      if (game.dungeonState.getMap(p.z)!.descriptor.level !== rec.destMap || !emptyOpen(game, dest)) continue;
      for (const [dx, dy] of DELTAS) {
        const from = new Position(p.x + dx, p.y + dy, p.z);
        if (emptyOpen(game, from) && !(from.x === dest.x && from.y === dest.y)) return { tp: p, from, dest };
      }
    }
    throw new Error('no audible scope-3 teleporter in dungeon.dat');
  };

  {
    const s = scene();
    const { game } = s;
    const { tp, from, dest } = findTeleporter(game);
    stand(game, from, 0);
    game.worldMove.moveParty(from.x, from.y, tp.x, tp.y);
    const now = game.party.state.position;
    row(`4. party (${from.x},${from.y}) -> teleporter (${tp.x},${tp.y}) -> (${dest.x},${dest.y}) L${tp.z}`, s);
    check(now.x === dest.x && now.y === dest.y && now.z === dest.z, 'the party is at the destination');
    check(json(s.queued) === json([[17, dest.x, dest.y, 0, '-']]), 'the buzz is QueueSound(soundTELEPORT, d.partyX, d.partyY, 0) at the destination');
    check(json(s.played) === json([[547, 0, 0]]), 'ordinal 17 is SND item 547, at distance 0');
  }

  {
    const s = scene();
    const { game } = s;
    const { tp, from, dest } = findTeleporter(game);
    // The party two squares from the destination, where ordinal 17 (`byte6` 1, `byte7` 4)
    // is heard quietly.
    const not = [tp, from, dest];
    let party: Position | null = null;
    for (const p of squares(game)) {
      if (p.z !== tp.z || !emptyOpen(game, p) || not.some((q) => q.x === p.x && q.y === p.y)) continue;
      if (Math.abs(p.x - dest.x) + Math.abs(p.y - dest.y) === 2) { party = p; break; }
    }
    if (!party) throw new Error('no square two from the teleporter\'s destination');
    stand(game, party, 0);
    game.monsterSystem.loadPartyLevel(tp.z);
    let type = -1;
    for (let t = 0; t < 27 && type < 0; t++) if (game.dungeonState.monsterAllowedOnLevel(t, tp.z)) type = t;
    const rn = createMonsterAt(game, {
      value: type, hitPointMultiplier: 1, numMonM1: 0, facing: 0,
      mapX: from.x, mapY: from.y, level: from.z, invisible: false, drawAsSize4: false,
    });
    if (rn === null) throw new Error('could not make a group beside the teleporter');
    clear(s);
    const moved = game.monsterSystem.moveMonster(rn, from.x, from.y, tp.x, tp.y, tp.z);
    row(`5. type-${type} group (${from.x},${from.y}) -> teleporter (${tp.x},${tp.y}) -> (${dest.x},${dest.y}) L${tp.z}, party (${party.x},${party.y})`, s);
    check(moved.position.x === dest.x && moved.position.y === dest.y, 'the group is at the destination');
    check(json(s.queued) === json([[17, dest.x, dest.y, 1, dest.z]]), 'the buzz is QueueSound(17, newX, newY, 1) on the destination level');
    check(json(s.played) === json([[547, 0, 2]]), 'the host plays item 547, the one variant it has, at distance 2');
  }

  /* ------------------------------------------------------------ 6. a door's step ---- */
  {
    const s = scene();
    const { game } = s;
    let door: Position | null = null;
    for (const p of squares(game)) {
      if (roomType(game, p) === RoomType.DOOR && (game.dungeonState.getCellFlag(p) & 7) === 4) { door = p; break; }
    }
    if (!door) throw new Error('no shut door in dungeon.dat');
    const d = door;
    // Opening, `uByte9 = 0` (SET): one step a tick, re-queued after each.
    game.timerQueue.addTimer({
      index: 0, function: TimerFunction.TT_DOOR_STEP, time: game.state.tickCount + 1, level: d.z,
      uByte5: 0, uByte6: d.x, uByte7: d.y, uByte8: 0, uByte9: ActuatorAction.SET, sequence: 0,
      timerWord8: 0, timerWord6: 0,
    });
    const step = (party: Position, label: string): void => {
      game.party.state.position = party;
      clear(s);
      game.state.tickCount++;
      game.timerSystem.processTimers(game.state.tickCount);
      row(`6${label}. door (${d.x},${d.y}) L${d.z} to state ${game.dungeonState.getCellFlag(d) & 7}, party (${party.x},${party.y}) L${party.z}`, s);
    };
    const doorSteps = (): Array<Array<number | string>> => s.queued.filter((q) => q[0] === 2);
    const heard = (): number[][] => s.played.filter((p) => p[0] === 535);

    step(new Position(d.x, d.y + 1, d.z), 'a');
    check(json(doorSteps()) === json([[2, d.x, d.y, 1, d.z]]), 'a step queues QueueSound(2, x, y, 1) on the timer\'s level');
    check(json(heard()) === json([[535, 0, 1]]), 'ordinal 2 is SND item 535, heard beside the door');

    step(new Position(d.x, d.y + 6, d.z), 'b');
    check(json(doorSteps()) === json([[2, d.x, d.y, 1, d.z]]), 'the next step queues it again');
    check(heard().length === 0, 'and six squares away it is not heard (byte7 = 6)');

    const elsewhere = d.z === 0 ? 1 : 0;
    step(new Position(d.x, d.y, elsewhere), 'c');
    check(json(doorSteps()) === json([[2, d.x, d.y, 1, d.z]]), 'and the next');
    check(heard().length === 0, 'and from another level, at the same x and y, it is not heard either');
  }

  /* ----------------------------------------------------------------- 7. the gulp ---- */
  {
    const s = scene();
    const { game } = s;
    const potions = game.dungeonState.getData().databases.potions.records;
    const index = potions.findIndex((r) => r.nextObject !== OBJECT_ID_NULL && r.potionType !== PotionType.EMPTY_FLASK);
    const potion = ((DBType.POTION << 10) | index) as ObjectID;
    const ui = createUIState(graphics, game.dungeonState, { getGraphicBitmap: () => null, renderLastFrame: () => {} });
    ui.objectTables = extractObjectTables(graphics, extractViewportTables(graphics).wallRectanglesOffset);
    ui.partyState = game.party.state;
    ui.applyFeeding = (chIdx, fp) => game.applyFeeding(chIdx, fp);
    ui.queueSound = (ordinal, mapX, mapY, deltaTime) => game.sounds.queueSound(ordinal, mapX, mapY, deltaTime);
    const at = new Position(3, 3, 1);
    stand(game, at, 0);
    game.party.state.selectedCharacterIndex = 0;
    game.party.state.cursorOwner = 0;
    game.party.state.objectInHand = potion;
    handleMouthPress(ui);
    row(`7. champion 0 drinks potion ${index}, party (${at.x},${at.y}) L${at.z}`, s);
    check(json(s.queued) === json([[8, at.x, at.y, 0, '-']]), 'the gulp queues QueueSound(8, d.partyX, d.partyY, 0)');
    check(json(s.played) === json([[540, 0, 0]]), 'ordinal 8 is SND item 540, at distance 0');
  }

  finish();
}

main();
