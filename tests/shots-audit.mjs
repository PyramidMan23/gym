// Visual proof for the 2026-07-22 audit changes: captures the changed surfaces in BOTH colour
// schemes at 390px. Writes to artifacts/design-qa/audit-*.png. Pure CDP, no deps.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'duck-gym-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, t = 10000) { const end = Date.now() + t; let l; while (Date.now() < end) { try { return await fn(); } catch (e) { l = e; await sleep(100); } } throw l; }
let socket, nextId = 0; const pending = new Map();
function command(m, p = {}) { const id = ++nextId; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); socket.send(JSON.stringify({ id, method: m, params: p })); }); }
async function evaluate(e) { const r = await command('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; }
async function waitFor(e, t = 8000) { return retry(async () => { const v = await evaluate(e); if (!v) throw new Error('wait ' + e); return v; }, t); }
async function settle() { for (let i = 0; i < 30; i++) { const n = await evaluate(`(()=>{const f=document.getAnimations().filter(a=>{try{return a.effect&&a.effect.getTiming().iterations!==Infinity}catch(e){return false}});for(const a of f){try{if(a.playState==='running')a.finish()}catch(e){}}return f.filter(a=>a.playState==='running').length})()`); if (n === 0) { await sleep(80); return; } await sleep(80); } }
const folder = new URL('../artifacts/design-qa/', import.meta.url);
async function shot(name) { await settle(); const s = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); mkdirSync(folder, { recursive: true }); writeFileSync(new URL(`audit-${name}.png`, folder), Buffer.from(s.result.data, 'base64')); return name; }

const made = [];
try {
  const port = await retry(() => { const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]; if (!v) throw new Error('no port'); return v; });
  const tab = await retry(async () => { const d = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = d.find(t => t.type === 'page' && t.url.startsWith(BASE)); if (!p) throw new Error('no page'); return p; });
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  socket.onmessage = e => { const m = JSON.parse(e.data); if (!m.id || !pending.has(m.id)) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(new Error(m.error.message)) : t.resolve(m); };
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await waitFor(`document.readyState==='complete'&&typeof submitFirstRun==='function'`);
  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState==='complete'&&typeof submitFirstRun==='function'`);
  await waitFor(`document.getElementById('sheet').open`);
  await evaluate(`submitFirstRun('Mark'); true`);
  await waitFor(`!document.getElementById('sheet').open`);

  for (const scheme of ['dark', 'light']) {
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await sleep(150);
    // Workout: a timed hold (Sec column) above a rep exercise, RIR row showing.
    await evaluate(`(()=>{state.preferences.injuryMode=false;saveState();
      if(state.activeSession)state.activeSession=null;
      startQuickWorkout();addExerciseToWorkout('gr3');addExerciseToWorkout('cs15');
      updateSet(0,0,'reps','60');toggleSet(0,0);return true})()`);
    await sleep(200);
    made.push(await shot(`workout-timed-${scheme}`));
    // Exercise menu: Move up disabled on the first exercise.
    await evaluate(`openWorkoutExerciseMenu(0); true`);
    await waitFor(`document.getElementById('sheet').open`);
    made.push(await shot(`exercise-menu-${scheme}`));
    await evaluate(`closeSheet(); true`); await sleep(200);
    // Finish + progress view (history chips, PR feed in seconds).
    await evaluate(`(()=>{setRir(0,3);finishWorkout();return true})()`);
    await sleep(500);
    await evaluate(`closeReceipt(); true`);
    await sleep(400);
    made.push(await shot(`progress-${scheme}`));
    // Settings: injury toggle + reworded sync copy.
    await evaluate(`openSettings(); true`);
    await waitFor(`document.getElementById('sheet').open`);
    await evaluate(`document.querySelector('.sheet-scroll').scrollTop=520; true`);
    await sleep(200);
    made.push(await shot(`settings-${scheme}`));
    await evaluate(`closeSheet(); true`); await sleep(200);
  }
  console.log('shots-ok ' + made.join(' '));
} finally {
  try { socket && socket.close(); } catch {}
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
