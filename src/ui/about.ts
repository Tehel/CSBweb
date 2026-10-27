/**
 * The welcome page's ABOUT (`src/ui/welcomePage.ts`): a dialog over the page, as HOW TO
 * PLAY is (`src/ui/howToPlay.ts`), with the questions a player asks of the site rather
 * than of the game. The statistics' answer says what `doc/STATISTICS.md` → "Pseudonymous"
 * says: what is sent and why, what links one player's games, how to reset the id and how
 * to send none, and the access log the times are rounded against.
 *
 * `#about` in the page's address opens it, and the footer's ABOUT is a link to it.
 */

/** The address's fragment that opens the dialog. */
export const ABOUT_HASH = '#about';

const DIALOG = `
<form class="add-set-form about-form">
  <div class="add-set-head">
    <h2 class="px" id="about-title">About</h2>
    <button type="button" class="btn px" id="about-close">Close</button>
  </div>
  <section class="about-question">
    <h3 class="px">How faithful is it?</h3>
    <p>It is a port of CSBWin, Paul R. Stevens' C++ rewrite of the Atari ST game from its disassembly, made line by line and checked against its source: the same order of things, the same numbers, the same odd corners. Where it differs on purpose, it is in what CSBWin leaves to the computer it runs on: the keys, the settings, the save menu. A dungeon that does not play as you remember it is a bug: write to csbweb[at]looten.net.</p>
  </section>
  <section class="about-question">
    <h3 class="px">Where are my saves?</h3>
    <p>In this browser, on this device: the disk icon at the top of an inventory saves, F5 saves quickly and F9 loads that back. Nothing goes to the server, so another browser does not see them, and clearing this site's data deletes them. The save menu's EXPORT writes a save to a file, and a file dropped on the menu imports it. They are genuine CSBWin files, both ways: a CSBGAME.DAT from CSBWin loads here, and a save exported from here loads in CSBWin.</p>
  </section>
  <section class="about-question">
    <h3 class="px">Can I play my own dungeon?</h3>
    <p>Yes: "+ Add my own", at the end of the fan-made dungeons, takes its files. Its dungeon.dat, Atari's or the PC's, and its graphics.dat, or Dungeon Master's or Chaos Strikes Back's in its place, with its CSBgraphics.dat and the Hint Oracle's files where it has them. It stays in your browser, to play and to edit like any other. PUBLISH offers it to the site: once a moderator approves it, everyone finds it on this page.</p>
  </section>
  <section class="about-question">
    <h3 class="px">Where are more dungeons, bigger and better?</h3>
    <p>The fan-made dungeons here are those built for the original's engine, which CSBWin plays. Many of the community's dungeons are built for Dungeon Strikes Back (DSB) instead, Sophia's engine for Windows, which goes far beyond the original: new monsters, new items and a script for anything. This site does not play them. The Dungeon Master forum keeps the <a href="https://www.dungeon-master.com/forum/viewtopic.php?t=31516" target="_blank">list of every custom dungeon</a>, each with the engine it needs and where to find it.</p>
  </section>
  <section class="about-question">
    <h3 class="px">Where can I learn more about Dungeon Master?</h3>
    <p>At <a href="http://dmweb.free.fr" target="_blank">DMweb</a>, the encyclopaedia of FTL's games: the maps of every level, the manuals, the items, the monsters and the spells, and their history.</p>
  </section>
  <section class="about-question">
    <h3 class="px">What are the statistics?</h3>
    <p>As you play, the page tells the server a few things about your game: that it started, the party once a champion joins, where the party dies, and whether it wins. They answer three questions: whether the game is actually played, which champions players prefer, and where parties die most often. The <a href="stats">statistics page</a> shows what they add up to.</p>
    <p>They hold no name, no IP address and nothing about your browser, and champions go by the names they carry, which you can type yourself. But a random id, drawn in your browser and used only to count players, links your games together: the statistics are pseudonymous rather than anonymous. Clearing this site's data in your browser draws you a new id, and SEND STATISTICS, in the GAME tab of the settings that Esc opens in the game, sends nothing at all. The web server's access log keeps every request's address, as any site's does, so every time the statistics keep is rounded to ten seconds, never the second of one request.</p>
  </section>
  <section class="about-question">
    <h3 class="px">Is it free? Is it legal?</h3>
    <p>It is free, with no account and no advertising. Dungeon Master and Chaos Strikes Back belong to their rights holders, and their files are served here only to be played; the other dungeons belong to their authors. CSBweb is a non-commercial fan project, not affiliated with or endorsed by any of them. A rights holder who writes to csbweb[at]looten.net has whatever they ask taken down.</p>
  </section>
</form>`;

/** The dialog opened over the page, the address's fragment `#about` while it is. */
export function openAbout(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'add-set about';
    dialog.setAttribute('aria-labelledby', 'about-title');
    dialog.innerHTML = DIALOG;
    dialog.querySelector('#about-close')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        dialog.remove();
        if (window.location.hash === ABOUT_HASH) history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    if (window.location.hash !== ABOUT_HASH) history.replaceState(null, '', ABOUT_HASH);
    document.body.append(dialog);
    dialog.showModal();
}
