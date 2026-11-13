/**
 * An achievements file read (`doc/ACHIEVEMENTS.md` → "The file"): a set's
 * `achievements.txt`, or the common file every set has. Not CSBWin's: achievements are the
 * site's, and only watch the game.
 *
 * `readAchievementFile` reads one file into its blocks, each condition parsed and checked
 * against the vocabulary (the events, their attributes, the facts and the samples), and
 * says whether it needs the whole game (`needsWholeGame`). A file with any error is refused
 * whole, each error naming its line. `mergeAchievements` lays a set's file over the common
 * one and puts the set's values in the places that name them, `unknownItems` lists the
 * names a set's objects do not have, and `unusedValues` the values no achievement names.
 * `withCounts` puts the counts a set's files give (`DataCounts`) in the places that read
 * them, which the tracker does, since only it has the files.
 */
import { ACHIEVEMENTS_FILE_BYTES } from '../../data/DataSets';

/** The first line of every file: the format and its version. */
export const ACHIEVEMENTS_HEADER = '# CSBweb achievements 1';

/** The limits of a file and of its texts. */
export const ACHIEVEMENT_LIMITS = {
  bytes: ACHIEVEMENTS_FILE_BYTES,
  achievements: 200,
  id: 40,
  value: 40,
  name: 32,
  text: 160,
} as const;

export const TIERS = ['easy', 'silly', 'weird', 'hard'] as const;
export type Tier = (typeof TIERS)[number];

/** What an attribute's values are: one of a few words, yes or no, a name, or a whole number. */
type AttributeKind = { kind: 'enum'; values: readonly string[] } | { kind: 'yesno' } | { kind: 'name' } | { kind: 'number' };

const NAME: AttributeKind = { kind: 'name' };
const YESNO: AttributeKind = { kind: 'yesno' };
const NUMBER: AttributeKind = { kind: 'number' };
const enumOf = (...values: string[]): AttributeKind => ({ kind: 'enum', values });

/** A champion's damage, and their death, by what caused it. */
const DAMAGE_CAUSES = enumOf(
  'monster', 'missile', 'explosion', 'cloud', 'door', 'pit', 'wall',
  'poison', 'starvation', 'thirst', 'fatigue', 'potion',
);

/** What hit or killed a monster. */
const BLOWS = enumOf('melee', 'spell', 'throw', 'explosion', 'cloud', 'door', 'pit', 'fusion', 'landing');

/** The `item` of a melee blow struck with an empty hand. */
export const EMPTY_HAND = 'HAND';
/** The `item` drunk at a fountain. */
export const FOUNTAIN = 'FOUNTAIN';

/** The events and their attributes (`doc/ACHIEVEMENTS.md` → "The events"). */
export const EVENTS = {
  kill: { monster: NAME, by: BLOWS, item: NAME, champion: NAME, party: YESNO, group: NUMBER, thief: YESNO },
  hit: { monster: NAME, by: BLOWS, item: NAME, champion: NAME, party: YESNO, damage: NUMBER },
  hurt: { champion: NAME, by: DAMAGE_CAUSES, party: YESNO },
  death: { champion: NAME, cause: DAMAGE_CAUSES, party: YESNO },
  eat: { champion: NAME, item: NAME },
  drink: { champion: NAME, item: NAME },
  cast: {
    champion: NAME,
    spell: NAME,
    power: enumOf('LO', 'UM', 'ON', 'EE', 'PAL', 'MON'),
    ok: YESNO,
    why: enumOf('meaningless', 'practice', 'flask'),
  },
  wear: { champion: NAME, slot: enumOf('head', 'neck', 'torso', 'legs', 'feet'), item: NAME },
  join: { champion: NAME, how: enumOf('resurrect', 'reincarnate') },
  revive: { champion: NAME, times: NUMBER },
  raise: { champion: NAME, from: enumOf('prison', 'dm', 'imported') },
  enter: { level: NUMBER },
  leave: { level: NUMBER, cleared: YESNO },
  theft: { champion: NAME, item: NAME, monster: NAME },
  swap: { item: NAME, took: NAME },
  trigger: { level: NUMBER, x: NUMBER, y: NUMBER, item: NAME },
  sleep: {},
  oracle: {},
  load: {},
} as const satisfies Record<string, Record<string, AttributeKind>>;
export type EventKind = keyof typeof EVENTS;

/**
 * The samples, read at the end of each tick: the party's champions, those alive, the coins
 * carried, and where the party stands, its level, from 0, and its square's column and row.
 */
export const SAMPLES = ['party', 'alive', 'coins', 'level', 'x', 'y'] as const;
export type SampleName = (typeof SAMPLES)[number];

/**
 * A champion's attributes at a tick's end, which `party(where …)` filters the party's
 * champions by (`doc/ACHIEVEMENTS.md` → "The champions"): what each worn place and each
 * hand holds, the rank in each class, 0 to 15, the load, in percent of the most the
 * champion can carry, and the portrait, the cell of the set's champions' sheet, graphic 26,
 * the champion wears, where it is one.
 */
export const CHAMPION_ATTRIBUTES = {
  champion: NAME,
  sex: enumOf('male', 'female'),
  alive: YESNO,
  head: NAME,
  neck: NAME,
  torso: NAME,
  legs: NAME,
  feet: NAME,
  ready: NAME,
  action: NAME,
  fighter: NUMBER,
  ninja: NUMBER,
  priest: NUMBER,
  wizard: NUMBER,
  load: NUMBER,
  portrait: NUMBER,
} as const satisfies Record<string, AttributeKind>;

/** The attributes that name an object, which `unknownItems` checks: an event's and a champion's. */
const ITEM_ATTRIBUTES: ReadonlySet<string> = new Set(['item', 'took', 'head', 'neck', 'torso', 'legs', 'feet', 'ready', 'action']);

/** The `item`s that are no object, and no set's objects need to have. */
const NOT_OBJECTS: ReadonlySet<string> = new Set([EMPTY_HAND, FOUNTAIN]);

/**
 * The counts of the set's own files (`DataCounts`, `dataCounts`), which a condition reads by
 * name, as it reads a fact.
 */
export const DATA_COUNTS = ['spells', 'foods', 'monsterTypes', 'levels'] as const;
export type DataCountName = (typeof DATA_COUNTS)[number];
export type DataCounts = Readonly<Record<DataCountName, number>>;

/** The facts about the game, and what each is. */
const FACTS = {
  won: 'bool',
  lost: 'bool',
  ended: 'bool',
  gameTime: 'num',
  playTime: 'seconds',
  explored: 'num',
} as const;
export type FactName = keyof typeof FACTS;

/** What a condition's part is: a yes or no, a number, or a number of seconds. */
type ValueType = 'bool' | 'num' | 'seconds';

/**
 * How far a value read in a game whose history starts at a save can be trusted
 * ("Some conditions need the whole game"): `exact` whatever the history, `low` only ever
 * too small (a count, a `max`, the play time), `high` only ever too large (a `min`).
 */
type Bound = 'exact' | 'low' | 'high';

export type Comparison = '=' | '!=' | '<' | '<=' | '>' | '>=';

/**
 * A filter on an event's attributes, or a champion's, its names upper-cased, its numbers
 * in decimal. Only a number is ordered (`<`, `<=`, `>`, `>=`). An `in` may name a value,
 * `{name}`, for its list: `mergeAchievements` puts the list in its place.
 */
export type Filter =
  | { k: 'cmp'; attr: string; op: Comparison; value: string }
  | { k: 'in'; attr: string; values: readonly string[]; negated: boolean; named?: string }
  | { k: 'like'; attr: string; pattern: string }
  | { k: 'and' | 'or'; a: Filter; b: Filter }
  | { k: 'not'; a: Filter };

/**
 * A sample a condition reads: its name, and for `party`, the filter on the champions it
 * counts, `party(where …)`. `key` is its canonical text, which the state keeps it by.
 */
export interface SampleRef {
  readonly name: SampleName;
  readonly where: Filter | null;
  readonly key: string;
}

/**
 * A value the evaluator keeps over the game: a count of events, the distinct values of an
 * attribute, or a sample's largest or smallest. `key` is its canonical text, which the
 * tracker's saved state keeps it by.
 */
export type Aggregate =
  | { k: 'count'; event: EventKind; where: Filter | null; key: string }
  | { k: 'distinct'; event: EventKind; attr: string; where: Filter | null; key: string }
  | { k: 'max' | 'min'; sample: SampleRef; key: string };

/** A condition, or a part of one. */
export type Expr =
  | { k: 'num'; value: number; type: 'num' | 'seconds' }
  /**
   * A named value, `{name}`, which the set's file defines (`value name = n`): `n` times
   * `scale`, a duration's unit in seconds where one follows it. `mergeAchievements` puts
   * the number in its place, so the evaluator never meets one.
   */
  | { k: 'value'; name: string; type: 'num' | 'seconds'; scale: number }
  | { k: 'fact'; name: FactName }
  /**
   * A count of the set's own files (`DataCounts`), the same in every game of the set:
   * `withCounts` puts the number in its place, so the evaluator never meets one.
   */
  | { k: 'data'; name: DataCountName }
  | { k: 'sample'; sample: SampleRef }
  | { k: 'agg'; agg: Aggregate }
  /** `ever` and `never`: the count compared with 0, kept apart for the bounds. */
  | { k: 'ever' | 'never'; agg: Aggregate }
  /**
   * Across games (`doc/ACHIEVEMENTS.md` → "Across games"): `games(condition)`, the set's
   * playthroughs in which a condition of one game has been yes, and `total(count(…))`,
   * the sum over them of each one's count. The evaluator of one game never meets either:
   * an achievement that reads one is evaluated over the playthroughs' figures (`acrossUnlocked`).
   */
  | { k: 'games'; game: GameCondition }
  | { k: 'total'; agg: Aggregate; key: string }
  /**
   * `distinct(games(condition).attribute)`: the values of a champion's attribute
   * (`CHAMPION_ATTRIBUTES`) among the party's champions as each playthrough met
   * `condition`, distinct over them. `key` is its canonical text.
   */
  | { k: 'gamesParty'; game: GameCondition; attr: string; key: string }
  | { k: 'cmp'; op: Comparison; a: Expr; b: Expr }
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'not'; a: Expr };

/**
 * A condition of one game that `games(…)` counts the playthroughs of: kept in each game's
 * history as an achievement is, by `key`, its canonical text, `games(…)`, the same whichever
 * set's games it counts.
 */
export interface GameCondition {
  readonly key: string;
  /**
   * The family of sets whose games it counts, `games(won, in "dungeon-master")`: each set
   * whose own file declares it (`family:`), or whose id it is where its file declares none
   * (`familyOf`); `null`, this set's games alone.
   */
  readonly of: string | null;
  readonly when: Expr;
  /** Whether it needs the game's whole history (`needsWholeGame`). */
  readonly whole: boolean;
  readonly aggregates: readonly Aggregate[];
}

/** One achievement of a file. */
export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly tier: Tier;
  readonly when: Expr;
  /** Whether the condition needs the game's whole history (`needsWholeGame`). */
  readonly whole: boolean;
  /**
   * The values the condition keeps over the game, each once: for an achievement across
   * games, the counts its `total(…)`s add up.
   */
  readonly aggregates: readonly Aggregate[];
  /** Whether the condition is across games, reading `games(…)` and `total(…)` alone. */
  readonly across: boolean;
  /** The conditions of one game its `games(…)` count, each once. */
  readonly games: readonly GameCondition[];
  /**
   * The named values its condition and its text name, each once. Out of
   * `mergeAchievements` they are in their places already, and this says which were.
   */
  readonly values: readonly string[];
  /** The line its block starts on. */
  readonly line: number;
}

/**
 * A file read: its achievements, the common ones it switches off, and its named values,
 * each a list of one number or more.
 */
export interface AchievementFile {
  readonly defs: readonly AchievementDef[];
  readonly disabled: readonly string[];
  readonly values: ReadonlyMap<string, readonly number[]>;
  /** The family of sets the file declares (`family: name`), `null` for none: its set's id is its family then. */
  readonly family: string | null;
}

export interface AchievementError {
  readonly line: number;
  readonly message: string;
}

export type AchievementRead =
  | { readonly ok: true; readonly file: AchievementFile }
  | { readonly ok: false; readonly errors: readonly AchievementError[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;
/** A family of sets' name, which a file declares (`family: name`) and `games(…, in "name")` names, as a set's id may be. */
const FAMILY_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const FAMILY_LINE = /^family\s*:\s*(.*?)\s*$/;
/** A named value's name, and the same in braces, where a text or a condition names it. */
const VALUE_NAME = '[A-Za-z][A-Za-z0-9]*';
const NAMED_IN_TEXT = new RegExp(`\\{(${VALUE_NAME})\\}`, 'g');
const VALUE_LINE = /^value\s+(\S+)\s*=\s*(\S.*?)\s*$/;
/** The largest number a file may write. */
const MAX_NUMBER = 1e9;

/** Read a file. Every error is listed; a file with any is refused. */
export function readAchievementFile(text: string): AchievementRead {
  const errors: AchievementError[] = [];
  const error = (line: number, message: string): void => { errors.push({ line, message }); };
  if (text.length > ACHIEVEMENT_LIMITS.bytes) {
    return { ok: false, errors: [{ line: 1, message: `the file is over ${ACHIEVEMENT_LIMITS.bytes} bytes` }] };
  }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== ACHIEVEMENTS_HEADER) {
    return { ok: false, errors: [{ line: 1, message: `the first line must be "${ACHIEVEMENTS_HEADER}"` }] };
  }

  interface Block { id: string; line: number; fields: Map<string, { value: string; line: number }>; disabled: boolean }
  const blocks: Block[] = [];
  const values = new Map<string, number[]>();
  let family: string | null = null;
  let block: Block | null = null;
  let last: { value: string; line: number } | null = null;
  for (let i = 1; i < lines.length; i++) {
    const n = i + 1;
    const raw = lines[i] ?? '';
    if (/[^\t\x20-\x7e]/.test(raw)) { error(n, 'only printable ASCII is allowed'); continue; }
    const content = stripComment(raw);
    if (content.trim() === '') continue;
    if (/^[ \t]/.test(content)) {
      if (last === null) { error(n, 'a continued line must follow a field'); continue; }
      last.value += ' ' + content.trim();
      continue;
    }
    last = null;
    if (/^value\b/.test(content)) {
      const v = VALUE_LINE.exec(content);
      const name = v?.[1] ?? '';
      const numbers = (v?.[2] ?? '').split(',').map((x) => x.trim());
      if (v === null) error(n, 'a value is defined as "value name = number", or "value name = number, number, …"');
      else if (block !== null) error(n, 'a value is defined before the first [id]');
      else if (!new RegExp(`^${VALUE_NAME}$`).test(name) || name.length > ACHIEVEMENT_LIMITS.value) {
        error(n, `"${name}" is no value's name: 1 to ${ACHIEVEMENT_LIMITS.value} letters and digits, a letter first`);
      } else if (!numbers.every((x) => /^\d+$/.test(x) && Number(x) <= MAX_NUMBER)) {
        error(n, `a value is a whole number from 0 to ${MAX_NUMBER}, or a list of them, a comma between two`);
      } else if (values.has(name)) error(n, `the value "${name}" is defined twice`);
      else values.set(name, numbers.map(Number));
      continue;
    }
    const familyLine = block === null ? FAMILY_LINE.exec(content) : null;
    if (familyLine) {
      const name = familyLine[1] ?? '';
      if (!FAMILY_NAME.test(name)) error(n, `"${name}" is no family's name: 1 to 40 lowercase letters, digits, dots, hyphens and underscores, a letter or a digit first`);
      else if (family !== null) error(n, 'the family is declared twice');
      else family = name;
      continue;
    }
    const header = /^\[([^\]]*)\]\s*$/.exec(content);
    if (header) {
      const id = header[1] ?? '';
      if (!ID.test(id) || id.length > ACHIEVEMENT_LIMITS.id) {
        error(n, `"${id}" is no id: 1 to ${ACHIEVEMENT_LIMITS.id} lowercase letters, digits and hyphens`);
      } else if (blocks.some(b => b.id === id)) {
        error(n, `the id "${id}" is used twice`);
      }
      block = { id, line: n, fields: new Map(), disabled: false };
      blocks.push(block);
      continue;
    }
    if (block === null) { error(n, 'a field must follow an [id]'); continue; }
    if (content.trim() === 'disabled') { block.disabled = true; continue; }
    const field = /^([a-z]+)\s*:(.*)$/.exec(content);
    if (!field) { error(n, 'expected "name:", "text:", "tier:", "when:" or "disabled"'); continue; }
    const key = field[1] ?? '';
    if (!['name', 'text', 'tier', 'when'].includes(key)) { error(n, `"${key}" is no field`); continue; }
    if (block.fields.has(key)) { error(n, `"${key}" is given twice`); continue; }
    last = { value: (field[2] ?? '').trim(), line: n };
    block.fields.set(key, last);
  }

  const defs: AchievementDef[] = [];
  const disabled: string[] = [];
  for (const b of blocks) {
    if (b.disabled) {
      if (b.fields.size > 0) error(b.line, `"${b.id}" is disabled, and has nothing else`);
      disabled.push(b.id);
      continue;
    }
    const name = b.fields.get('name');
    const desc = b.fields.get('text');
    const tier = b.fields.get('tier');
    const when = b.fields.get('when');
    if (!name || name.value === '') error(b.line, `"${b.id}" needs a name`);
    else if (name.value.length > ACHIEVEMENT_LIMITS.name) error(name.line, `the name is over ${ACHIEVEMENT_LIMITS.name} characters`);
    if (!desc || desc.value === '') error(b.line, `"${b.id}" needs a text`);
    else if (desc.value.length > ACHIEVEMENT_LIMITS.text) error(desc.line, `the text is over ${ACHIEVEMENT_LIMITS.text} characters`);
    else if (/[{}]/.test(desc.value.replace(NAMED_IN_TEXT, ''))) error(desc.line, 'braces in a text hold a value\'s name, as {name}');
    if (tier && !(TIERS as readonly string[]).includes(tier.value)) error(tier.line, `the tier is one of ${TIERS.join(', ')}`);
    if (!when || when.value === '') { error(b.line, `"${b.id}" needs a condition, "when:"`); continue; }
    let expr: Expr;
    try {
      expr = parseCondition(when.value);
    } catch (e) {
      if (!(e instanceof ConditionError)) throw e;
      error(when.line, e.message);
      continue;
    }
    if (!name || !desc) continue;
    const named = new Set([...desc.value.matchAll(NAMED_IN_TEXT)].map((m) => m[1] ?? ''));
    for (const v of valuesOf(expr)) named.add(v);
    const across = isAcross(expr);
    if (across) {
      const local = gameFactOutside(expr);
      if (local !== null) { error(when.line, `a condition across games reads games(…) and total(…), not ${local}`); continue; }
      if (needsWholeGame(expr)) { error(when.line, 'a condition across games asks for at least: a game not counted can only make a figure too small'); continue; }
    }
    defs.push({
      id: b.id,
      name: name.value,
      text: desc.value,
      tier: (tier?.value ?? 'easy') as Tier,
      when: expr,
      whole: !across && needsWholeGame(expr),
      aggregates: aggregatesOf(expr),
      across,
      games: gamesOf(expr),
      values: [...named],
      line: b.line,
    });
  }
  if (defs.length + disabled.length > ACHIEVEMENT_LIMITS.achievements) {
    error(1, `the file holds over ${ACHIEVEMENT_LIMITS.achievements} achievements`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, file: { defs, disabled, values, family } };
}

/**
 * A set's achievements: the common file's, less those the set's file disables, a set's
 * block with a common id in place of the common one, then the set's own. Each named value
 * is put in its places, the set's file's over the common one's; an achievement that names
 * a value neither file defines does not exist in the set.
 */
export function mergeAchievements(common: AchievementFile, own: AchievementFile | null): AchievementDef[] {
  const values = new Map([...common.values, ...(own?.values ?? [])]);
  const valued = (defs: readonly AchievementDef[]): AchievementDef[] =>
    defs.flatMap((d) => { const r = withValues(d, values); return r === null ? [] : [r]; });
  if (own === null) return valued(common.defs);
  const off = new Set(own.disabled);
  const mine = new Map(own.defs.map(d => [d.id, d]));
  const merged = common.defs.filter(d => !off.has(d.id)).map(d => mine.get(d.id) ?? d);
  const commonIds = new Set(common.defs.map(d => d.id));
  return valued([...merged, ...own.defs.filter(d => !commonIds.has(d.id))]);
}

/**
 * An achievement with its named values in their places, or `null` where one is not
 * defined, or a list stands where one number is wanted: in a condition's number or in a
 * text. An `in` takes the whole list, each aggregate keyed by the list it was given.
 */
function withValues(def: AchievementDef, values: ReadonlyMap<string, readonly number[]>): AchievementDef | null {
  if (def.values.length === 0) return def;
  if (!def.values.every((v) => values.has(v))) return null;
  const one = (name: string): number | null => {
    const list = values.get(name);
    return list?.length === 1 ? list[0] ?? null : null;
  };
  let fits = true;
  const filter = (f: Filter | null): Filter | null => {
    if (f === null) return null;
    switch (f.k) {
      case 'in': return f.named === undefined ? f : { k: 'in', attr: f.attr, values: (values.get(f.named) ?? []).map(String), negated: f.negated };
      case 'and': case 'or': return { ...f, a: filter(f.a)!, b: filter(f.b)! };
      case 'not': return { ...f, a: filter(f.a)! };
      default: return f;
    }
  };
  const agg = (a: Aggregate): Aggregate =>
    (a.k === 'count' || a.k === 'distinct' ? keyed({ ...a, where: filter(a.where) }) : maxMin(a.k, sampleRef(a.sample.name, filter(a.sample.where))));
  const put = (e: Expr): Expr => {
    switch (e.k) {
      case 'value': {
        const n = one(e.name);
        if (n === null) fits = false;
        return { k: 'num', value: (n ?? 0) * e.scale, type: e.type };
      }
      case 'sample': return { k: 'sample', sample: sampleRef(e.sample.name, filter(e.sample.where)) };
      case 'agg': case 'ever': case 'never': return { ...e, agg: agg(e.agg) };
      case 'games': return { k: 'games', game: gameCondition(put(e.game.when), e.game.of) };
      case 'gamesParty': return gamesParty(gameCondition(put(e.game.when), e.game.of), e.attr);
      case 'total': return totalOf(agg(e.agg));
      case 'cmp': return { ...e, a: put(e.a), b: put(e.b) };
      case 'and': case 'or': return { ...e, a: put(e.a), b: put(e.b) };
      case 'not': return { ...e, a: put(e.a) };
      default: return e;
    }
  };
  const when = put(def.when);
  const text = def.text.replace(NAMED_IN_TEXT, (_, v: string) => {
    const n = one(v);
    if (n === null) fits = false;
    return String(n);
  });
  return fits ? { ...def, text, when, aggregates: aggregatesOf(when), games: gamesOf(when) } : null;
}

/** `def` with the counts `counts` in the places that read them. */
export function withCounts(def: AchievementDef, counts: DataCounts): AchievementDef {
  const put = (e: Expr): Expr => {
    switch (e.k) {
      case 'data': return { k: 'num', value: counts[e.name], type: 'num' };
      case 'games': case 'gamesParty': return { ...e, game: { ...e.game, when: put(e.game.when) } };
      case 'cmp': return { ...e, a: put(e.a), b: put(e.b) };
      case 'and': case 'or': return { ...e, a: put(e.a), b: put(e.b) };
      case 'not': return { ...e, a: put(e.a) };
      default: return e;
    }
  };
  const when = put(def.when);
  return { ...def, when, games: gamesOf(when) };
}

/**
 * The values `own`, a set's file, defines that none of `merged`, the set's achievements
 * (`mergeAchievements`), names: a misspelt name, or one an achievement no longer uses.
 */
export function unusedValues(own: AchievementFile, merged: readonly AchievementDef[]): string[] {
  const named = new Set(merged.flatMap((d) => d.values));
  return [...own.values.keys()].filter((v) => !named.has(v));
}

/**
 * The object names a condition compares with exactly (`=`, `!=`, `in`), an event's `item`
 * or what a champion wears or holds, that `items`, the set's object names, does not hold.
 * A pattern (`~`) is never one.
 */
export function unknownItems(def: AchievementDef, items: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const known = (name: string): boolean => items.has(name) || NOT_OBJECTS.has(name.toUpperCase());
  const filter = (f: Filter | null): void => {
    if (f === null) return;
    switch (f.k) {
      case 'cmp': if (ITEM_ATTRIBUTES.has(f.attr) && !known(f.value)) out.add(f.value); return;
      case 'in': if (ITEM_ATTRIBUTES.has(f.attr)) for (const v of f.values) if (!known(v)) out.add(v); return;
      case 'like': return;
      case 'and': case 'or': filter(f.a); filter(f.b); return;
      case 'not': filter(f.a); return;
    }
  };
  for (const a of [...def.aggregates, ...def.games.flatMap((g) => g.aggregates)]) if (a.k === 'count' || a.k === 'distinct') filter(a.where);
  for (const s of [def.when, ...def.games.map((g) => g.when)].flatMap(samplesOf)) filter(s.where);
  return [...out];
}

// ---------------------------------------------------------------------------------------
// Conditions

class ConditionError extends Error {}

/** A `#` outside a quoted name ends the line. */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted) return line.slice(0, i);
  }
  return line;
}

type Token =
  | { t: 'word'; v: string }
  | { t: 'string'; v: string }
  | { t: 'num'; v: number }
  | { t: 'dur'; v: number }
  | { t: 'value'; name: string; unit: string | undefined }
  | { t: 'op'; v: string }
  | { t: 'end' };

const DURATION_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (c === ' ' || c === '\t') { i++; continue; }
    const rest = text.slice(i);
    const num = /^(\d+)([hms])?(?![A-Za-z0-9_])/.exec(rest);
    if (num) {
      const value = Number(num[1]);
      if (!Number.isSafeInteger(value) || value > MAX_NUMBER) throw new ConditionError(`${num[1]} is too large`);
      tokens.push(num[2] ? { t: 'dur', v: value * (DURATION_SECONDS[num[2]] ?? 1) } : { t: 'num', v: value });
      i += num[0].length;
      continue;
    }
    if (c === '{') {
      const named = new RegExp(`^\\{(${VALUE_NAME})\\}([hms])?(?![A-Za-z0-9_])`).exec(rest);
      if (!named || (named[1] ?? '').length > ACHIEVEMENT_LIMITS.value) throw new ConditionError('braces hold a value\'s name, as {name}, or {name}m for minutes');
      tokens.push({ t: 'value', name: named[1] ?? '', unit: named[2] });
      i += named[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_']*/.exec(rest);
    if (word) { tokens.push({ t: 'word', v: word[0] }); i += word[0].length; continue; }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new ConditionError('a quoted name is not closed');
      tokens.push({ t: 'string', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = /^(<=|>=|!=|[=<>(),.~])/.exec(rest);
    if (op) { tokens.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new ConditionError(`"${c}" is not understood`);
  }
  tokens.push({ t: 'end' });
  return tokens;
}

const COMPARISONS: readonly string[] = ['=', '!=', '<', '<=', '>', '>='];

/** Parse a condition and check its types: it must be a yes or a no. */
export function parseCondition(text: string): Expr {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = (): Token => tokens[pos] ?? { t: 'end' };
  const next = (): Token => tokens[pos++] ?? { t: 'end' };
  const isWord = (v: string): boolean => { const t = peek(); return t.t === 'word' && t.v === v; };
  const isOp = (v: string): boolean => { const t = peek(); return t.t === 'op' && t.v === v; };
  const expectOp = (v: string): void => {
    if (!isOp(v)) throw new ConditionError(`expected "${v}" ${where()}`);
    pos++;
  };
  const where = (): string => {
    const t = peek();
    return t.t === 'end' ? 'at the end' : `before "${t.t === 'string' ? `"${t.v}"` : t.t === 'value' ? `{${t.name}}` : String(t.v)}"`;
  };

  /** Inside `games(…)`, where a condition is one game's and another `games` or `total` is refused. */
  let inGame = false;
  const orExpr = (): Expr => {
    let a = andExpr();
    while (isWord('or')) { pos++; a = { k: 'or', a, b: andExpr() }; }
    return a;
  };
  const andExpr = (): Expr => {
    let a = notExpr();
    while (isWord('and')) { pos++; a = { k: 'and', a, b: notExpr() }; }
    return a;
  };
  const notExpr = (): Expr => {
    if (isWord('not')) { pos++; return { k: 'not', a: notExpr() }; }
    return comparison();
  };
  const comparison = (): Expr => {
    const a = term();
    const t = peek();
    if (t.t === 'op' && COMPARISONS.includes(t.v)) {
      pos++;
      return { k: 'cmp', op: t.v as Comparison, a, b: term() };
    }
    return a;
  };
  const term = (): Expr => {
    const t = next();
    if (t.t === 'num') return { k: 'num', value: t.v, type: 'num' };
    if (t.t === 'dur') return { k: 'num', value: t.v, type: 'seconds' };
    if (t.t === 'value') {
      return t.unit === undefined
        ? { k: 'value', name: t.name, type: 'num', scale: 1 }
        : { k: 'value', name: t.name, type: 'seconds', scale: DURATION_SECONDS[t.unit] ?? 1 };
    }
    if (t.t === 'op' && t.v === '(') { const e = orExpr(); expectOp(')'); return e; }
    if (t.t !== 'word') { pos--; throw new ConditionError(`expected a value ${where()}`); }
    if (t.v in FACTS) return { k: 'fact', name: t.v as FactName };
    if ((DATA_COUNTS as readonly string[]).includes(t.v)) return { k: 'data', name: t.v as DataCountName };
    if ((SAMPLES as readonly string[]).includes(t.v)) { pos--; return { k: 'sample', sample: sample() }; }
    switch (t.v) {
      case 'games': return { k: 'games', game: games() };
      case 'total': {
        if (inGame) throw new ConditionError('games(…) takes a condition of one game, with no games(…) or total(…) in it');
        expectOp('(');
        if (!isWord('count')) throw new ConditionError('total(…) takes a count, total(count(event [where …]))');
        pos++;
        expectOp('(');
        const event = eventName();
        const filter = whereClause(EVENTS[event], event);
        expectOp(')');
        expectOp(')');
        return totalOf(keyed({ k: 'count', event, where: filter, key: '' }));
      }
      case 'count': case 'ever': case 'never': {
        expectOp('(');
        const event = eventName();
        const filter = whereClause(EVENTS[event], event);
        expectOp(')');
        const agg = keyed({ k: 'count', event, where: filter, key: '' });
        return t.v === 'count' ? { k: 'agg', agg } : { k: t.v, agg };
      }
      case 'distinct': {
        expectOp('(');
        if (isWord('games')) {
          pos++;
          const game = games();
          expectOp('.');
          const attr = attributeOf(CHAMPION_ATTRIBUTES, 'party');
          expectOp(')');
          return gamesParty(game, attr);
        }
        const event = eventName();
        expectOp('.');
        const attr = attributeOf(EVENTS[event], event);
        const filter = whereClause(EVENTS[event], event);
        expectOp(')');
        return { k: 'agg', agg: keyed({ k: 'distinct', event, attr, where: filter, key: '' }) };
      }
      case 'max': case 'min': {
        expectOp('(');
        const s = peek();
        if (s.t !== 'word' || !(SAMPLES as readonly string[]).includes(s.v)) {
          throw new ConditionError(`${t.v}() takes a sample: ${SAMPLES.join(', ')}`);
        }
        const ref = sample();
        expectOp(')');
        return { k: 'agg', agg: maxMin(t.v, ref) };
      }
    }
    throw new ConditionError(`"${t.v}" is no fact, sample, count or count of the data`);
  };
  /** `games(condition [, in "family"])`, its word read. */
  const games = (): GameCondition => {
    if (inGame) throw new ConditionError('games(…) takes a condition of one game, with no games(…) or total(…) in it');
    expectOp('(');
    inGame = true;
    const when = orExpr();
    inGame = false;
    let of: string | null = null;
    if (isOp(',')) {
      pos++;
      if (!isWord('in')) throw new ConditionError(`expected in "family" ${where()}, the games of the sets of that family`);
      pos++;
      const family = next();
      if (family.t !== 'string' || !FAMILY_NAME.test(family.v)) {
        throw new ConditionError('games(…, in "family") names a family of sets, such as "dungeon-master", in quotes: lowercase letters, digits, dots, hyphens and underscores');
      }
      of = family.v;
    }
    expectOp(')');
    if (typeOf(when) !== 'bool') throw new ConditionError('games(…) takes a yes-or-no condition, not a number');
    return gameCondition(when, of);
  };
  /** A sample's name, and for `party` the filter on its champions, `party(where …)`. */
  const sample = (): SampleRef => {
    const name = (next() as { v: string }).v as SampleName;
    if (!isOp('(')) return sampleRef(name, null);
    if (name !== 'party') throw new ConditionError(`only party takes a filter, party(where …); ${name} does not`);
    pos++;
    if (!isWord('where')) throw new ConditionError(`expected "where" ${where()}`);
    const filter = whereClause(CHAMPION_ATTRIBUTES, 'party');
    expectOp(')');
    return sampleRef(name, filter);
  };
  const eventName = (): EventKind => {
    const t = next();
    if (t.t !== 'word' || !(t.v in EVENTS)) {
      throw new ConditionError(`expected an event: ${Object.keys(EVENTS).join(', ')}`);
    }
    return t.v as EventKind;
  };
  /** An attribute of `attrs`, an event's or a champion's, `of` naming them. */
  type Attributes = Readonly<Record<string, AttributeKind>>;
  const attributeOf = (attrs: Attributes, of: string): string => {
    const t = next();
    if (Object.keys(attrs).length === 0) throw new ConditionError(`${of} has no attributes`);
    if (t.t !== 'word' || !(t.v in attrs)) {
      throw new ConditionError(`${of} has no attribute "${t.t === 'word' ? t.v : ''}": ${Object.keys(attrs).join(', ')}`);
    }
    return t.v;
  };
  const whereClause = (attrs: Attributes, of: string): Filter | null => {
    if (!isWord('where')) return null;
    pos++;
    return filterOr(attrs, of);
  };
  const filterOr = (attrs: Attributes, of: string): Filter => {
    let a = filterAnd(attrs, of);
    while (isWord('or')) { pos++; a = { k: 'or', a, b: filterAnd(attrs, of) }; }
    return a;
  };
  const filterAnd = (attrs: Attributes, of: string): Filter => {
    let a = filterNot(attrs, of);
    while (isWord('and')) { pos++; a = { k: 'and', a, b: filterNot(attrs, of) }; }
    return a;
  };
  const filterNot = (attrs: Attributes, of: string): Filter => {
    if (isWord('not')) { pos++; return { k: 'not', a: filterNot(attrs, of) }; }
    if (isOp('(')) { pos++; const f = filterOr(attrs, of); expectOp(')'); return f; }
    const attr = attributeOf(attrs, of);
    const kind = attrs[attr] as AttributeKind;
    const t = next();
    if (t.t === 'op' && (t.v === '=' || t.v === '!=')) return { k: 'cmp', attr, op: t.v, value: value(of, attr, kind) };
    if (t.t === 'op' && COMPARISONS.includes(t.v)) {
      if (kind.kind !== 'number') throw new ConditionError(`${t.v} orders numbers; ${of}.${attr} is not one`);
      return { k: 'cmp', attr, op: t.v as Comparison, value: value(of, attr, kind) };
    }
    if (t.t === 'op' && t.v === '~') {
      if (kind.kind !== 'name') throw new ConditionError(`~ compares names; ${of}.${attr} is not one`);
      const p = next();
      if (p.t !== 'string') throw new ConditionError('~ takes a quoted pattern');
      return { k: 'like', attr, pattern: p.v.toUpperCase() };
    }
    let negated = false;
    if (t.t === 'word' && t.v === 'not' && isWord('in')) { negated = true; pos++; }
    else if (!(t.t === 'word' && t.v === 'in')) { pos--; throw new ConditionError(`expected =, !=, <, <=, >, >=, in, not in or ~ ${where()}`); }
    const named = peek();
    if (named.t === 'value') {
      if (kind.kind !== 'number' || named.unit !== undefined) throw new ConditionError(`in {name} takes a list of numbers; ${of}.${attr} is not a number`);
      pos++;
      return { k: 'in', attr, values: [], negated, named: named.name };
    }
    expectOp('(');
    const values = [value(of, attr, kind)];
    while (isOp(',')) { pos++; values.push(value(of, attr, kind)); }
    expectOp(')');
    return { k: 'in', attr, values, negated };
  };
  const value = (of: string, attr: string, kind: AttributeKind): string => {
    const t = next();
    if (kind.kind === 'number') {
      if (t.t !== 'num') { pos--; throw new ConditionError(`${of}.${attr} is a whole number ${where()}`); }
      return String(t.v);
    }
    if (t.t !== 'word' && t.t !== 'string') { pos--; throw new ConditionError(`expected a value for ${of}.${attr} ${where()}`); }
    if (kind.kind === 'enum' && !kind.values.includes(t.v)) {
      throw new ConditionError(`${of}.${attr} is one of ${kind.values.join(', ')}`);
    }
    if (kind.kind === 'yesno' && t.v !== 'yes' && t.v !== 'no') throw new ConditionError(`${of}.${attr} is yes or no`);
    return kind.kind === 'name' ? t.v.toUpperCase() : t.v;
  };

  const expr = orExpr();
  if (peek().t !== 'end') throw new ConditionError(`unexpected ${where().replace('before ', '')}`);
  if (typeOf(expr) !== 'bool') throw new ConditionError('the condition must be a yes or a no, not a number');
  return expr;
}

/** The type of a part, checked all the way down. */
function typeOf(e: Expr): ValueType {
  switch (e.k) {
    case 'num': case 'value': return e.type;
    case 'fact': return FACTS[e.name];
    case 'data': case 'sample': case 'agg': case 'games': case 'gamesParty': case 'total': return 'num';
    case 'ever': case 'never': return 'bool';
    case 'cmp': {
      const a = typeOf(e.a);
      const b = typeOf(e.b);
      if (a === 'bool' || b === 'bool') throw new ConditionError(`${e.op} compares numbers, not yes or no`);
      if (a !== b) throw new ConditionError(`${e.op} compares a duration with a number: only playTime is in seconds`);
      return 'bool';
    }
    case 'and': case 'or':
      if (typeOf(e.a) !== 'bool' || typeOf(e.b) !== 'bool') throw new ConditionError(`${e.k} joins yes-or-no conditions, not numbers`);
      return 'bool';
    case 'not':
      if (typeOf(e.a) !== 'bool') throw new ConditionError('not takes a yes-or-no condition, not a number');
      return 'bool';
  }
}

/** A sample with its key, its canonical text: `party`, or `party(where …)`. */
function sampleRef(name: SampleName, where: Filter | null): SampleRef {
  return { name, where, key: where === null ? name : `${name}(where ${filterText(where)})` };
}

/** A sample's largest or smallest, keyed by the sample's key: `max(party)`. */
function maxMin(k: 'max' | 'min', sample: SampleRef): Aggregate {
  return { k, sample, key: `${k}(${sample.key})` };
}

/** `agg` with its key, its canonical text, which the tracker's saved state keeps it by. */
function keyed(agg: Exclude<Aggregate, { k: 'max' | 'min' }>): Aggregate {
  const key = agg.k === 'count' ? `count(${agg.event}${filterKey(agg.where)})` : `distinct(${agg.event}.${agg.attr}${filterKey(agg.where)})`;
  return { ...agg, key };
}

/** A filter as canonical text, for an aggregate's key. */
function filterKey(f: Filter | null): string {
  return f === null ? '' : ` where ${filterText(f)}`;
}
function filterText(f: Filter): string {
  const q = (v: string): string => JSON.stringify(v);
  switch (f.k) {
    case 'cmp': return `${f.attr}${f.op}${q(f.value)}`;
    case 'in': return `${f.attr} ${f.negated ? 'not in' : 'in'} ${f.named !== undefined ? `{${f.named}}` : `(${f.values.map(q).join(',')})`}`;
    case 'like': return `${f.attr}~${q(f.pattern)}`;
    case 'and': case 'or': return `(${filterText(f.a)} ${f.k} ${filterText(f.b)})`;
    case 'not': return `not ${filterText(f.a)}`;
  }
}

/** How far a numeric part read over a history that starts at a save can be trusted. */
function boundOf(e: Expr): Bound | null {
  switch (e.k) {
    case 'num': case 'value': case 'data': case 'sample': return 'exact';
    case 'fact': return e.name === 'playTime' || e.name === 'explored' ? 'low' : e.name === 'gameTime' ? 'exact' : null;
    case 'agg': return e.agg.k === 'min' ? 'high' : 'low';
    // A playthrough not counted, its rows lost or a teleport's, can only make either too small.
    case 'games': case 'gamesParty': case 'total': return 'low';
    default: return null;
  }
}

/**
 * Whether a condition needs the game's whole history (`doc/ACHIEVEMENTS.md` → "Some
 * conditions need the whole game"): whether a value read over a history that starts at a
 * save, a count too small or a `min` too large, could make it yes where the whole history
 * would make it no. Each comparison is weighed by the way it is used: under an odd number
 * of `not`s, a yes is what must not be wrongly reached by a no.
 */
export function needsWholeGame(e: Expr): boolean {
  const walk = (x: Expr, positive: boolean): boolean => {
    switch (x.k) {
      case 'and': case 'or': return walk(x.a, positive) || walk(x.b, positive);
      case 'not': return walk(x.a, !positive);
      case 'ever': return !positive;
      case 'never': return positive;
      case 'cmp': {
        const a = boundOf(x.a) ?? 'exact';
        const b = boundOf(x.b) ?? 'exact';
        if (a === 'exact' && b === 'exact') return false;
        if (a !== 'exact' && b !== 'exact') return true;
        // The inexact side on the left: `v op n`, v too small ('low') or too large ('high').
        const op = a !== 'exact' ? x.op : flip(x.op);
        const bound = a !== 'exact' ? a : b;
        // A value too small can wrongly make `v < n` yes, and `v >= n` wrongly no.
        const yesWhenSmall = op === '<' || op === '<=' || op === '=' || op === '!=';
        const yesWhenLarge = op === '>' || op === '>=' || op === '=' || op === '!=';
        const wronglyYes = bound === 'low' ? yesWhenSmall : yesWhenLarge;
        const wronglyNo = bound === 'low' ? yesWhenLarge : yesWhenSmall;
        return positive ? wronglyYes : wronglyNo;
      }
      default: return false;
    }
  };
  return walk(e, true);
}

function flip(op: Comparison): Comparison {
  switch (op) {
    case '<': return '>';
    case '<=': return '>=';
    case '>': return '<';
    case '>=': return '<=';
    default: return op;
  }
}

/** The named values a condition reads, its filters' lists among them. */
function valuesOf(e: Expr): string[] {
  const named = (f: Filter | null): string[] => {
    if (f === null) return [];
    switch (f.k) {
      case 'in': return f.named !== undefined ? [f.named] : [];
      case 'and': case 'or': return [...named(f.a), ...named(f.b)];
      case 'not': return named(f.a);
      default: return [];
    }
  };
  switch (e.k) {
    case 'value': return [e.name];
    case 'sample': return named(e.sample.where);
    case 'agg': case 'ever': case 'never': case 'total': return named(e.agg.k === 'count' || e.agg.k === 'distinct' ? e.agg.where : e.agg.sample.where);
    case 'games': case 'gamesParty': return valuesOf(e.game.when);
    case 'cmp': case 'and': case 'or': return [...valuesOf(e.a), ...valuesOf(e.b)];
    case 'not': return valuesOf(e.a);
    default: return [];
  }
}

/** The aggregates a condition reads, each once by its key. */
function aggregatesOf(e: Expr): Aggregate[] {
  const out = new Map<string, Aggregate>();
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'agg': case 'ever': case 'never': case 'total': out.set(x.agg.key, x.agg); return;
      case 'cmp': case 'and': case 'or': walk(x.a); walk(x.b); return;
      case 'not': walk(x.a); return;
      default: return;
    }
  };
  walk(e);
  return [...out.values()];
}

/** A condition of one game, `games(…)`'s, of the sets that read `of`'s file, with its key and what it reads. */
function gameCondition(when: Expr, of: string | null): GameCondition {
  return { key: `games(${exprText(when)})`, of, when, whole: needsWholeGame(when), aggregates: aggregatesOf(when) };
}

/** `total(…)` of a count, keyed by it. */
function totalOf(agg: Aggregate): Expr {
  return { k: 'total', agg, key: `total(${agg.key})` };
}

/** Whether a condition reads `games(…)` or `total(…)`. */
function isAcross(e: Expr): boolean {
  switch (e.k) {
    case 'games': case 'gamesParty': case 'total': return true;
    case 'cmp': case 'and': case 'or': return isAcross(e.a) || isAcross(e.b);
    case 'not': return isAcross(e.a);
    default: return false;
  }
}

/** What a condition across games reads of one game outside its `games(…)` and `total(…)`, if anything. */
function gameFactOutside(e: Expr): string | null {
  switch (e.k) {
    case 'num': case 'value': case 'games': case 'gamesParty': case 'total': return null;
    case 'fact': return e.name;
    case 'data': return e.name;
    case 'sample': return e.sample.key;
    case 'agg': case 'ever': case 'never': return e.agg.key;
    case 'cmp': case 'and': case 'or': return gameFactOutside(e.a) ?? gameFactOutside(e.b);
    case 'not': return gameFactOutside(e.a);
  }
}

/** The conditions of one game a condition's `games(…)` count, each once by its key. */
function gamesOf(e: Expr): GameCondition[] {
  const out = new Map<string, GameCondition>();
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'games': case 'gamesParty': out.set(x.game.key, x.game); return;
      case 'cmp': case 'and': case 'or': walk(x.a); walk(x.b); return;
      case 'not': walk(x.a); return;
      default: return;
    }
  };
  walk(e);
  return [...out.values()];
}

/** A champion's attribute kept at a playthrough's `games(…)`, which a `distinct(games(…).attribute)` reads. */
export interface PartyAtGame {
  /** The `games(…)` condition's key. */
  readonly game: string;
  readonly attr: string;
  /** The `distinct(games(…).attribute)`'s key. */
  readonly key: string;
}

/** The `distinct(games(…).attribute)`s a condition reads, each once by its key. */
export function partiesAtGamesOf(e: Expr): PartyAtGame[] {
  const out = new Map<string, PartyAtGame>();
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'gamesParty': out.set(x.key, { game: x.game.key, attr: x.attr, key: x.key }); return;
      case 'cmp': case 'and': case 'or': walk(x.a); walk(x.b); return;
      case 'not': walk(x.a); return;
      default: return;
    }
  };
  walk(e);
  return [...out.values()];
}

/** `distinct(games(…).attribute)`, keyed by its canonical text. */
function gamesParty(game: GameCondition, attr: string): Expr {
  return { k: 'gamesParty', game, attr, key: `distinct(${game.key}.${attr})` };
}

/** A condition as canonical text, for a `games(…)`'s key. */
function exprText(e: Expr): string {
  switch (e.k) {
    case 'num': return e.type === 'seconds' ? `${e.value}s` : `${e.value}`;
    case 'value': return `{${e.name}}${e.type === 'seconds' ? `*${e.scale}s` : ''}`;
    case 'fact': case 'data': return e.name;
    case 'sample': return e.sample.key;
    case 'agg': return e.agg.key;
    case 'ever': case 'never': return `${e.k}(${e.agg.key})`;
    case 'games': return e.game.key;
    case 'total': case 'gamesParty': return e.key;
    case 'cmp': return `(${exprText(e.a)} ${e.op} ${exprText(e.b)})`;
    case 'and': case 'or': return `(${exprText(e.a)} ${e.k} ${exprText(e.b)})`;
    case 'not': return `not ${exprText(e.a)}`;
  }
}

/** The samples a condition reads, bare or in a `max` or `min`, each once by its key. */
export function samplesOf(e: Expr): SampleRef[] {
  const out = new Map<string, SampleRef>();
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'sample': out.set(x.sample.key, x.sample); return;
      case 'agg': case 'ever': case 'never': if (x.agg.k === 'max' || x.agg.k === 'min') out.set(x.agg.sample.key, x.agg.sample); return;
      case 'cmp': case 'and': case 'or': walk(x.a); walk(x.b); return;
      case 'not': walk(x.a); return;
      default: return;
    }
  };
  walk(e);
  return [...out.values()];
}
