/**
 * `SwapCharacter` (`doc/CSBwin-src/Character.cpp:5497-5535`), a DSA's `&SWAPCHARACTER`
 * (`DSA.cpp:4414-4426`): a champion sent to the wings, brought back, or one for the other.
 * The records themselves are `dump-wings.ts`'s.
 *
 * 1. **The refusals.** 3 to add to a full party, 4 for a fingerprint not in the wings, 2
 *    to delete the last champion; an index outside the party and no fingerprint is 0 and
 *    nothing. None changes the party.
 * 2. **`CharacterDelete`** (`:5376-5439`): the champion into the wings with the party's
 *    facing, the ones after a slot down with the cursor's owner and the open inventory,
 *    the magic tab to the first living champion, and the slot past the party a copy of
 *    the last champion with HP 0. Their own inventory open, it closes.
 * 3. **`CharacterAdd`** (`:5442-5461`): back out of the wings into the slot after the
 *    last, facing 0, in the first corner nobody holds, the champion's own corner being
 *    passed over as if someone held it.
 * 4. **`CharacterSwap`** (`:5463-5494`): the champion out and the one from the wings into
 *    the same slot, with the facing of the one who left, in the free corner, or 5 when the
 *    high byte of `d.PartyFootprints[7]`, read as `d.CH16482[4].charPosition`, is it.
 * 5. **The damage shown** (`:5382-5387`): its `TT_12` deleted and `TAG011366` run; a
 *    champion moved down a slot with one is CSBWin's `die(0x452a)`. The poison is cured.
 * 6. **The portrait** of a champion carrying only `portraitGraphic` is the host's pixels.
 * 7. **A save carries it**: the party of three, the slot past it and the wings.
 *
 * Run: `npm test -- --only=dump-swap-character.ts`
 */
import { readCsbwinCharacter, writeCsbwinCharacter } from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import type { Champion } from '../src/engine/gameTypes';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { swapCharacter } from '../src/engine/SwapCharacter';
import { getFromWings, saveToWings } from '../src/engine/Wings';
import { freshGame, int, op, run, globalStore } from './lib/dsa';
import { check, finish } from './lib/check';

/** A fingerprint nobody in `csbgame7.dat`'s party has. */
const FP = 0x0c45;
const swap = (index: number, fingerPrint: number, result: number): number[] =>
  [...int(index), ...int(fingerPrint), op(StkOp.SWAP_CHARACTER), globalStore(result)];
const names = (game: Game): string => game.ctx.party.state.champions.map((c) => c.name).join(' ');
const positions = (game: Game): string => game.ctx.party.state.champions.map((c) => c.partyPosition).join(' ');
const inWings = (game: Game, fp: number): Champion | null => {
  const bytes = getFromWings(game.ctx.dungeon, fp, true);
  return bytes && readCsbwinCharacter(bytes, 0).champion;
};
/** A copy of champion `chIdx`, named `name`, with the fingerprint `FP`, put in the wings. */
function wingsCopy(game: Game, chIdx: number, name: string): void {
  const champion: Champion = { ...game.ctx.party.state.champions[chIdx]!, name, fingerprint: FP };
  const bytes = new Uint8Array(CHARDESC_SIZE);
  writeCsbwinCharacter(bytes, 0, champion, { load: (c) => game.systems.characterStats.characterLoad(c) });
  saveToWings(game.ctx.dungeon, bytes);
}

const base = freshGame();
const party0 = base.ctx.party.state;
console.log(`csbgame7.dat: ${party0.champions.map((c) => `${c.name} ${c.fingerprint.toString(16)} corner ${c.partyPosition}`).join(', ')}`);
console.log(`  cursor ${party0.cursorOwner}, caster ${party0.magicCasterIndex}, d.PartyFootprints[7] ${base.ctx.footprints.getPrint(7).toString(16)}`);
check(names(base) === 'HISSSSA SONJA GOTHMOG WUUF' && positions(base) === '0 1 3 2', 'the party the sections are written for');
check(party0.cursorOwner === 2 && party0.magicCasterIndex === 1, 'GOTHMOG holds the cursor, SONJA the magic tab');
const [SONJA, GOTHMOG] = [0x1cc, 0x211];

/* ---------------------------------------------- 1. the refusals ------------------ */
{
  const { g, game } = run([...swap(-1, FP, 0), ...swap(0, FP, 1), ...swap(7, -1, 2)], (game) => wingsCopy(game, 0, 'NEWBIE'));
  const alone = run(swap(0, -1, 0), (game) => { game.ctx.party.state.champions.length = 1; });
  console.log(`1. add to four ${g[0]}, swap for one in the wings ${g[1]}, index 7 alone ${g[2]}, delete the last ${alone.g[0]}`);
  check(g[0] === 3, 'an add to a full party is 3');
  check(g[1] === 0 && names(game) === 'NEWBIE SONJA GOTHMOG WUUF', 'a fingerprint in the wings is no refusal');
  const nobody = run(swap(0, FP, 0));
  check(nobody.g[0] === 4, 'a fingerprint not in the wings is 4');
  check(g[2] === 0, 'an index outside the party and no fingerprint is 0');
  check(alone.g[0] === 2 && names(alone.game) === 'HISSSSA', 'the last champion is not deleted: 2');
  check(names(nobody.game) === names(base) && positions(nobody.game) === positions(base), 'and nothing changed');
}

/* ---------------------------------------------- 2. CharacterDelete -------------- */
{
  const hidden: number[] = [];
  const { g, game } = run(swap(1, -1, 0), (game) => {
    game.ctx.party.state.facing = 1;
    game.ctx.party.state.selectedCharacterIndex = 3;
  });
  const party = game.ctx.party.state;
  const gone = inWings(game, SONJA);
  const vacant = party.vacantCharacters[3]!;
  const copy = vacant instanceof Uint8Array ? readCsbwinCharacter(vacant, 0).champion : null;
  console.log(`2. delete SONJA: ${g[0]}, party ${names(game)}, cursor ${party.cursorOwner}, caster ${party.magicCasterIndex}, inventory ${party.selectedCharacterIndex}`);
  console.log(`   in the wings: ${gone?.name} facing ${gone?.facing} HP ${gone?.attributes.health}; slot 3: ${copy?.name} HP ${copy?.attributes.health}`);
  check(g[0] === 0 && names(game) === 'HISSSSA GOTHMOG WUUF', 'SONJA leaves, the others a slot down');
  check(gone !== null && gone.facing === 1 && gone.attributes.health === 328, 'SONJA is in the wings, facing the party\'s way');
  check(party.cursorOwner === 1, "GOTHMOG's cursor moves down with him");
  check(party.selectedCharacterIndex === 2, "WUUF's open inventory moves down with him");
  check(party.magicCasterIndex === 0, 'the magic tab goes to the first living champion');
  const wuuf = party.champions[2]!;
  check(copy !== null && copy.name === 'WUUF' && copy.attributes.health === 0
    && copy.possessions.join() === wuuf.possessions.join() && wuuf.attributes.health === 155,
    'slot 3 keeps a copy of WUUF, possessions and all, with HP 0, and WUUF lives');

  // Their own inventory open, with the eye held: let go, and closed.
  const own = run(swap(3, -1, 0), (game) => {
    game.ctx.party.state.selectedCharacterIndex = 3;
    game.ctx.host.releaseEyeOrMouth = () => hidden.push(-1);
    game.ctx.host.showHideInventory = (chIdx) => {
      hidden.push(chIdx);
      if (chIdx === 4) game.ctx.party.state.selectedCharacterIndex = -1;
    };
  });
  check(hidden.join() === '-1,4' && own.game.ctx.party.state.selectedCharacterIndex === -1,
    'a champion whose inventory is open lets the eye go and closes it');
  check(names(own.game) === 'HISSSSA SONJA GOTHMOG', 'the last champion leaves, nobody moves');
}

/* ---------------------------------------------- 3. CharacterAdd ----------------- */
{
  const { g, game } = run([...swap(1, -1, 0), ...swap(1, -1, 1), ...swap(-1, SONJA, 2)]);
  const party = game.ctx.party.state;
  const back = party.champions[2]!;
  console.log(`3. delete SONJA, then GOTHMOG, add SONJA: ${g.slice(0, 3).join(' ')}, party ${names(game)}, corners ${positions(game)}`);
  check(g.slice(0, 3).join() === '0,0,0' && names(game) === 'HISSSSA WUUF SONJA', 'SONJA comes back after the last');
  check(back.partyPosition === 3, 'into corner 3: corner 1 is free, but her own record holds it');
  check(back.facing === 0, 'facing 0');
  check(inWings(game, SONJA) === null && inWings(game, GOTHMOG) !== null, 'she leaves the wings, GOTHMOG stays');
  const slot = party.vacantCharacters[2]!;
  check(slot instanceof Uint8Array && slot.every((b) => b === 0), 'her slot keeps no copy');
  check(party.cursorOwner === 0, "the cursor stays with HISSSSA, who took it from GOTHMOG");
}

/* ---------------------------------------------- 4. CharacterSwap ---------------- */
{
  const prepare = (high: number) => (game: Game): void => {
    wingsCopy(game, 0, 'NEWBIE');
    game.ctx.party.state.champions[2]!.facing = 2;
    const trail = game.ctx.footprints.capture();
    trail.prints[7] = (high << 8) | (trail.prints[7]! & 0xff);
    game.ctx.footprints.restore(trail);
  };
  const { g, game } = run(swap(2, FP, 0), prepare(0x1b));
  const party = game.ctx.party.state;
  const comer = party.champions[2]!;
  const gone = inWings(game, GOTHMOG);
  console.log(`4. swap GOTHMOG for NEWBIE: ${g[0]}, party ${names(game)}, corners ${positions(game)}, facing ${comer.facing}, cursor ${party.cursorOwner}`);
  check(g[0] === 0 && names(game) === 'HISSSSA SONJA NEWBIE WUUF', 'NEWBIE takes GOTHMOG\'s slot');
  check(comer.partyPosition === 3 && comer.facing === 2, "into the free corner, with GOTHMOG's facing");
  check(gone !== null && gone.facing === 0, "GOTHMOG is in the wings, facing the party's way");
  check(inWings(game, FP) === null, 'NEWBIE has left the wings');
  check(party.cursorOwner === 0, "GOTHMOG's cursor goes to the first living champion");

  const five = run(swap(2, FP, 0), prepare(3));
  console.log(`   with d.PartyFootprints[7] ${five.game.ctx.footprints.getPrint(7).toString(16)}: corners ${positions(five.game)}`);
  check(five.game.ctx.party.state.champions[2]!.partyPosition === 5,
    "corner 5 when d.CH16482[4].charPosition, the footprint's high byte, is the free corner");
}

/* ---------------------------------------------- 5. the damage shown, the poison - */
{
  const redrawn: number[] = [];
  let timer = -1;
  const { g, game } = run(swap(3, -1, 0), (game) => {
    game.ctx.host.tag011366 = (chIdx) => redrawn.push(chIdx);
    game.ctx.party.state.pendingDamage[3] = 10;
    game.systems.monsterAttack.displayCharacterDamage();
    timer = game.ctx.party.state.champions[3]!.timerIndex;
    game.systems.monsterAttack.poisonCharacter(3, 20);
  });
  const gone = inWings(game, 0x18d);
  console.log(`5. WUUF with the damage shown (timer ${timer}) and poisoned leaves: ${g[0]}, record timer ${gone?.timerIndex}, poison ${gone?.poisonCount}`);
  check(timer !== -1 && game.ctx.timers.getTimer(timer) === null, 'the TT_12 is deleted');
  check(redrawn.join() === '3' && gone?.timerIndex === -1, 'TAG011366 ran, and the record holds no timer');
  check(gone?.poisonCount === 0, 'the poison is cured');

  let died = '';
  try {
    run(swap(1, -1, 0), (game) => {
      game.ctx.party.state.pendingDamage[3] = 10;
      game.systems.monsterAttack.displayCharacterDamage();
    });
  } catch (error) {
    died = (error as Error).message;
  }
  console.log(`   SONJA leaves while WUUF's is shown: ${died}`);
  check(died.startsWith('die(0x452a)'), 'a champion moved down with a TT_12 is CSBWin\'s die(0x452a)');
}

/* ---------------------------------------------- 6. the portrait ----------------- */
{
  const pixels = Array.from({ length: 32 * 29 }, (_, i) => (i * 7) & 15);
  const { game } = run(swap(1, -1, 0), (game) => {
    const sonja = game.ctx.party.state.champions[1]!;
    sonja.portrait = undefined;
    sonja.portraitGraphic = 5;
    game.ctx.host.portraitOf = (c) => c.portraitGraphic === 5 ? pixels : undefined;
  });
  const gone = inWings(game, SONJA);
  check(gone?.portrait?.join() === pixels.join(), "a champion with only portraitGraphic goes to the wings with the host's pixels");
}

/* ---------------------------------------------- 7. a save carries it ------------ */
{
  // `run`'s test DSA is a record the database header does not count, which a save refuses.
  const game = freshGame();
  swapCharacter(game.ctx, 1, -1);
  const next = freshGame();
  applyCsbwinSave(next, buildSaveFile(game));
  const slot = next.ctx.party.state.vacantCharacters[3]!;
  const was = game.ctx.party.state.vacantCharacters[3] as Uint8Array;
  console.log(`7. saved and read back: party ${names(next)}`);
  check(names(next) === 'HISSSSA GOTHMOG WUUF', 'the party of three');
  check(slot instanceof Uint8Array && slot.every((b, i) => b === was[i]), 'the slot past it, byte for byte');
  check(inWings(next, SONJA)?.name === 'SONJA', 'and SONJA in the wings');
}

finish();
