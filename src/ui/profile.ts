/**
 * The welcome page's PROFILE (`src/ui/welcomePage.ts`): a dialog over the page, in the look
 * of ABOUT and HOW TO PLAY, where a player chooses the public name the server knows them by
 * and sees everything the server holds of them (`doc/ACHIEVEMENTS.md` → "Identity",
 * `server/identity.ts`).
 *
 * Its top section says "I shall be known on the server as:", with the name's field and SAVE,
 * the answer beside it: refused (`publicNameProblem`, checked here before it is sent),
 * taken, or saved. Once there is a name, its public id; once a name is first chosen, or a
 * new key drawn (NEW KEY), the identity key, shown this once, with COPY. Under it a field
 * that takes a key from another browser and LINK, which links this one to that name.
 *
 * Its second section is the dump, `GET PROFILE_ROUTE`: the sets this player published,
 * the recordings they shared and how many are listed, their games by set, and their
 * achievements the server's replays verified, by name. It is asked again after each change.
 *
 * A browser that keeps no `playerId` has sent nothing, so the dialog asks nothing; choosing
 * a name or linking draws one (`playerId`). `#profile` in the page's address opens it.
 */
import {
    identityKeyOf, identityKeyText, PLAYER_ID_HEADER, PROFILE_ROUTE, PUBLIC_NAME_LIMITS, publicNameProblem,
    type PlayerProfile, type ProfileIdentity, type ProfileState,
} from '../data/DataSets';
import { achievementDefs } from './achievementFiles';
import { closeOnBackdrop } from './backdropClose';
import { keptPlayerId, playerId } from './gameEvents';

/** The address's fragment that opens the dialog. */
export const PROFILE_HASH = '#profile';

const DIALOG = `
<form class="add-set-form about-form profile-form">
  <div class="add-set-head">
    <h2 class="px" id="profile-title">Profile</h2>
    <button type="button" class="btn px" id="profile-close">Close</button>
  </div>
  <section class="about-question profile-identity">
    <h3 class="px"><label for="profile-name">I shall be known on the server as:</label></h3>
    <div class="profile-row">
      <input id="profile-name" name="name" maxlength="${PUBLIC_NAME_LIMITS.max}" autocomplete="off" spellcheck="false">
      <button type="button" class="btn px" id="profile-save">Save</button>
    </div>
    <p class="profile-name-status" aria-live="polite"></p>
    <p class="profile-public-id" hidden></p>
    <div class="profile-key" hidden>
      <p>Your identity key, shown this once. Keep it: given in another browser, or in this one once its data is cleared, it links that browser to this name.</p>
      <div class="profile-row">
        <code class="profile-key-text"></code>
        <button type="button" class="btn px" id="profile-copy">Copy</button>
      </div>
      <p class="profile-copy-status" aria-live="polite"></p>
    </div>
    <p class="profile-new-key" hidden>Lost your key? <button type="button" class="btn px" id="profile-new-key">New key</button> draws another, and the old one stops working.</p>
    <p><label for="profile-link-key">A key from another browser links this one to its name:</label></p>
    <div class="profile-row">
      <input id="profile-link-key" name="key" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX">
      <button type="button" class="btn px" id="profile-link">Link</button>
    </div>
    <p class="profile-link-status" aria-live="polite"></p>
  </section>
  <section class="about-question profile-known">
    <h3 class="px">What the server knows about you</h3>
    <div class="profile-dump" aria-live="polite"></div>
  </section>
</form>`;

/** How the dump says a state. */
const STATES: Record<ProfileState, string> = { pending: 'awaiting a moderator', approved: 'listed', hidden: 'hidden by a moderator' };

/** The dialog opened over the page, the address's fragment `#profile` while it is. */
export function openProfile(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set about profile';
    dialog.setAttribute('aria-labelledby', 'profile-title');
    dialog.innerHTML = DIALOG;
    const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
    const name = $<HTMLInputElement>('#profile-name');
    const linkKey = $<HTMLInputElement>('#profile-link-key');
    const nameStatus = $('.profile-name-status');
    const linkStatus = $('.profile-link-status');
    const publicId = $('.profile-public-id');
    const keyBox = $('.profile-key');
    const newKey = $('.profile-new-key');
    const dump = $('.profile-dump');
    let identity: PlayerProfile['identity'] = null;

    /** The identity as the server answered it: its name in the field, its id, and NEW KEY offered. */
    const showIdentity = (shown: { name: string | null; id: string } | null) => {
        if (shown !== null) name.value = shown.name ?? '';
        publicId.hidden = shown === null;
        publicId.textContent = shown === null ? '' : `Your public id: ${shown.id}`;
        newKey.hidden = shown === null || !keyBox.hidden;
    };
    const showKey = (key: string) => {
        keyBox.hidden = false;
        newKey.hidden = true;
        $('.profile-key-text').textContent = identityKeyText(key);
        $('.profile-copy-status').textContent = '';
    };
    const refresh = async () => {
        const answer = await askProfile();
        if (typeof answer === 'string') {
            dump.replaceChildren(paragraph('profile-failure', answer));
            return;
        }
        identity = answer?.identity ?? null;
        if (identity !== null && identity.name === null) nameStatus.textContent = 'A moderator has reset your name: choose another.';
        showIdentity(identity);
        dump.replaceChildren(...dumpOf(answer));
    };

    const save = async () => {
        const chosen = name.value.trim();
        const problem = publicNameProblem(chosen);
        if (problem !== null) {
            nameStatus.textContent = `Refused: ${problem}`;
            return;
        }
        if (chosen === identity?.name) {
            nameStatus.textContent = 'Saved.';
            return;
        }
        const answer = await change({ action: 'name', name: chosen });
        if (typeof answer === 'string') {
            nameStatus.textContent = /taken|withdrawn/.test(answer) ? `Taken: ${answer}` : `Refused: ${answer}`;
            return;
        }
        nameStatus.textContent = 'Saved.';
        if (answer.key !== undefined) showKey(answer.key);
        showIdentity(answer);
        await refresh();
    };
    const link = async () => {
        const key = identityKeyOf(linkKey.value);
        if (key === null) {
            linkStatus.textContent = 'Refused: this is not an identity key.';
            return;
        }
        const answer = await change({ action: 'link', key });
        if (typeof answer === 'string') {
            linkStatus.textContent = `Refused: ${answer}`;
            return;
        }
        linkKey.value = '';
        linkStatus.textContent = answer.name === null ? 'Linked, to a name a moderator has reset.' : `Linked: this browser is ${answer.name} too.`;
        nameStatus.textContent = '';
        await refresh();
    };

    $('#profile-close').addEventListener('click', () => dialog.close());
    $('#profile-save').addEventListener('click', () => void save());
    $('#profile-link').addEventListener('click', () => void link());
    $('#profile-new-key').addEventListener('click', () => void change({ action: 'key' }).then((answer) => {
        if (typeof answer === 'string') nameStatus.textContent = answer;
        else if (answer.key !== undefined) showKey(answer.key);
    }));
    $('#profile-copy').addEventListener('click', () => {
        const status = $('.profile-copy-status');
        const text = $('.profile-key-text').textContent ?? '';
        navigator.clipboard.writeText(text).then(() => (status.textContent = 'Copied.'), () => {
            getSelection()?.selectAllChildren($('.profile-key-text'));
            status.textContent = 'Selected: copy it with your keyboard.';
        });
    });
    // Enter in a field does what its button does, and never submits the form.
    dialog.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault());
    name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void save();
    });
    linkKey.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void link();
    });

    closeOnBackdrop(dialog);
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (window.location.hash === PROFILE_HASH) history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    if (window.location.hash !== PROFILE_HASH) history.replaceState(null, '', PROFILE_HASH);
    document.body.append(dialog);
    dialog.showModal();
    dump.replaceChildren(paragraph('profile-none', 'Asking the server…'));
    void refresh();
}

/**
 * What the server holds of this browser's player (`PlayerProfile`), `null` where the browser
 * keeps no `playerId`, which has sent nothing, else why not.
 */
async function askProfile(): Promise<PlayerProfile | null | string> {
    const player = keptPlayerId();
    if (player === null) return null;
    const response = await fetch(PROFILE_ROUTE, { headers: { [PLAYER_ID_HEADER]: player } }).catch(() => null);
    if (!response) return 'The server cannot be reached.';
    if (!response.ok) return `The server answered HTTP ${response.status}.`;
    return await response.json() as PlayerProfile;
}

/** `body` posted to `PROFILE_ROUTE` as this browser's player: the identity once done, else why not, as the server says it. */
async function change(body: object): Promise<ProfileIdentity | string> {
    const response = await fetch(PROFILE_ROUTE, {
        method: 'POST', headers: { [PLAYER_ID_HEADER]: playerId(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null);
    if (!response) return 'the server cannot be reached.';
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return json as ProfileIdentity;
    const error = (json as { error?: unknown } | null)?.error;
    return typeof error === 'string' ? error : `the server answered HTTP ${response.status}.`;
}

/** The dump's lines: a heading and a list for each part, `null` a browser the server knows nothing of. */
function dumpOf(profile: PlayerProfile | null): HTMLElement[] {
    if (profile === null) return [paragraph('profile-none', 'This browser has sent the server nothing: it holds nothing of you.')];
    const { identity, dataSets, recordings, replays, statistics, achievements } = profile;
    const part = (title: string, rows: string[], none: string) => {
        const block = document.createElement('div');
        block.className = 'profile-part';
        const heading = document.createElement('h4');
        heading.className = 'px';
        heading.textContent = title;
        block.append(heading);
        if (rows.length === 0) block.append(paragraph('profile-none', none));
        else {
            const list = document.createElement('ul');
            list.append(...rows.map((row) => Object.assign(document.createElement('li'), { textContent: row })));
            block.append(list);
        }
        return block;
    };
    const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
    return [
        part('Your name', identity === null ? [] : [
            `${identity.name ?? 'None: a moderator reset it'}, public id ${identity.id}`,
            identity.browsers === 1 ? 'Known in this browser alone.' : `Known in ${identity.browsers} browsers.`,
        ], 'None chosen.'),
        part('Dungeons you published', dataSets.map((set) => `${set.name}: ${STATES[set.state]}`), 'None.'),
        part(`Recordings you shared${recordings.length > 0 ? `, ${plural(replays, 'replay')} listed` : ''}`,
            recordings.map((recording) => `${recording.title}, of ${recording.name}: ${STATES[recording.state]}${recording.broken ? ', broken on this build' : ''}`), 'None.'),
        part('Your games', statistics.map((row) => `${row.name}: ${plural(row.started, 'game')} started, ${row.won} won, ${plural(row.lost, 'death')}`),
            'None counted.'),
        part('Your achievements, verified', achievements.map((row) => `${row.name}: ${namesOf(row.dataSet, row.unlocked).join(', ')}`),
            'None yet. Once you have a name, your browser sends the server the recording of each game that unlocks one, at a save and at its end, and the server replays it to verify them.'),
        paragraph('profile-note', 'Your games are counted under the random id this browser drew, which no public page shows, nor any answer but this one: your name tells the server which ids are yours, and shows this to you alone. Your sessions and your time played are counted with no id at all.'),
    ];
}

/** The names of `ids`, achievements of the set `dataSet` (`achievementDefs`), in the file's order; an id the file does not hold goes by itself, last. */
function namesOf(dataSet: string, ids: readonly string[]): string[] {
    const defs = achievementDefs(dataSet) ?? [];
    return [...defs.filter((def) => ids.includes(def.id)).map((def) => def.name), ...ids.filter((id) => !defs.some((def) => def.id === id))];
}

function paragraph(className: string, text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    return p;
}
