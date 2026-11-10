// Capture the app's screens with headless Chrome over the DevTools protocol (no extra packages).
// Needs the API on :8787 and the app on :5174. usage: node docs/capture_screens.mjs docs/screenshots
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] || 'docs/screenshots';
const APP = 'http://localhost:5174/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  id += 1;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

async function viewport(width, height, mobile = false, dark = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
}
async function open() {
  await send('Page.navigate', { url: APP });
  await waitFor("document.querySelector('h1') !== null");
  await sleep(600);
}
async function waitFor(expr, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`(() => { try { return !!(${expr}); } catch { return false; } })()`)) return;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${expr}`);
}
const hasText = (t) => `[...document.querySelectorAll('button, summary, a, h1, h2, p')].some(e => e.textContent.trim().startsWith(${JSON.stringify(t)}))`;
async function click(t) {
  const ok = await evaluate(`(() => { const e = [...document.querySelectorAll('button, summary, a')].find(e => e.textContent.trim().startsWith(${JSON.stringify(t)})); if (!e) return false; e.click(); return true; })()`);
  if (!ok) throw new Error(`no control "${t}"`);
  await sleep(250);
}
async function shot(name) {
  const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
  const m = await evaluate('[window.innerWidth, window.innerHeight]');
  const height = Math.max(m[1], h);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m[0], height, scale: 1 } });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log('wrote', name);
}

await send('Page.enable');
await send('Runtime.enable');
try {
  await viewport(1280, 820);
  await open();
  await shot('01_start');
  await click('Find me a place');
  await waitFor(hasText('Yes') + " && " + hasText('Skip'));
  await shot('02_question');
  await click('No');
  await waitFor(hasText('Choose this place'));
  await shot('03_pick_after_answer');
  await click('What did your answer change?');
  await click('See all options');
  await sleep(300);
  await shot('04_options_and_what_changed');
  await click('Choose this place');
  await sleep(300);
  await shot('05_chosen');
  await click('Settings');
  await sleep(400);
  await shot('06_settings');
  await click('About PROXY');
  await sleep(400);
  await shot('07_about');

  await viewport(1280, 820, false, true);
  await open();
  await click('Find me a place');
  await waitFor(hasText('Yes') + " && " + hasText('Skip'));
  await click('Yes');
  await waitFor(hasText('Choose this place'));
  await shot('08_pick_dark');

  await viewport(390, 844, true);
  await open();
  await click('Find me a place');
  await waitFor(hasText('Yes') + " && " + hasText('Skip'));
  await click('Skip');
  await waitFor(hasText('Choose this place'));
  await shot('09_pick_phone');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  ws.close();
  chrome.kill();
}
