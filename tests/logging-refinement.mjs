import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BASE=process.env.DUCK_GYM_URL||'http://127.0.0.1:4173/';
const profile=mkdtempSync(join(tmpdir(),'gym-logging-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${BASE}?e2e=1`],{stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function retry(fn){let last;for(let i=0;i<100;i++){try{return await fn();}catch(error){last=error;await sleep(100);}}throw last;}
let socket,nextId=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId,t=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:m=>{clearTimeout(t);resolve(m);},reject:e=>{clearTimeout(t);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const m=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(m.result.exceptionDetails)throw new Error(m.result.exceptionDetails.exception?.description||m.result.exceptionDetails.text);return m.result.result.value;}
async function click(selector){
  const r=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing click target');el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await sleep(100);
  const hit=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),hit=document.elementFromPoint(${r.x},${r.y});return {ok:!!hit&&(el===hit||el.contains(hit)),hit:hit?.outerHTML.slice(0,180),dialogs:[...document.querySelectorAll('dialog[open]')].map(el=>el.id)};})()`);
  assert.ok(hit.ok,`${selector} is covered: ${JSON.stringify(hit)}`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});await sleep(70);
}
const checks=[];
function pass(name){checks.push(name);console.log(`PASS ${name}`);}
try{
  const port=await retry(()=>{const p=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0];if(!p)throw Error('No browser port');return p;});
  const tab=await retry(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),tab=tabs.find(t=>t.type==='page'&&t.url.startsWith(BASE));if(!tab)throw Error('No browser tab');return tab;});
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m);};
  await command('Runtime.enable');await command('Page.enable');
  await retry(async()=>assert.equal(await evaluate(`document.readyState==='complete'&&typeof startQuickWorkout==='function'`),true));
  await evaluate(`submitFirstRun('Logging QA');true`);await sleep(300);
  await evaluate(`document.querySelectorAll('dialog[open]').forEach(el=>el.close());navigate('train');true`);await sleep(150);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await click('.quick-workout-row .workout-open');
  assert.ok(await evaluate(`!!document.querySelector('#sheet[open] #pk_search')`));
  assert.ok(await evaluate(`document.querySelector('#pk_quick').textContent.includes('Recent')&&document.querySelector('#pk_quick').textContent.includes('Favourites')`));
  await evaluate(`closeSheet();true`);await sleep(250);
  assert.ok(await evaluate(`!!document.querySelector('#view-workout [onclick*="openExercisePicker"]')`));
  pass('fresh Quick workout opens picker; cancel leaves Add exercise');

  // Fixture models the exact erroneous six-row workout, with deliberately varied serialized flags.
  await evaluate(`window.__bench=allExercises().find(e=>/bench press/i.test(e.name)&&!e.timed).id;addExerciseToWorkout(__bench);state.activeSession.exercises[0].sets=[
    {weight:'80',reps:'8',done:true,planned:true,at:100,side:'L'},
    {weight:'40',reps:'5',done:false,warmup:true,prefilled:true},
    {weight:'64',reps:'10',done:true,drop:true,side:'R',rir:2,at:120},
    {weight:'',reps:'',done:false},
    {weight:'80',reps:'7',done:true,planned:true,at:140},
    {weight:'80',reps:'6',done:true,planned:true,at:150}];state.activeSession.exercises[0].rir=1;saveState();reopenExercise(0);window.__rows=JSON.parse(JSON.stringify(state.activeSession.exercises[0].sets));startRest(300,0);window.__rest=restDeadline;true`);
  await click('.edit-sets');
  await click('.set-row[data-set="3"] .set-remove');
  await click('.set-row[data-set="1"] .set-remove');
  await click('.set-row[data-set="1"] .set-remove');
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets.length`),3);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(stateKey)).activeSession.exercises[0].sets.length`),3);
  assert.equal(await evaluate(`restDeadline===__rest&&state.activeSession.exercises[0].rir===1`),true);
  assert.equal(await evaluate(`Core.summarizeSession(state.activeSession).completedSets`),3);
  pass('six-to-three removal immediately persists and reconciles totals without resetting rest/RIR');
  await click('.set-undo button');
  assert.deepEqual(await evaluate(`state.activeSession.exercises[0].sets[1]`),await evaluate(`__rows[2]`));
  await click('.set-undo button');
  assert.deepEqual(await evaluate(`state.activeSession.exercises[0].sets[1]`),await evaluate(`__rows[1]`));
  await evaluate(`updateSet(0,0,'weight','82.5');true`);
  await click('.set-undo button');
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets[0].weight`),'82.5');
  assert.deepEqual(await evaluate(`state.activeSession.exercises[0].sets[3]`),await evaluate(`__rows[3]`));
  pass('successive Undo restores exact warm-up/drop/side/time/RIR flags without overwriting later edits');
  await evaluate(`removeActiveSet(0,1);window.__reloadRow=JSON.stringify(__rows[1]);window.__reloadSession=state.activeSession.id;true`);
  const removed=await evaluate(`__rows[1]`),sessionId=await evaluate(`state.activeSession.id`);
  // Page.reload can acknowledge before the old execution context disappears. Do not let an
  // old document's helper/state satisfy the wait and then lose our navigation to the real reload.
  await evaluate(`window.__loggingBeforeReload=true;true`);
  await command('Page.reload');
  await retry(async()=>assert.equal(await evaluate(`!window.__loggingBeforeReload&&document.readyState==='complete'&&typeof undoSetEdit==='function'&&!!state.activeSession`),true));
  assert.equal(await evaluate(`state.activeSession.id`),sessionId);
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets.length`),5);
  await evaluate(`navigate('workout');toggleSetEditing(0);true`);
  await retry(async()=>assert.equal(await evaluate(`!!document.querySelector('#view-workout.active .workout-exercise[data-index="0"] .set-undo button')`),true));
  await click('.workout-exercise[data-index="0"] .set-undo button');
  assert.deepEqual(await evaluate(`state.activeSession.exercises[0].sets[1]`),removed);
  pass('removed row and Undo survive browser reload');

  await evaluate(`addExerciseToWorkout(state.activeSession.exercises[0].exerciseId);window.__originalId=state.activeSession.exercises[0]._logId;window.__duplicateId=state.activeSession.exercises[1]._logId;removeActiveSet(0,2);commitReorder(0,1);undoSetEdit(1);true`);
  assert.equal(await evaluate(`state.activeSession.exercises[0]._logId===__duplicateId&&state.activeSession.exercises[0].sets.length===1&&state.activeSession.exercises[1]._logId===__originalId&&state.activeSession.exercises[1].sets.length===6`),true);
  await evaluate(`addSet(0);updateSet(0,1,'reps','9');undoSetEdit(0);true`);
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets[1].reps`),'9');
  await evaluate(`addSet(0);window.__newRow=state.activeSession.exercises[0].sets.at(-1)._logId;undoSetEdit(0);true`);
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets.some(s=>s._logId===__newRow)`),false);
  await evaluate(`while(state.activeSession.exercises[0].sets.length)removeActiveSet(0,0);true`);
  assert.ok(await evaluate(`!!document.querySelector('.workout-exercise[data-index="0"] .add-set')&&state.activeSession.exercises[0].sets.length===0`));
  await click('.workout-exercise[data-index="0"] .add-set');
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets.length`),1);
  pass('duplicate/reorder isolation; edited additions preserved; zero-row exercise stays usable');

  const active=await evaluate(`JSON.stringify(state.activeSession)`);
  await evaluate(`navigate('train');applyPlan(plans[0].id);closeSheet();navigate('train');setWorkoutGoal(WORKOUT_GOALS[1]);true`);await sleep(250);
  assert.equal(await evaluate(`!!installedPlan()&&!!document.querySelector('.quick-workout-row')&&!!document.querySelector('.quick-workout-shortcut')`),true);
  assert.equal(await evaluate(`document.getElementById('workoutCount').textContent`),await evaluate(`Math.min(TRAIN_LIST_CAP,workouts.filter(w=>w.goal===workoutGoalFilter).length)+' of '+workouts.length`));
  await click('.quick-workout-shortcut');
  assert.equal(await evaluate(`JSON.stringify(state.activeSession)`),active);
  assert.equal(await evaluate(`document.getElementById('sheet').open`),false);
  pass('Quick workout remains under installed plan/filter; both shortcuts preserve active workout');

  const originalProfile=await evaluate(`activeProfileId`);
  await evaluate(`removeActiveSet(1,0);window.__other=Profiles.addProfile(localStorage,'Other QA');commitSwitch(__other.id);startQuickWorkout();closeSheet();addExerciseToWorkout(allExercises()[0].id);undoSetEdit(0);true`);await sleep(250);
  assert.equal(await evaluate(`state.activeSession.exercises[0].sets.length`),1);
  await evaluate(`confirmCancelWorkout();commitSwitch(${JSON.stringify(originalProfile)});navigate('workout');true`);await sleep(250);
  assert.equal(await evaluate(`setEditExercises.size`),0);
  await evaluate(`undoSetEdit(1);true`);
  assert.equal(await evaluate(`state.activeSession.exercises[1].sets.length`),5);
  assert.equal(await evaluate(`state.activeSession._setEdits.stack.length`),0);
  pass('profile switch clears journal/edit mode and Undo never targets another profile');

  await evaluate(`window.__history={id:'logging-history',name:'Historical QA',started:100000,finished:200000,exercises:[{exerciseId:state.activeSession.exercises[1].exerciseId,sets:[{weight:'60',reps:'8',done:true,at:150000,side:'L'},{weight:'60',reps:'7',done:true,at:160000}]}]};state.history=[JSON.parse(JSON.stringify(__history))];openHistoryEdit('logging-history');removeHistorySet(0,0);true`);
  assert.equal(await evaluate(`state.history[0].exercises[0].sets.length`),2);
  await evaluate(`undoHistorySet();editHistorySet(0,1,'weight','62.5');removeHistorySet(0,0);saveHistoryEdit();true`);
  assert.deepEqual(await evaluate(`({id:state.history[0].id,started:state.history[0].started,finished:state.history[0].finished,at:state.history[0].exercises[0].sets[0].at,weight:state.history[0].exercises[0].sets[0].weight})`),{id:'logging-history',started:100000,finished:200000,at:160000,weight:'62.5'});
  await evaluate(`openHistoryEdit('logging-history');removeHistorySet(0,0);openHistory('logging-history');true`);
  assert.equal(await evaluate(`state.history[0].exercises[0].sets.length`),1);
  await evaluate(`closeSheet();navigate('workout');toggleSetEditing(1);removeActiveSet(1,1);true`);await sleep(250);
  pass('historical changes remain draft until Save; Cancel retains history/timestamps');

  await evaluate(`window.__timed=allExercises().find(e=>e.timed).id;addExerciseToWorkout(__timed);state.activeSession.exercises[2].sets=[{weight:'5',reps:'45',done:true,side:'R',warmup:false,drop:true,at:170000}];renderWorkout();window.__hold=JSON.parse(JSON.stringify(state.activeSession.exercises[2].sets[0]));toggleSetEditing(2);removeActiveSet(2,0);undoSetEdit(2);true`);
  assert.deepEqual(await evaluate(`state.activeSession.exercises[2].sets[0]`),await evaluate(`__hold`));
  assert.ok(await evaluate(`document.querySelector('.workout-exercise[data-index="2"] .set-grid.header').textContent.includes('Sec')`));
  await evaluate(`state.activeSession.exercises.splice(2,1);renderWorkout();true`);
  pass('timed set removal restores exact seconds, added load and flags');

  // An older all-time record beats both the last workout and today. The row must name only
  // the recent-session improvement; the receipt must not resurrect legacy fake stored PRs.
  await evaluate(`window.__current=JSON.parse(JSON.stringify(state.activeSession));window.__historySaved=JSON.parse(JSON.stringify(state.history));const id=state.activeSession.exercises[1].exerciseId;state.history=[
    {id:'older-best',started:1000,finished:2000,exercises:[{exerciseId:id,sets:[{weight:'100',reps:'10',done:true}]}]},
    {id:'last-workout',started:3000,finished:4000,exercises:[{exerciseId:id,sets:[{weight:'70',reps:'6',done:true}]}]}];state.activeSession={id:'current-proof',started:5000,name:'PR proof',exercises:[{exerciseId:id,sets:[{weight:'80',reps:'8',done:true}]}]};renderWorkout();true`);
  assert.equal(await evaluate(`document.querySelector('.set-comparison')?.textContent`),'Better than last time');
  assert.equal(await evaluate(`!!document.querySelector('.set-tag')`),false);
  await evaluate(`state.activeSession.prs=[{exerciseId:state.activeSession.exercises[0].exerciseId,weight:80,reps:8,estimated1RM:101}];openReceipt(state.activeSession);true`);
  assert.equal(await evaluate(`document.querySelectorAll('.receipt-pr').length`),0);
  await evaluate(`closeReceipt();state.activeSession=__current;state.history=__historySaved;saveState();navigate('workout');toggleSetEditing(1);true`);
  pass('older all-time best prevents fake logger/receipt PR; recent improvement uses clear words');

  await evaluate(`window.__savedHistory=state.history;const sourceExerciseId=state.activeSession.exercises[1].exerciseId;state.history=[{id:'source-working',started:1000,finished:2000,name:'Working proof',exercises:[{exerciseId:sourceExerciseId,sets:[{weight:'40',reps:'8',done:true},{weight:'100',reps:'30',done:true,warmup:true}]}]},{id:'source-old',started:500,finished:600,name:'Earlier proof',exercises:[{exerciseId:sourceExerciseId,sets:[{weight:'',reps:'8',done:true}]}]}];openHistory('source-working');true`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#sheet .metric')].slice(1).map(el=>[el.querySelector('strong').textContent,el.querySelector('span').textContent])`),[['1','WORKING SETS'],['320','WORKING KG']]);
  assert.ok(await evaluate(`document.querySelector('#sheet .session-warmup-note').textContent.includes('1 warm-up set')&&document.querySelector('#sheet .session-warmup-note').textContent.includes('3.0k')`));
  await evaluate(`openHistory('source-old');true`);
  assert.equal(await evaluate(`!!document.querySelector('#sheet .vol-gap')`),false);
  await evaluate(`state.history=__savedHistory;closeSheet();true`);await sleep(250);
  pass('historical source uses working totals, discloses warm-ups and ignores future load history');

  await evaluate(`window.__memoryHistory=state.history;const memoryId=state.activeSession.exercises[1].exerciseId;state.history=Array.from({length:55},(_,i)=>({id:'recent-memory-'+i,started:10000+i*100,exercises:[{exerciseId:memoryId,sets:[{weight:'40',reps:'8',done:true}]}]}));state.history.push({id:'old-memory-best',started:1000,exercises:[{exerciseId:memoryId,sets:[{weight:'500',reps:'2',done:true,warmup:true},{weight:'50',reps:'8',done:true}]},{exerciseId:memoryId,sets:[{weight:'120',reps:'4',done:true}]}]});renderWorkout();true`);
  const memory=await evaluate(`document.querySelector('.workout-exercise[data-index="1"] .mem-best').textContent`);
  assert.match(memory,/120 kg × 4/);assert.doesNotMatch(memory,/500/);
  await evaluate(`state.history=__memoryHistory;renderWorkout();true`);
  pass('logger memory finds older-than-50 best and duplicate-exercise source; excludes warm-ups');

  // Render/measure the changed states at small-phone widths in each incumbent theme.
  for(const scheme of ['dark','light'])for(const width of [320,390]){
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('receiptOverlay')).display`),'none');
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    await sleep(180);
    await evaluate(`document.getElementById('toast').classList.remove('show');true`);
    const probe=await evaluate(`(()=>{
      const rgb=s=>(s.match(/[0-9.]+/g)||[]).map(Number);
      const blend=(f,b)=>f.slice(0,3).map((v,i)=>v*(f[3]??1)+b[i]*(1-(f[3]??1)));
      const bg=el=>{let list=[];for(let n=el;n;n=n.parentElement)list.push(rgb(getComputedStyle(n).backgroundColor));const base='${scheme}'==='light'?255:0;return list.reverse().reduce((b,f)=>f.length>=3?blend(f,b):b,[base,base,base]);};
      const lumin=c=>{const f=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*f[0]+.7152*f[1]+.0722*f[2];};
      const items=[...document.querySelectorAll('.set-edit-bar button,.set-edit-bar>span,.set-remove small,.set-undo span,.set-undo button')].filter(el=>el.getClientRects().length);
      const clock=document.getElementById('workoutClock').getBoundingClientRect(),volume=document.getElementById('workoutVolumeLine').getBoundingClientRect();
      return {clockSeparated:clock.bottom<=volume.top||clock.right<=volume.left,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,targets:[...document.querySelectorAll('.set-remove,.edit-sets,.set-undo button')].filter(el=>el.getClientRects().length).map(el=>({label:el.textContent.trim(),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})),contrast:items.map(el=>{const b=bg(el),f=blend(rgb(getComputedStyle(el).color),b),a=lumin(f),c=lumin(b);return {text:el.textContent.trim(),ratio:(Math.max(a,c)+.05)/(Math.min(a,c)+.05)};})};
    })()`);
    assert.equal(probe.overflow,false,`${scheme} ${width}: overflow`);
    assert.equal(probe.clockSeparated,true,`${scheme} ${width}: clock and volume overlap`);
    for(const target of probe.targets)assert.ok(target.w>=44&&target.h>=44,`${scheme} ${width}: small ${JSON.stringify(target)}`);
    for(const item of probe.contrast)assert.ok(item.ratio>=4.5,`${scheme} ${width}: low contrast ${JSON.stringify(item)}`);
    await evaluate(`window.scrollTo({top:0,behavior:'instant'});true`);await sleep(120);
    const top=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),topFolder=new URL('../artifacts/design-qa/surfaces/refinement/',import.meta.url);
    mkdirSync(topFolder,{recursive:true});writeFileSync(new URL(`logging-top-${scheme}-${width}.png`,topFolder),Buffer.from(top.result.data,'base64'));
    await evaluate(`(()=>{const card=document.querySelector('.workout-exercise[data-index="1"]');window.scrollTo({top:card.getBoundingClientRect().top+scrollY-document.querySelector('.workout-header').getBoundingClientRect().height-8,behavior:'instant'});})();true`);await sleep(120);
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),folder=new URL('../artifacts/design-qa/surfaces/refinement/',import.meta.url);
    mkdirSync(folder,{recursive:true});writeFileSync(new URL(`logging-edit-${scheme}-${width}.png`,folder),Buffer.from(shot.result.data,'base64'));
  }
  pass('320/390 dark/light edit-mode and Undo contrast, touch sizes, layout, screenshots');
  await evaluate(`finishWorkout();true`);
  assert.equal(await evaluate(`state.activeSession===null&&!state.history[0]._setEdits&&setEditExercises.size===0`),true);
  pass('finish clears active Undo journal');
  console.log(`${checks.length} focused logging checks passed.`);
}finally{socket?.close();chrome.kill();}
