/**
 * The FLIP attack's message (`doc/CSBwin-src/Attack.cpp:1915-1925`): "IT COMES UP HEADS"
 * or "TAILS" through `PrintWithSubstitution(…, 4, true)`, so one print-queue entry, its
 * linefeed first, in colour 4 (`Graphics.cpp:1564-1620`). The print queue gives one entry
 * a pass, so a linefeed queued on its own would show the text a pass later. The
 * translation is `DEBT.md` G21's.
 *
 * Run: `npm test -- --only=dump-flip.ts`
 */
import { AttackType } from '../src/engine/monsterTypes';
import { freshGame } from './lib/dsa';
import { check, finish } from './lib/check';

const seen = new Set<string>();
for (let seed = 1; seed <= 8; seed++) {
  const game = freshGame();
  game.setRandomSeed(seed * 0x1234567);
  const queued: Array<{ color: number; text: string }> = [];
  game.ctx.host.messages.printLinefeed = () => { queued.push({ color: 0, text: '\n' }); };
  game.ctx.host.messages.quePrintLines = (color, text) => { queued.push({ color, text }); };
  game.systems.attack.attack(1, AttackType.atk_FLIP);
  console.log(`seed ${seed}: ${queued.map((q) => `${q.color}:${JSON.stringify(q.text)}`).join(' ')}`);
  check(queued.length === 1 && queued[0]!.color === 4 && /^\nIT COMES UP (HEADS|TAILS)$/.test(queued[0]!.text),
    `seed ${seed}: one entry, colour 4, its linefeed first`);
  seen.add(queued[0]?.text ?? '');
}
check(seen.size === 2, 'both faces come up');

finish();
