/**
 * Development-only scaffolding.
 *
 * None of this exists in CSBWin. It is the dev harness that keeps the port playable while
 * real features are still missing: a random party (until Phase 13's hall of champions), a
 * localStorage quick-save (until Phase 10's CSBWin-compatible save files), the attack-panel
 * toggle, and the missile trace and scenarios used to validate Phase 8.
 *
 * Everything here is reached only through `isDebugFeaturesEnabled()` — see PLAN.md Phase 14.
 * Delete a section as soon as the real feature lands.
 */
import { DBType, Direction, Position, RoomType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF } from './core';
import type { DungeonData, PresetHero } from './data';
import { loadSaveGameState, applySaveGameState, saveSaveGameState, type SaveGameState } from './data/SaveGameLoader';
import {
    MovementAction,
    assignPresetHeroPossessions,
    createChampionFromPreset,
    createSkillsFromSubskillLevels,
    type AddCharacterTables,
    type Champion,
    type Game,
    type MissileTraceEvent,
    type PartyState,
    type RuntimeSaveState,
    type TimerTables,
} from './engine';
import type { ViewportRenderer } from './renderer/ViewportRenderer';
import { scrollingText } from './renderer/csbwin/ScrollingText';
import { appendLog, clearLog, updateDebug } from './ui';

/** Live handles into `main.ts`; read through getters so reassignment is visible here. */
export interface DevHost {
    readonly game: Game | null;
    readonly renderer: ViewportRenderer | null;
    readonly dungeonData: DungeonData | null;
    readonly timerTables: TimerTables | null;
    getAddCharacterTables(): AddCharacterTables | null;
    renderView(): void;
}

const QUICK_SAVEGAME_RAW_KEY = 'dmweb_savegame_raw_v1';
const MISSILE_WEAPON_DAGGER = 8;
const MISSILE_WEAPON_ARROW = 27;
const POTION_FUL_BOMB = 19;
const DIR_STEPS = [
    { dir: Direction.NORTH, dx: 0, dy: -1 },
    { dir: Direction.EAST, dx: 1, dy: 0 },
    { dir: Direction.SOUTH, dx: 0, dy: 1 },
    { dir: Direction.WEST, dx: -1, dy: 0 },
];

export interface DevTools {
    /** `TimerHooks.onMissileTrace` sink; a no-op unless the trace is on. */
    onMissileTrace(event: MissileTraceEvent): void;
    quickSave(): void;
    quickLoad(): void;
    injectRandomParty(): void;
    toggleAttackPanel(): void;
    toggleMissileTrace(): void;
    runNextMissileScenario(): void;
}

export function createDevTools(host: DevHost): DevTools {
    let missileTraceEnabled = false;
    let missileScenarioIndex = 0;

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
        const tick = host.game?.getTickCount() ?? 0;
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
        if (!host.game) return false;
        if (host.game.party.state.champions.length === 0) {
            const champion = createRandomChampion(0);
            if (!host.game.addChampion(champion)) return false;
            host.game.state.party = host.game.party.state;
        }
        const party = host.game.party.state;
        if (party.cursorOwner < 0) party.cursorOwner = 0;
        if (party.selectedCharacterIndex < 0) party.selectedCharacterIndex = party.cursorOwner;
        return true;
    }

    function setPartyPosition(position: Position, facing: Direction): void {
        if (!host.game) return;
        const current = host.game.party.state;
        const next: PartyState = {
            ...current,
            position,
            facing,
            moving: false,
            turning: false,
            lastMoveTime: 0,
        };
        host.game.setPartyState(next);
    }

    function loadCursorObject(rn: number): void {
        if (!host.game) return;
        const party = host.game.party.state;
        party.cursorOwner = party.cursorOwner < 0 ? 0 : party.cursorOwner;
        party.selectedCharacterIndex = party.cursorOwner;
        party.objectInHand = rn;
        host.game.state.party = party;
    }

    function createWeaponRecord(weaponType: number): number {
        if (!host.game) return OBJECT_ID_EOF;
        const data = host.game.dungeonState.getData();
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
        if (!host.game) return OBJECT_ID_EOF;
        const data = host.game.dungeonState.getData();
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
        if (!host.game) return null;
        const dungeonState = host.game.dungeonState;
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
        if (!host.game) return null;
        const map = host.game.dungeonState.getMap(target.z);
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
        if (!host.game) return null;
        const monsterDesc = host.timerTables?.monsterDesc;
        if (!monsterDesc) return null;
        const dungeonState = host.game.dungeonState;
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
        if (!host.game) return false;
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
        const thrown = host.game.throwObjectFromCursor(0);
        appendLog(`[Scenario] door: ${thrown ? 'thrown' : 'throw failed'}`);
        host.renderView();
        return thrown;
    }

    function runMissileScenarioWall(): boolean {
        if (!host.game) return false;
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
        const thrown = host.game.throwObjectFromCursor(0);
        appendLog(`[Scenario] wall: ${thrown ? 'thrown' : 'throw failed'}`);
        host.renderView();
        return thrown;
    }

    function runMissileScenarioStepAway(): boolean {
        if (!host.game) return false;
        if (!ensureScenarioParty()) return false;
        const spot = findOpenCellWithOpenNeighbor();
        if (!spot) {
            updateDebug('Missile scenario: no open cell for step-away');
            return false;
        }
        setPartyPosition(spot.position, spot.facing);
        const weapon = createWeaponRecord(MISSILE_WEAPON_ARROW);
        if (weapon === OBJECT_ID_EOF) return false;
        const posInCell = host.game.party.state.champions[0]?.partyPosition ?? 0;
        const launched = host.game.debugLaunchMissileDelayed(
            weapon,
            spot.position,
            posInCell,
            spot.facing,
            6,
            20,
            1,
            4,
        );
        const moved = host.game.move(MovementAction.MOVE_FORWARD);
        appendLog(`[Scenario] step-away: missile=${launched ? 'armed' : 'failed'} move=${moved ? 'ok' : 'blocked'}`);
        host.renderView();
        return launched && moved;
    }

    function runMissileScenarioPotion(): boolean {
        if (!host.game) return false;
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
        const thrown = host.game.throwObjectFromCursor(0);
        appendLog(`[Scenario] potion splash: ${thrown ? 'thrown' : 'throw failed'}`);
        host.renderView();
        return thrown;
    }

    function runMissileScenarioMonsterAbsorb(): boolean {
        if (!host.game) return false;
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
        const thrown = host.game.throwObjectFromCursor(0);
        appendLog(`[Scenario] monster absorb: ${thrown ? 'thrown' : 'throw failed'}`);
        host.renderView();
        return thrown;
    }

    function runNextMissileScenario(): void {
        if (!host.game) return;
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

    function injectRandomParty(): void {
        if (!host.game) return;
        const current = host.game.party.state;
        const champions: Champion[] = [];
        const presets = host.dungeonData?.presetHeroes ?? [];
        if (presets.length >= 4) {
            const tables = host.getAddCharacterTables();
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
        host.game.setPartyState(newState);
        updateDebug('Random party injected');
    }

    function toggleAttackPanel(): void {
        if (!host.renderer) return;
        const next = !host.renderer.isAttackPanelVisible();
        host.renderer.setShowAttackPanel(next);
        updateDebug(next ? 'Attack panel ON' : 'Attack panel OFF');
        host.renderView();
    }

    function quickSave(): void {
        if (!host.game) return;
        const runtime = host.game.getRuntimeSaveState();
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
        if (!host.game) return;
        const raw = localStorage.getItem(QUICK_SAVEGAME_RAW_KEY);
        if (!raw) {
            updateDebug('No quick-save found');
            return;
        }
        try {
            const parsed = JSON.parse(raw) as { runtime: RuntimeSaveState; raw: string };
            const saveBytes = decodeBase64ToBytes(parsed.raw);
            const saveState = loadSaveGameState(saveBytes);
            applySaveGameState(host.game.state.dungeon, saveState);
            host.game.applyRuntimeSaveState(parsed.runtime);
            // Message timeouts are game-tick based, so a load that moves the clock would leave
            // rows that expire at the wrong time (or never). CSBWin serializes the text area
            // (doc/CSBwin-src/Data.h:1666); until we do, discard it. See PLAN.md Phase 11.
            scrollingText.discardText();
            host.renderView();
            updateDebug('Quick-loaded');
        } catch (error) {
            console.warn('Failed to quick-load:', error);
            updateDebug('Quick-load failed (see console)');
        }
    }

    function onMissileTrace(event: MissileTraceEvent): void {
        if (!missileTraceEnabled) return;
        appendLog(formatMissileTrace(event));
    }

    return {
        onMissileTrace,
        quickSave,
        quickLoad,
        injectRandomParty,
        toggleAttackPanel,
        toggleMissileTrace,
        runNextMissileScenario,
    };
}
