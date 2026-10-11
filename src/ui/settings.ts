import type { Settings, SettingsValues } from '../settings/Settings';
import { setDebugFeaturesEnabled } from './context';
import { updateChampionPanel } from './championPanel';

/**
 * The page's settings buttons beside the canvas, which change the player's settings
 * (`src/settings/Settings.ts`) and show them. Bound at boot, before the FTL logo, so they
 * are live in the intro and at the entrance too. The CRT button shows whether the effect
 * is on, which it is not where the browser gives no WebGL, whatever the setting says.
 */
export function bindSettingsControls(settings: Settings, isCrtEnabled: () => boolean): void {
    const mapEl = document.getElementById('map');
    const championsEl = document.getElementById('champions');
    const button = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
    const crtButton = button('btn-crt');
    const soundButton = button('btn-sound');
    const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;
    const mapButton = button('btn-map');
    const championsButton = button('btn-champions');
    const debugButton = button('btn-debug');
    const extrasButton = button('btn-extras');

    // The one Extras button stands for every extra: pressed when all are on, and a press
    // turns them all the other way.
    const allExtras = (values: SettingsValues) => Object.values(values.extras).every(Boolean);

    crtButton?.addEventListener('click', () => {
        settings.update({ crt: !settings.values.crt });
        if (settings.values.crt && !isCrtEnabled()) console.warn('CRT effect unavailable');
    });
    soundButton?.addEventListener('click', () => settings.update({ sound: !settings.values.sound }));
    soundVolume?.addEventListener('input', () => {
        settings.update({ volume: Math.max(0, Math.min(100, Number(soundVolume.value))) / 100 });
    });
    mapButton?.addEventListener('click', () => settings.update({ mapView: !settings.values.mapView }));
    championsButton?.addEventListener('click', () => settings.update({ championView: !settings.values.championView }));
    debugButton?.addEventListener('click', () => settings.update({ debug: !settings.values.debug }));
    extrasButton?.addEventListener('click', () => {
        const on = !allExtras(settings.values);
        settings.update({ extras: { gatherThrownWeapons: on, drinkAtFountain: on, colourNewMastery: on } });
    });

    settings.subscribe((values) => {
        crtButton?.classList.toggle('is-pressed', isCrtEnabled());
        soundButton?.classList.toggle('is-pressed', values.sound);
        if (soundVolume) soundVolume.value = String(Math.round(values.volume * 100));
        mapEl && (mapEl.style.display = values.mapView ? 'block' : 'none');
        mapButton?.classList.toggle('is-pressed', values.mapView);
        championsEl && (championsEl.style.display = values.championView ? 'block' : 'none');
        championsButton?.classList.toggle('is-pressed', values.championView);
        updateChampionPanel();
        setDebugFeaturesEnabled(values.debug);
        debugButton?.classList.toggle('is-pressed', values.debug);
        extrasButton?.classList.toggle('is-pressed', allExtras(values));
    });
}
