// Golden-frame probe.
//
// Drives the running dev server over the Chrome DevTools Protocol — boot, enable Debug,
// build a party at the Hall of Champions mirrors, open a champion's inventory, select in
// it, open the attack menu —
// and writes a PNG per state.
//
// What it captures is the **320x200 game canvas**, read back with `getImageData` — not a
// screenshot of the page. The page around the canvas is DOM debug chrome (buttons, a
// slider, a scrollbar, the log panel), all of it drawn with the host's fonts and widget
// theme, so a full-page shot could only ever be compared on the machine that took it. The
// canvas is written solely by `putImageData` (the CRT effect is a separate GL canvas, and
// it is off unless switched on), which makes the read-back exact and host-independent.
// `compare-frames.mjs` then compares decoded *pixels*, so the PNG encoder does not enter
// into it either.
//
// `Math.random` is seeded and localStorage cleared on every load, so the frames are
// identical run to run.
//
// Usage:
//   bash tools/check-frames.sh                     # normally: it starts both daemons
//
// or, driving it directly against daemons you started yourself:
//
//   npm run dev &
//   google-chrome --headless=new --remote-debugging-port=9222 \
//     --window-size=1600,1000 http://localhost:9000/ &
//   node tools/probe-frames.mjs tools/frames        # refresh the committed baseline
//   node tools/probe-frames.mjs /tmp/now            # then diff /tmp/now against it
//
// CDP_PORT overrides the DevTools port (default 9222).
//
// This is the closest thing the project has to a rendering test (PLAN.md Phase 15) — it
// caught nothing during the Phase 14 split, which is exactly what it was there to do.
import { writeFileSync } from 'node:fs';
import { encodePng } from './lib/png.mjs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const DEV_PORT = Number(process.env.DEV_PORT ?? 9000);
const APP = `http://localhost:${DEV_PORT}/`;
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(m.params.type))
    logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
// Read the canvas back as raw pixels. Base64 is built in 32k slices because
// `String.fromCharCode(...bytes)` on a whole 256000-byte frame overflows the argument
// limit, and character-by-character concatenation is far slower than it looks.
const CAPTURE_CANVAS = `(() => {
  const c = document.getElementById('game-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000)
    s += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + 0x8000, d.length)));
  return { width: c.width, height: c.height, data: btoa(s) };
})()`;

const shot = async (name) => {
  const cap = await evaluate(CAPTURE_CANVAS);
  const rgba = Buffer.from(cap.data, 'base64');
  writeFileSync(`${process.argv[2]}/${name}.png`, encodePng(cap.width, cap.height, rgba));
  console.log('  wrote', name + '.png', `(${cap.width}x${cap.height})`);
};
const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true})),1`);
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click(),1`);
// button: 0 = left (DM mask 2), 2 = right (DM mask 1)
const canvasClick = (x, y, button = 0) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const sx=r.left+${x}*r.width/320, sy=r.top+${y}*r.height/200;
  for (const t of ['mousedown','mouseup']) c.dispatchEvent(new MouseEvent(t,{clientX:sx,clientY:sy,button:${button},buttons:${button===2?2:1},bubbles:true}));
  return 1;})()`);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
// Pin the viewport. The frames no longer depend on it — they are the canvas, not the page —
// but the click helper maps game coordinates through the canvas's bounding rect, so a
// window too small to lay the page out as intended would send clicks somewhere else.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
});
// Deterministic run: no persisted UI settings / quick-save, and a seeded Math.random —
// `AddCharacter` rolls food and water from it (`HallOfChampions.addCharacter`), so without the seed
// the status bars would differ run to run.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.clear(); } catch (e) {}
  // The save/load screen lists IndexedDB, so a frame of it would otherwise carry
  // whatever the last probe session saved. Both drivers of this script run Chrome on a
  // throwaway profile (probe-ui.mjs and check-frames.sh both pass --user-data-dir), so
  // there is no real save to lose here.
  try { indexedDB.deleteDatabase('dmweb-saves'); } catch (e) {}
  let seed = 0x2545f491;
  Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
                        return ((seed >>> 0) % 1000000) / 1000000; };
` });
// `?intro=0` skips the title animation and the dungeon entrance
// (`src/renderer/intro/BootSequence.ts`), so the six frames below still open on the
// adventure screen. The entrance gets frames of its own at the end.
await send('Page.navigate', { url: `${APP}?intro=0` });
await wait(3500);
console.log('state: booted');            await shot('01-boot');
// Ensure Debug is ON (it persists in localStorage, so toggle only when needed).
await evaluate(`(()=>{const b=document.getElementById('btn-debug');
  if(!b.classList.contains('is-pressed')) b.click(); return b.classList.contains('is-pressed');})()`);
await wait(200);
// Build the party the way a player does: stand at each of the first four preset heroes'
// mirrors, click the portrait (`AddCharacter`) and press Resurrect (button 160). This
// used to press F8, a dev-only random-party key that no longer exists; driving the real
// Hall of Champions needs no scaffolding in the app, only the public game API that
// `tools/dump-hall-of-champions.ts` drives headlessly.
const BUILD_PARTY = `(()=>{
  const { game, renderView } = window.__probe;
  const DELTA_X = [0, 1, 0, -1], DELTA_Y = [-1, 0, 1, 0];
  // HALK first: champion 0 is the one the frames below open an inventory and an attack
  // panel on, and DAROOU (first in mirror order) is empty-handed, which would leave
  // frame 05 showing PUNCH/KICK/WAR CRY instead of a weapon's attack list.
  const all = game.dungeonState.getData().presetHeroes ?? [];
  const halk = all.find(h => h.name === 'HALK');
  const heroes = [halk, ...all.filter(h => h !== halk)].filter(Boolean).slice(0, 4);
  for (const hero of heroes) {
    // Face the mirror from the cell in front of it, as a player walking up would.
    const facing = (hero.location.wall + 2) & 3;
    const party = game.party.state;
    party.position.x = hero.location.x - DELTA_X[facing];
    party.position.y = hero.location.y - DELTA_Y[facing];
    party.position.z = hero.location.map;
    party.facing = facing;
    game.handleWallClick();
    game.resurrectReincarnateCancel(160);
  }
  renderView();
  return game.party.state.champions.map(c => c.name).join(',');
})()`;
await evaluate(BUILD_PARTY).then(names => console.log('  party:', names));
await wait(600);
console.log('state: party built');       await shot('02-party');
// Right-click a party block (DM mask 1, button id 7) opens that champion's inventory.
await canvasClick(15, 15, 2);  await wait(700);
console.log('state: inventory');         await shot('03-inventory');
// Take an item out of the inventory. (41,66) is button id 30, body slot 2, which the Hall
// of Champions fills for HALK with object 39027; selecting moves it out of the grid and
// into the cursor, so this frame differs from 03 by the vacated slot.
//
// It used to click (15,15) — the same point as the right-click above, which is button id
// 12, champion 0's *party block* in the top bar, not the inventory grid at all. Nothing
// moved on screen and 04 came out identical to 03, so the frame proved nothing beyond
// what 03 already proved. `compare-frames.mjs` now refuses a baseline with two identical
// frames, which is what makes that mistake visible instead of silent.
await canvasClick(41, 66, 0);  await wait(400);
console.log('state: inventory+select');  await shot('04-inventory-sel');
// Put it back, so the frames below are unaffected by the detour.
await canvasClick(41, 66, 0);  await wait(400);
await canvasClick(15, 15, 2);  await wait(500);   // back out
// Champion 0's attack button (233-252 x 86-120) opens the real attack menu, listing
// that champion's legal attacks. This used to be a dev-only F7 preview of a
// placeholder panel; the panel is now `ui/Attack.ts` driven by `word20252`.
await canvasClick(240, 100, 0); await wait(600);
console.log('state: attack panel');      await shot('05-attack');
// The disk icon (`buttons17760[1]`, id 140) raises the save/load screen over the
// viewport. Reopen an inventory first — the attack-panel step backed out of it. The
// browser store was emptied on boot, so the list is reliably empty and this frame pins
// the panel itself: graphic 0, the interior band tiled down over the full-width button
// frame, and the two bottom buttons with LOAD unlabelled because nothing is selected.
await canvasClick(15, 15, 2);  await wait(600);
await canvasClick(177, 40, 0); await wait(900);
console.log('state: save menu');         await shot('06-savemenu');

// The dungeon entrance, with the intro left on. The wait has to cover the whole title
// animation — about 116 vertical blanks — plus the entrance's own fade; once that fade
// finishes the screen is static until the player clicks, so the capture is stable.
//
// This is the only evidence that the corridor behind the doors actually renders. It is
// drawn by the real viewport renderer over a synthetic 5x5 level
// (`src/renderer/intro/PrisonLevel.ts`), and `tools/dump-intro.ts` can check the level and
// the compositing but not the pixels the bytecode programs produce.
await send('Page.navigate', { url: APP });
await wait(7000);
console.log('state: entrance');          await shot('07-entrance');
// The scroll at the bottom of the button column (button id 202).
await canvasClick(270, 192, 0); await wait(1500);
console.log('state: credits');           await shot('08-credits');

// A pressed crack switch (`doc/PROVEN_FACTS.md`, "Crack Switch (In) placement"): level 4,
// (14,29) facing west, after the click. The pushed-in crack must sit low on the wall where
// the Out crack was, not at eye level where `graphics.dat`'s coordinate set would put it.
// Built from a fresh `?intro=0` boot with the same party, since TouchWall needs a leader.
// The click also opens the grid at (13,28), off to the right; the wait covers its opening.
await send('Page.navigate', { url: `${APP}?intro=0` });
await wait(3500);
await evaluate(BUILD_PARTY);
await evaluate(`(()=>{
  const { game, renderView } = window.__probe;
  const party = game.party.state;
  party.position.x = 14; party.position.y = 29; party.position.z = 4;
  party.facing = 3;
  party.brightness = 1000;   // level 4 is dark, and no one holds a torch: full magic light
  const touched = game.handleWallClick();
  renderView();
  return touched;
})()`).then(t => console.log('  touched:', t));
await wait(3000);
console.log('state: crack switch');      await shot('09-crack-switch');

console.log('--- console errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
