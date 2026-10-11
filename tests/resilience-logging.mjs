import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const BASE=process.env.DUCK_GYM_URL||'http://127.0.0.1:4173/';
const profile=mkdtempSync(join(tmpdir(),'gym-resilience-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${BASE}?e2e=1`],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function retry(fn){let last;for(let i=0;i<100;i++){try{return await fn();}catch(e){last=e;await sleep(100);}}throw last;}
let socket,nextId=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId,t=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result.result.value;}
async function reload(){await evaluate(`window.__resilienceReload=true;true`);await command('Page.reload');await retry(async()=>assert.ok(await evaluate(`!window.__resilienceReload&&document.readyState==='complete'&&typeof restoreRestTimer==='function'`)));}
const checks=[],browserErrors=[];function pass(label){checks.push(label);console.log(`PASS ${label}`);}
try{
  const port=await retry(()=>{const p=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];if(!p)throw Error('No debug port');return p;});
  const tab=await retry(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),tab=tabs.find(t=>t.type==='page'&&t.url.startsWith(BASE));if(!tab)throw Error('No page');return tab;});
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')browserErrors.push(m.params.args.map(a=>a.description||a.value).join(' '));if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m);};
  await command('Runtime.enable');await command('Page.enable');
  await retry(async()=>assert.ok(await evaluate(`document.readyState==='complete'&&typeof startQuickWorkout==='function'`)));
  await evaluate(`submitFirstRun('Resilience QA');true`);await sleep(300);
  await evaluate(`document.querySelectorAll('dialog[open]').forEach(el=>el.close());startQuickWorkout();closeSheet();addExerciseToWorkout('ch1');addExerciseToWorkout('ch1');addExerciseToWorkout('ch2');startRest(120,1);adjustRest(30);true`);await sleep(250);
  const resting=await evaluate(`JSON.parse(JSON.stringify(state.activeSession.restState))`);
  assert.equal(resting.totalSeconds,150);await reload();
  assert.deepEqual(await evaluate(`state.activeSession.restState`),resting);
  assert.ok(await evaluate(`document.getElementById('restPill').classList.contains('show')&&restRemaining>140&&restRemaining<=150&&restExerciseIndex===1`));
  pass('rest deadline and adjustment persist and resume after reload');

  await evaluate(`navigate('workout');toggleWorkoutPause();true`);
  const paused=await evaluate(`({remaining:restRemaining,deadline:state.activeSession.restState.deadline})`);
  await reload();assert.equal(await evaluate(`restRemaining`),paused.remaining);
  assert.equal(await evaluate(`document.querySelector('.rest-info span').textContent`),'Rest paused');
  await evaluate(`toggleWorkoutPause();true`);
  assert.ok(await evaluate(`state.activeSession.restState.deadline`)>paused.deadline);
  assert.ok(await evaluate(`restRemaining`)>paused.remaining-2);
  pass('pause freezes persisted rest across reload and resumes remaining duration');

  const owner=await evaluate(`activeProfileId`);
  await evaluate(`window.__otherId=Profiles.addProfile(localStorage,'Other resilience');commitSwitch(__otherId);true`);await sleep(200);
  assert.equal(await evaluate(`document.getElementById('restPill').classList.contains('show')`),false);
  await evaluate(`startQuickWorkout();closeSheet();addExerciseToWorkout('ch2');startRest(60,0);true`);await sleep(200);
  const otherRest=await evaluate(`state.activeSession.restState`);
  await evaluate(`commitSwitch(${JSON.stringify(owner)});navigate('workout');commitReorder(1,0);true`);
  assert.equal(await evaluate(`state.activeSession.restState.exerciseInstanceId`),resting.exerciseInstanceId);
  assert.equal(await evaluate(`restExerciseIndex`),0);assert.notEqual(otherRest.exerciseInstanceId,resting.exerciseInstanceId);
  pass('profile timers stay isolated and follow exercise instance during reorder');

  await evaluate(`state.activeSession.exercises[0].sets=[{weight:'80',reps:'8',done:true,warmup:true,side:'L',at:12345},{weight:'64',reps:'9',done:true,drop:true,rir:2,prefilled:true,side:'R',at:23456}];state.activeSession.exercises[0].notes='exact note';state.activeSession.exercises[0].rir=3;state.activeSession.exercises[0].supersetWithNext=true;renderWorkout();saveState();true`);
  const removed=await evaluate(`JSON.parse(JSON.stringify(state.activeSession.exercises[0]))`);
  await evaluate(`removeWorkoutExercise(0);true`);
  assert.equal(await evaluate(`!!state.activeSession.restState`),false);await reload();
  await evaluate(`navigate('workout');updateSet(0,0,'weight','90');commitReorder(0,1);undoWorkoutExercise();true`);
  assert.deepEqual(await evaluate(`state.activeSession.exercises.find(ex=>ex._logId===${JSON.stringify(removed._logId)})`),removed);
  assert.equal(await evaluate(`state.activeSession.exercises.find(ex=>ex._logId!==${JSON.stringify(removed._logId)}&&ex.exerciseId==='ch1').sets[0].weight`),'90');
  assert.equal(await evaluate(`state.activeSession.restState.exerciseInstanceId`),removed._logId);
  await evaluate(`removeWorkoutExercise(0);removeWorkoutExercise(0);undoWorkoutExercise();undoWorkoutExercise();true`);
  assert.equal(await evaluate(`state.activeSession.exercises.length`),3);
  pass('exercise Undo survives reload/reorder, restores duplicate flags and preserves newer edits');

  await evaluate(`clearSessionRest();openWorkoutExerciseMenu(0);document.getElementById('exerciseRest').value='45';saveExerciseNote(0);true`);await sleep(250);
  const preferredId=await evaluate(`state.activeSession.exercises[0].exerciseId`);await reload();
  assert.equal(await evaluate(`state.preferences.exerciseRestSeconds[${JSON.stringify(preferredId)}]`),45);
  await evaluate(`window.__nextSetOriginal=progressToNextSet;window.__nextSetCalls=[];progressToNextSet=index=>{__nextSetCalls.push(index);__nextSetOriginal(index);};navigate('workout');openWorkoutExerciseMenu(0);document.getElementById('exerciseRest').value='0';saveExerciseNote(0);state.activeSession.exercises[0].supersetWithNext=false;state.activeSession.exercises[0].sets=[{weight:'50',reps:'8',done:false}];renderWorkout();toggleSet(0,0);true`);await sleep(250);
  assert.equal(await evaluate(`!!state.activeSession.restState`),false);
  assert.equal(await evaluate(`document.getElementById('restPill').classList.contains('show')`),false);
  assert.deepEqual(await evaluate(`__nextSetCalls`),[0]);
  await evaluate(`__nextSetCalls=[];state.preferences.exerciseRestSeconds[state.activeSession.exercises[1].exerciseId]=0;state.activeSession.exercises[0].supersetWithNext=true;state.activeSession.exercises[1].supersetWithNext=false;state.activeSession.exercises[0].sets=[{weight:'50',reps:'8',done:false},{weight:'',reps:'',done:false}];state.activeSession.exercises[1].sets=[{weight:'50',reps:'8',done:false},{weight:'',reps:'',done:false}];renderWorkout();toggleSet(0,0);true`);await sleep(150);
  assert.deepEqual(await evaluate(`__nextSetCalls`),[1]);
  await evaluate(`toggleSet(1,0);true`);await sleep(150);
  assert.deepEqual(await evaluate(`__nextSetCalls`),[1,0]);
  assert.equal(await evaluate(`!!state.activeSession.restState||document.getElementById('restPill').classList.contains('show')`),false);
  await evaluate(`progressToNextSet=__nextSetOriginal;true`);
  await evaluate(`state.preferences.exerciseRestSeconds[state.activeSession.exercises[0].exerciseId]=60;state.activeSession.exercises[0].supersetWithNext=true;startRest(90,0);state.activeSession.exercises[0].sets[0].done=false;toggleSet(0,0);true`);
  assert.equal(await evaluate(`!!state.activeSession.restState`),false);
  pass('preferred rest persists; zero advances ordinary and paired sets without a timer');

  await evaluate(`window.__buzzOriginal=buzz;window.__restBuzz=[];buzz=n=>__restBuzz.push(n);startRest(20,0);state.activeSession.restState.deadline=Date.now()-1;saveState();tickRest();tickRest();document.dispatchEvent(new Event('visibilitychange'));true`);
  assert.deepEqual(await evaluate(`__restBuzz`),[40]);
  assert.equal(await evaluate(`!!JSON.parse(localStorage.getItem(stateKey)).activeSession.restState`),false);
  await evaluate(`buzz=__buzzOriginal;startRest(20,0);state.activeSession.restState.deadline=Date.now()-100;saveState();clearInterval(restTimer);true`);await reload();
  assert.equal(await evaluate(`!!state.activeSession.restState`),false);
  assert.equal(await evaluate(`document.getElementById('restPill').classList.contains('show')`),false);
  await evaluate(`navigate('workout');startRest(90,0);finishWorkout();true`);
  assert.equal(await evaluate(`state.activeSession===null&&!state.history[0].restState&&!state.history[0]._exerciseEdits`),true);
  await evaluate(`closeReceipt();true`);pass('expiry consumed once; expired reload quiet; finish strips timer/journals');

  await evaluate(`window.__syncCalls=[];Sync.deleteRemote=id=>{__syncCalls.push(['delete',id]);return Promise.resolve(true);};Sync.onSessionComplete=s=>__syncCalls.push(['restore',s.id]);state.history=[
    {id:'trash-baseline',name:'Baseline',started:1000,finished:2000,exercises:[{exerciseId:'ch1',sets:[{weight:'60',reps:'8',done:true,at:1500}]}]},
    {id:'trash-best',name:'Best',started:3000,finished:4000,exercises:[{exerciseId:'ch1',sets:[{weight:'80',reps:'8',done:true,side:'R',at:3500}]}]},
    {id:'trash-later',name:'Later',started:5000,finished:6000,exercises:[{exerciseId:'ch1',sets:[{weight:'70',reps:'8',done:true,at:5500}]}]}];state.history=Core.rebuildPRs(state.history);state.deletedHistory=[];saveState();window.__trashOriginal=JSON.parse(JSON.stringify(state.history.find(s=>s.id==='trash-best')));deleteHistory('trash-best');true`);await sleep(250);
  const original=await evaluate(`__trashOriginal`);
  assert.equal(await evaluate(`state.history.find(s=>s.id==='trash-later').prs.length>0`),true);
  assert.deepEqual(await evaluate(`state.deletedHistory[0].session`),original);
  assert.ok(await evaluate(`__syncCalls.some(c=>c[0]==='delete'&&c[1]==='trash-best')`));await reload();
  assert.deepEqual(await evaluate(`state.deletedHistory[0].session`),original);
  await evaluate(`window.__syncCalls=[];Sync.onSessionComplete=s=>__syncCalls.push(['restore',s.id]);openSettings();true`);
  assert.ok(await evaluate(`document.querySelector('.deleted-history-link').textContent.includes('1')`));
  await evaluate(`openDeletedHistory();restoreDeletedHistory('trash-best');true`);
  assert.equal(await evaluate(`state.deletedHistory.length`),0);
  assert.equal(await evaluate(`state.history.find(s=>s.id==='trash-later').prs.length`),0);
  assert.deepEqual(await evaluate(`state.history.find(s=>s.id==='trash-best')`),original);
  assert.deepEqual(await evaluate(`__syncCalls`),[['restore','trash-best']]);
  pass('trash persists/findable; restore retains original data and rebuilds later PRs/sync');

  await evaluate(`state.history.push({id:'edit-warmup',name:'Warm-up correction',started:7000,finished:8000,exercises:[{exerciseId:'ch2',sets:[{weight:'40',reps:'8',done:true},{weight:'100',reps:'30',done:true,warmup:true}]}]});openHistoryEdit('edit-warmup');true`);
  assert.match(await evaluate(`document.querySelector('.he-live').textContent`),/320 kg working volume.*1 working sets.*1 warm-up set/);
  await evaluate(`editHistorySet(0,1,'reps','31');true`);
  assert.match(await evaluate(`document.querySelector('.he-live').textContent`),/320 kg working volume/);
  await evaluate(`saveHistoryEdit();true`);
  assert.equal(await evaluate(`document.getElementById('toast').textContent`),'Workout updated');
  await evaluate(`closeSheet();state.history=state.history.filter(s=>s.id!=='edit-warmup');true`);
  pass('history corrections keep working totals and warm-up count consistent');

  await evaluate(`deleteHistory('trash-best');window.__backup=JSON.parse(JSON.stringify(state));window.__clean=Core.validateBackup(__backup,DUCK_EXERCISES.map(e=>e.id));true`);
  assert.deepEqual(await evaluate(`__clean.deletedHistory[0].session`),original);
  assert.equal(await evaluate(`__clean.preferences.exerciseRestSeconds[${JSON.stringify(preferredId)}]`),60);
  await evaluate(`(async()=>{state=emptyState();saveState();await importBackup({text:async()=>JSON.stringify(__backup)});return true;})()`);await sleep(250);
  assert.equal(await evaluate(`state.deletedHistory.length`),1,JSON.stringify(await evaluate(`({toast:document.getElementById('toast').textContent,view:currentView,candidate:__backup.deletedHistory.length})`)));
  assert.deepEqual(await evaluate(`state.deletedHistory[0].session`),original);
  await evaluate(`(async()=>{restoreDeletedHistory('trash-best');closeSheet();startQuickWorkout();closeSheet();addExerciseToWorkout('ch1');startRest(120,0);removeWorkoutExercise(0);window.__activeBackup=JSON.parse(JSON.stringify(state));await importBackup({text:async()=>JSON.stringify(__activeBackup)});navigate('workout');undoWorkoutExercise();return true;})()`);await sleep(250);
  assert.equal(await evaluate(`state.activeSession.exercises.length`),1);
  assert.equal(await evaluate(`state.activeSession.restState.totalSeconds`),120);
  pass('backup/import preserve trash, exercise preferences and active Undo/rest');

  for(const theme of ['dark','light'])for(const width of [320,390]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    await evaluate(`document.querySelectorAll('dialog[open]').forEach(el=>el.close());deleteHistory('trash-best');openDeletedHistory();document.getElementById('toast').classList.remove('show');true`);await sleep(150);
    const dims=await evaluate(`(()=>{const btn=document.querySelector('.deleted-history-row button'),r=btn.getBoundingClientRect();return {w:r.width,h:r.height,size:parseFloat(getComputedStyle(btn).fontSize),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()`);
    assert.ok(dims.w>=44&&dims.h>=44&&dims.size>=11&&!dims.overflow);
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),folder=new URL('../artifacts/design-qa/surfaces/resilience/',import.meta.url);mkdirSync(folder,{recursive:true});writeFileSync(new URL(`deleted-history-${theme}-${width}.png`,folder),Buffer.from(shot.result.data,'base64'));
    await evaluate(`closeSheet();navigate('workout');window.scrollTo(0,0);openWorkoutExerciseMenu(0);true`);await sleep(150);
    const menuShot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(`exercise-rest-${theme}-${width}.png`,folder),Buffer.from(menuShot.result.data,'base64'));
    await evaluate(`closeSheet();removeWorkoutExercise(0);document.getElementById('toast').classList.remove('show');window.scrollTo(0,0);true`);await sleep(150);
    assert.ok(await evaluate(`document.querySelector('.exercise-undo button').getBoundingClientRect().height>=44`));
    const undoShot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(`exercise-undo-${theme}-${width}.png`,folder),Buffer.from(undoShot.result.data,'base64'));
    await evaluate(`undoWorkoutExercise();true`);
  }
  pass('trash at320/390 in both themes; labels11px and controls44px');
  await evaluate(`closeSheet();confirmCancelWorkout();true`);
  assert.equal(await evaluate(`state.activeSession===null&&restDeadline===0`),true);
  assert.deepEqual(browserErrors,[],'No browser exceptions or console errors');
  console.log(`${checks.length} resilience logging checks passed.`);
}finally{socket?.close();chrome.kill();}
