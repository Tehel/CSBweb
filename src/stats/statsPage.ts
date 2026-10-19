/**
 * The statistics page, `/stats` (`stats.html`, Vite's second entry, which `server/app.ts`
 * serves): what the server answers of the public sets (`doc/STATISTICS.md` → "`api/stats`"),
 * in the welcome page's look (`src/ui/welcomePage.css`), and none of the game's code. Its
 * charts are CSS bars, each with its count on hover; the content security policy allows
 * no library from elsewhere (`server/app.ts`).
 *
 * - **The band across the top**, every set together (`api/stats`): players, hours played,
 *   games started and won, and the sessions per week.
 * - **The column at the left**, the sets in `api/stats`'s order, by hours played,
 *   decreasing: each its name, its hours and its games started. A click selects the set,
 *   and the rest of the page is its own, as a champion's choice only means something within
 *   a set. The selected set is in the URL, `?set=<id>`, every other parameter kept; with
 *   none, or one no longer listed, the column's first is selected. Back and forward move
 *   between the sets selected.
 * - **The selected set** (`api/stats/<id>`): its figures (hours played, games started and
 *   won, deaths, players); its fastest wins by game clock (`FASTEST_WINS`, every win for
 *   now), each its rank, its game time as `H:MM:SS` of the game's clock, its play time, its
 *   party, a champion who joined by REINCARNATE marked, a solo win badged, and its day; the
 *   deaths per level, a row a level from the first to the deepest died on, as the dungeon
 *   descends, `LEVEL 1` its first as the map dialog counts (`mapTitle`); its preferred
 *   champions, each their share of the games with a party, and their win rate once they
 *   were in `WIN_RATE_GAMES`; the sessions, games started and games won per week.
 *
 * A chart of weeks runs from the first week answered to the current one, the weeks
 * without one at zero, and shows the latest `WEEKS`. An answer that does not come is said
 * where it would have been.
 */
import '../ui/welcomePage.css';
import './statsPage.css';
import logoUrl from '../assets/csbweb-logo.jpg';
import type { SetStats, StatsSummary, Win } from '../../server/stats';

/** The server's statistics (`server/app.ts`). */
const STATS_ROUTE = 'api/stats';
/** The weeks a chart of weeks shows: the latest. */
const WEEKS = 52;
/** The games a champion is in before their win rate is shown. */
const WIN_RATE_GAMES = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SESSIONS: [string, string] = ['session', 'sessions'];
/**
 * The game's VBLs a second (`VBL_FREQUENCY`, `src/core/constants.ts`) and per tick awake
 * (`VBL_PER_TICK`, `src/engine/LoopState.ts`): not imported, as the page loads none of the
 * game's modules, which the build would share with it as a chunk of the game's.
 */
const VBL_FREQUENCY = 60;
const VBL_PER_TICK = 15;

const PAGE = `
<main class="welcome-page stats-page">
  <header class="stats-head">
    <a class="stats-logo"><img src="${logoUrl}" alt="CSBweb" width="550" height="307"></a>
    <h1 class="px px6">Statistics</h1>
  </header>
  <section class="stats-band" aria-label="Every dungeon"></section>
  <div class="stats-body">
    <nav class="stats-sets" aria-label="Dungeons"></nav>
    <section class="stats-set" aria-live="polite"></section>
  </div>
  <footer class="welcome-footer">
    <p>Counted from the games played on this site, anonymously: no name but the champions', no address. A player who would rather not be counted turns off SEND STATISTICS in the game's settings.</p>
    <nav class="px px2" aria-label="Footer"><a class="stats-home">Play</a></nav>
  </footer>
</main>`;

export async function showStatsPage(body: HTMLElement): Promise<void> {
    body.innerHTML = PAGE;
    const band = body.querySelector<HTMLElement>('.stats-band')!;
    const column = body.querySelector<HTMLElement>('.stats-sets')!;
    const panel = body.querySelector<HTMLElement>('.stats-set')!;
    for (const home of body.querySelectorAll<HTMLAnchorElement>('.stats-logo, .stats-home')) home.href = homeQuery();

    const summary = await fetchJson<StatsSummary>(STATS_ROUTE);
    if (summary === null) {
        band.append(line('stats-none', 'The statistics cannot be read now. Try again later.'));
        return;
    }
    band.append(
        figures([['Players', count(summary.players)], ['Hours played', hours(summary.playTime)],
            ['Games started', count(summary.started)], ['Games won', count(summary.won)]]),
        weekChart('Sessions per week', summary.weeks.map(({ week, sessions }) => ({ week, value: sessions })), SESSIONS),
    );
    const picks = summary.sets.map((set) => {
        const pick = document.createElement('a');
        pick.className = 'stats-pick';
        pick.href = setQuery(set.id);
        pick.dataset.set = set.id;
        pick.append(line('stats-pick-name px px2', set.name),
            line('stats-pick-figures px px2', `${hours(set.playTime)} h · ${plural(set.started, 'game')}`));
        pick.addEventListener('click', (event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (set.id === selected) return;
            history.pushState(null, '', pick.href);
            select();
        });
        column.append(pick);
        return pick;
    });
    if (picks.length === 0) column.append(line('stats-none', 'No dungeon is played here yet.'));

    let selected: string | null = null;
    /** The set the URL names selected, or the column's first. */
    function select(): void {
        const asked = new URLSearchParams(window.location.search).get('set');
        const set = summary!.sets.find((known) => known.id === asked) ?? summary!.sets[0];
        selected = set?.id ?? null;
        for (const pick of picks) pick.setAttribute('aria-current', String(pick.dataset.set === selected));
        panel.replaceChildren();
        if (set === undefined) return;
        const shown = set.id;
        void fetchJson<SetStats>(`${STATS_ROUTE}/${encodeURIComponent(shown)}`).then((stats) => {
            if (selected !== shown) return;
            panel.replaceChildren(...(stats === null ? [heading(set.name), line('stats-none', 'This dungeon\'s statistics cannot be read now.')] : setView(stats)));
        });
    }
    window.addEventListener('popstate', select);
    select();
}

/** A set's half of the page. */
function setView(stats: SetStats): HTMLElement[] {
    return [
        heading(stats.name),
        figures([['Hours played', hours(stats.playTime)], ['Games started', count(stats.started)], ['Games won', count(stats.won)],
            ['Deaths', count(stats.died)], ['Players', count(stats.players)]]),
        section('Fastest wins', stats.fastest.length === 0 ? [line('stats-none', 'No win ranked yet.')] : fastestWins(stats.fastest)),
        section('Deaths per level', stats.levels.length === 0 ? [line('stats-none', 'No party has died here yet.')] : [deathsPerLevel(stats.levels)]),
        section('Preferred champions', stats.champions.length === 0 ? [line('stats-none', 'No party yet.')] : [champions(stats)]),
        section('Per week', stats.weeks.length === 0 ? [line('stats-none', 'Nothing played yet.')] : [
            weekChart('Sessions', stats.weeks.map(({ week, sessions }) => ({ week, value: sessions })), SESSIONS),
            weekChart('Games started', stats.weeks.map(({ week, started }) => ({ week, value: started })), ['game started', 'games started']),
            weekChart('Games won', stats.weeks.map(({ week, won }) => ({ week, value: won })), ['game won', 'games won']),
        ]),
    ];
}

/** The fastest wins, a row each, and the key to the reincarnated champions' mark where one is. */
function fastestWins(wins: Win[]): HTMLElement[] {
    const table = document.createElement('table');
    table.className = 'stats-table stats-wins';
    table.innerHTML = '<thead class="px px2"><tr><th>#</th><th>Game time</th><th>Played</th><th>Party</th><th>Day</th></tr></thead>';
    const rows = document.createElement('tbody');
    wins.forEach((win, rank) => {
        const row = document.createElement('tr');
        const party = document.createElement('td');
        party.className = 'stats-party px px2';
        for (const champion of win.champions) {
            const name = line(champion.reincarnated ? 'stats-champion stats-reincarnated' : 'stats-champion', champion.reincarnated ? `${champion.name}*` : champion.name);
            if (champion.reincarnated) name.title = 'Reincarnated';
            party.append(name);
        }
        if (win.champions.length === 1) party.append(line('stats-solo', 'Solo'));
        row.append(cell(String(rank + 1)), cell(gameClock(win.gameTime)), cell(clock(win.playTime)), party, cell(win.day));
        rows.append(row);
    });
    table.append(rows);
    const reincarnated = wins.some((win) => win.champions.some((champion) => champion.reincarnated));
    return reincarnated ? [table, line('stats-key', '* joined by REINCARNATE')] : [table];
}

/** A row a level, from the first to the deepest died on: its bar, and its count. */
function deathsPerLevel(levels: SetStats['levels']): HTMLElement {
    const deepest = Math.max(...levels.map(({ level }) => level));
    const counts = Array.from({ length: deepest + 1 }, (_, level) => levels.find((row) => row.level === level)?.count ?? 0);
    const most = Math.max(...counts);
    const list = document.createElement('div');
    list.className = 'stats-rows stats-levels';
    counts.forEach((died, level) => {
        const row = barRow(`Level ${level + 1}`, died / most, count(died), 'stats-bar-death');
        row.title = `Level ${level + 1}: ${plural(died, 'death')}`;
        list.append(row);
    });
    return list;
}

/** The champions, the most picked first: their share of the games with a party, and their win rate. */
function champions(stats: SetStats): HTMLElement {
    const list = document.createElement('div');
    list.className = 'stats-rows stats-champions';
    const head = document.createElement('div');
    head.className = 'stats-row stats-row-head px px2';
    head.append(line('', 'Champion'), line('', 'Share of parties'), line('', ''), line('', 'Won'));
    list.append(head);
    for (const champion of stats.champions) {
        const share = champion.games / stats.parties;
        const row = barRow(champion.name, share, percent(share), 'stats-bar-share');
        const rated = champion.games >= WIN_RATE_GAMES;
        const won = line('stats-row-rate px px2', rated ? percent(champion.won / champion.games) : '-');
        won.title = rated ? `${champion.won} of ${plural(champion.games, 'game')} won` : `A win rate from ${WIN_RATE_GAMES} games: ${plural(champion.games, 'game')} so far`;
        row.append(won);
        row.title = `${champion.name}: in ${plural(champion.games, 'game')} of ${count(stats.parties)}`;
        list.append(row);
    }
    return list;
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

/**
 * A chart of `weeks`, a bar a week from the first to the current one, at most the latest
 * `WEEKS`, the weeks not answered at zero. A set's three are of the same weeks, and line up.
 */
function weekChart(title: string, weeks: { week: string; value: number }[], units: [string, string]): HTMLElement {
    const chart = document.createElement('figure');
    chart.className = 'stats-weeks';
    const caption = document.createElement('figcaption');
    caption.className = 'px px2';
    caption.textContent = title;
    chart.append(caption);
    const values = new Map(weeks.map(({ week, value }) => [week, value]));
    const first = Math.min(currentWeek(), ...weeks.map(({ week }) => Date.parse(week)));
    const last = Math.max(currentWeek(), ...weeks.map(({ week }) => Date.parse(week)));
    const shown: string[] = [];
    for (let week = Math.max(first, last - (WEEKS - 1) * 7 * DAY_MS); week <= last; week += 7 * DAY_MS) shown.push(isoDay(week));
    const most = Math.max(0, ...shown.map((week) => values.get(week) ?? 0));
    const bars = document.createElement('div');
    bars.className = 'stats-bars';
    for (const week of shown) {
        const value = values.get(week) ?? 0;
        const bar = document.createElement('span');
        bar.className = 'stats-week';
        bar.title = `Week of ${week}: ${plural(value, ...units)}`;
        const fill = document.createElement('span');
        fill.className = 'stats-bar';
        fill.style.height = `${(value / Math.max(1, most)) * 100}%`;
        bar.append(fill);
        bars.append(bar);
    }
    const axis = document.createElement('div');
    axis.className = 'stats-axis px px2';
    axis.append(line('', shown[0]!), line('', `most ${count(most)}`), line('', shown[shown.length - 1]!));
    chart.append(bars, axis);
    return chart;
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

function cell(text: string): HTMLElement {
    const element = document.createElement('td');
    element.className = 'px px2';
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

/** A game clock in ticks as `H:MM:SS`, a tick `VBL_PER_TICK` VBLs, as the game runs awake. */
function gameClock(ticks: number): string {
    return clock(ticks * VBL_PER_TICK * 1000 / VBL_FREQUENCY);
}

/** A time in ms as `H:MM:SS`, the hours as long as they are, as the save menu shows a play time (`formatPlayTime`). */
function clock(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(seconds / 3600)}:${p(Math.floor(seconds / 60) % 60)}:${p(seconds % 60)}`;
}

/** A time in ms as hours, to a tenth below ten. */
function hours(ms: number): string {
    const value = ms / HOUR_MS;
    return value < 10 ? value.toFixed(1) : count(Math.round(value));
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

/** The Monday, UTC, that starts the current week, in ms: the server's weeks (`server/stats.ts`). */
function currentWeek(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (now.getUTCDay() + 6) % 7);
}

/** A day in ms, UTC, as `YYYY-MM-DD`. */
function isoDay(time: number): string {
    return new Date(time).toISOString().slice(0, 10);
}

/** The page's own query, `set` the set selected. */
function setQuery(id: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set('set', id);
    return `?${params}`;
}

/** The welcome page, the page's other parameters kept. */
function homeQuery(): string {
    const params = new URLSearchParams(window.location.search);
    params.delete('set');
    return `./${params.size > 0 ? `?${params}` : ''}`;
}

void showStatsPage(document.body);
