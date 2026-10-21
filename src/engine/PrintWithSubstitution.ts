/**
 * `PrintWithSubstitution` (`doc/CSBwin-src/Graphics.cpp:1564-1620`), `TAG01ab88`: a text
 * queued as one print-queue entry, a linefeed first, with its `@` escapes replaced.
 *
 * `@p` is the name of the champion whose attack menu is open (`d.AttackingCharacterOrdinal`)
 * and `@N` a linefeed; anything else after `@` is "HUH???". Each is set off by a space
 * before it, unless it starts a line, and one after it. The replacement is a pointer
 * that each one copies to its end: `@N` copies whatever it was left at, which before any
 * other escape is "HUH???" and after one is nothing. A text that comes out empty queues
 * nothing (`:1616-1619`).
 */
import { sw } from '../core/intCast';
import type { GameContext } from './GameContext';

const HUH = 'HUH???';

export function printWithSubstitution(ctx: GameContext, txt: string, color: number): void {
  let out = '\n';
  // `p_4`: the replacement, and how far the last escape has copied of it.
  let p4 = HUH;
  let p4At = 0;
  for (let a3 = 0; a3 < txt.length; a3++) {
    if (txt[a3] !== '@') {
      out += txt[a3];
      continue;
    }
    a3++;
    if (!out.endsWith('\n')) out += ' ';
    switch (txt[a3]) {
      case 'p': {
        // `d.CH16482[d.AttackingCharacterOrdinal-1].name`. With no menu open CSBWin reads
        // the record before the first champion; the port reads no name.
        const ordinal = ctx.interface.attackingCharacterOrdinal;
        p4 = ctx.party.state.champions[ordinal - 1]?.name.slice(0, 8) ?? '';
        p4At = 0;
        break;
      }
      case 'N':
        out += '\n';
        break;
      default:
        // `NotImplemented(0x1abde)`.
        ctx.host.trace(`PrintWithSubstitution: unknown escape @${txt[a3] ?? ''}`);
        p4 = HUH;
        p4At = 0;
    }
    out += p4.slice(p4At);
    p4At = p4.length;
    out += ' ';
    // An `@` at the end has read the terminator: the copy stops there.
    if (a3 >= txt.length) break;
  }
  if (out.length > 1) ctx.host.messages.quePrintLines(sw(color), out);
}
