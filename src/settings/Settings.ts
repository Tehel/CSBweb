/**
 * The player's settings: one model, outside the page and its DOM, that the page, the game
 * and the dialogs read and change through it (`DEBT.md` U). A change is saved at once and
 * told to every listener; `main.ts` applies it to the sound and the CRT effect, and to the
 * game (`applyToGame`), and the page's buttons show it (`bindSettingsControls`).
 *
 * It is kept in `localStorage` under `SETTINGS_KEY`. Where that key is absent, the page's
 * earlier settings (`OLD_SETTINGS_KEY`) are read once and written under the new key. A
 * field that is missing or of the wrong type is its default, so a damaged or older record
 * still gives a whole set.
 */
import type { Extras, GameContext } from '../engine/GameContext';
import { KEY_LABEL_LAYOUTS, type KeyLabelLayout } from '../renderer/ui/KeyLabels';
import { KEY_PRESETS, setKeyBindings, type KeyAction, type KeyBindings, type KeyPreset, type KeySlots } from '../renderer/ui/Keyboard';

export interface SettingsValues {
  /** Sound on. */
  readonly sound: boolean;
  /** The sound's volume, 0 to 1. */
  readonly volume: number;
  /** The CRT effect, where the browser gives WebGL (`src/lib/crt.ts`). */
  readonly crt: boolean;
  /**
   * The FTL logo and the title before the entrance. The entrance is shown either way, as
   * it is where a game is chosen.
   */
  readonly startupAnimations: boolean;
  /** The statistics' events (`doc/STATISTICS.md`): on unless the player turns them off. */
  readonly statistics: boolean;
  /** The map of the party's level beside the game. */
  readonly mapView: boolean;
  /** The champions' table beside the game. */
  readonly championView: boolean;
  /** The page's debug chrome: a click on the map moves the party. */
  readonly debug: boolean;
  /** The extras (`DEBT.md` X), each off by default: with all off, the game is CSBWin's. */
  readonly extras: Extras;
  /** The key table's preset, or `custom` for one changed by hand. */
  readonly keyPreset: KeyPreset;
  /** The keys the game answers: a preset's table, or the player's own. */
  readonly keyBindings: KeyBindings;
  /** The layout the keys are labelled in where the browser does not say (`KeyLabels.ts`). */
  readonly keyLabels: KeyLabelLayout;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  sound: true,
  volume: 0.8,
  crt: false,
  startupAnimations: true,
  statistics: true,
  mapView: false,
  championView: false,
  debug: false,
  extras: { gatherThrownWeapons: false, drinkAtFountain: false, colourNewMastery: false },
  keyPreset: 'csbwin',
  keyBindings: KEY_PRESETS.csbwin,
  keyLabels: 'qwerty',
};

/** Where the settings are kept. */
export const SETTINGS_KEY = 'csbweb_settings_v2';
/** Where the page kept its settings before this model, read once (`fromOldSettings`). */
export const OLD_SETTINGS_KEY = 'csbweb_ui_settings_v1';

/** What the settings are kept in: `localStorage`, or a tool's map. */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type SettingsListener = (values: SettingsValues) => void;

export class Settings {
  private current: SettingsValues;
  private readonly listeners: SettingsListener[] = [];

  /** The settings `storage` keeps, or the defaults with no storage (`null`). */
  constructor(private readonly storage: SettingsStorage | null) {
    const stored = this.read(SETTINGS_KEY);
    const old = stored === undefined ? this.read(OLD_SETTINGS_KEY) : undefined;
    this.current = stored !== undefined ? parseSettings(stored)
      : old !== undefined ? parseSettings(fromOldSettings(old)) : DEFAULT_SETTINGS;
    if (old !== undefined) this.save();
  }

  get values(): SettingsValues {
    return this.current;
  }

  /**
   * `change` made, saved, and told to every listener. A table of keys given alone is the
   * player's own, `custom`; a preset named alone brings its table.
   */
  update(change: Partial<SettingsValues>): void {
    const keyPreset = change.keyPreset ?? (change.keyBindings ? 'custom' : this.current.keyPreset);
    this.current = withPresetTable({ ...this.current, ...change, keyPreset });
    this.save();
    for (const listener of this.listeners) listener(this.current);
  }

  /** `listener` told the settings now, and at every change, after those subscribed before it. */
  subscribe(listener: SettingsListener): void {
    this.listeners.push(listener);
    listener(this.current);
  }

  /** The JSON under `key`, `null` where it does not parse, or `undefined` where there is none. */
  private read(key: string): unknown {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(key) ?? null;
    } catch {
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  /** A storage that refuses (full, or forbidden) keeps the settings for this page only. */
  private save(): void {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // Nothing to do: the page goes on with the settings it has.
    }
  }
}

/** What the game reads of the settings: the extras, into `ctx`, and the keys it answers. */
export function applyToGame(ctx: Pick<GameContext, 'extras'>, values: SettingsValues): void {
  ctx.extras = values.extras;
  setKeyBindings(values.keyBindings);
}

/** A stored record as settings, each field that is missing or of the wrong type its default. */
export function parseSettings(raw: unknown): SettingsValues {
  const record = asRecord(raw);
  const extras = asRecord(record.extras);
  const defaults = DEFAULT_SETTINGS;
  const preset = record.keyPreset;
  return withPresetTable({
    sound: bool(record.sound, defaults.sound),
    volume: typeof record.volume === 'number' && Number.isFinite(record.volume)
      ? Math.max(0, Math.min(1, record.volume)) : defaults.volume,
    crt: bool(record.crt, defaults.crt),
    startupAnimations: bool(record.startupAnimations, defaults.startupAnimations),
    statistics: bool(record.statistics, defaults.statistics),
    mapView: bool(record.mapView, defaults.mapView),
    championView: bool(record.championView, defaults.championView),
    debug: bool(record.debug, defaults.debug),
    extras: {
      gatherThrownWeapons: bool(extras.gatherThrownWeapons, defaults.extras.gatherThrownWeapons),
      drinkAtFountain: bool(extras.drinkAtFountain, defaults.extras.drinkAtFountain),
      colourNewMastery: bool(extras.colourNewMastery, defaults.extras.colourNewMastery),
    },
    keyPreset: typeof preset === 'string' && (preset === 'custom' || preset in KEY_PRESETS)
      ? preset as KeyPreset : defaults.keyPreset,
    keyBindings: parseKeyBindings(record.keyBindings),
    keyLabels: KEY_LABEL_LAYOUTS.find((layout) => layout === record.keyLabels) ?? defaults.keyLabels,
  });
}

/**
 * The page's earlier settings in this model's names. Its one Extras button turned on
 * every extra; its map was shown by default.
 */
export function fromOldSettings(raw: unknown): Record<string, unknown> {
  const old = asRecord(raw);
  const extras = typeof old.extras === 'boolean'
    ? { gatherThrownWeapons: old.extras, drinkAtFountain: old.extras, colourNewMastery: old.extras }
    : undefined;
  return {
    sound: old.soundEnabled,
    volume: old.soundVolume,
    crt: old.crt,
    statistics: old.statistics,
    mapView: old.mapVisible ?? true,
    championView: old.championsVisible,
    debug: old.debug,
    extras,
  };
}

/** A stored table: each action's two codes, the default preset's where they are not two strings. */
function parseKeyBindings(raw: unknown): KeyBindings {
  const record = asRecord(raw);
  const table = {} as Record<KeyAction, KeySlots>;
  for (const [action, slots] of Object.entries(KEY_PRESETS.csbwin) as Array<[KeyAction, KeySlots]>) {
    const stored = record[action];
    table[action] = Array.isArray(stored) && stored.length === 2 && stored.every((code) => typeof code === 'string')
      ? [stored[0] as string, stored[1] as string] : slots;
  }
  return table;
}

/** A preset's table is the preset's: only a `custom` table is the record's own. */
function withPresetTable(values: SettingsValues): SettingsValues {
  return values.keyPreset === 'custom' ? values : { ...values, keyBindings: KEY_PRESETS[values.keyPreset] };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
