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
 * - **To a moderator**, whose switch is on (the welcome page's), a player's page ends with
 *   MODERATION (`GET api/identities/<id>`): how many browsers share the name, RESET NAME,
 *   which asks a second click, then withdraws the name (`POST api/identities/<id>`), and
 *   the identity's proofs, the latest first, each its set, when it was sent, how far it got
 *   and its claims' verdicts, and, while its package is kept, PLAY, which plays it in the
 *   game's page (`?recording=proof:<id>`), and DOWNLOAD (`GET api/proofs/<id>`). A name
 *   reset leaves the Hall at once, and the section stays, so that its proofs can be read.
 *
 * An answer that does not come is said where it would have been.
 */
import '../ui/welcomePage.css';
import '../stats/statsPage.css';
import './famePage.css';
import logoUrl from '../assets/csbweb-logo.jpg';
import type { FameAchievement, FamePlayerPage, FameSet, FameSummary } from '../../server/answers';
import type { ClaimState, ModeratedIdentity, ModeratedProof } from '../data/DataSets';

/**
 * The Hall's routes (`FAME_ROUTE`, `FAME_SETS`, `FAME_PLAYERS`, `src/data/DataSets.ts`):
 * not imported, as the page loads none of the game's modules, which the build would share
 * with it as a chunk of the game's.
 */
const FAME_ROUTE = 'api/fame';
const FAME_SETS = 'sets';
const FAME_PLAYERS = 'players';
/**
 * And the moderators' (`IDENTITIES_ROUTE`, `PROOFS_ROUTE`, `PROOF_RECORDING_PREFIX`,
 * `PLAYER_ID_HEADER`), the page's player as the game's page keeps it (`PLAYER_ID_KEY`,
 * `src/ui/gameEvents.ts`), and the moderator's switch (`MODERATION_KEY`,
 * `src/ui/welcomePage.ts`), `'off'` once turned off.
 */
const IDENTITIES_ROUTE = 'api/identities';
const PROOFS_ROUTE = 'api/proofs';
const PROOF_RECORDING_PREFIX = 'proof:';
const PLAYER_ID_HEADER = 'X-Player-Id';
const PLAYER_ID_KEY = 'csbweb_player_v1';
const MODERATION_KEY = 'csbweb_moderation_v1';

/** What a proof's state and a claim's verdict are said as. */
const PROOF_STATES = { queued: 'awaiting the verifier', checked: 'replayed', drifted: 'drifted' } as const;
const CLAIM_STATES: Record<ClaimState, string> = { verified: 'verified', dropped: 'dropped', unverified: 'not verified' };

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
    /**
     * The player the URL names, shown in the panel; else the set it names, or the column's
     * first. `fresh` asks the server past the browser's cache, which keeps an answer its 30 s:
     * a name a moderator has just reset is 404 at once.
     */
    function select(fresh = false): void {
        const player = shownPlayer();
        const asked = new URLSearchParams(window.location.search).get('set');
        const set = player === null ? summary!.sets.find((known) => known.id === asked) ?? summary!.sets[0] : undefined;
        const shown = player === null ? set?.id ?? null : `#${player}`;
        selected = shown;
        for (const pick of picks) pick.setAttribute('aria-current', String(pick.dataset.set === shown));
        panel.replaceChildren();
        if (player !== null) {
            const asker = moderatorId();
            void Promise.all([
                fetchJson<FamePlayerPage>(`${FAME_ROUTE}/${FAME_PLAYERS}/${encodeURIComponent(player)}`, {}, fresh ? 'reload' : 'default'),
                asker === null ? null : fetchJson<ModeratedIdentity>(`${IDENTITIES_ROUTE}/${encodeURIComponent(player)}`, { [PLAYER_ID_HEADER]: asker }),
            ]).then(([page, moderated]) => {
                if (selected !== shown) return;
                panel.replaceChildren(...(page === null ? [heading('No such player'), line('stats-none', 'No player of the Hall has this id, or their name was withdrawn.')] : playerView(page)));
                if (moderated !== null && asker !== null) panel.append(moderation(moderated, asker, () => select(true)));
            });
        } else if (set !== undefined) {
            void fetchJson<FameSet>(`${FAME_ROUTE}/${FAME_SETS}/${encodeURIComponent(set.id)}`).then((fame) => {
                if (selected !== shown) return;
                panel.replaceChildren(...(fame === null ? [heading(set.name), line('stats-none', 'This dungeon\'s achievements cannot be read now.')] : setView(fame)));
            });
        }
    }
    window.addEventListener('popstate', () => select());
    window.addEventListener('hashchange', () => select());
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

/**
 * A moderator's section of a player's page: the identity's browsers, RESET NAME, and its
 * proofs, `asker` the moderator's `playerId`; `again` shows the page again once the name
 * is reset.
 */
function moderation(identity: ModeratedIdentity, asker: string, again: () => void): HTMLElement {
    const part = section('Moderation', []);
    part.classList.add('fame-moderation');
    part.append(line('fame-text', `${plural(identity.browsers, 'browser')} share${identity.browsers === 1 ? 's' : ''} this identity.`));
    if (identity.name !== null) {
        const row = document.createElement('div');
        row.className = 'fame-reset';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'btn px fame-reset-button';
        reset.textContent = 'Reset name';
        const status = line('fame-reset-status px px2', '');
        let asked = false;
        reset.addEventListener('click', () => {
            if (!asked) {
                asked = true;
                reset.textContent = 'Confirm reset';
                status.textContent = `${identity.name} leaves the Hall, and nobody may choose this name again.`;
                return;
            }
            reset.disabled = true;
            void fetch(`${IDENTITIES_ROUTE}/${encodeURIComponent(identity.id)}`, {
                method: 'POST', headers: { [PLAYER_ID_HEADER]: asker, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }),
            }).then(async (answer) => {
                if (answer.ok) return again();
                status.textContent = `Not reset: ${((await answer.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${answer.status}`}`;
                reset.disabled = false;
            }, () => {
                status.textContent = 'Not reset: the server does not answer.';
                reset.disabled = false;
            });
        });
        row.append(reset, status);
        part.append(row);
    } else part.append(line('stats-none', 'Its name is reset: it is in no answer of the Hall until its player chooses another.'));
    const list = document.createElement('ol');
    list.className = 'fame-list fame-proofs';
    for (const proof of identity.proofs) list.append(proofItem(proof, asker));
    part.append(identity.proofs.length === 0 ? line('stats-none', 'No proof sent.') : list);
    return part;
}

/** A proof as a moderator reads it: its set, when, how far it got, its claims, and PLAY and DOWNLOAD while its package is kept. */
function proofItem(proof: ModeratedProof, asker: string): HTMLElement {
    const item = document.createElement('li');
    item.className = 'fame-proof';
    item.dataset.proof = proof.id;
    const head = document.createElement('div');
    head.className = 'fame-head';
    head.append(line('fame-name px px2', proof.name), line('fame-day px px2', `${dayTime(proof.sentAt)}, ${PROOF_STATES[proof.state]}`));
    item.append(head);
    if (proof.reason !== undefined) item.append(line('fame-text', `It drifted: ${proof.reason}`));
    const claims = Object.entries(proof.claims);
    item.append(line('fame-text fame-claims', claims.length === 0 ? 'No claim.' : claims.map(([id, state]) => `${id} ${CLAIM_STATES[state]}`).join(', ')));
    if (!proof.kept) {
        item.append(line('fame-day', 'Its package is deleted: it verified nothing new.'));
        return item;
    }
    const actions = document.createElement('div');
    actions.className = 'fame-reset';
    const play = document.createElement('a');
    play.className = 'btn px fame-play';
    const params = new URLSearchParams(window.location.search);
    params.delete('set');
    params.delete('player');
    params.set('recording', `${PROOF_RECORDING_PREFIX}${proof.id}`);
    play.href = `./?${params}`;
    play.textContent = 'Play';
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'btn px fame-download';
    download.textContent = 'Download';
    const status = line('fame-reset-status px px2', '');
    download.addEventListener('click', () => {
        void fetch(`${PROOFS_ROUTE}/${proof.id}`, { headers: { [PLAYER_ID_HEADER]: asker } }).then(async (answer) => {
            if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
            const url = URL.createObjectURL(await answer.blob());
            const link = Object.assign(document.createElement('a'), { href: url, download: `proof-${proof.id}.gz` });
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
            status.textContent = '';
        }).catch((error: unknown) => {
            status.textContent = `Not downloaded: ${error instanceof Error ? error.message : String(error)}`;
        });
    });
    actions.append(play, download, status);
    item.append(actions);
    return item;
}

/** The moderator this browser's player is, as far as the page knows: its `playerId`, or `null` without one or with the switch off. */
function moderatorId(): string | null {
    try {
        if (localStorage.getItem(MODERATION_KEY) === 'off') return null;
        return localStorage.getItem(PLAYER_ID_KEY) || null;
    } catch {
        return null;
    }
}

/** A time in ms as `YYYY-MM-DD HH:MM`, the browser's local time. */
function dayTime(time: number): string {
    const date = new Date(time);
    const two = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
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

/** The answer of `route`, asked with `headers` through the browser's cache as `cache` says, or `null` where it does not come. */
async function fetchJson<T>(route: string, headers: Record<string, string> = {}, cache: RequestCache = 'default'): Promise<T | null> {
    try {
        const answer = await fetch(route, { headers, cache });
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
