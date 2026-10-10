// Golden-frame probe.
//
// Drives the running dev server over the Chrome DevTools Protocol — boot, enable Debug,
// build a party at the Hall of Champions mirrors, open a champion's inventory, select in
// it, open the attack menu —
// and writes a PNG per state.
//
// What it captures is the **320x200 screen as CSBWin draws it**, not a screenshot of the
// page, nor even the canvas's colours: the palette-index buffer the canvas was last given,
// and the palette each pixel went through (`GameScreen.presentedFrame`,
// `src/renderer/csbwin/PresentedFrame.ts`), written as `tools/lib/frames.mjs` says. A
// renderer that draws a slot holding the same colour as the right one fails, and a change
// to how an Atari colour is shown on the canvas alone fails nothing. The page around the
// canvas is DOM debug chrome, drawn with the host's fonts and widget theme, and enters into
// nothing. `compare-frames.mjs` then compares what the frames hold, so the PNG encoder does
// not enter into it either. Each frame is checked against the canvas as it is taken: every
// pixel of one code showed the same colour there, which is the colour the file keeps to be
// looked at.
//
// `Math.random` is seeded and localStorage cleared on every load, so the frames are
// identical run to run.
//
// A few things are asserted on the spot rather than compared as frames, since no frame
// shows them: the CRT effect, which screens take the mouse wheel, a move of the pointer
// left to the VBL's frame to paint, the keys of the entrance's chooser, the download its
// EXPORT starts, and a file dropped on it. See `check` below.
// A failure there exits 1.
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
// CDP_PORT overrides the DevTools port (default 9222), and APP_URL the page (the dev
// server on DEV_PORT, 9000), which must have `window.__probe`: the dev server's, or a
// build's made with `CSBWEB_PROBE=1` (`vite.config.mts`).
//
// This is the closest thing the project has to a rendering test (PLAN.md Phase 15) — it
// caught nothing during the Phase 14 split, which is exactly what it was there to do.
import { writeFileSync } from 'node:fs';
import { BUILD_PARTY } from './lib/buildParty.mjs';
import { encodeFrame } from './lib/frames.mjs';

const PORT = Number(process.env.CDP_PORT ?? 9222);
const DEV_PORT = Number(process.env.DEV_PORT ?? 9000);
// APP_URL: a page served elsewhere than the dev server, built with its probe handle
// (`check-frames.sh --url`).
const APP = process.env.APP_URL ?? `http://localhost:${DEV_PORT}/`;
const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const downloads = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Browser.downloadWillBegin') downloads.push(m.params.suggestedFilename);
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
// The screen as last presented, and the canvas's colour for each of its codes, with the
// first pixel whose colour is not its code's.
const CAPTURE_FRAME = `(() => {
  const frame = window.__probe.screen.presentedFrame();
  const c = document.getElementById('game-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const colours = {};
  let stray = null;
  frame.codes.forEach((code, i) => {
    const rgb = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const was = colours[code];
    if (!was) colours[code] = rgb;
    else if (!stray && was.some((v, k) => v !== rgb[k])) stray = { x: i % frame.width, y: Math.floor(i / frame.width), code, was, rgb };
  });
  return { frame, colours, stray };
})()`;

const canvasPixels = async () => (await evaluate(CAPTURE_CANVAS)).data;
/** Writes the frame, and returns the canvas's pixels for the checks made on the spot. */
const shot = async (name) => {
  const { frame, colours, stray } = await evaluate(CAPTURE_FRAME);
  if (stray) check(false, `${name}: code ${stray.code} shows ${stray.was} on the canvas, and ${stray.rgb} at (${stray.x},${stray.y})`);
  writeFileSync(`${process.argv[2]}/${name}.png`, encodeFrame(frame, colours));
  console.log('  wrote', name + '.png', `(${frame.width}x${frame.height})`);
  return canvasPixels();
};
const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
// The CRT effect is a WebGL canvas, `#crt-canvas` (`createCrtEffect`, `src/lib/crt.ts`):
// absent where Chrome gives no WebGL context. Nothing about the effect can
// be checked then, and that fails the run rather than pass it unseen.
const crtEffect = () => evaluate(`(()=>{const gl=document.getElementById('crt-canvas');
  return !gl ? 'unavailable' : getComputedStyle(gl).display === 'none' ? 'off' : 'on';})()`);
const key = (k) => evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true})),1`);
const click = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click(),1`);
// Whether the game takes a notch of the wheel over the canvas, rather than leave it to the
// page: a save menu's list does, the disk menu's and the entrance's chooser's, and nothing
// else. That it scrolls the list is `tools/dump-save-menu.ts`'s to show.
const wheelTaken = () => evaluate(`(()=>{const e=new WheelEvent('wheel',{deltaY:100,cancelable:true,bubbles:true});
  document.getElementById('game-canvas').dispatchEvent(e); return e.defaultPrevented;})()`);
// button: 0 = left (DM mask 2), 2 = right (DM mask 1)
const canvasClick = (x, y, button = 0) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  const sx=r.left+${x}*r.width/320, sy=r.top+${y}*r.height/200;
  for (const t of ['pointerdown','pointerup']) c.dispatchEvent(new PointerEvent(t,{isPrimary:true,pointerType:'mouse',clientX:sx,clientY:sy,button:${button},buttons:${button===2?2:1},bubbles:true}));
  return 1;})()`);
// A click as a player makes it: CDP's own mouse events at a point of the page, which the
// browser hit-tests, where `canvasClick` hands its events to the game canvas whatever lies
// over it.
const realClick = async (x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
// The save menu's EXPORT downloads a file. Chrome is told to announce a download and keep
// none, so the run leaves nothing on the disk.
await send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
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
  // A page opened with \`keepsaves\` keeps the store, so a game saved on one page can be
  // resumed from the entrance of the next.
  if (!location.search.includes('keepsaves')) {
    try { indexedDB.deleteDatabase('csbweb-saves'); } catch (e) {}
  }
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
// The four champions, from the Hall of Champions mirrors (`tools/lib/buildParty.mjs`).
await evaluate(BUILD_PARTY).then(names => console.log('  party:', names));
await wait(600);
console.log('state: party built');       await shot('02-party');
// Right-click a party block (DM mask 1, button id 7) opens that champion's inventory.
await canvasClick(15, 15, 2);  await wait(700);
console.log('state: inventory');
const inventory = await shot('03-inventory');
// The effect is shown the game canvas and paints nothing on it: its curve and scanlines are
// drawn on its own canvas, at the size it is shown. The pointer is read through the same
// curve, so a point of the tube is the screen pixel it shows: the middle stays where it is,
// and a point towards a corner shows a pixel nearer the corner, the picture being shrunk
// into the glass. Without the effect, the pointer is the plain scaling.
const hoverAt = (u, v) => evaluate(`(()=>{const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+${u}*r.width,clientY:r.top+${v}*r.height,bubbles:true}));
  const p=window.__probe.screen.ui.hoverPoint; return p ? p.x+','+p.y : 'none';})()`);
await click('#btn-crt'); await wait(500);
const crtInPlay = await crtEffect();
check(crtInPlay !== 'unavailable', 'the CRT effect exists (without it this Chrome gives no WebGL context, and nothing below is checked)');
check(crtInPlay === 'on', 'the CRT button turns the effect on');
check(await canvasPixels() === inventory, 'CRT effect on: the game canvas keeps its pixels');
const tubeSize = await evaluate(`(()=>{const t=document.getElementById('crt-canvas');return t.width+'x'+t.height;})()`);
check(tubeSize === '960x600', `the effect is drawn at the size it is shown, 960x600 (${tubeSize})`);
check(await hoverAt(0.5, 0.5) === '160,100', 'CRT effect on: the tube\'s middle is the screen\'s');
const curved = (await hoverAt(0.1, 0.1)).split(',').map(Number);
check(curved[0] < 32 && curved[1] < 20, `CRT effect on: the pointer at (32,20)'s place shows a pixel nearer the corner (${curved})`);
check(await hoverAt(0.002, 0.002) === '0,0', 'CRT effect on: a point of the tube\'s black corner is the screen\'s corner');
await click('#btn-crt'); await wait(200);
check(await hoverAt(0.1, 0.1) === '32,20', 'CRT effect off: the pointer is the plain scaling');
await evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
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
// The disk icon (`buttons17760[1]`, id 140) raises the save/load dialog over the whole
// screen, cleared. Reopen an inventory first — the attack-panel step backed out of it.
// The browser store was emptied on boot, so the list is reliably its "NEW SAVE" row alone
// and this frame pins the dialog itself: the frame, the two panels and the four buttons,
// all pieces of graphic 0, with LOAD and EXPORT unlabelled because that row holds no save
// to load or to export.
await canvasClick(15, 15, 2);  await wait(600);
await canvasClick(177, 40, 0); await wait(900);
console.log('state: save menu');         await shot('06-savemenu');
check(await wheelTaken(), 'the disk menu takes the wheel, for its list');
// A move of the pointer paints nothing: the VBL's frame draws the cursor where the mouse
// is by then, as CSBWin's VBL handler does. A mouse reports faster than the screen is
// composed, and a paint for each move kept the browser from showing any. The pointer
// leaves again, so that no later frame holds a cursor.
const moves = await evaluate(`(async()=>{const {screen}=window.__probe;const c=document.getElementById('game-canvas');const r=c.getBoundingClientRect();
  let paints=0; const own=screen.presentViewport; screen.presentViewport=function(){paints++; return own.call(this);};
  for (let i=0;i<50;i++) c.dispatchEvent(new PointerEvent('pointermove',{isPrimary:true,pointerType:'mouse',clientX:r.left+(100.5+i)*r.width/320,clientY:r.top+100.5*r.height/200,bubbles:true}));
  const during=paints; await new Promise(r=>setTimeout(r,200));
  const at=screen.ui.hoverPoint; delete screen.presentViewport;
  c.dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})); await new Promise(r=>setTimeout(r,200));
  return {during, after:paints, at, left:screen.ui.hoverPoint===null};})()`);
console.log('  fifty moves of the pointer:', JSON.stringify(moves));
check(moves.during === 0, 'a move of the pointer paints nothing itself');
check(moves.after >= 1 && moves.after < 50 && moves.at.x === 149 && moves.at.y === 100, 'the VBL\'s frame draws the cursor where the pointer last was');
check(moves.left, 'the pointer gone, no cursor is left for the frames that follow');
// SAVE (x 95..143, y 161..174), a new save from that row, for the resume from the
// entrance below.
await canvasClick(120, 168, 0); await wait(1200);

// The dungeon entrance, with the intro left on. The wait has to cover the whole title
// animation — about 116 vertical blanks — plus the entrance's own fade; once that fade
// finishes the screen is static until the player clicks, so the capture is stable.
//
// This is the only evidence that the corridor behind the doors actually renders. It is
// drawn by the real viewport renderer over a synthetic 5x5 level
// (`src/renderer/intro/PrisonLevel.ts`), and `tools/dump-intro.ts` can check the level and
// the compositing but not the pixels the bytecode programs produce.
await send('Page.navigate', { url: `${APP}?keepsaves` });
await wait(7000);
console.log('state: entrance');
const entrance = await shot('07-entrance');
// The scroll at the bottom of the button column (button id 202).
await canvasClick(270, 192, 0); await wait(1500);
console.log('state: credits');
const credits = await shot('08-credits');
// Back to the entrance, "resume" (id 201), the one save the chooser lists, its first
// row, and LOAD (x 24..74, y 161..174):
// the loaded game is played at once, with no "GAME LOADED, READY TO PLAY." before it, so
// this is the adventure's first view of the save made above.
await canvasClick(160, 100, 0); await wait(1000);
check(!(await wheelTaken()), 'the entrance leaves the wheel to the page');
await canvasClick(270, 84, 0);  await wait(1500);
check(await wheelTaken(), 'the entrance\'s chooser takes the wheel, for its list');
// The cursor stays up as the chooser redraws, from `STShowCursor` to `STHideCursor`
// (`doc/CSBwin-src/SaveGame.cpp:1687-1689`): after a notch of the wheel and two keys, the
// arrow is still where the click that opened it left it, and the pointer leaving the
// canvas takes it off. The pointer stays off for the comparisons below.
const leaveCanvas = () => evaluate(`document.getElementById('game-canvas').dispatchEvent(new PointerEvent('pointerleave',{isPrimary:true,pointerType:'mouse'})),1`);
await key('ArrowUp');   await wait(200);
await key('ArrowDown'); await wait(200);
const withArrow = await canvasPixels();
await leaveCanvas(); await wait(200);
check(withArrow !== (await canvasPixels()), 'the entrance\'s chooser keeps its cursor up as it redraws');
// And the keys the list takes in play. The one save is selected under its heading: the up
// arrow moves the selection to the heading, and the down arrow back to the save.
const chooserUp = await canvasPixels();
await key('ArrowUp');   await wait(200);
const onHeading = await canvasPixels();
await key('ArrowDown'); await wait(200);
check(onHeading !== chooserUp && onHeading !== entrance && (await canvasPixels()) === chooserUp,
  'the entrance\'s chooser takes the arrow keys, and stays up');
// EXPORT (x 170..220, y 161..174) on that save: the page's own download
// (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`), which no Node tool can run.
// What the file holds is `tools/dump-save-menu.ts`'s to show.
await canvasClick(195, 168, 0); await wait(1000);
console.log('  downloads:', downloads.join(', ') || 'none');
check(downloads.length === 1 && /^csbweb-\d{8}-\d{6}\.dat$/.test(downloads[0]),
  'EXPORT in the chooser starts one download, a .dat under the save\'s name');
// A file dropped on the page while the chooser is up: the page's own listener
// (`bindSaveDrop`, `src/ui/saveDrop.ts`), which no Node tool can run either. The file is
// the csb set's save, another dungeon's here, so it is refused in a one-option menu and
// nothing is stored; OK (the centred menu's one button, around (159,147)) brings the
// chooser back, its message gone. What is stored and what is asked is
// `tools/dump-save-menu.ts`'s to show.
const dropTaken = await evaluate(`(async()=>{
  const bytes = await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer();
  const data = new DataTransfer();
  data.items.add(new File([bytes], 'CSBGAME2.DAT'));
  const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
  document.getElementById('game-canvas').dispatchEvent(drop);
  return drop.defaultPrevented;
})()`);
await wait(1000);
const refusal = await canvasPixels();
check(dropTaken && refusal !== chooserUp && refusal !== entrance,
  'a save of another dungeon dropped on the chooser is taken by the page, and a menu comes up');
await canvasClick(159, 147, 0); await wait(600);
await leaveCanvas(); await wait(200);
check((await canvasPixels()) === chooserUp, 'its OK brings the chooser back, with nothing more listed');
await canvasClick(100, 27, 0);  await wait(300);
await canvasClick(48, 168, 0);  await wait(1500);
console.log('state: game loaded');       await shot('12-game-loaded');

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
  const party = game.ctx.party.state;
  party.position.x = 14; party.position.y = 29; party.position.z = 4;
  party.facing = 3;
  party.brightness = 1000;   // level 4 is dark, and no one holds a torch: full magic light
  const touched = game.systems.mouse.handleWallClick();
  renderView();
  return touched;
})()`).then(t => console.log('  touched:', t));
await wait(3000);
console.log('state: crack switch');      await shot('09-crack-switch');

// Door ornaments (`TAG004b26`, `doc/CSBwin-src/CSBCode.cpp:4058`), drawn onto the door's
// bitmap before the blit. The entrance door, level 0 (1,2), seen from the start square:
// ornament 7 at full size, the black double door, over the grid that is its door type.
// Then level 4 door 60 at (4,25), two squares east of (2,25): a wooden door whose lock
// plate, ornament 5 in position set 2, is shrunk to its F2 size through `d.Byte4188`.
const FACE = (x, y, z, facing) => `(()=>{
  const { game, renderView } = window.__probe;
  const party = game.ctx.party.state;
  party.position.x = ${x}; party.position.y = ${y}; party.position.z = ${z};
  party.facing = ${facing};
  party.brightness = 1000;
  renderView();
})()`;
await evaluate(FACE(1, 3, 0, 0)); await wait(500);
console.log('state: entrance door');     await shot('10-entrance-door');
await evaluate(FACE(2, 25, 4, 1)); await wait(500);
console.log('state: door lock, F2');     await shot('11-door-lock-f2');
// A wall decoration on an F2 edge wall, positions 7 and 9 of `DrawWallDecoration`
// (`doc/CSBwin-src/CSBCode.cpp:3599-3623`). One mirror frame in the Hall of Champions,
// the south face of level 0 (16,7), seen from two squares south and one to either side,
// facing north: from (17,9) it is front-left, from (15,9) front-right. It is scaled to the
// F2 centre width and cut by the screen border, so on the left it must show the bitmap's
// right end, and on the right its left end. `tools/dump-hall-of-champions.ts` pins the
// rectangles; these two frames pin the pixels.
await evaluate(FACE(17, 9, 0, 0)); await wait(500);
console.log('state: F2 front-left wall'); await shot('13-edge-decoration-left');
await evaluate(FACE(15, 9, 0, 0)); await wait(500);
console.log('state: F2 front-right wall'); await shot('14-edge-decoration-right');
// A wall text seen from afar is its plaque, cut short for a text of one to three lines
// (`doc/CSBwin-src/CSBCode.cpp:3625-3660`). "HALL OF / CHAMPIONS", on the north
// face of level 0 (8,5), seen from (8,3) facing south: two lines at F2 centre, so the
// plaque stops at `d.Byte4212[10]`, row 53 of its 37-73. `tools/dump-wall-text.ts` pins
// the cut at every position; this frame pins it in a real view.
await evaluate(FACE(8, 3, 0, 2)); await wait(500);
console.log('state: wall text at F2');   await shot('19-wall-text-f2');
// A left click on a portrait box's bars, where CSBWin has no left button, is the box's
// right click (`searchMouseButtons`, `src/renderer/ui/Mouse.ts`): champion 1's inventory
// opens, and a second click closes it. Nothing is drawn, so this is no frame.
const selected = () => evaluate(`window.__probe.screen.ui.partyState.selectedCharacterIndex`);
await canvasClick(124, 10, 0); await wait(600);
check(await selected() === 1, 'a left click on a champion\'s bars opens the inventory');
await canvasClick(124, 10, 0); await wait(600);
check(await selected() === -1, 'and a second one closes it');
// A finger, through CDP's touch events, which Chrome delivers to the page as a touch
// screen's: pointer events as it presses and lifts, and its mouse events only after the
// lift (`bindCanvasEvents`, `src/ui/events.ts`). So the eye (12-27 x 46-61) is held while
// the finger is down, and a tap is one click.
const touch = async (type, x, y) => {
  const p = await evaluate(`(()=>{const r=document.getElementById('game-canvas').getBoundingClientRect();
    return {x:r.left+(${x}+0.5)*r.width/320, y:r.top+(${y}+0.5)*r.height/200};})()`);
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
};
const pressingEye = () => evaluate(`window.__probe.screen.ui.pressingEye`);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await wait(600);
check(await selected() === 1, 'a tap on a champion\'s bars opens the inventory, once');
await touch('touchStart', 19, 53); await wait(600);
check(await pressingEye(), 'a finger held on the eye keeps it pressed');
await touch('touchEnd', 19, 53); await wait(600);
check(!(await pressingEye()), 'and lifting it lets go');
await touch('touchStart', 124, 10); await touch('touchEnd', 124, 10); await wait(600);
check(await selected() === -1, 'a second tap closes the inventory');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });

// The Hint Oracle's button (`src/renderer/ui/HintOracleButton.ts`), CSB's set only: the
// inventory's close box is the Oracle's `?`, and a real click on it opens the Oracle on the
// party's square. CSB's `csbgame2.dat` is read into a `?intro=0` game, and its party set on
// level 4 (1,7), thirteen squares from the nearest creature, so nothing moves while the
// frames are taken; there the Oracle lists CREATURES and CIRCLE OF POISON. Its title list
// cycles a palette slot every 21 VBLs, so it is no frame: `tools/dump-hint-oracle-screen.ts`
// checks its pixels. A hint's page, the first title's, does not cycle, and is one.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=csb` });
await wait(3500);
await evaluate(`(async()=>{
  const { game, renderView, applySaveBytes } = window.__probe;
  applySaveBytes(game, new Uint8Array(await (await fetch('/gamefiles/csb/csbgame2.dat')).arrayBuffer()));
  const party = game.ctx.party.state;
  party.position.x = 1; party.position.y = 7;
  renderView();
  return party.champions.map((c) => c.name).join(', ');
})()`).then(names => console.log('  csb party:', names));
await wait(600);
await canvasClick(15, 15, 2);  await wait(700);
await leaveCanvas(); await wait(200);
console.log('state: CSB inventory');
const csbInventory = await shot('15-csb-inventory');
await realClick(214, 40); await wait(2500);
check(await evaluate(`window.__probe.screen.isHintOracleUp()`), 'a real click on the close box opens the Hint Oracle');
await realClick(160, 36); await wait(3000);
await leaveCanvas(); await wait(200);
console.log('state: hint page');         await shot('16-hint-oracle-page');
// DONE (x 221-289, y 179-192) on the page goes back to the title list, and on the list
// closes the Oracle: the inventory comes back as it was.
await realClick(255, 185); await wait(3000);
await realClick(255, 185); await wait(1500);
await leaveCanvas(); await wait(200);
check(!(await evaluate(`window.__probe.screen.isHintOracleUp()`)) && (await canvasPixels()) === csbInventory,
  'DONE on the page and then on the list closes the Oracle, back to frame 15');

// Conflux 3.5 at its start: level 0, (13,24) facing north, no champion. Nearly every view
// of it runs a skin's program from its `CSBgraphics.dat`, and its DSAs run from the first
// tick (`tools/watch-conflux-start.ts`). The square in front is a wall, which its skin
// paints with a picture, and nothing in view moves.
await send('Page.navigate', { url: `${APP}?intro=0&dungeon=conflux` });
await wait(3500);
await leaveCanvas(); await wait(200);
console.log('state: Conflux start');     const confluxStart = await shot('18-conflux-start');
// A viewport overlay (`src/renderer/csbwin/OverlayScreen.ts`), through the page's dev
// control as a DSA's `&OVERLAY` and `&JITTER` would put it up: overlay 1 of Conflux's
// `CSBgraphics.dat` over this view, half of each pixel the overlay's, its colour 0
// transparent, and the view shifted four pixels right under it. Hidden and shifted back
// after, the view is frame 18.
const setInputs = (values) => evaluate(`(()=>{for (const [id, v] of Object.entries(${JSON.stringify(values)}))
  document.getElementById(id).value = String(v); return 1;})()`);
await setInputs({ 'overlay-number': 1, 'overlay-p1': 1, 'overlay-p2': 50, 'overlay-p3': 0, 'overlay-p4': 0, 'overlay-jitter-x': 4, 'overlay-jitter-y': 0 });
await click('#btn-overlay-show'); await click('#btn-overlay-jitter'); await wait(500);
console.log('state: overlay');           await shot('17-overlay');
await setInputs({ 'overlay-jitter-x': 0 });
await click('#btn-overlay-hide'); await click('#btn-overlay-jitter'); await wait(500);
check((await canvasPixels()) === confluxStart, 'the overlay hidden and the view shifted back, it is frame 18 again');

// The CRT effect's input surface. The effect's canvas is shown over the game canvas, and
// the pre-game and end-of-game screens listen on the game canvas alone (`createIntroHost`,
// `src/renderer/intro/BootSequence.ts`), so it must let a click through. Boot with the
// effect in the saved settings: the intro is drawn through it, and a real click on the
// entrance's scroll brings up the credits, as the click for frame 08 did.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('csbweb_ui_settings_v1', JSON.stringify({ crt: true })); } catch (e) {}
` });
await send('Page.navigate', { url: `${APP}?keepsaves` });
await wait(7000);
console.log('state: entrance, CRT effect saved on');
check(await crtEffect() === 'on', 'the effect is on at the entrance');
check(await canvasPixels() === entrance, 'the entrance is frame 07');
await realClick(270, 192); await wait(1500);
check(await canvasPixels() === credits, 'a real click on the scroll brings up frame 08, the credits');

console.log('--- console errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close();
if (failures.length) {
  console.log(`--- ${failures.length} check(s) failed ---\n${failures.join('\n')}`);
  process.exit(1);
}
