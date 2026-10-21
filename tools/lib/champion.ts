/**
 * A champion for a tool's party, built as `AddCharacter` builds one: the record cleared
 * and its constants stored (`addCharacterDefaults`), then the fields a hero text would
 * give it, here a sturdy test hero's.
 *
 * Usage:
 *
 *   game.systems.hallOfChampions.addChampion(testChampion(i));
 *   testChampion(0, { name: 'VICTIM', attributes: { mana: 0, maxMana: 0 } });
 */
import { addCharacterDefaults } from '../../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../../src/engine/attributes';
import { emptyPossessions } from '../../src/core/charDesc';
import type { Champion, ChampionAttributes } from '../../src/engine/gameTypes';

/** The test hero's `Attributes[7]`, in `AttributeIndex` order: Luck first. */
export const TEST_STATS: readonly number[] = [60, 60, 50, 50, 50, 20, 20];

/** What a tool changes in the test hero: any field, and any of the attributes alone. */
export type TestChampionFields = Partial<Omit<Champion, 'attributes'>> & { attributes?: Partial<ChampionAttributes> };

/**
 * The test hero at `partyPosition`, named `HERO<partyPosition>`: 200 HP, 100 stamina,
 * 50 mana, `TEST_STATS`, 1500 food and water, no skill and nothing carried. `fields`
 * replaces any of it.
 */
export function testChampion(partyPosition: number, fields: TestChampionFields = {}): Champion {
  const { attributes, ...rest } = fields;
  return {
    ...addCharacterDefaults(),
    name: `HERO${partyPosition}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes(TEST_STATS),
      ...attributes,
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition,
    ...rest,
  };
}
