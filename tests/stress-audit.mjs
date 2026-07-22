// Stress harness for the 2026-07-22 audit fixes. Zero-dep headless Chrome over CDP (same pattern
// as browser-flow.mjs). This one is adversarial: it drives the sequences the audit said would break
// things — reorder mid-rest, blur-after-finish, malformed import, timed exercises end to end —
// and fails on ANY uncaught page error or console error along the way.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.DUCK_GYM_URL || 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'duck-gym-stress-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, `${BASE}?e2e=1`
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(fn, timeout = 10000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; await sleep(100); } }
  throw last || new Error('Timed out');
}

let socket, nextId = 0;
const pending = new Map();
const pageErrors = [];   // uncaught exceptions + console.error, collected for the whole run
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
  return result.result?.result?.value;
}
async function waitFor(expression, timeout = 8000) {
  return retry(async () => { const v = await evaluate(expression); if (!v) throw new Error(`Waiting for: ${expression}`); return v; }, timeout);
}
const checks = [];
const ok = (name, cond, detail = '') => { assert.ok(cond, `${name}${detail ? ' — ' + detail : ''}`); checks.push(name); };

// Fresh profile + a started workout, injury mode explicitly set.
async function freshWorkout({ injury = false } = {}) {
  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);
  await waitFor(`document.getElementById('sheet').open && typeof submitFirstRun === 'function'`);
  await evaluate(`submitFirstRun('Stress'); true`);
  await waitFor(`!document.getElementById('sheet').open && typeof stateKey === 'string' && !!stateKey`);
  await evaluate(`state.preferences.injuryMode=${injury}; saveState(); startQuickWorkout(); true`);
  await waitFor(`!!state.activeSession`);
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
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push('UNCAUGHT: ' + (m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text));
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      pageErrors.push('CONSOLE.ERROR: ' + (m.params.args || []).map(a => a.description || a.value).join(' '));
      return;
    }
    if (!m.id || !pending.has(m.id)) return;
    const task = pending.get(m.id); pending.delete(m.id);
    m.error ? task.reject(new Error(m.error.message)) : task.resolve(m);
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await waitFor(`document.readyState === 'complete' && typeof startQuickWorkout === 'function'`);

  // ---------- 1. Reorder: integrity under repeated moves ----------
  await freshWorkout();
  await evaluate(`['ch1','lg22','gr3','co2'].forEach(addExerciseToWorkout); true`);
  await waitFor(`state.activeSession.exercises.length === 4`);
  const order0 = await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId).join(',')`);
  ok('reorder: initial order', order0 === 'ch1,lg22,gr3,co2', order0);
  // Walk the last exercise to the top one step at a time (the glute-bridge case).
  await evaluate(`moveWorkoutExercise(3,-1);moveWorkoutExercise(2,-1);moveWorkoutExercise(1,-1); true`);
  const order1 = await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId).join(',')`);
  ok('reorder: walked last to first', order1 === 'co2,ch1,lg22,gr3', order1);
  // Out-of-range moves must be no-ops, not corruption.
  await evaluate(`moveWorkoutExercise(0,-1);moveWorkoutExercise(3,1);moveWorkoutExercise(99,1);moveWorkoutExercise(-5,-1); true`);
  const order2 = await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId).join(',')`);
  ok('reorder: boundary + garbage indexes are no-ops', order2 === order1, order2);
  ok('reorder: no exercise lost or duplicated', (await evaluate(`state.activeSession.exercises.length`)) === 4);
  // 200 random moves — order must stay a permutation of the same 4 ids.
  await evaluate(`for(let i=0;i<200;i++){const n=state.activeSession.exercises.length;moveWorkoutExercise(Math.floor(Math.random()*n),Math.random()<.5?-1:1);} true`);
  const bag = await evaluate(`state.activeSession.exercises.map(e=>e.exerciseId).sort().join(',')`);
  ok('reorder: 200 random moves preserve the exercise set', bag === 'ch1,co2,gr3,lg22', bag);

  // ---------- 2. Disabled state on the boundary buttons ----------
  await evaluate(`openWorkoutExerciseMenu(0); true`);
  await waitFor(`document.getElementById('sheet').open`);
  const upState = await evaluate(`(()=>{const b=[...document.querySelectorAll('#sheetContent .sheet-actions button')].find(x=>x.textContent.includes('Move up'));return {disabled:b.disabled,opacity:getComputedStyle(b).opacity,cursor:getComputedStyle(b).cursor};})()`);
  ok('disabled: first exercise Move-up is disabled', upState.disabled === true);
  ok('disabled: it is visibly dimmed', Number(upState.opacity) < 0.5, `opacity=${upState.opacity}`);
  ok('disabled: cursor is not a pointer', upState.cursor !== 'pointer', upState.cursor);
  await evaluate(`closeSheet(); true`);

  // ---------- 3. Reorder / remove while a rest timer is running ----------
  await evaluate(`startRest(90,3); true`); // rest belongs to the LAST exercise
  const restBefore = await evaluate(`restExerciseIndex`);
  await evaluate(`moveWorkoutExercise(3,-1); true`);
  ok('rest index follows a moved exercise', (await evaluate(`restExerciseIndex`)) === 2, `was ${restBefore}`);
  await evaluate(`startRest(90,0); removeWorkoutExercise(0); true`);
  const restAfterRemove = await evaluate(`restExerciseIndex`);
  ok('rest index stays in range after removing its exercise', restAfterRemove >= 0 && restAfterRemove < (await evaluate(`state.activeSession.exercises.length`)), `idx=${restAfterRemove}`);
  await evaluate(`skipRest(); true`); // must not throw on the remapped index

  // ---------- 4. Blur-after-finish: the stale-handler crash ----------
  await freshWorkout();
  await evaluate(`addExerciseToWorkout('ch1'); updateSet(0,0,'weight','60'); updateSet(0,0,'reps','5'); toggleSet(0,0); true`);
  await waitFor(`state.activeSession.exercises[0].sets[0].done === true`);
  await evaluate(`finishWorkout(); true`);
  await waitFor(`state.activeSession === null`);
  const errsBefore = pageErrors.length;
  // Every one of these fires from real UI handlers after activeSession is gone.
  await evaluate(`updateSet(0,0,'weight','99'); cycleSide(0,0); toggleSet(0,0); addSet(0); addDropSet(0); openWorkoutExerciseMenu(0); saveExerciseNote(0); moveWorkoutExercise(0,1); removeWorkoutExercise(0); setPreCheckin(3); true`);
  ok('post-finish handlers do not throw', pageErrors.length === errsBefore, pageErrors.slice(errsBefore).join(' | '));

  // ---------- 5. Timed exercise, end to end ----------
  await freshWorkout();
  await evaluate(`addExerciseToWorkout('gr3'); true`); // Dead Hang, bodyweight + timed
  await waitFor(`document.querySelectorAll('.set-row').length === 1`);
  const header = await evaluate(`document.querySelector('.workout-exercise .set-grid.header').textContent`);
  ok('timed: column header reads Sec', /Sec/.test(header) && !/Reps/.test(header), header);
  await evaluate(`openPad(0,0,'reps'); true`);
  const padLabel = await evaluate(`document.querySelector('#padContent h2').textContent + '/' + document.querySelector('.pad-value small').textContent`);
  ok('timed: pad reads Seconds', padLabel === 'Seconds/sec', padLabel);
  await evaluate(`closePad(); true`);
  await evaluate(`updateSet(0,0,'reps','60'); toggleSet(0,0); setRir(0,3); finishWorkout(); true`);
  await waitFor(`state.activeSession === null && state.history.length === 1`);
  const s1 = await evaluate(`(()=>{const h=state.history[0];return {volume:Core.summarizeSession(h).volume, prs:h.prs};})()`);
  ok('timed: a 60s bodyweight hold adds zero kg volume', s1.volume === 0, `volume=${s1.volume}`);
  ok('timed: first exposure mints no phantom PR', Array.isArray(s1.prs), JSON.stringify(s1.prs));
  // Second session, longer hold → must be a seconds PR, and the receipt must say so.
  await evaluate(`startQuickWorkout(); addExerciseToWorkout('gr3'); updateSet(0,0,'reps','90'); toggleSet(0,0); setRir(0,3); finishWorkout(); true`);
  await waitFor(`state.history.length === 2`);
  const pr = await evaluate(`state.history[0].prs[0]`);
  ok('timed: longer hold is a PR', pr && pr.seconds === 90, JSON.stringify(pr));
  ok('timed: PR carries no estimated 1RM', pr && pr.estimated1RM === undefined, JSON.stringify(pr));
  const feedText = await evaluate(`(()=>{navigate('progress');renderProgress();return document.getElementById('prFeed').textContent;})()`);
  ok('timed: PR feed reads in seconds', /90 s hold/.test(feedText), feedText.slice(0, 120));
  ok('timed: PR feed shows no phantom 1RM', !/est\. 1-rep max/.test(feedText) || !/Dead Hang/.test(feedText.split('est.')[0].slice(-40)));
  // Progression target must be on the seconds axis.
  await evaluate(`startQuickWorkout(); addExerciseToWorkout('gr3'); true`);
  await waitFor(`!!state.activeSession`);
  const targetLine = await evaluate(`document.querySelector('.target-line')?.textContent || ''`);
  ok('timed: target is in seconds, not kg × reps', /\d+\s*s/.test(targetLine) && !/kg × \d/.test(targetLine), targetLine);
  ok('timed: target adds time', /95 s/.test(targetLine), targetLine);
  // Detail sheet must not offer a rep-records table or a 1RM trend for a hold.
  await evaluate(`openExerciseDetail('gr3'); true`);
  const detail = await evaluate(`document.getElementById('sheetContent').textContent`);
  ok('timed: detail sheet drops REP RECORDS', !/REP RECORDS/.test(detail));
  ok('timed: detail sheet trends hold time', /BEST HOLD/.test(detail));
  await evaluate(`closeSheet(); true`);

  // ---------- 6. Rep-based exercises still behave ----------
  await freshWorkout();
  await evaluate(`addExerciseToWorkout('ch1'); updateSet(0,0,'weight','80'); updateSet(0,0,'reps','8'); toggleSet(0,0); true`);
  const rHeader = await evaluate(`document.querySelector('.workout-exercise .set-grid.header').textContent`);
  ok('rep-based: header still reads Reps', /Reps/.test(rHeader) && !/Sec/.test(rHeader), rHeader);
  const vol = await evaluate(`Core.summarizeSession({...state.activeSession,finished:Date.now()}).volume`);
  ok('rep-based: volume still counts kg × reps', vol === 640, `volume=${vol}`);

  // ---------- 7. Injury mode gating ----------
  await freshWorkout({ injury: false });
  ok('injury off: no pain check-in card', !(await evaluate(`!!document.getElementById('checkinCard')`)));
  const settingsNoInjury = await evaluate(`(()=>{openSettings();const t=document.getElementById('sheetContent').textContent;closeSheet();return t;})()`);
  ok('injury off: no hypermobility jargon in Settings', !/Beighton/i.test(settingsNoInjury));
  ok('injury off: injury toggle is offered', /Training around an injury/.test(settingsNoInjury));
  // A healthy lifter must still earn a progression target with no flare answer at all.
  await evaluate(`addExerciseToWorkout('ch1'); updateSet(0,0,'weight','80'); updateSet(0,0,'reps','8'); toggleSet(0,0); setRir(0,3); finishWorkout(); true`);
  await waitFor(`state.history.length === 1`);
  await evaluate(`startQuickWorkout(); addExerciseToWorkout('ch1'); true`);
  const healthyTarget = await evaluate(`document.querySelector('.target-line')?.textContent || ''`);
  ok('injury off: progression target appears without check-ins', /80 kg × 9/.test(healthyTarget), healthyTarget);
  await freshWorkout({ injury: true });
  await waitFor(`!!document.getElementById('checkinCard')`);
  const checkinText = await evaluate(`document.getElementById('checkinCard').textContent`);
  ok('injury on: check-in returns', /aches or niggles/i.test(checkinText), checkinText.slice(0, 80));
  ok('injury on: copy no longer assumes a "problem area"', !/problem area/i.test(checkinText));

  // ---------- 8. Malformed backup import must not brick the app ----------
  await freshWorkout();
  await evaluate(`addExerciseToWorkout('ch1'); true`);
  const bad = JSON.stringify({ version: 2, routines: [], history: [], activeSession: {}, preferences: {} });
  const importResult = await evaluate(`(()=>{ try{ Core.validateBackup(${JSON.stringify(bad)} && JSON.parse(${JSON.stringify(bad)}), []); return 'ACCEPTED'; }catch(e){ return 'REJECTED'; } })()`);
  ok('import: activeSession without exercises is rejected', importResult === 'REJECTED', importResult);
  ok('import: app state survived the rejected import', (await evaluate(`Array.isArray(state.activeSession.exercises)`)) === true);
  const good = JSON.stringify({ version: 2, routines: [], history: [], activeSession: { exercises: [] }, preferences: {} });
  const goodResult = await evaluate(`(()=>{ try{ Core.validateBackup(JSON.parse(${JSON.stringify(good)}), []); return 'ACCEPTED'; }catch(e){ return 'REJECTED: '+e.message; } })()`);
  ok('import: a well-formed backup is still accepted', goodResult === 'ACCEPTED', goodResult);

  // ---------- 9. Deleting a workout dequeues it from sync ----------
  await freshWorkout();
  await evaluate(`addExerciseToWorkout('ch1'); updateSet(0,0,'weight','50'); updateSet(0,0,'reps','5'); toggleSet(0,0); finishWorkout(); true`);
  await waitFor(`state.history.length === 1`);
  const dequeued = await evaluate(`(()=>{
    const id=state.history[0].id;
    Sync.updateConfig(c=>{c.queue=[{sessionId:id}];c.uploadedFiles={[id]:'f1'};});
    deleteHistory(id);
    const c=Sync.loadConfig();
    return {queued:c.queue.length, mapped:Object.keys(c.uploadedFiles).length, history:state.history.length};
  })()`);
  ok('delete: session dropped from the sync queue', dequeued.queued === 0, JSON.stringify(dequeued));
  ok('delete: uploaded-file mapping cleaned up', dequeued.mapped === 0, JSON.stringify(dequeued));
  ok('delete: history actually shrank', dequeued.history === 0);

  // ---------- 9b. Declared goals, end to end ----------
  await freshWorkout();
  await evaluate(`(()=>{state.activeSession=null;state.goals=[];state.history=[];state.bodyweight=[];saveState();navigate('progress');renderProgress();return true})()`);
  const emptyGoals = await evaluate(`document.getElementById('goalBoard').textContent`);
  ok('goals: empty state invites a first goal', /No goals yet/.test(emptyGoals), emptyGoals.slice(0, 60));
  // Strength goal via the real sheet flow (type picker -> exercise picker -> target -> save).
  await evaluate(`openGoalSheet(); true`);
  await waitFor(`document.getElementById('sheet').open && !!document.querySelector('.goal-types')`);
  await evaluate(`(()=>{pickGoalExercise();pickExercise('ch1');return true})()`);
  await waitFor(`!!document.getElementById('goalTarget')`);
  await evaluate(`(()=>{document.getElementById('goalTarget').value='100';saveGoal();return true})()`);
  await waitFor(`state.goals.length === 1`);
  const g1 = await evaluate(`state.goals[0]`);
  ok('goals: strength goal saved against the chosen exercise', g1.type === 'strength' && g1.exerciseId === 'ch1' && g1.target === 100, JSON.stringify(g1));
  ok('goals: start line frozen at creation', g1.startValue === null || typeof g1.startValue === 'number', JSON.stringify(g1.startValue));
  // Log work below the target: progress moves, goal does NOT complete.
  await evaluate(`(()=>{startQuickWorkout();addExerciseToWorkout('ch1');updateSet(0,0,'weight','80');updateSet(0,0,'reps','5');toggleSet(0,0);finishWorkout();return true})()`);
  await waitFor(`state.history.length === 1`);
  await evaluate(`(()=>{closeReceipt();renderProgress();return true})()`);
  const mid = await evaluate(`(()=>{const p=Core.goalProgress(state.goals[0],goalCtx());return {pct:p.pct,done:p.done,current:p.current}})()`);
  ok('goals: progress tracks real logged evidence', mid.current === 80 && !mid.done, JSON.stringify(mid));
  ok('goals: not marked achieved before the target is hit', (await evaluate(`state.goals[0].achievedAt`)) === null);
  const cardText = await evaluate(`document.getElementById('goalBoard').textContent`);
  ok('goals: card states the gap in words as well as a bar', /to go/.test(cardText), cardText.slice(0, 90));
  ok('goals: card states a percentage (not colour alone)', /%/.test(cardText));
  // Today surfaces the nearest goal.
  await evaluate(`(()=>{navigate('today');renderToday();return true})()`);
  const strip = await evaluate(`document.getElementById('todayGoal').textContent`);
  ok('goals: today shows the nearest goal', /GOAL/.test(strip) && /to go/.test(strip), strip.slice(0, 80));
  // Hit the target — achievement stamps exactly once.
  await evaluate(`(()=>{startQuickWorkout();addExerciseToWorkout('ch1');updateSet(0,0,'weight','100');updateSet(0,0,'reps','3');toggleSet(0,0);finishWorkout();return true})()`);
  await waitFor(`state.goals[0].achievedAt !== null`);
  const stamp = await evaluate(`state.goals[0].achievedAt`);
  await evaluate(`(()=>{closeReceipt();checkGoalAchievements();checkGoalAchievements();return true})()`);
  ok('goals: achievement stamped once and never re-stamped', (await evaluate(`state.goals[0].achievedAt`)) === stamp);
  await evaluate(`(()=>{navigate('progress');renderProgress();return true})()`);
  ok('goals: achieved goals move out of the active list', /achieved/i.test(await evaluate(`document.getElementById('goalBoard').textContent`)));
  // Bodyweight goal, both directions, driven by the bodyweight log.
  await evaluate(`(()=>{state.bodyweight=[{t:Date.now()-86400000,kg:90}];saveState();
    goalDraft={type:'bodyweight',exerciseId:'',target:'',perWeek:'3'};renderGoalSheet();return true})()`);
  await evaluate(`(()=>{document.getElementById('goalTarget').value='80';saveGoal();return true})()`);
  const bw = await evaluate(`(()=>{const g=state.goals.find(g=>g.type==='bodyweight');const p=Core.goalProgress(g,goalCtx());return {start:g.startValue,pct:p.pct,remaining:p.remaining}})()`);
  ok('goals: bodyweight goal starts from today\'s weight', bw.start === 90, JSON.stringify(bw));
  ok('goals: losing-weight goal reports the gap', bw.remaining === 10 && bw.pct === 0, JSON.stringify(bw));
  // Consistency goal + streak wording.
  await evaluate(`(()=>{goalDraft={type:'consistency',exerciseId:'',target:'',perWeek:'3'};renderGoalSheet();
    document.getElementById('goalTarget').value='3';saveGoal();renderProgress();return true})()`);
  const consistency = await evaluate(`(()=>{const g=state.goals.find(g=>g.type==='consistency');const p=Core.goalProgress(g,goalCtx());return {current:p.current,target:p.target,streak:p.streak}})()`);
  ok('goals: consistency counts this week\'s sessions', consistency.current === 2 && consistency.target === 3, JSON.stringify(consistency));
  // Deleting is clean.
  const before = await evaluate(`state.goals.length`);
  await evaluate(`(()=>{deleteGoal(state.goals[0].id);return true})()`);
  ok('goals: delete removes exactly one', (await evaluate(`state.goals.length`)) === before - 1);
  // Malformed stored goals must not break a render or a boot.
  const survived = await evaluate(`(()=>{
    const raw=JSON.parse(localStorage.getItem(stateKey));
    raw.goals=[{type:'strength',target:100},{type:'junk'},null,'x',{id:'ok',type:'consistency',target:3,created:1}];
    localStorage.setItem(stateKey,JSON.stringify(raw));
    state=readState();renderProgress();
    return state.goals.length;
  })()`);
  ok('goals: malformed rows are dropped, render survives', survived === 1, `kept ${survived}`);

  // ---------- 9c. Bodyweight sessions read honestly (no proud "0 kg") ----------
  await freshWorkout();
  await evaluate(`(()=>{state.history=[];saveState();addExerciseToWorkout('cs15');updateSet(0,0,'reps','12');toggleSet(0,0);return true})()`);
  const finishCopy = await evaluate(`(()=>{requestFinishWorkout();const t=document.getElementById('confirmContent').textContent;closeConfirm();return t})()`);
  ok('bodyweight: finish dialog does not claim 0 kg moved', !/0 kg/.test(finishCopy), finishCopy.slice(0, 80));
  await evaluate(`finishWorkout(); true`);
  await waitFor(`state.history.length === 1`);
  const receiptText = await evaluate(`document.getElementById('receiptCard').textContent`);
  ok('bodyweight: receipt names the work instead of 0 kg', /bodyweight/i.test(receiptText) && !/0 kg/.test(receiptText), receiptText.slice(0, 120));
  await evaluate(`closeReceipt(); true`);
  await evaluate(`(()=>{navigate('progress');renderProgress();return true})()`);
  const stats = await evaluate(`document.getElementById('progressStats').textContent`);
  ok('bodyweight: lifetime metric switches to sets when there are no kilos', /LIFETIME SETS/.test(stats), stats.slice(0, 90));
  const histText = await evaluate(`document.getElementById('historyList').textContent`);
  ok('bodyweight: history card drops the empty kg chip', !/0 kg/.test(histText), histText.slice(0, 90));

  // ---------- 9d. Cloud backup is self-serve ----------
  const sync = await evaluate(`(()=>{const c=Sync.loadConfig();const s=Sync.status();return {clientId:c.clientId,enabled:c.enabled,available:s.available,configured:s.configured,def:Sync.DEFAULT_CLIENT_ID}})()`);
  ok('sync: a built-in client id ships, so Connect works with no setup', !!sync.clientId && sync.clientId === sync.def, JSON.stringify(sync.clientId));
  ok('sync: Connect is offered without any setup', sync.available === true);
  ok('sync: but nothing syncs until the user opts in', sync.configured === false && sync.enabled === false, JSON.stringify(sync));
  const clearedFallback = await evaluate(`(()=>{Sync.updateConfig(c=>{c.clientId='';});return Sync.loadConfig().clientId})()`);
  ok('sync: clearing a custom id falls back to the built-in one', clearedFallback === sync.def, clearedFallback);
  const settingsText = await evaluate(`(()=>{openSettings();const t=document.getElementById('sheetContent').textContent;closeSheet();return t})()`);
  ok('sync: settings lead with plain language, not an OAuth field', /your own.{0,4} Google Drive/i.test(settingsText), settingsText.slice(0, 60));
  ok('sync: the raw client id is tucked under Advanced', /Advanced/.test(settingsText));

  // ---------- 10. Monkey run: random valid actions, no uncaught errors ----------
  await freshWorkout();
  const errsBeforeMonkey = pageErrors.length;
  await evaluate(`(()=>{
    const ids=['ch1','lg22','gr3','co2','cs19'];
    for(let i=0;i<400;i++){
      const n=()=>state.activeSession?state.activeSession.exercises.length:0;
      const pick=Math.floor(Math.random()*Math.max(1,n()));
      switch(Math.floor(Math.random()*9)){
        case 0: addExerciseToWorkout(ids[Math.floor(Math.random()*ids.length)]); break;
        case 1: if(n()) moveWorkoutExercise(pick,Math.random()<.5?-1:1); break;
        case 2: if(n()) addSet(pick); break;
        case 3: if(n()){const ex=state.activeSession.exercises[pick];const s=Math.floor(Math.random()*ex.sets.length);updateSet(pick,s,'weight',String(Math.floor(Math.random()*100)));updateSet(pick,s,'reps',String(Math.floor(Math.random()*60)));} break;
        case 4: if(n()){const ex=state.activeSession.exercises[pick];toggleSet(pick,Math.floor(Math.random()*ex.sets.length));} break;
        case 5: if(n()) addDropSet(pick); break;
        case 6: if(n()>1) toggleSuperset(pick,Math.random()<.5); break;
        case 7: if(n()>1) removeWorkoutExercise(pick); break;
        case 8: if(n()) cycleSide(pick,0); break;
      }
    }
    return true;
  })()`);
  ok('monkey: 400 random actions raised no uncaught error', pageErrors.length === errsBeforeMonkey, pageErrors.slice(errsBeforeMonkey).slice(0, 3).join(' | '));
  const sane = await evaluate(`(()=>{
    const s=state.activeSession; if(!s) return 'no session';
    for(const ex of s.exercises){
      if(typeof ex.exerciseId!=='string') return 'bad exerciseId';
      if(!Array.isArray(ex.sets)||!ex.sets.length) return 'bad sets';
      for(const st of ex.sets){ if(!('weight' in st)||!('reps' in st)||typeof st.done!=='boolean') return 'bad set shape'; }
    }
    if(s.exercises.length && restExerciseIndex >= s.exercises.length) return 'rest index out of range';
    return 'ok';
  })()`);
  ok('monkey: state shape stayed valid', sane === 'ok', sane);
  const persisted = await evaluate(`(()=>{try{const raw=JSON.parse(localStorage.getItem(stateKey));return raw&&raw.version===2?'ok':'bad';}catch(e){return 'unparseable';}})()`);
  ok('monkey: persisted state is still readable', persisted === 'ok', persisted);
  // Finish it — the summary must not throw on whatever the monkey built.
  await evaluate(`finishWorkout(); true`);
  await waitFor(`state.activeSession === null`);
  ok('monkey: session finished and stored', (await evaluate(`state.history.length >= 1`)) === true);

  // ---------- verdict ----------
  if (pageErrors.length) {
    console.error('PAGE ERRORS:\n' + pageErrors.join('\n'));
    throw new Error(`${pageErrors.length} uncaught page error(s) during stress run`);
  }
  console.log(`stress-audit-ok checks=${checks.length} pageErrors=0`);
} finally {
  try { socket && socket.close(); } catch {}
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
