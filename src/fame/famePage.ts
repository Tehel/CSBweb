/**
 * The Hall of Fame, `/fame` (`fame.html`, Vite's third entry, which `server/app.ts`
 * serves): what the server answers of the achievements its replays verified
 * (`doc/ACHIEVEMENTS.md` → "The Hall of Fame", `server/fame.ts`), in the statistics page's
 * look (`src/stats/statsPage.css`), and none of the game's code. Each player is their
 * public name, and links to their page by their public id.
 *
 * - **The band across the top** (`api/fame`): the players of the Hall, and the dungeons
 *   with one.
 * - **The column at the left**, the sets in `api/fame`'s order, the most players first:
 *   each its name, its players and how many of its achievements someone verified. A click
 *   selects the set, in the URL, `?set=<id>`, every other parameter kept; with none, or one
 *   no longer listed, the column's first is selected. Back and forward move between them.
 * - **The selected set** (`api/fame/sets/<id>`): its players and achievements, and each
 *   achievement in its file's order, its name, its tier in its colour, its text, the share
 *   of the set's players who verified it as a bar, with their count, and who verified it
 *   first, a link to their page.
 * - **A player's page**, `fame#<public id>` or `fame?player=<public id>`, in the set's
 *   place (`api/fame/players/<id>`): their name, and their badges by set, each its name,
 *   tier, text and the day it was verified. PROFILE links to the player's own.
 *
 * An answer that does not come is said where it would have been.
 */
import '../ui/welcomePage.css';
import '../stats/statsPage.css';
import './famePage.css';
import logoUrl from '../assets/csbweb-logo.jpg';
import type { FameAchievement, FamePlayerPage, FameSet, FameSummary } from '../../server/answers';

/**
 * The Hall's routes (`FAME_ROUTE`, `FAME_SETS`, `FAME_PLAYERS`, `src/data/DataSets.ts`):
 * not imported, as the page loads none of the game's modules, which the build would share
 * with it as a chunk of the game's.
 */
const FAME_ROUTE = 'api/fame';
const FAME_SETS = 'sets';
const FAME_PLAYERS = 'players';

const PAGE = `
<main class="welcome-page stats-page fame-page">
  <header class="stats-head">
    <a class="stats-logo"><img src="${logoUrl}" alt="CSBweb" width="550" height="307"></a>
    <h1 class="px px6">Hall of Fame</h1>
  </header>
  <section class="stats-band" aria-label="Every dungeon"></section>
  <div class="stats-body">
    <nav class="stats-sets" aria-label="Dungeons"></nav>
    <section class="stats-set" aria-live="polite"></section>
  </div>
  <footer class="welcome-footer">
    <p>Every achievement here was verified by the server, which replayed the recording of the game that earned it. A player is listed by the public name they chose in PROFILE, on the welcome page, once a replay has verified one of their achievements.</p>
    <nav class="px px2" aria-label="Footer"><a class="stats-home">Play</a><a class="fame-stats">Stats</a></nav>
  </footer>
</main>`;

async function showFamePage(body: HTMLElement): Promise<void> {
    body.innerHTML = PAGE;
    const band = body.querySelector<HTMLElement>('.stats-band')!;
    const column = body.querySelector<HTMLElement>('.stats-sets')!;
    const panel = body.querySelector<HTMLElement>('.stats-set')!;
    for (const home of body.querySelectorAll<HTMLAnchorElement>('.stats-logo, .stats-home')) home.href = homeQuery();
    body.querySelector<HTMLAnchorElement>('.fame-stats')!.href = `stats${otherParams()}`;

    const summary = await fetchJson<FameSummary>(FAME_ROUTE);
    if (summary === null) {
        band.append(line('stats-none', 'The Hall of Fame cannot be read now. Try again later.'));
        return;
    }
    band.append(figures([['Players', count(summary.players)], ['Dungeons', count(summary.sets.filter((set) => set.players > 0).length)]]));
    const picks = summary.sets.map((set) => {
        const pick = document.createElement('a');
        pick.className = 'stats-pick';
        pick.href = setQuery(set.id);
        pick.dataset.set = set.id;
        pick.append(line('stats-pick-name px px2', set.name),
            line('stats-pick-figures px px2', `${plural(set.players, 'player')} · ${set.verified} of ${set.achievements} earned`));
        pick.addEventListener('click', (event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (set.id === selected && shownPlayer() === null) return;
            history.pushState(null, '', pick.href);
            select();
        });
        column.append(pick);
        return pick;
    });
    if (picks.length === 0) column.append(line('stats-none', 'No dungeon is played here yet.'));

    /** What the panel shows: a set's id, or a player's `#id`. */
    let selected: string | null = null;
    /** The player the URL names, shown in the panel; else the set it names, or the column's first. */
    function select(): void {
        const player = shownPlayer();
        const asked = new URLSearchParams(window.location.search).get('set');
        const set = player === null ? summary!.sets.find((known) => known.id === asked) ?? summary!.sets[0] : undefined;
        const shown = player === null ? set?.id ?? null : `#${player}`;
        selected = shown;
        for (const pick of picks) pick.setAttribute('aria-current', String(pick.dataset.set === shown));
        panel.replaceChildren();
        if (player !== null) {
            void fetchJson<FamePlayerPage>(`${FAME_ROUTE}/${FAME_PLAYERS}/${encodeURIComponent(player)}`).then((page) => {
                if (selected !== shown) return;
                panel.replaceChildren(...(page === null ? [heading('No such player'), line('stats-none', 'No player of the Hall has this id, or their name was withdrawn.')] : playerView(page)));
            });
        } else if (set !== undefined) {
            void fetchJson<FameSet>(`${FAME_ROUTE}/${FAME_SETS}/${encodeURIComponent(set.id)}`).then((fame) => {
                if (selected !== shown) return;
                panel.replaceChildren(...(fame === null ? [heading(set.name), line('stats-none', 'This dungeon\'s achievements cannot be read now.')] : setView(fame)));
            });
        }
    }
    window.addEventListener('popstate', select);
    window.addEventListener('hashchange', select);
    select();
}

/** A set's half of the page. */
function setView(fame: FameSet): HTMLElement[] {
    const verified = fame.achievements.filter((achievement) => achievement.players > 0).length;
    const list = document.createElement('ol');
    list.className = 'fame-list';
    for (const achievement of fame.achievements) list.append(achievementItem(achievement, fame.players));
    return [
        heading(fame.name),
        figures([['Players', count(fame.players)], ['Achievements', count(fame.achievements.length)], ['Earned', count(verified)]]),
        section('Achievements', [list]),
    ];
}

/** An achievement of a set: its head, its text, its players' share, and who was first. */
function achievementItem(achievement: FameAchievement, players: number): HTMLElement {
    const item = badge(achievement, achievement.players === 0);
    const row = barRow('Players', achievement.share, `${count(achievement.players)} · ${percent(achievement.share)}`, 'stats-bar-share');
    row.title = `${plural(achievement.players, 'player')} of ${count(players)}`;
    const first = document.createElement('span');
    first.className = 'fame-first px px2';
    if (achievement.first === null) first.textContent = 'Nobody yet.';
    else first.append('First: ', playerLink(achievement.first.id, achievement.first.name));
    item.append(row, first);
    return item;
}

/** A player's page: their name, and their badges by set. */
function playerView(page: FamePlayerPage): HTMLElement[] {
    const badges = page.sets.reduce((sum, set) => sum + set.achievements.length, 0);
    const view = [heading(page.name), figures([['Badges', count(badges)], ['Dungeons', count(page.sets.length)]])];
    if (page.sets.length === 0) return [...view, line('stats-none', 'No achievement verified yet.')];
    for (const set of page.sets) {
        const list = document.createElement('ol');
        list.className = 'fame-list';
        for (const achievement of set.achievements) {
            const item = badge(achievement, false);
            item.append(line('fame-day px px2', `Verified ${achievement.day}`));
            list.append(item);
        }
        const title = document.createElement('a');
        title.className = 'fame-set-link';
        title.href = setQuery(set.id);
        title.textContent = set.name;
        const part = section('', [list]);
        part.querySelector('h3')!.replaceChildren(title);
        view.push(part);
    }
    return view;
}

/** An achievement's block: its name, its tier in its colour, and its text; dim where nobody has it. */
function badge(achievement: { id: string; name: string; text: string; tier: string }, nobody: boolean): HTMLElement {
    const item = document.createElement('li');
    item.className = nobody ? 'fame-achievement fame-nobody' : 'fame-achievement';
    item.dataset.achievement = achievement.id;
    const head = document.createElement('div');
    head.className = 'fame-head';
    head.append(line('fame-name px px2', achievement.name), line(`fame-tier tier-${achievement.tier} px px2`, achievement.tier));
    const text = document.createElement('p');
    text.className = 'fame-text';
    text.textContent = achievement.text;
    item.append(head, text);
    return item;
}

/** A link to the page of the player `id`, by their name. */
function playerLink(id: string, name: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(id)}`;
    link.textContent = name;
    return link;
}

/** A row of a list of bars: its label, its bar at `share` of the track, and its value. */
function barRow(label: string, share: number, value: string, barClass: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'stats-row';
    const track = document.createElement('span');
    track.className = 'stats-track';
    const bar = document.createElement('span');
    bar.className = `stats-bar ${barClass}`;
    bar.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
    track.append(bar);
    row.append(line('stats-row-label px px2', label), track, line('stats-row-value px px2', value));
    return row;
}

/** A row of figures, a label over its value each. */
function figures(entries: [string, string][]): HTMLElement {
    const list = document.createElement('dl');
    list.className = 'stats-figures';
    for (const [label, value] of entries) {
        const figure = document.createElement('div');
        const term = document.createElement('dt');
        term.className = 'px px2';
        term.textContent = label;
        const data = document.createElement('dd');
        data.className = 'px';
        data.textContent = value;
        figure.append(term, data);
        list.append(figure);
    }
    return list;
}

function section(title: string, content: HTMLElement[]): HTMLElement {
    const element = document.createElement('section');
    element.className = 'stats-section';
    const heading = document.createElement('h3');
    heading.className = 'px';
    heading.textContent = title;
    element.append(heading, ...content);
    return element;
}

function heading(text: string): HTMLElement {
    const element = document.createElement('h2');
    element.className = 'px';
    element.textContent = text;
    return element;
}

/** An element of one line of text. */
function line(className: string, text: string): HTMLElement {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
}

/** The answer of `route`, or `null` where it does not come. */
async function fetchJson<T>(route: string): Promise<T | null> {
    try {
        const answer = await fetch(route);
        return answer.ok ? await answer.json() as T : null;
    } catch {
        return null;
    }
}

function count(value: number): string {
    return value.toLocaleString('en-US');
}

function percent(share: number): string {
    return `${Math.round(share * 100)}%`;
}

/** `value` and its unit, `one` or `many`. */
function plural(value: number, one: string, many = `${one}s`): string {
    return `${count(value)} ${value === 1 ? one : many}`;
}

/** The player the URL names: its hash, else `?player=`; `null` for none. */
function shownPlayer(): string | null {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash !== '') return hash;
    return new URLSearchParams(window.location.search).get('player') || null;
}

/** The page's own query, `set` the set selected, the player dropped. */
function setQuery(id: string): string {
    const params = new URLSearchParams(window.location.search);
    params.delete('player');
    params.set('set', id);
    return `?${params}`;
}

/** The page's other parameters, as a query: `keepsaves` and the like, which the other pages keep. */
function otherParams(): string {
    const params = new URLSearchParams(window.location.search);
    params.delete('set');
    params.delete('player');
    return params.size > 0 ? `?${params}` : '';
}

/** The welcome page, the page's other parameters kept. */
function homeQuery(): string {
    return `./${otherParams()}`;
}

void showFamePage(document.body);
