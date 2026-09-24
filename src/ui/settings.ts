import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';
import { isChampionPanelVisible, updateChampionPanel } from './championPanel';

const UI_SETTINGS_KEY = 'dmweb_ui_settings_v1';

export interface UISettings {
    mapVisible: boolean;
    logVisible: boolean;
    hoverVisible: boolean;
    championsVisible: boolean;
    smooth: boolean;
    debug: boolean;
    crt: boolean;
    soundEnabled: boolean;
    soundVolume: number;
}

export function loadUISettings(): UISettings {
    try {
        const raw = localStorage.getItem(UI_SETTINGS_KEY);
        if (!raw) return defaultUISettings();
        const parsed = JSON.parse(raw) as Partial<UISettings>;
        return {
            mapVisible: parsed.mapVisible ?? true,
            logVisible: parsed.logVisible ?? true,
            hoverVisible: parsed.hoverVisible ?? true,
            championsVisible: parsed.championsVisible ?? false,
            smooth: parsed.smooth ?? false,
            debug: parsed.debug ?? false,
            crt: parsed.crt ?? false,
            soundEnabled: parsed.soundEnabled ?? true,
            soundVolume: parsed.soundVolume ?? 0.8,
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
    const logVisible = (document.getElementById('log')?.style.display ?? '') !== 'none';
    const hoverVisible = (document.getElementById('hover')?.style.display ?? '') !== 'none';
    const championsVisible = isChampionPanelVisible();
    const smooth = getUIContext()?.renderer.getCanvasStyle().imageRendering === 'smooth';
    return {
        mapVisible,
        logVisible,
        hoverVisible,
        championsVisible,
        smooth,
        debug: isDebugFeaturesEnabled(),
        crt: getUIContext()?.isCrtEnabled() ?? false,
        soundEnabled: getUIContext()?.isSoundEnabled() ?? true,
        soundVolume: getUIContext()?.getSoundVolume() ?? 0.8,
    };
}

export function applyUISettings(settings: UISettings): void {
    const ctx = getUIContext();
    const mapEl = document.getElementById('map');
    const logEl = document.getElementById('log');
    const hoverEl = document.getElementById('hover');
    const championsEl = document.getElementById('champions');
    const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
    const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
    const logButton = document.getElementById('btn-log') as HTMLButtonElement | null;
    const hoverButton = document.getElementById('btn-hover') as HTMLButtonElement | null;
    const championsButton = document.getElementById('btn-champions') as HTMLButtonElement | null;
    const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;
    const crtButton = document.getElementById('btn-crt') as HTMLButtonElement | null;
    const soundButton = document.getElementById('btn-sound') as HTMLButtonElement | null;
    const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;

    mapEl && (mapEl.style.display = settings.mapVisible ? 'block' : 'none');
    logEl && (logEl.style.display = settings.logVisible ? 'block' : 'none');
    hoverEl && (hoverEl.style.display = settings.hoverVisible ? 'block' : 'none');
    championsEl && (championsEl.style.display = settings.championsVisible ? 'block' : 'none');

    setDebugFeaturesEnabled(settings.debug);
    debugButton?.classList.toggle('is-pressed', settings.debug);
    mapButton?.classList.toggle('is-pressed', settings.mapVisible);
    logButton?.classList.toggle('is-pressed', settings.logVisible);
    hoverButton?.classList.toggle('is-pressed', settings.hoverVisible);
    championsButton?.classList.toggle('is-pressed', settings.championsVisible);
    updateChampionPanel();

    if (ctx) {
        const style = ctx.renderer.getCanvasStyle();
        style.imageRendering = settings.smooth ? 'smooth' : 'pixelated';
    }
    smoothButton?.classList.toggle('is-pressed', settings.smooth);
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
        logVisible: true,
        hoverVisible: true,
        championsVisible: false,
        smooth: false,
        debug: false,
        crt: false,
        soundEnabled: true,
        soundVolume: 0.8,
    };
}
