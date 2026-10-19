/**
 * Write the welcome page's HOW TO PLAY sheets to print (`src/ui/howToPlay.ts`): for each
 * key preset and each layout of the labels, `src/assets/how-to-play/<preset>-<layout>.pdf`,
 * one landscape A4 page, and `.png`, the same page at 192 pixels to the inch; and
 * `sheets.json` there, the text of each sheet, which `tools/probe-frames.mjs` holds the
 * page's sheet to.
 *
 * Each sheet is the page itself, the dialog opened at `#how-to-play` under its print
 * stylesheet (`welcomePage.css`), with the settings a player of that preset and that layout
 * has, and the browser's keyboard layout hidden, as `probe-frames.mjs` hides it, so the
 * labels are the layout's and not this machine's. The PDF is Chrome's `Page.printToPDF`;
 * the PNG is the print layout captured at the PDF page's size, inside the same margins.
 * Each sheet has a tab of its own: after a print, headless Chrome's tab answers no capture
 * and no navigation.
 *
 * It starts its own dev server and headless Chrome, on ports of its own, and stops them.
 *
 *   node tools/gen-help-sheet.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'src/assets/how-to-play');
const DEV_PORT = Number(process.env.DEV_PORT ?? 9105);
const CDP_PORT = Number(process.env.CDP_PORT ?? 9225);
const APP = `http://localhost:${DEV_PORT}/`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const PRESETS = ['csbwin', 'keypad', 'arrows'];
const LAYOUTS = ['qwerty', 'azerty'];
/** A4 landscape at 96 pixels to the inch, and the print stylesheet's 8 mm margins. */
const PAGE = { width: 1123, height: 794 };
const MARGIN = Math.round(8 / 25.4 * 96);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const up = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };

/** A new tab, its protocol's `send` and `evaluate`, and `close`. */
async function openTab() {
  const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => reject(new Error(`${method}: no answer in 30 s`)), 30000);
    pending.set(n, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const close = async () => {
    ws.close();
    await fetch(`${CDP}/json/close/${target.id}`).catch(() => {});
  };
  return { send, evaluate, close };
}

/** The sheet of `preset` labelled in `layout`, written as `<name>.png` and `<name>.pdf`; its text. */
async function writeSheet(preset, layout) {
  const name = `${preset}-${layout}`;
  const { send, evaluate, close } = await openTab();
  try {
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      try { Object.defineProperty(Navigator.prototype, 'keyboard', { get: () => undefined, configurable: true }); } catch (e) {}
      if (location.search.includes('sheet=')) localStorage.setItem('csbweb_settings_v2',
        JSON.stringify({ keyPreset: '${preset}', keyLabels: '${layout}' }));` });
    await send('Emulation.setDeviceMetricsOverride', { width: PAGE.width, height: PAGE.height, deviceScaleFactor: 2, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Page.navigate', { url: `${APP}?sheet=${name}#how-to-play` });
    await wait(2500);
    const text = await evaluate(`(async () => { await document.fonts.ready;
      const dialog = document.querySelector('dialog.how-to-play');
      return dialog && dialog.querySelector('.how-sheet').textContent; })()`);
    if (!text) throw new Error(`${name}: no HOW TO PLAY dialog`);
    const stored = await evaluate(`JSON.parse(localStorage.getItem('csbweb_settings_v2') ?? '{}')`);
    if (stored.keyPreset !== preset || stored.keyLabels !== layout || await evaluate(`'keyboard' in navigator && !!navigator.keyboard`)) {
      throw new Error(`${name}: the page has ${JSON.stringify(stored)}, or the machine's layout`);
    }

    // The page's margins, which print gives, given the capture by the dialog's padding:
    // a modal dialog is in the top layer, where the body's would not move it.
    await evaluate(`document.querySelector('dialog.how-to-play').style.padding = '${MARGIN}px'`);
    const overflow = await evaluate(`Math.ceil(document.querySelector('dialog.how-to-play').getBoundingClientRect().height) - ${PAGE.height}`);
    if (overflow > 0) throw new Error(`${name}: the sheet is ${overflow} pixels taller than the page`);
    const png = Buffer.from((await send('Page.captureScreenshot',
      { format: 'png', clip: { x: 0, y: 0, width: PAGE.width, height: PAGE.height, scale: 1 } })).data, 'base64');
    writeFileSync(join(OUT, `${name}.png`), png);
    await evaluate(`document.querySelector('dialog.how-to-play').style.padding = ''`);

    const pdf = Buffer.from((await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true })).data, 'base64');
    writeFileSync(join(OUT, `${name}.pdf`), pdf);
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    if (pages !== 1) throw new Error(`${name}: the sheet prints on ${pages} pages, not one`);
    console.log(`${name}: ${pdf.length} bytes of PDF, ${png.length} of PNG`);
    return text;
  } finally {
    await close();
  }
}

const vite = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
const profile = mkdtempSync(join(tmpdir(), 'csbweb-help-sheet-'));
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', detached: true });
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));
try {
  for (let i = 0; i < 60 && !(await up(APP)); i++) await wait(500);
  for (let i = 0; i < 60 && !(await up(`${CDP}/json/version`)); i++) await wait(250);
  mkdirSync(OUT, { recursive: true });
  const sheets = {};
  for (const preset of PRESETS) {
    for (const layout of LAYOUTS) sheets[`${preset}-${layout}`] = await writeSheet(preset, layout);
  }
  writeFileSync(join(OUT, 'sheets.json'), `${JSON.stringify(sheets, null, 2)}\n`);
  console.log(`${Object.keys(sheets).length} sheets in ${OUT}`);
} finally {
  // Both stopped, then Chrome's profile removed, once Chrome has let go of it.
  for (const child of [vite, chrome]) try { process.kill(-child.pid); } catch { /* gone */ }
  await Promise.race([chromeExited, wait(5000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
