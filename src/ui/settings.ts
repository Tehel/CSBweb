import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';

const UI_SETTINGS_KEY = 'dmweb_ui_settings_v1';

export interface UISettings {
    mapVisible: boolean;
    logVisible: boolean;
    hoverVisible: boolean;
    smooth: boolean;
    debug: boolean;
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
            smooth: parsed.smooth ?? false,
            debug: parsed.debug ?? false,
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
    const logVisible = (document.getElementById('debug')?.style.display ?? '') !== 'none';
    const hoverVisible = (document.getElementById('hover')?.style.display ?? '') !== 'none';
    const smooth = getUIContext()?.renderer.getCanvasStyle().imageRendering === 'smooth';
    return {
        mapVisible,
        logVisible,
        hoverVisible,
        smooth,
        debug: isDebugFeaturesEnabled(),
    };
}

export function applyUISettings(settings: UISettings): void {
    const ctx = getUIContext();
    const mapEl = document.getElementById('map');
    const logEl = document.getElementById('debug');
    const hoverEl = document.getElementById('hover');
    const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
    const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
    const logButton = document.getElementById('btn-log') as HTMLButtonElement | null;
    const hoverButton = document.getElementById('btn-hover') as HTMLButtonElement | null;
    const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;

    mapEl && (mapEl.style.display = settings.mapVisible ? 'block' : 'none');
    logEl && (logEl.style.display = settings.logVisible ? 'block' : 'none');
    hoverEl && (hoverEl.style.display = settings.hoverVisible ? 'block' : 'none');

    setDebugFeaturesEnabled(settings.debug);
    debugButton?.classList.toggle('is-pressed', settings.debug);
    mapButton?.classList.toggle('is-pressed', settings.mapVisible);
    logButton?.classList.toggle('is-pressed', settings.logVisible);
    hoverButton?.classList.toggle('is-pressed', settings.hoverVisible);

    if (ctx) {
        const style = ctx.renderer.getCanvasStyle();
        style.imageRendering = settings.smooth ? 'smooth' : 'pixelated';
    }
    smoothButton?.classList.toggle('is-pressed', settings.smooth);
}

function defaultUISettings(): UISettings {
    return { mapVisible: true, logVisible: true, hoverVisible: true, smooth: false, debug: false };
}
