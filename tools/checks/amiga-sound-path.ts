/**
 * The `dm-amiga` set hears a sound as A22E's `F0064_SOUND_RequestPlay_CPSD` has it
 * (ReDMCSB `SOUND.C:1476-1754`), on its two voices (`F0060_SOUND_Play_CPSX`,
 * `SOUND.C:1057-1114`), and `dm-atari` as CSBWin's `QueueSound` has it:
 *
 *  1. `getVolume`, `F0505_SOUND_GetVolume` (`SOUND.C:1871-1919`), at each of the four
 *     facings: 64 on the party's square, 58, 29 and 20 one, two and three squares ahead,
 *     41 one behind, and one square to the right 58 on the right channel and 6 on the
 *     left; 5 twelve squares ahead, and nothing heard thirteen ahead or to the right.
 *  2. `compareVolumes`, `F0502_SOUND_CompareVolumes` (`SOUND.C:227-268`): the two channels'
 *     sum in three classes, below 15, 15 to 25, above 25.
 *  3. `QueueSound` with `deltaTime` 0 plays at once, at the entry's period and the
 *     square's volume; with 1 it waits until `StartQueuedSound`, which a tick runs
 *     (`doc/CSBwin-src/CSBCode.cpp:666`, A22E's `GAMELOOP.C:115`); a third pending sound
 *     takes the place of one it is louder than, the second's if the first is the louder,
 *     else the first's, or of one as loud with a lower `Priority`, and is dropped
 *     otherwise (`SOUND.C:1657-1714`); a sound thirteen squares away is not heard, and one
 *     with `deltaTime` 1 on another level than the party's neither.
 *  4. `SoundManager`'s voices: the first free voice, the second, then with both busy the
 *     second if the first's sound is the louder, else the first, whose sound stops; a
 *     voice that played out is free again. Each channel at its volume of Paula's 64, and a
 *     direct `playSound` at 64 on both. `dm-atari`'s sounds play mono, as before.
 *
 * Run: `npm test -- --only=amiga-sound-path.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SoundManager } from '../../src/audio/SoundManager';
import { SoundIndex } from '../../src/core/constants';
import { Direction } from '../../src/core/types';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { compareVolumes, getVolume, type SoundVolume } from '../../src/data/tables/AmigaSoundTables';
import { check, finish } from '../lib/check';
import { gameTablesOf, newGame, stockGame, stockGraphics } from '../lib/game';
import { installRecordingContext } from '../lib/recordingAudio';

const AMIGA = 'tools/fixtures/gamefiles/dm-amiga';
/** `C01_SOUND_SWITCH`, priority 15; `C00_SOUND_METALLIC_THUD` is 11 and `C08_SOUND_SWALLOW` 2 (ReDMCSB `DATA.C:1166-1174`). */
const SWITCH = 1;

/** One square ahead and one to the right, at each facing (`d.DeltaX`'s order: north, east, south, west). */
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const RIGHT = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

const show = (volume: SoundVolume | null): string => (volume ? `${volume.left}/${volume.right}` : '-');

/** A played sound: its ordinal, period and volume. */
interface Played {
  ordinal: number;
  period: number;
  volume: string;
}

function main(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(AMIGA, 'graphics.dat'))));
  const tables = gameTablesOf(graphics);
  const amiga = tables.amigaSounds;
  check(amiga !== null, 'dm-amiga\'s graphics.dat carries the Amiga\'s tables');
  if (!amiga) return finish();

  // 1. `getVolume` at each facing.
  console.log('facing  on  ahead1 ahead2 ahead3 ahead12 ahead13 behind1 right1 left1 right13');
  const px = 20;
  const py = 20;
  let facingsAgree = true;
  let first = '';
  for (let facing = 0; facing < 4; facing++) {
    const [ax, ay] = AHEAD[facing]!;
    const [rx, ry] = RIGHT[facing]!;
    const at = (ahead: number, right: number) => getVolume(amiga, px, py, facing, px + ax * ahead + rx * right, py + ay * ahead + ry * right);
    const row = [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(12, 0), at(13, 0), at(-1, 0), at(0, 1), at(0, -1), at(0, 13)].map(show).join(' ');
    console.log(`${Direction[facing]!.padEnd(6)} ${row}`);
    if (facing === 0) first = row;
    else if (row !== first) facingsAgree = false;
  }
  check(first === '64/64 58/58 29/29 20/20 5/5 - 41/41 6/58 58/6 -',
    'facing north: 64 on the square, 58, 29, 20 ahead, 5 twelve ahead, 41 behind, right 58 on the right and 6 on the left, nothing 13 away');
  check(facingsAgree, 'the same at each of the four facings');

  // 2. `compareVolumes`.
  const v = (left: number, right: number): SoundVolume => ({ left, right });
  check(compareVolumes(v(13, 1), v(0, 0)) === 0 && compareVolumes(v(8, 7), v(13, 1)) === 1
    && compareVolumes(v(13, 12), v(8, 7)) === 0 && compareVolumes(v(13, 13), v(13, 12)) === 1
    && compareVolumes(v(0, 14), v(64, 64)) === -1,
    'compareVolumes: sums below 15, 15 to 25 and above 25 are three classes, compared');

  // 3. `QueueSound` on a dm-amiga game.
  const played: Played[] = [];
  const atariPlayed: number[] = [];
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(AMIGA, 'dungeon.dat'))));
  const game = newGame(data, graphics, {
    playAmigaSound: (ordinal, period, volume) => played.push({ ordinal, period, volume: show(volume) }),
    playSound: (id) => atariPlayed.push(id),
  });
  const party = game.ctx.party.state;
  party.facing = Direction.NORTH;
  const { x: qx, y: qy, z } = party.position;
  const sounds = game.ctx.sounds;
  const take = (): string => played.splice(0).map((p) => `${p.ordinal}@${p.period} ${p.volume}`).join(', ');

  sounds.queueSound(SWITCH, qx, qy - 1, 0, z);
  const atOnce = take();
  console.log(`deltaTime 0, one ahead: ${atOnce}`);
  check(atOnce === '1@112 58/58', 'deltaTime 0 plays at once, ordinal 1 at period 112, 58 on both channels one square ahead');

  sounds.queueSound(SWITCH, qx + 1, qy, 1, z);
  const before = take();
  sounds.startQueuedSound();
  const after = take();
  console.log(`deltaTime 1, one right: '${before}', then at StartQueuedSound '${after}'`);
  check(before === '' && after === '1@112 6/58', 'deltaTime 1 waits for StartQueuedSound, and plays at the volume it was requested at');

  // A third sound louder than one of the two pending.
  const far = (n: number): [number, number] => [qx, qy - n];
  const pend = (ordinal: number, [x, y]: [number, number]) => sounds.queueSound(ordinal, x, y, 1, z);
  pend(0, far(10)); // 6/6, below 15
  pend(1, far(0)); // 64/64, above 25
  pend(8, far(5)); // 12/12, 15 to 25: louder than the first, which is the quieter
  sounds.startQueuedSound();
  const replacesFirst = take();
  pend(1, far(0));
  pend(0, far(10));
  pend(8, far(5)); // louder than the second, and the first is the louder
  sounds.startQueuedSound();
  const replacesSecond = take();
  console.log(`louder: '${replacesFirst}' and '${replacesSecond}'`);
  check(replacesFirst === '8@112 12/12, 1@112 64/64', 'a louder third sound takes the first\'s place when the first is not the louder');
  check(replacesSecond === '1@112 64/64, 8@112 12/12', 'and the second\'s when the first is the louder');

  // As loud: a higher priority takes the place, a lower one is dropped.
  pend(8, far(10)); // 6/6, priority 2
  pend(0, far(11)); // 6/6, priority 11
  pend(1, far(9)); // 7/7, as loud, priority 15: the first, priority 2, gives way
  sounds.startQueuedSound();
  const byPriority = take();
  pend(1, far(10)); // 6/6, priority 15
  pend(0, far(11)); // 6/6, priority 11
  pend(8, far(9)); // 7/7, priority 2: dropped
  sounds.startQueuedSound();
  const dropped = take();
  pend(1, far(10)); // 6/6, priority 15
  pend(8, far(11)); // 6/6, priority 2
  pend(0, far(9)); // 7/7, priority 11: not above the first's, above the second's
  sounds.startQueuedSound();
  const secondByPriority = take();
  console.log(`as loud: '${byPriority}', '${dropped}', '${secondByPriority}'`);
  check(byPriority === '1@112 7/7, 0@112 6/6' && secondByPriority === '1@112 6/6, 0@112 7/7',
    'a third sound as loud as the pending ones takes the place of the first with a lower Priority, else the second\'s');
  check(dropped === '1@112 6/6, 0@112 6/6', 'and one with no higher Priority than either is dropped');

  sounds.queueSound(SWITCH, qx, qy - 13, 0, z);
  sounds.queueSound(SWITCH, qx + 13, qy, 1, z);
  sounds.queueSound(SWITCH, qx, qy, 1, z + 1);
  sounds.startQueuedSound();
  check(take() === '', 'thirteen squares away, or with deltaTime 1 on another level, a sound is not heard');

  sounds.queueSound(SWITCH, qx, qy, 1, z);
  game.gameTick();
  const ticked = played.filter((p) => p.ordinal === SWITCH).map((p) => p.volume);
  console.log(`a pending sound across a tick: ${ticked.join(', ')}`);
  check(ticked.length === 1 && ticked[0] === '64/64', 'a tick plays the pending sounds (StartQueuedSound)');
  check(atariPlayed.length === 0, 'and dm-amiga never plays an engine sound through playSound');

  const atari = stockGame({ playSound: (id) => atariPlayed.push(id), playAmigaSound: () => played.push({ ordinal: -1, period: 0, volume: '' }) });
  const atariParty = atari.ctx.party.state.position;
  atari.ctx.sounds.queueSound(SWITCH, atariParty.x, atariParty.y, 1, atariParty.z);
  check(atariPlayed.length === 1 && played.length === 1, 'dm-atari plays a deltaTime 1 sound at once, through playSound, as CSBWin does');

  // 4. `SoundManager`'s voices.
  const context = installRecordingContext();
  const manager = new SoundManager(graphics);
  manager.setSoundTable(tables.sound1772, amiga);
  manager.playAmigaSound(0, 112, v(64, 64)); // the first voice
  manager.playAmigaSound(1, 112, v(6, 6)); // the second
  manager.playAmigaSound(8, 112, v(29, 29)); // both busy, the first the louder: the second's
  const [a, b, c] = context.started;
  check(!!a && !!b && !!c && !a.stopped && b.stopped && !c.stopped,
    'with both voices busy and the first the louder, the second voice\'s sound stops for the third');
  manager.playAmigaSound(0, 112, v(58, 6)); // both busy, as loud: the first's
  const d = context.started[3];
  check(!!a && a.stopped && !!c && !c.stopped && !!d && !d.stopped, 'and with both as loud, the first voice\'s');
  console.log(`one square to the right: left ${d?.left} right ${d?.right}`);
  check(d?.left === 58 / 64 && d.right === 6 / 64, 'each channel plays at its volume of Paula\'s 64');
  c?.end();
  manager.playAmigaSound(1, 112, v(1, 1)); // the second voice played out: free
  check(!!d && !d.stopped && context.started.length === 5, 'a voice whose sound played out is free again');
  manager.playSound(SoundIndex.WALL_BUMP);
  const bump = context.started.at(-1);
  check(bump?.left === 1 && bump.right === 1, 'a direct playSound plays on a voice at 64 on both channels');

  const stock = stockGraphics();
  const atariManager = new SoundManager(stock);
  atariManager.setSoundTable(gameTablesOf(stock).sound1772, null);
  atariManager.playSound(SoundIndex.WALL_BUMP);
  const atariBump = context.started.at(-1);
  check(atariBump !== bump && atariBump?.left === null && atariBump.right === null, 'dm-atari\'s sound plays mono, on no voice');
  finish();
}

main();
