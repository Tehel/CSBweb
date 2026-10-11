import { getUIContext, isDebugFeaturesEnabled, isExtrasEnabled, setDebugFeaturesEnabled, setExtrasEnabled } from './context';
import { isChampionPanelVisible, updateChampionPanel } from './championPanel';

const UI_SETTINGS_KEY = 'csbweb_ui_settings_v1';

export interface UISettings {
    mapVisible: boolean;
    championsVisible: boolean;
    debug: boolean;
    crt: boolean;
    soundEnabled: boolean;
    soundVolume: number;
    /** The extras (`DEBT.md` X): with it off, the game is CSBWin's. */
    extras: boolean;
    /**
     * The statistics' events (`doc/STATISTICS.md`): on unless the player turns them off.
     * No control on the page sets it yet.
     */
    statistics: boolean;
}

export function loadUISettings(): UISettings {
    try {
        const raw = localStorage.getItem(UI_SETTINGS_KEY);
        if (!raw) return defaultUISettings();
        const parsed = JSON.parse(raw) as Partial<UISettings>;
        return {
            mapVisible: parsed.mapVisible ?? true,
            championsVisible: parsed.championsVisible ?? false,
            debug: parsed.debug ?? false,
            crt: parsed.crt ?? false,
            soundEnabled: parsed.soundEnabled ?? true,
            soundVolume: parsed.soundVolume ?? 0.8,
            extras: parsed.extras ?? false,
            statistics: parsed.statistics ?? true,
        };
    } catch {
        return defaultUISettings();
    }
}

export function saveUISettings(settings: UISettings): void {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

export function readUISettings(): UISettings {
    const mapVisible = (document.getElementById('map')?.style.display ?? '') !== 'none';
    const championsVisible = isChampionPanelVisible();
    return {
        mapVisible,
        championsVisible,
        debug: isDebugFeaturesEnabled(),
        crt: getUIContext()?.isCrtEnabled() ?? false,
        soundEnabled: getUIContext()?.isSoundEnabled() ?? true,
        soundVolume: getUIContext()?.getSoundVolume() ?? 0.8,
        extras: isExtrasEnabled(),
        // Nothing on the page shows it: the saved one stands.
        statistics: loadUISettings().statistics,
    };
}

export function applyUISettings(settings: UISettings): void {
    const ctx = getUIContext();
    const mapEl = document.getElementById('map');
    const championsEl = document.getElementById('champions');
    const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
    const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
    const championsButton = document.getElementById('btn-champions') as HTMLButtonElement | null;
    const crtButton = document.getElementById('btn-crt') as HTMLButtonElement | null;
    const soundButton = document.getElementById('btn-sound') as HTMLButtonElement | null;
    const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;
    const extrasButton = document.getElementById('btn-extras') as HTMLButtonElement | null;

    mapEl && (mapEl.style.display = settings.mapVisible ? 'block' : 'none');
    championsEl && (championsEl.style.display = settings.championsVisible ? 'block' : 'none');

    setDebugFeaturesEnabled(settings.debug);
    debugButton?.classList.toggle('is-pressed', settings.debug);
    setExtrasEnabled(settings.extras);
    extrasButton?.classList.toggle('is-pressed', settings.extras);
    mapButton?.classList.toggle('is-pressed', settings.mapVisible);
    championsButton?.classList.toggle('is-pressed', settings.championsVisible);
    updateChampionPanel();

    const crtEnabled = ctx?.setCrtEnabled(settings.crt) ?? false;
    crtButton?.classList.toggle('is-pressed', crtEnabled);

    if (ctx) ctx.setSoundEnabled(settings.soundEnabled);
    soundButton?.classList.toggle('is-pressed', settings.soundEnabled);
    if (ctx) ctx.setSoundVolume(settings.soundVolume);
    if (soundVolume) soundVolume.value = String(Math.round(settings.soundVolume * 100));
}

function defaultUISettings(): UISettings {
    return {
        mapVisible: true,
        championsVisible: false,
        debug: false,
        crt: false,
        soundEnabled: true,
        soundVolume: 0.8,
        extras: false,
        statistics: true,
    };
}

/** Whether the page sends the statistics' events: the saved setting, read at each event. */
export function isStatisticsEnabled(): boolean {
    return loadUISettings().statistics;
}

/** The statistics' setting, saved with the rest. The next event obeys it. */
export function setStatisticsEnabled(enabled: boolean): void {
    saveUISettings({ ...loadUISettings(), statistics: enabled });
}
