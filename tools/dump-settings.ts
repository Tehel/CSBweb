/**
 * The player's settings (`src/settings/Settings.ts`): one model the page, the game and the
 * dialogs read and change, kept in `localStorage`.
 *
 * Over a stand-in storage, it checks the defaults, the page's earlier record read once
 * under the new key, a field of the wrong type replaced by its default, a table of keys
 * kept across a save and a load, and each extra's flag reaching the game alone, as
 * `main.ts` applies it (`applyToGame`). The keys the game answers follow the table in
 * force (`keyAction`).
 *
 * Run: `npx tsx tools/dump-settings.ts`
 */
import { NO_EXTRAS, type Extras } from '../src/engine/GameContext';
import { DEFAULT_KEY_BINDINGS, keyAction, type KeyBindings } from '../src/renderer/ui/Keyboard';
import {
  DEFAULT_SETTINGS, OLD_SETTINGS_KEY, SETTINGS_KEY, Settings, applyToGame, type SettingsStorage, type SettingsValues,
} from '../src/settings/Settings';
import { check, finish } from './lib/check';

/** `localStorage`'s two calls over a map, with every read counted. */
class MapStorage implements SettingsStorage {
  readonly items = new Map<string, string>();
  readonly reads: string[] = [];
  getItem(key: string): string | null {
    this.reads.push(key);
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const stored = (storage: MapStorage): Record<string, unknown> =>
  JSON.parse(storage.items.get(SETTINGS_KEY) ?? 'null') as Record<string, unknown>;

console.log('=== the defaults ===');
{
  const values = new Settings(new MapStorage()).values;
  console.log(JSON.stringify({ ...values, keyBindings: '…' }));
  check(JSON.stringify(values) === JSON.stringify(DEFAULT_SETTINGS), 'an empty storage gives the defaults');
  check(values.sound && values.volume === 0.8 && !values.crt && values.aspectRatio === '16:10' && values.startupAnimations,
    'sound on at 0.8, no CRT effect, the screen 16:10, the startup animations shown');
  check(values.statistics && !values.mapView && !values.championView,
    'the statistics sent; the map and the champions off');
  check(JSON.stringify(values.extras) === JSON.stringify(NO_EXTRAS), 'every extra off');
  check(values.keyPreset === 'csbwin' && values.keyBindings === DEFAULT_KEY_BINDINGS, "the keys are CSBWIN's preset");
  check(new Settings(null).values === DEFAULT_SETTINGS, 'no storage at all gives the defaults');
}

console.log('\n=== the earlier record, read once ===');
{
  const storage = new MapStorage();
  storage.items.set(OLD_SETTINGS_KEY, JSON.stringify({
    mapVisible: true, championsVisible: true, debug: true, crt: true,
    soundEnabled: false, soundVolume: 0.25, extras: true, statistics: false,
  }));
  const values = new Settings(storage).values;
  console.log(JSON.stringify({ ...values, keyBindings: '…' }));
  check(!values.sound && values.volume === 0.25 && values.crt, 'the sound, its volume and the CRT effect carried over');
  check(values.mapView && values.championView && !values.statistics && !('debug' in values),
    'the map, the champions and the statistics carried over, and its debug chrome dropped');
  check(Object.values(values.extras).every(Boolean), 'the one Extras flag turned every extra on');
  check(values.startupAnimations, 'the startup animations, which it did not have, are the default');
  check(stored(storage)?.crt === true, 'it is written under the new key at once');
  storage.reads.length = 0;
  new Settings(storage);
  check(!storage.reads.includes(OLD_SETTINGS_KEY), 'a second page reads the new key and not the old');

  const mapByDefault = new MapStorage();
  mapByDefault.items.set(OLD_SETTINGS_KEY, JSON.stringify({ crt: false }));
  check(new Settings(mapByDefault).values.mapView, 'an earlier record with no map field shows the map, as it did');
}

console.log('\n=== fields of the wrong type ===');
{
  const storage = new MapStorage();
  storage.items.set(SETTINGS_KEY, JSON.stringify({
    sound: 'yes', volume: 7, crt: 1, aspectRatio: '5:4', startupAnimations: false, mapView: null,
    extras: { gatherThrownWeapons: 'on', drinkAtFountain: true },
    keyPreset: 'qwertz', keyBindings: { 'move.forward': ['KeyW', ''] },
  }));
  const values = new Settings(storage).values;
  console.log(JSON.stringify({ ...values, keyBindings: '…' }));
  check(values.sound === true && values.crt === false && values.mapView === false, 'a field of the wrong type is its default');
  check(values.aspectRatio === '16:10', 'an aspect ratio of no known shape is 16:10');
  check(values.volume === 1, 'a volume past 1 is 1');
  check(values.startupAnimations === false, 'a field of the right type is kept beside them');
  check(!values.extras.gatherThrownWeapons && values.extras.drinkAtFountain && !values.extras.colourNewMastery,
    'each extra is read alone: the wrong type off, the missing one off, the good one on');
  check(values.keyPreset === 'csbwin' && values.keyBindings === DEFAULT_KEY_BINDINGS,
    "an unknown preset is CSBWIN's, and its table is the preset's, not the record's");
  for (const raw of ['{not json', '[1,2]', '42', 'null']) {
    const damaged = new MapStorage();
    damaged.items.set(SETTINGS_KEY, raw);
    check(JSON.stringify(new Settings(damaged).values) === JSON.stringify(DEFAULT_SETTINGS), `a record '${raw}' gives the defaults`);
  }
  const volume = new MapStorage();
  volume.items.set(SETTINGS_KEY, JSON.stringify({ volume: -3 }));
  check(new Settings(volume).values.volume === 0, 'a volume below 0 is 0');
  const aspect = new MapStorage();
  new Settings(aspect).update({ aspectRatio: '4:3' });
  check(new Settings(aspect).values.aspectRatio === '4:3', 'an aspect ratio of 4:3 is read back');
}

console.log('\n=== a table of keys, saved and read back ===');
{
  const storage = new MapStorage();
  const settings = new Settings(storage);
  const table: KeyBindings = {
    ...DEFAULT_KEY_BINDINGS, 'attack.1.0': ['', ''], 'move.forward': ['KeyW', 'ArrowUp'], 'move.backward': ['', ''],
  };
  const told: SettingsValues[] = [];
  settings.subscribe((values) => told.push(values));
  check(told.length === 1 && told[0] === settings.values, 'a listener is told the settings at once');
  settings.update({ keyBindings: table });
  check(told.length === 2 && told[1]!.keyBindings === table, 'and at the change');
  check(settings.values.keyPreset === 'custom', 'a table given alone is custom');
  const read = new Settings(storage).values;
  check(read.keyPreset === 'custom' && JSON.stringify(read.keyBindings) === JSON.stringify(table),
    'a custom table survives the round trip');
  settings.update({ keyPreset: 'csbwin' });
  check(settings.values.keyBindings === DEFAULT_KEY_BINDINGS, 'a preset named alone brings its table');
  check(new Settings(storage).values.keyBindings === DEFAULT_KEY_BINDINGS, 'and is read back as the preset');

  // The keys the game answers are the table in force.
  const ctx = { extras: NO_EXTRAS };
  applyToGame(ctx, { ...DEFAULT_SETTINGS, keyPreset: 'custom', keyBindings: table });
  console.log(`KeyW: ${keyAction('KeyW')}, ArrowUp: ${keyAction('ArrowUp')}, KeyK: ${keyAction('KeyK')}, Comma: ${keyAction('Comma')}`);
  check(keyAction('KeyW') === 'move.forward' && keyAction('ArrowUp') === 'move.forward', "the custom table's keys move");
  check(keyAction('KeyK') === null && keyAction('Comma') === null, "and the preset's moves no longer do");
  applyToGame(ctx, DEFAULT_SETTINGS);
  check(keyAction('KeyK') === 'move.forward' && keyAction('KeyW') === 'attack.1.0', "the preset's keys are back");
}

console.log('\n=== each extra reaches the game alone ===');
{
  const settings = new Settings(new MapStorage());
  const ctx: { extras: Extras } = { extras: NO_EXTRAS };
  settings.subscribe((values) => applyToGame(ctx, values));
  for (const extra of Object.keys(NO_EXTRAS) as Array<keyof Extras>) {
    settings.update({ extras: { ...NO_EXTRAS, [extra]: true } });
    console.log(`${extra}: ${JSON.stringify(ctx.extras)}`);
    const on = (Object.keys(ctx.extras) as Array<keyof Extras>).filter((key) => ctx.extras[key]);
    check(on.length === 1 && on[0] === extra, `${extra} on turns that extra on in the game, and no other`);
  }
  settings.update({ extras: NO_EXTRAS });
  check(Object.values(ctx.extras).every((on) => !on), 'all off: the game is CSBWin\'s');
}

finish();
