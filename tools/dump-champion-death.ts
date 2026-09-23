/**
 * However a champion dies, they must leave bones.
 *
 * `KillCharacter` (`doc/CSBwin-src/Character.cpp:2526`) is the *only* way a champion's
 * hit points reach zero in CSBWin, and everything that matters afterwards hangs off it:
 * the possessions drop, a `misc_BonesOfHero` with `value(2)` appears in the champion's
 * corner, the expool records the bones↔fingerprint pairing the Altar of Vi resolves
 * through, the cursor and the magic tab move to somebody living, and `d.GameIsLost` is
 * set when nobody is. A path that zeroes `health` by hand skips all six.
 *
 * Two paths in this port used to do exactly that, so a champion killed by exhaustion or
 * by a missile was unresurrectable and a party wiped by either did not lose the game:
 *
 *   - `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4413`) turns an overshoot below
 *     zero into `DamageCharacter(chIdx, overshoot/2, 0, 0)` — mask and kind both zero,
 *     so exhaustion bypasses armour and cannot wound, but it can kill;
 *   - `ProcessMissileEncounter`'s party arm (`:1947-1958`, `:2044-2056`) resolves the
 *     corner to a champion, asks `DetermineMagicDamage` for the blow, and applies it
 *     with `DamageCharacter(chIdx, damage, 12, kind)`.
 *
 * This drives both, plus a plain `DamageCharacter`, and checks the same six
 * consequences each time. It also tabulates `DetermineMagicDamage` across the
 * projectile kinds, where the interesting part is not the numbers — they are random —
 * but which *arm* each projectile takes, which the `kind` and poison columns give away.
 *
 * Last, it checks `DamageCharacter`'s early guards (`Character.cpp:2712-2717`): the
 * recruit in a Hall of Champions mirror and a won game are unhurtable, and the blow is
 * cut to 16 bits first.
 *
 * What to look for: the death table's columns should be identical across all three
 * rows. Anything that reads `false` in one row and `true` in the others is a path that
 * has slipped out of `KillCharacter` again.
 *
 * Run: `npx tsx tools/dump-champion-death.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MISC_BONES_OF_HERO } from '../src/core/constants';
import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, fail, finish } from './lib/check';

/** `RNFireball` and friends (`doc/CSBwin-src/CSBTypes.h:239-247`). */
const RN_FIREBALL = 0xff80;
const RN_POISON = 0xff81;
const RN_LIGHTNING = 0xff82;
const RN_DISPELL_MISSILE = 0xff83;
const RN_POISON_BOLT = 0xff86;

/**
 * Low hit points so a single blow is fatal, and one real possession so the drop is
 * visible. Stamina is small for the same reason on the exhaustion path.
 */
function champion(i: number, name: string): Champion {
  const possessions: Array<ObjectID | null> = new Array(30).fill(null);
  return {
    name,
    attributes: {
      health: 20, maxHealth: 20, stamina: 12, maxStamina: 12, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
    possessions,
    partyPosition: i,
  };
}

function makeGame(championCount: number): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < championCount; i++) game.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** An open cell with an open neighbour to the west, so a missile has somewhere to fly from. */
function findCellWithWestNeighbour(game: Game): Position | null {
  const dungeon = game.dungeonState;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 2; x < map.descriptor.width - 1; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        const here = map.cellFlags[x]?.[y];
        const west = map.cellFlags[x - 1]?.[y];
        if (here === undefined || west === undefined) continue;
        if (((here >> 5) & 0x7) !== RoomType.OPEN) continue;
        if (((west >> 5) & 0x7) !== RoomType.OPEN) continue;
        if ((here & 0x08) !== 0 || (west & 0x08) !== 0) continue; // both must start empty
        return new Position(x, y, z);
      }
    }
  }
  return null;
}

/** Give the champion something to carry, so `DropAllPossessions` has work to do. */
function armChampion(game: Game, chIdx: number): void {
  const data = game.dungeonState.getData();
  const db = data.databases.weapons;
  db.records.push({
    nextObject: OBJECT_ID_EOF,
    broken: false, charges: 0, litTorch: false, poisoned: false, cursed: false,
    important: false, weaponType: 8, // a dagger
  });
  db.count++;
  const rn = encodeObjectID(0, DBType.WEAPON, db.records.length - 1) as ObjectID;
  const champ = game.party.state.champions[chIdx]!;
  champ.possessions![1] = rn;
  champ.weaponHand = rn;
}

function bonesAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.dungeonState.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.dungeonState.getDBRecordLink(rn)
  ) {
    if (decodeObjectID(rn).category !== DBType.MISC) continue;
    if (game.dungeonState.getMiscRecord(rn)?.miscType === MISC_BONES_OF_HERO) out.push(rn);
    if (out.length > 32) break;
  }
  return out;
}

/** The six consequences of a death, in one row. */
type Aftermath = {
  dead: boolean;
  bones: boolean;
  bonesValue2: boolean;
  expoolRecord: boolean;
  dropped: boolean;
  gameIsLost: boolean;
};

function aftermath(game: Game, cell: Position, chIdx: number, lastAlive: boolean): Aftermath {
  const champ = game.party.state.champions[chIdx]!;
  const bones = bonesAt(game, cell);
  const rn = bones[0];
  const record = rn === undefined ? null : game.dungeonState.getMiscRecord(rn);
  return {
    dead: champ.alive === false && champ.attributes.health === 0,
    bones: bones.length === 1,
    bonesValue2: (record?.specialState ?? 0) === 2,
    expoolRecord: rn !== undefined && game.dungeonState.copyChampionBonesRecord(rn) !== null,
    dropped: (champ.possessions ?? []).every((v) => v === null || v === undefined),
    // Only meaningful when the victim was the last one standing.
    gameIsLost: lastAlive ? game.party.state.gameIsLost === true : true,
  };
}

function report(label: string, a: Aftermath): void {
  console.log([
    label, a.dead, a.bones, a.bonesValue2, a.expoolRecord, a.dropped, a.gameIsLost,
  ].join('\t'));
  check(a.dead, `${label}: the champion is dead`);
  check(a.bones, `${label}: exactly one bones object is left behind`);
  check(a.bonesValue2, `${label}: the bones carry value 2, a dead champion's marker`);
  check(a.expoolRecord, `${label}: and an expool record, so the Altar of Vi can resolve them`);
  check(a.dropped, `${label}: every possession was dropped`);
  check(a.gameIsLost, `${label}: with nobody left alive, the game is lost`);
}

function main(): void {
  console.log(['path', 'dead', 'bones', 'value=2', 'expool', 'dropped', 'gameIsLost'].join('\t'));

  /* ------------------------------------ 1. DamageCharacter, the control ---------- */
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g);
    if (!cell) { fail('no open cell with an open neighbour'); finish(); return; }
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    armChampion(g, 0);
    g.monsterAttack.damageCharacter(0, 999, 0, 0);
    report('DamageCharacter', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 2. exhaustion --------------------------- */
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g)!;
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    armChampion(g, 0);
    // Stamina 12, so a 100-point cost overshoots by 88 and `DamageCharacter` takes 44
    // — more than the 20 hit points the champion has.
    g.monsterAttack.adjustStamina(0, 100);
    check(g.party.state.champions[0]!.attributes.stamina === 0, 'exhaustion: stamina bottoms out at 0');
    report('AdjustStamina', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 3. a missile in the face ----------------- */
  console.log('');
  console.log('=== a missile reaching the party ===');
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g)!;
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    armChampion(g, 0);
    const champ = g.party.state.champions[0]!;
    // The missile resolves the *corner it arrives at* through `CharacterAtPosition`,
    // so the champion has to be standing in the one the missile carries.
    champ.partyPosition = 0;

    const launch = new Position(cell.x - 1, cell.y, cell.z);
    console.log(`firing a fireball east from (${launch.x},${launch.y}) into (${cell.x},${cell.y}) level ${cell.z}`);
    console.log('');
    console.log(['shot', 'health before', 'health after', 'alive'].join('\t'));

    // Read the flag through a call: written inline, TypeScript narrows `alive` to
    // `true` inside the loop and rejects the checks that follow.
    const alive = (): boolean => g.party.state.champions[0]!.alive !== false;
    let shots = 0;
    while (alive() && shots < 12) {
      shots++;
      const before = champ.attributes.health;
      g.timerSystem.launchThrownMissile(RN_FIREBALL, launch, 0, 1 /* east */, 255, 255, 0, g.state.tickCount);
      for (let i = 0; i < 6 && alive(); i++) {
        g.state.tickCount++;
        g.timerSystem.processTimers(g.state.tickCount);
      }
      console.log([shots, before, champ.attributes.health, alive()].join('\t'));
      if (champ.attributes.health === before && alive()) {
        fail('the missile reached the party but took no hit points off');
        break;
      }
    }
    check(shots < 12, 'a fireball into the party cell kills a 20-hit-point champion within a few shots');
    console.log('');
    console.log(['path', 'dead', 'bones', 'value=2', 'expool', 'dropped', 'gameIsLost'].join('\t'));
    report('missile', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 4. the cursor moves on ------------------- */
  console.log('');
  console.log('=== with somebody left alive, the game goes on and the cursor moves ===');
  {
    const g = makeGame(2);
    const cell = findCellWithWestNeighbour(g)!;
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    g.party.state.cursorOwner = 0;
    g.party.state.magicCasterIndex = 0;
    g.monsterAttack.adjustStamina(0, 100);
    const party = g.party.state;
    console.log(['', 'value'].join('\t'));
    console.log(['cursorOwner', party.cursorOwner].join('\t'));
    console.log(['magicCasterIndex', party.magicCasterIndex].join('\t'));
    console.log(['gameIsLost', String(party.gameIsLost === true)].join('\t'));
    check(party.champions[0]!.alive !== true, 'the exhausted champion still dies');
    check(party.cursorOwner === 1, 'and hands the cursor to the survivor');
    check(party.magicCasterIndex === 1, 'and the magic tab with it');
    check(party.gameIsLost !== true, 'but the game is not lost while one champion stands');
  }

  /* ------------------------------------ 5. DetermineMagicDamage ------------------ */
  //
  // The numbers are random; the *arms* are not. `kind` is CSBWin's `d.Word12964` and
  // names the mitigation `DamageCharacter` applies, so it identifies which branch of
  // `DetermineMagicDamage` a projectile took — which is the part a port gets wrong.
  console.log('');
  console.log('=== DetermineMagicDamage, by projectile ===');
  {
    const g = makeGame(1);
    const missile = { nextObject: OBJECT_ID_EOF, projectileObject: 0 as ObjectID, rangeRemaining: 200, damageRemaining: 200, timerIndex: 0 };
    console.log(['projectile', 'damage', 'kind', 'poison'].join('\t'));
    const of = (name: string, rn: number): { damage: number; kind: number; poisonStrength: number } => {
      const r = g.timerSystem.determineMagicDamage({ ...missile }, rn);
      console.log([name, r.damage, r.kind, r.poisonStrength].join('\t'));
      return r;
    };

    const dispel = of('dispel missile', RN_DISPELL_MISSILE);
    check(dispel.damage === 0, 'a dispel missile does a champion no damage at all');
    check(dispel.kind === 5, 'and is a spell-kind blow (5) if anything ever reads it');

    const bolt = of('poison bolt', RN_POISON_BOLT);
    check(bolt.damage === 1, 'a poison bolt does exactly 1 damage');
    check(bolt.kind === 5, 'at spell kind 5');
    check(bolt.poisonStrength === missile.rangeRemaining, 'and carries its whole remaining range as poison');

    const lightning = of('lightning', RN_LIGHTNING);
    check(lightning.kind === 7, 'lightning has a kind of its own, 7');
    check(lightning.poisonStrength === 0, 'and poisons nobody');

    const fireball = of('fireball', RN_FIREBALL);
    check(fireball.kind === 1, 'a fireball is kind 1, the fire mitigation');
    check(fireball.damage > 0, 'and actually hurts');

    // The non-obvious one: `RNPoison` is handled *before* the kind is ever changed, so
    // a poison cloud keeps the default kind 3 while every other spell does not
    // (`doc/CSBwin-src/Code11f52.cpp:1585-1591`).
    const poison = of('poison cloud', RN_POISON);
    check(poison.kind === 3, 'a poison cloud keeps the default kind 3, unlike every other spell');
    check(poison.poisonStrength >= 10 && poison.poisonStrength <= 25, 'and its poison strength is (0..15) + 10');
    check(poison.damage > 0, 'and it does physical damage too');
  }

  /* ------------------------------------ 6. who cannot be hurt ------------------- */
  //
  // `DamageCharacter`'s early guards (`doc/CSBwin-src/Character.cpp:2712-2717`), in
  // order: no champion, the recruit standing in a Hall of Champions mirror
  // (`return chIdx+1`), a won game (`return d.Word11694`), and a blow that is not
  // positive once cut to 16 bits (`D7W = sw(damage)`). The first two return non-zero,
  // so a caller reading the result sees "damage was dealt" — and a missile's poison
  // still gets its coin toss.
  console.log('');
  console.log('=== DamageCharacter\'s early guards ===');
  {
    const g = makeGame(2);
    const cell = findCellWithWestNeighbour(g)!;
    g.party.state.position = cell;
    g.monsterSystem.loadPartyLevel(cell.z);
    const recruit = g.party.state.champions[1]!;
    g.party.state.potentialChampionIndex = 1;
    const r = g.monsterAttack.damageCharacter(1, 999, 0, 0);
    console.log(`recruit: returned ${r}, health ${recruit.attributes.health}`);
    check(recruit.attributes.health === 20 && recruit.alive !== false,
      'a recruit still in the mirror cannot be hurt');
    check(r === 2, 'and DamageCharacter says chIdx+1');
    g.party.state.potentialChampionIndex = -1;

    const hero = g.party.state.champions[0]!;
    g.gameWon = true;
    const w = g.monsterAttack.damageCharacter(0, 999, 0, 0);
    console.log(`game won: returned ${w}, health ${hero.attributes.health}`);
    check(hero.attributes.health === 20 && hero.alive !== false, 'once the game is won nobody can be hurt');
    check(w === 1, 'and DamageCharacter returns d.Word11694, 1');
    g.gameWon = false;

    const big = g.monsterAttack.damageCharacter(0, 0x10000 + 5, 0, 0);
    console.log(`damage 0x10005: returned ${big}, health ${hero.attributes.health}`);
    check(big === 5 && hero.attributes.health === 15, 'the blow is cut to 16 bits first: 0x10005 is 5');
  }

  finish();
}

main();
