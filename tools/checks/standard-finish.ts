/**
 * `Standard_Finish`'s smelling distance against the turn's own `attackDistance`.
 *
 * `InitialChecks` starts `attackDistance` at 24 (`doc/CSBwin-src/Monster.cpp:2872`), and
 * every `attackDistance = Blocked(…)` of the turn overwrites it (`:2188`, `:3850`, `:4185`,
 * `:4271`): 0 when no member sees the party. `Standard_Finish` turns the group towards a
 * random direction unless that distance is beyond the monster's smelling distance
 * (`:1792`). So a calm group (fear 0) that sees nothing, smells nothing and loses the coin
 * toss (`:4392`) reaches `Standard_Finish` with 0, and turns, whatever `STRandom0_3()`
 * draws (`:1774`): `SF_TurnMonstersAsGroup`, never `SF_greaterThanSmellingDistance`.
 * Kept at 24, a draw other than 0 would end the turn there instead, without the turn's
 * draws, which is where every CSBWin `playfile.log` parted from the port at level 1's
 * first round (`DEBT.md` F24).
 *
 * Level 1's groups are loaded with the party on its stairs and take their first turn,
 * under twenty seeds; each turn's record is read at the post-move filter.
 *
 * Run: `npm test -- --only=standard-finish.ts`
 */
import { Position } from '../../src/core/types';
import { MonsterEvents, type MmRecord } from '../../src/engine/MmRecord';
import { newGame, processTimersAt, stockDungeon, stockGraphics } from '../lib/game';
import { wrapMember } from '../lib/standIn';
import { check, finish } from '../lib/check';

interface Turn { at: string; attackDistance: number | null; mmr: MmRecord | null }

let calm = 0, turned = 0, beyondSmell = 0;
for (let seed = 1; seed <= 20; seed++) {
  const turns: Turn[] = [];
  const game = newGame(stockDungeon(), stockGraphics(), {
    trace: (line) => {
      const start = /^MonsterAI \[\w+\] \d+\((\d+,\d+)\)/.exec(line);
      if (start) turns.push({ at: start[1]!, attackDistance: null, mmr: null });
      const seen = /fearFactor is 0, 2, or 3\. {2}attackDistance=(\d+)/.exec(line);
      if (seen && turns.length) turns.at(-1)!.attackDistance = Number(seen[1]);
    },
  });
  wrapMember(game.systems.dsa.filters, 'postMonsterMoveFilter', (inner) => (mmr) => {
    if (turns.length) turns.at(-1)!.mmr = mmr;
    inner(mmr);
  });
  game.setRandomSeed(seed * 0x9e3779b1);
  game.ctx.party.state.position = new Position(3, 1, 1);
  game.systems.monsters.loadPartyLevel(1);
  processTimersAt(game, game.ctx.state.tickCount + 1);

  for (const t of turns) {
    if (t.attackDistance !== 0 || !t.mmr?.getflg(MonsterEvents.PIAF_standardFinish)) continue;
    calm++;
    if (t.mmr.getflg(MonsterEvents.SF_TurnMonstersAsGroup)) turned++;
    if (t.mmr.getflg(MonsterEvents.SF_greaterThanSmellingDistance)) {
      beyondSmell++;
      if (beyondSmell <= 3) console.log(`  seed ${seed}: the group at (${t.at}) saw nothing, and ended beyond its smelling distance`);
    }
  }
}

console.log(`level 1's first round, twenty seeds: ${calm} turns reached Standard_Finish after Blocked answered 0;`);
console.log(`  ${turned} turned the group, ${beyondSmell} ended beyond the smelling distance`);
check(calm > 20, 'level 1\'s calm groups reach Standard_Finish with Blocked\'s 0');
check(beyondSmell === 0, 'a turn that saw nothing is never beyond its smelling distance: attackDistance is Blocked\'s 0, not 24');
check(turned === calm, 'every one of them turns the group (Turn_Monsters_As_Group)');

finish();
