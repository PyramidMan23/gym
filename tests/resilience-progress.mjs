import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE=process.env.DUCK_GYM_URL||'http://127.0.0.1:4174/';
const profile=mkdtempSync(join(tmpdir(),'gym-resilience-progress-'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,`${BASE}?e2e=1`],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn,timeout=14000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{return await fn();}catch(e){last=e;await sleep(80);}}throw last;}
let socket,nextId=0;const pending=new Map();
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},25000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);return r.result?.result?.value;}
async function wait(expression){return retry(async()=>{const value=await evaluate(expression);assert.ok(value,expression);return value;});}
const auditorSource=readFileSync(new URL('./contrast-guard.mjs',import.meta.url),'utf8');
const sweep=new Function('return '+auditorSource.match(/const SWEEP = ([\s\S]*?);\r?\n\r?\nconst failures/)[1])();
const out=new URL('../artifacts/design-qa/surfaces/resilience-progress/',import.meta.url);mkdirSync(out,{recursive:true});
const receipt={checks:[],contrast:[],performance:null};
function checked(name){receipt.checks.push(name);}
async function capture(name,width,height=844,focusSelector=null){
  await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.getAnimations().forEach(a=>{try{if(a.effect.getTiming().iterations!==Infinity)a.finish()}catch{}});window.scrollTo(0,0);true`);
  if(focusSelector)await evaluate(`document.querySelector(${JSON.stringify(focusSelector)}).scrollIntoView({block:'start'});window.scrollBy(0,-78);true`);
  await sleep(100);
  const dimensions=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
  assert.ok(dimensions.scroll<=dimensions.width,`${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
  const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(new URL(`${name}-${width}.png`,out),Buffer.from(shot.result.data,'base64'));
}
async function audit(name){const rows=(await evaluate(sweep)).filter(row=>!row.disabled);const failures=rows.filter(row=>row.ratio<row.bar);receipt.contrast.push({name,samples:rows.length,failures});assert.deepEqual(failures,[],`${name} contrast`);}
async function enterKey(){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
try{
  const port=await retry(()=>readFileSync(join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);
  const tab=await retry(async()=>{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const found=tabs.find(t=>t.type==='page'&&t.url.startsWith(BASE));assert.ok(found);return found;});
  socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(!m.id||!pending.has(m.id))return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m);};
  await command('Runtime.enable');await command('Page.enable');await command('Emulation.setTimezoneOverride',{timezoneId:'Australia/Sydney'});await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait(`document.readyState==='complete'&&typeof hydrateProgressView==='function'`);
  await evaluate(`if(document.getElementById('sheet').open)submitFirstRun('Progress profile A');state.activeSession=null;true`);
  await wait(`!document.getElementById('sheet').open`);
  const defaults=await evaluate(`(()=>{hydrateProgressView({progressView:{tab:'invalid',period:'year',trendRange:'decade',exerciseId:'missing',exerciseMetric:'bogus',activityMetric:'load',historyAll:'true'}});return {tab:progressTab,period:progressKind,range:progressTrendRange,id:strengthPick,metric:strengthMetric,activity:progressActivity,history:progressHistoryAll,anchor:progressAnchor}})()`);
  assert.deepEqual(defaults,{tab:'week',period:'week',range:'3months',id:null,metric:null,activity:'sets',history:false,anchor:null});checked('Invalid and missing preferences fall back safely');
  const durationFixture=await evaluate(`(()=>{
    const preserved=state.history;const started=Date.now()-60000;
    const session=(id,finished)=>({id,name:'Duration '+id,started,...(finished==null?{}:{finished}),exercises:[{exerciseId:'ch1',sets:[{weight:50,reps:5,done:true}]}]});
    const read=()=>[...document.querySelectorAll('#weekPane .progress-summary>div')].find(el=>el.querySelector('span').textContent==='Logged duration').textContent;
    state.history=[session('missing',null)];navigate('progress');renderWeekPane();const allMissing=read();
    state.history.push(session('recorded',started+30000));renderWeekPane();const mixed=read();
    state.history=[session('invalid-duration',started)];renderWeekPane();const invalid=read();
    state.history=[];renderWeekPane();const empty=read();state.history=preserved;renderWeekPane();
    return {allMissing,mixed,invalid,empty};
  })()`);
  assert.match(durationFixture.allMissing,/Not recorded/);assert.doesNotMatch(durationFixture.allMissing,/0min/);
  assert.match(durationFixture.mixed,/1min/);assert.match(durationFixture.mixed,/Recorded total · 1 of 2 sessions unrecorded/);
  assert.match(durationFixture.invalid,/Not recorded/);assert.match(durationFixture.empty,/0min/);
  checked('Overview distinguishes missing or invalid durations, partial recorded totals and an empty period');
  await evaluate(`window.__durationPreserved=state.history;window.__durationStarted=Date.now()-60000;state.history=[{id:'unknown-duration',name:'Synthetic duration',started:__durationStarted,exercises:[{exerciseId:'ch1',sets:[{weight:50,reps:5,done:true}]}]}];renderWeekPane();true`);
  for(const theme of ['light','dark']){
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`state.history=state.history.slice(0,1);renderWeekPane();true`);await capture('unknown-duration-'+theme,320);await audit('unknown-duration-'+theme);
    await evaluate(`state.history.push({...structuredClone(state.history[0]),id:'recorded-duration',finished:__durationStarted+30000});renderWeekPane();true`);await capture('mixed-duration-'+theme,320);await audit('mixed-duration-'+theme);
  }
  await evaluate(`state.history=__durationPreserved;renderWeekPane();true`);
  const boundaries=await evaluate(`(()=>{const key=d=>[d.getFullYear(),d.getMonth()+1,d.getDate()];const may=new Date(2026,4,31,12),march=new Date(2024,2,31,12),leap=new Date(2024,1,29,12);return {three:key(new Date(Core.exerciseTrendWindow('3months',may,may).start)),six:key(new Date(Core.exerciseTrendWindow('6months',march,march).start)),year:key(new Date(Core.exerciseTrendWindow('year',leap,leap).start)),dst:(Core.exerciseTrendWindow('3months',new Date(2026,9,11,12),new Date(2026,9,11,12)).end-Core.exerciseTrendWindow('3months',new Date(2026,9,11,12),new Date(2026,9,11,12)).start)/3600000};})()`);
  assert.deepEqual(boundaries.three,[2026,2,28]);assert.deepEqual(boundaries.six,[2023,9,30]);assert.deepEqual(boundaries.year,[2023,2,28]);assert.equal(boundaries.dst%24,23);checked('Rolling range month clamps, leap years and Sydney DST use local calendar boundaries');
  const fixture=await evaluate(`(()=>{
    window.__progressProfileA=activeProfileId;
    const timed=allExercises().find(e=>e.timed).id,cali=allExercises().find(e=>Core.bodyweightFactor(e.id)!=null&&!e.timed).id;
    const at=n=>{const d=new Date();d.setDate(d.getDate()-n);d.setHours(12,0,0,0);return d.getTime()};
    const s=(id,days,exerciseId,weight,reps)=>({id,name:'Synthetic '+id,started:at(days),finished:at(days)+30*60000,exercises:[{exerciseId,sets:[{weight,reps,done:true}]}]});
    window.__progressSparse=[s('latest',5,'ch1',90,5),s('four-months',125,'ch1',80,5),s('nine-months',270,'ch1',70,5),s('older-year',400,'ch1',110,5),s('hold',5,timed,0,45),s('added-reps',5,cali,10,8)];
    state.history=__progressSparse;state.bodyweight=[{t:at(5),kg:80},{t:at(125),kg:81},{t:at(270),kg:82},{t:at(400),kg:83}];state.goals=[];hydrateProgressView({});saveState();navigate('progress');setProgressTab('trends');pickStrength('ch1');return {timed,cali};
  })()`);
  assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),1);
  assert.equal(await evaluate(`progressBodyweightLog().length`),1);
  assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/1 logged observation/);
  await evaluate(`setProgressTrendRange('6months');true`);assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),2);assert.equal(await evaluate(`progressBodyweightLog().length`),2);
  await evaluate(`setProgressTrendRange('year');true`);assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),3);assert.equal(await evaluate(`progressBodyweightLog().length`),3);checked('Sparse long ranges show only actual observations without inventing sessions or trend judgments');
  await evaluate(`selectStrengthPoint(0,true);true`);assert.equal(await evaluate(`document.querySelector('#strengthTrend .progress-source button').getAttribute('onclick').includes('nine-months')`),true);
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
  assert.equal(await evaluate(`strengthPoint`),2);assert.equal(await evaluate(`document.querySelector('#strengthTrend .progress-source button').getAttribute('onclick').includes('latest')`),true);
  await evaluate(`const slider=document.querySelector('#strengthTrend input[type=range]');slider.value='1';slider.dispatchEvent(new Event('input',{bubbles:true}));true`);assert.equal(await evaluate(`document.querySelector('#strengthTrend .progress-source button').getAttribute('onclick').includes('four-months')`),true);checked('Long-range keyboard and scrub selection preserve exact workout provenance');
  await evaluate(`pickStrength(${JSON.stringify(fixture.timed)});true`);assert.match(await evaluate(`document.getElementById('strengthTrend').textContent`),/45 s/);assert.doesNotMatch(await evaluate(`document.getElementById('strengthTrend').textContent`),/Estimated 1RM/);
  await evaluate(`pickStrength(${JSON.stringify(fixture.cali)});pickStrengthMetric('reps:10');setProgressPeriod('month');setProgressActivity('volume');setProgressTab('records');toggleAllHistory();setProgressTab('trends');setProgressTrendRange('6months');saveState();true`);
  const saved=await evaluate(`JSON.parse(localStorage.getItem(stateKey)).preferences.progressView`);
  assert.equal(saved.tab,'trends');assert.equal(saved.period,'month');assert.equal(saved.trendRange,'6months');assert.equal(saved.exerciseId,fixture.cali);assert.equal(saved.exerciseMetric,'reps:10');assert.equal(saved.activityMetric,'volume');assert.equal(saved.historyAll,true);assert.equal('anchor' in saved,false);
  await command('Page.reload',{ignoreCache:true});await sleep(200);await wait(`document.readyState==='complete'&&typeof renderProgress==='function'&&state.history.length===6`);
  const reloaded=await evaluate(`({tab:progressTab,period:progressKind,range:progressTrendRange,id:strengthPick,metric:strengthMetric,activity:progressActivity,history:progressHistoryAll,anchor:progressAnchor})`);
  assert.deepEqual(reloaded,{tab:'trends',period:'month',range:'6months',id:fixture.cali,metric:'reps:10',activity:'volume',history:true,anchor:null});checked('Per-profile selected tab, range, exercise, metric and history scope survive reload with fresh current dates');
  const profileB=await evaluate(`(()=>{const id=Profiles.addProfile(localStorage,'Progress profile B');commitSwitch(id);return id})()`);
  assert.deepEqual(await evaluate(`({tab:progressTab,period:progressKind,range:progressTrendRange,metric:strengthMetric,history:progressHistoryAll})`),{tab:'week',period:'week',range:'3months',metric:null,history:false});
  await evaluate(`setProgressTab('records');setProgressPeriod('week');saveState();commitSwitch(Profiles.getRegistry(localStorage).profiles.find(p=>p.id!==${JSON.stringify(profileB)}).id);true`);
  assert.equal(await evaluate(`strengthPick`),fixture.cali);assert.equal(await evaluate(`progressTrendRange`),'6months');assert.equal(await evaluate(`progressTab`),'trends');assert.equal(await evaluate(`progressHistoryQuery`),'');checked('Profile switches restore each profile independently without exercise, query or range bleed');
  const performanceInfo=await evaluate(`(()=>{
    window.__resiliencePreserved={history:state.history,bodyweight:state.bodyweight,preferences:structuredClone(state.preferences)};
    const at=n=>{const d=new Date();d.setDate(d.getDate()-n);d.setHours(12,0,0,0);return d.getTime()};
    state.history=Array.from({length:1000},(_,i)=>({id:'large-'+i,name:'Synthetic large workout '+i,started:at(1000-i),finished:at(1000-i)+30*60000,exercises:[{exerciseId:'ch1',sets:[{weight:20+i,reps:6,done:true}]}]}));
    state.bodyweight=[];progressTab='records';progressHistoryAll=true;progressHistoryQuery='';progressHistoryLimit=30;
    const start=performance.now();navigate('progress');const renderMs=performance.now()-start;
    const initial=document.querySelectorAll('#historyList .history-card').length;
    const Original=Intl.DateTimeFormat;let formatterConstructions=0;Intl.DateTimeFormat=function(...args){formatterConstructions++;return new Original(...args)};
    let searchMs;try{const t=performance.now();searchProgressHistory('bench');searchMs=performance.now()-t;}finally{Intl.DateTimeFormat=Original;}
    return {sessions:state.history.length,initial,searchRows:document.querySelectorAll('#historyList .history-card').length,totalText:document.querySelector('#historyList .progress-history-count').textContent,formatterConstructions,renderMs:Math.round(renderMs*100)/100,searchMs:Math.round(searchMs*100)/100};
  })()`);
  assert.equal(performanceInfo.initial,30);assert.equal(performanceInfo.searchRows,30);assert.match(performanceInfo.totalText,/30 of 1000 matching workouts/);assert.equal(performanceInfo.formatterConstructions,0);
  await evaluate(`document.getElementById('progressHistoryMore').focus();true`);await enterKey();assert.equal(await evaluate(`document.querySelectorAll('#historyList .history-card').length`),60);assert.equal(await evaluate(`document.activeElement===document.querySelectorAll('#historyList .history-card')[30]`),true);
  await evaluate(`searchProgressHistory('no-such-workout');true`);assert.equal(await evaluate(`document.querySelectorAll('#historyList .history-card').length`),0);
  await evaluate(`searchProgressHistory('bench');true`);assert.equal(await evaluate(`document.querySelectorAll('#historyList .history-card').length`),30);
  await evaluate(`state.history=__resiliencePreserved.history;state.bodyweight=__resiliencePreserved.bodyweight;state.preferences=__resiliencePreserved.preferences;hydrateProgressView();saveState();navigate('progress');setProgressTab('trends');setProgressTrendRange('year');pickStrength('ch1');true`);
  receipt.performance=performanceInfo;console.log('Long-history browser timing (informational): '+JSON.stringify(performanceInfo));checked('1000-workout All history and exercise search are bounded to30 rows; expansion and fresh search preserve keyboard usability');
  await evaluate(`document.getElementById('toast').classList.remove('show');true`);
  for(const theme of ['light','dark']){
    await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    for(const width of [320,390,768]){await capture('year-trends-'+theme,width);await capture('year-trend-chart-'+theme,width,844,'#strengthTrend');await audit('year-'+theme+'-'+width);}
    await evaluate(`document.querySelector('#strengthTrend details').open=true;window.__scaledProgressFonts=[...document.querySelectorAll('#view-progress button,#view-progress select,#view-progress input,#view-progress p,#view-progress small,#view-progress strong,#view-progress summary,#view-progress th,#view-progress td,#view-progress span,#view-progress text,#view-progress h1,#view-progress h2,#view-progress h3')].map(el=>({el,previous:el.style.fontSize,original:parseFloat(getComputedStyle(el).fontSize)}));__scaledProgressFonts.forEach(({el,original})=>el.style.fontSize=(original*1.3)+'px');true`);await capture('year-large-text-'+theme,320,960,'#strengthTrend');await audit('large-text-'+theme);assert.equal(await evaluate(`[...document.querySelectorAll('#strengthTrend svg text')].every(el=>{const b=el.getBBox();return b.x>=0&&b.x+b.width<=340})`),true,'Large-text chart labels stay inside the SVG');await evaluate(`__scaledProgressFonts.forEach(({el,previous})=>el.style.fontSize=previous);true`);
  }
  await evaluate(`state.history=[];state.bodyweight=[];hydrateProgressView({});setProgressTab('trends');true`);await capture('empty-long-trends',390);assert.equal(await evaluate(`document.querySelectorAll('#strengthTrend .progress-point').length`),0);checked('Empty profile remains concise without fake observations');
  writeFileSync(new URL('receipt.json',out),JSON.stringify(receipt,null,2));console.log('Progress resilience passed: '+receipt.checks.length+' checks, both themes320/390/768, large text, contrast and bounded1000-workout history.');
}finally{if(socket)socket.close();chrome.kill();await sleep(300);try{rmSync(profile,{recursive:true,force:true});}catch{}}
