import type { Game } from '../engine/Game';
import type { GameScreen } from '../renderer/GameScreen';

export interface UIContext {
    screen: GameScreen;
    game: Game;
    refreshScreen: () => void;
    onQuickSave: () => void;
    onQuickLoad: () => void;
    setCrtEnabled: (enabled: boolean) => boolean;
    isCrtEnabled: () => boolean;
    setSoundEnabled: (enabled: boolean) => void;
    isSoundEnabled: () => boolean;
    setSoundVolume: (volume: number) => void;
    getSoundVolume: () => number;
}

let context: UIContext | null = null;
let debugFeaturesEnabled = false;
let extrasEnabled = false;

export function setUIContext(next: UIContext): void {
    context = next;
}

export function getUIContext(): UIContext | null {
    return context;
}

export function setDebugFeaturesEnabled(enabled: boolean): void {
    debugFeaturesEnabled = enabled;
}

export function isDebugFeaturesEnabled(): boolean {
    return debugFeaturesEnabled;
}

/** The extras' one setting (`DEBT.md` X): what CSBWin does not have, off by default. */
export function setExtrasEnabled(enabled: boolean): void {
    extrasEnabled = enabled;
}

export function isExtrasEnabled(): boolean {
    return extrasEnabled;
}
