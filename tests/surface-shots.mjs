// Surface shots — capture EVERY page and sheet with realistic seeded data, for design review.
// Built for the 2026-07-23 Apple-pass council, where judging the app needed all 21 surfaces side
// by side rather than the two screens you happen to be looking at. NOT a pass/fail gate: it writes
// images for a human (or a model) to critique, so nothing here asserts.
//
//   node tests/surface-shots.mjs
//   DUCK_GYM_URL=http://127.0.0.1:4173/ SHOT_DIR=./out node tests/surface-shots.mjs
//
// Seeds 9 sessions over 4 weeks + bodyweight + goals so charts, recaps and trends actually render —
// empty states hide most of the design. Dark at 390px, plus a light pass on Today/Progress.
// GOTCHA: never use captureBeyondViewport on Library — 240 rows hangs the encoder. Scroll and shoot
// the viewport instead, which is what the `-s<Y>` shots do.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4188/';
const OUT = process.env.SHOT_DIR || fileURLToPath(new URL('../artifacts/design-qa/surfaces/', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'gym-council-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, t = 12000) { const end = Date.now() + t; let l; while (Date.now() < end) { try { return await fn(); } catch (e) { l = e; await sleep(100); } } throw l; }
let socket, nextId = 0; const pending = new Map();
function command(m, p = {}) { const id = ++nextId; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); socket.send(JSON.stringify({ id, method: m, params: p })); }); }
async function evaluate(e) { const r = await command('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; }
async function waitFor(e, t = 10000) { return retry(async () => { const v = await evaluate(e); if (!v) throw new Error('wait ' + e); return v; }, t); }
async function settle() { for (let i = 0; i < 30; i++) { const n = await evaluate(`(()=>{const f=document.getAnimations().filter(a=>{try{return a.effect&&a.effect.getTiming().iterations!==Infinity}catch(e){return false}});for(const a of f){try{if(a.playState==='running')a.finish()}catch(e){}}return f.filter(a=>a.playState==='running').length})()`); if (n === 0) { await sleep(120); return; } await sleep(80); }
}
async function shot(name, full = false) {
  await settle();
  const s = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  return name;
}
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
  await shot('00-first-run');
  await evaluate(`submitFirstRun('Mark'); true`);
  await waitFor(`!document.getElementById('sheet').open`);

  // Seed a believable training history: 9 sessions over 4 weeks, PRs, bodyweight, a goal.
  await evaluate(`(() => {
    const DAY=86400000, now=Date.now();
    const mk=(daysAgo,name,exs)=>({id:'s'+daysAgo,name,started:now-daysAgo*DAY,finished:now-daysAgo*DAY+3900000,exercises:exs});
    const ex=(id,sets)=>({id,sets:sets.map(([w,r],i)=>({weight:String(w),reps:String(r),done:true,rir:i===sets.length-1?2:null}))});
    const hist=[
      mk(1,'Day A · Squat pattern',[ex('lg1',[[80,8],[85,8],[90,6]]),ex('ch1',[[60,10],[62.5,9],[65,8]]),ex('ba4',[[50,12],[55,10]])]),
      mk(3,'Day B · Hinge + pull',[ex('lg5',[[100,6],[105,5],[110,5]]),ex('ba3',[[0,10],[0,9],[0,8]]),ex('sh1',[[22.5,10],[22.5,9]])]),
      mk(5,'Day A · Squat pattern',[ex('lg1',[[80,8],[82.5,8],[85,7]]),ex('ch1',[[60,10],[60,9]])]),
      mk(8,'Day B · Hinge + pull',[ex('lg5',[[95,6],[100,6]]),ex('ba3',[[0,9],[0,8]])]),
      mk(10,'Day A · Squat pattern',[ex('lg1',[[77.5,8],[80,8]]),ex('ch1',[[57.5,10],[60,9]])]),
      mk(13,'Day C · Accessories',[ex('sh1',[[20,12],[20,11]]),ex('ba4',[[45,12],[50,11]])]),
      mk(15,'Day A · Squat pattern',[ex('lg1',[[75,8],[77.5,8]]),ex('ch1',[[55,10],[57.5,10]])]),
      mk(18,'Day B · Hinge + pull',[ex('lg5',[[90,6],[95,6]]),ex('ba3',[[0,8],[0,7]])]),
      mk(22,'Day A · Squat pattern',[ex('lg1',[[72.5,8],[75,8]]),ex('ch1',[[55,9]])]),
    ];
    state.history=hist;
    state.bodyweight=[22,15,8,1].map(d=>({t:now-d*DAY,kg:84.5-(22-d)*0.06}));
    state.favourites=['lg1','ch1','ba3'];
    state.goals=[
      {id:'g1',type:'lift',exerciseId:'lg1',target:120,startValue:72.5,createdAt:now-22*DAY,unit:'kg'},
      {id:'g2',type:'sessions',target:4,startValue:0,createdAt:now-22*DAY},
    ];
    if(typeof Core.normalizeGoals==='function')state.goals=Core.normalizeGoals(state.goals);
    saveState(); renderAllViews(); return true;
  })()`);
  await sleep(400);

  for (const view of ['today', 'train', 'library', 'progress']) {
    await evaluate(`navigate('${view}'); window.scrollTo(0,0); true`);
    await sleep(350);
    made.push(await shot(`dark-${view}`));
    // Full-page capture only where the page is bounded; library is 239 rows and hangs the encoder.
    if (view === 'progress') {
      for (const y of [700, 1400, 2100, 2800]) {
        await evaluate(`window.scrollTo(0,${y}); true`); await sleep(300);
        made.push(await shot(`dark-${view}-s${y}`));
      }
      await evaluate(`window.scrollTo(0,0); true`);
    } else if (view !== 'today') {
      await evaluate(`window.scrollTo(0,650); true`); await sleep(300);
      made.push(await shot(`dark-${view}-s650`));
      await evaluate(`window.scrollTo(0,0); true`);
    }
  }

  // Sheets and overlays
  await evaluate(`navigate('library'); openFiltersSheet('library'); true`);
  await waitFor(`document.getElementById('filterSheet').open`);
  made.push(await shot('dark-sheet-filters'));
  await evaluate(`closeFiltersSheet(); true`); await sleep(300);

  await evaluate(`openSettings(); true`);
  await waitFor(`document.getElementById('sheet').open`);
  made.push(await shot('dark-sheet-settings'));
  await evaluate(`closeSheet(); true`); await sleep(300);

  await evaluate(`openGoalSheet(); true`);
  await waitFor(`document.getElementById('sheet').open`);
  made.push(await shot('dark-sheet-goal'));
  await evaluate(`closeSheet(); true`); await sleep(300);

  // Active workout + pad + rest pill
  await evaluate(`navigate('train'); startQuickWorkout(); true`);
  await waitFor(`document.body.classList.contains('workout-active')`);
  await evaluate(`addExerciseToWorkout('lg1'); addExerciseToWorkout('ch1'); true`);
  await waitFor(`document.querySelectorAll('.set-row').length >= 2`);
  await evaluate(`(()=>{const i=document.querySelectorAll('.set-row .set-input');
    i[0].value='90';i[0].dispatchEvent(new Event('change',{bubbles:true}));
    i[1].value='8';i[1].dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('.set-done').click();return true;})()`);
  await sleep(500);
  made.push(await shot('dark-workout'));
  await evaluate(`window.scrollTo(0,500); true`); await sleep(300);
  made.push(await shot('dark-workout-s500'));
  await evaluate(`window.scrollTo(0,0); true`);

  await evaluate(`(()=>{const c=document.querySelector('.set-input');c&&c.click();return true;})()`);
  await sleep(400);
  if (await evaluate(`document.getElementById('padSheet').open`)) { made.push(await shot('dark-sheet-pad')); await evaluate(`closePad(); true`); await sleep(250); }

  await evaluate(`openExercisePicker('workout'); true`);
  await waitFor(`document.getElementById('sheet').open`);
  made.push(await shot('dark-sheet-picker'));
  await evaluate(`closeSheet(); true`); await sleep(300);

  // Finish → receipt
  await evaluate(`requestFinishWorkout(); true`);
  await waitFor(`document.querySelector('#confirmDialog[open]')`);
  made.push(await shot('dark-confirm'));
  await evaluate(`document.querySelector('#confirmDialog .primary-button').click(); true`);
  await waitFor(`!document.getElementById('receiptOverlay').hidden`, 12000);
  await sleep(600);
  made.push(await shot('dark-receipt'));
  await evaluate(`(()=>{const b=document.querySelector('#receiptCard .primary-button');b&&b.click();return true;})()`);
  await sleep(500);

  // Light pass on the four main pages
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  for (const view of ['today', 'progress']) {
    await evaluate(`navigate('${view}'); window.scrollTo(0,0); true`);
    await sleep(350);
    made.push(await shot(`light-${view}`));
  }
  console.log('shots-ok', made.length, made.join(','));
} finally {
  try { socket && socket.close(); } catch {}
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
