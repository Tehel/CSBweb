/**
 * Put a party next to monsters and let them fight.
 *
 * The payoff check for the attack port: monsters that can already hunt should now
 * actually connect. Reports per-tick what happens to each champion — health lost,
 * wounds taken, poison, death — and whether any missile-throwing monster launched
 * anything.
 *
 * Run: `npm test -- --only=checks/watch-monster-attacks.ts [level] [partyX] [partyY] [ticks]`
 */
import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../../src/core/types';
import type { Champion } from '../../src/engine/gameTypes';
import { newGame, processTimersAt, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';

function champion(i: number, name: string): Champion {
  return testChampion(i, { name });
}

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();

  const level = Number(process.argv[2] ?? 2);
  const px = Number(process.argv[3] ?? 6);
  const py = Number(process.argv[4] ?? 14);
  const ticks = Number(process.argv[5] ?? 800);

  const game = newGame(data, graphics);
  // Fixed seed, so the numbers below repeat run to run.
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i, `HERO${i}`));
  game.ctx.party.state.position = new Position(px, py, level);
  game.systems.monsters.loadPartyLevel(level);

  const dungeon = game.ctx.dungeon;
  const start = game.ctx.party.state.champions.map((c) => c.attributes.health);
  const missilesBefore = data.databases.missiles.records.length;

  let firstHitTick = -1;
  let firstDeathTick = -1;
  for (let t = 0; t < ticks; t++) {
    game.ctx.state.tickCount = t;
    processTimersAt(game, t);
    const hurt = game.ctx.party.state.champions.some((c, i) => c.attributes.health < start[i]!);
    if (hurt && firstHitTick < 0) firstHitTick = t;
    const dead = game.ctx.party.state.champions.some((c) => c.attributes.health === 0);
    if (dead && firstDeathTick < 0) firstDeathTick = t;
  }

  console.log(`level ${level}, party at (${px},${py}), ${ticks} ticks\n`);
  console.log(['champion', 'hp', 'lost', 'wounds', 'poison', 'alive'].join('\t'));
  let totalLost = 0;
  game.ctx.party.state.champions.forEach((c, i) => {
    const lost = start[i]! - c.attributes.health;
    totalLost += lost;
    console.log([
      c.name, c.attributes.health, lost,
      '0x' + c.wounds.toString(16), c.poisonCount,
      c.attributes.health === 0 ? 'DEAD' : 'yes',
    ].join('\t'));
  });

  const missilesAfter = data.databases.missiles.records.length;
  console.log('');
  console.log(`first hit at tick ${firstHitTick}, total damage ${totalLost}`);
  console.log(`missiles launched: ${missilesAfter - missilesBefore}`);
  console.log(`first champion death at tick ${firstDeathTick < 0 ? '(none)' : firstDeathTick}`);

  // Bones, if anyone died.
  const here = new Position(px, py, level);
  const contents: string[] = [];
  for (let rn = dungeon.findFirstObject(here); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const { category, index } = game.ctx.dungeon.rnMaps.decode(rn);
    if (category === DBType.MISC) {
      const rec = data.databases.misc.records[index];
      contents.push(`misc#${rec?.miscType}${rec?.specialState === 2 ? ' (champion bones)' : ''}`);
    } else contents.push(DBType[category] ?? String(category));
    if (contents.length > 15) break;
  }
  console.log(`party cell now holds: [${contents.join(', ')}]`);

  // ---- Wounds are rare by design; prove the mechanism fires at all -------
  // `DamageCharacter` only marks a body part when the blow exceeds a
  // vitality-scaled threshold, then doubles the threshold and may mark another
  // (doc/CSBwin-src/Character.cpp:2794-2808). Small hits should almost never wound;
  // large ones should. Driven directly, since an ordinary fight rarely lands one.
  const probe = champion(0, 'PROBE');
  probe.attributes.health = 100000;
  probe.attributes.maxHealth = 100000;
  game.ctx.party.state.champions.push(probe);
  const probeIdx = game.ctx.party.state.champions.length - 1;
  // Reset between hits, or the count just measures how long it takes all six body
  // parts to saturate rather than how often a hit wounds.
  let bigWounds = 0;
  let bigMask = 0;
  for (let i = 0; i < 200; i++) {
    probe.wounds = 0;
    game.systems.championDamage.damageCharacter(probeIdx, 300, 0x3f, 3);
    game.systems.championDamage.displayCharacterDamage();
    if (probe.wounds !== 0) bigWounds++;
    bigMask |= probe.wounds;
  }
  let smallWounds = 0;
  for (let i = 0; i < 200; i++) {
    probe.wounds = 0;
    game.systems.championDamage.damageCharacter(probeIdx, 6, 0x3f, 3);
    game.systems.championDamage.displayCharacterDamage();
    if (probe.wounds !== 0) smallWounds++;
  }
  console.log('');
  console.log(`wound probe: 200 hits of 300 wounded ${bigWounds} times (mask 0x${bigMask.toString(16)});`);
  console.log(`             200 hits of 6 wounded ${smallWounds} times`);
  const woundsOk = bigWounds > 0 && bigWounds > smallWounds;

  // ---- Armour should actually protect ------------------------------------
  // Same blow, same champion, with and without a plate mail body garment. Averaged,
  // because the armour term carries a vitality-scaled random component.
  const armoured = champion(0, 'ARMOURED');
  armoured.attributes.health = 1000000;
  armoured.attributes.maxHealth = 1000000;
  game.ctx.party.state.champions.push(armoured);
  const armIdx = game.ctx.party.state.champions.length - 1;

  const measure = (): number => {
    armoured.attributes.health = 1000000;
    let total = 0;
    for (let i = 0; i < 400; i++) total += game.systems.championDamage.damageCharacter(armIdx, 100, 0x3f, 3);
    return total;
  };
  const bare = measure();
  // clothing_PlateMail is type 34; put one on the body slot and a shield in hand.
  const plate = data.databases.clothing.records.length;
  data.databases.clothing.records.push({
    nextObject: OBJECT_ID_EOF, broken: false, charges: 0, cursed: false, important: false, clothingType: 34,
  });
  data.databases.clothing.count++;
  const shield = data.databases.clothing.records.length;
  data.databases.clothing.records.push({
    nextObject: OBJECT_ID_EOF, broken: false, charges: 0, cursed: false, important: false, clothingType: 30,
  });
  data.databases.clothing.count++;
  const encode = (i: number) => game.ctx.dungeon.rnMaps.rn(DBType.CLOTHING, i);
  armoured.possessions![3] = encode(plate);  // body
  armoured.possessions![0] = encode(shield); // shield hand
  const partial = measure();

  // Now a full suit. Only the body part actually struck is consulted, so covering
  // one slot out of six can only help a sixth of the time.
  const addClothing = (type: number): ObjectID => {
    const i = data.databases.clothing.records.length;
    data.databases.clothing.records.push({
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, cursed: false, important: false, clothingType: type,
    });
    data.databases.clothing.count++;
    return encode(i);
  };
  armoured.possessions![2] = addClothing(43); // HelmOfRa
  armoured.possessions![4] = addClothing(45); // PoleynOfRa
  armoured.possessions![5] = addClothing(46); // GreaveOfRa
  const clad = measure();

  console.log('');
  console.log(`armour probe: 400 hits of 100 dealt ${bare} bare,`);
  console.log(`              ${partial} in plate + shield, ${clad} in a full suit`);
  const armourOk = clad < partial && partial < bare;

  console.log('');
  if (armourOk) {
    console.log(
      `armour reduced damage by ${Math.round((1 - partial / bare) * 100)}% (one piece) ` +
      `and ${Math.round((1 - clad / bare) * 100)}% (full suit)`,
    );
  }

  check(totalLost > 0, 'monsters are hurting the party');
  check(armourOk, 'armour reduces damage, and more armour reduces it more');
  check(woundsOk, 'big hits wound, small hits mostly do not');
  finish();
}

main();
