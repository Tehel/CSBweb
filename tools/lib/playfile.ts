/**
 * CSBWin's `playfile.log` read as `PLAYFILE::Play` reads it
 * (doc/CSBwin-src/Recording.cpp:226-477): the `#` options, and every entry decoded to its
 * absolute form, `time x y num random`, through the three tables its compressed lines
 * index (`tableXYF`, `tableTXYF`, `tableTXYFR`, `:443-477`). `random` is `d.RandomNumber`
 * or the draws since the entry before, as the line holds it. What `tools/play-csbwin-log.ts`
 * plays (`DEBT.md` F24).
 */
import { readFileSync } from 'node:fs';

/** A `#` line that names an option (`#DMRules`, `#FastVBL4`, …). */
export interface PlayLine { kind: 'option'; option: string }
/** An entry, its `line` in the file. */
export interface PlayEntry { time: number; x: number; y: number; num: number; ran: number; line: number }

/** The file at `path`: its version line and its items in order. */
export function readPlayfile(path: string): { version: string; items: (PlayEntry | PlayLine)[] } {
  const text = readFileSync(path, 'latin1').split(/\r?\n/);
  const version = text[0]!.slice(1).trimEnd();
  const xyf: number[][] = [], txyf: number[][] = [], txyfr: number[][] = [];
  let oldTime = 0;
  const items: (PlayEntry | PlayLine)[] = [];
  const hex = (s: string) => parseInt(s, 16) >>> 0;
  for (let i = 1; i < text.length; i++) {
    const line = text[i]!;
    if (line === '') continue;
    if (line[0] === '#') { const m = /^#[^ /]*/.exec(line)![0]; if (m.length > 1 && /^#[A-Za-z]/.test(m)) items.push({ kind: 'option', option: m }); continue; }
    let time: number, x: number, y: number, num: number, ran: number;
    if (line[0] === '+') {
      const f = line.slice(1).trim().split(/\s+/).map(hex);
      if (f.length !== 5) throw new Error(`plus line ${i + 1}`);
      time = oldTime + f[0]!; x = f[1]!; y = f[2]!; num = f[3]!; ran = f[4]!;
      xyf.push([x, y, num]);
    } else {
      // sscanf("%08x %04x %04x %04x %08x"): each field at most its width of hex digits
      const fields: number[] = [];
      let p = 0; const widths = [8, 4, 4, 4, 8];
      for (const w of widths) {
        while (p < line.length && /\s/.test(line[p]!)) p++;
        const m = new RegExp(`^[0-9a-fA-F]{1,${w}}`).exec(line.slice(p));
        if (!m) break;
        fields.push(hex(m[0])); p += m[0].length;
      }
      switch (fields.length) {
        case 1: { const [a, r] = txyfr[fields[0]!]!; const [dt, k] = txyf[a!]!; [x, y, num] = xyf[k!]! as [number, number, number]; ran = r!; time = oldTime + dt!; break; }
        case 2: { const [dt, k] = txyf[fields[0]!]!; [x, y, num] = xyf[k!]! as [number, number, number]; ran = fields[1]!; txyfr.push([fields[0]!, ran]); time = oldTime + dt!; break; }
        case 3: { const dt = fields[0]!; ran = fields[2]!; [x, y, num] = xyf[fields[1]!]! as [number, number, number]; txyf.push([dt, fields[1]!]); time = oldTime + dt; break; }
        case 5: [time, x, y, num, ran] = fields as [number, number, number, number, number]; break;
        default: throw new Error(`improper line ${i + 1}: ${line}`);
      }
    }
    items.push({ time, x, y, num, ran, line: i + 1 });
    oldTime = time; // PLAYFILE sets m_oldTime when the entry is taken; every entry is taken in order
  }
  return { version, items };
}
