import { GameInput } from '../renderer/GameInput';
import { getUIContext, isDebugFeaturesEnabled, isExtrasEnabled, setDebugFeaturesEnabled, setExtrasEnabled } from './context';
import { handleMapCanvasClick } from './mapPreview';
import { updateChampionPanel } from './championPanel';
import { applyUISettings, loadUISettings, readUISettings, saveUISettings } from './settings';
import { getEventPosition } from './utils';
import { bindOverlayControl } from './overlayControl';

let uiBound = false;

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;
const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
const championsButton = document.getElementById('btn-champions') as HTMLButtonElement | null;
const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;
const crtButton = document.getElementById('btn-crt') as HTMLButtonElement | null;
const soundButton = document.getElementById('btn-sound') as HTMLButtonElement | null;
const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;
const extrasButton = document.getElementById('btn-extras') as HTMLButtonElement | null;
const dmRulesButton = document.getElementById('btn-dm-rules') as HTMLButtonElement | null;

/**
 * The canvas's pointer, read through pointer events rather than mouse events. A browser
 * sends a finger's or a stylus's mouse events only once it lifts, the press and the
 * release together, so nothing could be held down: the eye, to read a scroll or a
 * champion's masteries. A pointer event comes as it happens, for a mouse as for a touch.
 * The canvas's `touch-action: none` (`index.html`) keeps the browser from taking a
 * touch for a scroll or a zoom, and cancelling it. Only the primary pointer counts.
 *
 * A finger leaves the canvas as it lifts, and the cursor would go with it, the object in
 * hand included: only a mouse's leaving takes the cursor off. A finger is first seen as
 * it presses, so the press puts the cursor where it is.
 */
function bindCanvasEvents(canvas: HTMLCanvasElement | null, input: GameInput): void {
    if (!canvas) return;
    if (canvas.dataset.uiBound === 'true') return;
    canvas.dataset.uiBound = 'true';

    canvas.addEventListener('pointermove', (e) => {
        if (!e.isPrimary) return;
        const { x, y } = getEventPosition(canvas, e);
        input.mouseMove(x, y);
    });

    canvas.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary) return;
        const { x, y } = getEventPosition(canvas, e);
        if (e.pointerType !== 'mouse') input.mouseMove(x, y);
        input.mouseDown(x, y, e.button);
    });

    canvas.addEventListener('pointerup', (e) => {
        if (e.isPrimary) input.mouseUp();
    });

    canvas.addEventListener('pointercancel', (e) => {
        if (e.isPrimary) input.mouseUp();
    });

    canvas.addEventListener('wheel', (e) => {
        if (input.wheel(e.deltaY)) e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('pointerleave', (e) => {
        if (e.isPrimary && e.pointerType === 'mouse') input.mouseLeave();
    });
}

/**
 * The Extras button, bound before the intro and not with the rest in `bindUIEvents`: the
 * FTL logo is an extra, which the boot shows, so the entrance is where it is switched, for
 * the next load. The extras in play take the setting at once: `onChange` is told it now
 * and at every press. Until the game is wired the other settings are only the saved ones,
 * which `readUISettings` cannot read off the page: the saved set is written back with this
 * one flag changed.
 */
export function bindExtrasToggle(onChange: (enabled: boolean) => void): void {
    setExtrasEnabled(loadUISettings().extras);
    onChange(isExtrasEnabled());
    if (!extrasButton) return;
    extrasButton.classList.toggle('is-pressed', isExtrasEnabled());
    extrasButton.addEventListener('click', () => {
        const next = !isExtrasEnabled();
        setExtrasEnabled(next);
        onChange(next);
        extrasButton.classList.toggle('is-pressed', next);
        console.info(next ? 'Extras enabled' : 'Extras disabled');
        saveUISettings({ ...loadUISettings(), extras: next });
    });
}

export function bindUIEvents(): void {
    const ctx = getUIContext();
    if (!ctx) return;

    const input = new GameInput(ctx);
    const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
    bindCanvasEvents(gameCanvasEl, input);

    if (!uiBound) {
        uiBound = true;

        input.install();

        document.getElementById('btn-qsave')?.addEventListener('click', () => ctx.onQuickSave());
        document.getElementById('btn-qload')?.addEventListener('click', () => ctx.onQuickLoad());

        smoothButton?.addEventListener('click', () => {
            const style = ctx.screen.getCanvasStyle();
            style.imageRendering = style.imageRendering === 'auto' ? 'pixelated' : 'auto';
            smoothButton.classList.toggle('is-pressed', style.imageRendering === 'auto');
            saveUISettings(readUISettings());
        });

        crtButton?.addEventListener('click', () => {
            const next = !ctx.isCrtEnabled();
            const enabled = ctx.setCrtEnabled(next);
            crtButton.classList.toggle('is-pressed', enabled);
            if (next && !enabled) console.warn('CRT effect unavailable');
            else console.info(enabled ? 'CRT effect enabled' : 'CRT effect disabled');
            saveUISettings(readUISettings());
        });

        soundButton?.addEventListener('click', () => {
            const next = !ctx.isSoundEnabled();
            ctx.setSoundEnabled(next);
            soundButton.classList.toggle('is-pressed', next);
            console.info(next ? 'Sound enabled' : 'Sound disabled');
            saveUISettings(readUISettings());
        });

        soundVolume?.addEventListener('input', () => {
            const value = Math.max(0, Math.min(100, Number(soundVolume.value)));
            ctx.setSoundVolume(value / 100);
            saveUISettings(readUISettings());
        });

        debugButton?.addEventListener('click', () => {
            const next = !isDebugFeaturesEnabled();
            setDebugFeaturesEnabled(next);
            debugButton.classList.toggle('is-pressed', next);
            console.info(next ? 'Debug features enabled' : 'Debug features disabled');
            saveUISettings(readUISettings());
        });

        mapButton?.addEventListener('click', () => {
            const mapEl = document.getElementById('map');
            if (!mapEl) return;
            const visible = mapEl.style.display !== 'none';
            mapEl.style.display = visible ? 'none' : 'block';
            mapButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        championsButton?.addEventListener('click', () => {
            const championsEl = document.getElementById('champions');
            if (!championsEl) return;
            const visible = championsEl.style.display !== 'none';
            championsEl.style.display = visible ? 'none' : 'block';
            championsButton.classList.toggle('is-pressed', !visible);
            updateChampionPanel();
            saveUISettings(readUISettings());
        });

        // CSBWin's "DM Rules" menu item: `DM_rules = !DM_rules`, at any time
        // (doc/CSBwin-src/CSBUI.cpp:933-935). It is the game's, not the page's: a save
        // carries it and a read game or the boot may set it, so it is not a UI setting. The
        // menu reads its check mark afresh each time it opens (`WM_INITMENUPOPUP`,
        // doc/CSBwin-src/CSBwin.cpp:1120, :1166-1170); the button is always in view, so it
        // reads it every tick.
        const showDMRules = (): void => {
            dmRulesButton?.classList.toggle('is-pressed', ctx.game.ctx.rules.dmRules);
        };
        dmRulesButton?.addEventListener('click', () => {
            ctx.game.ctx.rules.dmRules = !ctx.game.ctx.rules.dmRules;
            showDMRules();
            console.info(ctx.game.ctx.rules.dmRules ? 'DM Rules on' : 'DM Rules off');
        });
        ctx.game.onTick(showDMRules);

        // Once per game tick, which is when skills and attributes can change. The panel
        // does nothing while it is hidden.
        ctx.game.onTick(() => updateChampionPanel());

        document.addEventListener('keydown', (e) => {
            if (input.keyDown(e.key, e)) e.preventDefault();
        });

        mapCanvasEl?.addEventListener('click', (e) => {
            handleMapCanvasClick(e);
        });

        bindOverlayControl(ctx);
    }

    applyUISettings(loadUISettings());
}
