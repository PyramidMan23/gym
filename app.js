'use strict';

const Core = DuckGymCore;
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

function emptyState(){ return {version:2,routines:[],history:[],customExercises:[],activeSession:null,preferences:{restSeconds:90,weeklyWorkoutGoal:4,weeklySetGoal:48,weeklyVolumeGoal:10000}}; }
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
function showToast(message){ const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),1900); }

function navigate(view){
  if(state.activeSession&&view!=='workout'&&!confirm('Leave the workout screen? Your workout will keep running.')) return;
  currentView=view;
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  document.querySelectorAll('.bottom-nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
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
  const weekly=Core.weeklyStats(state.history);
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
  document.getElementById('activityRings').innerHTML=rings.map(ring=>`<div class="arc-gauge"><svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(135 50 50)"><circle class="arc-track" cx="50" cy="50" r="${R}" style="stroke-dasharray:${ARC} ${C}"></circle><circle class="arc-fill arc-fill-${ring.key}" cx="50" cy="50" r="${R}" style="stroke-dasharray:${ARC} ${C};stroke-dashoffset:${ARC*(1-ring.ratio)}"></circle></g></svg><div class="arc-value"><strong>${fmt(ring)}</strong><b>/ ${fmtGoal(ring)}</b></div><span class="arc-label">${ring.label}</span></div>`).join('');
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
  return `<button class="history-card" onclick="openHistory('${session.id}')"><span class="history-top"><span><h3>${esc(session.name)}</h3><time>${formatDate(session.started)}</time></span><span>›</span></span><span class="history-meta"><span>${summary.durationMinutes} min</span><span>${summary.completedSets} sets</span><span>${compact(summary.volume)} kg</span>${prs?`<span class="pr-badge">${prs} PR${prs===1?'':'s'}</span>`:''}</span></button>`;
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
function exerciseRow(exercise,addAction='quickExercise'){ return `<article class="exercise-row"><div><strong>${esc(exercise.name)}</strong><small>${esc(exercise.muscle)} · ${esc(exercise.equipment||'Custom equipment')}</small></div><button class="exercise-add" onclick="${addAction}('${exercise.id}')" aria-label="Add ${esc(exercise.name)}">＋</button></article>`; }
function setMuscleFilter(group){muscleFilter=group;renderLibrary();}
function quickExercise(id){
  if(state.activeSession){addExerciseToWorkout(id);showToast('Added to current workout');return;}
  const exercise=exerciseById(id);beginSession({id:null,name:exercise?.name||'Quick workout',exerciseIds:[id]});
}

function renderProgress(){
  const weekly=Core.weeklyStats(state.history),lifetimeVolume=state.history.reduce((sum,s)=>sum+Core.calculateVolume(s),0),allPRs=state.history.reduce((sum,s)=>sum+(s.prs?.length??s.prs??0),0);
  document.getElementById('progressStats').innerHTML=`<div class="metric"><strong>${weekly.workouts}</strong><span>WORKOUTS THIS WEEK</span></div><div class="metric"><strong>${state.history.length}</strong><span>TOTAL SESSIONS</span></div><div class="metric"><strong>${compact(lifetimeVolume)}</strong><span>LIFETIME KG</span></div>`;
  renderWeekChart();
  document.getElementById('historyList').innerHTML=state.history.length?state.history.map(historyCard).join(''):`<div class="empty-card card"><strong>Your progress starts at one</strong>Finish a workout and it will appear here.</div>`;
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
  document.getElementById('workoutExercises').innerHTML=session.exercises.length?session.exercises.map(workoutExerciseMarkup).join(''):`<div class="empty-card card"><strong>Empty workout</strong>Add your first exercise and get moving.</div>`;
  startActiveClock();
}
function renderWorkoutMetrics(){
  const session=state.activeSession;if(!session)return;
  const summary=Core.summarizeSession({...session,finished:Date.now()});
  document.getElementById('workoutMetrics').innerHTML=`<div class="live-metric"><strong>${summary.completedSets}</strong><small>Sets done</small></div><div class="live-metric"><strong>${compact(summary.volume)}</strong><small>Volume kg</small></div><div class="live-metric"><strong>${session.exercises.length}</strong><small>Exercises</small></div>`;
}
function workoutExerciseMarkup(exercise,index){
  const item=exerciseById(exercise.exerciseId),previous=Core.previousPerformance(state.history,exercise.exerciseId);
  const prevText=previous.length?`Last time: ${previous.slice(0,3).map(s=>`${s.weight||'—'} kg × ${s.reps}`).join(' · ')}`:'First time — set your benchmark';
  return `<article class="workout-exercise"><header class="exercise-head"><div><h2>${esc(item?.name||'Exercise')}</h2><p>${esc(item?.equipment||'')}</p></div><button class="exercise-more" onclick="openWorkoutExerciseMenu(${index})" aria-label="Exercise options">•••</button></header><div class="previous-strip">${esc(prevText)}</div><div class="set-grid header"><span>Set</span><span>kg</span><span>Reps</span><span>Done</span></div>${exercise.sets.map((set,setIndex)=>setMarkup(set,index,setIndex,previous[setIndex]||previous[0])).join('')}<button class="add-set" onclick="addSet(${index})">＋ Add set</button></article>`;
}
function setMarkup(set,exerciseIndex,setIndex,previous){const completion=Core.setCompletionState(set.done,setIndex+1);return `<div class="set-grid set-row ${completion.className}" data-status="${completion.status}"><span class="set-number">${setIndex+1}</span><input class="set-input" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(set.weight)}" placeholder="${previous?.weight||'—'}" onchange="updateSet(${exerciseIndex},${setIndex},'weight',this.value)" aria-label="Weight for set ${setIndex+1}"><input class="set-input" type="number" inputmode="numeric" min="0" step="1" value="${esc(set.reps)}" placeholder="${previous?.reps||'—'}" onchange="updateSet(${exerciseIndex},${setIndex},'reps',this.value)" aria-label="Repetitions for set ${setIndex+1}"><button class="set-done ${set.done?'done':''}" onclick="toggleSet(${exerciseIndex},${setIndex})" aria-label="${completion.actionLabel}" title="${completion.status}"><span aria-hidden="true">${set.done?'✓':'○'}</span></button></div>`;}
function updateSet(exerciseIndex,setIndex,key,value){state.activeSession.exercises[exerciseIndex].sets[setIndex][key]=value;saveState();renderWorkoutMetrics();}
function toggleSet(exerciseIndex,setIndex){
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];set.done=!set.done;
  if(set.done){startRest(state.preferences.restSeconds);if(setIndex===state.activeSession.exercises[exerciseIndex].sets.length-1)addSet(exerciseIndex,true);}
  saveState();renderWorkout();
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
function updateRest(){document.getElementById('restTime').textContent=Core.formatDuration(restRemaining);}

function requestFinishWorkout(){
  const session=state.activeSession,summary=Core.summarizeSession({...session,finished:Date.now()});
  document.getElementById('confirmContent').innerHTML=`<h2>Finish workout?</h2><p>${summary.completedSets} completed sets · ${compact(summary.volume)} kg moved.</p><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep training</button><button class="primary-button" onclick="finishWorkout()">Finish</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function finishWorkout(){
  const session=state.activeSession;if(!session)return;
  session.finished=Date.now();session.prs=Core.detectPRs(state.history,session);
  state.history.unshift(session);state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();
  showToast(session.prs.length?`${session.prs.length} new PR${session.prs.length===1?'':'s'} — strong work`:'Workout saved — good work');navigate('progress');
}
function cancelWorkout(){
  document.getElementById('confirmContent').innerHTML=`<h2>Discard workout?</h2><p>This workout and all its sets will be permanently removed.</p><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep it</button><button class="primary-button" style="background:var(--danger)" onclick="confirmCancelWorkout()">Discard</button></div>`;document.getElementById('confirmDialog').showModal();
}
function confirmCancelWorkout(){state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();navigate('today');}
function closeConfirm(){document.getElementById('confirmDialog').close();}

function openExercisePicker(target){
  pickerTarget=target;const content=document.getElementById('sheetContent');
  content.innerHTML=`<div class="sheet-head"><h2>Add exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="search-wrap picker-search"><span>⌕</span><input id="pickerSearch" type="search" placeholder="Search exercise or equipment" oninput="renderPickerList()"></div><div id="pickerList" class="exercise-list"></div>`;
  renderPickerList();document.getElementById('sheet').showModal();
}
function renderPickerList(){
  const input=document.getElementById('pickerSearch'),query=(input?.value||'').toLowerCase();
  const list=allExercises().filter(e=>`${e.name} ${e.muscle} ${e.equipment}`.toLowerCase().includes(query)).slice(0,60);
  document.getElementById('pickerList').innerHTML=list.map(e=>exerciseRow(e,'pickExercise')).join('');
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
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${state.routines.some(r=>r.id===routineDraft.id)?'Edit':'New'} routine</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>ROUTINE NAME</label><input id="routineName" value="${esc(routineDraft.name)}" placeholder="Example: Monday upper" oninput="routineDraft.name=this.value"></div><div class="section-heading"><div><p class="kicker">EXERCISES</p><h2>${routineDraft.exerciseIds.length} selected</h2></div><button class="text-button" onclick="openExercisePicker('routine')">＋ Add</button></div><div class="selected-list">${routineDraft.exerciseIds.length?routineDraft.exerciseIds.map((id,index)=>`<div class="selected-row"><span><strong>${index+1}. ${esc(exerciseById(id)?.name||'Missing exercise')}</strong></span><button onclick="removeRoutineExercise(${index})">Remove</button></div>`).join(''):'<div class="empty-card card">Add exercises in the order you want to train.</div>'}</div><div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="saveRoutine()">Save routine</button></div>`;
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
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${esc(name)}</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>WORKOUT NOTE</label><textarea id="exerciseNote" rows="3" placeholder="Cues, seat position, pain notes…">${esc(exercise.notes||'')}</textarea></div><div class="sheet-actions"><button class="secondary-button" style="color:var(--danger)" onclick="removeWorkoutExercise(${index})">Remove</button><button class="primary-button" onclick="saveExerciseNote(${index})">Save note</button></div>`;document.getElementById('sheet').showModal();
}
function saveExerciseNote(index){state.activeSession.exercises[index].notes=document.getElementById('exerciseNote').value.trim();saveState();closeSheet();showToast('Note saved');}
function removeWorkoutExercise(index){state.activeSession.exercises.splice(index,1);saveState();closeSheet();renderWorkout();}

function openCustomExercise(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Custom exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>EXERCISE NAME</label><input id="customName" placeholder="Example: Landmine press"></div><div class="field"><label>MUSCLE GROUP</label><select id="customMuscle">${['Chest','Back','Shoulders','Arms','Grip','Legs','Core','Full Body','Cardio','Mobility'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>EQUIPMENT</label><input id="customEquipment" placeholder="Example: Cable machine"></div><button class="primary-button full-button" onclick="saveCustomExercise()">Add exercise</button>`;document.getElementById('sheet').showModal();
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
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Settings & data</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>DEFAULT REST TIMER</label><select id="restSetting" onchange="setRestPreference(this.value)">${[60,90,120,180].map(x=>`<option value="${x}" ${state.preferences.restSeconds===x?'selected':''}>${x/60} ${x===60?'minute':'minutes'}</option>`).join('')}</select></div><div class="stack"><button id="installButton" class="secondary-button full-button" onclick="installApp()">Install Gym</button><button class="secondary-button full-button" onclick="exportBackup()">Download backup</button><button class="secondary-button full-button" onclick="document.getElementById('importInput').click()">Import backup</button><button class="secondary-button full-button" style="color:var(--danger)" onclick="clearAllData()">Clear all data</button></div><p style="color:var(--muted);font-size:12px;margin-top:18px">Private by default. Your training data stays in this browser unless you export it.</p>`;document.getElementById('sheet').showModal();
}
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

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
window.addEventListener('beforeunload',event=>{if(state.activeSession){event.preventDefault();event.returnValue='';}});
if('serviceWorker' in navigator&&location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
document.getElementById('sheet').addEventListener('click',event=>{if(event.target===event.currentTarget)closeSheet();});
saveState();
if(state.activeSession)renderToday();else renderToday();
renderTrain();renderLibrary();renderProgress();
