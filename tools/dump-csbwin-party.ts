/**
 * Prove the champions inside a genuine CSBWin save unpack correctly.
 *
 * `dump-csbwin-save.ts` reads names out of block 4 — eight bytes at a known offset,
 * which proves the block was *located*. This tool unpacks the whole `CHARDESC`, and
 * the difference matters: a name is legible even when the record is a hundred bytes
 * out of place, because a name is mostly what surrounds it. Hit points, skills,
 * attribute triples and thirty possession RNs are not.
 *
 * What makes it evidence rather than a printout is that almost every field can be
 * checked against something other than itself:
 *
 * - health/stamina/mana must not exceed their own maxima;
 * - the seven attribute triples must satisfy minimum <= current <= maximum;
 * - every non-empty possession RN must point at a **live** record in a database a
 *   champion can actually carry from — the strongest check here, and the one that was
 *   failing until the object indirect index was ported: a possession slot holds a slot
 *   number in that index, not a packed RN (`src/data/CsbwinObjectIndex.ts`), and read
 *   as a packed RN it decodes to doors and teleporters with impossible indices;
 * - the champions found must be exactly `gb2.numcharacter` of them.
 *
 * Run: `npx tsx tools/dump-csbwin-party.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';

import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { readCsbwinParty, readCsbwinPartyTail, isMale } from '../src/data/CsbwinCharacters';
import { OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import type { RnMaps } from '../src/core/RnMaps';
import type { DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const DB_OF_CATEGORY: Record<number, keyof DungeonData['databases']> = {
  0: 'doors', 1: 'teleporters', 2: 'texts', 3: 'actuators', 4: 'creatures',
  5: 'weapons', 6: 'clothing', 7: 'scrolls', 8: 'potions', 9: 'containers',
  10: 'misc', 14: 'missiles', 15: 'clouds',
};

/**
 * The six databases a champion can hold an object from. CSBWin has no list of its own —
 * it does not need one, because nothing ever puts a door in a hand — so this is the set
 * `RN::DescIndex` will answer for (`doc/CSBwin-src/data.cpp:566-598`): scroll, chest,
 * misc, weapon, clothing, potion. Everything else returns -1, "not an object".
 */
const CARRYABLE = new Set([5, 6, 7, 8, 9, 10]);

/** A compact, readable line: which slots are full, and with what. */
function describePossessions(rnMaps: RnMaps, slots: readonly ObjectID[]): string {
  const parts: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const rn = slots[i]!;
    if (rn === OBJECT_ID_NULL) continue;
    const { category, index } = rnMaps.decode(rn);
    const key = DB_OF_CATEGORY[category];
    parts.push(`${i}:${key ?? `db${category}`}[${index}]`);
  }
  return parts.length > 0 ? parts.join(' ') : '(none)';
}

function main(): void {
  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    let world;
    try {
      world = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
    } catch (error) {
      check(false, `${name}: should load — ${(error as Error).message}`);
      continue;
    }
    const block = world.save.characterBlock;
    const gb2 = world.save.block2;
    if (!block || !gb2) {
      check(false, `${name}: block 4 and GAMEBLOCK2 should both be present`);
      continue;
    }

    const party = readCsbwinParty(block, gb2.numCharacter, world.save.objectIndex);
    const tail = readCsbwinPartyTail(block);
    console.log(`\n${name} — ${party.length} champions, level ${gb2.partyLevel}`);
    check(
      party.length === gb2.numCharacter,
      `${name}: ${party.length} occupied slots, GAMEBLOCK2 says ${gb2.numCharacter}`,
    );

    for (const { champion: c, charFlags } of party) {
      const a = c.attributes;
      console.log(`  ${c.name}${c.title ? ` — ${c.title}` : ''} (${isMale(charFlags) ? 'M' : 'F'})`);
      console.log(`    hp ${a.health}/${a.maxHealth}  sta ${a.stamina}/${a.maxStamina}  ` +
        `mana ${a.mana}/${a.maxMana}  food ${c.food} water ${c.water}`);
      console.log(`    stats ${a.stats.map((s) => `${s.current}/${s.maximum}`).join(' ')}`);
      const carried = c.possessions.filter((p) => p !== OBJECT_ID_NULL).length;
      const topSkills = c.skills.slice(0, 4).map((s) => s.experience).join(',');
      console.log(`    carrying ${carried} objects, class experience ${topSkills}`);
      console.log(`    slots ${describePossessions(world.dungeon.rnMaps, c.possessions)}`);

      // Self-consistency. A misread record fails these long before it looks plausible.
      check(a.maxHealth > 0, `${name}/${c.name}: has a maximum health`);
      check(a.health <= a.maxHealth, `${name}/${c.name}: health within maximum`);
      check(a.stamina <= a.maxStamina, `${name}/${c.name}: stamina within maximum`);
      check(a.mana <= a.maxMana, `${name}/${c.name}: mana within maximum`);
      check(
        a.stats.length === 7 && a.stats.every((s) => s.minimum <= s.current && s.current <= s.maximum),
        `${name}/${c.name}: seven attribute triples, each minimum <= current <= maximum`,
      );
      check(c.skills.length === 20, `${name}/${c.name}: twenty skill records`);
      check(
        c.skills.every((s) => s.experience >= 0),
        `${name}/${c.name}: no skill has negative experience`,
      );
      check((c.possessions ?? []).length === 30, `${name}/${c.name}: thirty possession slots`);

      // Name and title are C strings and stop at their terminator, as `TextToViewport`
      // does (`doc/CSBwin-src/Character.cpp:1324,1338`). Several genuine saves hold a
      // title whose first byte is a NUL — a champion reincarnated with the name retyped
      // and the title left empty, where `_ReIncarnate` clears only `title[0]` and the
      // old title's tail shows through (`doc/PROVEN_FACTS.md` → "A champion's title can
      // lose its first character"). CSBWin prints nothing for those, and reading on past
      // the NUL — which this reader used to do — would show a title the real game hides.
      check(!c.name.includes('\u0000'), `${name}/${c.name}: the name stops at its terminator`);
      check(!c.title.includes('\u0000'), `${name}/${c.name}: the title stops at its terminator`);

      // The cross-check the whole tool exists for, and the one that used to be
      // reported-but-not-asserted because the encoding was not understood.
      //
      // Every non-empty slot must name a **live** record — `nextObject != RNnul`,
      // CSBWin's own free-record marker (`DeleteDBEntry`,
      // `doc/CSBwin-src/data.cpp:993-1015`) — in one of the six databases a champion
      // can hold an object from. Categories 0-4 are doors, teleporters, texts,
      // actuators and monsters: none of them is carryable, and a wrongly-decoded
      // reference lands in them immediately, because they are the low-numbered
      // databases a slot number's low bits fall into.
      const bad: string[] = [];
      for (const rn of c.possessions) {
        if (rn === OBJECT_ID_NULL) continue;
        const { category, index } = world.dungeon.rnMaps.decode(rn);
        const key = DB_OF_CATEGORY[category];
        if (!key || !CARRYABLE.has(category)) { bad.push(`cat ${category}`); continue; }
        const records = world.dungeon.databases[key].records;
        if (index >= records.length) { bad.push(`${key}[${index}] past end`); continue; }
        if (records[index].nextObject === OBJECT_ID_NULL) bad.push(`${key}[${index}] is free`);
      }
      check(
        bad.length === 0,
        `${name}/${c.name}: every possession names a live carryable record` +
          (bad.length > 0 ? ` — ${bad.slice(0, 4).join(', ')}` : ''),
      );
    }

    console.log(`  party: brightness=${tail.brightness} shield=${tail.partyShield} ` +
      `fire=${tail.fireShield} spell=${tail.spellShield} footprints=${tail.numFootprintEnt}`);
    check(tail.footprints.length === 24, `${name}: twenty-four footprint entries`);
    check(
      tail.numFootprintEnt <= 24,
      `${name}: the footprint count is within the ring (${tail.numFootprintEnt})`,
    );
  }

  finish();
}

main();
