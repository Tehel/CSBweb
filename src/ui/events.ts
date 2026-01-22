import { MovementAction } from '../engine';
import { getUIContext, isDebugFeaturesEnabled, setDebugFeaturesEnabled } from './context';
import { updateDebug } from './messages';
import { handleMapCanvasClick } from './mapPreview';
import { applyUISettings, loadUISettings, readUISettings, saveUISettings } from './settings';
import { getEventPosition, isViewportPoint } from './utils';

let uiBound = false;

const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const mapCanvasEl = document.getElementById('map-canvas') as HTMLCanvasElement | null;
const debugButton = document.getElementById('btn-debug') as HTMLButtonElement | null;
const mapButton = document.getElementById('btn-map') as HTMLButtonElement | null;
const logButton = document.getElementById('btn-log') as HTMLButtonElement | null;
const hoverButton = document.getElementById('btn-hover') as HTMLButtonElement | null;
const smoothButton = document.getElementById('btn-smooth') as HTMLButtonElement | null;

export function bindUIEvents(): void {
    const ctx = getUIContext();
    if (!ctx) return;

    if (!uiBound) {
        uiBound = true;

        gameCanvasEl?.addEventListener('mousemove', (e) => {
            if (!ctx.renderer) return;
            const { x, y } = getEventPosition(gameCanvasEl, e);
            ctx.renderer.setHoverPoint({ x, y });
            ctx.renderView();
        });

        gameCanvasEl?.addEventListener('mousedown', (e) => {
            const { x, y } = getEventPosition(gameCanvasEl, e);
            const buttonMask = e.button === 2 ? 1 : e.button === 0 ? 2 : 0;
            if (buttonMask !== 0) {
                ctx.renderer.enqueueMouseClick(x, y, buttonMask);
                if (buttonMask === 2 && isViewportPoint(x, y)) {
                    if (ctx.renderer.isWallDecorationHit(x, y) && ctx.game.handleWallClick()) ctx.renderView();
                }
                ctx.renderView();
            }
        });

        gameCanvasEl?.addEventListener('mouseup', () => {
            ctx.renderer.enqueueMouseUnclick();
            ctx.renderView();
        });

        gameCanvasEl?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        gameCanvasEl?.addEventListener('mouseleave', () => {
            ctx.renderer.setHoverPoint(null);
            ctx.renderView();
        });

        document.getElementById('btn-qsave')?.addEventListener('click', () => ctx.onQuickSave());
        document.getElementById('btn-qload')?.addEventListener('click', () => ctx.onQuickLoad());

        smoothButton?.addEventListener('click', () => {
            const style = ctx.renderer.getCanvasStyle();
            style.imageRendering = style.imageRendering === 'smooth' ? 'pixelated' : 'smooth';
            smoothButton.classList.toggle('is-pressed', style.imageRendering === 'smooth');
            saveUISettings(readUISettings());
        });

        debugButton?.addEventListener('click', () => {
            const next = !isDebugFeaturesEnabled();
            setDebugFeaturesEnabled(next);
            debugButton.classList.toggle('is-pressed', next);
            updateDebug(next ? 'Debug features enabled' : 'Debug features disabled');
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

        logButton?.addEventListener('click', () => {
            const logEl = document.getElementById('debug');
            if (!logEl) return;
            const visible = logEl.style.display !== 'none';
            logEl.style.display = visible ? 'none' : 'block';
            logButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        hoverButton?.addEventListener('click', () => {
            const hoverEl = document.getElementById('hover');
            if (!hoverEl) return;
            const visible = hoverEl.style.display !== 'none';
            hoverEl.style.display = visible ? 'none' : 'block';
            hoverButton.classList.toggle('is-pressed', !visible);
            saveUISettings(readUISettings());
        });

        document.addEventListener('keydown', (e) => {
            let handled = false;
            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                    ctx.game.move(MovementAction.MOVE_FORWARD);
                    handled = true;
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                    ctx.game.move(MovementAction.MOVE_BACKWARD);
                    handled = true;
                    break;
                case 'ArrowLeft':
                case 'q':
                case 'Q':
                    ctx.game.move(MovementAction.TURN_LEFT);
                    handled = true;
                    break;
                case 'ArrowRight':
                case 'e':
                case 'E':
                    ctx.game.move(MovementAction.TURN_RIGHT);
                    handled = true;
                    break;
                case 'a':
                case 'A':
                    ctx.game.move(MovementAction.STRAFE_LEFT);
                    handled = true;
                    break;
                case 'd':
                case 'D':
                    ctx.game.move(MovementAction.STRAFE_RIGHT);
                    handled = true;
                    break;
                case 'Escape':
                    ctx.game.setPaused(!ctx.game.state.paused);
                    updateDebug(ctx.game.state.paused ? 'Game paused' : 'Game resumed');
                    handled = true;
                    break;
                case 'F5':
                    ctx.onQuickSave();
                    handled = true;
                    break;
                case 'F9':
                    ctx.onQuickLoad();
                    handled = true;
                    break;
                case 'F8':
                    ctx.onInjectRandomParty();
                    handled = true;
                    break;
                case 'F7':
                    ctx.onToggleAttackPanel();
                    handled = true;
                    break;
            }
            if (handled) e.preventDefault();
        });

        mapCanvasEl?.addEventListener('click', (e) => {
            handleMapCanvasClick(e);
        });
    }

    applyUISettings(loadUISettings());
}
