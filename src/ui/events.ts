import { GameInput } from '../renderer/GameInput';
import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';
import { handleMapCanvasClick } from './mapPreview';
import { updateChampionPanel } from './championPanel';
import { applyUISettings, loadUISettings, readUISettings, saveUISettings } from './settings';
import { getEventPosition } from './utils';

let uiBound = false;

const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;
const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
const championsButton = document.getElementById('btn-champions') as HTMLButtonElement | null;
const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;
const crtButton = document.getElementById('btn-crt') as HTMLButtonElement | null;
const soundButton = document.getElementById('btn-sound') as HTMLButtonElement | null;
const soundVolume = document.getElementById('sound-volume') as HTMLInputElement | null;
const dmRulesButton = document.getElementById('btn-dm-rules') as HTMLButtonElement | null;

function bindCanvasEvents(canvas: HTMLCanvasElement | null, input: GameInput): void {
    if (!canvas) return;
    if (canvas.dataset.uiBound === 'true') return;
    canvas.dataset.uiBound = 'true';

    canvas.addEventListener('mousemove', (e) => {
        const { x, y } = getEventPosition(canvas, e);
        input.mouseMove(x, y);
    });

    canvas.addEventListener('mousedown', (e) => {
        const { x, y } = getEventPosition(canvas, e);
        input.mouseDown(x, y, e.button);
    });

    canvas.addEventListener('mouseup', () => input.mouseUp());

    canvas.addEventListener('wheel', (e) => {
        if (input.wheel(e.deltaY)) e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('mouseleave', () => input.mouseLeave());
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
        // (doc/CSBwin-src/CSBUI.cpp:912-914). It is the game's, not the page's: a save
        // carries it and a read game or the boot may set it, so it is not a UI setting. The
        // menu reads its check mark afresh each time it opens (`WM_INITMENUPOPUP`,
        // doc/CSBwin-src/CSBwin.cpp:1116, :1162-1166); the button is always in view, so it
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
    }

    applyUISettings(loadUISettings());
}
