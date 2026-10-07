/**
 * Skins (`DEBT.md` G27, step 1): `SKIN_CACHE` (`doc/CSBwin-src/data.cpp:2058-2171`,
 * `src/engine/SkinCache.ts`) and the DSA operations on it, `&GETSKIN` and `&SETSKIN`
 * (`doc/CSBwin-src/DSA.cpp:3107-3135`).
 *
 * 1. **The skins in the bytes.** Each `(EDT_Skins << 24) + (level << 4) + (x / 2)` record
 *    of Conflux 3.5's and The Towers of Chaos 3.3's pools, decoded here a byte at a time,
 *    is what `GetSkin` reads at every cell, and no skin lies past its level. The canary
 *    is the byte order. Read little-endian (`DB11::swap`, `data.cpp:1458-1467`), 13% of
 *    Conflux's skinned cells are solid rock, which is two thirds of its cells: a skin
 *    dresses the cells the party sees. Read big-endian, which moves each skin to the
 *    other corner of its two by two, 45% are. The Towers of Chaos skins two by two
 *    blocks, which the order does not tell apart. The default skins' record,
 *    `(EDT_Skins << 24) + 0x800000`, is a byte a level.
 * 2. **Off the level** (`data.cpp:2088-2112`): `GetSkin` says 0 for a level, column or
 *    row below 0 or past the level's last, and for a level past the dungeon's.
 * 3. **`&GETSKIN` and `&SETSKIN`** on `csbgame7.dat`, which has no skins: a location's
 *    level, column and row from its bits, the skin's low byte kept, the record's bytes
 *    and length, a skin of 0 that empties the record and takes it out of the pool, and
 *    `SetSkin`'s two cases that write nothing.
 * 4. **A save**: a Conflux cell's skin set, saved and loaded into a game that had read
 *    that cell. Every skin of the dungeon comes back, the new one with them: the cache
 *    is a new one with each world read, where CSBWin's `Cleanup` empties it.
 *
 * Run: `npx tsx tools/dump-skins.ts`
 */
import { readFileSync } from 'node:fs';

import { Position, RoomType, locationRelToInteger } from '../src/core/types';
import { Expool } from '../src/data/CsbwinExpool';
import type { DungeonData } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { StkOp } from '../src/engine/DsaSystem';
import { DungeonState } from '../src/engine/DungeonState';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { SkinCache } from '../src/engine/SkinCache';
import { freshGame, int, op, run } from './lib/dsa';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const TOWERS = 'static/gamefiles/towers-of-chaos-3.3/dungeon.dat';
const EDT_SKINS = 4;
const skinsKey = (level: number, x: number): number => ((EDT_SKINS << 24) + (level << 4) + (x >> 1)) >>> 0;
const DEFAULT_SKINS_KEY = ((EDT_SKINS << 24) + 0x800000) >>> 0;
const loc = (l: number, x: number, y: number): number => locationRelToInteger({ l, x, y, p: 0 });
const GLOBALSTORE = 20;
const globalStore = (index: number): number => GLOBALSTORE | (index << 6);

const load = (path: string): DungeonData => new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(path)));

/** Byte `i` of a record, its longwords taken little-endian, or big-endian. */
const byteLE = (record: readonly number[], i: number): number => (record[i >> 2]! >>> (8 * (i & 3))) & 0xff;
const byteBE = (record: readonly number[], i: number): number => (record[i >> 2]! >>> (8 * (3 - (i & 3)))) & 0xff;

/** Every cell's skin as the cache reads it, `level:x:y` → skin, the nonzero ones. */
function cachedSkins(data: DungeonData, cache: SkinCache): Map<string, number> {
  const skins = new Map<string, number>();
  data.maps.forEach((map, level) => {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const skin = cache.GetSkin(level, x, y);
        if (skin !== 0) skins.set(`${level}:${x}:${y}`, skin);
      }
    }
  });
  return skins;
}

console.log('1. The skins in the bytes');
for (const [name, path, expected] of [
  ['Conflux 3.5', CONFLUX, { cells: 11407, distinct: 42 }],
  ['The Towers of Chaos 3.3', TOWERS, { cells: 4530, distinct: 5 }],
] as const) {
  const data = load(path);
  const expool = new Expool(data);
  const dungeon = new DungeonState(data);
  const isRock = (level: number, x: number, y: number): boolean =>
    ((dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 7) === RoomType.STONE;
  const keys = [...new Set(expool.keys().filter((key) => key >>> 24 === EDT_SKINS && (key & 0x800000) === 0))];
  const decoded = new Map<string, number>();
  let outside = 0;
  const rock = { le: 0, be: 0, leOf: 0, beOf: 0 };
  for (const key of keys) {
    const level = (key & 0xffffff) >> 4;
    const pair = key & 15;
    const record = expool.locate(key)!;
    const map = data.maps[level];
    for (let i = 0; i < Math.min(64, 4 * record.length); i++) {
      const x = 2 * pair + (i & 1);
      const y = i >> 1;
      const inside = !!map && x < map.descriptor.width && y < map.descriptor.height;
      if (byteLE(record, i) !== 0) {
        if (!inside) outside++;
        else {
          decoded.set(`${level}:${x}:${y}`, byteLE(record, i));
          rock.leOf++;
          if (isRock(level, x, y)) rock.le++;
        }
      }
      if (byteBE(record, i) !== 0 && inside) {
        rock.beOf++;
        if (isRock(level, x, y)) rock.be++;
      }
    }
  }
  const cached = cachedSkins(data, new SkinCache(data));
  const distinct = new Set(cached.values());
  console.log(`  ${name}: ${keys.length} records, ${cached.size} skinned cells, skins ${[...distinct].sort((a, b) => a - b).join(' ')}`);
  const share = (n: number, of: number): string => `${(100 * n / of).toFixed(1)}%`;
  console.log(`    skinned cells of solid rock: ${share(rock.le, rock.leOf)} little-endian, ${share(rock.be, rock.beOf)} big-endian`);
  check(outside === 0, `${name}: no skin lies past its level`);
  if (path === CONFLUX) {
    check(rock.le / rock.leOf < 0.2 && rock.be / rock.beOf > 0.4,
      'Conflux, the canary: read little-endian, its skins dress the cells that are not rock');
  }
  check(cached.size === decoded.size && [...decoded].every(([at, skin]) => cached.get(at) === skin),
    `${name}: GetSkin reads every cell's byte`);
  check(cached.size === expected.cells && distinct.size === expected.distinct,
    `${name}: ${expected.cells} skinned cells, ${expected.distinct} different skins`);

  const cache = new SkinCache(data);
  const defaults = data.maps.map((_, level) => cache.GetDefaultSkin(level));
  const record = expool.locate(DEFAULT_SKINS_KEY);
  console.log(`    default skins (record of ${record ? record.length : 'no'} longwords): ${defaults.join(' ')}`);
  check(defaults.every((skin, level) => skin === (record && level < 4 * record.length ? byteLE(record, level) : 0)),
    `${name}: GetDefaultSkin reads the record's byte a level`);
  if (path === CONFLUX) {
    check(defaults.filter((skin) => skin === 11).length > data.maps.length / 2, 'Conflux: most levels default to skin 11');
  } else {
    check(defaults.every((skin) => skin === 0), 'The Towers of Chaos: every default skin is 0');
  }
}

console.log('2. Off the level');
{
  const data = load(CONFLUX);
  const cache = new SkinCache(data);
  const [level, x, y] = [...cachedSkins(data, cache).keys()][0]!.split(':').map(Number) as [number, number, number];
  const map = data.maps[level]!;
  const off = [
    cache.GetSkin(-1, x, y), cache.GetSkin(level, -1, y), cache.GetSkin(level, x, -1),
    cache.GetSkin(level, map.descriptor.width, y), cache.GetSkin(level, x, map.descriptor.height),
    cache.GetSkin(data.maps.length, x, y),
  ];
  console.log(`  around ${level}:${x}:${y} (skin ${cache.GetSkin(level, x, y)}): ${off.join(' ')}`);
  check(off.every((skin) => skin === 0), 'GetSkin says 0 off the level, and past the last level');
}

console.log('3. &GETSKIN and &SETSKIN');
{
  // Each program stores into globals 0 to 3 what `&GETSKIN` reads after its sets.
  const get = (l: number, x: number, y: number, g: number): number[] => [...int(loc(l, x, y)), op(StkOp.GET_SKIN), globalStore(g)];
  const set = (skin: number, l: number, x: number, y: number): number[] => [...int(skin), ...int(loc(l, x, y)), op(StkOp.SET_SKIN)];
  const { game, g } = run([
    ...get(1, 5, 3, 0),
    ...set(0x1ff, 1, 5, 3), ...get(1, 5, 3, 1), ...get(1, 4, 3, 2), ...get(1, 5, 4, 3),
  ]);
  const expool = new Expool(game.ctx.state.dungeon);
  const record = expool.locate(skinsKey(1, 5));
  console.log(`  before 0x${g[0]!.toString(16)}, after 0x${g[1]!.toString(16)}, its pair's 0x${g[2]!.toString(16)}, below 0x${g[3]!.toString(16)}`);
  console.log(`  record: ${record?.map((w) => w.toString(16).padStart(8, '0')).join(' ')}`);
  check(g[0] === 0 && g[1] === 0xff && g[2] === 0 && g[3] === 0,
    "a skin is set at the location's level, column and row, its low byte kept");
  // Byte 7, (2 * 3) + (5 & 1): the second longword's top byte.
  check(record?.length === 2 && record[0] === 0 && record[1] === 0xff000000,
    "the record is byte 7's two longwords, little-endian");

  const pool = (): string => Array.from(game.ctx.state.dungeon.expool ?? []).join();
  const cache = game.ctx.dungeon.skinCache;
  const before = pool();
  cache.SetSkin(1, 5, 3, 0xff);
  cache.SetSkin(1, 5, 30, 0);
  cache.SetSkin(1, 8, 2, 0);
  check(pool() === before, 'SetSkin writes nothing for the skin a cell holds, nor for a 0 past the record or with none');

  cache.SetSkin(1, 4, 20, 9);
  const longer = expool.locate(skinsKey(1, 5))?.length;
  cache.SetSkin(1, 4, 20, 0);
  const trimmed = expool.locate(skinsKey(1, 5))?.length;
  check(longer === 11 && trimmed === 2 && cache.GetSkin(1, 5, 3) === 0xff,
    `a skin further down lengthens the record to its byte (${longer}), and a 0 trims it back (${trimmed})`);
  cache.SetSkin(1, 5, 3, 0);
  check(expool.locate(skinsKey(1, 5)) === null && cache.GetSkin(1, 5, 3) === 0,
    'a 0 on the last skin takes the record out of the pool');
}

console.log('4. A save');
{
  const data = load(CONFLUX);
  const game = newGame(data, stockGraphics());
  const cache = game.ctx.dungeon.skinCache;
  const before = cachedSkins(data, cache);
  // A cell that has a skin, and a cell of no record, given one each.
  const [l, x, y] = [...before.keys()][100]!.split(':').map(Number) as [number, number, number];
  const skin = (before.get(`${l}:${x}:${y}`)! % 40) + 1;
  cache.SetSkin(l, x, y, skin);
  let bare: [number, number, number] | null = null;
  for (let level = 0; level < data.maps.length && !bare; level++) {
    for (let px = 0; px < data.maps[level]!.descriptor.width && !bare; px++) {
      if (new Expool(data).locate(skinsKey(level, px)) === null) bare = [level, px, 0];
    }
  }
  cache.SetSkin(bare![0], bare![1], bare![2], 200);
  const expected = new Map(before);
  expected.set(`${l}:${x}:${y}`, skin);
  expected.set(`${bare![0]}:${bare![1]}:${bare![2]}`, 200);

  const other = freshGame();
  // The other game reads a cell first, so a cache kept across the read would answer 0.
  other.ctx.dungeon.skinCache.GetSkin(l, x, y);
  applyCsbwinSave(other, buildSaveFile(game));
  const after = cachedSkins(other.ctx.state.dungeon, other.ctx.dungeon.skinCache);
  console.log(`  set ${l}:${x}:${y} to ${skin} and ${bare!.join(':')} to 200; ${after.size} skinned cells loaded`);
  check(after.size === expected.size && [...expected].every(([at, s]) => after.get(at) === s),
    "a save keeps every cell's skin, the two set in play with them");
  check(data.maps.every((_, level) => other.ctx.dungeon.skinCache.GetDefaultSkin(level) === cache.GetDefaultSkin(level)),
    'and the default skins');
}

finish();
