/**
 * Dungeon Master Web
 */

import { DBType, Direction, Position, RoomType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF } from './core';
import { SoundManager } from './audio';
import { CSBGraphicsLoader, DungeonData, DungeonLoader, GraphicsLoader, type PresetHero } from './data';
import { loadSaveGameState, applySaveGameState, saveSaveGameState, type SaveGameState } from './data/SaveGameLoader';
import { Game, MovementAction, type ActuatorTables, type TimerTables, type TimerHooks, type Champion, type PartyState, type RuntimeSaveState, assignPresetHeroPossessions, createChampionFromPreset, createSkillsFromSubskillLevels, type AddCharacterTables, type MissileTraceEvent } from './engine';
import { loadGlfx } from './lib/glfx-loader';
import { ViewportRenderer } from './renderer/ViewportRenderer';
import { extractObjectTables } from './renderer/csbwin/ObjectTables';
import { extractUITables } from './renderer/csbwin/UITables';
import { extractViewportTables } from './renderer/csbwin/ViewportTables';
import { bindUIContext, drawMapPreview, handleCursorFilter, updateDebug, appendLog, clearLog } from './ui';

console.log('Dungeon Master Web - Initializing...');

// Global game instance
let game: Game | null = null;
let renderer: ViewportRenderer | null = null;
let graphicsLoader: GraphicsLoader | null = null;
let dungeonLoader: DungeonLoader | null = null;
let csbGraphicsLoader: CSBGraphicsLoader | null = null;
let dungeonData: DungeonData | null = null;
let soundManager: SoundManager | null = null;
let addCharacterTables: AddCharacterTables | null = null;
let actuatorTables: ActuatorTables | null = null;
let timerTables: TimerTables | null = null;
let crtController: CrtController | null = null;

const QUICK_SAVEGAME_RAW_KEY = 'dmweb_savegame_raw_v1';
const GAME_DATA_DIR = '/gamefiles/dm-atari';
const CRT_SCANLINES_SRC = '/QPN59-320x200-resized.png';
const CRT_UPDATE_INTERVAL_MS = 1000 / 20;
const MISSILE_WEAPON_DAGGER = 8;
const MISSILE_WEAPON_ARROW = 27;
const POTION_FUL_BOMB = 19;
const DIR_STEPS = [
    { dir: Direction.NORTH, dx: 0, dy: -1 },
    { dir: Direction.EAST, dx: 1, dy: 0 },
    { dir: Direction.SOUTH, dx: 0, dy: 1 },
    { dir: Direction.WEST, dx: -1, dy: 0 },
];
let missileTraceEnabled = false;
let missileScenarioIndex = 0;

const gameCanvasEl = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!gameCanvasEl) console.log(`Couldn't find game canvas !`);

interface CrtController {
    isAvailable: () => boolean;
    isEnabled: () => boolean;
    setEnabled: (enabled: boolean) => boolean;
}

function createCrtController(canvas: HTMLCanvasElement): CrtController {
    let enabled = false;
    let intervalId: number | null = null;
    let glcanvas: GLFXCanvas | null = null;
    let texture: GLFXTexture | null = null;
    let lines: HTMLImageElement | null = null;

    const available = !!fx && typeof fx.canvas === 'function';
    if (!available)
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };

    try {
        glcanvas = fx.canvas();
    } catch (e) {
        console.warn('glfx failed to initialize; CRT effect disabled');
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };
    }

    const parent = canvas.parentNode;
    if (!parent)
        return { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };

    glcanvas.width = canvas.width;
    glcanvas.height = canvas.height;
    glcanvas.className = canvas.className;
    glcanvas.id = `${canvas.id}_gl`;
    glcanvas.style.display = 'none';
    parent.appendChild(glcanvas);

    lines = new Image();
    lines.src = CRT_SCANLINES_SRC;
    texture = glcanvas.texture(canvas);

    const draw = (): void => {
        const ctx = canvas.getContext('2d');
        if (!ctx || !glcanvas || !texture || !lines) return;
        const w = canvas.width;
        const h = canvas.height;
        if (lines.complete && lines.naturalWidth > 0) {
            ctx.drawImage(lines, 0, 0, w, h);
        }
        texture.loadContentsOf(canvas);

        const hw = w / 2;
        const hh = h / 2;
        const w75 = w * 0.75;
        glcanvas
            .draw(texture)
            .bulgePinch(hw, hh, w75, 0.12)
            .vignette(0.25, 0.74)
            .update();
    };

    const start = (): void => {
        if (intervalId !== null) return;
        intervalId = window.setInterval(draw, CRT_UPDATE_INTERVAL_MS);
    };

    const stop = (): void => {
        if (intervalId === null) return;
        window.clearInterval(intervalId);
        intervalId = null;
    };

    return {
        isAvailable: () => true,
        isEnabled: () => enabled,
        setEnabled: (next: boolean) => {
            if (next === enabled) return enabled;
            if (!glcanvas) return false;
            if (next) {
                start();
                canvas.style.display = 'none';
                glcanvas.style.display = '';
            } else {
                stop();
                glcanvas.style.display = 'none';
                canvas.style.display = '';
                renderView();
            }
            enabled = next;
            return enabled;
        },
    };
}


function decodeBase64ToBytes(data: string): Uint8Array {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
}

function encodeBytesToBase64(data: Uint8Array): string {
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize);
        bin += String.fromCharCode(...chunk);
    }
    return btoa(bin);
}

const RANDOM_NAMES = [ 'Halk', 'Leif', 'Tiggy', 'Chani', 'Gothmog', 'Zed', 'Wuuuf', 'Nabi'];
const RANDOM_PORTRAIT_COUNT = 24;

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRandomChampion(partyPosition: number): Champion {
    const alive = Math.random() > 0.1;
    const maxHealth = randomInt(60, 180);
    const maxStamina = randomInt(40, 160);
    const maxMana = randomInt(20, 120);
    const name = RANDOM_NAMES[randomInt(0, RANDOM_NAMES.length-1)];
    const weaponHand = randomInt(0, 95);
    const shieldHand = Math.random() > 0.5 ? randomInt(0, 95) : null;
    const possessions: Array<number | null> = new Array(30).fill(null);
    possessions[0] = shieldHand;
    possessions[1] = weaponHand;
    for (let slot = 2; slot < possessions.length; slot++) {
        if (Math.random() < 0.3) {
            possessions[slot] = randomInt(0, 95);
        }
    }
    const skills = createSkillsFromSubskillLevels(randomSkillLevels());

    return {
        name,
        attributes: {
            health: alive ? randomInt(10, maxHealth) : 0,
            maxHealth,
            stamina: alive ? randomInt(10, maxStamina) : 0,
            maxStamina,
            mana: alive ? randomInt(0, maxMana) : 0,
            maxMana,
            luck: randomInt(20, 80),
            strength: randomInt(20, 80),
            dexterity: randomInt(20, 80),
            wisdom: randomInt(20, 80),
            vitality: randomInt(20, 80),
            antiMagic: randomInt(20, 80),
            antiFire: randomInt(20, 80),
            experience: randomInt(0, 65000),
            fighter: randomInt(1, 8),
            ninja: randomInt(1, 8),
            priest: randomInt(1, 8),
            wizard: randomInt(1, 8),
        },
        alive,
        portraitGraphic: randomInt(0, RANDOM_PORTRAIT_COUNT - 1),
        incantation: [],
        food: randomInt(0, 2047),
        water: randomInt(0, 2047),
        wounds: randomInt(0, 0x3f),
        poisonCount: Math.random() < 0.2 ? randomInt(1, 3) : 0,
        skills,
        weaponHand,
        shieldHand,
        quiver: null,
        shieldStrength: 0,
        possessions,
        partyPosition,
        facing: partyPosition & 3,
    };
}

function randomSkillLevels(): number[] {
    const levels: number[] = [];
    for (let i = 0; i < 16; i++) {
        levels.push(randomInt(0, 4));
    }
    return levels;
}

function formatMissileTrace(event: MissileTraceEvent): string {
    const dirLabel = ['N', 'E', 'S', 'W'][event.direction & 0x3] ?? '?';
    const tick = game?.getTickCount() ?? 0;
    const detail = event.detail ? ` ${event.detail}` : '';
    const hit = event.hit === undefined ? '' : ` hit=${event.hit ? 1 : 0}`;
    const rn = event.missile.toString(16).padStart(4, '0');
    const projectile = event.projectile.toString(16).padStart(4, '0');
    return `[MissileTrace] ${event.stage} t=${tick} rn=0x${rn} proj=0x${projectile} L${event.position.z}(${event.position.x},${event.position.y}) pos=${event.posInCell} dir=${dirLabel} range=${event.range} dmg=${event.damage}${hit}${detail}`;
}

function toggleMissileTrace(): void {
    missileTraceEnabled = !missileTraceEnabled;
    if (missileTraceEnabled) clearLog();
    updateDebug(missileTraceEnabled ? 'Missile trace ON' : 'Missile trace OFF');
}

function ensureScenarioParty(): boolean {
    if (!game) return false;
    if (game.party.state.champions.length === 0) {
        const champion = createRandomChampion(0);
        if (!game.addChampion(champion)) return false;
        game.state.party = game.party.state;
    }
    const party = game.party.state;
    if (party.cursorOwner < 0) party.cursorOwner = 0;
    if (party.selectedCharacterIndex < 0) party.selectedCharacterIndex = party.cursorOwner;
    return true;
}

function setPartyPosition(position: Position, facing: Direction): void {
    if (!game) return;
    const current = game.party.state;
    const next: PartyState = {
        ...current,
        position,
        facing,
        moving: false,
        turning: false,
        lastMoveTime: 0,
    };
    game.setPartyState(next);
}

function loadCursorObject(rn: number): void {
    if (!game) return;
    const party = game.party.state;
    party.cursorOwner = party.cursorOwner < 0 ? 0 : party.cursorOwner;
    party.selectedCharacterIndex = party.cursorOwner;
    party.objectInHand = rn;
    game.state.party = party;
}

function createWeaponRecord(weaponType: number): number {
    if (!game) return OBJECT_ID_EOF;
    const data = game.dungeonState.getData();
    data.databases.weapons.records.push({
        nextObject: OBJECT_ID_EOF,
        broken: false,
        charges: 0,
        litTorch: false,
        poisoned: false,
        cursed: false,
        important: false,
        weaponType: weaponType & 0x7f,
    });
    data.databases.weapons.count++;
    data.header.objectCounts[DBType.WEAPON] = ((data.header.objectCounts[DBType.WEAPON] ?? 0) + 1) & 0xffff;
    const index = data.databases.weapons.records.length - 1;
    return encodeObjectID(0, DBType.WEAPON, index);
}

function createPotionRecord(potionType: number, power: number): number {
    if (!game) return OBJECT_ID_EOF;
    const data = game.dungeonState.getData();
    data.databases.potions.records.push({
        nextObject: OBJECT_ID_EOF,
        important: false,
        potionType: potionType & 0x7f,
        power: power & 0xff,
    });
    data.databases.potions.count++;
    data.header.objectCounts[DBType.POTION] = ((data.header.objectCounts[DBType.POTION] ?? 0) + 1) & 0xffff;
    const index = data.databases.potions.records.length - 1;
    return encodeObjectID(0, DBType.POTION, index);
}

function findOpenCellFacingRoomType(targetRoomType: number): { position: Position; facing: Direction } | null {
    if (!game) return null;
    const dungeonState = game.dungeonState;
    const mapCount = dungeonState.getMapCount();
    for (let z = 0; z < mapCount; z++) {
        const map = dungeonState.getMap(z);
        if (!map) continue;
        for (let y = 0; y < map.descriptor.height; y++) {
            for (let x = 0; x < map.descriptor.width; x++) {
                const cellFlag = map.cellFlags[x][y];
                const roomType = (cellFlag >> 5) & 0x7;
                if (roomType !== RoomType.OPEN) continue;
                for (const step of DIR_STEPS) {
                    const nx = x + step.dx;
                    const ny = y + step.dy;
                    if (nx < 0 || ny < 0 || nx >= map.descriptor.width || ny >= map.descriptor.height) continue;
                    const neighbor = map.cellFlags[nx][ny];
                    const neighborType = (neighbor >> 5) & 0x7;
                    if (neighborType !== targetRoomType) continue;
                    return { position: new Position(x, y, z), facing: step.dir };
                }
            }
        }
    }
    return null;
}

function findOpenCellWithOpenNeighbor(): { position: Position; facing: Direction } | null {
    return findOpenCellFacingRoomType(RoomType.OPEN);
}

function findAdjacentOpenCell(target: Position): { position: Position; facing: Direction } | null {
    if (!game) return null;
    const map = game.dungeonState.getMap(target.z);
    if (!map) return null;
    for (const step of DIR_STEPS) {
        const px = target.x - step.dx;
        const py = target.y - step.dy;
        if (px < 0 || py < 0 || px >= map.descriptor.width || py >= map.descriptor.height) continue;
        const cellFlag = map.cellFlags[px][py];
        const roomType = (cellFlag >> 5) & 0x7;
        if (roomType === RoomType.OPEN) {
            return { position: new Position(px, py, target.z), facing: step.dir };
        }
    }
    return null;
}

function findMonsterWithAbsorption(): { position: Position; monster: number } | null {
    if (!game) return null;
    const monsterDesc = timerTables?.monsterDesc;
    if (!monsterDesc) return null;
    const dungeonState = game.dungeonState;
    const mapCount = dungeonState.getMapCount();
    for (let z = 0; z < mapCount; z++) {
        const map = dungeonState.getMap(z);
        if (!map) continue;
        for (let y = 0; y < map.descriptor.height; y++) {
            for (let x = 0; x < map.descriptor.width; x++) {
                const pos = new Position(x, y, z);
                for (let rn = dungeonState.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeonState.getDBRecordLink(rn)) {
                    const decoded = decodeObjectID(rn);
                    if (decoded.category !== DBType.CREATURE) continue;
                    const creature = dungeonState.getCreatureRecord(rn);
                    if (!creature) continue;
                    const desc = monsterDesc[creature.creatureType];
                    if (!desc || (desc.word2 & 0x400) === 0) continue;
                    return { position: pos, monster: rn };
                }
            }
        }
    }
    return null;
}

function runMissileScenarioDoor(): boolean {
    if (!game) return false;
    if (!ensureScenarioParty()) return false;
    const spot = findOpenCellFacingRoomType(RoomType.DOOR);
    if (!spot) {
        updateDebug('Missile scenario: no door cell found');
        return false;
    }
    setPartyPosition(spot.position, spot.facing);
    const weapon = createWeaponRecord(MISSILE_WEAPON_DAGGER);
    if (weapon === OBJECT_ID_EOF) return false;
    loadCursorObject(weapon);
    const thrown = game.throwObjectFromCursor(0);
    appendLog(`[Scenario] door: ${thrown ? 'thrown' : 'throw failed'}`);
    renderView();
    return thrown;
}

function runMissileScenarioWall(): boolean {
    if (!game) return false;
    if (!ensureScenarioParty()) return false;
    const spot = findOpenCellFacingRoomType(RoomType.STONE);
    if (!spot) {
        updateDebug('Missile scenario: no wall cell found');
        return false;
    }
    setPartyPosition(spot.position, spot.facing);
    const weapon = createWeaponRecord(MISSILE_WEAPON_DAGGER);
    if (weapon === OBJECT_ID_EOF) return false;
    loadCursorObject(weapon);
    const thrown = game.throwObjectFromCursor(0);
    appendLog(`[Scenario] wall: ${thrown ? 'thrown' : 'throw failed'}`);
    renderView();
    return thrown;
}

function runMissileScenarioStepAway(): boolean {
    if (!game) return false;
    if (!ensureScenarioParty()) return false;
    const spot = findOpenCellWithOpenNeighbor();
    if (!spot) {
        updateDebug('Missile scenario: no open cell for step-away');
        return false;
    }
    setPartyPosition(spot.position, spot.facing);
    const weapon = createWeaponRecord(MISSILE_WEAPON_ARROW);
    if (weapon === OBJECT_ID_EOF) return false;
    const posInCell = game.party.state.champions[0]?.partyPosition ?? 0;
    const launched = game.debugLaunchMissileDelayed(
        weapon,
        spot.position,
        posInCell,
        spot.facing,
        6,
        20,
        1,
        4,
    );
    const moved = game.move(MovementAction.MOVE_FORWARD);
    appendLog(`[Scenario] step-away: missile=${launched ? 'armed' : 'failed'} move=${moved ? 'ok' : 'blocked'}`);
    renderView();
    return launched && moved;
}

function runMissileScenarioPotion(): boolean {
    if (!game) return false;
    if (!ensureScenarioParty()) return false;
    const spot = findOpenCellFacingRoomType(RoomType.STONE);
    if (!spot) {
        updateDebug('Missile scenario: no wall cell for potion splash');
        return false;
    }
    setPartyPosition(spot.position, spot.facing);
    const potion = createPotionRecord(POTION_FUL_BOMB, 40);
    if (potion === OBJECT_ID_EOF) return false;
    loadCursorObject(potion);
    const thrown = game.throwObjectFromCursor(0);
    appendLog(`[Scenario] potion splash: ${thrown ? 'thrown' : 'throw failed'}`);
    renderView();
    return thrown;
}

function runMissileScenarioMonsterAbsorb(): boolean {
    if (!game) return false;
    if (!ensureScenarioParty()) return false;
    const monster = findMonsterWithAbsorption();
    if (!monster) {
        updateDebug('Missile scenario: no absorb-capable monster found');
        return false;
    }
    const spot = findAdjacentOpenCell(monster.position);
    if (!spot) {
        updateDebug('Missile scenario: no open cell near monster');
        return false;
    }
    setPartyPosition(spot.position, spot.facing);
    const weapon = createWeaponRecord(MISSILE_WEAPON_DAGGER);
    if (weapon === OBJECT_ID_EOF) return false;
    loadCursorObject(weapon);
    const thrown = game.throwObjectFromCursor(0);
    appendLog(`[Scenario] monster absorb: ${thrown ? 'thrown' : 'throw failed'}`);
    renderView();
    return thrown;
}

function runNextMissileScenario(): void {
    if (!game) return;
    const scenarios = [
        { label: 'throw into door', run: runMissileScenarioDoor },
        { label: 'throw into wall', run: runMissileScenarioWall },
        { label: 'step-away collision', run: runMissileScenarioStepAway },
        { label: 'potion splash', run: runMissileScenarioPotion },
        { label: 'monster absorption', run: runMissileScenarioMonsterAbsorb },
    ];
    const scenario = scenarios[missileScenarioIndex % scenarios.length];
    missileScenarioIndex = (missileScenarioIndex + 1) % scenarios.length;
    const ok = scenario.run();
    updateDebug(ok ? `Missile scenario: ${scenario.label}` : `Missile scenario failed: ${scenario.label}`);
}

function getAddCharacterTables(): AddCharacterTables | null {
    if (!graphicsLoader) return null;
    if (addCharacterTables) return addCharacterTables;

    const uiTables = extractUITables(graphicsLoader);
    const viewportTables = extractViewportTables(graphicsLoader);
    const objectTables = extractObjectTables(graphicsLoader, viewportTables.wallRectanglesOffset);
    addCharacterTables = {
        carryLocation: uiTables.graphic232.carryLocation,
        objDescCarryMask: objectTables.objDescCarryMask,
    };
    return addCharacterTables;
}

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function pickPresetHeroes(presets: PresetHero[], count: number): PresetHero[] {
    if (presets.length <= count) return presets.slice();
    return shuffle(presets.slice()).slice(0, count);
}

function findPresetHeroByPortrait(
    presets: PresetHero[],
    portraitIndex: number,
    position: { x: number; y: number; z: number },
    wall: number,
): PresetHero | null {
    const exact = presets.find((hero) =>
        hero.portraitIndex === portraitIndex
        && hero.location.map === position.z
        && hero.location.x === position.x
        && hero.location.y === position.y
        && hero.location.wall === wall
    );
    if (exact) return exact;
    return presets.find((hero) => hero.portraitIndex === portraitIndex) ?? null;
}

function addCharacterFromPortrait(portraitIndex: number, position: { x: number; y: number; z: number }, wall: number): boolean {
    if (!game || !dungeonData) return false;
    const party = game.party.state;
    if (party.objectInHand !== null && party.objectInHand !== undefined) return false;
    if (party.champions.length >= 4) return false;

    const hero = findPresetHeroByPortrait(dungeonData.presetHeroes ?? [], portraitIndex, position, wall);
    if (!hero) return false;

    const tables = getAddCharacterTables();
    const possessions = tables
        ? assignPresetHeroPossessions(hero.inventory, tables)
        : new Array(30).fill(null);

    const occupied = new Set(party.champions.map((champ) => champ.partyPosition));
    let partyPosition = 0;
    while (occupied.has(partyPosition) && partyPosition < 4) partyPosition += 1;
    if (partyPosition >= 4) return false;

    const champion = createChampionFromPreset(hero, partyPosition, possessions);
    return game.addChampion(champion);
}

function randomizeChampionVitals(champion: Champion): void {
    const healthRatio = Math.random() * 0.4 + 0.6;
    const staminaRatio = Math.random() * 0.35 + 0.55;
    const manaRatio = Math.random() * 0.5 + 0.5;
    champion.attributes.health = Math.max(1, Math.floor(champion.attributes.maxHealth * healthRatio));
    champion.attributes.stamina = Math.max(1, Math.floor(champion.attributes.maxStamina * staminaRatio));
    champion.attributes.mana = champion.attributes.maxMana > 0
        ? Math.max(0, Math.floor(champion.attributes.maxMana * manaRatio))
        : 0;
    champion.food = randomInt(1200, 2000);
    champion.water = randomInt(1200, 2000);
    champion.wounds = Math.random() < 0.15 ? randomInt(1, 0x3f) : 0;
}

function setCrtEnabled(enabled: boolean): boolean {
    if (!crtController) return false;
    return crtController.setEnabled(enabled);
}

function isCrtEnabled(): boolean {
    return crtController?.isEnabled() ?? false;
}

function injectRandomParty(): void {
    if (!game) return;
    const current = game.party.state;
    const champions: Champion[] = [];
    const presets = dungeonData?.presetHeroes ?? [];
    if (presets.length >= 4) {
        const tables = getAddCharacterTables();
        const picks = pickPresetHeroes(presets, 4);
        for (let i = 0; i < picks.length; i++) {
            const hero = picks[i];
            const possessions = tables
                ? assignPresetHeroPossessions(hero.inventory, tables)
                : new Array(30).fill(null);
            const champion = createChampionFromPreset(hero, i, possessions);
            randomizeChampionVitals(champion);
            champions.push(champion);
        }
    } else {
        for (let i = 0; i < 4; i++) {
            champions.push(createRandomChampion(i));
        }
    }
    const magicCasterIndex = champions.findIndex(c => c.attributes.maxMana > 0);
    const newState: PartyState = {
        ...current,
        champions,
        magicCasterIndex,
        moving: false,
        turning: false,
        lastMoveTime: 0,
    };
    console.log(`new party state: `, newState);
    game.setPartyState(newState);
    updateDebug('Random party injected');
}

function toggleAttackPanel(): void {
    if (!renderer) return;
    const next = !renderer.isAttackPanelVisible();
    renderer.setShowAttackPanel(next);
    updateDebug(next ? 'Attack panel ON' : 'Attack panel OFF');
    renderView();
}

function quickSave(): void {
    if (!game) return;
    const runtime = game.getRuntimeSaveState();
    const item16 = runtime.dungeon.item16 ?? [];
    const timers = runtime.dungeon.timers ?? [];
    const missiles = runtime.dungeon.missiles ?? [];
    const saveGameState: SaveGameState = {
        item16,
        timers,
        missiles,
        maxItem16: item16.length,
        maxTimers: timers.length,
        sequencedTimers: false,
        extendedTimers: false,
    };
    const rawBytes = saveSaveGameState(saveGameState);
    const payload = {
        runtime,
        raw: encodeBytesToBase64(rawBytes),
    };
    localStorage.setItem(QUICK_SAVEGAME_RAW_KEY, JSON.stringify(payload));
    updateDebug('Quick-saved');
}

function quickLoad(): void {
    if (!game) return;
    const raw = localStorage.getItem(QUICK_SAVEGAME_RAW_KEY);
    if (!raw) {
        updateDebug('No quick-save found');
        return;
    }
    try {
        const parsed = JSON.parse(raw) as { runtime: RuntimeSaveState; raw: string };
        const saveBytes = decodeBase64ToBytes(parsed.raw);
        const saveState = loadSaveGameState(saveBytes);
        applySaveGameState(game.state.dungeon, saveState);
        game.applyRuntimeSaveState(parsed.runtime);
        renderView();
        updateDebug('Quick-loaded');
    } catch (error) {
        console.warn('Failed to quick-load:', error);
        updateDebug('Quick-load failed (see console)');
    }
}

// Render the 3D view
function renderView() {
    if (!game || !renderer) return;

    const party = game.party;
    const pos = party.state.position;
    const facing = party.state.facing;

    renderer.setPartyState(party.state);
    renderer.processMouseQueue();
    renderer.render(pos, facing);
}


// Initialize the game
async function init() {
    try {
        updateDebug('Loading Phase 1: Core modules...');

        // Test DungeonLoader
        console.log('Testing DungeonLoader...');
        dungeonLoader = new DungeonLoader();
        try {
            updateDebug('Loading dungeon.dat...');
            const dungeon = await dungeonLoader.load(`${GAME_DATA_DIR}/dungeon.dat`);
            console.log('heroes', dungeon.presetHeroes);
            dungeonData = dungeon;

            console.log(`✓ Loaded dungeon:`, dungeon);
            console.log(`  - Seed: ${dungeon.header.randomSeed}`);
            console.log(`  - Maps: ${dungeon.maps.length}`);
            console.log(`  - Total objects: ${dungeon.header.objectCounts.reduce((a, b) => a + b, 0)}`);
            console.log(`  - Start: (${dungeon.header.startPosition.x}, ${dungeon.header.startPosition.y}) facing ${Direction[dungeon.header.facing]}`);

            // Display first map info
            const firstMap = dungeon.maps[0];
            console.log(`  - First map: ${firstMap.descriptor.width}×${firstMap.descriptor.height}, level ${firstMap.descriptor.level}`);

            // Load graphics
            console.log('Loading graphics.dat...');
            graphicsLoader = new GraphicsLoader();
            await graphicsLoader.load(`${GAME_DATA_DIR}/graphics.dat`);
            console.log(`✓ Loaded graphics: ${graphicsLoader.getItemCount()} items`);

            soundManager = new SoundManager(graphicsLoader);
            if (soundManager.isAvailable()) {
                const unlockAudio = (): void => {
                    soundManager?.unlock();
                };
                if (gameCanvasEl) {
                    gameCanvasEl.addEventListener('pointerdown', unlockAudio, { once: true });
                }
                window.addEventListener('keydown', unlockAudio, { once: true });
            }

            // Optional CSBgraphics.dat overlay (extended decorations, portraits, etc.)
            csbGraphicsLoader = new CSBGraphicsLoader();
            const csbLoaded = await csbGraphicsLoader.tryLoad(`${GAME_DATA_DIR}/CSBgraphics.dat`);
            if (csbLoaded) {
                console.log('✓ Loaded CSBgraphics.dat overlay');
            } else {
                console.log('CSBgraphics.dat not found; extended decorations disabled');
                csbGraphicsLoader = null;
            }

            const uiTables = extractUITables(graphicsLoader);
            const viewportTables = extractViewportTables(graphicsLoader);
            const objectTables = extractObjectTables(graphicsLoader, viewportTables.wallRectanglesOffset);
            soundManager?.setSoundTable(uiTables.graphic232.soundTable);
            if (soundManager?.isAvailable()) {
                soundManager.preloadAll();
            }
            actuatorTables = {
                roomTimerFunctions: uiTables.graphic232.byte1596,
                objDescObjectType: objectTables.objDescObjectType,
                objDescCarryMask: objectTables.objDescCarryMask,
                carryLocation: uiTables.graphic232.carryLocation,
                word1074: uiTables.graphic232.word1074,
                cursorFilter: handleCursorFilter,
                onAddCharacter: (portraitIndex, position, pos) => addCharacterFromPortrait(portraitIndex, position, pos),
                onTextMessage: (text) => updateDebug(text),
                playSound: (soundId, rateIdx, distance) => soundManager?.playSound(soundId, rateIdx, distance),
            };
            timerTables = {
                monsterDesc: objectTables.monsterDesc,
                word1074: uiTables.graphic232.word1074,
            };

            // Initialize game engine
            console.log('Initializing game engine...');
            const timerHooks: TimerHooks = {
                onMissileTrace: (event) => {
                    if (!missileTraceEnabled) return;
                    appendLog(formatMissileTrace(event));
                },
            };
            if (soundManager) {
                timerHooks.playSound = (soundId: number, rateIdx?: number, distance?: number) =>
                    soundManager?.playSound(soundId, rateIdx, distance);
            }
            const playSound = soundManager
                ? (soundId: number, rateIdx?: number, distance?: number) => soundManager?.playSound(soundId, rateIdx, distance)
                : undefined;
            game = new Game(dungeon, actuatorTables, timerTables ?? undefined, undefined, timerHooks, playSound);
            game.setSpellDefinitions(uiTables.graphic230.spells);

            // Initialize viewport renderer
            console.log('Initializing viewport renderer (CSBWin bytecode system)...');
            const dungeonState = game.dungeonState;
            renderer = new ViewportRenderer(graphicsLoader, dungeonState, csbGraphicsLoader ?? undefined);
            await renderer.initialize(gameCanvasEl);
            renderer.setPlaySound(playSound);
            renderer.setViewingFilter((options) => game?.processViewingFilter(options) ?? null);
            renderer.setObjectMoveHandler((position, object, place, unchangedRoom, facing) => {
                game?.triggerObjectMove(position, object, place, unchangedRoom, facing);
            });
            renderer.setSpellCastHandler((chIdx, incantation, totalManaCost) => {
                return game?.castSpellFromUi(chIdx, incantation, totalManaCost) ?? 0;
            });
            await loadGlfx().catch((err) => {
                console.warn('glfx failed to load; CRT effect disabled', err);
            });
            crtController = createCrtController(gameCanvasEl);
            console.log('✓ Viewport renderer initialized');
            bindUIContext({
                renderer,
                game,
                dungeonData: dungeon,
                renderView,
                onQuickSave: quickSave,
                onQuickLoad: quickLoad,
                onInjectRandomParty: injectRandomParty,
                onToggleAttackPanel: toggleAttackPanel,
                onToggleMissileTrace: toggleMissileTrace,
                onRunMissileScenario: runNextMissileScenario,
                setCrtEnabled,
                isCrtEnabled,
                setSoundEnabled: (enabled) => {
                    soundManager?.unlock();
                    soundManager?.setEnabled(enabled);
                },
                isSoundEnabled: () => soundManager?.isEnabled() ?? false,
                setSoundVolume: (volume) => soundManager?.setVolume(volume),
                getSoundVolume: () => soundManager?.getVolume() ?? 0,
            });

            // Register movement callback
            game.onMove((success, message, result) => {
                const posInfo = game?.getPositionInfo();
                console.log(`Movement ${success ? 'SUCCESS' : 'BLOCKED'}:`, posInfo, message ?? ' ');

                if (message) updateDebug(message);
                else if (success) updateDebug(posInfo || 'Moved');

                if (result?.soundId !== undefined) {
                    soundManager?.playSound(result.soundId, result.soundRateIdx);
                }

                // Render 3D view after movement
                if (success && renderer && game) {
                    renderView();
                    drawMapPreview(game.party.state.position.z);
                }
            });

            // Register tick callback to update view
            game.onTick(() => {
                 if (renderer && game) renderView();
            });

            // Start game loop
            game.start();
            console.log('✓ Game engine started');
            console.log('✓ Starting position:', game.getPositionInfo());

            quickLoad();

            // Initial render
            renderView();
            drawMapPreview(game.party.state.position.z);

        } catch (error) {
            console.warn('Could not load dungeon.dat:', error);
            updateDebug('Failed to load dungeon');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        updateDebug(`Error: ${error}`);
    }
}


// Start the application
init();
