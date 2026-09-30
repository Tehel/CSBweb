/**
 * The three champion-state primitives Phase 13 is built on, none of which show on a
 * golden frame: `AdjustStamina`, poison as a real timer, and the tail of
 * `KillCharacter`.
 *
 *   1. `AdjustStamina` (`doc/CSBwin-src/Code11f52.cpp:4413`) — clamps at both ends,
 *      and turns whatever a decrement overshot by into unmitigated damage at half
 *      rate. That is the path by which exhaustion kills.
 *   2. `PoisonCharacter` (`doc/CSBwin-src/CSBCode.cpp:7211`) + `TT_75`
 *      (`:6554`) + `CurePoison` (`doc/CSBwin-src/Character.cpp:3007`) — poison is a
 *      chain of timers 36 ticks apart, not a number that sits on the champion. Before
 *      this, `poisonCount` only ever went up.
 *   3. `KillCharacter`'s tail (`doc/CSBwin-src/Character.cpp:2670-2694`) — the cursor
 *      and the magic tab move to a living champion, and `d.GameIsLost` is set when
 *      there is none.
 *
 * Run: `npx tsx tools/dump-champion-state.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { setHandOwner, selectMagicCaster } from '../src/engine/Party';
import { TimerFunction } from '../src/engine/TimerQueue';
import type { Champion } from '../src/engine/gameTypes';
import { newGame, processTimersAt } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

function champion(i: number, name: string): Champion {
  return {
    ...addCharacterDefaults(),
    name,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  return game;
}

function withParty(count: number): Game {
  const game = makeGame();
  for (let i = 0; i < count; i++) game.addChampion(champion(i, `HERO${i}`));
  game.party.state.position = new Position(6, 14, 2);
  return game;
}

/** Advance the clock to `t` and let the timer queue run, as the VBL loop does. */
function tickTo(game: Game, from: number, to: number): void {
  for (let t = from; t <= to; t++) {
    (game as unknown as { state: { tickCount: number } }).state.tickCount = t;
    processTimersAt(game, t);
  }
}

function poisonTimersFor(game: Game, chIdx: number): number {
  return game.timerQueue
    .getTimers()
    .filter((t) => t.function === TimerFunction.TT_75 && (t.uByte5 & 0xff) === chIdx).length;
}

function main(): void {
  /* --------------------------------------------------- 1. AdjustStamina --------- */

  console.log('=== AdjustStamina (doc/CSBwin-src/Code11f52.cpp:4413) ===');
  console.log(['stamina', 'decrement', 'stamina after', 'health after', 'note'].join('\t'));

  const staminaCase = (
    stamina: number,
    decrement: number,
    note: string,
  ): { stamina: number; health: number } => {
    const game = withParty(1);
    const champ = game.party.state.champions[0]!;
    champ.attributes.stamina = stamina;
    game.monsterAttack.adjustStamina(0, decrement);
    game.monsterAttack.displayCharacterDamage();
    const after = { stamina: champ.attributes.stamina, health: champ.attributes.health };
    console.log([stamina, decrement, after.stamina, after.health, note].join('\t'));
    return after;
  };

  const spent = staminaCase(100, 30, 'an ordinary cost');
  check(spent.stamina === 70 && spent.health === 200, 'a cost inside the reserve just subtracts');

  const restored = staminaCase(50, -30, 'a negative decrement restores');
  check(restored.stamina === 80, 'a negative decrement restores stamina');

  const capped = staminaCase(90, -50, 'restoring past the maximum clamps');
  check(capped.stamina === 100, 'stamina never passes MaxStamina');

  const exhausted = staminaCase(10, 50, 'the overshoot becomes damage');
  check(exhausted.stamina === 0, 'stamina floors at zero');
  // Overshoot is 40, so the damage is 40/2 = 20 — no armour, no wound roll.
  check(exhausted.health === 180, `the 40-point overshoot cost 20 health (got ${200 - exhausted.health})`);

  const exact = staminaCase(30, 30, 'exactly zero still takes the zero branch');
  check(exact.stamina === 0 && exact.health === 200, 'landing exactly on zero costs no health');

  {
    const game = withParty(1);
    game.party.state.champions[0]!.attributes.stamina = 40;
    game.monsterAttack.adjustStamina(-1, 20);
    check(game.party.state.champions[0]!.attributes.stamina === 40, 'chIdx -1 is a no-op');
  }

  /* --------------------------------------------------- 2. poison ---------------- */

  console.log('');
  console.log('=== PoisonCharacter and TT_75 (doc/CSBwin-src/CSBCode.cpp:7211, :6554) ===');
  console.log(['tick', 'poisonCount', 'health', 'TT_75 queued', 'event'].join('\t'));

  const game = withParty(2);
  const victim = game.party.state.champions[0]!;
  const startHealth = victim.attributes.health;

  // Strength 200: the first dose is Larger(1, 200/64) = 3, and 199 ticks are left.
  (game as unknown as { state: { tickCount: number } }).state.tickCount = 0;
  game.monsterAttack.poisonCharacter(0, 200);
  game.monsterAttack.displayCharacterDamage();
  console.log([0, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'poisoned, strength 200'].join('\t'));

  check(victim.attributes.health === startHealth - 3, `the first dose was 3 (got ${startHealth - victim.attributes.health})`);
  check(victim.poisonCount === 1, `poisonCount is 1 while poisoned (got ${victim.poisonCount})`);
  check(poisonTimersFor(game, 0) === 1, 'one TT_75 is queued');
  check(poisonTimersFor(game, 1) === 0, 'the other champion is not poisoned');

  // The timer is 36 ticks out: nothing at 35, the next dose at 36.
  tickTo(game, 1, 35);
  console.log([35, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'still waiting'].join('\t'));
  check(victim.attributes.health === startHealth - 3, 'nothing happens before tick 36');
  check(poisonTimersFor(game, 0) === 1, 'the timer is still pending at tick 35');

  tickTo(game, 36, 36);
  console.log([36, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'second dose'].join('\t'));
  check(victim.attributes.health === startHealth - 6, `the second dose landed at tick 36 (health ${victim.attributes.health})`);
  check(victim.poisonCount === 1, 'poisonCount stays at 1 — it goes down then straight back up');
  check(poisonTimersFor(game, 0) === 1, 'the chain re-armed itself');

  tickTo(game, 37, 72);
  console.log([72, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'third dose'].join('\t'));
  check(victim.attributes.health === startHealth - 9, 'a third dose landed 36 ticks after the second');

  // CurePoison cancels the chain outright.
  game.monsterAttack.curePoison(0);
  console.log([72, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'CurePoison'].join('\t'));
  check(poisonTimersFor(game, 0) === 0, 'CurePoison deleted the pending TT_75');
  check(victim.poisonCount === 0, 'CurePoison cleared the count');

  const healthAtCure = victim.attributes.health;
  tickTo(game, 73, 200);
  console.log([200, victim.poisonCount, victim.attributes.health, poisonTimersFor(game, 0), 'long after the cure'].join('\t'));
  check(victim.attributes.health === healthAtCure, 'no further dose after the cure');

  // A single-tick dose deals its damage and arms nothing.
  {
    const g = withParty(1);
    const ch = g.party.state.champions[0]!;
    g.monsterAttack.poisonCharacter(0, 1);
    g.monsterAttack.displayCharacterDamage();
    check(ch.attributes.health === 199, 'a one-tick dose still deals the minimum 1 damage');
    check(poisonTimersFor(g, 0) === 0, 'a one-tick dose arms no timer');
    check(ch.poisonCount === 0, 'and leaves the champion unpoisoned');
  }

  // The potential champion — the one in a Hall of Champions mirror — is immune.
  {
    const g = withParty(2);
    g.party.state.potentialChampionIndex = 1;
    const ch = g.party.state.champions[1]!;
    g.monsterAttack.poisonCharacter(1, 200);
    g.monsterAttack.displayCharacterDamage();
    check(ch.attributes.health === 200, 'an unconfirmed champion cannot be poisoned');
    check(poisonTimersFor(g, 1) === 0, 'and no timer is armed for them');
  }

  /* --------------------------------------------- 3. KillCharacter's tail -------- */

  console.log('');
  console.log('=== KillCharacter tail (doc/CSBwin-src/Character.cpp:2670-2694) ===');
  console.log(['case', 'cursor owner', 'magic caster', 'gameIsLost'].join('\t'));

  {
    const g = withParty(3);
    const party = g.party.state;
    setHandOwner(party, 1);
    selectMagicCaster(party, 1);
    check(party.cursorOwner === 1 && party.magicCasterIndex === 1, 'champion 1 holds both');

    g.monsterAttack.killCharacter(1);
    console.log(['champion 1 of 3 dies', party.cursorOwner, party.magicCasterIndex, String(party.gameIsLost)].join('\t'));
    check(party.cursorOwner === 0, `the cursor moved to the first living champion (got ${party.cursorOwner})`);
    check(party.magicCasterIndex === 0, `the magic tab moved with it (got ${party.magicCasterIndex})`);
    check(party.gameIsLost !== true, 'the game is not lost while two champions live');
  }

  {
    // Champion 0 dies while champion 2 holds the cursor: nothing should move.
    const g = withParty(3);
    const party = g.party.state;
    setHandOwner(party, 2);
    selectMagicCaster(party, 2);
    g.monsterAttack.killCharacter(0);
    console.log(['a bystander dies', party.cursorOwner, party.magicCasterIndex, String(party.gameIsLost)].join('\t'));
    check(party.cursorOwner === 2, 'a death elsewhere leaves the cursor alone');
    check(party.magicCasterIndex === 2, 'and leaves the magic tab alone');
  }

  {
    const g = withParty(1);
    const party = g.party.state;
    setHandOwner(party, 0);
    selectMagicCaster(party, 0);
    g.monsterAttack.killCharacter(0);
    console.log(['the last champion dies', party.cursorOwner, party.magicCasterIndex, String(party.gameIsLost)].join('\t'));
    check(party.gameIsLost, 'the last death sets gameIsLost');
    check(party.cursorOwner === -1, 'and drops the cursor');
  }

  {
    // The unconfirmed champion does not count as a survivor.
    const g = withParty(2);
    const party = g.party.state;
    party.potentialChampionIndex = 1;
    setHandOwner(party, 0);
    g.monsterAttack.killCharacter(0);
    console.log(['only a mirror champion left', party.cursorOwner, party.magicCasterIndex, String(party.gameIsLost)].join('\t'));
    check(party.gameIsLost, 'a champion still in a mirror does not keep the game alive');
  }

  {
    // A poisoned champion's timers must not outlive them.
    const g = withParty(2);
    g.monsterAttack.poisonCharacter(0, 200);
    check(poisonTimersFor(g, 0) === 1, 'the victim is poisoned before dying');
    g.monsterAttack.killCharacter(0);
    check(poisonTimersFor(g, 0) === 0, 'KillCharacter cures the poison it leaves behind');
  }

  console.log('');
  finish();
}

main();
