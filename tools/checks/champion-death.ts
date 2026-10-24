/**
 * However a champion dies, they must leave bones.
 *
 * `KillCharacter` (`doc/CSBwin-src/Character.cpp:2531`) is the *only* way a champion's
 * hit points reach zero in CSBWin, and everything that matters afterwards hangs off it:
 * the possessions drop, a `misc_BonesOfHero` with `value(2)` appears in the champion's
 * corner, the expool records the bones↔fingerprint pairing the Altar of Vi resolves
 * through, the cursor and the magic tab move to somebody living, and `d.GameIsLost` is
 * set when nobody is, and the dead champion is turned to face the party's way. A path
 * that zeroes `health` by hand skips all seven.
 *
 * Two paths in this port used to do exactly that, so a champion killed by exhaustion or
 * by a missile was unresurrectable and a party wiped by either did not lose the game:
 *
 *   - `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4451`) turns an overshoot below
 *     zero into `DamageCharacter(chIdx, overshoot/2, 0, 0)` — mask and kind both zero,
 *     so exhaustion bypasses armour and cannot wound, but it can kill;
 *   - `ProcessMissileEncounter`'s party arm (`:1982-1993`, `:2079-2091`) resolves the
 *     corner to a champion, asks `DetermineMagicDamage` for the blow, and applies it
 *     with `DamageCharacter(chIdx, damage, 12, kind)`.
 *
 * This drives both, plus a plain `DamageCharacter`, and checks the same seven
 * consequences each time. It also tabulates `DetermineMagicDamage` across the
 * projectile kinds, where the interesting part is not the numbers — they are random —
 * but which *arm* each projectile takes, which the `kind` and poison columns give away.
 *
 * Last, it checks `DamageCharacter`'s early guards (`Character.cpp:2717-2722`): the
 * recruit in a Hall of Champions mirror and a won game are unhurtable, and the blow is
 * cut to 16 bits first.
 *
 * What to look for: the death table's columns should be identical across all three
 * rows. Anything that reads `false` in one row and `true` in the others is a path that
 * has slipped out of `KillCharacter` again.
 *
 * Run: `npm test -- --only=champion-death.ts`
 */
import { MISC_BONES_OF_HERO } from '../../src/core/constants';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../../src/core/types';
import type { Direction, ObjectID } from '../../src/core/types';
import { Game } from '../../src/engine/Game';
import type { Champion } from '../../src/engine/gameTypes';
import { DescIndexOfRecord } from '../../src/engine/objectIndex';
import type { MiscRecord, WeaponRecord } from '../../src/data/dungeonTypes';
import { OBJNI_ILLUMULET_A, OBJNI_JEWEL_SYMAL_A, OBJNI_TORCH_A } from '../../src/core/objectNameIndex';
import { graphicsTablesOf, newGame, stockDungeon, stockGraphics } from '../lib/game';
import { standIn, standInOf } from '../lib/standIn';
import { check, fail, finish } from '../lib/check';
import { getChampionPossession } from '../../src/core/charDesc';
import { RN_FIREBALL, RN_POISON, RN_LIGHTNING, RN_DISPELL_MISSILE, RN_POISON_BOLT } from '../../src/core/spellRn';
import { testChampion } from '../lib/champion';

/**
 * Low hit points so a single blow is fatal, and one real possession so the drop is
 * visible. Stamina is small for the same reason on the exhaustion path.
 */
function champion(i: number, name: string): Champion {
  return testChampion(i, {
    name,
    attributes: { health: 20, maxHealth: 20, stamina: 12, maxStamina: 12, mana: 0, maxMana: 0 },
  });
}

/** `d.DropOrder[30]` as the last `makeGame` extracted it. */
let dropOrder: number[] = [];
/** `d.ObjDesc[].objectType` and `d.Word1074`, likewise. */
let objDescObjectType: ArrayLike<number> = [];
let word1074: number[] = [];

function makeGame(championCount: number): Game {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;
  const uiTables = graphicsTablesOf(graphics).ui;
  dropOrder = uiTables.graphic232.dropOrder;
  objDescObjectType = objectTables.objDescObjectType;
  word1074 = uiTables.graphic232.word1074;

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < championCount; i++) game.systems.hallOfChampions.addChampion(champion(i, `HERO${i}`));
  return game;
}

/** An open cell with an open neighbour to the west, so a missile has somewhere to fly from. */
function findCellWithWestNeighbour(game: Game): Position | null {
  const dungeon = game.ctx.dungeon;
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
  const data = game.ctx.dungeon.getData();
  const db = data.databases.weapons;
  const dagger = (): ObjectID => {
    db.records.push({
      nextObject: OBJECT_ID_EOF,
      broken: false, charges: 0, litTorch: false, poisoned: false, cursed: false,
      important: false, weaponType: 8, // a dagger
    });
    db.count++;
    return game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
  };
  const champ = game.ctx.party.state.champions[chIdx]!;
  const rn = dagger();
  champ.possessions![1] = rn;
  // Slot 8 as well, the quiver's first, which the drop empties like any other slot.
  const spare = dagger();
  champ.possessions![8] = spare;
  // Facing away from the party, so the death's `facing = d.partyFacing` shows.
  champ.facing = ((game.ctx.party.state.facing + 2) & 3) as Direction;
}

/** A fresh dagger record, as `armChampion` makes them. */
function newDagger(game: Game): ObjectID {
  const db = game.ctx.dungeon.getData().databases.weapons;
  db.records.push({
    nextObject: OBJECT_ID_EOF,
    broken: false, charges: 0, litTorch: false, poisoned: false, cursed: false,
    important: false, weaponType: 8,
  });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
}

/** The first weapon or misc type whose `ObjDesc` row names `objNI`. */
function typeNamed(category: DBType.WEAPON | DBType.MISC, objNI: number): number {
  for (let t = 0; t < 128; t++) {
    const record = category === DBType.WEAPON ? standInOf<WeaponRecord>({ weaponType: t }) : standInOf<MiscRecord>({ miscType: t });
    const di = DescIndexOfRecord(category, record);
    if (objDescObjectType[di] === objNI) return t;
  }
  throw new Error(`no ${DBType[category]} type is named ${objNI}`);
}

function newRecord(game: Game, category: DBType.WEAPON | DBType.MISC | DBType.SCROLL, record: object): ObjectID {
  const databases = game.ctx.dungeon.getData().databases;
  const db = category === DBType.WEAPON ? databases.weapons
    : category === DBType.MISC ? databases.misc : databases.scrolls;
  (db.records as object[]).push({ nextObject: OBJECT_ID_EOF, ...record });
  db.count++;
  return game.ctx.dungeon.rnMaps.rn(category, db.records.length - 1);
}

/** The cell's chain, in order. */
function chainAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF && out.length < 64;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) out.push(rn);
  return out;
}

/** Every cell holding `rn` (any corner), across the whole dungeon. */
function whereIs(game: Game, rn: ObjectID): Position[] {
  const found: Position[] = [];
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if ((map.cellFlags[x]![y]! & 0x10) === 0) continue;
        const cell = new Position(x, y, z);
        if (chainAt(game, cell).some((o) => o === rn)) found.push(cell);
      }
    }
  }
  return found;
}

/** An open pit (`0x08` set, not imaginary) — the test `WorldMove.isActivePitAt` makes. */
function findOpenPit(game: Game): Position | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount() - 1; z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const f = map.cellFlags[x]![y]!;
        if (((f >> 5) & 7) === RoomType.PIT && (f & 0x08) !== 0 && (f & 0x01) === 0 && (f & 0x10) === 0) {
          return new Position(x, y, z);
        }
      }
    }
  }
  return null;
}

/** Every bones object in the dungeon, with the cell it lies in. */
function everyBones(game: Game): { rn: ObjectID; cell: Position }[] {
  const dungeon = game.ctx.dungeon;
  const found: { rn: ObjectID; cell: Position }[] = [];
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if ((map.cellFlags[x]![y]! & 0x10) === 0) continue;
        const cell = new Position(x, y, z);
        for (const rn of bonesAt(game, cell)) found.push({ rn, cell });
      }
    }
  }
  return found;
}

function bonesAt(game: Game, cell: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.ctx.dungeon.findFirstObject(cell);
    rn !== OBJECT_ID_EOF;
    rn = game.ctx.dungeon.getDBRecordLink(rn)
  ) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.MISC) continue;
    if (game.ctx.dungeon.getMiscRecord(rn)?.miscType === MISC_BONES_OF_HERO) out.push(rn);
    if (out.length > 32) break;
  }
  return out;
}

/** The seven consequences of a death, in one row. */
type Aftermath = {
  dead: boolean;
  bones: boolean;
  bonesValue2: boolean;
  expoolRecord: boolean;
  dropped: boolean;
  gameIsLost: boolean;
  facesParty: boolean;
};

function aftermath(game: Game, cell: Position, chIdx: number, lastAlive: boolean): Aftermath {
  const champ = game.ctx.party.state.champions[chIdx]!;
  const bones = bonesAt(game, cell);
  const rn = bones[0];
  const record = rn === undefined ? null : game.ctx.dungeon.getMiscRecord(rn);
  return {
    dead: champ.attributes.health === 0,
    bones: bones.length === 1,
    bonesValue2: (record?.specialState ?? 0) === 2,
    expoolRecord: rn !== undefined && game.ctx.dungeon.copyChampionBonesRecord(rn) !== null,
    dropped: Array.from({ length: 30 }, (_, slot) => getChampionPossession(champ, slot)).every((v) => v === OBJECT_ID_NULL),
    // Only meaningful when the victim was the last one standing.
    gameIsLost: lastAlive ? game.ctx.party.state.gameIsLost : true,
    facesParty: champ.facing === game.ctx.party.state.facing,
  };
}

function report(label: string, a: Aftermath): void {
  console.log([
    label, a.dead, a.bones, a.bonesValue2, a.expoolRecord, a.dropped, a.gameIsLost, a.facesParty,
  ].join('\t'));
  check(a.dead, `${label}: the champion is dead`);
  check(a.bones, `${label}: exactly one bones object is left behind`);
  check(a.bonesValue2, `${label}: the bones carry value 2, a dead champion's marker`);
  check(a.expoolRecord, `${label}: and an expool record, so the Altar of Vi can resolve them`);
  check(a.dropped, `${label}: every possession was dropped`);
  check(a.gameIsLost, `${label}: with nobody left alive, the game is lost`);
  // `pcA3->facing = (ui8)d.partyFacing` (`doc/CSBwin-src/Character.cpp:2655`).
  check(a.facesParty, `${label}: and the dead champion faces the party's way`);
}

function main(): void {
  console.log(['path', 'dead', 'bones', 'value=2', 'expool', 'dropped', 'gameIsLost', 'facesParty'].join('\t'));

  /* ------------------------------------ 1. DamageCharacter, the control ---------- */
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g);
    if (!cell) { fail('no open cell with an open neighbour'); finish(); return; }
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    armChampion(g, 0);
    g.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
    g.systems.monsterAttack.displayCharacterDamage();
    report('DamageCharacter', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 2. exhaustion --------------------------- */
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g)!;
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    armChampion(g, 0);
    // Stamina 12, so a 100-point cost overshoots by 88 and `DamageCharacter` takes 44
    // — more than the 20 hit points the champion has.
    g.systems.monsterAttack.adjustStamina(0, 100);
    g.systems.monsterAttack.displayCharacterDamage();
    check(g.ctx.party.state.champions[0]!.attributes.stamina === 0, 'exhaustion: stamina bottoms out at 0');
    report('AdjustStamina', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 3. a missile in the face ----------------- */
  console.log('');
  console.log('=== a missile reaching the party ===');
  {
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g)!;
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    armChampion(g, 0);
    const champ = g.ctx.party.state.champions[0]!;
    // The missile resolves the *corner it arrives at* through `CharacterAtPosition`,
    // so the champion has to be standing in the one the missile carries.
    champ.partyPosition = 0;

    const launch = new Position(cell.x - 1, cell.y, cell.z);
    console.log(`firing a fireball east from (${launch.x},${launch.y}) into (${cell.x},${cell.y}) level ${cell.z}`);
    console.log('');
    console.log(['shot', 'health before', 'health after', 'alive'].join('\t'));

    const alive = (): boolean => g.ctx.party.state.champions[0]!.attributes.health !== 0;
    let shots = 0;
    while (alive() && shots < 12) {
      shots++;
      const before = champ.attributes.health;
      g.systems.magic.launchThrownMissile(RN_FIREBALL, launch, 0, 1 /* east */, 255, 255, 0, g.ctx.state.tickCount);
      for (let i = 0; i < 6 && alive(); i++) {
        g.systems.timer.processTimers();
        g.systems.monsterAttack.displayCharacterDamage();
        g.ctx.state.tickCount++;
      }
      console.log([shots, before, champ.attributes.health, alive()].join('\t'));
      if (champ.attributes.health === before && alive()) {
        fail('the missile reached the party but took no hit points off');
        break;
      }
    }
    check(shots < 12, 'a fireball into the party cell kills a 20-hit-point champion within a few shots');
    console.log('');
    console.log(['path', 'dead', 'bones', 'value=2', 'expool', 'dropped', 'gameIsLost', 'facesParty'].join('\t'));
    report('missile', aftermath(g, cell, 0, true));
  }

  /* ------------------------------------ 4. the cursor moves on ------------------- */
  console.log('');
  console.log('=== with somebody left alive, the game goes on and the cursor moves ===');
  {
    const g = makeGame(2);
    const cell = findCellWithWestNeighbour(g)!;
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    g.ctx.party.state.cursorOwner = 0;
    g.ctx.party.state.magicCasterIndex = 0;
    g.systems.monsterAttack.adjustStamina(0, 100);
    g.systems.monsterAttack.displayCharacterDamage();
    const party = g.ctx.party.state;
    console.log(['', 'value'].join('\t'));
    console.log(['cursorOwner', party.cursorOwner].join('\t'));
    console.log(['magicCasterIndex', party.magicCasterIndex].join('\t'));
    console.log(['gameIsLost', String(party.gameIsLost)].join('\t'));
    check(party.champions[0]!.attributes.health === 0, 'the exhausted champion still dies');
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
    const of = (name: string, rn: ObjectID): { damage: number; kind: number; poisonStrength: number } => {
      const r = g.systems.missileEncounter.determineMagicDamage({ ...missile }, rn);
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
    // (`doc/CSBwin-src/Code11f52.cpp:1620-1626`).
    const poison = of('poison cloud', RN_POISON);
    check(poison.kind === 3, 'a poison cloud keeps the default kind 3, unlike every other spell');
    check(poison.poisonStrength >= 10 && poison.poisonStrength <= 25, 'and its poison strength is (0..15) + 10');
    check(poison.damage > 0, 'and it does physical damage too');
  }

  /* ------------------------------------ 6. who cannot be hurt ------------------- */
  //
  // `DamageCharacter`'s early guards (`doc/CSBwin-src/Character.cpp:2717-2722`), in
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
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    const recruit = g.ctx.party.state.champions[1]!;
    g.ctx.party.state.potentialChampionIndex = 1;
    const r = g.systems.monsterAttack.damageCharacter(1, 999, 0, 0);
    console.log(`recruit: returned ${r}, health ${recruit.attributes.health}`);
    check(recruit.attributes.health === 20,
      'a recruit still in the mirror cannot be hurt');
    check(r === 2, 'and DamageCharacter says chIdx+1');
    g.ctx.party.state.potentialChampionIndex = -1;

    const hero = g.ctx.party.state.champions[0]!;
    g.gameWon = true;
    const w = g.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
    console.log(`game won: returned ${w}, health ${hero.attributes.health}`);
    check(hero.attributes.health === 20, 'once the game is won nobody can be hurt');
    check(w === 1, 'and DamageCharacter returns d.Word11694, 1');
    g.gameWon = false;

    const big = g.systems.monsterAttack.damageCharacter(0, 0x10000 + 5, 0, 0);
    g.systems.monsterAttack.displayCharacterDamage();
    console.log(`damage 0x10005: returned ${big}, health ${hero.attributes.health}`);
    check(big === 5 && hero.attributes.health === 15, 'the blow is cut to 16 bits first: 0x10005 is 5');
  }

  /* ------------------------------------ 7. DropAllPossessions -------------------- */
  //
  // `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2504-2525`) empties the slots in
  // `d.DropOrder` order, through `RemoveCharacterPossession`, and sets each object down
  // with `MoveObject(obj, -1, 0, partyX, partyY)`. `AddObjectToRoom` appends
  // (`doc/CSBwin-src/Code11f52.cpp:427`), so the cell's chain must list the dropped
  // objects in `DropOrder` order, not slot order — and on an open pit they fall.
  console.log('');
  console.log('=== DropAllPossessions ===');
  {
    const g = makeGame(1);
    // Canary: `DropOrder` sits at byte 244 of graphic 0x232 (`Byte1832+2` is offset 0,
    // `DropOrder` is 1586), and a misplaced read would not be a permutation of 0-29.
    console.log(`DropOrder ${dropOrder.join(',')}`);
    const sorted = [...dropOrder].sort((a, b) => a - b);
    check(dropOrder.length === 30 && sorted.every((v, i) => v === i),
      'DropOrder is a permutation of the thirty slots');

    const cell = findCellWithWestNeighbour(g)!;
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    const champ = g.ctx.party.state.champions[0]!;
    champ.partyPosition = 2;
    const armed = [0, 1, 5, 10, 13];
    const slotOf = new Map<number, number>();
    for (const slot of armed) {
      const rn = newDagger(g);
      champ.possessions[slot] = rn;
      slotOf.set(rn, slot);
    }
    g.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
    g.systems.monsterAttack.displayCharacterDamage();
    const dropped = chainAt(g, cell).filter((rn) => slotOf.has(rn));
    const got = dropped.map((rn) => slotOf.get(rn)!);
    const want = dropOrder.filter((slot) => armed.includes(slot));
    console.log(`slots ${armed.join(',')} land in the order ${got.join(',')} (DropOrder says ${want.join(',')})`);
    check(got.join(',') === want.join(','), 'the dropped objects are chained in DropOrder order');
    check(dropped.every((rn) => g.ctx.dungeon.rnMaps.pos(rn) === 2),
      'each is turned to the dying champion\'s corner');

    const g2 = makeGame(1);
    const pit = findOpenPit(g2);
    if (!pit) {
      fail('no open pit in the dungeon');
    } else {
      g2.ctx.party.state.position = pit;
      g2.systems.monsters.loadPartyLevel(pit.z);
      const rn = newDagger(g2);
      g2.ctx.party.state.champions[0]!.possessions[1] = rn;
      g2.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
      g2.systems.monsterAttack.displayCharacterDamage();
      const at = whereIs(g2, rn);
      console.log(`dying over the open pit at (${pit.x},${pit.y}) level ${pit.z}: the dagger is at `
        + (at.map((p) => `(${p.x},${p.y}) level ${p.z}`).join(' ') || 'nowhere'));
      check(at.length === 1 && at[0]!.z > pit.z, 'a possession dropped over an open pit falls through it');

      // C31: `KillCharacter` sets the bones down with the same `MoveObject(objD4, -1, 0,
      // partyX, partyY)` (`doc/CSBwin-src/Character.cpp:2641-2650`), so they fall too, and
      // `expool.AddChampionBonesRecord(objD4, …)` still pairs them wherever they land.
      const bones = everyBones(g2);
      console.log('the bones are at '
        + (bones.map(({ rn, cell }) => `(${cell.x},${cell.y}) level ${cell.z} as 0x${rn.toString(16)}`).join(' ') || 'nowhere'));
      check(bonesAt(g2, pit).length === 0, 'no bones are left lying on the open pit');
      check(bones.length === 1 && bones[0]!.cell.z > pit.z, 'the bones fall through the pit like the possessions');
      check(bones.length === 1 && g2.ctx.dungeon.copyChampionBonesRecord(bones[0]!.rn) !== null,
        'the fallen bones are still paired in the expool');
      check(bones.length === 1 && g2.ctx.dungeon.rnMaps.pos(bones[0]!.rn) === (g2.ctx.party.state.champions[0]!.partyPosition & 3),
        'and lie in the dead champion\'s corner');
    }
  }

  /* ------------------------------ 8. RemoveCharacterPossession ------------------ */
  //
  // C30. `DropAllPossessions` takes every slot out through `RemoveCharacterPossession`
  // (`doc/CSBwin-src/Character.cpp:1827-1935`), which undoes what wearing or holding an
  // object did: round the neck an Illumulet gets `value(0)` and takes `d.Word1074[2]` off
  // `d.Brightness`, a Jewel Symal gets `value(0)` (`:1865-1881`); in the weapon hand a
  // scroll closes (`:1896-1900`); in either hand a torch goes out (`:1902-1909`).
  console.log('');
  console.log('=== RemoveCharacterPossession ===');
  {
    const g = makeGame(2);
    const cell = findCellWithWestNeighbour(g)!;
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    const torchType = typeNamed(DBType.WEAPON, OBJNI_TORCH_A);
    const illumuletType = typeNamed(DBType.MISC, OBJNI_ILLUMULET_A);
    const symalType = typeNamed(DBType.MISC, OBJNI_JEWEL_SYMAL_A);
    const step = word1074[2] ?? 0;
    console.log(`torch is weapon ${torchType}, Illumulet misc ${illumuletType}, Jewel Symal misc ${symalType}; `
      + `Word1074[2] = ${step}`);
    check(step !== 0, 'the Illumulet has a brightness step to take off');

    const torch = newRecord(g, DBType.WEAPON, {
      broken: false, charges: 10, litTorch: true, poisoned: false, cursed: false,
      important: false, weaponType: torchType,
    });
    const scroll = newRecord(g, DBType.SCROLL, { open: true, textReference: 0 });
    const illumulet = newRecord(g, DBType.MISC, { specialState: 1, important: false, miscType: illumuletType });
    const symal = newRecord(g, DBType.MISC, { specialState: 1, important: false, miscType: symalType });
    // What `AddCharacterPossession` would have left (`:2011-2027`): worn, so `value(1)`,
    // and the Illumulet's step added to the party's light.
    const before = g.ctx.party.state.brightness;
    g.ctx.party.state.brightness = before + step;
    const a = g.ctx.party.state.champions[0]!;
    a.possessions[0] = torch;
    a.possessions[1] = scroll;
    a.possessions[10] = illumulet;
    g.ctx.party.state.champions[1]!.possessions[10] = symal;

    g.systems.monsterAttack.damageCharacter(0, 999, 0, 0);
    g.systems.monsterAttack.damageCharacter(1, 999, 0, 0);
    g.systems.monsterAttack.displayCharacterDamage();
    const d = g.ctx.dungeon;
    console.log(`brightness ${before + step} -> ${g.ctx.party.state.brightness}; torch lit ${d.getWeaponRecord(torch)?.litTorch}; `
      + `scroll open ${d.getScrollRecord(scroll)?.open}; Illumulet value ${d.getMiscRecord(illumulet)?.specialState}; `
      + `Jewel Symal value ${d.getMiscRecord(symal)?.specialState}`);
    check(g.ctx.party.state.brightness === before, 'the dead champion\'s Illumulet takes its light off the party');
    check(d.getMiscRecord(illumulet)?.specialState === 0, 'the dropped Illumulet is of no use any more, value(0)');
    check(d.getMiscRecord(symal)?.specialState === 0, 'the dropped Jewel Symal is of no use any more, value(0)');
    check(d.getWeaponRecord(torch)?.litTorch === false, 'the dropped torch goes out');
    check(d.getWeaponRecord(torch)?.charges === 10, 'without losing its charges');
    check(d.getScrollRecord(scroll)?.open === false, 'the scroll in the weapon hand closes');
  }

  /* ------------------------------ the killing blow's tick draws before it ends ---- */
  // A monster's blow lands inside `ProcessTimers`, but only as `d.PendingDamage`. The
  // tick draws the viewport (`doc/CSBwin-src/CSBCode.cpp:648`), then
  // `DisplayCharacterDamage` (`:667`) takes the blow off the HP and kills, and the tick
  // finds the game lost and returns (`:668`, `:788`). So the frame is drawn with the
  // champion still standing; the dead box is `KillCharacter`'s own blit.
  {
    console.log('');
    const g = makeGame(1);
    const cell = findCellWithWestNeighbour(g);
    if (!cell) { fail('no open cell with an open neighbour'); finish(); return; }
    g.ctx.party.state.position = cell;
    g.systems.monsters.loadPartyLevel(cell.z);
    standIn(g.systems.timer, 'processTimers', () => { g.systems.monsterAttack.damageCharacter(0, 999, 0, 0); return false; });
    const drawn: string[] = [];
    g.onTick(() => drawn.push(`gameIsLost ${g.ctx.party.state.gameIsLost}, main loop returned ${g.mainLoopHasReturned()}`));
    g.gameTick();
    console.log(`the killing blow's tick draws: ${drawn.join('; ') || 'nothing'}; then main loop returned ${g.mainLoopHasReturned()}`);
    check(drawn.length === 1 && drawn[0] === 'gameIsLost false, main loop returned false',
      "the tick of the killing blow draws the frame before DisplayCharacterDamage kills");
    check(g.ctx.party.state.gameIsLost, 'and the same tick loses the game');
    check(g.mainLoopHasReturned(), 'and then the main loop returns');
  }

  finish();
}

main();
