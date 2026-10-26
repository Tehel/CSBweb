/**
 * The damage a champion takes, from the blow to the red figure over their name.
 *
 * `DamageCharacter` (`doc/CSBwin-src/Character.cpp:2708`) takes nothing off the HP: it
 * adds the blow to `d.PendingDamage` (`:2905`) and its wounds to `d.PendingOuches`
 * (`:2808`). Once a main-loop tick, after the viewport is drawn,
 * `DisplayCharacterDamage` (`doc/CSBwin-src/CSBCode.cpp:7143`, called at `:667`) ORs the
 * wounds into `ouches`, takes the sum off the HP or kills, and blits graphic 15 over the
 * name — graphic 16 over the portrait of an open inventory — with the figure on it. A
 * `TT_12` five ticks on (`:7231-7261`) runs `TAG011366` (`doc/CSBwin-src/Timer.cpp:2686`),
 * which draws the name or the portrait back over it.
 *
 *   1. The engine: pending damage and wounds, the HP, the `TT_12`, the host's two calls,
 *      a kill, the recruit in a mirror, and the order inside `Game`'s tick.
 *   2. The redraws that go over the figure before its `TT_12`: `DrawCharacterState` with
 *      `CHARFLAG_cursor` (`SetHandOwner`) or `CHARFLAG_portraitChanged` (a shield starting
 *      or ending), each of which the engine hands the host.
 *   3. The screen: `drawPartyStatus` with the real graphics and font — what the readout
 *      covers in each mode, and when it is dropped.
 *
 * Run: `npm test -- --only=character-damage.ts`
 */
import { PotionType } from '../../src/core/constants';
import { CsbRandom } from '../../src/core/random';
import { Direction, Position } from '../../src/core/types';
import { CHARACTER_BLOCK_SIZE, readCsbwinPartyTail, writeCsbwinPartyTail } from '../../src/data/CsbwinCharacters';
import { Game } from '../../src/engine/Game';
import { applyFeedParameters, derivePotionFeeding } from '../../src/engine/Feeding';
import { clearFeedParameters } from '../../src/engine/filterParameters';
import { Party, setHandOwner } from '../../src/engine/Party';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { AttributeIndex, attributeCurrent, makeAddCharacterAttributes } from '../../src/engine/attributes';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../../src/engine/AddCharacter';
import { CHARFLAG_CURSOR, CHARFLAG_PORTRAIT_CHANGED } from '../../src/core/charDesc';
import { createPaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../../src/renderer/ViewportGraphics';
import { drawCharacterState, drawPartyStatus } from '../../src/renderer/ui/Character';
import { type UIState } from '../../src/renderer/ui/UIState';
import { gameTablesOf, newGame, presetHeroesOf, processTimersAt, stockDungeon, stockGraphics } from '../lib/game';
import { newUIState } from '../lib/ui';
import { standIn } from '../lib/standIn';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';

const data = stockDungeon();
const graphics = stockGraphics();

/** `DrawCharacterState`'s flags, by CSBWin's names. */
function flagNames(charFlags: number): string {
  const names: string[] = [];
  if ((charFlags & CHARFLAG_CURSOR) !== 0) names.push('cursor');
  if ((charFlags & CHARFLAG_PORTRAIT_CHANGED) !== 0) names.push('portraitChanged');
  const rest = charFlags & ~(CHARFLAG_CURSOR | CHARFLAG_PORTRAIT_CHANGED);
  if (rest !== 0) names.push(`0x${rest.toString(16)}`);
  return names.join('|');
}

/**
 * A game of `count` champions, with the host's two damage calls written to `calls` and
 * its `drawCharacterState` calls to `draws`.
 */
function makeGame(count: number, calls: string[], draws: string[] = []): Game {
  const game = newGame(data!, graphics, {
    displayCharacterDamage: (chIdx, damage) => calls.push(`display ${chIdx} ${damage}`),
    tag011366: (chIdx) => calls.push(`tag011366 ${chIdx}`),
    drawCharacterState: (chIdx, charFlags) => draws.push(`${chIdx} ${flagNames(charFlags)}`),
  });
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < count; i++) game.systems.hallOfChampions.addChampion(testChampion(i));
  game.ctx.party.state.position = new Position(6, 14, 2);
  return game;
}

function tt12s(game: Game): { index: number; time: number; chIdx: number }[] {
  return game.ctx.timers.getTimers()
    .filter((t) => t.function === TimerFunction.TT_12)
    .map((t) => ({ index: t.index, time: t.time, chIdx: t.uByte5 & 0xff }));
}

/* ------------------------------------------------------------ 1. the engine ------ */
console.log('=== DamageCharacter and DisplayCharacterDamage ===');
{
  const calls: string[] = [];
  const g = makeGame(2, calls);
  const hero = g.ctx.party.state.champions[0]!;
  g.ctx.state.tickCount = 100;

  // Two blows in one tick. Kind 0: no armour, no wounds, the damage as it is given.
  const a = g.systems.championDamage.damageCharacter(0, 7, 0, 0);
  const b = g.systems.championDamage.damageCharacter(0, 5, 0, 0);
  console.log(`two blows of 7 and 5: returned ${a} and ${b}, HP ${hero.attributes.health}, `
    + `pending ${g.ctx.party.state.pendingDamage.join(',')}`);
  check(a === 7 && b === 5, 'DamageCharacter returns what it dealt');
  check(hero.attributes.health === 200, 'and takes nothing off the HP (Character.cpp:2905)');
  check(g.ctx.party.state.pendingDamage[0] === 12, 'the blows add up in d.PendingDamage');

  // Wounds wait too. A 300-point blow over mask 0x3f wounds on this seed.
  const probe = makeGame(1, []);
  probe.systems.championDamage.damageCharacter(0, 300, 0x3f, 3);
  const pendingOuches = probe.ctx.party.state.pendingOuches[0]!;
  const woundsBefore = probe.ctx.party.state.champions[0]!.wounds;
  probe.systems.championDamage.displayCharacterDamage();
  const woundsAfter = probe.ctx.party.state.champions[0]!.wounds;
  console.log(`a 300-point blow: pending ouches 0x${pendingOuches.toString(16)}, `
    + `wounds 0x${woundsBefore.toString(16)} -> 0x${woundsAfter.toString(16)}`);
  check(pendingOuches !== 0 && woundsBefore === 0, 'wounds wait in d.PendingOuches (Character.cpp:2808)');
  check(woundsAfter === pendingOuches && probe.ctx.party.state.pendingOuches[0] === 0,
    'DisplayCharacterDamage ORs them into ouches and clears them (CSBCode.cpp:7157-7159)');

  g.systems.championDamage.displayCharacterDamage();
  const timers = tt12s(g);
  console.log(`DisplayCharacterDamage: HP ${hero.attributes.health}, calls [${calls.join('; ')}], `
    + `TT_12 ${JSON.stringify(timers)}, timerIndex ${hero.timerIndex}`);
  check(hero.attributes.health === 188 && g.ctx.party.state.pendingDamage[0] === 0,
    'the sum comes off the HP once, and the pending damage is cleared');
  check(calls.join(';') === 'display 0 12', 'the screen is asked to show 12 over champion 0');
  check(timers.length === 1 && timers[0]!.time === 105 && timers[0]!.chIdx === 0,
    'a TT_12 for champion 0, five ticks on (CSBCode.cpp:7235-7249)');
  check(hero.timerIndex === timers[0]!.index, "and it is the champion's timerIndex");

  // Another blow two ticks later moves the same timer rather than adding one.
  g.ctx.state.tickCount = 102;
  g.systems.championDamage.damageCharacter(0, 3, 0, 0);
  g.systems.championDamage.displayCharacterDamage();
  const moved = tt12s(g);
  console.log(`a blow of 3 at 102: TT_12 ${JSON.stringify(moved)}, calls [${calls.join('; ')}]`);
  check(moved.length === 1 && moved[0]!.index === timers[0]!.index && moved[0]!.time === 107,
    'a second loss moves the TT_12 to five ticks after it (CSBCode.cpp:7253-7260)');
  check(calls[1] === 'display 0 3', 'and shows the new loss, not the sum');

  // Nothing is due until then.
  calls.length = 0;
  for (let t = 103; t <= 106; t++) processTimersAt(g, t);
  check(calls.length === 0 && hero.timerIndex !== -1, 'the figure stays up until the timer is due');
  processTimersAt(g, 107);
  console.log(`at 107: calls [${calls.join('; ')}], timerIndex ${hero.timerIndex}, TT_12 left ${tt12s(g).length}`);
  check(calls.join(';') === 'tag011366 0' && hero.timerIndex === -1 && tt12s(g).length === 0,
    'the TT_12 runs TAG011366: timerIndex -1, and the name goes back over it (Timer.cpp:2690-2703)');

  // A blow that kills: no figure, no timer.
  calls.length = 0;
  g.systems.championDamage.damageCharacter(1, 250, 0, 0);
  check(g.ctx.party.state.champions[1]!.attributes.health !== 0, 'a killing blow does not kill yet');
  g.systems.championDamage.displayCharacterDamage();
  console.log(`a blow of 250 on champion 1: alive ${g.ctx.party.state.champions[1]!.attributes.health !== 0}, calls [${calls.join('; ')}], `
    + `TT_12 ${tt12s(g).length}`);
  check(g.ctx.party.state.champions[1]!.attributes.health === 0, 'DisplayCharacterDamage kills (CSBCode.cpp:7169-7173)');
  check(calls.length === 0 && tt12s(g).length === 0, 'and shows nothing and arms nothing for the dead');

  // A TT_12 that falls due after its champion died redraws nothing (Timer.cpp:2692).
  const late = makeGame(1, calls);
  calls.length = 0;
  late.systems.championDamage.damageCharacter(0, 10, 0, 0);
  late.systems.championDamage.displayCharacterDamage();
  late.systems.championDamage.damageCharacter(0, 999, 0, 0);
  late.systems.championDamage.displayCharacterDamage();
  processTimersAt(late, late.ctx.state.tickCount + 5);
  console.log(`shown, then killed before the TT_12: calls [${calls.join('; ')}]`);
  check(calls.join(';') === 'display 0 10', "a dead champion's TT_12 draws nothing back");
  check(late.ctx.party.state.champions[0]!.timerIndex === -1, 'but still clears timerIndex');

  // The recruit in a Hall of Champions mirror: `DamageCharacter` refuses them, and a
  // pending sum is dropped, not taken (CSBCode.cpp:7160-7163).
  const hall = makeGame(2, calls);
  calls.length = 0;
  hall.ctx.party.state.pendingDamage[1] = 30;
  hall.ctx.party.state.potentialChampionIndex = 1;
  hall.systems.championDamage.displayCharacterDamage();
  check(hall.ctx.party.state.champions[1]!.attributes.health === 200 && hall.ctx.party.state.pendingDamage[1] === 0
    && calls.length === 0, "the recruit's pending damage is cleared and not taken");
}

/* ------------------------------------------------------- the order in the tick -- */
console.log('');
console.log("=== Game's tick ===");
{
  // A blow inside `ProcessTimers`. The tick draws (`onTick`, `DrawViewport` at
  // CSBCode.cpp:648) with the HP untouched; `DisplayCharacterDamage` follows (`:667`).
  const calls: string[] = [];
  const g = makeGame(1, calls);
  standIn(g.systems.timer, 'processTimers', () => { g.systems.championDamage.damageCharacter(0, 9, 0, 0); return false; });
  const seen: number[] = [];
  g.onTick(() => seen.push(g.ctx.party.state.champions[0]!.attributes.health));
  g.gameTick();
  const hp = g.ctx.party.state.champions[0]!.attributes.health;
  console.log(`the tick draws at HP ${seen.join(',')}, and ends at HP ${hp}; calls [${calls.join('; ')}]`);
  check(seen.join(',') === '200' && hp === 191, 'the tick draws first, then takes the damage off');
  check(calls.join(';') === 'display 0 9', 'and the same tick shows it');
}

/* ------------------------------------- 2. the redraws that go over the figure ---- */
console.log('');
console.log('=== DrawCharacterState: the name and the box drawn again ===');
{
  const draws: string[] = [];
  const g = makeGame(3, [], draws);
  const party = g.ctx.party.state;
  console.log(`the first champion joining: [${draws.join('; ')}]`);
  check(draws.join(';') === '0 cursor', "AddCharacter's SetHandOwner(0) draws the new owner's name (CSBCode.cpp:8509-8510)");

  draws.length = 0;
  setHandOwner(g.ctx, 1);
  console.log(`SetHandOwner(1) from 0: [${draws.join('; ')}]`);
  check(draws.join(';') === '0 cursor;1 cursor',
    'SetHandOwner draws the old owner\'s name, then the new one\'s (CSBCode.cpp:8488-8494, :8509-8510)');

  draws.length = 0;
  setHandOwner(g.ctx, 1);
  check(draws.length === 0, 'and nothing when the owner does not change (:8482)');

  party.potentialChampionIndex = 2;
  setHandOwner(g.ctx, 2);
  console.log(`SetHandOwner(2), the recruit in a mirror: [${draws.join('; ')}], owner ${party.cursorOwner}`);
  check(draws.join(';') === '1 cursor' && party.cursorOwner === 2,
    'the recruit takes the cursor and is not drawn (:8508)');
  party.potentialChampionIndex = -1;

  draws.length = 0;
  setHandOwner(g.ctx, -1);
  check(draws.join(';') === '2 cursor' && party.cursorOwner === -1, 'SetHandOwner(-1) draws the old owner only (:8496-8500)');
  setHandOwner(g.ctx, 0);

  // The spell and fire shields: `MagicShield` starts one, its `TT_77` / `TT_78` ends it.
  const all = '0 portraitChanged;1 portraitChanged;2 portraitChanged';
  g.ctx.state.tickCount = 200;
  for (const [isSpellShield, name, timer] of [[true, 'spell', 'TT_77'], [false, 'fire', 'TT_78']] as const) {
    draws.length = 0;
    g.systems.attack.applyMagicShield(party.champions[0]!, isSpellShield, 320, 0);
    const up = isSpellShield ? party.spellShield : party.fireShield;
    console.log(`MagicShield, ${name}: shield ${up}, [${draws.join('; ')}]`);
    check(up === 10 && draws.join(';') === all, `a ${name} shield starting is MarkAllPortraitsChanged (Attack.cpp:1237)`);
    draws.length = 0;
    processTimersAt(g, 200 + 320);
    const down = isSpellShield ? party.spellShield : party.fireShield;
    console.log(`its ${timer}: shield ${down}, [${draws.join('; ')}]`);
    check(down === 0 && draws.join(';') === all, `and its ${timer} too (CSBCode.cpp:6624-6630)`);
    g.ctx.state.tickCount = 200;
  }

  // The party shield's end. Its start is `CastSpell`'s: `tools/checks/cast-spell.ts`.
  party.partyShield = 12;
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_74, 50, 12);
  draws.length = 0;
  processTimersAt(g, 250);
  console.log(`a party shield's TT_74: shield ${party.partyShield}, [${draws.join('; ')}]`);
  check(party.partyShield === 0 && draws.join(';') === all, "a party shield's TT_74 is MarkAllPortraitsChanged (CSBCode.cpp:6609-6612)");

  // No floor: a timer that takes back more than is there leaves the counter below zero
  // (`CSBCode.cpp:6578`, `:6608-6631`). `_FusionSequence` writes 100 over what the spells
  // had added (`Attack.cpp:2278-2280`), while their timers still hold their amounts.
  g.ctx.state.tickCount = 260;
  party.partyShield = 100;
  party.spellShield = 100;
  party.fireShield = 100;
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_74, 10, 130);
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_77, 10, 110);
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_78, 10, 125);
  party.invisible = 0;
  party.seeThruWalls = 0;
  party.magicFootprintsActive = 0;
  for (const fn of [TimerFunction.TT_71, TimerFunction.TT_73, TimerFunction.TT_79]) {
    g.systems.magic.queueUtilityTimer(fn, 10, 0);
  }
  processTimersAt(g, 270);
  console.log(`timers taking back more than is there: party ${party.partyShield}, spell ${party.spellShield}, `
    + `fire ${party.fireShield}, invisible ${party.invisible}, see-through ${party.seeThruWalls}, `
    + `footprints ${party.magicFootprintsActive}`);
  check(party.partyShield === -30 && party.spellShield === -10 && party.fireShield === -25,
    'TT_74, TT_77 and TT_78 take a shield below zero (CSBCode.cpp:6610, :6625, :6628)');
  check(party.invisible === -1 && party.seeThruWalls === -1 && party.magicFootprintsActive === -1,
    'TT_71, TT_73 and TT_79 take their counter below zero (CSBCode.cpp:6578, :6608, :6631)');

  // The three counters are `i8` (`Data.h:783-784`, `:798`), and the shields `i16`.
  party.invisible = -128;
  party.spellShield = -32768;
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_71, 10, 0);
  g.systems.magic.queueUtilityTimer(TimerFunction.TT_77, 10, 1);
  processTimersAt(g, 280);
  console.log(`at their type's lowest: invisible ${party.invisible}, spell ${party.spellShield}`);
  check(party.invisible === 127 && party.spellShield === 32767, 'an i8 counter and an i16 shield wrap round');

  // A save keeps them signed: block 4's tail holds the three counters as bytes and the
  // shields as words (`Data.h:783-787`, `:798`).
  {
    const block = new Uint8Array(CHARACTER_BLOCK_SIZE);
    writeCsbwinPartyTail(block, {
      ...readCsbwinPartyTail(block),
      invisible: -1, seeThruWalls: -2, magicFootprintsActive: -3, partyShield: -30, spellShield: -10, fireShield: -25,
    });
    const tail = readCsbwinPartyTail(block);
    console.log(`through a save: party ${tail.partyShield}, spell ${tail.spellShield}, fire ${tail.fireShield}, `
      + `invisible ${tail.invisible}, see-through ${tail.seeThruWalls}, footprints ${tail.magicFootprintsActive}`);
    check(tail.invisible === -1 && tail.seeThruWalls === -2 && tail.magicFootprintsActive === -3
      && tail.partyShield === -30 && tail.spellShield === -10 && tail.fireShield === -25,
    'a counter below zero is read back below zero');
  }

  // `DamageCharacter` takes a shield as it stands: it subtracts the spell or the fire
  // shield from the blow (`Character.cpp:2773`, `:2780`) and adds the party's to the
  // armour (`:2461`).
  for (const [kind, name] of [[5, 'spell'], [1, 'fire']] as const) {
    const dealt = [0, -10].map((shield) => {
      const probe = makeGame(1, []);
      const state = probe.ctx.party.state;
      if (kind === 5) state.spellShield = 10; else state.fireShield = 10;
      probe.systems.magic.queueUtilityTimer(kind === 5 ? TimerFunction.TT_77 : TimerFunction.TT_78, 10, 10 - shield);
      processTimersAt(probe, 10);
      return probe.systems.championDamage.damageCharacter(0, 40, 0, kind);
    });
    console.log(`a ${name} blow of 40: ${dealt[0]} with the shield at 0, ${dealt[1]} with it at -10`);
    check(dealt[1]! > dealt[0]!, `a ${name} shield below zero adds to the blow (Character.cpp:${kind === 5 ? 2768 : 2775})`);
  }
  {
    const armour = [0, -30].map((shield) => {
      const probe = makeGame(1, []);
      probe.ctx.party.state.partyShield = 60;
      probe.systems.magic.queueUtilityTimer(TimerFunction.TT_74, 10, 60 - shield);
      processTimersAt(probe, 10);
      // Vitality 1: the random term is `rand % 1`, so what is left is the shield's half.
      const hero = probe.ctx.party.state.champions[0]!;
      hero.attributes.stats = makeAddCharacterAttributes([60, 60, 1, 50, 50, 20, 20]);
      hero.attackStatModifier = 80;
      return probe.systems.championDamage.armourStrength(hero, 2, false);
    });
    console.log(`armour with 80 of the champion's own: ${armour[0]} with the party shield at 0, ${armour[1]} with it at -30`);
    check(armour[0] === 40 && armour[1] === 25, 'a party shield below zero takes off the armour (Character.cpp:2458-2462, :2491)');
  }

  // `TAG01680a`'s tail (`Character.cpp:2483-2491`): a wounded part loses
  // `STRandom0_3() + 8`, a sleeping party's total is halved, and then comes the halving
  // every total gets. The draws are replayed from the seed: `STRandom` for the Vitality
  // term, and one more for a wounded part.
  for (const [wounds, sleeping, what] of [
    [0, false, 'whole and awake'], [1 << 2, false, 'wounded'], [1 << 3, false, 'another part wounded'],
    [0, true, 'asleep'], [1 << 2, true, 'wounded and asleep'],
  ] as const) {
    const probe = makeGame(1, []);
    const hero = probe.ctx.party.state.champions[0]!;
    hero.attackStatModifier = 80;
    hero.wounds = wounds;
    probe.ctx.party.state.sleeping = sleeping;
    const replay = new CsbRandom();
    replay.setSeed(probe.ctx.random.getSeed());
    let want = (replay.next() & 0xffff) % (Math.trunc(attributeCurrent(hero.attributes.stats[AttributeIndex.Vitality]) / 8) + 1) + 80;
    const penalty = (wounds & (1 << 2)) !== 0 ? replay.zeroTo3() + 8 : 0;
    want -= penalty;
    if (sleeping) want >>= 1;
    want >>= 1;
    const armour = probe.systems.championDamage.armourStrength(hero, 2, false);
    console.log(`armour of part 2, ${what}: ${armour} (expected ${want}, the wound taking ${penalty})`);
    check(armour === want, `${what}: the armour is CSBWin's`);
    check(probe.ctx.random.getSeed() === replay.getSeed(), `${what}: ${penalty !== 0 ? 'two draws' : 'one draw'}`);
  }

  party.partyShield = 0;
  party.spellShield = 0;
  party.fireShield = 0;
  party.invisible = 0;
  party.seeThruWalls = 0;
  party.magicFootprintsActive = 0;

  // A Ya potion: the drinker's own shield, and the `TT_72` that takes it back.
  g.ctx.state.tickCount = 300;
  const drinker = party.champions[1]!;
  const fp = clearFeedParameters();
  fp.characterIndex = 1;
  derivePotionFeeding(fp, drinker, PotionType.YA_POTION, 100);
  draws.length = 0;
  applyFeedParameters(g.ctx, 1, fp);
  console.log(`a Ya potion: shieldStrength ${drinker.shieldStrength} for ${fp.shieldDuration} ticks, [${draws.join('; ')}]`);
  check(drinker.shieldStrength === fp.shieldStrengthAdjust && fp.shieldStrengthAdjust > 0 && draws.join(';') === '1 portraitChanged',
    "a Ya potion draws the drinker's box afresh, and no other (Character.cpp:4410, :4509)");
  draws.length = 0;
  processTimersAt(g, 300 + fp.shieldDuration);
  console.log(`its TT_72: shieldStrength ${drinker.shieldStrength}, [${draws.join('; ')}]`);
  check(drinker.shieldStrength === 0 && draws.join(';') === '1 portraitChanged', 'and so does its TT_72 (CSBCode.cpp:6604-6606)');

  // A potion with no shield in it draws nothing over the box.
  const vi = clearFeedParameters();
  vi.characterIndex = 1;
  derivePotionFeeding(vi, drinker, PotionType.VI_POTION, 100);
  draws.length = 0;
  applyFeedParameters(g.ctx, 1, vi);
  check(draws.length === 0, 'a Vi potion does not');
}

/* ------------------------------------------------------------- 3. the screen ---- */
console.log('');
console.log('=== drawPartyStatus ===');
{
  const heroes = presetHeroesOf(data!, graphics).filter((h) => (h.inventory?.length ?? 0) > 0);
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  for (let i = 0; i < 2; i++) {
    party.addChampion(createChampionFromPreset(heroes[i]!, i, assignPresetHeroPossessions(heroes[i]!.inventory, gameTablesOf(graphics))));
  }
  const cache = new Map();
  // The host's `drawCharacterState` is the screen's, as `main.ts` wires it.
  const ui: UIState = newUIState(graphics, newGame(data!, graphics, {
    drawCharacterState: (chIdx, charFlags) => drawCharacterState(ui, chIdx, charFlags),
  }).ctx, {
    getGraphicBitmap: (n, format) => getCachedGraphicBitmap(graphics, cache, n, format),
  });
  ui.ctx.party.state = party.state;

  // Canary: the two graphics are the sizes `DisplayCharacterDamage`'s rectangles are
  // (`x2 = x1 + 47`, `y2 = 6`; `x2 = x1 + 31`, `y2 = 28`).
  const g15 = ui.getGraphicBitmap(15)!;
  const g16 = ui.getGraphicBitmap(16)!;
  console.log(`graphic 15 is ${g15.width}x${g15.height}, graphic 16 ${g16.width}x${g16.height}`);
  check(g15.width === 48 && g15.height === 7, 'graphic 15 is 48x7');
  check(g16.width === 32 && g16.height === 29, 'graphic 16 is 32x29');

  const render = (): Uint8Array => {
    const screen = createPaletteIndexViewportBuffer(320, 200, 7);
    ui.screenIndexBuffer = screen;
    drawPartyStatus(ui);
    return screen.pixels.slice(0, 320 * 29);
  };
  /** The bounding box of the pixels that differ, and how many are the figure's colour 15. */
  const diff = (a: Uint8Array, b: Uint8Array): { x1: number; y1: number; x2: number; y2: number; fifteen: number } => {
    const box = { x1: 999, y1: 999, x2: -1, y2: -1, fifteen: 0 };
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const x = i % 320;
      const y = Math.floor(i / 320);
      box.x1 = Math.min(box.x1, x); box.y1 = Math.min(box.y1, y);
      box.x2 = Math.max(box.x2, x); box.y2 = Math.max(box.y2, y);
      if (b[i] === 15) box.fifteen++;
    }
    return box;
  };
  const within = (box: { x1: number; y1: number; x2: number; y2: number }, x1: number, y1: number, x2: number, y2: number): boolean =>
    box.x2 >= 0 && box.x1 >= x1 && box.y1 >= y1 && box.x2 <= x2 && box.y2 <= y2;

  const plain = render();
  ui.characterDamage[1] = { damage: 7, inventoryOpen: false };
  const overName = diff(plain, render());
  console.log(`7 over champion 1's name changes (${overName.x1},${overName.y1})-(${overName.x2},${overName.y2}), `
    + `${overName.fifteen} pixels of colour 15`);
  check(within(overName, 69, 0, 69 + 47, 6), "graphic 15 and the figure lie in the name's rectangle, 69*chIdx..+47 by 0..6");
  check(overName.fifteen > 0, 'the figure is drawn in colour 15');

  ui.characterDamage[1] = { damage: 777, inventoryOpen: false };
  const wide = diff(plain, render());
  check(within(wide, 69, 0, 69 + 47, 6) && wide.fifteen > overName.fifteen, 'three digits fit the same rectangle');

  ui.characterDamage[1] = null;
  party.state.selectedCharacterIndex = 1;
  const inventory = render();
  ui.characterDamage[1] = { damage: 42, inventoryOpen: true };
  const overPortrait = diff(inventory, render());
  console.log(`42 over the open inventory's portrait changes (${overPortrait.x1},${overPortrait.y1})-`
    + `(${overPortrait.x2},${overPortrait.y2}), ${overPortrait.fifteen} pixels of colour 15`);
  check(within(overPortrait, 69 + 7, 0, 69 + 38, 28), "graphic 16 and the figure lie over the portrait, 69*chIdx+7..+38 by 0..28");
  check(overPortrait.fifteen > 0, 'with the figure in colour 15');

  // Opening or closing the inventory fills the box afresh (`CHARFLAG_portraitChanged`).
  ui.characterDamage[1] = { damage: 42, inventoryOpen: false };
  check(diff(inventory, render()).x2 < 0 && ui.characterDamage[1] === null,
    'a figure shown over the name is gone once the inventory is open');

  // Death: `KillCharacter` blits graphic 8 over the box.
  party.state.selectedCharacterIndex = -1;
  const dead = party.state.champions[1]!;
  dead.attributes.health = 0;
  const deadPlain = render();
  ui.characterDamage[1] = { damage: 3, inventoryOpen: false };
  check(diff(deadPlain, render()).x2 < 0 && ui.characterDamage[1] === null, 'a dead champion shows no figure');
  dead.attributes.health = 50;

  // `DrawCharacterState` with `CHARFLAG_cursor` fills the name's rectangle, x to +42, of
  // a champion whose inventory is closed. Canary: graphic 15 has nothing to its right.
  let opaque = 0;
  for (let y = 0; y < g15.height; y++) for (let x = 43; x < g15.width; x++) if (g15.pixels[y * g15.width + x] !== 10) opaque++;
  check(opaque === 0, "graphic 15's columns 43 to 47 are colour 10, so the name's rectangle covers all of it");

  const shown = (): string => ui.characterDamage.map((d) => (d ? String(d.damage) : '-')).join(' ');
  const figures = (inventoryOpen: boolean): void => {
    ui.characterDamage[0] = { damage: 5, inventoryOpen: false };
    ui.characterDamage[1] = { damage: 6, inventoryOpen };
  };

  // The hand changing owner, through the host: both names are drawn again.
  setHandOwner(ui.ctx, 0);
  figures(false);
  setHandOwner(ui.ctx, 1);
  console.log(`figures on 0 and 1, the hand passing from 0 to 1: shown [${shown()}]`);
  check(shown() === '- - - -', "SetHandOwner's two redraws take the figure off the old owner's name and the new one's");
  const noFigure = render();
  figures(false);
  setHandOwner(ui.ctx, 1);
  check(shown() === '5 6 - -' && diff(noFigure, render()).fifteen > 0, 'a click on the owner already holding it redraws nothing');

  // With champion 1's inventory open their name goes into the viewport: the figure over
  // the portrait stays, and the other champion's goes.
  party.state.selectedCharacterIndex = 1;
  figures(true);
  setHandOwner(ui.ctx, 0);
  console.log(`champion 1's inventory open, the hand passing from 1 to 0: shown [${shown()}]`);
  check(shown() === '- 6 - -', "CHARFLAG_cursor leaves the figure over an open inventory's portrait (Character.cpp:1327-1344)");

  // `CHARFLAG_portraitChanged` fills the whole box, in either mode.
  figures(true);
  drawCharacterState(ui, 0, CHARFLAG_PORTRAIT_CHANGED);
  drawCharacterState(ui, 1, CHARFLAG_PORTRAIT_CHANGED);
  console.log(`CHARFLAG_portraitChanged on both: shown [${shown()}]`);
  check(shown() === '- - - -', 'CHARFLAG_portraitChanged takes the figure off the name and off the portrait (Character.cpp:1260-1302)');
  party.state.selectedCharacterIndex = -1;
}

finish();
