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
 */

/** The first line of every file: the format and its version. */
export const ACHIEVEMENTS_HEADER = '# CSBweb achievements 1';

/** The limits of a file and of its texts. */
export const ACHIEVEMENT_LIMITS = {
  bytes: 64 * 1024,
  achievements: 200,
  id: 40,
  value: 40,
  name: 32,
  text: 160,
} as const;

export const TIERS = ['easy', 'silly', 'weird', 'hard'] as const;
export type Tier = (typeof TIERS)[number];

/** What an attribute's values are: one of a few words, yes or no, or a name. */
type AttributeKind = { kind: 'enum'; values: readonly string[] } | { kind: 'yesno' } | { kind: 'name' };

const NAME: AttributeKind = { kind: 'name' };
const YESNO: AttributeKind = { kind: 'yesno' };
const enumOf = (...values: string[]): AttributeKind => ({ kind: 'enum', values });

/** A champion's damage, and their death, by what caused it. */
const DAMAGE_CAUSES = enumOf(
  'monster', 'missile', 'explosion', 'cloud', 'door', 'pit', 'wall',
  'poison', 'starvation', 'thirst', 'fatigue', 'potion',
);

/** The events and their attributes (`doc/ACHIEVEMENTS.md` → "The events"). */
export const EVENTS = {
  kill: {
    monster: NAME,
    by: enumOf('melee', 'spell', 'throw', 'explosion', 'cloud', 'door', 'pit', 'fusion'),
    item: NAME,
    champion: NAME,
    party: YESNO,
  },
  hurt: { champion: NAME, by: DAMAGE_CAUSES, party: YESNO },
  death: { champion: NAME, cause: DAMAGE_CAUSES },
  eat: { champion: NAME, item: NAME },
  drink: { champion: NAME, item: NAME },
  cast: { champion: NAME, spell: NAME, ok: YESNO },
  wear: { champion: NAME, slot: enumOf('head', 'neck', 'torso', 'legs', 'feet'), item: NAME },
  join: { champion: NAME, how: enumOf('resurrect', 'reincarnate') },
} as const satisfies Record<string, Record<string, AttributeKind>>;
export type EventKind = keyof typeof EVENTS;

/** The samples, read at the end of each tick. */
export const SAMPLES = ['party', 'alive', 'coins'] as const;
export type SampleName = (typeof SAMPLES)[number];

/** The facts about the game, and what each is. */
const FACTS = {
  won: 'bool',
  lost: 'bool',
  ended: 'bool',
  gameTime: 'num',
  playTime: 'seconds',
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

/** A filter on an event's attributes, its names upper-cased. */
export type Filter =
  | { k: 'cmp'; attr: string; op: '=' | '!='; value: string }
  | { k: 'in'; attr: string; values: readonly string[]; negated: boolean }
  | { k: 'like'; attr: string; pattern: string }
  | { k: 'and' | 'or'; a: Filter; b: Filter }
  | { k: 'not'; a: Filter };

/**
 * A value the evaluator keeps over the game: a count of events, the distinct values of an
 * attribute, or a sample's largest or smallest. `key` is its canonical text, which the
 * tracker's saved state keeps it by.
 */
export type Aggregate =
  | { k: 'count'; event: EventKind; where: Filter | null; key: string }
  | { k: 'distinct'; event: EventKind; attr: string; where: Filter | null; key: string }
  | { k: 'max' | 'min'; sample: SampleName; key: string };

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
  | { k: 'sample'; name: SampleName }
  | { k: 'agg'; agg: Aggregate }
  /** `ever` and `never`: the count compared with 0, kept apart for the bounds. */
  | { k: 'ever' | 'never'; agg: Aggregate }
  | { k: 'cmp'; op: Comparison; a: Expr; b: Expr }
  | { k: 'and' | 'or'; a: Expr; b: Expr }
  | { k: 'not'; a: Expr };

/** One achievement of a file. */
export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly tier: Tier;
  readonly when: Expr;
  /** Whether the condition needs the game's whole history (`needsWholeGame`). */
  readonly whole: boolean;
  /** The values the condition keeps over the game, each once. */
  readonly aggregates: readonly Aggregate[];
  /**
   * The named values its condition and its text name, each once. Out of
   * `mergeAchievements` they are in their places already, and this says which were.
   */
  readonly values: readonly string[];
  /** The line its block starts on. */
  readonly line: number;
}

/** A file read: its achievements, the common ones it switches off, and its named values. */
export interface AchievementFile {
  readonly defs: readonly AchievementDef[];
  readonly disabled: readonly string[];
  readonly values: ReadonlyMap<string, number>;
}

export interface AchievementError {
  readonly line: number;
  readonly message: string;
}

export type AchievementRead =
  | { readonly ok: true; readonly file: AchievementFile }
  | { readonly ok: false; readonly errors: readonly AchievementError[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;
/** A named value's name, and the same in braces, where a text or a condition names it. */
const VALUE_NAME = '[A-Za-z][A-Za-z0-9]*';
const NAMED_IN_TEXT = new RegExp(`\\{(${VALUE_NAME})\\}`, 'g');
const VALUE_LINE = /^value\s+(\S+)\s*=\s*(\S+)\s*$/;
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
  const values = new Map<string, number>();
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
      if (v === null) error(n, 'a value is defined as "value name = number"');
      else if (block !== null) error(n, 'a value is defined before the first [id]');
      else if (!new RegExp(`^${VALUE_NAME}$`).test(name) || name.length > ACHIEVEMENT_LIMITS.value) {
        error(n, `"${name}" is no value's name: 1 to ${ACHIEVEMENT_LIMITS.value} letters and digits, a letter first`);
      } else if (!/^\d+$/.test(v[2] ?? '') || Number(v[2]) > MAX_NUMBER) error(n, `a value is a whole number from 0 to ${MAX_NUMBER}`);
      else if (values.has(name)) error(n, `the value "${name}" is defined twice`);
      else values.set(name, Number(v[2]));
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
    defs.push({
      id: b.id,
      name: name.value,
      text: desc.value,
      tier: (tier?.value ?? 'easy') as Tier,
      when: expr,
      whole: needsWholeGame(expr),
      aggregates: aggregatesOf(expr),
      values: [...named],
      line: b.line,
    });
  }
  if (defs.length + disabled.length > ACHIEVEMENT_LIMITS.achievements) {
    error(1, `the file holds over ${ACHIEVEMENT_LIMITS.achievements} achievements`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, file: { defs, disabled, values } };
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

/** An achievement with its named values in their places, or `null` where one is not defined. */
function withValues(def: AchievementDef, values: ReadonlyMap<string, number>): AchievementDef | null {
  if (def.values.length === 0) return def;
  if (!def.values.every((v) => values.has(v))) return null;
  const put = (e: Expr): Expr => {
    switch (e.k) {
      case 'value': return { k: 'num', value: (values.get(e.name) ?? 0) * e.scale, type: e.type };
      case 'cmp': return { ...e, a: put(e.a), b: put(e.b) };
      case 'and': case 'or': return { ...e, a: put(e.a), b: put(e.b) };
      case 'not': return { ...e, a: put(e.a) };
      default: return e;
    }
  };
  return { ...def, text: def.text.replace(NAMED_IN_TEXT, (_, v: string) => String(values.get(v))), when: put(def.when) };
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
 * The `item` names a condition compares with exactly (`=`, `!=`, `in`) that `items`, the
 * set's object names, does not hold. A pattern (`~`) is never one.
 */
export function unknownItems(def: AchievementDef, items: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const filter = (f: Filter | null): void => {
    if (f === null) return;
    switch (f.k) {
      case 'cmp': if (f.attr === 'item' && !items.has(f.value)) out.add(f.value); return;
      case 'in': if (f.attr === 'item') for (const v of f.values) if (!items.has(v)) out.add(v); return;
      case 'like': return;
      case 'and': case 'or': filter(f.a); filter(f.b); return;
      case 'not': filter(f.a); return;
    }
  };
  for (const a of def.aggregates) if (a.k === 'count' || a.k === 'distinct') filter(a.where);
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
    if ((SAMPLES as readonly string[]).includes(t.v) && !isOp('(')) return { k: 'sample', name: t.v as SampleName };
    switch (t.v) {
      case 'count': case 'ever': case 'never': {
        expectOp('(');
        const event = eventName();
        const filter = whereClause(event);
        expectOp(')');
        const agg: Aggregate = { k: 'count', event, where: filter, key: `count(${event}${filterKey(filter)})` };
        return t.v === 'count' ? { k: 'agg', agg } : { k: t.v, agg };
      }
      case 'distinct': {
        expectOp('(');
        const event = eventName();
        expectOp('.');
        const attr = attributeOf(event);
        const filter = whereClause(event);
        expectOp(')');
        return { k: 'agg', agg: { k: 'distinct', event, attr, where: filter, key: `distinct(${event}.${attr}${filterKey(filter)})` } };
      }
      case 'max': case 'min': {
        expectOp('(');
        const s = next();
        if (s.t !== 'word' || !(SAMPLES as readonly string[]).includes(s.v)) {
          throw new ConditionError(`${t.v}() takes a sample: ${SAMPLES.join(', ')}`);
        }
        expectOp(')');
        return { k: 'agg', agg: { k: t.v, sample: s.v as SampleName, key: `${t.v}(${s.v})` } };
      }
    }
    throw new ConditionError(`"${t.v}" is no fact, sample or count`);
  };
  const eventName = (): EventKind => {
    const t = next();
    if (t.t !== 'word' || !(t.v in EVENTS)) {
      throw new ConditionError(`expected an event: ${Object.keys(EVENTS).join(', ')}`);
    }
    return t.v as EventKind;
  };
  const attributeOf = (event: EventKind): string => {
    const t = next();
    const attrs: Record<string, AttributeKind> = EVENTS[event];
    if (t.t !== 'word' || !(t.v in attrs)) {
      throw new ConditionError(`${event} has no attribute "${t.t === 'word' ? t.v : ''}": ${Object.keys(attrs).join(', ')}`);
    }
    return t.v;
  };
  const whereClause = (event: EventKind): Filter | null => {
    if (!isWord('where')) return null;
    pos++;
    return filterOr(event);
  };
  const filterOr = (event: EventKind): Filter => {
    let a = filterAnd(event);
    while (isWord('or')) { pos++; a = { k: 'or', a, b: filterAnd(event) }; }
    return a;
  };
  const filterAnd = (event: EventKind): Filter => {
    let a = filterNot(event);
    while (isWord('and')) { pos++; a = { k: 'and', a, b: filterNot(event) }; }
    return a;
  };
  const filterNot = (event: EventKind): Filter => {
    if (isWord('not')) { pos++; return { k: 'not', a: filterNot(event) }; }
    if (isOp('(')) { pos++; const f = filterOr(event); expectOp(')'); return f; }
    const attr = attributeOf(event);
    const kind = (EVENTS[event] as Record<string, AttributeKind>)[attr] as AttributeKind;
    const t = next();
    if (t.t === 'op' && (t.v === '=' || t.v === '!=')) return { k: 'cmp', attr, op: t.v, value: value(event, attr, kind) };
    if (t.t === 'op' && t.v === '~') {
      if (kind.kind !== 'name') throw new ConditionError(`~ compares names; ${event}.${attr} is not one`);
      const p = next();
      if (p.t !== 'string') throw new ConditionError('~ takes a quoted pattern');
      return { k: 'like', attr, pattern: p.v.toUpperCase() };
    }
    let negated = false;
    if (t.t === 'word' && t.v === 'not' && isWord('in')) { negated = true; pos++; }
    else if (!(t.t === 'word' && t.v === 'in')) { pos--; throw new ConditionError(`expected =, !=, in, not in or ~ ${where()}`); }
    expectOp('(');
    const values = [value(event, attr, kind)];
    while (isOp(',')) { pos++; values.push(value(event, attr, kind)); }
    expectOp(')');
    return { k: 'in', attr, values, negated };
  };
  const value = (event: EventKind, attr: string, kind: AttributeKind): string => {
    const t = next();
    if (t.t !== 'word' && t.t !== 'string') { pos--; throw new ConditionError(`expected a value for ${event}.${attr} ${where()}`); }
    if (kind.kind === 'enum' && !kind.values.includes(t.v)) {
      throw new ConditionError(`${event}.${attr} is one of ${kind.values.join(', ')}`);
    }
    if (kind.kind === 'yesno' && t.v !== 'yes' && t.v !== 'no') throw new ConditionError(`${event}.${attr} is yes or no`);
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
    case 'sample': case 'agg': return 'num';
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

/** A filter as canonical text, for an aggregate's key. */
function filterKey(f: Filter | null): string {
  return f === null ? '' : ` where ${filterText(f)}`;
}
function filterText(f: Filter): string {
  const q = (v: string): string => JSON.stringify(v);
  switch (f.k) {
    case 'cmp': return `${f.attr}${f.op}${q(f.value)}`;
    case 'in': return `${f.attr} ${f.negated ? 'not in' : 'in'} (${f.values.map(q).join(',')})`;
    case 'like': return `${f.attr}~${q(f.pattern)}`;
    case 'and': case 'or': return `(${filterText(f.a)} ${f.k} ${filterText(f.b)})`;
    case 'not': return `not ${filterText(f.a)}`;
  }
}

/** How far a numeric part read over a history that starts at a save can be trusted. */
function boundOf(e: Expr): Bound | null {
  switch (e.k) {
    case 'num': case 'value': case 'sample': return 'exact';
    case 'fact': return e.name === 'playTime' ? 'low' : e.name === 'gameTime' ? 'exact' : null;
    case 'agg': return e.agg.k === 'min' ? 'high' : 'low';
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

/** The named values a condition reads. */
function valuesOf(e: Expr): string[] {
  switch (e.k) {
    case 'value': return [e.name];
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
      case 'agg': case 'ever': case 'never': out.set(x.agg.key, x.agg); return;
      case 'cmp': case 'and': case 'or': walk(x.a); walk(x.b); return;
      case 'not': walk(x.a); return;
      default: return;
    }
  };
  walk(e);
  return [...out.values()];
}
