'use strict';

const Core = DuckGymCore;
const Coach = (typeof DuckGymCoach !== 'undefined') ? DuckGymCoach : null;
const Sync = (typeof DuckGymSync !== 'undefined') ? DuckGymSync : null;
const Profiles = (typeof DuckGymProfiles !== 'undefined') ? DuckGymProfiles : null;
const DAY = 86400000;
// ---- Active-profile binding (Track B). stateKey is the namespaced localStorage key the whole
// app reads/writes; it is set by bootProfiles() and re-pointed on every profile switch. ----
let activeProfileId = null;
let stateKey = 'duckGymV2'; // safe default if the profiles module ever fails to load
const unlockedProfiles = new Set(); // per-page-load unlock grace (council: unlock once per app open)
let bootNeedsName = false;
function bootProfiles(){
  if(!Profiles)return;
  const boot=Profiles.bootstrap(localStorage);
  activeProfileId=boot.activeId;
  stateKey=Profiles.stateKeyFor(activeProfileId);
  bootNeedsName=boot.needsName;
  if(Sync&&Sync.setUser)Sync.setUser(Profiles.syncKeyFor(activeProfileId));
}
let currentView = 'today';
let activeTimer = null;
let restTimer = null;
let restRemaining = 0;
let restExerciseIndex = 0; // which exercise the running rest belongs to — drives rest-end progression
let padTarget = null;      // {exIdx,setIdx,key} the numeric pad is editing
let padHold = null;        // press-and-hold acceleration timer for the pad
let routineDraft = null;
let pickerTarget = null;
let deferredInstall = null;

const templates = (typeof GYM_TEMPLATES!=='undefined') ? GYM_TEMPLATES : [];
const plans = (typeof GYM_PLANS!=='undefined') ? GYM_PLANS : [];

function emptyState(){ return {version:2,routines:[],history:[],customExercises:[],activeSession:null,exerciseCues:{},favourites:[],preferences:{restSeconds:90,weeklyWorkoutGoal:4,weeklySetGoal:48,weeklyVolumeGoal:10000,weightStep:2.5,haptics:true}}; }
// Reads the ACTIVE profile's namespaced state. Legacy dg_*/duckGymV2 migration is bootProfiles()'s job,
// so a brand-new profile's missing key correctly yields an empty state (never another profile's data).
function readState(){
  try{
    const saved=JSON.parse(localStorage.getItem(stateKey));
    if(saved?.version===2){
      const preferences={...emptyState().preferences,...saved.preferences,...Core.normalizeActivityGoals(saved.preferences)};
      return {...emptyState(),...saved,preferences};
    }
  }catch{}
  return emptyState();
}
bootProfiles();
let state=readState();
// While a locked profile is gated (P0-1), state is a neutral empty shell and MUST never be
// persisted — otherwise stray interactions behind the gate could clobber the real data.
let lockGate=false;
function saveState(){
  if(lockGate)return false;
  try{localStorage.setItem(stateKey,JSON.stringify(state));return true;}
  catch(error){console.error('Duck Gym could not persist state',error);showToast('Could not save — browser storage is full');return false;}
}
function allExercises(){ return [...DUCK_EXERCISES,...state.customExercises]; }
function exerciseById(id){ return allExercises().find(exercise=>exercise.id===id); }
function esc(value){ return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function compact(number){ const n=Number(number)||0; return n>=1e6?(n/1e6).toFixed(1)+'m':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n)); }
function formatDate(timestamp){ return new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'}).format(new Date(timestamp)); }
function showToast(message,isPr=false){ const el=document.getElementById('toast');el.textContent=message;el.classList.toggle('pr',isPr);el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),isPr?2600:1900); }
const REDUCED_MOTION=matchMedia('(prefers-reduced-motion: reduce)').matches;
// Haptics: a short buzz that announces a real event (set done / PR / rest end), never navigation.
// Gated on the profile toggle + navigator.vibrate — iOS PWAs have no vibrate, so this no-ops silently.
function buzz(pattern){ try{ if(Core.shouldBuzz(state.preferences,'vibrate' in navigator))navigator.vibrate(pattern); }catch{} }
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
  // A fresh Library open always starts unfiltered — a stale filter must never silently hide exercises (council 2026-07-19).
  if(view==='library')libraryFilter=newFilterState();
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
// Coach-card scoping (council 2026-07-19): a profile only sees the Local Ramp / Coach's Block card
// once it has skin in the game — a plan/routine, some history, or sync configured. A brand-new profile
// gets a neutral empty state instead, so Mark-tuned re-entry programming is never pushed at housemates.
function renderCoach(){
  const slot=document.getElementById('coachSlot');if(!slot)return;
  if(!Core.coachEligible(state,Sync&&!!Sync.loadConfig().clientId)){
    slot.innerHTML=`<section class="coach-card card coach-empty" aria-label="Get started"><p class="kicker">GET STARTED</p><h2>Pick a plan to get a suggested session</h2><p class="coach-empty-detail">Choose a plan built for this gym and your next session shows up here.</p><button class="primary-button full-button" onclick="navigate('train')">Pick a plan</button></section>`;
    return;
  }
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
  pickerFilterState=newFilterState();
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
  pickerFilterState=newFilterState(); // each workout's add-exercise flow starts clean, then persists across opens
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

// ---- Exercise catalogue (council 2026-07-19): flat, search/filter-first, shared by Library + the add-exercise picker.
// Quick Picks (favourites+recent) sit ABOVE a stable list; muscle chips single-select refine; secondary facets live behind Filters.
const MUSCLE_ORDER=['Chest','Back','Shoulders','Arms','Grip','Legs','Core','Full Body','Cardio','Mobility','Calisthenics','Stretches'];
const FILTERS_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
function newFilterState(){return {query:'',muscle:'All',patterns:[],equip:[],families:[]};}
let libraryFilter=newFilterState();
let pickerFilterState=newFilterState();
const CAT={
  library:{ids:{quick:'libraryQuickPicks',chips:'muscleFilters',filtersBtn:'libraryFiltersBtn',count:'libraryCount',list:'exerciseLibrary',search:'librarySearch'}},
  picker:{ids:{quick:'pk_quick',chips:'pk_chips',filtersBtn:'pk_filtersBtn',count:'pk_count',list:'pk_list',search:'pk_search'}}
};
function catState(ctx){return ctx==='library'?libraryFilter:pickerFilterState;}
function catEl(ctx,key){return document.getElementById(CAT[ctx].ids[key]);}
function catAdd(ctx,id){(ctx==='library'?quickExercise:pickExercise)(id);} // add by EXACT id — logging/progression path unchanged
// Full render (quick + chips + list). The search <input> node is only re-valued, never replaced, so focus/caret survive.
function renderCatalogue(ctx){
  const input=catEl(ctx,'search'); if(input)input.value=catState(ctx).query;
  const list=catEl(ctx,'list'); if(list)list._catKey=null; // force a rebuild on a fresh open
  renderCatalogueQuick(ctx);renderCatalogueChips(ctx);renderCatalogueList(ctx,false);
}
function renderCatalogueQuick(ctx){
  const host=catEl(ctx,'quick'); if(!host)return;
  const ids=Core.quickPicks(state.favourites,state.history,id=>!!exerciseById(id),8);
  if(!ids.length){host.innerHTML='';return;}
  const favSet=new Set(state.favourites||[]);
  const chips=ids.map(id=>{const e=exerciseById(id);if(!e)return '';return `<button class="quick-chip" data-id="${esc(id)}" aria-label="Add ${esc(e.name)}">${favSet.has(id)?'<span class="quick-star" aria-hidden="true">★</span>':''}<span>${esc(e.name)}</span></button>`;}).join('');
  host.innerHTML=`<p class="kicker quick-kicker">QUICK PICKS</p><div class="quick-row">${chips}</div>`;
}
function renderCatalogueChips(ctx){
  const fs=catState(ctx),host=catEl(ctx,'chips');
  if(host)host.innerHTML=['All',...MUSCLE_ORDER].map(m=>`<button class="filter-chip ${fs.muscle===m?'active':''}" data-muscle="${esc(m)}" aria-pressed="${fs.muscle===m}">${esc(m)}</button>`).join('');
  updateFiltersControl(ctx);
}
// Reflect the active facet count on the Filters button (badge + accent) and the open dialog's Clear button — in place, no rebuild.
function updateFiltersControl(ctx){
  const fs=catState(ctx),n=fs.patterns.length+fs.equip.length+fs.families.length,btn=catEl(ctx,'filtersBtn');
  if(btn){btn.classList.toggle('has-active',n>0);const badge=btn.querySelector('.filters-badge');if(badge){badge.textContent=n;badge.hidden=n===0;}}
  if(ctx===filterSheetCtx){const clear=document.getElementById('filterClearBtn');if(clear)clear.disabled=n===0;}
}
function renderCatalogueList(ctx,animate){
  const fs=catState(ctx),list=Core.filterExercises(allExercises(),fs);
  const count=catEl(ctx,'count'); if(count)count.textContent=`${list.length} exercise${list.length===1?'':'s'}${fs.query?' found':''}`;
  const host=catEl(ctx,'list'); if(!host)return;
  // Skip the 239-row rebuild when the filtered id-set + query-state is unchanged (favourite toggles patch stars in place, so the DOM stays correct).
  const key=(fs.query?'q:':'')+list.map(e=>e.id).join(',');
  if(host._catKey===key)return;
  host._catKey=key;
  host.innerHTML=list.length?list.map(exerciseRow).join(''):`<div class="empty-card card"><strong>No exercises match</strong>Nothing fits this search and filter set. <button class="text-button" onclick="resetCatalogue('${ctx}')">Clear filters</button></div>`;
  if(animate&&!REDUCED_MOTION){host.style.animation='none';void host.offsetWidth;host.style.animation='catFade .18s var(--ease)';}
}
// Row markup carries the exact id in data-id (never interpolated into a handler string); a delegated listener does the work.
// Whole name area taps to add; the ≥44px star toggles favourite (filled vs outline shape, not colour-only).
function exerciseRow(exercise){
  const fav=(state.favourites||[]).includes(exercise.id);
  const meta=`${esc(exercise.muscle||'')} · ${esc(exercise.equipment||'Custom equipment')}`,id=esc(exercise.id);
  return `<article class="exercise-row"><button class="exercise-pick" data-id="${id}" aria-label="Add ${esc(exercise.name)}"><span class="exercise-info"><strong>${esc(exercise.name)}</strong><small>${meta}</small></span><span class="exercise-plus" aria-hidden="true">+</span></button><button class="exercise-star${fav?' on':''}" data-id="${id}" aria-pressed="${fav}" aria-label="${fav?'Remove':'Add'} ${esc(exercise.name)} ${fav?'from':'to'} favourites"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.8l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86z"/></svg></button></article>`;
}
// One delegated click listener per catalogue surface — no per-row handlers, no id interpolation (injection-safe).
function onCatalogueClick(ctx,e){
  const pick=e.target.closest('.exercise-pick'); if(pick){if(pick.dataset.id)catAdd(ctx,pick.dataset.id);return;}
  const star=e.target.closest('.exercise-star'); if(star){if(star.dataset.id)toggleFavourite(star.dataset.id,ctx,star);return;}
  const quick=e.target.closest('.quick-chip'); if(quick){if(quick.dataset.id)catAdd(ctx,quick.dataset.id);return;}
  const chip=e.target.closest('.filter-chip'); if(chip&&chip.dataset.muscle!=null)setCatMuscle(ctx,chip.dataset.muscle);
}
let catSearchTimer=null;
// Debounced so a fast typist doesn't rebuild the list on every keystroke; the input node persists so caret/focus survive.
function onCatSearch(ctx,value){catState(ctx).query=value;clearTimeout(catSearchTimer);catSearchTimer=setTimeout(()=>renderCatalogueList(ctx,false),120);}
function setCatMuscle(ctx,muscle){catState(ctx).muscle=muscle;renderCatalogueChips(ctx);renderCatalogueList(ctx,true);}
// Favourite toggle: flip THIS star in place, refresh only Quick Picks, and hold the tapped row's screen position (never rebuild the list).
function toggleFavourite(id,ctx,starEl){
  if(!Array.isArray(state.favourites))state.favourites=[];
  const i=state.favourites.indexOf(id),willFav=i<0;
  if(willFav)state.favourites.push(id);else state.favourites.splice(i,1);
  saveState();
  if(starEl){
    const name=exerciseById(id)?.name||'exercise';
    starEl.classList.toggle('on',willFav);
    starEl.setAttribute('aria-pressed',String(willFav));
    starEl.setAttribute('aria-label',`${willFav?'Remove':'Add'} ${name} ${willFav?'from':'to'} favourites`);
  }
  const scroller=ctx==='library'?null:document.querySelector('#sheet .sheet-scroll');
  const before=starEl?starEl.getBoundingClientRect().top:null;
  renderCatalogueQuick(ctx);
  if(before!=null){const d=starEl.getBoundingClientRect().top-before;if(d){scroller?scroller.scrollTop+=d:window.scrollBy(0,d);}}
  showToast(willFav?'Added to favourites':'Removed from favourites');
}
function resetCatalogue(ctx){if(ctx==='library')libraryFilter=newFilterState();else pickerFilterState=newFilterState();renderCatalogue(ctx);}
// Secondary facets (pattern / equipment / family) live in their own dialog so the muscle row stays a single fast strip.
// Facet vocab is derived from the catalogue itself (custom exercises carry no tags → they contribute none, and are never crashed by a facet).
function distinctTags(getter){const s=new Set();for(const e of allExercises())for(const v of (getter(e)||[]))s.add(v);return [...s].sort();}
function distinctFamilies(){const s=new Set();for(const e of allExercises())if(e.family)s.add(e.family);return [...s].sort();}
let filterSheetCtx='library';
function openFiltersSheet(ctx){filterSheetCtx=ctx;renderFiltersSheet();document.getElementById('filterSheet').showModal();}
function renderFiltersSheet(){
  const fs=catState(filterSheetCtx),n=fs.patterns.length+fs.equip.length+fs.families.length;
  const group=(title,kind,values,selected)=>values.length?`<div class="filter-group"><p class="kicker">${title}</p><div class="chip-wrap">${values.map(v=>`<button class="facet-chip${selected.includes(v)?' on':''}" data-kind="${kind}" data-value="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(v)}</button>`).join('')}</div></div>`:'';
  document.getElementById('filterSheetContent').innerHTML=`<div class="sheet-head"><h2 id="filterSheetTitle">Filters</h2><button class="close-button" onclick="closeFiltersSheet()">×</button></div>${group('MOVEMENT PATTERN','patterns',distinctTags(e=>e.patterns),fs.patterns)}${group('EQUIPMENT','equip',distinctTags(e=>e.equip),fs.equip)}${group('FAMILY','families',distinctFamilies(),fs.families)}<div class="sheet-actions"><button id="filterClearBtn" class="secondary-button"${n?'':' disabled'} onclick="clearFacets()">Clear</button><button class="primary-button" onclick="closeFiltersSheet()">Show results</button></div>`;
}
// Facet toggle (delegated): flip THIS chip + the Filters badge in place — never rebuild the dialog, so keyboard focus survives.
function onFacetClick(e){
  const chip=e.target.closest('.facet-chip'); if(!chip)return;
  const kind=chip.dataset.kind,value=chip.dataset.value,arr=catState(filterSheetCtx)[kind],i=arr.indexOf(value),on=i<0;
  if(on)arr.push(value);else arr.splice(i,1);
  chip.classList.toggle('on',on);chip.setAttribute('aria-pressed',String(on));
  updateFiltersControl(filterSheetCtx);renderCatalogueList(filterSheetCtx,true);
}
function clearFacets(){const fs=catState(filterSheetCtx);fs.patterns=[];fs.equip=[];fs.families=[];renderFiltersSheet();updateFiltersControl(filterSheetCtx);renderCatalogueList(filterSheetCtx,true);}
function closeFiltersSheet(){document.getElementById('filterSheet').close();}
// Keep the renderLibrary name — renderView, boot and saveCustomExercise all call it.
function renderLibrary(){renderCatalogue('library');}
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
  return `<article class="workout-exercise"><header class="exercise-head"><div><h2>${esc(item?.name||'Exercise')}</h2><p>${esc(item?.equipment||'')}</p></div><button class="exercise-more" onclick="openWorkoutExerciseMenu(${index})" aria-label="Exercise options">•••</button></header>${cue?.text?`<div class="cue-strip">${esc(cue.text)}<small>cue · ${formatDate(cue.updated)}</small></div>`:''}<div class="previous-strip">${esc(prevText)}${confirmedText?`<span class="confirmed-line">${esc(confirmedText)}</span>`:''}</div><div class="set-grid header"><span>Set</span><span>kg</span><span>Reps</span><span>Done</span></div>${(()=>{const activeIdx=exercise.sets.findIndex(s=>!s.done);return exercise.sets.map((set,setIndex)=>setMarkup(set,index,setIndex,previous[setIndex]||previous[0],setIndex===activeIdx,previous[0])).join('');})()}<button class="add-set" onclick="addSet(${index})">+ Add set</button></article>`;
}
// A cell input opens the numeric pad instead of the keyboard (readonly + role=button); the pad's
// "Keyboard" button removes readonly for arbitrary entry. Prefilled (carry-forward) sets read muted
// AND italic/lighter — a non-colour cue too, since Mark is colour-blind — until the lifter confirms them.
function setMarkup(set,exerciseIndex,setIndex,previous,isActive,firstPrev){const completion=Core.setCompletionState(set.done,setIndex+1);const pf=set.prefilled&&!set.done?' prefilled':'';const cellAttrs=k=>`readonly role="button" data-ex="${exerciseIndex}" data-set="${setIndex}" data-key="${k}" onclick="openPad(${exerciseIndex},${setIndex},'${k}')"`;const adopt=Core.showAdoptAction(set,setIndex,!!firstPrev)?`<button class="adopt-last" onclick="adoptLast(${exerciseIndex})" aria-label="Use last session's ${firstPrev.weight||'—'} kilograms for ${firstPrev.reps} reps">Use last: ${esc(firstPrev.weight||'—')} kg × ${esc(firstPrev.reps)}</button>`:'';return `<div class="set-grid set-row ${completion.className}${isActive?' notched':''}${pf}" data-ex="${exerciseIndex}" data-set="${setIndex}" data-status="${completion.status}"><button class="set-number" onclick="cycleSide(${exerciseIndex},${setIndex})" title="Tap to tag left/right side" aria-label="Set ${setIndex+1}${set.side?`, ${set.side==='L'?'left':'right'} side`:''}. Tap to tag side">${setIndex+1}${set.side?`<em>${set.side}</em>`:''}</button><input class="set-input" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(set.weight)}" placeholder="${previous?.weight||'—'}" ${cellAttrs('weight')} onchange="updateSet(${exerciseIndex},${setIndex},'weight',this.value)" aria-label="Weight for set ${setIndex+1}"><input class="set-input" type="number" inputmode="numeric" min="0" step="1" value="${esc(set.reps)}" placeholder="${previous?.reps||'—'}" ${cellAttrs('reps')} onchange="updateSet(${exerciseIndex},${setIndex},'reps',this.value)" aria-label="Repetitions for set ${setIndex+1}"><button class="set-done ${set.done?'done':''}" onclick="toggleSet(${exerciseIndex},${setIndex})" aria-label="${completion.actionLabel}" title="${completion.status}"><span aria-hidden="true">${set.done?'✓':'○'}</span></button></div>${adopt}`;}
// Explicit set-1 adoption: fill (never auto) set 1 from last session's first set; the lifter can still edit.
function adoptLast(exerciseIndex){
  const ex=state.activeSession?.exercises[exerciseIndex];if(!ex)return;
  const prev=Core.previousPerformance(state.history,ex.exerciseId)[0];if(!prev)return;
  const set=ex.sets[0];if(!set||set.done||set.weight!==''||set.reps!=='')return;
  set.weight=prev.weight?String(prev.weight):'';set.reps=String(prev.reps);delete set.prefilled; // adopted = user's chosen load; empty bodyweight stays empty, never a fabricated 0
  saveState();renderWorkout();
}
// ponytail: side-tagging = tap the set number, cycling both→L→R. Zero extra columns; feeds the future L/R balance view.
function cycleSide(exerciseIndex,setIndex){
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];
  set.side=set.side==='L'?'R':set.side==='R'?undefined:'L';
  saveState();renderWorkout();
}
function updateSet(exerciseIndex,setIndex,key,value){const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];set[key]=value;delete set.prefilled;saveState();renderWorkoutMetrics();}
// Completing a set writes its real numbers, then pre-fills the NEXT still-empty incomplete set with
// those numbers (Core.carryForward) so an unchanged set becomes a genuine one-tap. Prefill only lands
// in a set the lifter hasn't touched (both fields empty) — never overwrites entered data.
function carryForwardExercise(exercise){
  const sets=exercise.sets||[];const j=sets.findIndex(s=>!s.done);
  if(j<=0)return; // no incomplete set, or set 1 (never prefilled)
  const pf=Core.carryForward(exercise,j);
  if(pf&&sets[j].weight===''&&sets[j].reps===''){sets[j].weight=String(pf.weight);sets[j].reps=String(pf.reps);sets[j].prefilled=true;}
}
function toggleSet(exerciseIndex,setIndex){
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];set.done=!set.done;
  if(set.done){delete set.prefilled;startRest(state.preferences.restSeconds,exerciseIndex);if(setIndex===state.activeSession.exercises[exerciseIndex].sets.length-1)addSet(exerciseIndex,true);carryForwardExercise(state.activeSession.exercises[exerciseIndex]);buzz(15);}
  else{ // un-complete: downstream prefills seeded by this set are stale — reset + re-derive (Codex)
    const ex=state.activeSession.exercises[exerciseIndex];
    ex.sets.forEach((s,i)=>{if(i>setIndex&&s.prefilled&&!s.done){s.weight='';s.reps='';delete s.prefilled;}});
    carryForwardExercise(ex);
  }
  saveState();renderWorkout();
  if(set.done&&!REDUCED_MOTION){
    const row=document.querySelector(`.set-row[data-ex="${exerciseIndex}"][data-set="${setIndex}"]`);
    if(row){row.classList.add('just-done');setTimeout(()=>row.classList.remove('just-done'),320);}
  }
}
function addSet(exerciseIndex,silent=false){
  // Sets are born EMPTY; carry-forward (on completing the prior set) is the sole prefill path, so a
  // prefilled value is always the flagged/muted kind — never a silent copy the lifter didn't choose.
  const ex=state.activeSession.exercises[exerciseIndex];
  ex.sets.push({weight:'',reps:'',done:false});
  if(!silent){carryForwardExercise(ex);saveState();renderWorkout();} // manual add prefills if the prior set is already done
  else saveState();
}
function addExerciseToWorkout(id){if(!state.activeSession)return;state.activeSession.exercises.push({exerciseId:id,notes:'',sets:[{weight:'',reps:'',done:false}]});saveState();renderWorkout();}
function startActiveClock(){clearInterval(activeTimer);const update=()=>{if(!state.activeSession)return;document.getElementById('workoutClock').textContent=Core.formatDuration((Date.now()-state.activeSession.started)/1000)};update();activeTimer=setInterval(update,1000);}
function formatElapsed(started){return Core.formatDuration((Date.now()-started)/1000);}

function startRest(seconds,exerciseIndex=0){restRemaining=Number(seconds)||90;restExerciseIndex=exerciseIndex;clearInterval(restTimer);document.getElementById('restPill').classList.add('show');updateRest();restTimer=setInterval(()=>{restRemaining--;updateRest();if(restRemaining<=0){clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');buzz(40);showToast('Rest done — next set');progressToNextSet(restExerciseIndex);}},1000);}
function adjustRest(seconds){restRemaining+=seconds;updateRest();}
function updateRest(){rollNumber(document.getElementById('restTime'),Core.formatDuration(restRemaining));}
// Skip clears the running rest and immediately hands off to the next-set progression.
function skipRest(){clearInterval(restTimer);restRemaining=0;document.getElementById('restPill').classList.remove('show');progressToNextSet(restExerciseIndex);}
// Rest-end "what's next": the next incomplete set (same exercise, else the next exercise with one)
// gets a one-time amber emphasis on its already-notched active row and scrolls into view. Purely
// visual — no focus() so the keyboard never pops. Reduced motion: instant scroll, no pulse.
function progressToNextSet(fromExIndex){
  const s=state.activeSession;if(!s)return;
  const firstIncomplete=exIdx=>{const ex=s.exercises[exIdx];return ex?ex.sets.findIndex(x=>!x.done):-1;};
  let exIdx=fromExIndex,setIdx=firstIncomplete(fromExIndex);
  if(setIdx<0){for(let i=fromExIndex+1;i<s.exercises.length;i++){const j=firstIncomplete(i);if(j>=0){exIdx=i;setIdx=j;break;}}}
  if(setIdx<0)return;
  const row=document.querySelector(`.set-row[data-ex="${exIdx}"][data-set="${setIdx}"]`);
  if(!row)return;
  row.scrollIntoView({block:'center',behavior:REDUCED_MOTION?'auto':'smooth'});
  if(!REDUCED_MOTION){row.classList.add('rest-next');setTimeout(()=>row.classList.remove('rest-next'),900);}
}

// ---- Numeric pad (council 2026-07-19): tapping a weight/reps cell opens this bottom sheet instead
// of the keyboard — big −/+ with hold-acceleration, a per-profile weight step, and a Keyboard escape
// hatch for arbitrary entry. Writes go through the same updateSet path as typing. ----
const WEIGHT_STEPS=[1,2.5,5];
function padStep(){return padTarget?.key==='weight'?(Number(state.preferences.weightStep)||2.5):1;}
function openPad(exIdx,setIdx,key){
  if(!state.activeSession)return;
  padTarget={exIdx,setIdx,key};
  renderPad();
  document.getElementById('padSheet').showModal();
}
function padValue(){const {exIdx,setIdx,key}=padTarget||{};return Number(state.activeSession?.exercises[exIdx]?.sets[setIdx]?.[key])||0;}
function renderPad(){
  const {key}=padTarget||{};const isW=key==='weight';const step=Number(state.preferences.weightStep)||2.5;
  const steps=isW?`<div class="pad-steps" role="group" aria-label="Weight step">${WEIGHT_STEPS.map(s=>`<button class="pad-step${s===step?' on':''}" onclick="padSetStep(${s})" aria-pressed="${s===step}">${s} kg</button>`).join('')}</div>`:'';
  document.getElementById('padContent').innerHTML=`<div class="sheet-head"><h2>${isW?'Weight':'Reps'}</h2><button class="close-button" onclick="closePad()" aria-label="Done">×</button></div>`
    +`<div class="pad-value"><strong id="padDisplay" data-val="${esc(String(padValue()))}">${esc(String(padValue()))}</strong><small>${isW?'kg':'reps'}</small></div>`
    +steps
    +`<div class="pad-controls"><button class="pad-adjust" aria-label="Decrease" onpointerdown="padHoldStart(-1)" onpointerup="padHoldStop()" onpointerleave="padHoldStop()" onpointercancel="padHoldStop()">−</button><button class="pad-adjust" aria-label="Increase" onpointerdown="padHoldStart(1)" onpointerup="padHoldStop()" onpointerleave="padHoldStop()" onpointercancel="padHoldStop()">+</button></div>`
    +`<div class="sheet-actions"><button class="secondary-button" onclick="padKeyboard()">Keyboard</button><button class="primary-button" onclick="closePad()">Done</button></div>`;
}
function padSetStep(s){state.preferences.weightStep=s;saveState();renderPad();}
function padAdjust(dir){
  if(!padTarget)return;
  const {exIdx,setIdx,key}=padTarget;
  const next=Core.stepValue(padValue(),padStep(),dir);
  updateSet(exIdx,setIdx,key,String(next));
  const inp=document.querySelector(`.set-input[data-ex="${exIdx}"][data-set="${setIdx}"][data-key="${key}"]`);
  if(inp)inp.value=String(next);
  const disp=document.getElementById('padDisplay');if(disp)rollNumber(disp,String(next));
}
function padHoldStart(dir){padAdjust(dir);let delay=380;const tick=()=>{padAdjust(dir);delay=Math.max(60,delay*0.82);padHold=setTimeout(tick,delay);};padHold=setTimeout(tick,380);}
function padHoldStop(){clearTimeout(padHold);padHold=null;}
function padKeyboard(){
  const t=padTarget;closePad();
  if(!t)return;
  const inp=document.querySelector(`.set-input[data-ex="${t.exIdx}"][data-set="${t.setIdx}"][data-key="${t.key}"]`);
  if(!inp)return;
  inp.readOnly=false;inp.removeAttribute('role');inp.focus();inp.select&&inp.select();
  const restore=()=>{inp.readOnly=true;inp.setAttribute('role','button');inp.removeEventListener('blur',restore);};
  inp.addEventListener('blur',restore);
}
function closePad(){padHoldStop();document.getElementById('padSheet').close();padTarget=null;if(state.activeSession)renderWorkout();}

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
  if(session.prs.length)buzz([20,60,20]); // PR: distinct double pulse
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

function openExercisePicker(target){
  pickerTarget=target;
  if(target!=='workout')pickerFilterState=newFilterState(); // routine editing browses fresh; a workout's flow keeps its filters across opens
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Add exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div>`
    +`<div id="pk_quick" class="quick-picks"></div>`
    +`<div class="search-wrap picker-search"><span class="search-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg></span><input id="pk_search" type="search" placeholder="Search name, muscle or equipment" oninput="onCatSearch('picker',this.value)" aria-label="Search exercises"></div>`
    +`<div class="catalogue-controls"><div id="pk_chips" class="filter-row" aria-label="Filter by muscle group"></div><button id="pk_filtersBtn" class="filters-button" onclick="openFiltersSheet('picker')" aria-label="More filters">${FILTERS_ICON}<span>Filters</span><span class="filters-badge" hidden>0</span></button></div>`
    +`<div id="pk_count" class="result-count"></div><div id="pk_list" class="exercise-list"></div>`;
  renderCatalogue('picker');document.getElementById('sheet').showModal();
}
function pickExercise(id){
  if(pickerTarget==='workout'){addExerciseToWorkout(id);closeSheet();showToast('Exercise added');}
  else if(pickerTarget==='routine'){if(!routineDraft.exerciseIds.includes(id))routineDraft.exerciseIds.push(id);renderRoutineEditor();}
}
function closeSheet(){
  document.getElementById('sheet').close();
  // While the boot PIN gate is active, any sheet dismissal (incl. the switcher's x) must land
  // back ON the gate, never in the neutral shell (Codex: gate must be truly non-dismissible).
  if(lockGate){const p=Profiles?Profiles.getActive(localStorage):null;if(p&&p.pinHash)gateLockedProfile(p);}
}

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
  // While the active profile is gated, Settings (rename/delete/export) stays behind the PIN too.
  if(lockGate){const p=Profiles?Profiles.getActive(localStorage):null;if(p){gateLockedProfile(p);return;}}
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Settings & data</h2><button class="close-button" onclick="closeSheet()">×</button></div>${profileSettingsMarkup()}<div class="field"><label>DEFAULT REST TIMER</label><select id="restSetting" onchange="setRestPreference(this.value)">${[60,90,120,180].map(x=>`<option value="${x}" ${state.preferences.restSeconds===x?'selected':''}>${x/60} ${x===60?'minute':'minutes'}</option>`).join('')}</select></div><label class="beighton-toggle"><span><strong>Haptics</strong><small>A short buzz on set complete, rest end and PRs. Android only — iPhone has no web vibration.</small></span><input type="checkbox" id="hapticsToggle" ${state.preferences.haptics!==false?'checked':''} onchange="toggleHaptics(this.checked)"></label><div class="stack"><button id="installButton" class="secondary-button full-button" onclick="installApp()">Install Gym</button><button class="secondary-button full-button" onclick="exportBackup()">Download backup</button><button class="secondary-button full-button" onclick="document.getElementById('importInput').click()">Import backup</button><button class="secondary-button full-button" style="color:var(--danger)" onclick="clearAllData()">Clear all data</button></div>${syncSettingsMarkup()}<p style="color:var(--muted);font-size:12px;margin-top:18px">Private by default. Your training data stays in this browser unless you export it.</p>`;document.getElementById('sheet').showModal();
  if(Sync)try{Sync.preload();}catch{} // warm GIS so the first Connect tap opens the popup in-gesture
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
  Sync.connect().then(()=>{openSettings();renderToday();showToast('Google Drive connected');}).catch(e=>{
    const m=String((e&&e.message)||e);
    showToast(
      m==='gsi-not-ready'?'Still loading Google — tap Connect again':
      m==='popup_failed_to_open'?'Pop-up blocked — allow pop-ups for this site, then tap Connect':
      m==='no-token'||m==='access_denied'?'Sign-in cancelled — tap Connect to retry':
      'Could not connect — try again');
  });
}
function disconnectSync(){if(Sync){Sync.disconnect();openSettings();renderToday();showToast('Disconnected');}}
function toggleBeighton(on){if(Sync){Sync.setBeighton(on);renderToday();showToast(on?'Beighton features unlocked':'Beighton features locked');}}
function setRestPreference(value){state.preferences.restSeconds=Number(value);saveState();showToast('Rest timer updated');}
function toggleHaptics(on){state.preferences.haptics=!!on;saveState();if(on)buzz(15);showToast(on?'Haptics on':'Haptics off');}
function activeProfileName(){const p=Profiles?Profiles.getActive(localStorage):null;return (p&&p.name)||'me';}
function exportBackup(){const slug=activeProfileName().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'me';const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`gym-${slug}-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);}
async function importBackup(file){
  if(!file)return;
  try{
    const candidate=Core.validateBackup(JSON.parse(await file.text()),DUCK_EXERCISES.map(e=>e.id));
    const previous=state;
    state=candidate;
    if(!saveState()){state=previous;return;}
    closeSheet();renderView(currentView);showToast('Backup imported');
  }catch{showToast('That backup could not be read');}
  finally{document.getElementById('importInput').value='';}
}
function clearAllData(){if(!confirm('Delete all routines, custom exercises and workout history?'))return;state=emptyState();saveState();closeSheet();renderView(currentView);showToast('All data cleared');}
async function installApp(){
  if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;return;}
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  if(standalone)return showToast('Already installed');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  // iOS never fires beforeinstallprompt and only Safari can install — give the real steps.
  if(ios){document.getElementById('confirmContent').innerHTML=`<h2>Install on iPhone</h2><p>In <strong>Safari</strong>, tap the Share button (the square with the up arrow), then <strong>“Add to Home Screen”</strong>. Chrome and Brave can’t install apps on iOS.</p><div class="confirm-actions"><button class="primary-button" onclick="closeConfirm()">Got it</button></div>`;document.getElementById('confirmDialog').showModal();return;}
  showToast('Use your browser menu → Install app');
}

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
document.getElementById('sheet').addEventListener('click',event=>{if(event.target===event.currentTarget&&!(pinContext&&pinContext.mandatory)&&!lockGate)closeSheet();});
document.getElementById('filterSheet').addEventListener('click',event=>{if(event.target===event.currentTarget)closeFiltersSheet();});
// Catalogue event delegation — one listener per surface; row/star/quick/muscle actions read data-id/data-muscle (no inline handlers).
document.getElementById('view-library').addEventListener('click',event=>onCatalogueClick('library',event));
document.getElementById('sheetContent').addEventListener('click',event=>onCatalogueClick('picker',event));
document.getElementById('filterSheetContent').addEventListener('click',onFacetClick);
// ================= Track B — local profiles UI =================
function renderProfileChip(){
  const chip=document.getElementById('profileChip');if(!chip)return;
  if(!Profiles){chip.hidden=true;return;}
  const p=Profiles.getActive(localStorage);
  document.getElementById('profileChipInitial').textContent=p?Profiles.initial(p.name||'?'):'?';
  chip.setAttribute('aria-label',`Switch profile${p&&p.name?` — currently ${p.name}`:''}`);
  chip.classList.toggle('is-locked',!!(p&&p.locked));
  chip.hidden=false;
}
function openProfileSwitcher(){
  if(!Profiles)return;
  const reg=Profiles.getRegistry(localStorage),list=reg?reg.profiles:[];
  const rows=list.map(p=>`<button class="profile-row${p.id===activeProfileId?' active':''}" onclick="enterProfile('${p.id}')">
    <span class="profile-ini">${esc(Profiles.initial(p.name||'?'))}</span>
    <span class="profile-name"><strong>${esc(p.name||'Unnamed')}</strong>${p.id===activeProfileId?'<small>Training now</small>':(p.locked?'<small>Locked</small>':'')}</span>
    <span class="profile-mark" aria-hidden="true">${p.id===activeProfileId?'✓':(p.locked?'🔒':'')}</span>
  </button>`).join('');
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Who’s training?</h2><button class="close-button" onclick="closeSheet()">×</button></div>
    <div class="profile-rows">${rows}<button class="profile-row add-row" onclick="addPerson()"><span class="profile-ini add">+</span><span class="profile-name"><strong>Add person</strong></span><span class="profile-mark" aria-hidden="true">›</span></button></div>`;
  document.getElementById('sheet').showModal();
}
// Enter a profile: no-op if already active; PIN gate if locked-and-not-yet-unlocked; else switch now.
function enterProfile(id){
  if(!Profiles)return;
  const p=Profiles.getProfile(localStorage,id);if(!p)return;
  if(id===activeProfileId){
    // Tapping the current profile while it's still gated re-opens the gate, never the app (P0-1).
    if(lockGate){gateLockedProfile(p);return;}
    closeSheet();return;
  }
  if(p.locked&&!unlockedProfiles.has(id)){openPinGate(p,()=>{unlockedProfiles.add(id);commitSwitch(id);});return;}
  commitSwitch(id);
}
// The actual swap: persist active pointer, re-point state + sync (token reset), reset transient UI, re-render.
function commitSwitch(id){
  Profiles.setActive(localStorage,id);
  activeProfileId=id;
  stateKey=Profiles.stateKeyFor(id);
  if(Sync&&Sync.setUser)Sync.setUser(Profiles.syncKeyFor(id)); // hard auth reset — no cross-profile token bleed
  pinContext=null;pinBuffer='';lockGate=false; // leaving any gate: the switched-to profile is unlocked-by-definition here
  state=readState();
  clearInterval(activeTimer);clearInterval(restTimer);
  const pill=document.getElementById('restPill');if(pill)pill.classList.remove('show');
  routineDraft=null;pickerTarget=null;strengthPick=null;
  libraryFilter=newFilterState();pickerFilterState=newFilterState();
  closeSheet();
  currentView='today';
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-today'));
  document.querySelectorAll('.bottom-nav button').forEach(el=>el.classList.toggle('active',el.dataset.view==='today'));
  const cursor=document.getElementById('navCursor');if(cursor)cursor.style.transform='translateX(0)';
  document.body.classList.remove('workout-active');
  renderAllViews();renderProfileChip();
  const main=document.getElementById('main');if(main)main.focus({preventScroll:true});window.scrollTo(0,0);
  if(Sync)try{Sync.flush();Sync.downSync().then(()=>renderCoach()).catch(()=>{});}catch{}
  const name=(Profiles.getActive(localStorage)||{}).name;
  showToast(name?`Training as ${name}`:'Profile switched');
}
function addPerson(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Add person</h2><button class="close-button" onclick="closeSheet()">×</button></div>
    <p class="first-run-sub">A separate space on this phone — their own history, favourites and plans. The only shared thing is the gym’s exercise list.</p>
    <div class="field"><label>NAME</label><input id="newPersonName" placeholder="Their name" onkeydown="if(event.key==='Enter')submitAddPerson()"></div>
    <div class="sheet-actions"><button class="secondary-button" onclick="openProfileSwitcher()">Back</button><button class="primary-button" onclick="submitAddPerson()">Create & switch</button></div>`;
  document.getElementById('sheet').showModal();
  setTimeout(()=>document.getElementById('newPersonName')?.focus(),60);
}
function submitAddPerson(){
  const name=(document.getElementById('newPersonName').value||'').trim();
  if(!name)return showToast('Enter a name');
  commitSwitch(Profiles.addProfile(localStorage,name));
}
// First-run / post-migration welcome — names the profile bootstrap already created. One screen, no friction.
function openFirstRunSheet(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Who’s training on this phone?</h2></div>
    <p class="first-run-sub">Your workouts stay in a private space on this device. You can add other people later from the profile menu.</p>
    <div class="field"><label>YOUR NAME</label><input id="firstRunName" placeholder="Your name" onkeydown="if(event.key==='Enter')submitFirstRun()"></div>
    <button class="primary-button full-button" onclick="submitFirstRun()">Continue</button>`;
  document.getElementById('sheet').showModal();
  setTimeout(()=>document.getElementById('firstRunName')?.focus(),60);
}
function submitFirstRun(nameArg){
  if(!Profiles)return;
  const name=(typeof nameArg==='string'?nameArg:(document.getElementById('firstRunName')?.value||'')).trim()||'Me';
  Profiles.setName(localStorage,activeProfileId,name);
  bootNeedsName=false;
  closeSheet();renderProfileChip();renderAllViews();
  if(Sync)try{Sync.flush();Sync.downSync().then(()=>renderCoach()).catch(()=>{});}catch{}
}
// ---- Profile settings (active profile only) ----
function profileSettingsMarkup(){
  if(!Profiles)return '';
  const p=Profiles.getActive(localStorage);if(!p)return '';
  const many=Profiles.listProfiles(localStorage).length>1;
  // P1-4: every action is bound to THIS profile id at render time; each handler re-checks the
  // registry before acting, so a tab whose Settings sheet went stale can never hit the wrong person.
  return `<div class="section-heading"><div><p class="kicker">PROFILE</p><h2>${esc(p.name||'Unnamed')}</h2></div><button class="text-button" onclick="openProfileSwitcher()">Switch</button></div>
    <div class="field"><label>NAME</label><input id="profileName" data-profile-id="${p.id}" value="${esc(p.name)}" placeholder="Your name" oninput="onRenameProfile('${p.id}',this.value)"></div>
    <div class="stack">
      ${p.locked?`<button class="secondary-button full-button" onclick="removeActivePin('${p.id}')">Remove PIN lock</button>`:`<button class="secondary-button full-button" onclick="openSetPin('${p.id}')">Set a PIN lock</button>`}
      ${many?`<button class="secondary-button full-button" style="color:var(--danger)" onclick="confirmDeleteProfile('${p.id}')">Delete this profile</button>`:''}
    </div>
    <p style="color:var(--taupe);font-size:11px;margin:8px 2px 4px">A PIN stops casual switching, not a determined snoop. Data still lives unencrypted in this browser.</p>`;
}
// The bound id must still be BOTH this tab's active profile and the registry's current activeId.
function settingsTargetOk(id){
  if(!Profiles||!id)return false;
  const reg=Profiles.getRegistry(localStorage);
  return !!reg&&reg.activeId===id&&id===activeProfileId;
}
function onRenameProfile(id,value){
  if(!settingsTargetOk(id))return showToast('Profile changed in another tab');
  Profiles.setName(localStorage,id,value);renderProfileChip();
}
// Removing the lock requires the CURRENT PIN (P0-1c): keypad verify first, then clearPin(pin).
function removeActivePin(id){
  if(!settingsTargetOk(id))return showToast('Profile changed in another tab');
  const p=Profiles.getProfile(localStorage,id);if(!p)return;
  openPinGate(p,async pin=>{
    const ok=await Profiles.clearPin(localStorage,id,pin);
    closeSheet();renderProfileChip();openSettings();
    showToast(ok?'PIN lock removed':'Could not remove the PIN');
  });
}
function confirmDeleteProfile(id){
  const p=Profiles.getProfile(localStorage,id);if(!p)return;
  document.getElementById('confirmContent').innerHTML=`<h2>Delete ${esc(p.name||'this profile')}?</h2><p>This permanently removes ${esc(p.name||'this profile')}’s history, routines, favourites and settings from this phone. It cannot be undone.</p><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep it</button><button class="primary-button" style="background:var(--danger)" onclick="doDeleteProfile('${id}')">Delete</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function doDeleteProfile(id){
  if(!settingsTargetOk(id)){closeConfirm();return showToast('Profile changed in another tab');}
  const wasActive=id===activeProfileId;
  const res=Profiles.deleteProfile(localStorage,id);
  closeConfirm();
  if(!res.ok){showToast('You need at least one profile');return;}
  unlockedProfiles.delete(id);
  showToast('Profile deleted');
  if(wasActive){closeSheet();enterProfile(res.newActiveId);}
  else{renderProfileChip();openSettings();}
}
// ---- PIN entry (custom keypad sheet; council: UI privacy boundary, not forensic security) ----
let pinBuffer='';
let pinContext=null; // {mode:'gate',profile,onSuccess} | {mode:'set',first}
// mandatory=true (boot gate for the ACTIVE locked profile): NON-DISMISSIBLE — no × path back to
// the app, Escape ('cancel') intercepted; the only ways out are the keypad or switching person.
function openPinGate(profile,onSuccess,mandatory){
  pinBuffer='';pinContext={mode:'gate',profile,onSuccess,mandatory:!!mandatory};
  renderPinSheet(`Enter ${profile.name||'profile'}’s PIN`,'4-digit PIN to open this profile.');
  document.getElementById('sheet').showModal();
}
function openSetPin(id){
  if(!settingsTargetOk(id))return showToast('Profile changed in another tab');
  pinBuffer='';pinContext={mode:'set',first:null,targetId:id};
  renderPinSheet('Set a PIN','Choose a 4-digit PIN for this profile.');
  document.getElementById('sheet').showModal();
}
function renderPinSheet(title,sub){
  const dots=[0,1,2,3].map(i=>`<span class="pin-dot${i<pinBuffer.length?' on':''}"></span>`).join('');
  const keys=['1','2','3','4','5','6','7','8','9','','0','back'];
  const pad=keys.map(k=>!k?'<span class="pin-key ghost"></span>':`<button class="pin-key${k==='back'?' pin-back':''}" type="button" onclick="pinKey('${k}')" aria-label="${k==='back'?'Delete':k}">${k==='back'?'⌫':k}</button>`).join('');
  const mandatory=!!(pinContext&&pinContext.mandatory);
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${esc(title)}</h2>${mandatory?'':'<button class="close-button" onclick="closePinSheet()">×</button>'}</div>
    <p class="pin-sub" id="pinSub">${esc(sub)}</p>
    <div class="pin-dots">${dots}</div>
    <div class="pin-pad">${pad}</div>
    ${pinContext&&pinContext.mode==='gate'?`<button class="text-button pin-switch" onclick="openProfileSwitcher()">Switch person</button>`:''}`;
}
function refreshPinDots(){document.querySelectorAll('.pin-dots .pin-dot').forEach((d,i)=>d.classList.toggle('on',i<pinBuffer.length));}
function pinKey(k){
  if(k==='back'){pinBuffer=pinBuffer.slice(0,-1);refreshPinDots();return;}
  if(pinBuffer.length>=4)return;
  pinBuffer+=k;refreshPinDots();
  if(pinBuffer.length===4)setTimeout(pinComplete,110);
}
async function pinComplete(){
  const entered=pinBuffer;
  if(!pinContext)return;
  if(pinContext.mode==='gate'){
    const ok=await Profiles.verifyPin(pinContext.profile,entered);
    if(ok){const cb=pinContext.onSuccess;pinContext=null;pinBuffer='';cb(entered);}
    else pinFail('Wrong PIN — try again');
    return;
  }
  // set mode: confirm the digits match before committing (target bound at render time — P1-4)
  if(!pinContext.first){pinContext.first=entered;pinBuffer='';renderPinSheet('Confirm PIN','Enter the same 4 digits again.');return;}
  if(pinContext.first!==entered){pinContext.first=null;pinBuffer='';renderPinSheet('Set a PIN','Choose a 4-digit PIN for this profile.');showToast('PINs didn’t match — start again');return;}
  const target=pinContext.targetId;
  if(!settingsTargetOk(target)){pinContext=null;pinBuffer='';closeSheet();showToast('Profile changed in another tab');return;}
  await Profiles.setPin(localStorage,target,entered);
  unlockedProfiles.add(target); // don't re-lock the profile you're sitting in this session
  pinContext=null;pinBuffer='';
  closeSheet();renderProfileChip();openSettings();showToast('PIN lock on');
}
function pinFail(msg){pinBuffer='';refreshPinDots();const el=document.querySelector('.pin-dots');if(el){el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');}showToast(msg);}
function closePinSheet(){if(pinContext&&pinContext.mandatory)return;pinContext=null;pinBuffer='';closeSheet();}

saveState();
renderProfileChip();
// Render the active profile's data — UNLESS it's locked and not yet unlocked this page-load, in which
// case its data is never rendered until the PIN clears (council: locked = data hidden).
function renderAllViews(){renderToday();renderTrain();renderLibrary();renderProgress();}
function afterUnlockBoot(){
  renderAllViews();
  // Flush any queued sessions and pull the latest coach plan on launch — silent, deferred, never blocking.
  if(Sync)try{Sync.flush();Sync.downSync().then(()=>renderCoach()).catch(()=>{});}catch{}
}
// Gate the ACTIVE locked profile behind a non-dismissible PIN sheet with a NEUTRAL shell behind it:
// in-memory state is swapped to empty (and saveState blocked via lockGate) so even a forced
// dismissal renders zero profile data and can never persist over the real state (P0-1).
function gateLockedProfile(profile){
  lockGate=true;state=emptyState();
  renderAllViews();
  openPinGate(profile,()=>{
    unlockedProfiles.add(profile.id);
    lockGate=false;state=readState();
    closeSheet();afterUnlockBoot();
  },true);
}
(function bootApp(){
  const active=Profiles?Profiles.getActive(localStorage):null;
  if(bootNeedsName){renderAllViews();openFirstRunSheet();return;}
  if(active&&active.locked&&!unlockedProfiles.has(activeProfileId)){gateLockedProfile(active);return;}
  afterUnlockBoot();
})();
// The mandatory gate is non-dismissible: Escape fires 'cancel' on the dialog — intercept it.
document.getElementById('sheet').addEventListener('cancel',event=>{
  if((pinContext&&pinContext.mandatory)||lockGate)event.preventDefault();
});
// Cross-tab identity sync (P1-4): if another tab changes the registry, re-sync this tab's active
// profile (adopting its lock state) instead of acting on a stale identity.
window.addEventListener('storage',event=>{
  if(!Profiles||event.key!==Profiles.PROFILES_KEY)return;
  const reg=Profiles.getRegistry(localStorage);if(!reg)return;
  if(reg.activeId!==activeProfileId){
    activeProfileId=reg.activeId;
    stateKey=Profiles.stateKeyFor(activeProfileId);
    if(Sync&&Sync.setUser)Sync.setUser(Profiles.syncKeyFor(activeProfileId));
    clearInterval(activeTimer);clearInterval(restTimer);
    const p=Profiles.getActive(localStorage);
    renderProfileChip();
    if(p&&p.locked&&!unlockedProfiles.has(p.id)){gateLockedProfile(p);return;}
    lockGate=false;state=readState();renderAllViews();
    return;
  }
  renderProfileChip(); // rename/PIN change elsewhere — refresh the chip only
});
