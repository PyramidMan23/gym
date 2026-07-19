// Headless layout audit: opens every screen and overlay at multiple widths and asserts
// nothing is cut off, clipped, or overflowing — the "everything fits / billion-dollar finish" gate.
// Zero-dependency CDP driver (same pattern as browser-flow.mjs). Keep the local server on :4173.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'duck-gym-layout-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`
], { stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(fn, timeout = 10000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; await sleep(100); } }
  throw last || new Error('Timed out');
}

let socket, nextId = 0;
const pending = new Map();
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) { const d = result.result.exceptionDetails; throw new Error(d.exception?.description || d.exception?.value || d.text); }
  return result.result?.result?.value;
}
async function waitFor(expression, timeout = 8000) {
  return retry(async () => { const v = await evaluate(expression); if (!v) throw new Error(`Waiting for: ${expression}`); return v; }, timeout);
}
async function setWidth(width, height = 820) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await sleep(90);
}

// Injected page helpers — returns any element (in normal flow, not inside a horizontal scroller)
// whose right edge is cut off by the viewport, plus the document horizontal-overflow delta.
const PAGE_HELPERS = `
window.__leaks=(root)=>{
  const vw=window.innerWidth, bad=[], scope=root?document.querySelector(root):document.body;
  if(!scope)return bad;
  for(const el of scope.querySelectorAll('*')){
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')continue;
    const r=el.getBoundingClientRect();
    if(r.width===0&&r.height===0)continue;
    if(r.right<=vw+1&&r.left>=-1)continue;
    // Allowed: the element sits inside a genuine horizontal scroller (chips/quick-picks/trend rows).
    let p=el.parentElement, excused=false;
    while(p){const ox=getComputedStyle(p).overflowX; if(ox==='auto'||ox==='scroll'){excused=true;break;} p=p.parentElement;}
    if(!excused)bad.push((el.id||el.className||el.tagName)+' L'+Math.round(r.left)+' R'+Math.round(r.right)+'/'+vw);
  }
  return bad.slice(0,12);
};
window.__hoverflow=()=>document.documentElement.scrollWidth-document.documentElement.clientWidth;
window.__radiusOk=(sel)=>{const el=document.querySelector(sel);if(!el)return 'missing';const r=getComputedStyle(el).borderTopLeftRadius;return ['0px','4px','10px'].includes(r)?'ok':r;};
`;

function assertClean(where, leaks, delta) {
  assert.ok(delta <= 1, `${where}: document overflows horizontally by ${delta}px`);
  assert.deepEqual(leaks, [], `${where}: elements cut off by the viewport: ${JSON.stringify(leaks)}`);
}
async function auditActive(where) {
  const delta = await evaluate(`window.__hoverflow()`);
  const leaks = await evaluate(`window.__leaks(null)`);
  assertClean(where, leaks, delta);
}
// Assert an OPEN sheet/dialog is a clipped rounded shell with an inner scroller, radius ∈ {0,4,10},
// content bottom above the viewport, and a safe-area-aware bottom pad.
async function auditSheet(where, shellSel, scrollSel) {
  const info = await evaluate(`(()=>{
    const shell=document.querySelector(${JSON.stringify(shellSel)}), sc=document.querySelector(${JSON.stringify(scrollSel)});
    if(!shell||!sc)return {err:'missing '+${JSON.stringify(shellSel)}+' / '+${JSON.stringify(scrollSel)}};
    const shellCS=getComputedStyle(shell), scCS=getComputedStyle(sc);
    const last=sc.lastElementChild?sc.querySelector('.primary-button,.sheet-actions,button:last-of-type'):null;
    const lastBottom=last?last.getBoundingClientRect().bottom:sc.getBoundingClientRect().bottom;
    return {
      shellOverflow:shellCS.overflowY, scOverflow:scCS.overflowY,
      radius:['0px','4px','10px'].includes(shellCS.borderTopLeftRadius)?'ok':shellCS.borderTopLeftRadius,
      padBottom:parseFloat(scCS.paddingBottom), lastBottom, vh:window.innerHeight
    };
  })()`);
  assert.ok(!info.err, `${where}: ${info.err}`);
  assert.equal(info.shellOverflow, 'hidden', `${where}: shell must clip (overflow:hidden) so backdrop-filter respects the radius`);
  assert.equal(info.scOverflow, 'auto', `${where}: inner wrapper must be the scroller (overflow:auto)`);
  assert.equal(info.radius, 'ok', `${where}: shell radius must be 0/4/10px, got ${info.radius}`);
  assert.ok(info.padBottom >= 22, `${where}: scroller needs a safe-area bottom pad >=22px, got ${info.padBottom}`);
  assert.ok(info.lastBottom <= info.vh + 1, `${where}: last control (${info.lastBottom}) sits below the viewport (${info.vh}) — under the gesture bar`);
  await auditActive(where);
}

try {
  const port = await retry(() => {
    const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    if (!v) throw new Error('No DevTools port yet'); return v;
  });
  const tab = await retry(async () => {
    const data = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = data.find(t => t.type === 'page' && t.url.startsWith(BASE));
    if (!page) throw new Error('page not ready'); return page;
  });
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (!m.id || !pending.has(m.id)) return;
    const t = pending.get(m.id); pending.delete(m.id);
    m.error ? t.reject(new Error(m.error.message)) : t.resolve(m);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await waitFor(`document.readyState==='complete' && typeof startQuickWorkout==='function'`);
  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState==='complete' && typeof startQuickWorkout==='function'`);
  await evaluate(PAGE_HELPERS);

  const WIDTHS = [320, 360, 390, 430];
  // 1) Every primary screen at every width — no horizontal overflow, nothing cut off.
  for (const view of ['today', 'train', 'library', 'progress']) {
    for (const w of WIDTHS) {
      await setWidth(w);
      await evaluate(`navigate('${view}'); true`);
      await sleep(60);
      await auditActive(`${view}@${w}`);
    }
  }

  // 2) Filters sheet (from Library) at 360 and 390.
  for (const w of [360, 390]) {
    await setWidth(w);
    await evaluate(`navigate('library'); openFiltersSheet('library'); true`);
    await waitFor(`document.getElementById('filterSheet').open`);
    await evaluate(PAGE_HELPERS);
    await auditSheet(`filters-sheet@${w}`, '#filterSheet', '#filterSheet .sheet-scroll');
    await evaluate(`closeFiltersSheet(); true`);
  }

  // 3) Settings sheet at 360 and 390.
  for (const w of [360, 390]) {
    await setWidth(w);
    await evaluate(`navigate('today'); openSettings(); true`);
    await waitFor(`document.getElementById('sheet').open`);
    await evaluate(PAGE_HELPERS);
    await auditSheet(`settings-sheet@${w}`, '#sheet', '#sheet .sheet-scroll');
    await evaluate(`closeSheet(); true`);
  }

  // 4) Exercise picker sheet — sticky search must stay put while the list scrolls.
  for (const w of [360, 390]) {
    await setWidth(w);
    await evaluate(`navigate('today'); startQuickWorkout(); openExercisePicker('workout'); true`);
    await waitFor(`document.getElementById('sheet').open && !!document.getElementById('pk_list').children.length`);
    await evaluate(PAGE_HELPERS);
    await auditSheet(`picker-sheet@${w}`, '#sheet', '#sheet .sheet-scroll');
    const sticky = await evaluate(`(()=>{
      const sc=document.querySelector('#sheet .sheet-scroll'), s=document.querySelector('.picker-search');
      const pos=getComputedStyle(s).position; sc.scrollTop=400;
      const top=s.getBoundingClientRect().top, scTop=sc.getBoundingClientRect().top;
      return {pos, stuck: top-scTop < 60};
    })()`);
    assert.equal(sticky.pos, 'sticky', `picker-sheet@${w}: search header must be sticky`);
    assert.ok(sticky.stuck, `picker-sheet@${w}: search header scrolled away instead of sticking`);
    await evaluate(`closeSheet(); cancelWorkout(); confirmCancelWorkout && confirmCancelWorkout(); true`);
    await evaluate(`if(state.activeSession){state.activeSession=null;saveState();navigate('today');} true`);
  }

  // 5) Finish-workout confirm dialog + session receipt.
  for (const w of [360, 390]) {
    await setWidth(w);
    await evaluate(`(()=>{navigate('today'); startQuickWorkout(); addExerciseToWorkout('b0');
      const inp=document.querySelectorAll('.set-row .set-input'); inp[0].value='60'; inp[0].dispatchEvent(new Event('change',{bubbles:true}));
      inp[1].value='10'; inp[1].dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.set-done').click();})(); true`);
    await waitFor(`document.querySelector('.set-row.completed')`);
    await evaluate(`requestFinishWorkout(); true`);
    await waitFor(`document.getElementById('confirmDialog').open`);
    await evaluate(PAGE_HELPERS);
    const conf = await evaluate(`(()=>{const d=document.getElementById('confirmDialog');const cs=getComputedStyle(d);
      return {overflow:cs.overflowY, radius:['0px','4px','10px'].includes(cs.borderTopLeftRadius)?'ok':cs.borderTopLeftRadius};})()`);
    assert.equal(conf.overflow, 'hidden', `confirm@${w}: dialog must clip to its radius`);
    assert.equal(conf.radius, 'ok', `confirm@${w}: radius must be 0/4/10, got ${conf.radius}`);
    await auditActive(`confirm-dialog@${w}`);
    await evaluate(`finishWorkout(); true`);
    await waitFor(`!document.getElementById('receiptOverlay').hidden`);
    await evaluate(PAGE_HELPERS);
    await auditActive(`receipt@${w}`);
    const fits = await evaluate(`(()=>{const c=document.getElementById('receiptCard').getBoundingClientRect();return c.right<=window.innerWidth+1&&c.left>=-1;})()`);
    assert.ok(fits, `receipt@${w}: receipt card is cut off horizontally`);
    await evaluate(`closeReceipt(); true`);
  }

  console.log('layout-check-ok widths=320,360,390,430 screens=4 overlays=filters,settings,picker,confirm,receipt sticky=ok safe-area=ok radii∈{0,4,10}');
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
  await sleep(750);
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); break; }
    catch (e) { if (i === 4) console.warn('profile-cleanup-warning', e.code); else await sleep(300); }
  }
}
