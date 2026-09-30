import type { Champion } from '../engine/gameTypes';
import { ATTRIBUTE_COUNT, attributeMaximum } from '../engine/attributes';
import { determineMastery, ensureSkills } from '../engine/skills';
import { getUIContext } from './context';

/**
 * Developer/debug panel: the party's permanent numbers, one column per champion.
 *
 * Only what training moves — the maxima of health, stamina, mana and the seven
 * attributes, and the experience of the twenty skills with the mastery it gives. The
 * current values (a potion's boost, a skill's `tempAdjust`, item bonuses) are left out on
 * purpose: mastery is read as `DetermineMastery(chIdx, skill | 0xc000)`, which ignores
 * both, as the level shown for a class does (`doc/TRAINING.md`, "How experience is
 * scaled"). The engine is read, never written.
 *
 * The table is built once and updated in place, so a tooltip survives the refresh, and
 * it is always four champion columns wide: a panel that changed width would reflow the
 * canvas beside it.
 */

const panelEl = document.getElementById('champions');

const PARTY_SIZE = 4;
/** How long, in game ticks, a cell stays highlighted after its value changed. */
const FLASH_TICKS = 12;

/** `#define Luck 0 … #define AntiFire 6` (`doc/CSBwin-src/CSB.h:628-634`). */
const ATTRIBUTE_NAMES = ['Luck', 'Strength', 'Dexterity', 'Wisdom', 'Vitality', 'Anti-magic', 'Anti-fire'];
const BASE_SKILL_NAMES = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
const SUBSKILL_NAMES = [
    'Swing', 'Thrust', 'Club', 'Parry',
    'Steal', 'Fight', 'Throw', 'Shoot',
    'Identify', 'Heal', 'Influence', 'Defend',
    'Fire', 'Air', 'Earth', 'Water',
];
/**
 * `MASTERY_LABELS` in `src/renderer/ui/Character.ts`, with the rune glyphs the DM font
 * draws for `` ` `` and `a`..`e` spelled out.
 */
const MASTERY_NAMES = [
    '', '', 'NEOPHYTE', 'NOVICE', 'APPRENTICE', 'JOURNEYMAN', 'CRAFTSMAN', 'ARTISAN',
    'ADEPT', 'EXPERT', 'LO MASTER', 'UM MASTER', 'ON MASTER', 'EE MASTER', 'UX MASTER',
    'MON MASTER', 'ARCHMASTER',
];

interface CellState {
    el: HTMLTableCellElement;
    value: number | null;
    lastDelta: number;
    changedAt: number;
}

interface RowDef {
    label: string;
    className: string;
    title: string;
    /** Fills one champion's cell; returns the number watched for changes. */
    fill: (champion: Champion, cell: CellState) => number;
}

const rows: { def: RowDef; cells: CellState[] }[] = [];
const headerCells: HTMLTableCellElement[] = [];
let contextEl: HTMLDivElement | null = null;
let built = false;

export function isChampionPanelVisible(): boolean {
    return !!panelEl && panelEl.style.display !== 'none';
}

/** Redraws the panel from the live game. Cheap enough to run every tick. */
export function updateChampionPanel(): void {
    const ctx = getUIContext();
    if (!ctx || !panelEl || !isChampionPanelVisible()) return;
    if (!built) build();

    const game = ctx.game;
    const now = game.getTickCount();
    const champions = game.ctx.party.state.champions;

    for (let chIdx = 0; chIdx < PARTY_SIZE; chIdx++) {
        const champion = champions[chIdx];
        const header = headerCells[chIdx];
        header.textContent = champion ? champion.name || `#${chIdx}` : '—';
        header.title = champion ? `chIdx ${chIdx}: ${champion.name} ${champion.title}`.trim() : 'empty slot';
        header.classList.toggle('dead', !!champion && champion.attributes.health === 0);

        for (const row of rows) {
            const cell = row.cells[chIdx];
            if (!champion) {
                cell.el.textContent = '';
                cell.el.title = '';
                cell.el.style.background = '';
                cell.el.classList.remove('changed', 'dead');
                cell.value = null;
                continue;
            }
            const value = row.def.fill(champion, cell);
            if (cell.value !== null && value !== cell.value) {
                cell.lastDelta = value - cell.value;
                cell.changedAt = now;
            }
            cell.value = value;
            cell.el.classList.toggle('changed', now - cell.changedAt < FLASH_TICKS);
            cell.el.classList.toggle('dead', champion.attributes.health === 0);
            if (cell.lastDelta !== 0) {
                const sign = cell.lastDelta > 0 ? '+' : '';
                cell.el.title += `\nLast change: ${sign}${cell.lastDelta} at tick ${cell.changedAt}`;
            }
        }
    }

    if (contextEl) contextEl.textContent = describeTrainingContext();
}

function build(): void {
    if (!panelEl) return;
    const table = document.createElement('table');
    const colgroup = document.createElement('colgroup');
    colgroup.appendChild(document.createElement('col')).className = 'label-col';
    for (let i = 0; i < PARTY_SIZE; i++) colgroup.appendChild(document.createElement('col'));
    table.appendChild(colgroup);

    const headRow = table.createTHead().insertRow();
    headRow.appendChild(document.createElement('th'));
    for (let i = 0; i < PARTY_SIZE; i++) {
        headerCells.push(headRow.appendChild(document.createElement('th')));
    }

    const body = table.createTBody();
    for (const def of rowDefinitions()) {
        const tr = body.insertRow();
        tr.className = def.className;
        const label = tr.insertCell();
        label.textContent = def.label;
        label.title = def.title;
        const cells: CellState[] = [];
        for (let i = 0; i < PARTY_SIZE; i++) {
            cells.push({ el: tr.insertCell(), value: null, lastDelta: 0, changedAt: -Infinity });
        }
        rows.push({ def, cells });
    }

    contextEl = document.createElement('div');
    contextEl.className = 'training-context';
    panelEl.replaceChildren(table, contextEl);
    built = true;
}

function rowDefinitions(): RowDef[] {
    const defs: RowDef[] = [
        vitalRow('Health', 'maxHealth', 'CHARDESC.MaxHP'),
        vitalRow('Stamina', 'maxStamina', 'CHARDESC.MaxStamina — raw; the game shows it divided by 10'),
        vitalRow('Mana', 'maxMana', 'CHARDESC.MaxMana'),
    ];
    for (let i = 0; i < ATTRIBUTE_COUNT; i++) {
        defs.push({
            label: ATTRIBUTE_NAMES[i],
            className: i === 0 ? 'stat group-start' : 'stat',
            title: `Attributes[${i}].Maximum — what LevelUp raises. Luck is never shown in game.`,
            fill: (champion, cell) => {
                const attr = champion.attributes.stats[i];
                const value = attr ? attributeMaximum(attr) : 0;
                cell.el.textContent = String(value);
                cell.el.title = `${ATTRIBUTE_NAMES[i]} maximum ${value}`;
                return value;
            },
        });
    }
    for (let base = 0; base < 4; base++) {
        defs.push(skillRow(base));
        for (let sub = 0; sub < 4; sub++) defs.push(skillRow(4 + base * 4 + sub));
    }
    return defs;
}

function vitalRow(label: string, key: 'maxHealth' | 'maxStamina' | 'maxMana', title: string): RowDef {
    return {
        label,
        className: 'vital',
        title,
        fill: (champion, cell) => {
            const value = champion.attributes[key];
            cell.el.textContent = String(value);
            cell.el.title = `${label} maximum ${value}`;
            return value;
        },
    };
}

/**
 * A skill's cell: its mastery and its own experience, over a bar showing how far the
 * experience `DetermineMastery` counts has got towards the next level. For a sub-skill
 * that is its own experience plus its base skill's, halved; a level `m` needs
 * `500 × 2^(m-2)` of it (`doc/TRAINING.md`).
 */
function skillRow(skill: number): RowDef {
    const isBase = skill < 4;
    const baseIndex = isBase ? skill : Math.floor((skill - 4) / 4);
    const name = isBase ? BASE_SKILL_NAMES[skill] : SUBSKILL_NAMES[skill - 4];
    return {
        label: isBase ? name : `  ${name}`,
        className: isBase ? 'skill base group-start' : 'skill sub',
        title: isBase
            ? `Skill ${skill}. Every sub-skill gain is also added here; this is the class level.`
            : `Skill ${skill}, a ${BASE_SKILL_NAMES[baseIndex]} sub-skill. Mastery counts (own + ${BASE_SKILL_NAMES[baseIndex]}) / 2.`,
        fill: (champion, cell) => {
            const skills = ensureSkills(champion.skills ?? []);
            const own = skills[skill].experience;
            const baseExp = skills[baseIndex].experience;
            const counted = isBase ? own : Math.floor((own + baseExp) / 2);
            const mastery = determineMastery(champion, skill | 0xc000);
            const low = mastery <= 1 ? 0 : 500 * 2 ** (mastery - 2);
            const high = 500 * 2 ** (mastery - 1);
            const progress = Math.max(0, Math.min(1, (counted - low) / (high - low)));

            cell.el.innerHTML = `<span class="lvl">${mastery}</span>${own}`;
            cell.el.style.background =
                `linear-gradient(to right, var(--bar) ${(progress * 100).toFixed(1)}%, transparent 0)`;
            const lines = [
                `${name} (skill ${skill}): experience ${own}`,
                isBase
                    ? `Counted: ${counted}`
                    : `Counted: (${own} + ${BASE_SKILL_NAMES[baseIndex]} ${baseExp}) / 2 = ${counted}`,
                `Mastery ${mastery}${MASTERY_NAMES[mastery] ? ` (${MASTERY_NAMES[mastery]})` : ''}`,
                `Next level at ${high}: ${high - counted} to go (${Math.floor(progress * 100)}%)`,
            ];
            cell.el.title = lines.join('\n');
            return own;
        },
    };
}

/**
 * The three factors `AdjustSkills` applies to every gain, as they stand this tick
 * (`doc/CSBwin-src/Magic.cpp:200-260`, see `doc/TRAINING.md`).
 */
function describeTrainingContext(): string {
    const ctx = getUIContext();
    if (!ctx) return '';
    const game = ctx.game;
    const now = game.getTickCount();
    const party = game.ctx.party.state;
    const map = game.ctx.dungeon.getMap(party.position.z);
    const multiplier = map?.descriptor.difficulty ?? 0;
    const sinceAttack = now - party.lastMonsterAttackTime;
    const fighterNinja = party.lastMonsterAttackTime < now - 150 ? '×½' : '×1';
    const subskills = party.lastMonsterAttackTime > now - 25 ? '×2' : '×1';
    return `tick ${now} · map ${party.position.z} multiplier ×${multiplier === 0 ? 1 : multiplier}\n`
        + `last monster attack ${sinceAttack} ticks ago → skills 4-11 ${fighterNinja}, sub-skills ${subskills}`;
}
