/**
 * The weight → load → throwing-distance chain (`src/engine/CharacterStats.ts`).
 *
 * None of this is visible on screen except as a number in the eye panel, and until
 * `WEAPONDESC` was extracted the engine had no access to any of it: throw range,
 * damage and decay were invented formulas over strength and dexterity, a shield held
 * in hand lost its `DetermineThrowingDistance` term, and `Quickness` ignored load.
 *
 * What to look for in the output:
 *
 *  - The weight table reads real Dungeon Master weights — a rock is 1.0 kg, an arrow
 *    0.2 kg, an axe 4.3 kg. Those are the canary: a wrong base or stride in
 *    `weapons[46]` could not reproduce the numbers the manual prints.
 *  - `uByte1` sorts weapons into the skill each one trains: swords and axes into
 *    Swing (4), darts and rocks into Throw (10), bows and slings into Shoot (11),
 *    staves and wands into none.
 *  - Throwing distance *rises* with weight up to a sixteenth of what the champion can
 *    carry — heft helps — and only collapses past the turn. Writing this tool the
 *    other way round produced a failing check and a re-read of
 *    `doc/CSBwin-src/Character.cpp:2300`, where the sign is plain.
 *  - A wounded hand halves the throw made with it, and only with it.
 *  - A shot's busy timer reloads the bow from the quiver, and a spell's busy timer after
 *    it does not: `EnableCharacterAction` forgets the attack (section 8).
 *
 * Run: `npm test -- --only=throwing.ts`
 */
import { CsbRandom } from '../../src/core/random';
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../../src/core/types';
import { CharacterStats } from '../../src/engine/CharacterStats';
import { DungeonState } from '../../src/engine/DungeonState';
import type { Champion } from '../../src/engine/gameTypes';
import { makeAddCharacterAttributes } from '../../src/engine/attributes';
import { AttackType } from '../../src/engine/monsterTypes';
import { graphicsTablesOf, newContext, newGame, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';
import { CHARFLAG_ATTACK_DISABLE, getChampionPossession } from '../../src/core/charDesc';
import { testChampion } from '../lib/champion';

/** Enough samples that the `random()&15` in the distance formula averages out. */
const SAMPLES = 400;

function champion(over: Partial<Champion['attributes']> & { strength?: number } = {}): Champion {
  const { strength = 50, ...attrOver } = over;
  return testChampion(0, {
    name: 'TEST',
    attributes: {
      mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([50, strength, 50, 50, 50, 0, 0]),
      ...attrOver,
    },
  });
}

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;

  const dungeon = new DungeonState(data);
  const stats = new CharacterStats(newContext(data, graphics, { dungeon, random: new CsbRandom(0x12345678) }));

  /** Make a weapon record of the given type and return its object id. */
  const makeWeapon = (weaponType: number): ObjectID => {
    const db = data.databases.weapons;
    db.records.push({
      nextObject: OBJECT_ID_EOF, weaponType, charges: 0, litTorch: false,
      important: false, cursed: false, poisoned: false, broken: false,
    });
    db.count++;
    return dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
  };

  /** Make a misc record of the given type — no `WEAPONDESC` term, so a pure weight test. */
  const makeMisc = (miscType: number): ObjectID => {
    const db = data.databases.misc;
    db.records.push({
      nextObject: OBJECT_ID_EOF, miscType, specialState: 0, important: false,
    });
    db.count++;
    return dungeon.rnMaps.rn(DBType.MISC, db.records.length - 1);
  };

  /* ------------------------------------------------- 1. WEAPONDESC and weights ---- */

  console.log('=== weapons[46]: WEAPONDESC, and what GetObjectWeight reads back ===');
  console.log(['wType', 'name', 'kg', 'uB1', 'skill', 'uB2', 'uB3'].join('\t'));

  const skillFor = (cls: number): string => {
    if (cls === 0 || cls === 2) return 'swing(4)';
    if (cls < 16) return 'throw(10)';
    if (cls < 112) return 'shoot(11)';
    return 'none';
  };

  // The weights Dungeon Master's own manual prints, as a canary on base and stride.
  const KNOWN_KG: [number, string, number][] = [
    [27, 'ARROW', 2],
    [28, 'SLAYER', 2],
    [30, 'ROCK', 10],
    [31, 'POISON DART', 3],
    [32, 'THROWING STAR', 1],
    [25, 'BOW', 10],
    [26, 'CROSSBOW', 28],
    [29, 'SLING', 19],
    [18, 'AXE', 43],
    [23, 'CLUB', 36],
  ];

  for (const [wType, name, kg] of KNOWN_KG) {
    const desc = objectTables.weaponDesc[wType];
    if (!desc) { check(false, `weapons[${wType}] exists`); continue; }
    const obj = makeWeapon(wType);
    const weighed = stats.getObjectWeight(obj);
    console.log([wType, name, weighed, desc.uByte1, skillFor(desc.uByte1), desc.uByte2, desc.uByte3].join('\t'));
    check(desc.weight === kg, `weapons[${wType}] (${name}) weighs ${kg} (got ${desc.weight})`);
    check(weighed === kg, `GetObjectWeight of a ${name} record is ${kg} (got ${weighed})`);
  }

  // The class field must actually partition the weapons, not be constant.
  const classes = new Set(Array.from({ length: 46 }, (_, i) => skillFor(objectTables.weaponDesc[i]?.uByte1 ?? 0)));
  check(classes.size >= 3, `uByte1 sorts weapons into several skills (got ${[...classes].join(', ')})`);
  check(skillFor(objectTables.weaponDesc[18]?.uByte1 ?? 0) === 'swing(4)', 'an axe trains Swing');
  check(skillFor(objectTables.weaponDesc[31]?.uByte1 ?? 0) === 'throw(10)', 'a poison dart trains Throw');
  check(skillFor(objectTables.weaponDesc[25]?.uByte1 ?? 0) === 'shoot(11)', 'a bow trains Shoot');

  /* ------------------------------------------------------------- 2. MaxLoad ------ */

  console.log('');
  console.log('=== MaxLoad ===');
  const plain = champion();
  const strong = champion({ strength: 90 });
  const tired = champion({ stamina: 10 });
  const wounded = champion();
  wounded.wounds = 16; // torso

  const rows: [string, Champion][] = [
    ['strength 50', plain], ['strength 90', strong],
    ['stamina 10/100', tired], ['wounded torso', wounded],
  ];
  for (const [label, ch] of rows) {
    console.log(`${label.padEnd(16)}\t${stats.maxLoad(ch)}`);
  }

  check(stats.maxLoad(strong) > stats.maxLoad(plain), 'a stronger champion carries more');
  check(stats.maxLoad(tired) < stats.maxLoad(plain), 'an exhausted champion carries less');
  check(stats.maxLoad(wounded) < stats.maxLoad(plain), 'a wounded champion carries less');
  check(stats.maxLoad(plain) % 10 === 0, `MaxLoad is a multiple of 10 (got ${stats.maxLoad(plain)})`);

  /* ------------------------------------------ 3. DetermineThrowingDistance ------- */

  console.log('');
  console.log('=== DetermineThrowingDistance, averaged over ' + SAMPLES + ' throws ===');
  console.log(['object', 'kg', 'distance', 'note'].join('\t'));

  const meanDistance = (ch: Champion, hand: number): number => {
    let total = 0;
    for (let i = 0; i < SAMPLES; i++) total += stats.determineThrowingDistance(ch, hand, false);
    return Math.round((total / SAMPLES) * 10) / 10;
  };

  // The weight curve on its own, with misc objects: they take no `WEAPONDESC` term, so
  // the only thing moving is weight. A *weak* champion, so the shipped misc weights
  // span the whole curve.
  //
  // CSBWin's shape is not "heavier throws shorter" (`doc/CSBwin-src/Character.cpp:2300`).
  // Up to MaxLoad/16 the weight is *added* — heft helps. Between there and
  // `(MaxLoad/16 - 12)/2 + MaxLoad/16` it still helps, at half rate. Only past that
  // does it subtract, at double rate, so a boulder is hopeless.
  const weakling = champion({ strength: 10 });
  const sixteenth = Math.trunc(stats.maxLoad(weakling) / 16);
  const midpoint = Math.trunc((sixteenth - 12) / 2) + sixteenth;

  const MISC_LADDER: [string, number][] = [
    ['COMPASS', 0], ['WATERSKIN', 1], ['CHEESE', 32],
    ['WORM ROUND', 34], ['BONES', 5], ['BOULDER', 25],
  ];
  const byWeight: [string, number, number][] = [];
  for (const [name, miscType] of MISC_LADDER) {
    weakling.possessions![1] = makeMisc(miscType);
    const weight = objectTables.byte8946[miscType] ?? 0;
    const d = meanDistance(weakling, 1);
    byWeight.push([name, weight, d]);
    const zone = weight <= sixteenth ? 'adds weight'
      : weight <= midpoint ? 'adds half' : 'subtracts double';
    console.log([name, weight, d, zone].join('\t'));
  }
  console.log(`\nthis champion's MaxLoad/16 is ${sixteenth}, and the curve turns down past ${midpoint}`);

  const rising = byWeight.filter(([, w]) => w <= sixteenth);
  const falling = byWeight.filter(([, w]) => w > midpoint);
  check(rising.length >= 2 && falling.length >= 1, 'the ladder spans both sides of the curve');
  for (let i = 1; i < rising.length; i++) {
    check(rising[i]![2] >= rising[i - 1]![2],
      `below MaxLoad/16 heft helps: ${rising[i]![0]} (${rising[i]![1]}) >= ${rising[i - 1]![0]} (${rising[i - 1]![1]})`);
  }
  const heaviest = falling[falling.length - 1]!;
  check(heaviest[2] < rising[rising.length - 1]![2],
    `past the turn it collapses: ${heaviest[0]} (${heaviest[1]}) throws ${heaviest[2]}`);

  // And the weapon table on top of the curve: `uByte2` is what makes a throwing weapon
  // a throwing weapon.
  console.log('');
  console.log(['weapon', 'kg', 'uB2', 'distance'].join('\t'));
  const thrower = champion();
  const weaponDistance = new Map<string, number>();
  for (const [name, wType] of [['THROWING STAR', 32], ['ROCK', 30], ['CLUB', 23], ['AXE', 18]] as [string, number][]) {
    thrower.possessions![1] = makeWeapon(wType);
    const d = meanDistance(thrower, 1);
    weaponDistance.set(name, d);
    console.log([name, objectTables.weaponDesc[wType]?.weight ?? 0, objectTables.weaponDesc[wType]?.uByte2 ?? 0, d].join('\t'));
  }
  check(weaponDistance.get('AXE')! > weaponDistance.get('THROWING STAR')!,
    'a weapon\'s own uByte2 shows through: the axe (49) beats the throwing star (3)');
  check([...weaponDistance.values()].every((d) => d >= 0 && d <= 100),
    'every distance is inside ApplyLimits(0, …, 100)');

  // The wound rule: only the hand that is hurt.
  thrower.possessions![1] = makeWeapon(30); // rock
  thrower.possessions![0] = thrower.possessions![1];
  const healthy = meanDistance(thrower, 1);
  thrower.wounds = 2; // the fighting hand
  const hurtHand = meanDistance(thrower, 1);
  const otherHand = meanDistance(thrower, 0);
  thrower.wounds = 0;
  console.log('');
  console.log(`rock, hand 1: ${healthy} healthy, ${hurtHand} with that hand wounded, ` +
    `${otherHand} with the *other* hand (also holding a rock)`);
  check(hurtHand < healthy, 'a wound on the throwing hand shortens the throw');
  check(otherHand > hurtHand, 'the wound applies to the hurt hand, not to both');

  /* ------------------------------------------------------ 4. TAG016382 ----------- */

  console.log('');
  console.log('=== the stamina a throw costs (TAG016382) ===');
  const staminaCost = (weight: number): number => {
    let remaining = Math.trunc(weight / 2);
    let cost = Math.min(10, Math.max(1, remaining));
    while ((remaining -= 10) > 0) cost += Math.trunc(remaining / 2);
    return cost;
  };
  const costs = [1, 10, 20, 43, 110].map((w) => [w, staminaCost(w)] as const);
  console.log(costs.map(([w, c]) => `${w / 10}kg->${c}`).join('  '));
  check(costs[0]![1] < costs[4]![1], 'a heavier throw costs more stamina');
  check(staminaCost(110) > 10, 'past 10 units the cost keeps climbing rather than clamping');

  /* -------------------------------------------------------- 5. Quickness -------- */

  console.log('');
  console.log('=== Quickness ===');
  const meanQuickness = (ch: Champion): number => {
    let total = 0;
    for (let i = 0; i < SAMPLES; i++) total += stats.quickness(ch, false);
    return Math.round((total / SAMPLES) * 10) / 10;
  };
  const empty = champion();
  const laden = champion();
  // Fill the pack with clubs until the champion is at roughly the load limit.
  for (let slot = 2; slot < 16; slot++) laden.possessions![slot] = makeWeapon(23);
  const emptyQ = meanQuickness(empty);
  const ladenQ = meanQuickness(laden);
  console.log(`empty-handed ${emptyQ}, carrying ${stats.characterLoad(laden)} of ` +
    `${stats.maxLoad(laden)}: ${ladenQ}`);
  check(stats.characterLoad(empty) === 0, 'an empty champion carries nothing');
  check(stats.characterLoad(laden) > 0, 'the laden champion is actually carrying something');
  check(ladenQ < emptyQ, `a laden champion dodges worse (${ladenQ} vs ${emptyQ})`);

  /* --------------------------------------- 6. ThrowByCharacter end to end -------- */

  // The rewritten path in `MouseSystem.throwObjectFromCursor`: a real engine, a real party, a
  // real object in the cursor, and a real missile record at the end of it. This is what
  // `estimateThrowRange/Damage/Decay` used to feed.
  console.log('=== ThrowByCharacter through the real engine ===');

  const data2 = stockDungeon();

  const game = newGame(data2, graphics);
  game.setRandomSeed(0x12345678);

  const party = game.ctx.party.state;
  party.champions = [champion()];
  party.cursorOwner = 0;

  // The missile records in use: a database grows 100 cleared records at a time
  // (`DungeonState.enlarge`), so its length is not the number of missiles.
  const missilesInUse = (): number[] => data2.databases.missiles.records.flatMap((r, i) => (r.nextObject === OBJECT_ID_NULL ? [] : [i]));
  const throwRock = (): { range: number; damage: number } | null => {
    const db = data2.databases.weapons;
    db.records.push({
      nextObject: OBJECT_ID_EOF, weaponType: 30, charges: 0, litTorch: false,
      important: false, cursed: false, poisoned: false, broken: false,
    });
    db.count++;
    party.objectInHand = game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);

    const before = new Set(missilesInUse());
    const ok = game.systems.mouse.throwObjectFromCursor(0);
    const launched = missilesInUse().filter((i) => !before.has(i));
    if (!ok || launched.length === 0) return null;
    const rec = data2.databases.missiles.records[launched[0]!]!;
    return { range: rec.rangeRemaining, damage: rec.damageRemaining };
  };

  const staminaBefore = party.champions[0]!.attributes.stamina;
  const first = throwRock();
  const staminaAfter = party.champions[0]!.attributes.stamina;

  check(first !== null, 'throwing a rock from the cursor launches a missile');
  if (first) {
    console.log(`rock: range ${first.range}, damage ${first.damage}`);
    check(first.range > 0, `the missile carries a range (${first.range})`);
    // `ApplyLimits(40, 8*mastery + random&31, 200)` — a novice's floor is 40.
    check(first.damage >= 40 && first.damage <= 200,
      `damage is inside ApplyLimits(40, …, 200) (got ${first.damage})`);
  }
  check(party.objectInHand === OBJECT_ID_NULL, 'the thrown object left the cursor');
  console.log(`stamina ${staminaBefore} -> ${staminaAfter} (TAG016382 charged for a 1.0 kg rock)`);
  check(staminaAfter < staminaBefore, 'the throw cost stamina');
  check((party.champions[0]!.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0 && party.champions[0]!.busyTimerIndex >= 0,
    'the champion is busy afterwards: CHARFLAG_attackDisable and a busy timer');

  // Skill 10 must have gained: 8 for any object, +4 for a weapon, +uByte3/4 for a
  // throwable — a rock is uByte3 18, so 8 + 4 + 4 = 16 before the difficulty scaling.
  const throwSkill = party.champions[0]!.skills?.[10]?.experience ?? 0;
  console.log(`skill 10 (Throw) experience after one throw: ${throwSkill}`);
  check(throwSkill > 0, 'the throw trained skill 10');

  /* ------------------------- 7. the object actually leaves the champion ---------- */

  // `atk_THROW` and `atk_SHOOT` both take an object off a champion and turn it into a
  // missile. Nothing on screen distinguishes "the hand was emptied" from "the hand was
  // not", because the missile is drawn either way, so this section checks it, through
  // the UI's own reader rather than through `possessions` directly.
  console.log('');
  console.log('=== 7. the thrown object leaves the champion (atk_THROW, atk_SHOOT) ===');

  const makeWeapon2 = (weaponType: number): ObjectID => {
    const db = data2.databases.weapons;
    db.records.push({
      nextObject: OBJECT_ID_EOF, weaponType, charges: 0, litTorch: false,
      important: false, cursed: false, poisoned: false, broken: false,
    });
    db.count++;
    return game.ctx.dungeon.rnMaps.rn(DBType.WEAPON, db.records.length - 1);
  };

  const equip = (ch: Champion, slot: number, obj: ObjectID): void => {
    ch.possessions[slot] = obj;
  };

  const WEAPON_CLUB = 23;
  const WEAPON_BOW = 25;
  const WEAPON_ARROW = 27;

  // THROW: the club goes from the fighting hand into the air.
  const thrower2 = champion();
  thrower2.skills = Array.from({ length: 20 }, () => ({ tempAdjust: 0, experience: 1000 }));
  party.champions = [thrower2];
  const club = makeWeapon2(WEAPON_CLUB);
  equip(thrower2, 1, club);

  const missilesBeforeThrow = missilesInUse().length;
  const threw = game.systems.character.executeAttack(0, AttackType.atk_THROW);
  const missilesAfterThrow = missilesInUse().length;
  const handAfterThrow = getChampionPossession(thrower2, 1);
  console.log(`THROW: result ${threw}, missiles ${missilesBeforeThrow} -> ${missilesAfterThrow}, ` +
    `fighting hand reads ${handAfterThrow === OBJECT_ID_NULL ? 'empty' : handAfterThrow}`);
  check(threw === 1, 'atk_THROW reports a successful attack');
  check(missilesAfterThrow === missilesBeforeThrow + 1, 'atk_THROW launched exactly one missile');
  check(handAfterThrow === OBJECT_ID_NULL,
    `the thrown club left the fighting hand (read back ${handAfterThrow}, thrown ${club})`);

  // SHOOT: the arrow goes from the shield hand, the bow stays in the fighting hand.
  const archer = champion();
  archer.skills = Array.from({ length: 20 }, () => ({ tempAdjust: 0, experience: 1000 }));
  party.champions = [archer];
  const bow = makeWeapon2(WEAPON_BOW);
  const arrow = makeWeapon2(WEAPON_ARROW);
  equip(archer, 1, bow);
  equip(archer, 0, arrow);

  const missilesBeforeShot = missilesInUse().length;
  const shot = game.systems.character.executeAttack(0, AttackType.atk_SHOOT);
  const missilesAfterShot = missilesInUse().length;
  const ammoAfterShot = getChampionPossession(archer, 0);
  const bowAfterShot = getChampionPossession(archer, 1);
  console.log(`SHOOT: result ${shot}, missiles ${missilesBeforeShot} -> ${missilesAfterShot}, ` +
    `shield hand reads ${ammoAfterShot === OBJECT_ID_NULL ? 'empty' : ammoAfterShot}`);
  check(shot === 1, 'atk_SHOOT reports a successful attack');
  check(missilesAfterShot === missilesBeforeShot + 1, 'atk_SHOOT launched exactly one missile');
  check(ammoAfterShot === OBJECT_ID_NULL,
    `the arrow left the shield hand (read back ${ammoAfterShot}, shot ${arrow})`);
  check(bowAfterShot === bow, 'the bow itself stays in the fighting hand');

  /* ------------------------- 8. EnableCharacterAction forgets the attack ---------- */

  // `EnableCharacterAction` (`doc/CSBwin-src/Timer.cpp:2638`) reloads the bow from the
  // quiver only while the attack in progress is a shot, and ends with
  // `attackType = -1` (`:2680`). So the busy timer a spell sets later, through
  // `DisableCharacterAction` (`Magic.cpp:505`), frees the champion without touching the
  // quiver, even with hand 0 empty.
  console.log('');
  console.log('=== 8. EnableCharacterAction forgets the attack (TT_11 after a shot, then a spell) ===');

  const clock = game.ctx.state;
  const runUntilFree = (): number => {
    let ticks = 0;
    while (archer.busyTimerIndex >= 0 && ticks < 1000) {
      game.systems.timer.processTimers();
      clock.tickCount++;
      ticks++;
    }
    return ticks;
  };
  // The rock's and the club's TT_11s are still queued for slot 0, which this tool has
  // since given to the archer. CSBWin never queues two for one champion
  // (`DisableCharacterAction` deletes the old one first, `Magic.cpp:516-528`), so drop
  // them: the timer that frees the archer below is the archer's own.
  for (const timer of [...game.ctx.timers.getTimers()]) {
    if (timer.function === 11 && timer.index !== archer.busyTimerIndex) game.ctx.timers.deleteTimer(timer.index);
  }
  const quiver = makeWeapon2(WEAPON_ARROW);
  const spare = makeWeapon2(WEAPON_ARROW);
  equip(archer, 12, quiver);
  equip(archer, 7, spare);
  check(archer.attackType === AttackType.atk_SHOOT && archer.busyTimerIndex >= 0,
    `the shot is in progress: attackType ${archer.attackType}, busy timer ${archer.busyTimerIndex}`);

  const shotTicks = runUntilFree();
  console.log(`the shot's TT_11 fired after ${shotTicks} ticks: hand 0 ${getChampionPossession(archer, 0)}, ` +
    `slot 12 ${getChampionPossession(archer, 12)}, attackType ${archer.attackType}`);
  check(getChampionPossession(archer, 0) === quiver && getChampionPossession(archer, 12) === OBJECT_ID_NULL,
    "the shot's TT_11 reloads the bow from slot 12");
  check(archer.attackType === -1, "the shot's TT_11 ends with attackType = -1 (Timer.cpp:2680)");
  check((archer.charFlags & CHARFLAG_ATTACK_DISABLE) === 0, "the shot's TT_11 clears CHARFLAG_attackDisable");

  // The arrow leaves hand 0 some other way, and a spell busies the champion.
  game.ctx.systems.character.removeCharacterPossession(0, 0);
  game.ctx.systems.magic.disableCharacterAction(0, 12);
  check(archer.busyTimerIndex >= 0 && (archer.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0,
    'the spell busies the champion');
  const spellTicks = runUntilFree();
  console.log(`the spell's TT_11 fired after ${spellTicks} ticks: hand 0 ${getChampionPossession(archer, 0)}, ` +
    `slot 7 ${getChampionPossession(archer, 7)}`);
  check(getChampionPossession(archer, 0) === OBJECT_ID_NULL && getChampionPossession(archer, 7) === spare,
    "the spell's TT_11 leaves the quiver alone: no attack is in progress");
  check(archer.busyTimerIndex === -1 && (archer.charFlags & CHARFLAG_ATTACK_DISABLE) === 0,
    "the spell's TT_11 frees the champion");

  /* -------------------------- 9. DisableCharacterAction for 0 ticks -------------- */

  // `DisableCharacterAction` (`doc/CSBwin-src/Magic.cpp:505-540`) has no guard on the
  // delay. Idle, 0 ticks queues a TT_11 due at d.Time. Busy, the busy timer is replaced by
  // one due at `D6 + 0 / 2` (`:517-528`), whose uByte6, the slot a throw refills, is 0
  // (`:515`).
  console.log('');
  console.log('=== 9. DisableCharacterAction for 0 ticks, idle and busy ===');
  game.ctx.systems.magic.disableCharacterAction(0, 0);
  const idleTimer = game.ctx.timers.getTimer(archer.busyTimerIndex);
  console.log(`idle: busy timer ${archer.busyTimerIndex}, due ${idleTimer ? idleTimer.time - clock.tickCount : '-'} `
    + `ticks from now, busy flag ${(archer.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0}`);
  check(idleTimer !== null && idleTimer.function === 11 && idleTimer.time === clock.tickCount
    && (archer.charFlags & CHARFLAG_ATTACK_DISABLE) !== 0,
    'an idle champion disabled for 0 ticks is busy, with a TT_11 due at d.Time');
  const idleTicks = runUntilFree();
  check(idleTicks === 1 && (archer.charFlags & CHARFLAG_ATTACK_DISABLE) === 0,
    `that TT_11 frees the champion on the next tick (${idleTicks})`);

  game.ctx.systems.magic.disableCharacterAction(0, 12);
  const busyBefore = game.ctx.timers.getTimer(archer.busyTimerIndex)!;
  busyBefore.uByte6 = 7; // as a throw leaves it
  const dueBefore = busyBefore.time;
  game.ctx.systems.magic.disableCharacterAction(0, 0);
  const busyAfter = game.ctx.timers.getTimer(archer.busyTimerIndex);
  console.log(`busy: TT_11 due ${dueBefore - clock.tickCount} ticks from now, uByte6 7 -> `
    + `due ${busyAfter ? busyAfter.time - clock.tickCount : '-'}, uByte6 ${busyAfter?.uByte6 ?? '-'}`);
  check(busyAfter !== null && busyAfter.time === dueBefore && busyAfter.uByte6 === 0
    && game.ctx.timers.getTimers().filter((t) => t.function === 11).length === 1,
    'a busy champion disabled for 0 ticks gets a new TT_11 due when the old one was, with uByte6 0');
  runUntilFree();

  console.log('');
  finish();
}

main();
