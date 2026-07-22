// Machine contrast guard (standing rule: both colour modes must pass, always).
// Sweeps every rendered text element in BOTH prefers-color-scheme modes, resolves the EFFECTIVE
// background by walking ancestors and alpha-compositing (including gradient cards — worst/least
// opaque stop is used), and computes real WCAG ratios. Fails on anything under the size-aware bar.
//
// Why a sweep rather than a list: the bug class is a surface whose bg and ink don't flip together,
// and those hide in states nobody looks at in the mode they weren't building in. Triggered states
// (toast, disabled buttons, RIR row, why-sheet, receipt) are rendered explicitly before each sweep.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'duck-gym-contrast-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, timeout = 10000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; await sleep(100); } }
  throw last || new Error('Timed out');
}
let socket, nextId = 0; const pending = new Map();
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
async function waitFor(expr, timeout = 8000) {
  return retry(async () => { const v = await evaluate(expr); if (!v) throw new Error('waiting: ' + expr); return v; }, timeout);
}
// Measuring mid-animation is meaningless: entrance animations use fill-mode `both` with stagger
// delays (un-started = opacity 0), and cards transition in from opacity .6. Both read as phantom
// failures. Drive every FINITE animation/transition to its end and wait for the UI to go quiet, so
// the sweep measures the settled pixels a human actually reads. The ambient background drift is
// infinite by design — it can never finish, so it is excluded from the quiet test.
const FINITE_RUNNING = `(()=>{
  const finite = document.getAnimations().filter(a => {
    try { return a.effect && a.effect.getTiming().iterations !== Infinity; } catch (e) { return false; }
  });
  for (const a of finite) { try { if (a.playState === 'running') a.finish(); } catch (e) {} }
  return finite.filter(a => a.playState === 'running').length;
})()`;
async function settle() {
  for (let i = 0; i < 40; i++) {
    const running = await evaluate(FINITE_RUNNING);
    if (running === 0) {
      await sleep(70);
      if ((await evaluate(FINITE_RUNNING)) === 0) { await sleep(40); return; }
    }
    await sleep(80);
  }
  throw new Error('UI never went quiet — cannot measure contrast reliably');
}

// The in-page auditor. Returns every visible text element with its computed ratio.
const SWEEP = `(() => {
  const parse = c => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2); return (hi+0.05)/(lo+0.05); };
  // Least-opaque rgba stop in a gradient = the worst case for contrast.
  const worstStop = img => {
    const stops = String(img).match(/rgba?\\([^)]+\\)/g); if (!stops) return null;
    return stops.map(parse).filter(Boolean).sort((x, y) => x.a - y.a)[0] || null;
  };
  const pageBg = parse(getComputedStyle(document.documentElement).backgroundColor) || { r:255,g:255,b:255,a:1 };
  // Composite every ancestor layer (colour or gradient) down onto the page colour.
  const effectiveBg = el => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const bc = parse(cs.backgroundColor);
      if (bc && bc.a > 0) layers.push(bc);
      const gi = cs.backgroundImage && cs.backgroundImage !== 'none' ? worstStop(cs.backgroundImage) : null;
      if (gi && gi.a > 0) layers.push(gi);
    }
    let base = { ...pageBg, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const out = [];
  // Only audit the surface actually being read. A modal dialog or the receipt overlay sits above a
  // scrim; the view behind it is dimmed by that scrim (which this compositing does not model) and
  // nobody is reading it anyway. Audit the top surface, not the things underneath it.
  const modal = [...document.querySelectorAll('dialog[open]')].pop()
    || document.querySelector('.receipt-overlay.show')
    || document.body;
  for (const el of modal.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    // Only elements that render their OWN text (ignore pure containers).
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const fgRaw = parse(cs.color); if (!fgRaw) continue;
    // Inherited opacity dims the ink against whatever shows through.
    let opa = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) opa *= parseFloat(getComputedStyle(n).opacity || '1');
    if (opa < 0.08) continue; // effectively invisible — not something a reader can misread
    const bg = effectiveBg(el);
    const fg = over({ ...fgRaw, a: fgRaw.a * opa }, bg);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const disabled = el.disabled === true || el.closest('[disabled]') != null || el.getAttribute('aria-disabled') === 'true';
    out.push({
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : ''),
      text: (el.textContent || '').trim().slice(0, 34),
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
      size, weight, large, disabled, bar: large ? 3 : 4.5
    });
  }
  return out;
})()`;

const failures = [];
let sweptModes = 0, sampled = 0;

try {
  const port = await retry(() => {
    const v = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
    if (!v) throw new Error('no port'); return v;
  });
  const tab = await retry(async () => {
    const data = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const p = data.find(t => t.type === 'page' && t.url.startsWith(BASE)); if (!p) throw new Error('no page'); return p;
  });
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  socket.onmessage = e => { const m = JSON.parse(e.data); if (!m.id || !pending.has(m.id)) return; const t = pending.get(m.id); pending.delete(m.id); m.error ? t.reject(new Error(m.error.message)) : t.resolve(m); };
  await command('Runtime.enable'); await command('Page.enable');
  await waitFor(`document.readyState==='complete' && typeof startQuickWorkout==='function'`);
  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState==='complete' && typeof submitFirstRun==='function'`);
  await waitFor(`document.getElementById('sheet').open`);
  await evaluate(`submitFirstRun('Contrast'); true`);
  await waitFor(`!document.getElementById('sheet').open`);

  for (const scheme of ['light', 'dark']) {
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await sleep(120);

    // --- State A: a live workout with a timed exercise, an RIR row and a completed set ---
    await evaluate(`(()=>{
      state.preferences.injuryMode=true; saveState();
      if(state.activeSession) state.activeSession=null;
      startQuickWorkout();
      addExerciseToWorkout('gr3'); addExerciseToWorkout('ch1');
      updateSet(0,0,'reps','60'); toggleSet(0,0);
      updateSet(1,0,'weight','80'); updateSet(1,0,'reps','8'); toggleSet(1,0);
      showToast('Contrast probe toast');
      return true;
    })()`);
    await settle();
    let rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'workout+toast+rir', ...r }); });

    // --- State B: the exercise menu sheet (disabled move buttons live here) ---
    await evaluate(`openWorkoutExerciseMenu(0); true`);
    await waitFor(`document.getElementById('sheet').open`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'exercise-menu', ...r }); });
    // Disabled controls are WCAG-exempt, but they must still READ as dead — check the alpha gap.
    const dim = await evaluate(`(()=>{const bs=[...document.querySelectorAll('#sheetContent .sheet-actions button')];
      const d=bs.find(b=>b.disabled), e=bs.find(b=>!b.disabled);
      return d&&e?{disabled:parseFloat(getComputedStyle(d).opacity),enabled:parseFloat(getComputedStyle(e).opacity)}:null;})()`);
    assert.ok(dim, `${scheme}: expected a disabled and an enabled button in the exercise menu`);
    assert.ok(dim.enabled - dim.disabled >= 0.3, `${scheme}: disabled button must be visibly dimmer (enabled ${dim.enabled} vs disabled ${dim.disabled})`);
    await evaluate(`closeSheet(); true`);
    await sleep(120);

    // --- State C: the "why this target" sheet (.why-foot — the token that was failing) ---
    await evaluate(`(()=>{ state.history.unshift({id:'sX',name:'Prior',started:Date.now()-86400000,finished:Date.now()-82800000,
      checkin:{pre:2,post:'same',flare:false},prs:[],
      exercises:[{exerciseId:'ch1',notes:'',rir:3,sets:[{weight:'80',reps:'8',done:true}]}]});
      saveState(); renderWorkout(); openTargetWhy(1); return true; })()`);
    await waitFor(`document.getElementById('sheet').open`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'why-target', ...r }); });
    const foot = rows.find(r => /why-foot/.test(r.sel));
    assert.ok(foot, `${scheme}: .why-foot must be rendered in the why sheet`);
    assert.ok(foot.ratio >= 4.5, `${scheme}: .why-foot ${foot.ratio}:1 is below 4.5:1`);
    await evaluate(`closeSheet(); true`);
    await sleep(120);

    // --- State D: finished-session receipt + progress view ---
    await evaluate(`finishWorkout(); true`);
    // The receipt card fades in from opacity .6 — wait for the real reading state, not the fade.
    await waitFor(`document.getElementById('receiptOverlay').classList.contains('show') && parseFloat(getComputedStyle(document.getElementById('receiptCard')).opacity) === 1`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'receipt', ...r }); });
    await evaluate(`closeReceipt(); true`); // the app's own close path — never tear its nodes out
    // Seed goals so the goal board, the achieved state and the Today strip are all measured.
    await evaluate(`(()=>{
      const now=Date.now();
      state.bodyweight=[{t:now-86400000,kg:90}];
      state.goals=[
        {id:'gA',type:'strength',exerciseId:'ch1',target:120,startValue:60,created:now,achievedAt:null},
        {id:'gB',type:'consistency',target:3,startValue:null,created:now,achievedAt:null},
        {id:'gC',type:'bodyweight',target:80,startValue:90,created:now,achievedAt:now}
      ];
      saveState();renderProgress();return true})()`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'progress', ...r }); });

    // --- State D2: the new-goal sheet (type picker + fields) ---
    await evaluate(`openGoalSheet(); true`);
    await waitFor(`document.getElementById('sheet').open && !!document.querySelector('.goal-types')`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'goal-sheet', ...r }); });
    await evaluate(`closeSheet(); true`);
    await sleep(150);
    // --- State D3: Today, where the nearest goal is surfaced ---
    await evaluate(`(()=>{navigate('today');renderToday();return true})()`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'today-goal-strip', ...r }); });

    // --- State E: settings sheet (injury toggle, sync copy) ---
    await evaluate(`openSettings(); true`);
    await waitFor(`document.getElementById('sheet').open`);
    await settle();
    rows = await evaluate(SWEEP);
    rows.forEach(r => { sampled++; if (!r.disabled && r.ratio < r.bar) failures.push({ scheme, state: 'settings', ...r }); });
    await evaluate(`closeSheet(); true`);
    sweptModes++;
  }

  if (failures.length) {
    const seen = new Set();
    const unique = failures.filter(f => { const k = f.scheme + f.sel + f.text; if (seen.has(k)) return false; seen.add(k); return true; });
    console.error('CONTRAST FAILURES:\n' + unique.map(f =>
      `  [${f.scheme}] ${f.state} ${f.sel} "${f.text}" — ${f.ratio}:1 (needs ${f.bar}:1, ${f.size}px/${f.weight})`).join('\n'));
    throw new Error(`${unique.length} contrast failure(s) across ${sweptModes} colour modes`);
  }
  console.log(`contrast-guard-ok modes=${sweptModes} elementsChecked=${sampled} failures=0`);
} finally {
  try { socket && socket.close(); } catch {}
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
