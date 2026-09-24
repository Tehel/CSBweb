/**
 * The champion's own attacks: what the menu offers, who gets hit, and how hard.
 *
 * None of this is visible on screen beyond a number flashed for a quarter of a second,
 * so this is the evidence for the `Attack.cpp` port. Seven cases:
 *
 *  1. `GetLegalAttackTypes` — a sword offers SWING/PARRY/CHOP and a novice offers
 *     fewer options than a master. The names are the canary: they come out of graphic
 *     `0x230` by `ATTACKTYPE` index, so reading real words proves the offsets.
 *  2. `DetermineAttackOrdinal` — each champion's corner picks a different member of
 *     the group in front.
 *  3. A real melee campaign against a real monster group: hits, misses, damage spread,
 *     and the group actually dying.
 *  4. The back rank cannot swing through the front rank ("CAN'T REACH", -1).
 *  5. A non-material monster shrugs off a sword and yields to DISRUPT.
 *  6. `WarCryEtc` — a shout puts the group into fear state 5.
 *  7. `atk_HEAL` and `atk_FREEZELIFE` — the two non-combat attacks with arithmetic
 *     worth pinning, including FREEZE LIFE's 200 cap.
 *  8. A blow at a breakable door: `HitDoor`'s delay of 2 — the door holds on the tick
 *     of the blow and shatters when `TT_BASH_DOOR` fires, and queueing that timer
 *     cancels the door's own timers. And the force it needs is `DoorTOC`'s, the
 *     level's own choice of door characteristics.
 *
 * Run: `npx tsx tools/dump-player-attacks.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, encodeObjectID, OBJECT_ID_EOF, Position, type ObjectID } from '../src/core/types';
import { CsbRandom } from '../src/core/random';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { AttackType, MonsterType, StateOfFear } from '../src/engine/monsterTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import type { Champion } from '../src/engine/gameTypes';
import { extractObjectTables, monsterInvincible, monsterNonMaterial } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { determineMastery } from '../src/engine/skills';
import { check, finish } from './lib/check';

/** `weapon_Sword` (`doc/CSBwin-src/Objects.h:51`). */
const WEAPON_SWORD = 10;
/** `objDI_Dagger - weapon_Dagger` — where the weapons start in `ObjDesc`. */
const WEAPON_DESC_BASE = 23;
/** The attack class of a sword, and of an empty hand. */
const ATTACK_CLASS_EMPTY_HAND = 2;

function champion(i: number, name: string, fighterExp: number): Champion {
  return {
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 200, maxStamina: 200, mana: 60, maxMana: 60,
      stats: makeAddCharacterAttributes([60, 90, 90, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    // Skill 4 is the fighter base; 5-11 are its subskills. `determineMastery` reads the
    // base for anything above index 3, so this is what a champion's competence is.
    skills: Array.from({ length: 20 }, () => ({ tempAdjust: 0, experience: fighterExp })),
    possessions: new Array(30).fill(null),
    partyPosition: i,
  };
}

async function main(): Promise<void> {
  const dungeonBytes = new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat')));

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);
  const g230 = uiTables.graphic230;

  // Each case mutates the dungeon — a sword appended to the weapon database, a monster
  // killed, a creature type overwritten — so every case gets its own freshly parsed
  // copy. Sharing one made case 6 quietly test the monster case 5 had rewritten.
  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(dungeonBytes.slice());
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
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
      experienceForAttacking: g230.experienceForAttacking,
      skillNumber: g230.skillNumber,
      byte20046: g230.byte20046,
      byte20002: g230.byte20002,
      byte19958: g230.byte19958,
      byte19914: g230.byte19914,
      byte20090: g230.byte20090,
      attackNames: g230.attackNames,
    },
    );
    // Fixed seed: without it every rate in the tables below drifts run to run and the
    // novice-versus-veteran comparison can flip on noise alone.
    game.setRandomSeed(0x12345678);
    return game;
  };

  // ---------------------------------------------------------------- case 1
  // `GetLegalAttackTypes` gates the second and third options on mastery, so the same
  // sword offers a different menu to a novice and to a veteran. Reproduced here without
  // the UI, since the gating is pure arithmetic over `legalAttacks` and `skillNumber`.
  console.log('=== 1. GetLegalAttackTypes: what the menu offers ===');
  // A weapon's ObjDesc index is `23 + weaponType` (`doc/CSBwin-src/Objects.h:281`;
  // `objDI_Dagger = 31` against `weapon_Dagger = 8`), not the weapon type itself.
  const swordClass = objectTables.objDescAttackClass[WEAPON_DESC_BASE + WEAPON_SWORD] ?? 0;
  console.log(`sword attack class = ${swordClass}, empty hand = ${ATTACK_CLASS_EMPTY_HAND}`);
  console.log(['class', 'skill', 'option 0', 'option 1', 'req', 'option 2', 'req'].join('\t'));

  const nameOf = (t: number): string => (t === 255 ? '-' : g230.attackNames[t] ?? `?${t}`);
  const rowFor = (attackClass: number): { names: string[]; reqs: number[] } => {
    const row = g230.legalAttacks[attackClass]!;
    return {
      names: [nameOf(row[0]!), nameOf(row[1]!), nameOf(row[2]!)],
      reqs: [0, row[4]! & 0x7f, row[5]! & 0x7f],
    };
  };
  for (const attackClass of [ATTACK_CLASS_EMPTY_HAND, swordClass]) {
    const row = g230.legalAttacks[attackClass]!;
    const r = rowFor(attackClass);
    console.log([
      attackClass, g230.skillNumber[row[0]!],
      r.names[0], r.names[1], r.reqs[1], r.names[2], r.reqs[2],
    ].join('\t'));
  }

  const sword = rowFor(swordClass);
  // The canary: these are words, read out of graphic 0x230 by ATTACKTYPE index.
  check(sword.names[0] === 'SWING', `sword option 0 is SWING (got ${sword.names[0]})`);
  check(sword.names[1] === 'PARRY', `sword option 1 is PARRY (got ${sword.names[1]})`);
  check(sword.names[2] === 'CHOP', `sword option 2 is CHOP (got ${sword.names[2]})`);
  const fist = rowFor(ATTACK_CLASS_EMPTY_HAND);
  check(fist.names[0] === 'PUNCH', `bare hand option 0 is PUNCH (got ${fist.names[0]})`);
  check(sword.reqs[1] > 0 || sword.reqs[2] > 0, 'a sword gates at least one option on mastery');

  // ---------------------------------------------------------------- case 2
  console.log('\n=== 2. DetermineAttackOrdinal: which group member each corner reaches ===');
  {
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`, 8000));
    // Level 3's worm corridor: a known multi-member group beside a known open cell.
    const level = 3;
    standParty(game, level, 3, 2, 0); // facing north, into (3,1)

    const monsterRn = game.dungeonState.findFirstMonster(new Position(3, 1, level));
    if (monsterRn === OBJECT_ID_EOF) {
      console.log('(no monster at (3,1) on level 3 — skipping)');
    } else {
      const monster = game.dungeonState.getCreatureRecord(monsterRn)!;
      const render = game.dungeonState.getMonsterRenderState(monster);
      console.log(
        `group: ${MonsterType[monster.creatureType] ?? monster.creatureType}, ` +
        `${(monster.numMonM1 & 3) + 1} members, positions 0x${(render.positions & 0xff).toString(16)}`,
      );
      console.log(['champion corner', 'ordinal reached'].join('\t'));
      const reached = new Set<number>();
      for (let corner = 0; corner < 4; corner++) {
        const ordinal = game.attackSystem.determineAttackOrdinal(3, 1, 3, 2, corner);
        reached.add(ordinal);
        console.log([corner, ordinal].join('\t'));
      }
      check(!reached.has(0), 'every corner reaches some member of an adjacent group');
      if ((monster.numMonM1 & 3) > 0) {
        check(reached.size > 1, 'a multi-member group is not all reached through one ordinal');
      }
    }
  }

  // ---------------------------------------------------------------- case 3
  // Two campaigns against the same group, by a novice and a veteran.
  //
  // The result worth noticing: their hit *counts* are within one of each other, while
  // the veteran's total damage is a fifth higher. That is not noise — mastery is absent
  // from the hit check entirely, which runs on `Quickness` (dexterity and load) against
  // the monster's `dexterity12`. Skill enters only afterwards, through
  // `DetermineThrowingDistance`'s `2 * mastery` term and the flat +10 on a
  // `random(64) < mastery` roll. So in Dungeon Master practice makes your blows harder,
  // not more frequent; dexterity is what makes them land.
  console.log('=== 3. Melee: what skill changes, and does the group die? ===');
  {
    console.log(['champion', 'skill 4 mastery', 'quickness', 'hits/300', 'total damage', 'hardest'].join('\t'));
    const hitCounts: number[] = [];
    const totals: number[] = [];
    for (const [label, experience] of [['novice', 300], ['veteran', 40000]] as const) {
      const game = await makeGame();
      for (let i = 0; i < 4; i++) game.addChampion(champion(i, label.toUpperCase(), experience));
      const level = 3;
      standParty(game, level, 3, 2, 0);
      giveSword(game, 0);
      const champ = game.party.state.champions[0]!;

      const monsterRn = game.dungeonState.findFirstMonster(new Position(3, 1, level));
      const monster = monsterRn === OBJECT_ID_EOF ? null : game.dungeonState.getCreatureRecord(monsterRn);
      if (!monster) { console.log('(no monster at (3,1) — skipping)'); break; }

      let hits = 0;
      let total = 0;
      let hardest = 0;
      for (let swing = 0; swing < 300; swing++) {
        // Stamina is topped up so exhaustion does not confound the hit rate: a champion
        // at zero stamina starts losing health and is soon dead.
        champ.attributes.stamina = champ.attributes.maxStamina;
        monster.hp = monster.hp.map(() => 200);
        const damage = swingOnce(game, 0, AttackType.atk_SWING);
        if (damage > 0) { hits++; total += damage; hardest = Math.max(hardest, damage); }
      }
      hitCounts.push(hits);
      totals.push(total);
      console.log([
        label,
        masteryOf(game, 0, g230.skillNumber[AttackType.atk_SWING]! & 0xff),
        game.monsterAttack.quickness(champ),
        hits, total, hardest,
      ].join('\t'));
    }
    check(totals.length === 2 && totals[1]! > totals[0]!,
      `a veteran deals more damage than a novice (${totals[0]} vs ${totals[1]})`);
    check(hitCounts.length === 2 && Math.abs(hitCounts[1]! - hitCounts[0]!) < hitCounts[0]! / 10,
      `but lands about as often — the hit check ignores skill (${hitCounts[0]} vs ${hitCounts[1]})`);

    // And the payoff: with stamina to spare, the group dies.
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, 'HERO', 40000));
    const level = 3;
    standParty(game, level, 3, 2, 0);
    giveSword(game, 0);
    const champ = game.party.state.champions[0]!;
    const monsterRn = game.dungeonState.findFirstMonster(new Position(3, 1, level));
    const monster = monsterRn === OBJECT_ID_EOF ? null : game.dungeonState.getCreatureRecord(monsterRn);
    const hpBefore = monster ? [...monster.hp] : [];
    let swings = 0;
    for (; swings < 3000; swings++) {
      champ.attributes.stamina = champ.attributes.maxStamina;
      swingOnce(game, 0, AttackType.atk_SWING);
      if (game.dungeonState.findFirstMonster(new Position(3, 1, level)) === OBJECT_ID_EOF) break;
    }
    const cleared = game.dungeonState.findFirstMonster(new Position(3, 1, level)) === OBJECT_ID_EOF;
    console.log(`\ngroup hp [${hpBefore.join(',')}] wiped after ${cleared ? swings + 1 : '(never)'} swings`);
    check(cleared, 'sustained melee eventually kills the group');
  }

  // ---------------------------------------------------------------- case 4
  console.log("\n=== 4. The back rank cannot reach past the front rank ===");
  {
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, `HERO${i}`, 8000));
    const level = 3;
    // Facing north, corners 2 and 3 are the back rank: the `charPosition - facing`
    // term is what isolates them.
    standParty(game, level, 3, 2, 0);
    console.log(['corner', 'blocked in 20 swings', 'verdict'].join('\t'));
    let blocked = 0;
    for (let corner = 0; corner < 4; corner++) {
      giveSword(game, corner);
      // Repeated, because a single swing from the front rank can miss on its own and
      // flash 0 — only -1 is the "can't reach" answer, and it is deterministic.
      let cantReach = 0;
      for (let i = 0; i < 20; i++) {
        game.championAttack(corner, AttackType.atk_SWING);
        if (game.consumeAttackDamageToDisplay() === -1) cantReach++;
      }
      if (cantReach === 20) blocked++;
      console.log([corner, cantReach, cantReach === 20 ? "CAN'T REACH, always" : 'can reach'].join('\t'));
    }
    check(blocked === 2, `exactly the two back-rank champions are blocked (got ${blocked})`);
  }

  // ---------------------------------------------------------------- case 5
  console.log('\n=== 5. Non-material monsters: sword vs DISRUPT ===');
  {
    // An invincible monster takes no damage from anything, so it cannot show the
    // material/non-material difference; pick a non-material type that can be hurt.
    const nonMaterial: number[] = [];
    const vulnerable: number[] = [];
    for (let t = 0; t < 27; t++) {
      const desc = objectTables.monsterDesc[t];
      if (!desc || !monsterNonMaterial(desc)) continue;
      nonMaterial.push(t);
      if (!monsterInvincible(desc)) vulnerable.push(t);
    }
    console.log(`non-material types: ${nonMaterial.map((t) => MonsterType[t] ?? t).join(', ')}`);
    console.log(`  of which not invincible: ${vulnerable.map((t) => MonsterType[t] ?? t).join(', ')}`);
    check(nonMaterial.length > 0, 'the shipped data has non-material monsters');
    check(vulnerable.length > 0, 'and at least one of them can be damaged');

    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, 'HERO', 8000));
    const level = 3;
    standParty(game, level, 3, 2, 0);
    giveSword(game, 0);

    const monsterRn = game.dungeonState.findFirstMonster(new Position(3, 1, level));
    const monster = monsterRn === OBJECT_ID_EOF ? null : game.dungeonState.getCreatureRecord(monsterRn);
    if (!monster) {
      console.log('(no monster to convert — skipping)');
    } else {
      // Turn the neighbour into a non-material type in place, which is the only way to
      // get one adjacent to the party without hunting the whole dungeon for a Black
      // Flame. Everything else about the group is real.
      const ghostType = vulnerable[0]!;
      monster.creatureType = ghostType;
      monster.hp = monster.hp.map(() => 200);

      let swordDamage = 0;
      for (let i = 0; i < 60; i++) swordDamage += swingOnce(game, 0, AttackType.atk_SWING);
      let disruptDamage = 0;
      for (let i = 0; i < 60; i++) disruptDamage += swingOnce(game, 0, AttackType.atk_DISRUPT);
      console.log(`vs ${MonsterType[ghostType] ?? ghostType}: 60 SWINGs dealt ${swordDamage}, 60 DISRUPTs dealt ${disruptDamage}`);
      check(swordDamage === 0, 'a plain sword cannot touch a non-material monster');
      check(disruptDamage > 0, 'DISRUPT can');
    }
  }

  // ---------------------------------------------------------------- case 6
  // Whether a shout works at all is decided by `random(base + mastery(14)) >= bravery`,
  // so the interesting check is that the outcome tracks that inequality rather than any
  // particular success rate — and that a success really does set fear state 5.
  console.log('=== 6. WarCryEtc: a shout frightens the group ===');
  {
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, 'HERO', 40000));
    const level = 3;
    standParty(game, level, 3, 2, 0);

    const monsterRn = game.dungeonState.findFirstMonster(new Position(3, 1, level));
    const monster = monsterRn === OBJECT_ID_EOF ? null : game.dungeonState.getCreatureRecord(monsterRn);
    if (!monster) {
      console.log('(no monster at (3,1) — skipping)');
    } else {
      const desc = objectTables.monsterDesc[monster.creatureType]!;
      const bravery = (desc.word16 >> 4) & 15;
      const shoutMastery = masteryOf(game, 0, 14);
      console.log(
        `${MonsterType[monster.creatureType] ?? monster.creatureType}: bravery ${bravery}, ` +
        `champion mastery of skill 14 = ${shoutMastery}`,
      );
      console.log(['shout', 'base', 'base+mastery', 'possible?', 'frightened/40', 'pause byte'].join('\t'));

      const shouts: Array<[string, number, number]> = [
        ['WARCRY', AttackType.atk_WARCRY, 3],
        ['CALM', AttackType.atk_CALM, 7],
        ['BRANDISH', AttackType.atk_BRANDISH, 6],
        ['BLOWHORN', AttackType.atk_BLOWHORN, 6],
        ['CONFUSE', AttackType.atk_CONFUSE, 12],
      ];
      let anyMismatch = 0;
      let sawSuccess = false;
      for (const [name, attackType, base] of shouts) {
        // `random(n)` can return at most n-1, so the shout is possible only when
        // `base + mastery - 1 >= bravery`.
        const possible = base + shoutMastery - 1 >= bravery;
        let frightened = 0;
        let pause = 0;
        for (let i = 0; i < 40; i++) {
          monster.fear = (monster.fear & ~0xf) | StateOfFear.StateOfFear0;
          game.championAttack(0, attackType);
          if ((monster.fear & 0xf) === StateOfFear.StateOfFear5) {
            frightened++;
            pause = game.dungeonState.getItem16Record(monster.groupIndex & 0xff)?.uByte5 ?? 0;
          }
        }
        if (frightened > 0) sawSuccess = true;
        if (!possible && frightened > 0) anyMismatch++;
        console.log([name, base, base + shoutMastery, possible ? 'yes' : 'no', frightened, pause].join('\t'));
      }
      check(anyMismatch === 0, 'no shout succeeds when base + mastery cannot reach the bravery');
      check(sawSuccess, 'the shouts that can reach the bravery do frighten the group');
    }
  }

  // ---------------------------------------------------------------- case 7
  console.log('\n=== 7. HEAL and FREEZE LIFE ===');
  {
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, 'HERO', 8000));
    standParty(game, 3, 3, 2, 0);
    const champ = game.party.state.champions[0]!;

    champ.attributes.health = 40;
    const manaBefore = champ.attributes.mana;
    game.championAttack(0, AttackType.atk_HEAL);
    console.log(`HEAL: hp 40 -> ${champ.attributes.health}, mana ${manaBefore} -> ${champ.attributes.mana}`);
    check(champ.attributes.health > 40, 'HEAL restores health');
    check(champ.attributes.mana < manaBefore, 'HEAL spends mana');
    check(champ.attributes.health <= champ.attributes.maxHealth, 'HEAL does not overshoot maxHP');

    // FREEZE LIFE with nothing special in hand is worth 70, capped at 200 in total.
    game.party.state.freezeLifeTimer = 0;
    const steps: number[] = [];
    for (let i = 0; i < 4; i++) {
      game.championAttack(0, AttackType.atk_FREEZELIFE);
      steps.push(game.party.state.freezeLifeTimer);
    }
    console.log(`FREEZE LIFE from 0, four casts: ${steps.join(' -> ')}`);
    check(steps[0] === 70, `one FREEZE LIFE is worth 70 (got ${steps[0]})`);
    check(steps[2] === 200, `three reach the 200 cap (got ${steps[2]})`);
    check(steps[3] === 200, 'and a fourth adds nothing');
  }

  // ---------------------------------------------------------------- case 8
  // `Attack.cpp`'s door arm calls `HitDoor(x, y, strength, 0, 2)`
  // (`doc/CSBwin-src/Attack.cpp:1803-1808`). With a delay, `HitDoor` queues a
  // `TT_BASH_DOOR` at `d.Time + 2` (`Code11f52.cpp:2285-2292`) and `ProcessTT_BASH_DOOR`
  // shatters the door when it fires (`Timer.cpp:1492`). `SetTimer` meanwhile deletes
  // every `TT_1` / `TT_DOOR` timer on that cell (`Timer.cpp:1102-1123`).
  console.log('\n=== 8. Door bash: HitDoor\'s two-tick delay ===');
  {
    const game = await makeGame();
    for (let i = 0; i < 4; i++) game.addChampion(champion(i, 'HERO', 40000));
    // Level 1's (11,0): a shut door of type 1 (DoorTOC 42, breakable by a blow) in an
    // east-west corridor. The party stands west of it, facing east.
    const level = 1;
    const doorX = 11;
    const doorY = 0;
    standParty(game, level, 10, 0, 1);
    giveSword(game, 0);
    const champ = game.party.state.champions[0]!;
    const map = game.dungeonState.getMap(level)!;
    const doorState = (): number => map.cellFlags[doorX]![doorY]! & 7;
    const onDoor = (fn: number) => game.timerQueue.getTimers().filter((t) =>
      t.function === fn && t.level === level && t.uByte6 === doorX && t.uByte7 === doorY);
    check(doorState() === 4, `the door starts shut (state ${doorState()})`);

    // A door-step timer due long after the blow: the bash must cancel it.
    game.timerQueue.addTimer({
      index: 0, function: TimerFunction.TT_DOOR_STEP, time: game.state.tickCount + 50, level,
      uByte5: 0, uByte6: doorX, uByte7: doorY, uByte8: 0, uByte9: 0,
      sequence: 0, timerWord8: 0, timerWord6: 0,
    });

    let blowTick = -1;
    let stateOnBlowTick = -1;
    for (let blow = 0; blow < 100; blow++) {
      champ.attributes.stamina = champ.attributes.maxStamina;
      game.championAttack(0, AttackType.atk_CHOP);
      if (doorState() !== 4 || onDoor(TimerFunction.TT_BASH_DOOR).length > 0) {
        blowTick = game.state.tickCount;
        stateOnBlowTick = doorState();
        break;
      }
    }
    check(blowTick >= 0, 'some CHOP breaks the door');
    const bash = onDoor(TimerFunction.TT_BASH_DOOR);
    console.log(`blow at t=${blowTick}: door state ${stateOnBlowTick}, TT_BASH_DOOR at ${bash.map((t) => `t=${t.time}`).join(', ') || '-'}`);
    check(stateOnBlowTick === 4, `the door still holds on the tick of the blow (state ${stateOnBlowTick})`);
    check(bash.length === 1 && bash[0]!.time === blowTick + 2, 'one TT_BASH_DOOR is queued for two ticks later');
    check(onDoor(TimerFunction.TT_DOOR_STEP).length === 0, 'queueing it cancelled the door-step timer');

    const tick = (): void => {
      game.state.tickCount++;
      game.timerSystem.processTimers(game.state.tickCount);
    };
    tick();
    check(doorState() === 4, `one tick later the door still holds (state ${doorState()})`);
    tick();
    check(doorState() === 5, `two ticks later it is shattered (state ${doorState()})`);
  }

  // `HitDoor` compares the force with `d.DoorTOC[doorType]` (`Code11f52.cpp:2277`), and
  // `DoorTOC` is the level's pick of two `DoorCharacteristics` entries
  // (`CSBCode.cpp:5780-5783`), not `DoorCharacteristics[doorType]`. Stock DM has no
  // breakable door on the three levels whose mapping differs (6, 12, 13), so remap
  // level 1's type-1 slot to entry 3 (force 255) and hit the same door with force 100.
  console.log('\n=== 8b. HitDoor reads DoorTOC, not DoorCharacteristics ===');
  {
    const game = await makeGame();
    const level = 1;
    const door = new Position(11, 0, level);
    const map = game.dungeonState.getMap(level)!;
    const characteristics = objectTables.doorCharacteristics;
    console.log(`DoorCharacteristics force: ${Array.from(characteristics, (v) => v & 0xff).join(', ')}; level 1 maps type 1 to entry ${map.descriptor.doorType1Index}`);
    map.descriptor.doorType1Index = 3;
    const held = !game.timerSystem.hitDoor(door, 100, false) && (map.cellFlags[11]![0]! & 7) === 4;
    check(held, 'force 100 does not break a door the level maps to entry 3 (force 255)');
    map.descriptor.doorType1Index = 1;
    const broke = game.timerSystem.hitDoor(door, 100, false) && (map.cellFlags[11]![0]! & 7) === 5;
    check(broke, 'and does break it through entry 1 (force 42)');
  }

  finish();
}

/**
 * Stand the party at a square, facing a direction.
 *
 * Champion facing is set explicitly because nothing here turns the party: a champion's
 * `facing` is written when they pick up the cursor and then rotated by
 * `Party.turnChampions`, so writing `party.facing` alone leaves the champions looking
 * the way they were when they joined — and `_Attack` aims by `pChar->facing`.
 */
function standParty(game: Game, level: number, x: number, y: number, facing: number): void {
  game.party.state.position = new Position(x, y, level);
  game.party.state.facing = facing as typeof game.party.state.facing;
  for (const champ of game.party.state.champions) champ.facing = facing as typeof champ.facing;
  game.monsterSystem.loadPartyLevel(level);
}

/** Put a real sword into a champion's fighting hand. */
function giveSword(game: Game, chIdx: number): ObjectID {
  const data = game.dungeonState.getData();
  data.databases.weapons.records.push({
    nextObject: OBJECT_ID_EOF,
    broken: false, charges: 0, litTorch: false, poisoned: false, cursed: false,
    important: false, weaponType: WEAPON_SWORD,
  });
  data.databases.weapons.count++;
  const rn = encodeObjectID(0, DBType.WEAPON, data.databases.weapons.records.length - 1);
  const champ = game.party.state.champions[chIdx]!;
  champ.possessions![1] = rn;
  return rn as ObjectID;
}

/** `DetermineMastery(chIdx, skill)`, for the printed tables. */
function masteryOf(game: Game, chIdx: number, skill: number): number {
  return determineMastery(game.party.state.champions[chIdx]!, skill, {});
}

/** One blow, returning the damage the panel would have flashed (0 for a miss). */
function swingOnce(game: Game, chIdx: number, attackType: number): number {
  game.championAttack(chIdx, attackType);
  const flashed = game.consumeAttackDamageToDisplay();
  return flashed > 0 ? flashed : 0;
}

void CsbRandom;
main();
