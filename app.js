'use strict';

const Core = DuckGymCore;
const Coach = (typeof DuckGymCoach !== 'undefined') ? DuckGymCoach : null;
const Sync = (typeof DuckGymSync !== 'undefined') ? DuckGymSync : null;
const STORE_KEY = 'duckGymV2';
const DAY = 86400000;
let currentView = 'today';
let muscleFilter = 'All';
let activeTimer = null;
let restTimer = null;
let restRemaining = 0;
let routineDraft = null;
let pickerTarget = null;
let deferredInstall = null;

const templates = (typeof GYM_TEMPLATES!=='undefined') ? GYM_TEMPLATES : [];
const plans = (typeof GYM_PLANS!=='undefined') ? GYM_PLANS : [];

function emptyState(){ return {version:2,routines:[],history:[],customExercises:[],activeSession:null,exerciseCues:{},preferences:{restSeconds:90,weeklyWorkoutGoal:4,weeklySetGoal:48,weeklyVolumeGoal:10000}}; }
function readState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORE_KEY));
    if(saved?.version===2){
      const preferences={...emptyState().preferences,...saved.preferences,...Core.normalizeActivityGoals(saved.preferences)};
      return {...emptyState(),...saved,preferences};
    }
  }catch{}
  const legacy={dg_workouts:localStorage.getItem('dg_workouts'),dg_history:localStorage.getItem('dg_history'),dg_custom:localStorage.getItem('dg_custom')};
  const migrated=Core.migrateLegacy(legacy);
  migrated.preferences={...migrated.preferences,...Core.normalizeActivityGoals(migrated.preferences)};
  return migrated;
}
let state=readState();
function saveState(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(state));return true;}
  catch(error){console.error('Duck Gym could not persist state',error);showToast('Could not save — browser storage is full');return false;}
}
function allExercises(){ return [...DUCK_EXERCISES,...state.customExercises]; }
function exerciseById(id){ return allExercises().find(exercise=>exercise.id===id); }
function esc(value){ return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function compact(number){ const n=Number(number)||0; return n>=1e6?(n/1e6).toFixed(1)+'m':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n)); }
function formatDate(timestamp){ return new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'}).format(new Date(timestamp)); }
function showToast(message,isPr=false){ const el=document.getElementById('toast');el.textContent=message;el.classList.toggle('pr',isPr);el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),isPr?2600:1900); }
const REDUCED_MOTION=matchMedia('(prefers-reduced-motion: reduce)').matches;
// Number roll: old span slides up, new span slides in — transform/opacity only, gated on reduced-motion.
function rollNumber(el,newText){
  newText=String(newText);
  const current=el.dataset.val;
  if(current===newText)return;
  el.dataset.val=newText;
  if(REDUCED_MOTION||current==null){el.textContent=newText;return;}
  el.innerHTML=`<span class="roll-mask"><span class="roll-old">${esc(current)}</span><span class="roll-new">${esc(newText)}</span></span>`;
  const mask=el.firstChild;
  requestAnimationFrame(()=>mask.classList.add('go'));
  clearTimeout(el._roll);el._roll=setTimeout(()=>{el.textContent=newText;},260);
}
// One earned line from real state only — no canned encouragement, no exclamation marks.
function contextLine(){
  const s=state.activeSession;
  if(s&&currentView!=='workout'){
    const done=s.exercises.reduce((n,ex)=>n+ex.sets.filter(x=>x.done).length,0);
    return `Workout running. ${done} sets logged.`;
  }
  if(s&&currentView==='workout'){
    for(const ex of s.exercises){
      const conf=Core.lastConfirmedExposure(state.history,ex.exerciseId);
      if(conf&&conf.topWeight){
        const top=Math.max(0,...ex.sets.filter(x=>x.done).map(x=>Number(x.weight)||0));
        if(top>conf.topWeight)return `Above your last confirmed load on ${exerciseById(ex.exerciseId)?.name||'this lift'}.`;
      }
    }
    // A pending set only counts as planned once it has data — the auto-added trailing set doesn't block "all complete".
    const planned=s.exercises.reduce((n,ex)=>n+ex.sets.filter(x=>x.done||x.weight!==''||x.reps!=='').length,0);
    const done=s.exercises.reduce((n,ex)=>n+ex.sets.filter(x=>x.done).length,0);
    const remaining=planned-done;
    if(planned&&remaining<=0)return 'All sets complete. Finish when ready.';
    return `${remaining} set${remaining===1?'':'s'} left.`;
  }
  if(!state.history.length)return 'First session starts the record.';
  const last=state.history[0],prs=last.prs?.length??last.prs??0;
  if(prs)return `Last session set ${prs} PR${prs===1?'':'s'}.`;
  const weekly=Core.weeklyStats(state.history);
  return `Last session ${formatDate(last.started)}. ${weekly.workouts} this week.`;
}
function animateNumbers(scope){
  if(!scope)return;
  scope.querySelectorAll('[data-count]').forEach(el=>{
    const target=Number(el.dataset.count)||0;
    const fmt=el.dataset.fmt==='compact'?compact:(v=>String(Math.round(v)));
    if(REDUCED_MOTION||!target){el.textContent=fmt(target);return;}
    const start=performance.now(),duration=650;
    const step=now=>{const k=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-k,3);el.textContent=fmt(target*eased);if(k<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  });
}

function navigate(view){
  if(state.activeSession&&view!=='workout'&&!confirm('Leave the workout screen? Your workout will keep running.')) return;
  currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.bottom-nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const navIdx={today:0,train:1,library:2,progress:3}[view];
  const navCursor=document.getElementById('navCursor');
  if(navCursor&&navIdx!=null)navCursor.style.transform=`translateX(${navIdx*100}%)`;
  document.body.classList.toggle('workout-active',view==='workout');
  renderView(view);
  window.scrollTo(0,0);
  document.getElementById('main').focus({preventScroll:true});
}
function renderView(view){
  if(view==='today')renderToday();
  if(view==='train')renderTrain();
  if(view==='library')renderLibrary();
  if(view==='progress')renderProgress();
  if(view==='workout')renderWorkout();
}

function renderToday(){
  const hour=new Date().getHours();
  document.getElementById('todayKicker').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
  document.getElementById('todayTitle').textContent=hour<12?'Morning.':hour<18?'Ready to train?':'Let’s finish strong.';
  document.getElementById('todayPrompt').textContent=contextLine();
  const weekly=Core.weeklyStats(state.history);
  renderCoach();
  renderActivityRings(weekly);
  renderWeekDots();
  document.getElementById('resumeSlot').innerHTML=state.activeSession?`<div class="resume-card"><strong>Workout in progress</strong><p>${esc(state.activeSession.name)} · started ${formatElapsed(state.activeSession.started)} ago</p><button onclick="resumeWorkout()">Resume workout</button></div>`:'';
  const routines=state.routines.slice(0,4);
  document.getElementById('todayRoutines').innerHTML=routines.length?routines.map(routineCard).join(''):`<div class="empty-card card"><strong>No routines yet</strong>Start an empty workout or save one from the Train tab.</div>`;
  document.getElementById('recentSession').innerHTML=state.history.length?historyCard(state.history[0]):`<div class="empty-card card"><strong>No sessions logged</strong>Your first completed workout will land here.</div>`;
}
function renderActivityRings(weekly){
  const goals=state.preferences;
  const rings=[
    {...Core.ringProgress(weekly.workouts,goals.weeklyWorkoutGoal),key:'workouts',label:'Workouts'},
    {...Core.ringProgress(weekly.completedSets,goals.weeklySetGoal),key:'sets',label:'Sets'},
    {...Core.ringProgress(weekly.volume,goals.weeklyVolumeGoal),key:'volume',label:'Volume'}
  ];
  const R=42,C=2*Math.PI*R,ARC=0.75*C;// 270deg gauge, gap at bottom
  const score=Math.round(rings.reduce((sum,ring)=>sum+ring.ratio,0)/rings.length*100);
  const message=Core.activityMessage(score/100);
  const card=document.querySelector('.activity-card');
  card.classList.toggle('complete',score>=100);
  document.getElementById('activityTitle').textContent=message.title;
  document.getElementById('activityDetail').textContent=message.detail;
  const fmt=ring=>ring.key==='volume'?compact(ring.value):ring.value;
  const fmtGoal=ring=>ring.key==='volume'?compact(ring.goal):ring.goal;
  document.getElementById('activityRings').innerHTML=rings.map(ring=>`<div class="arc-gauge"><svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(135 50 50)"><circle class="arc-track" cx="50" cy="50" r="${R}" style="stroke-dasharray:${ARC} ${C}"></circle><circle class="arc-fill arc-fill-${ring.key}" data-offset="${ARC*(1-ring.ratio)}" cx="50" cy="50" r="${R}" style="stroke-dasharray:${ARC} ${C};stroke-dashoffset:${REDUCED_MOTION?ARC*(1-ring.ratio):ARC}"></circle></g></svg><div class="arc-value"><strong data-count="${ring.value}" ${ring.key==='volume'?'data-fmt="compact"':''}>0</strong><b>/ ${fmtGoal(ring)}</b></div><span class="arc-label">${ring.label}</span></div>`).join('');
  if(!REDUCED_MOTION)requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelectorAll('#activityRings .arc-fill').forEach(el=>{el.style.strokeDashoffset=el.dataset.offset;})));
  animateNumbers(document.getElementById('activityRings'));
  document.getElementById('activityRings').setAttribute('aria-label',`Weekly activity: ${weekly.workouts} of ${goals.weeklyWorkoutGoal} workouts, ${weekly.completedSets} of ${goals.weeklySetGoal} sets, ${Math.round(weekly.volume)} of ${goals.weeklyVolumeGoal} kilograms volume`);
  document.getElementById('activityLegend').innerHTML='';
}
function renderWeekDots(){
  const now=new Date(),monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(now.getDate()-((now.getDay()+6)%7));
  const completed=new Set(state.history.map(s=>{const d=new Date(s.started);d.setHours(0,0,0,0);return d.getTime()}));
  document.getElementById('weekDots').innerHTML=['M','T','W','T','F','S','S'].map((label,index)=>{const date=new Date(monday.getTime()+index*DAY);return `<span class="day-dot ${completed.has(date.getTime())?'done':''} ${date.toDateString()===now.toDateString()?'today':''}"><i></i><small>${label}</small></span>`}).join('');
}
function routineCard(routine){
  const names=routine.exerciseIds.map(id=>exerciseById(id)?.name).filter(Boolean);
  return `<article class="routine-card"><div><h3>${esc(routine.name)}</h3><p>${names.length} exercises${names.length?' · '+esc(names.slice(0,2).join(', ')):''}</p></div><div class="routine-actions"><button class="routine-menu" onclick="openRoutineMenu('${routine.id}')" aria-label="Routine options">•••</button><button class="routine-start" onclick="startRoutine('${routine.id}')">Start</button></div></article>`;
}
function historyCard(session){
  const summary=Core.summarizeSession(session),prs=session.prs?.length??session.prs??0;
  return `<button class="history-card" onclick="openHistory('${session.id}')"><span class="history-top"><span><h3>${esc(session.name)}</h3><time>${formatDate(session.started)}</time></span><span>›</span></span><span class="history-meta"><span>${summary.durationMinutes} min</span><span>${summary.completedSets} sets</span><span>${compact(summary.volume)} kg</span>${prs?`<span class="pr-badge notched">${prs} PR${prs===1?'':'s'}</span>`:''}</span></button>`;
}

// Coach surface (Today): one active source only — remote "Coach's block" when a plan validates,
// otherwise the local ramp. A superseded/rejected remote plan is shown but never startable.
const RETURN_RAMP=plans.find(p=>p.id==='plan-return');
function coachContext(){
  if(!Coach)return null;
  const isKnown=id=>!!exerciseById(id);
  const rawPlan=Sync?Sync.getPlan():null;
  const beighton=Sync?Sync.getBeighton():false;
  let verdict=null;
  // Any throw from an untrusted stored plan must never break Today: fall back to the
  // local ramp AND clear the poisoned plan so the app isn't broken on every launch.
  try{
    if(rawPlan)verdict=Coach.validatePlan(rawPlan,{history:state.history,beightonUnlocked:beighton,isKnown});
    // Unreadable = can never become usable → clear it (capability-rejected plans stay: Beighton unlock can revive them).
    if(verdict&&verdict.code==='unreadable'&&Sync)try{Sync.clearPlan();}catch{}
    if(verdict&&verdict.status==='usable'){
      const suggestion=Coach.coachSession(rawPlan,state.history,isKnown);
      return {source:'coach',label:"Coach’s block",plan:rawPlan,suggestion,provenance:planProvenance(rawPlan,verdict),verdict};
    }
  }catch(error){
    console.warn('Coach plan unusable — cleared',error);
    if(Sync)try{Sync.clearPlan();}catch{}
    verdict={status:'rejected',reason:'The stored plan could not be read — using safe local programming.'};
  }
  // Local ramp fallback (also the default when there's no plan at all).
  const confirmedFor=id=>Core.lastConfirmedExposure(state.history,id);
  const suggestion=RETURN_RAMP?Coach.localSession(state.history,RETURN_RAMP.days,{confirmedFor}):null;
  const superseded=verdict&&verdict.status!=='usable'?verdict.reason:'';
  return {source:'local',label:'Local ramp',suggestion,provenance:'Joint-friendly Return Ramp · safe local programming',superseded};
}
function planProvenance(plan,verdict){
  const total=Number.isFinite(plan.expiresAfterSessions)?plan.expiresAfterSessions:Coach.DEFAULT_EXPIRES;
  const remaining=Math.max(0,total-verdict.postCount);
  // Plain text — renderCoach esc()'s the whole provenance line once.
  return `Based through session ${String(plan.basedThroughSessionId||'—')} · ${remaining} session${remaining===1?'':'s'} remaining`;
}
function renderCoach(){
  const slot=document.getElementById('coachSlot');if(!slot)return;
  const ctx=coachContext();
  if(!ctx||!ctx.suggestion){slot.innerHTML='';return;}
  const s=ctx.suggestion;
  // Plan JSON is untrusted (comes from Drive): every plan-derived string goes through esc(),
  // numbers through Coach.doseLine (finite-or-nothing) — a hostile field renders inert.
  const names=s.exercises.map(e=>{const item=exerciseById(e.exerciseId);return item?esc(item.name):`${esc(e.exerciseId)} (skipped — not in library)`;});
  const line=e=>{const d=esc(Coach.doseLine(e));return d?` · ${d}`:'';};
  const list=s.exercises.slice(0,6).map((e,i)=>`<li${exerciseById(e.exerciseId)?'':' class="coach-skip"'}>${names[i]}${line(e)}</li>`).join('');
  const sync=Sync?Sync.status():{configured:false,queued:0,lastSyncAt:null};
  const syncLine=sync.configured
    ?`${sync.connected?'Synced':'Sync pending'}${sync.lastSyncAt?' · '+formatDate(sync.lastSyncAt):''}${sync.queued?` · ${sync.queued} queued`:''}`
    :`Not connected${sync.queued?` · ${sync.queued} queued`:''}`;
  slot.innerHTML=`<section class="coach-card card" aria-label="Training coach">
    <div class="coach-top"><p class="kicker">${ctx.source==='coach'?'COACH’S BLOCK':'LOCAL RAMP'}</p>${s.stepDown?'<span class="coach-flag notched">Step-down</span>':''}</div>
    <h2>${esc(s.title)}</h2>
    ${ctx.superseded?`<p class="coach-superseded">${esc(ctx.superseded)}</p>`:''}
    <ul class="coach-list">${list}</ul>
    <p class="coach-prov">${esc(ctx.provenance)}</p>
    <button class="primary-button full-button" onclick="startCoachSession()">Start ${esc(s.title)}</button>
    <div class="coach-sync"><span>${esc(syncLine)}</span>${sync.configured?'':`<button class="text-button" onclick="exportLastSession()">Export session</button>`}</div>
  </section>`;
}
function startCoachSession(){
  // Re-derives the context, so a superseded/rejected plan can never be started from a stale card.
  const ctx=coachContext();if(!ctx||!ctx.suggestion)return;
  const usable=ctx.suggestion.exercises.filter(e=>exerciseById(e.exerciseId));
  if(!usable.length)return showToast('No usable exercises in this session');
  if(state.activeSession){showToast('You already have a workout running');navigate('workout');return;}
  const session=Core.createSession({id:null,name:ctx.suggestion.title,exerciseIds:usable.map(e=>e.exerciseId)});
  // Pre-fill the prescription: N set rows with prescribed reps + load (load only when finite), cue → notes.
  session.exercises.forEach((exercise,i)=>{
    const rx=usable[i];
    const count=Math.min(10,Math.max(1,Coach.safeNum(rx.sets)||1));
    const reps=Coach.safeNum(rx.reps),load=Coach.safeNum(rx.load);
    exercise.sets=Array.from({length:count},()=>({weight:load!==null?String(load):'',reps:reps!==null?String(reps):'',done:false}));
    if(typeof rx.cue==='string'&&rx.cue)exercise.notes=rx.cue;
  });
  session.checkin={pre:null,post:null}; // same three-touch safety loop as beginSession
  state.activeSession=session;
  saveState();navigate('workout');
}
function exportLastSession(){
  if(!Sync)return;
  const last=state.activeSession||state.history[0];
  if(!last)return showToast('No session to export yet');
  Sync.exportSession(last);
}

function renderTrain(){
  document.getElementById('planList').innerHTML=plans.map(p=>`<button class="template-card plan-card" onclick="openPlan('${p.id}')"><span>${esc(p.tag)}</span><strong>${esc(p.name)}</strong><small>${esc(p.blurb)}</small></button>`).join('');
  document.getElementById('routineList').innerHTML=state.routines.length?state.routines.map(routineCard).join(''):`<div class="empty-card card"><strong>Your routines live here</strong>Build one once, or add a plan above.</div>`;
  document.getElementById('templateList').innerHTML=templates.map(t=>`<button class="template-card" onclick="startTemplate('${t.id}')"><span>${t.label}</span><strong>${t.name}</strong><small>${t.exerciseIds.length} exercises · start now</small></button>`).join('');
}
function startTemplate(id){ const template=templates.find(t=>t.id===id);if(template)beginSession(template); }
function startRoutine(id){ const routine=state.routines.find(r=>r.id===id);if(routine)beginSession(routine); }
function startQuickWorkout(){ beginSession({id:null,name:'Quick workout',exerciseIds:[]}); }
function beginSession(routine){
  if(state.activeSession){showToast('You already have a workout running');navigate('workout');return;}
  state.activeSession=Core.createSession(routine);
  state.activeSession.checkin={pre:null,post:null}; // three-touch safety loop (council 2026-07-18)
  saveState();navigate('workout');
}
function resumeWorkout(){ navigate('workout'); }
function openPlan(id){
  const plan=plans.find(p=>p.id===id);if(!plan)return;
  const dayList=plan.days.map((d,i)=>`<div class="selected-row"><span><strong>${i+1}. ${esc(d.name)}</strong><small style="display:block;color:var(--muted)">${d.exerciseIds.map(x=>esc(exerciseById(x)?.name||x)).join(' · ')}</small></span></div>`).join('');
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">TRAINING PLAN · ${esc(plan.tag)}</p><h2>${esc(plan.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><p style="color:var(--muted);margin-top:-6px">${esc(plan.note)}</p><div class="selected-list">${dayList}</div><div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="applyPlan('${plan.id}')">Add ${plan.days.length} routines</button></div>`;
  document.getElementById('sheet').showModal();
}
function applyPlan(id){
  const plan=plans.find(p=>p.id===id);if(!plan)return;
  const stamp=Date.now();
  plan.days.forEach((d,i)=>state.routines.unshift({id:`r${stamp}_${i}`,name:`${plan.name} · ${d.name}`,exerciseIds:[...d.exerciseIds]}));
  state.preferences.weeklyWorkoutGoal=Math.min(14,Math.max(Number(state.preferences.weeklyWorkoutGoal)||0,plan.goal||plan.days.length));
  saveState();closeSheet();renderTrain();renderToday();showToast(`${plan.name} added — ${plan.days.length} routines ready`);
}

function renderLibrary(){
  const search=(document.getElementById('librarySearch')?.value||'').trim().toLowerCase();
  const groups=['All',...new Set(allExercises().map(e=>e.muscle))];
  document.getElementById('muscleFilters').innerHTML=groups.map(group=>`<button class="filter-chip ${muscleFilter===group?'active':''}" onclick="setMuscleFilter('${esc(group)}')">${esc(group)}</button>`).join('');
  const list=allExercises().filter(e=>(muscleFilter==='All'||e.muscle===muscleFilter)&&`${e.name} ${e.equipment} ${e.muscle}`.toLowerCase().includes(search));
  document.getElementById('libraryCount').textContent=`${list.length} exercise${list.length===1?'':'s'}${search?' found':''}`;
  document.getElementById('exerciseLibrary').innerHTML=list.length?list.map(exerciseRow).join(''):`<div class="empty-card card"><strong>Nothing found</strong>Try another exercise, muscle or equipment name.</div>`;
}
function exerciseRow(exercise,addAction='quickExercise'){ return `<article class="exercise-row"><div><strong>${esc(exercise.name)}</strong><small>${esc(exercise.muscle)} · ${esc(exercise.equipment||'Custom equipment')}</small></div><button class="exercise-add" onclick="${addAction}('${exercise.id}')" aria-label="Add ${esc(exercise.name)}">+</button></article>`; }
function setMuscleFilter(group){muscleFilter=group;renderLibrary();}
function quickExercise(id){
  if(state.activeSession){addExerciseToWorkout(id);showToast('Added to current workout');return;}
  const exercise=exerciseById(id);beginSession({id:null,name:exercise?.name||'Quick workout',exerciseIds:[id]});
}

function renderProgress(){
  const weekly=Core.weeklyStats(state.history),lifetimeVolume=state.history.reduce((sum,s)=>sum+Core.calculateVolume(s),0);
  document.getElementById('progressStats').innerHTML=`<div class="metric"><strong data-count="${weekly.workouts}">0</strong><span>WORKOUTS THIS WEEK</span></div><div class="metric"><strong data-count="${state.history.length}">0</strong><span>TOTAL SESSIONS</span></div><div class="metric"><strong data-count="${Math.round(lifetimeVolume)}" data-fmt="compact">0</strong><span>LIFETIME KG</span></div>`;
  animateNumbers(document.getElementById('progressStats'));
  renderStrength();
  renderWeekChart();
  renderPrFeed();
  document.getElementById('historyList').innerHTML=state.history.length?state.history.map(historyCard).join(''):`<div class="empty-card card"><strong>Your progress starts at one</strong>Finish a workout and it will appear here.</div>`;
}
// Strength trend — evidence-gated (council 2026-07-18): a lift unlocks its chart after 3 logged sessions.
const TREND_UNLOCK=3;
let strengthPick=null;
function renderStrength(){
  const exposures=Core.exerciseExposures(state.history);
  const entries=Object.entries(exposures).map(([id,count])=>({id,count,item:exerciseById(id)})).filter(e=>e.item).sort((a,b)=>b.count-a.count);
  const unlocked=entries.filter(e=>e.count>=TREND_UNLOCK);
  const pickerEl=document.getElementById('strengthPicker'),trendEl=document.getElementById('strengthTrend');
  if(!unlocked.length){
    pickerEl.innerHTML='';
    const top=entries[0],done=top?Math.min(top.count,TREND_UNLOCK):0,need=TREND_UNLOCK-done;
    trendEl.innerHTML=`<div class="locked-card card"><strong>${top?`${need} more session${need===1?'':'s'} of ${esc(top.item.name)}`:'Your strength trend unlocks here'}</strong>${top?'unlocks its strength trend.':`Log the same lift ${TREND_UNLOCK} times and the chart appears.`}<div class="lock-progress">${[0,1,2].map(i=>`<i class="${i<done?'full':''}"></i>`).join('')}</div></div>`;
    return;
  }
  if(!unlocked.some(e=>e.id===strengthPick))strengthPick=unlocked[0].id;
  pickerEl.innerHTML=unlocked.slice(0,12).map(e=>`<button class="filter-chip ${e.id===strengthPick?'active':''}" onclick="pickStrength('${e.id}')">${esc(e.item.name)}</button>`).join('');
  trendEl.innerHTML=trendChart(Core.exerciseTrend(state.history,strengthPick),exerciseById(strengthPick)?.name||'');
}
function pickStrength(id){strengthPick=id;renderStrength();}
function trendChart(points,name){
  if(points.length<2)return `<div class="locked-card card"><strong>Almost there</strong>One more session of ${esc(name)} draws the line.</div>`;
  const W=340,H=160,PL=36,PR=12,PT=16,PB=26,IW=W-PL-PR,IH=H-PT-PB;
  const xs=points.map(p=>p.started),ys=points.map(p=>p.e1rm);
  const minX=xs[0],maxX=xs.at(-1)||minX+1;
  let lo=Math.min(...ys),hi=Math.max(...ys);
  if(hi-lo<2){lo-=2;hi+=2;} const pad=(hi-lo)*0.12;lo=Math.max(0,lo-pad);hi+=pad;
  const X=t=>PL+(maxX===minX?IW/2:(t-minX)/(maxX-minX)*IW);
  const Y=v=>PT+IH-(v-lo)/(hi-lo)*IH;
  const line=points.map((p,i)=>`${i?'L':'M'}${X(p.started).toFixed(1)} ${Y(p.e1rm).toFixed(1)}`).join(' ');
  const area=`${line} L${X(maxX).toFixed(1)} ${(PT+IH).toFixed(1)} L${X(minX).toFixed(1)} ${(PT+IH).toFixed(1)} Z`;
  const ticks=[0,.5,1].map(k=>{const v=lo+(hi-lo)*(1-k),y=PT+IH*k;return `<line class="trend-grid-line" x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}"/><text class="trend-tick" x="${PL-6}" y="${y+3}" text-anchor="end">${Math.round(v)}</text>`;}).join('');
  const dots=points.map(p=>`<circle class="trend-dot" cx="${X(p.started).toFixed(1)}" cy="${Y(p.e1rm).toFixed(1)}" r="3.4"/>`).join('');
  const shortDate=t=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short'}).format(new Date(t));
  const latest=ys.at(-1),delta=Math.round((latest-ys[0])*10)/10;
  return `<div class="trend-card"><div class="trend-head"><strong>${esc(name)}</strong><span>${latest} kg est. 1RM${delta?` · ${delta>0?'+':''}${delta} kg`:''}</span></div><svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated one rep max trend for ${esc(name)}"><defs><linearGradient id="trendFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(224,110,31,.26)"/><stop offset="1" stop-color="rgba(224,110,31,0)"/></linearGradient></defs>${ticks}<path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${dots}<text class="trend-tick" x="${PL}" y="${H-8}">${shortDate(minX)}</text><text class="trend-tick" x="${W-PR}" y="${H-8}" text-anchor="end">${shortDate(maxX)}</text></svg></div>`;
}
function renderPrFeed(){
  const feed=Core.prFeed(state.history,8);
  document.getElementById('prFeed').innerHTML=feed.length?feed.map(pr=>{
    const item=exerciseById(pr.exerciseId);
    const parts=[pr.weight?`${pr.weight} kg top set`:'',pr.estimated1RM?`${pr.estimated1RM} kg est. 1RM`:''].filter(Boolean).join(' · ')||'New best';
    return `<div class="pr-row"><span class="pr-mark notched">PR</span><span><strong>${esc(item?.name||'Exercise')}</strong><small>${parts}</small></span><time>${formatDate(pr.started)}</time></div>`;
  }).join(''):`<div class="empty-card card"><strong>No records yet</strong>Beat a previous best and it lands here automatically.</div>`;
}
function renderWeekChart(){
  const now=Date.now(),weeks=[];
  for(let i=7;i>=0;i--){const end=now-i*7*DAY,start=end-7*DAY,count=state.history.filter(s=>s.started>start&&s.started<=end).length;weeks.push({count,label:i?'−'+i:'Now'});}
  const max=Math.max(1,...weeks.map(w=>w.count));
  document.getElementById('weekChart').innerHTML=weeks.map((week,index)=>`<span class="bar-col ${index===7?'active':''}"><i style="height:${Math.max(4,week.count/max*100)}%" title="${week.count} workouts"></i><small>${week.label}</small></span>`).join('');
}

function renderWorkout(){
  const session=state.activeSession;if(!session){navigate('today');return;}
  document.getElementById('workoutTitle').textContent=session.name;
  renderWorkoutMetrics();
  document.getElementById('workoutExercises').innerHTML=checkinMarkup(session)+(session.exercises.length?session.exercises.map(workoutExerciseMarkup).join(''):`<div class="empty-card card"><strong>Empty workout</strong>Add your first exercise and get moving.</div>`);
  startActiveClock();
}
// Three-touch safety loop: pre-session 0–10, next-session flare yes/no. Optional, skippable — friction kills habits.
function checkinMarkup(session){
  if(!session.checkin||session.checkin.dismissed)return '';
  const last=state.history[0],askFlare=Boolean(last?.checkin&&last.checkin.flare==null);
  const askPre=session.checkin.pre==null;
  if(!askPre&&!askFlare)return '';
  const scale=askPre?`<p>How is the problem area today?<small>0 = nothing, 10 = worst. Optional.</small></p><div class="checkin-scale">${Array.from({length:11},(_,n)=>`<button onclick="setPreCheckin(${n})" aria-label="Rate ${n} out of 10">${n}</button>`).join('')}</div>`:'';
  const flare=askFlare?`<div class="checkin-row" style="margin-top:${askPre?'12px':'0'}"><button onclick="setFlare(false)">No flare since last session</button><button onclick="setFlare(true)">Had a flare</button></div>`:'';
  return `<div class="checkin-card" id="checkinCard">${scale}${flare}<button class="checkin-skip" onclick="dismissCheckin()">Skip</button></div>`;
}
function setPreCheckin(n){state.activeSession.checkin.pre=n;saveState();renderWorkout();if(n>=7)showToast('Noted. Keep loads easy today.');}
function setFlare(had){
  const last=state.history[0];if(last?.checkin)last.checkin.flare=had;
  saveState();renderWorkout();
  if(had)showToast('Logged. Add a note on any exercise that felt off.');
}
function dismissCheckin(){
  const session=state.activeSession;if(!session?.checkin)return;
  session.checkin.dismissed=true;
  const last=state.history[0];if(last?.checkin&&last.checkin.flare==null)last.checkin.flare='skipped';
  saveState();renderWorkout();
}
function renderWorkoutMetrics(){
  const session=state.activeSession;if(!session)return;
  const summary=Core.summarizeSession({...session,finished:Date.now()});
  const values=[String(summary.completedSets),compact(summary.volume),String(session.exercises.length)];
  const labels=['Sets done','Volume kg','Exercises'];
  const wrap=document.getElementById('workoutMetrics');
  let strongs=wrap.querySelectorAll('.live-metric strong');
  if(strongs.length!==3){
    wrap.innerHTML=values.map((v,i)=>`<div class="live-metric"><strong>${esc(v)}</strong><small>${labels[i]}</small></div>`).join('');
    strongs=wrap.querySelectorAll('.live-metric strong');
    strongs.forEach((el,i)=>el.dataset.val=values[i]);
  }else{
    strongs.forEach((el,i)=>rollNumber(el,values[i]));
  }
  const ctx=document.getElementById('workoutContext');
  if(ctx)ctx.textContent=contextLine();
}
function workoutExerciseMarkup(exercise,index){
  const item=exerciseById(exercise.exerciseId),previous=Core.previousPerformance(state.history,exercise.exerciseId);
  const prevText=previous.length?`Last time: ${previous.slice(0,3).map(s=>`${s.weight||'—'} kg × ${s.reps}`).join(' · ')}`:'First time — set your benchmark';
  // Neutral facts only — the app never prescribes a dose (council 2026-07-18).
  const confirmed=Core.lastConfirmedExposure(state.history,exercise.exerciseId);
  const confirmedText=confirmed?`Confirmed tolerated ${formatDate(confirmed.started)}: ${confirmed.topWeight||'—'} kg · ${confirmed.topReps} reps · ${confirmed.setCount} set${confirmed.setCount===1?'':'s'}`:(previous.length?'No confirmed-tolerated baseline yet (check-ins pending)':'');
  const cue=state.exerciseCues?.[exercise.exerciseId];
  return `<article class="workout-exercise"><header class="exercise-head"><div><h2>${esc(item?.name||'Exercise')}</h2><p>${esc(item?.equipment||'')}</p></div><button class="exercise-more" onclick="openWorkoutExerciseMenu(${index})" aria-label="Exercise options">•••</button></header>${cue?.text?`<div class="cue-strip">${esc(cue.text)}<small>cue · ${formatDate(cue.updated)}</small></div>`:''}<div class="previous-strip">${esc(prevText)}${confirmedText?`<span class="confirmed-line">${esc(confirmedText)}</span>`:''}</div><div class="set-grid header"><span>Set</span><span>kg</span><span>Reps</span><span>Done</span></div>${(()=>{const activeIdx=exercise.sets.findIndex(s=>!s.done);return exercise.sets.map((set,setIndex)=>setMarkup(set,index,setIndex,previous[setIndex]||previous[0],setIndex===activeIdx)).join('');})()}<button class="add-set" onclick="addSet(${index})">+ Add set</button></article>`;
}
function setMarkup(set,exerciseIndex,setIndex,previous,isActive){const completion=Core.setCompletionState(set.done,setIndex+1);return `<div class="set-grid set-row ${completion.className}${isActive?' notched':''}" data-ex="${exerciseIndex}" data-set="${setIndex}" data-status="${completion.status}"><button class="set-number" onclick="cycleSide(${exerciseIndex},${setIndex})" title="Tap to tag left/right side" aria-label="Set ${setIndex+1}${set.side?`, ${set.side==='L'?'left':'right'} side`:''}. Tap to tag side">${setIndex+1}${set.side?`<em>${set.side}</em>`:''}</button><input class="set-input" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(set.weight)}" placeholder="${previous?.weight||'—'}" onchange="updateSet(${exerciseIndex},${setIndex},'weight',this.value)" aria-label="Weight for set ${setIndex+1}"><input class="set-input" type="number" inputmode="numeric" min="0" step="1" value="${esc(set.reps)}" placeholder="${previous?.reps||'—'}" onchange="updateSet(${exerciseIndex},${setIndex},'reps',this.value)" aria-label="Repetitions for set ${setIndex+1}"><button class="set-done ${set.done?'done':''}" onclick="toggleSet(${exerciseIndex},${setIndex})" aria-label="${completion.actionLabel}" title="${completion.status}"><span aria-hidden="true">${set.done?'✓':'○'}</span></button></div>`;}
// ponytail: side-tagging = tap the set number, cycling both→L→R. Zero extra columns; feeds the future L/R balance view.
function cycleSide(exerciseIndex,setIndex){
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];
  set.side=set.side==='L'?'R':set.side==='R'?undefined:'L';
  saveState();renderWorkout();
}
function updateSet(exerciseIndex,setIndex,key,value){state.activeSession.exercises[exerciseIndex].sets[setIndex][key]=value;saveState();renderWorkoutMetrics();}
function toggleSet(exerciseIndex,setIndex){
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];set.done=!set.done;
  if(set.done){startRest(state.preferences.restSeconds);if(setIndex===state.activeSession.exercises[exerciseIndex].sets.length-1)addSet(exerciseIndex,true);}
  saveState();renderWorkout();
  if(set.done&&!REDUCED_MOTION){
    const row=document.querySelector(`.set-row[data-ex="${exerciseIndex}"][data-set="${setIndex}"]`);
    if(row){row.classList.add('just-done');setTimeout(()=>row.classList.remove('just-done'),320);}
  }
}
function addSet(exerciseIndex,silent=false){
  const sets=state.activeSession.exercises[exerciseIndex].sets,last=sets.at(-1)||{};
  sets.push({weight:last.weight||'',reps:last.reps||'',done:false});saveState();
  if(!silent)renderWorkout();
}
function addExerciseToWorkout(id){if(!state.activeSession)return;state.activeSession.exercises.push({exerciseId:id,notes:'',sets:[{weight:'',reps:'',done:false}]});saveState();renderWorkout();}
function startActiveClock(){clearInterval(activeTimer);const update=()=>{if(!state.activeSession)return;document.getElementById('workoutClock').textContent=Core.formatDuration((Date.now()-state.activeSession.started)/1000)};update();activeTimer=setInterval(update,1000);}
function formatElapsed(started){return Core.formatDuration((Date.now()-started)/1000);}

function startRest(seconds){restRemaining=Number(seconds)||90;clearInterval(restTimer);document.getElementById('restPill').classList.add('show');updateRest();restTimer=setInterval(()=>{restRemaining--;updateRest();if(restRemaining<=0){clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');showToast('Rest done — next set');}},1000);}
function adjustRest(seconds){restRemaining+=seconds;updateRest();}
function updateRest(){rollNumber(document.getElementById('restTime'),Core.formatDuration(restRemaining));}

function requestFinishWorkout(){
  const session=state.activeSession,summary=Core.summarizeSession({...session,finished:Date.now()});
  document.getElementById('confirmContent').innerHTML=`<h2>Finish workout?</h2><p>${summary.completedSets} completed sets · ${compact(summary.volume)} kg moved.</p><div class="confirm-feel"><p>HOW DID THE BODY FEEL?</p><div class="checkin-row" id="feelRow"><button onclick="setPostCheckin(this,'better')">Better</button><button onclick="setPostCheckin(this,'same')">Same</button><button onclick="setPostCheckin(this,'worse')">Worse</button></div></div><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep training</button><button class="primary-button" onclick="finishWorkout()">Finish</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function setPostCheckin(button,value){
  if(state.activeSession?.checkin)state.activeSession.checkin.post=value;
  document.querySelectorAll('#feelRow button').forEach(b=>b.classList.toggle('picked',b===button));
  saveState();
}
function finishWorkout(){
  const session=state.activeSession;if(!session)return;
  session.finished=Date.now();session.prs=Core.detectPRs(state.history,session);
  if(session.checkin&&session.checkin.flare===undefined)session.checkin.flare=null; // arms the next-session flare question
  state.history.unshift(session);state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();
  if(Sync)try{Sync.onSessionComplete(session);}catch{} // enqueue + best-effort upload; never blocks the flow
  openReceipt(session);
}
function openReceipt(session){
  const summary=Core.summarizeSession(session),prs=session.prs||[];
  const lines=[['Duration',`${summary.durationMinutes} min`],['Sets',summary.completedSets],['Volume',`${compact(summary.volume)} kg`],['PRs',prs.length]];
  const prBlocks=prs.map(pr=>{
    const item=exerciseById(pr.exerciseId);
    const parts=[pr.weight?`${pr.weight} kg top set`:'',pr.estimated1RM?`${pr.estimated1RM} kg est. 1RM`:''].filter(Boolean).join(' · ')||'New best';
    return `<div class="receipt-pr notched-left"><strong>${esc(item?.name||'Exercise')}</strong><small>${esc(parts)}</small></div>`;
  }).join('');
  document.getElementById('receiptCard').innerHTML=`<div class="receipt-sweep" aria-hidden="true"></div><p class="kicker">SESSION COMPLETE</p><h2>${esc(session.name)}</h2><p class="receipt-date">${formatDate(session.started)}</p><div class="receipt-lines">${lines.map(([k,v],i)=>`<div class="receipt-line" style="--i:${i}"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('')}</div>${prBlocks?`<div class="receipt-prs">${prBlocks}</div>`:''}<button class="primary-button full-button" onclick="closeReceipt()">Done</button>`;
  const overlay=document.getElementById('receiptOverlay');overlay.hidden=false;overlay.style.display='grid';
  requestAnimationFrame(()=>overlay.classList.add('show'));
  document.getElementById('receiptCard').querySelector('.primary-button').focus();
  overlay.onclick=e=>{if(e.target===overlay)closeReceipt();};
  overlay.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();closeReceipt();return;}
    if(e.key==='Tab'){e.preventDefault();document.getElementById('receiptCard').querySelector('.primary-button').focus();} // ponytail: one focusable control — trap is a refocus
  };
}
function closeReceipt(){const overlay=document.getElementById('receiptOverlay');overlay.classList.remove('show');overlay.hidden=true;overlay.style.display='none';overlay.onkeydown=null;navigate('progress');}
function cancelWorkout(){
  document.getElementById('confirmContent').innerHTML=`<h2>Discard workout?</h2><p>This workout and all its sets will be permanently removed.</p><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep it</button><button class="primary-button" style="background:var(--danger)" onclick="confirmCancelWorkout()">Discard</button></div>`;document.getElementById('confirmDialog').showModal();
}
function confirmCancelWorkout(){state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();navigate('today');}
function closeConfirm(){document.getElementById('confirmDialog').close();}

let pickerFilter='All';
function openExercisePicker(target){
  pickerTarget=target;pickerFilter='All';const content=document.getElementById('sheetContent');
  content.innerHTML=`<div class="sheet-head"><h2>Add exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="search-wrap picker-search"><span class="search-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg></span><input id="pickerSearch" type="search" placeholder="Search exercise or equipment" oninput="renderPickerList()"></div><div id="pickerFilters" class="filter-row picker-filters" aria-label="Filter by muscle group"></div><div id="pickerCount" class="result-count"></div><div id="pickerList" class="exercise-list"></div>`;
  renderPickerList();document.getElementById('sheet').showModal();
}
function setPickerFilter(group){pickerFilter=group;renderPickerList();}
function renderPickerList(){
  const query=(document.getElementById('pickerSearch')?.value||'').trim().toLowerCase();
  const groups=['All',...new Set(allExercises().map(e=>e.muscle))];
  document.getElementById('pickerFilters').innerHTML=groups.map(group=>`<button class="filter-chip ${pickerFilter===group?'active':''}" onclick="setPickerFilter('${esc(group)}')">${esc(group)}</button>`).join('');
  const list=allExercises().filter(e=>(pickerFilter==='All'||e.muscle===pickerFilter)&&`${e.name} ${e.muscle} ${e.equipment}`.toLowerCase().includes(query));
  document.getElementById('pickerCount').textContent=`${list.length} exercise${list.length===1?'':'s'}`;
  document.getElementById('pickerList').innerHTML=list.length?list.map(e=>exerciseRow(e,'pickExercise')).join(''):`<div class="empty-card card"><strong>Nothing found</strong>Try another name, muscle or equipment.</div>`;
}
function pickExercise(id){
  if(pickerTarget==='workout'){addExerciseToWorkout(id);closeSheet();showToast('Exercise added');}
  else if(pickerTarget==='routine'){if(!routineDraft.exerciseIds.includes(id))routineDraft.exerciseIds.push(id);renderRoutineEditor();}
}
function closeSheet(){document.getElementById('sheet').close();}

function openRoutineEditor(id){
  const existing=id?state.routines.find(r=>r.id===id):null;
  routineDraft=existing?JSON.parse(JSON.stringify(existing)):{id:`r${Date.now()}`,name:'',exerciseIds:[]};
  renderRoutineEditor();document.getElementById('sheet').showModal();
}
function renderRoutineEditor(){
  pickerTarget='routine';
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${state.routines.some(r=>r.id===routineDraft.id)?'Edit':'New'} routine</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>ROUTINE NAME</label><input id="routineName" value="${esc(routineDraft.name)}" placeholder="Example: Monday upper" oninput="routineDraft.name=this.value"></div><div class="section-heading"><div><p class="kicker">EXERCISES</p><h2>${routineDraft.exerciseIds.length} selected</h2></div><button class="text-button" onclick="openExercisePicker('routine')">+ Add</button></div><div class="selected-list">${routineDraft.exerciseIds.length?routineDraft.exerciseIds.map((id,index)=>`<div class="selected-row"><span><strong>${index+1}. ${esc(exerciseById(id)?.name||'Missing exercise')}</strong></span><button onclick="removeRoutineExercise(${index})">Remove</button></div>`).join(''):'<div class="empty-card card">Add exercises in the order you want to train.</div>'}</div><div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="saveRoutine()">Save routine</button></div>`;
}
function removeRoutineExercise(index){routineDraft.exerciseIds.splice(index,1);renderRoutineEditor();}
function saveRoutine(){
  routineDraft.name=routineDraft.name.trim();if(!routineDraft.name)return showToast('Name your routine');if(!routineDraft.exerciseIds.length)return showToast('Add at least one exercise');
  const index=state.routines.findIndex(r=>r.id===routineDraft.id);if(index>=0)state.routines[index]=routineDraft;else state.routines.unshift(routineDraft);saveState();closeSheet();renderTrain();showToast('Routine saved');
}
function openRoutineMenu(id){
  const routine=state.routines.find(r=>r.id===id);if(!routine)return;
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${esc(routine.name)}</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="stack"><button class="secondary-button full-button" onclick="closeSheet();openRoutineEditor('${id}')">Edit routine</button><button class="secondary-button full-button" onclick="duplicateRoutine('${id}')">Duplicate routine</button><button class="secondary-button full-button" style="color:var(--danger)" onclick="deleteRoutine('${id}')">Delete routine</button></div>`;document.getElementById('sheet').showModal();
}
function duplicateRoutine(id){const routine=state.routines.find(r=>r.id===id);state.routines.unshift({...routine,id:`r${Date.now()}`,name:`${routine.name} copy`,exerciseIds:[...routine.exerciseIds]});saveState();closeSheet();renderTrain();showToast('Routine duplicated');}
function deleteRoutine(id){state.routines=state.routines.filter(r=>r.id!==id);saveState();closeSheet();renderTrain();showToast('Routine deleted');}
function openWorkoutExerciseMenu(index){
  const exercise=state.activeSession.exercises[index],name=exerciseById(exercise.exerciseId)?.name||'Exercise';
  const cue=state.exerciseCues?.[exercise.exerciseId];
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${esc(name)}</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>WORKOUT NOTE (THIS SESSION)</label><textarea id="exerciseNote" rows="2" placeholder="Seat position, how it felt today…">${esc(exercise.notes||'')}</textarea></div><div class="field"><label>STANDING CUE (SHOWS EVERY WORKOUT)</label><textarea id="exerciseCue" rows="2" placeholder="Example: start stance square — right foot drifts out">${esc(cue?.text||'')}</textarea><small style="color:var(--taupe);font-size:11px">A cue is a hypothesis, not a rule — clear it when it stops earning its place.</small></div><div class="sheet-actions"><button class="secondary-button" style="color:var(--danger)" onclick="removeWorkoutExercise(${index})">Remove</button><button class="primary-button" onclick="saveExerciseNote(${index})">Save</button></div>`;document.getElementById('sheet').showModal();
}
function saveExerciseNote(index){
  const exercise=state.activeSession.exercises[index];
  exercise.notes=document.getElementById('exerciseNote').value.trim();
  const cueText=document.getElementById('exerciseCue').value.trim();
  if(!state.exerciseCues)state.exerciseCues={};
  if(cueText)state.exerciseCues[exercise.exerciseId]={text:cueText,updated:Date.now()};
  else delete state.exerciseCues[exercise.exerciseId];
  saveState();closeSheet();renderWorkout();showToast('Saved');
}
function removeWorkoutExercise(index){state.activeSession.exercises.splice(index,1);saveState();closeSheet();renderWorkout();}

function openCustomExercise(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Custom exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>EXERCISE NAME</label><input id="customName" placeholder="Example: Landmine press"></div><div class="field"><label>MUSCLE GROUP</label><select id="customMuscle">${['Chest','Back','Shoulders','Arms','Grip','Legs','Core','Full Body','Cardio','Mobility','Calisthenics','Stretches'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>EQUIPMENT</label><input id="customEquipment" placeholder="Example: Cable machine"></div><button class="primary-button full-button" onclick="saveCustomExercise()">Add exercise</button>`;document.getElementById('sheet').showModal();
}
function saveCustomExercise(){const name=document.getElementById('customName').value.trim();if(!name)return showToast('Name the exercise');state.customExercises.push({id:`c${Date.now()}`,name,muscle:document.getElementById('customMuscle').value,equipment:document.getElementById('customEquipment').value.trim()||'Custom equipment',custom:true});saveState();closeSheet();renderLibrary();showToast('Custom exercise added');}

function openHistory(id){
  const session=state.history.find(s=>s.id===id);if(!session)return;const summary=Core.summarizeSession(session);
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${formatDate(session.started).toUpperCase()}</p><h2>${esc(session.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><div class="metric-grid"><div class="metric"><strong>${summary.durationMinutes}</strong><span>MINUTES</span></div><div class="metric"><strong>${summary.completedSets}</strong><span>SETS</span></div><div class="metric"><strong>${compact(summary.volume)}</strong><span>KG</span></div></div><div class="selected-list">${session.exercises.map(ex=>{const item=exerciseById(ex.exerciseId),sets=ex.sets.filter(s=>s.done);return `<div class="selected-row"><span><strong>${esc(item?.name||'Exercise')}</strong><small style="display:block;color:var(--muted)">${sets.map(s=>`${s.weight||0} kg × ${s.reps||0}`).join(' · ')||'No completed sets'}</small></span></div>`}).join('')}</div><button class="secondary-button full-button" style="color:var(--danger)" onclick="deleteHistory('${id}')">Delete workout</button>`;document.getElementById('sheet').showModal();
}
function deleteHistory(id){state.history=state.history.filter(s=>s.id!==id);saveState();closeSheet();renderProgress();showToast('Workout deleted');}

function openRingGoals(){
  const p=state.preferences;
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">ACTIVITY RINGS</p><h2>Weekly goals</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><p style="color:var(--muted);margin-top:-6px">Set targets that feel challenging but realistic. Going over still keeps your real number.</p><div class="field"><label>WORKOUTS PER WEEK</label><input id="goalWorkouts" type="number" min="1" max="14" value="${p.weeklyWorkoutGoal}"></div><div class="field"><label>COMPLETED SETS PER WEEK</label><input id="goalSets" type="number" min="1" step="1" value="${p.weeklySetGoal}"></div><div class="field"><label>TRAINING VOLUME PER WEEK (KG)</label><input id="goalVolume" type="number" min="1" step="500" value="${p.weeklyVolumeGoal}"></div><button class="primary-button full-button" onclick="saveRingGoals()">Save goals</button>`;
  document.getElementById('sheet').showModal();
}
function saveRingGoals(){
  state.preferences.weeklyWorkoutGoal=Math.max(1,Number(document.getElementById('goalWorkouts').value)||4);
  state.preferences.weeklySetGoal=Math.max(1,Number(document.getElementById('goalSets').value)||48);
  state.preferences.weeklyVolumeGoal=Math.max(1,Number(document.getElementById('goalVolume').value)||10000);
  saveState();closeSheet();renderToday();showToast('Activity goals updated');
}
function openSettings(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Settings & data</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>DEFAULT REST TIMER</label><select id="restSetting" onchange="setRestPreference(this.value)">${[60,90,120,180].map(x=>`<option value="${x}" ${state.preferences.restSeconds===x?'selected':''}>${x/60} ${x===60?'minute':'minutes'}</option>`).join('')}</select></div><div class="stack"><button id="installButton" class="secondary-button full-button" onclick="installApp()">Install Gym</button><button class="secondary-button full-button" onclick="exportBackup()">Download backup</button><button class="secondary-button full-button" onclick="document.getElementById('importInput').click()">Import backup</button><button class="secondary-button full-button" style="color:var(--danger)" onclick="clearAllData()">Clear all data</button></div>${syncSettingsMarkup()}<p style="color:var(--muted);font-size:12px;margin-top:18px">Private by default. Your training data stays in this browser unless you export it.</p>`;document.getElementById('sheet').showModal();
}
// Google Drive sync + coach settings. drive.file scope only; the OAuth client ID is pasted by the owner.
function syncSettingsMarkup(){
  if(!Sync)return '';
  const st=Sync.status(),cfg=Sync.loadConfig(),beighton=Sync.getBeighton();
  const conn=st.configured?(st.connected?'Connected':'Configured — not connected'):'Not connected';
  return `<div class="section-heading"><div><p class="kicker">SYNC & COACH</p><h2>Google Drive</h2></div></div>
    <p style="color:var(--taupe);font-size:12px;margin:-2px 0 10px">Optional. Syncs sessions to a private <strong>Gym-Sync</strong> folder and reads your coach's plan back. Scope is limited to files this app creates.</p>
    <div class="field"><label>OAUTH CLIENT ID</label><input id="syncClientId" value="${esc(cfg.clientId||'')}" placeholder="xxxx.apps.googleusercontent.com" oninput="saveSyncClientId(this.value)"></div>
    <div class="stack">
      ${st.connected?`<button class="secondary-button full-button" onclick="disconnectSync()">Disconnect</button>`:`<button class="secondary-button full-button" ${st.configured?'':'disabled style="opacity:.5"'} onclick="connectSync()">Connect Google Drive</button>`}
    </div>
    <p style="color:var(--taupe);font-size:11px;margin:8px 2px 0">Status: ${esc(conn)}${st.queued?` · ${st.queued} session${st.queued===1?'':'s'} queued`:''}</p>
    <label class="beighton-toggle"><span><strong>Beighton features</strong><small>Off until your Beighton hypermobility filming is done. Unlocking accepts coach plans that use those extra capabilities.</small></span><input type="checkbox" ${beighton?'checked':''} onchange="toggleBeighton(this.checked)"></label>`;
}
function saveSyncClientId(value){if(Sync)Sync.setClientId(value);}
function connectSync(){
  if(!Sync)return;
  Sync.connect().then(()=>{openSettings();renderToday();showToast('Google Drive connected');}).catch(()=>showToast('Could not connect — try again'));
}
function disconnectSync(){if(Sync){Sync.disconnect();openSettings();renderToday();showToast('Disconnected');}}
function toggleBeighton(on){if(Sync){Sync.setBeighton(on);renderToday();showToast(on?'Beighton features unlocked':'Beighton features locked');}}
function setRestPreference(value){state.preferences.restSeconds=Number(value);saveState();showToast('Rest timer updated');}
function exportBackup(){const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`gym-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);}
async function importBackup(file){
  if(!file)return;
  try{
    const candidate=Core.validateBackup(JSON.parse(await file.text()));
    const previous=state;
    state=candidate;
    if(!saveState()){state=previous;return;}
    closeSheet();renderView(currentView);showToast('Backup imported');
  }catch{showToast('That backup could not be read');}
  finally{document.getElementById('importInput').value='';}
}
function clearAllData(){if(!confirm('Delete all routines, custom exercises and workout history?'))return;state=emptyState();saveState();closeSheet();renderView(currentView);showToast('All data cleared');}
async function installApp(){if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;}else showToast('Use your browser menu → Install app');}

// Self-heal: if an invisible layer covers the nav at boot (stale-cache CSS, future overlay bugs), neutralise it.
window.addEventListener('load',()=>{setTimeout(()=>{
  const btn=document.querySelector('.bottom-nav button');if(!btn||document.body.classList.contains('workout-active'))return;
  const r=btn.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  if(hit&&hit!==btn&&!btn.contains(hit)&&!hit.contains(btn)&&!hit.closest('.bottom-nav')&&!hit.closest('dialog')){
    hit.style.pointerEvents='none';console.warn('Neutralised tap blocker:',hit.id||hit.className);
  }
},600);});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
window.addEventListener('beforeunload',event=>{if(state.activeSession){event.preventDefault();event.returnValue='';}});
if('serviceWorker' in navigator&&location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
document.getElementById('sheet').addEventListener('click',event=>{if(event.target===event.currentTarget)closeSheet();});
saveState();
if(state.activeSession)renderToday();else renderToday();
renderTrain();renderLibrary();renderProgress();
// Flush any queued sessions and pull the latest coach plan on launch — silent, deferred, never blocking.
if(Sync)try{Sync.flush();Sync.downSync().then(()=>renderCoach()).catch(()=>{});}catch{}
