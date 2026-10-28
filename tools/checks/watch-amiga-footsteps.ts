/**
 * The `dm-amiga` set's own sounds, which the Atari never had (`DEBT.md` A,
 * `doc/AMIGA_DISK_REFERENCE.md` → "The sounds, heard"):
 *
 *  1. `moveGetSound`, A22E's `F0514_MOVE_GetSound` (ReDMCSB `MOVESENS.C:911-1000`), for
 *     the 27 creatures: none for the eye, the ghost, the black flame, the zytaz and the
 *     lords, and none for any while the party rests.
 *  2. The footsteps: the clock runs on level 2 with the party among its groups, and every
 *     group that arrives on a square asks for its movement sound there, with `deltaTime`
 *     1 (`MOVESENS.C:846-850`). The same run with the party resting asks for none, though
 *     the groups move; on `dm-atari` none either.
 *  3. A couatl that does not attack is heard on each toss that flips its picture
 *     (`GROUP.C:265-279`), and on no other.
 *  4. A creature's blow asks for A22E's attack sound, `G0244_auc_Graphic559_CreatureAttackSounds`
 *     through its `AttackSoundOrdinal` (`GROUP.C:1802-1804`, `DUNGEON.C:439-517`): the
 *     rock, the water elemental and the couatl their new sounds, the five others of the
 *     seven A22E changed what A22E gives them; `dm-atari` CSBWin's.
 *  5. The war cry and the horn play sounds 28 and 25 at once, on the square ahead, as `dm`'s
 *     `F0407_MENUS_IsActionPerformed` does (hunk 19 at 0x15fa); calm, brandish and
 *     confuse nothing; `dm-atari` nothing.
 *  6. A sound past the Atari's 22 waits in a `TT_20` with its `Priority` as the timer's
 *     (`SOUND.C:1536-1544`).
 *
 * Run: `npm test -- --only=watch-amiga-footsteps.ts [ticks]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, Position, type ObjectID } from '../../src/core/types';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { SMS_MIRROR } from '../../src/data/dungeonTypes';
import type { Game } from '../../src/engine/Game';
import { AttackType, MonsterType } from '../../src/engine/monsterTypes';
import { AMIGA_NO_SOUND, moveGetSound } from '../../src/engine/SoundQueue';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { newGame, processTimersAt, stockGame } from '../lib/game';

const AMIGA = 'tools/fixtures/gamefiles/dm-amiga';
const LEVEL = 2;
const PARTY = new Position(6, 14, LEVEL);
const SEED = 0x12345678;

/** A sound asked of `QueueSound`. */
interface Asked {
  ordinal: number;
  x: number;
  y: number;
  deltaTime: number;
}

function amigaGame(host: Parameters<typeof newGame>[2] = {}): Game {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(AMIGA, 'graphics.dat'))));
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(AMIGA, 'dungeon.dat'))));
  return newGame(data, graphics, host);
}

/** The game with four sturdy champions at `PARTY`, its level loaded, and every `QueueSound` logged. */
function setUp(game: Game): Asked[] {
  game.setRandomSeed(SEED);
  for (let i = 0; i < 4; i++) {
    game.systems.hallOfChampions.addChampion(testChampion(i, { attributes: { health: 30000, maxHealth: 30000 } }));
  }
  game.ctx.party.state.position = new Position(PARTY.x, PARTY.y, PARTY.z);
  game.systems.monsters.loadPartyLevel(LEVEL);
  const asked: Asked[] = [];
  const sounds = game.ctx.sounds;
  const queueSound = sounds.queueSound.bind(sounds);
  sounds.queueSound = (ordinal, x, y, deltaTime, level) => {
    asked.push({ ordinal, x, y, deltaTime });
    queueSound(ordinal, x, y, deltaTime, level);
  };
  return asked;
}

/** Where each group of the level stands, as `x,y` → its creature type. */
function groups(game: Game): Map<string, number> {
  const found = new Map<string, number>();
  const map = game.ctx.dungeon.getMap(LEVEL)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const rn = game.ctx.dungeon.findFirstMonster(new Position(x, y, LEVEL));
      if (rn !== OBJECT_ID_EOF) found.set(`${x},${y}`, game.ctx.dungeon.getCreatureRecord(rn)!.creatureType);
    }
  }
  return found;
}

/** The movement sounds the clock asks for in `ticks`, and how many times a group was seen to move. */
function watch(game: Game, asked: Asked[], ticks: number): { footsteps: Asked[]; moves: number; wrong: string[] } {
  const footsteps: Asked[] = [];
  const wrong: string[] = [];
  let moves = 0;
  let before = groups(game);
  for (let t = 0; t < ticks; t++) {
    game.ctx.state.tickCount = t;
    const from = asked.length;
    processTimersAt(game, t);
    const after = groups(game);
    for (const at of after.keys()) if (!before.has(at)) moves++;
    for (const a of asked.slice(from)) {
      if (a.ordinal < 22 || a.ordinal === 25 || a.ordinal === 28 || a.ordinal >= 29 && a.ordinal <= 31) continue;
      footsteps.push(a);
      const type = after.get(`${a.x},${a.y}`);
      if (type === undefined || moveGetSound(type, false) !== a.ordinal || a.deltaTime !== 1) {
        wrong.push(`tick ${t}: ${a.ordinal} at ${a.x},${a.y} (deltaTime ${a.deltaTime}), the group there ${type}`);
      }
    }
    before = after;
  }
  return { footsteps, moves, wrong };
}

function main(): void {
  const ticks = Number(process.argv[2] ?? 600);

  // 1. `F0514_MOVE_GetSound`.
  const table = Array.from({ length: 27 }, (_, type) => moveGetSound(type, false));
  const show = (sound: number): string => (sound === AMIGA_NO_SOUND ? '-' : String(sound));
  console.log(`moveGetSound by creature type: ${table.map(show).join(' ')}`);
  check(table.map(show).join(' ') === '26 27 24 - 26 26 26 26 - 24 24 - 33 23 24 26 24 23 22 - 27 26 24 - 32 - -',
    'F0514_MOVE_GetSound, A22E\'s branch: each of the 27 creatures its movement sound, none for the eye, ghost, black flame, zytaz and lords');
  check(Array.from({ length: 27 }, (_, type) => moveGetSound(type, true)).every((s) => s === AMIGA_NO_SOUND),
    'and none for any while the party rests');

  // 2. The footsteps.
  const game = amigaGame();
  const asked = setUp(game);
  const awake = watch(game, asked, ticks);
  const heard = new Map<number, number>();
  for (const f of awake.footsteps) heard.set(f.ordinal, (heard.get(f.ordinal) ?? 0) + 1);
  console.log(`\nlevel ${LEVEL}, party at (${PARTY.x},${PARTY.y}), ${ticks} ticks: ${awake.moves} arrivals, `
    + `${awake.footsteps.length} footsteps (${[...heard].map(([o, n]) => `${o}: ${n}`).join(', ')})`);
  for (const f of awake.footsteps.slice(0, 8)) console.log(`  ${f.ordinal} at ${f.x},${f.y}`);
  for (const w of awake.wrong) console.log(`  WRONG ${w}`);
  check(awake.footsteps.length > 0, 'groups coming towards the party are heard moving');
  check(awake.wrong.length === 0, 'each footstep is its group\'s movement sound, on the square it arrived on, with deltaTime 1');

  const resting = amigaGame();
  const restingAsked = setUp(resting);
  // A blow wakes the party (`Monster.cpp:4544`): this one sleeps through it.
  Object.defineProperty(resting.ctx.party.state, 'sleeping', { get: () => true, set: () => {} });
  const asleep = watch(resting, restingAsked, ticks);
  console.log(`resting: ${asleep.moves} arrivals, ${asleep.footsteps.length} footsteps`);
  check(asleep.moves > 0 && asleep.footsteps.length === 0, 'while the party rests, groups move unheard');

  const atari = stockGame();
  const atariAsked = setUp(atari);
  const atariRun = watch(atari, atariAsked, ticks);
  console.log(`dm-atari: ${atariRun.moves} arrivals, ${atariRun.footsteps.length} footsteps`);
  check(atariRun.moves > 0 && atariRun.footsteps.length === 0, 'dm-atari\'s groups move unheard, as CSBWin\'s');

  // 3. The couatl. The level's first group, made a lone couatl that does not attack.
  const couatlGame = amigaGame();
  const couatlAsked = setUp(couatlGame);
  const [at] = groups(couatlGame).keys();
  const [cx, cy] = at!.split(',').map(Number) as [number, number];
  const rn = couatlGame.ctx.dungeon.findFirstMonster(new Position(cx, cy, LEVEL));
  const couatl = couatlGame.ctx.dungeon.getCreatureRecord(rn)!;
  couatl.creatureType = MonsterType.mon_Couatl;
  couatl.numMonM1 = 0;
  const slot = couatlGame.ctx.dungeon.getAttachedItem16(couatl)!;
  let flips = 0;
  let agree = true;
  for (let i = 0; i < 200; i++) {
    const from = couatlAsked.length;
    couatlGame.systems.monsters.nextMonsterUpdateTime(slot, 0, false, cx, cy, LEVEL);
    const mirrored = ((slot.singleMonsterStatus[0] ?? 0) & SMS_MIRROR) !== 0;
    const sounds = couatlAsked.slice(from);
    if (mirrored) flips++;
    const expected = mirrored ? [`23 ${cx},${cy} 1`] : [];
    if (sounds.map((a) => `${a.ordinal} ${a.x},${a.y} ${a.deltaTime}`).join() !== expected.join()) agree = false;
  }
  console.log(`\na couatl's 200 non-attack aspects: ${flips} heads, each heard`);
  check(flips > 50 && flips < 150 && agree, 'a couatl not attacking asks for sound 23 on each heads, on its square, and on no tails');

  // 4. The attack sounds. The level's first group takes each creature type in turn and strikes.
  const attackSound = (g: Game, gAsked: Asked[]): number[] => {
    const [first] = groups(g).keys();
    const [gx, gy] = first!.split(',').map(Number) as [number, number];
    const monsterRn = g.ctx.dungeon.findFirstMonster(new Position(gx, gy, LEVEL)) as ObjectID;
    const monster = g.ctx.dungeon.getCreatureRecord(monsterRn)!;
    // The party one square south of it, the way the group faces to strike.
    g.ctx.party.state.position = new Position(gx, gy + 1, LEVEL);
    return Array.from({ length: 27 }, (_, type) => {
      monster.creatureType = type;
      const from = gAsked.length;
      g.systems.monsterAttack.monsterAttacks(monsterRn, monster, gx, gy, 0,
        { level: LEVEL, primaryDirectionToParty: 2, orthogonalDistanceToParty: 1 });
      const sound = gAsked.slice(from).find((a) => a.deltaTime === 1 && a.x === gx && a.y === gy);
      return sound ? sound.ordinal : -1;
    });
  };
  const attackGame = amigaGame();
  const amigaAttack = attackSound(attackGame, setUp(attackGame));
  const atariGame = stockGame();
  const atariAttack = attackSound(atariGame, setUp(atariGame));
  const fmt = (list: number[]): string => list.map((s) => (s < 0 ? '-' : String(s))).join(' ');
  console.log(`\nattack sounds by creature type, dm-amiga: ${fmt(amigaAttack)}`);
  console.log(`                              dm-atari: ${fmt(atariAttack)}`);
  check(fmt(amigaAttack) === '15 - 21 - 3 - 14 29 7 4 7 - 16 31 - 19 4 - 16 - 30 14 - - 3 - -',
    'dm-amiga: A22E\'s attack sounds, the rock 29, the water elemental 30 and the couatl 31');
  check(fmt(atariAttack) === '15 - 21 - 3 - 14 - 7 4 7 - 16 - - 19 4 - 16 - - 14 - - 3 - -',
    'dm-atari: CSBWin\'s');

  // 5. The war cry and the horn.
  const actions = (g: Game, gAsked: Asked[]): string => {
    const party = g.ctx.party.state;
    const facing = party.champions[0]!.facing & 3;
    const ax = party.position.x + g.ctx.tables.deltaX[facing]!;
    const ay = party.position.y + g.ctx.tables.deltaY[facing]!;
    return [AttackType.atk_WARCRY, AttackType.atk_BLOWHORN, AttackType.atk_CALM, AttackType.atk_BRANDISH, AttackType.atk_CONFUSE]
      .map((type) => {
        const from = gAsked.length;
        g.systems.attack.attack(0, type);
        const sounds = gAsked.slice(from).filter((a) => a.ordinal >= 22);
        return `${AttackType[type]}:${sounds.map((a) => `${a.ordinal}${a.x === ax && a.y === ay ? ' ahead' : ` ${a.x},${a.y}`} ${a.deltaTime}`).join('+') || '-'}`;
      }).join(' ');
  };
  const played: string[] = [];
  const cryGame = amigaGame({ playAmigaSound: (ordinal, _period, volume) => played.push(`${ordinal} ${volume.left}/${volume.right}`) });
  const cries = actions(cryGame, setUp(cryGame));
  console.log(`\ndm-amiga: ${cries}; played ${played.filter((p) => p.startsWith('28 ') || p.startsWith('25 ')).join(', ')}`);
  check(cries === 'atk_WARCRY:28 ahead 0 atk_BLOWHORN:25 ahead 0 atk_CALM:- atk_BRANDISH:- atk_CONFUSE:-',
    'dm-amiga: the war cry asks for sound 28 and the horn 25, on the square ahead, at once; calm, brandish and confuse nothing');
  check(played.includes('28 58/58') && played.includes('25 58/58'), 'and both play at once, 58 on each channel one square ahead');
  const atariCryGame = stockGame();
  const atariCries = actions(atariCryGame, setUp(atariCryGame));
  check(atariCries === 'atk_WARCRY:- atk_BLOWHORN:- atk_CALM:- atk_BRANDISH:- atk_CONFUSE:-', 'dm-atari: none of them');

  // 6. A delayed sound past the Atari's 22.
  const delayGame = amigaGame();
  setUp(delayGame);
  delayGame.ctx.sounds.queueSound(28, PARTY.x, PARTY.y, 3, LEVEL);
  const tt20 = delayGame.ctx.timers.getTimers().filter((t) => t.function === TimerFunction.TT_20);
  console.log(`\nsound 28 three ticks on: TT_20 priority ${tt20.map((t) => t.uByte5).join()}`);
  check(tt20.length === 1 && tt20[0]!.uByte5 === 106, 'a delayed sound 28 waits in a TT_20 with its Priority, 106');

  finish();
}

main();
