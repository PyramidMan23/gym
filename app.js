'use strict';

const Core = DuckGymCore;
// Hold-type exercises store SECONDS in the `reps` field. Register them with Core once, here, so
// volume/e1RM/PR/progression all agree - exercises.js loads before app.js (see index.html).
Core.setTimedExercises((typeof DUCK_EXERCISES !== 'undefined' ? DUCK_EXERCISES : []).filter(e => e.timed).map(e => e.id));
// Bodyweight load model. Registered the same way and for the same reason: one source of truth, so
// volume, coverage and the load-gap check can never disagree about what a movement loads. The
// factor table and its sourcing live next to the catalogue in exercises.js.
Core.setBodyweightModel({
  factorFor: id => (typeof gymBodyweightFactor === 'function' ? gymBodyweightFactor(exerciseById(id)) : null),
  // Resolution order, most authoritative first: the value PINNED on the session when it was
  // finished (a completed session's numbers must never move again, whatever the lifter weighs
  // later); then the latest weigh-in AT OR BEFORE it, NEVER a later one (council 2026-08-05: the
  // first version took the nearest in either direction, so a new weigh-in changed old sessions);
  // then a backfill the lifter explicitly confirmed for sessions older than their first weigh-in.
  // try/catch guards the temporal dead zone: `state` is declared further down this file, and a
  // ReferenceError here would take out volume for the whole app rather than degrading to "unknown".
  bodyweightFor: session => {
    try {
      if (Number(session && session.bodyweightKg) > 0) return Number(session.bodyweightKg);
      return Core.bodyweightAsOf(state && state.bodyweight, session && session.started,
        state && state.preferences && state.preferences.backfillBodyweight);
    } catch { return null; }
  }
});
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
let currentBuzzView = 'today'; // last tab that ticked - one haptic per change, never per render
let activeTimer = null;
let restTimer = null;
let restRemaining = 0;
let restExerciseIndex = 0; // which exercise the running rest belongs to - drives rest-end progression
let padTarget = null;      // {exIdx,setIdx,key} the numeric pad is editing
let padHold = null;        // press-and-hold acceleration timer for the pad
let routineDraft = null;
let pickerTarget = null;
let deferredInstall = null;

const workouts = (typeof GYM_WORKOUTS!=='undefined') ? GYM_WORKOUTS : [];
const plans = (typeof GYM_PLANS!=='undefined') ? GYM_PLANS : [];
const prepMap = (typeof GYM_PREP!=='undefined') ? GYM_PREP : {warmup:{},cooldown:{}};

function emptyState(){ return {version:2,routines:[],history:[],customExercises:[],activeSession:null,exerciseCues:{},favourites:[],bodyweight:[],goals:[],preferences:{restSeconds:90,weeklyWorkoutGoal:4,weeklySetGoal:48,weeklyVolumeGoal:10000,weightStep:2.5,haptics:true}}; }
// Reads the ACTIVE profile's namespaced state. Legacy dg_*/duckGymV2 migration is bootProfiles()'s job,
// so a brand-new profile's missing key correctly yields an empty state (never another profile's data).
function readState(){
  try{
    const saved=JSON.parse(localStorage.getItem(stateKey));
    if(saved?.version===2){
      const preferences={...emptyState().preferences,...saved.preferences,...Core.normalizeActivityGoals(saved.preferences)};
      // Injury mode is new (2026-07-22). A profile that already has training history was using the
      // pain check-in and its tolerance gate, so it keeps them; a brand-new profile starts without.
      // Never silently disable someone's existing safety net.
      if(preferences.injuryMode===undefined)preferences.injuryMode=Array.isArray(saved.history)&&saved.history.length>0;
      // Goals are sanitised on read: a malformed row must never throw inside a render.
      return {...emptyState(),...saved,goals:Core.normalizeGoals(saved.goals),preferences};
    }
  }catch{}
  return emptyState();
}
bootProfiles();
let state=readState();
// While a locked profile is gated (P0-1), state is a neutral empty shell and MUST never be
// persisted - otherwise stray interactions behind the gate could clobber the real data.
let lockGate=false;
function saveState(){
  if(lockGate)return false;
  try{localStorage.setItem(stateKey,JSON.stringify(state));return true;}
  catch(error){console.error('Duck Gym could not persist state',error);showToast('Could not save - browser storage is full');return false;}
}
function allExercises(){ return [...DUCK_EXERCISES,...state.customExercises]; }
function exerciseById(id){ return allExercises().find(exercise=>exercise.id===id); }
function esc(value){ return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function compact(number){ const n=Number(number)||0; return n>=1e6?(n/1e6).toFixed(1)+'m':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n)); }
// 1st/2nd/3rd/4th... 11-13 are the exception every naive version gets wrong.
function ordinal(n){const v=Math.abs(Math.round(Number(n)||0)),t=v%100;if(t>=11&&t<=13)return `${v}th`;return `${v}${['th','st','nd','rd'][v%10]||'th'}`;}
function formatDate(timestamp){ return new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short'}).format(new Date(timestamp)); }
function showToast(message,isPr=false){ const el=document.getElementById('toast');
  // Below the fixed chrome, never over it: the PR toast was landing on the workout clock + Finish.
  const chrome=document.querySelector('body.workout-active .workout-header')||document.querySelector('.app-header');
  el.style.top=chrome?`${Math.round(chrome.getBoundingClientRect().bottom)+10}px`:'18px';
  el.textContent=message;el.classList.toggle('pr',isPr);el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),isPr?3200:1900); }
const REDUCED_MOTION=matchMedia('(prefers-reduced-motion: reduce)').matches;
// PR moment (POLISH): celebrate a live PR at most once per exercise per session. Keyed on the
// session object identity so a new session (or a boot-reloaded one) starts fresh. Transient - never persisted.
let prCelebratedSession=null;const prCelebrated=new Set();
// Haptics: a short buzz that announces a real event (set done / PR / rest end), never navigation.
// Gated on the profile toggle + navigator.vibrate - iOS PWAs have no vibrate, so this no-ops silently.
function buzz(pattern){ try{ if(Core.shouldBuzz(state.preferences,'vibrate' in navigator))navigator.vibrate(pattern); }catch{} }
// Number roll: old span slides up, new span slides in - transform/opacity only, gated on reduced-motion.
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
// One earned line from real state only - no canned encouragement, no exclamation marks.
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
    // A pending set counts once it has data OR was born planned by a workout scheme - only the
    // auto-added trailing set doesn't block "all complete".
    const planned=s.exercises.reduce((n,ex)=>n+ex.sets.filter(x=>x.done||x.planned||x.weight!==''||x.reps!=='').length,0);
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
    // `document.hidden` matters as much as reduced motion: requestAnimationFrame does NOT run in a
    // background tab, so a count-up started while hidden freezes at its start value and the surface
    // shows a WRONG number until something re-renders it (the rAF-in-a-hidden-tab bug class). When
    // there is no frame loop, skip the animation and state the true value immediately.
    if(REDUCED_MOTION||document.hidden||!target){el.textContent=fmt(target);return;}
    const start=performance.now(),duration=650;
    const step=now=>{const k=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-k,3);el.textContent=fmt(target*eased);if(k<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  });
}

// Material-only scroll response (council 2026-07-20): chrome deepens, geometry never moves.
// Nav condenses on scroll for EVERYONE (Mark, 2026-08-01): height compresses, buttons keep
// their horizontal geometry, labels tuck away. Was an opt-in preference; the stale
// preferences.navCondense key is simply never read again.
// SLICE NAV (2026-08-02): SliceCo's transform-only minimise, ported 1:1 - the capsule recedes on
// scroll-down and returns on scroll-up. Guards match SliceCo's: never while a dialog is open (the
// bar must stay put under a sheet), never near the top, never under reduced motion. Layout never
// shifts because the class only drives a transform, so no clearance recalculates.
// Android Chrome reports env(safe-area-inset-bottom)=0 in a standalone PWA under
// viewport-fit=cover, so anything pinned to that inset slides UNDER the system nav buttons -
// which is exactly what the capsule is now pinned to. SliceCo's probe, ported: measure the
// resolved inset, and when it is 0 on a standalone Android session disambiguate by GEOMETRY
// rather than trusting it. env()=0 is ambiguous - either the OS kept the window above the
// system bar (3-button nav, so 0 is the truth) or Chromium drew us under the gesture bar and
// under-reported. A 3-button bar is >=48px, so a remaining gap >=24px means the window stops
// above it and needs no inset. innerHeight is keyboard-stable, so this never churns while typing.
function measureBottomInset(){
  try{
    const probe=document.createElement('div');
    probe.style.cssText='position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const envBottom=parseFloat(getComputedStyle(probe).paddingBottom)||0;
    probe.remove();
    const standalone=matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches||navigator.standalone===true;
    let inset=envBottom;
    if(envBottom<=0&&standalone&&/Android/i.test(navigator.userAgent||'')){
      const screenH=(screen&&screen.height)||0;
      // gesture-pill clearance is ~24dp, not 44
      if(screenH>0&&screenH-((window.screenY||0)+innerHeight)<24)inset=24;
    }
    document.documentElement.style.setProperty('--sai-bottom',inset+'px');
  }catch(_){}
}
measureBottomInset();
addEventListener('resize',measureBottomInset);
addEventListener('orientationchange',measureBottomInset);

let lastNavY=0;
// The floating nav is fixed, so at some scroll offsets it lands ON TOP of a primary action. On Today
// at scrollY=0 - the position the app OPENS in - it covered the Start CTA completely: the button's
// centre hit .bottom-nav, so elementFromPoint never reached it and the main action was untappable
// until you scrolled 139px. The prototype cannot arbitrate this (it is a device mock whose nav sits
// in normal flow), so it is measured against our own layout.
// Collision is computed from LIVE rectangles every scroll, never a hardcoded offset, and the nav is
// only yielded while it genuinely overlaps. Deliberately does NOT touch the card, the CTA, the
// gutter, spacing, paint or the initial scroll position - the design fidelity stays exactly as
// ported; only the chrome floating above it gets out of the way.
function navCollidesWithCTA(){
  const nav=document.querySelector('.bottom-nav');
  const cta=document.querySelector('.up-next-cta');
  if(!nav||!cta)return false;
  const n=nav.getBoundingClientRect(),c=cta.getBoundingClientRect();
  if(c.bottom<=0||c.top>=innerHeight)return false;          // CTA off screen: nothing to protect
  // Only yield when the nav covers the CTA's CENTRE, because that is exactly what makes the button
  // unreachable (elementFromPoint at the centre is what a tap resolves against). A 2px graze left
  // the button perfectly tappable but hid the whole nav on the home screen - too aggressive, and
  // state-dependent enough that a longer profile name could flip it.
  const cy=c.top+c.height/2, cx=c.left+c.width/2;
  return cy>n.top && cy<n.bottom && cx>n.left && cx<n.right;
}
function syncNavYield(){
  document.body.classList.toggle('nav-yield',navCollidesWithCTA());
}
addEventListener('scroll',()=>{
  const b=document.body.classList,y=scrollY,dy=y-lastNavY;lastNavY=y;
  b.toggle('scrolled',y>10);
  syncNavYield();
  if(matchMedia('(prefers-reduced-motion:reduce)').matches||document.querySelector('dialog[open]')){b.remove('nav-min');return;}
  if(y<64){b.remove('nav-min');return;}
  if(dy>4)b.add('nav-min');else if(dy<-4)b.remove('nav-min');
},{passive:true});
addEventListener('resize',syncNavYield);
// SliceCo's press ring ("water droplet"), same fire pattern as its global .tap handler: on
// pointerdown (so the ring starts BEFORE the pane swap), restart via remove + reflow + add so a
// rapid double-tap re-fires instead of silently reusing the finished animation.
document.getElementById('bottomNav').addEventListener('pointerdown',e=>{
  const b=e.target.closest('button');if(!b)return;
  b.classList.remove('ring');void b.offsetWidth;b.classList.add('ring');
  setTimeout(()=>b.classList.remove('ring'),600);
},{passive:true});
function setBarWeight(v){state.preferences.barWeight=Number(v)||20;saveState();openSettings();}
// Turning injury mode on/off changes which evidence gate progression uses, so re-render everything.
function toggleInjuryMode(on){state.preferences.injuryMode=!!on;saveState();closeSheet();renderAllViews();if(state.activeSession)renderWorkout();showToast(on?'Injury mode on - pain check-ins added':'Injury mode off');}
function navigate(view){
  // No confirm() gate (Mark, 2026-07-28): the browser-chrome "thesolvagroup.com says" dialog on
  // every mid-workout tab switch was the most webpage-looking moment in the app. Tabs just swap -
  // the session keeps running and the return chip below is the always-visible way back.
  // A fresh Library open always starts unfiltered - a stale filter must never silently hide exercises (council 2026-07-19).
  if(view==='library')libraryFilter=newFilterState();
  const from=currentView;
  currentView=view;
  const swap=()=>{
    document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
    document.querySelectorAll('.bottom-nav button').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
    document.body.classList.toggle('workout-active',view==='workout');
    renderView(view);
  };
  // Pane transition, ported from the live sliceco.app switchTab (Mark 2026-08-03: "why does this
  // cause a block around the section and a flash?"). Two real causes. The incoming view was
  // hard-swapped out of display:none with NOTHING covering the gap, and every direct child then ran
  // its own staggered `rise` - 0.35s each on delays out to 0.2s, so 550ms of blocks punching in one
  // at a time. THEN w25's opaque curtain turned out to be its OWN flash, and that one was mine: it
  // painted flat var(--page), but this app's real background is that colour PLUS two fixed radial
  // blooms (amber at 16%) at z-index -1. Covering them and fading out washed a 16% tint back across
  // the WHOLE screen on every tab tap - measured, and visible on the website as well as the PWA.
  // Any opaque full-screen overlay is incompatible with a translucent-content-over-bloom design, so
  // there is no overlay now: a plain synchronous swap (exactly what the fuel app does, which Mark
  // says is smooth) plus a 14px slide on the incoming pane. The w24 premise that a hard swap leaves
  // a bare frame was false - display:none -> block inside ONE tick paints one complete frame.
  const ORDER={today:0,train:1,library:2,progress:3};
  const next=document.getElementById(`view-${view}`);
  const main=document.getElementById('main');
  const slide=!matchMedia('(prefers-reduced-motion:reduce)').matches
    && next && from!==view && ORDER[from]!==undefined && ORDER[view]!==undefined;
  main.classList.remove('pane-fwd','pane-back');
  if(slide)main.classList.add(ORDER[view]>ORDER[from]?'pane-fwd':'pane-back');
  swap();
  // Restart the slide explicitly: without the reflow read the browser reuses the already-finished
  // animation and the pane simply appears with no motion at all.
  if(slide){next.style.animation='none';void next.offsetWidth;next.style.animation='';}
  if(ORDER[view]!==undefined&&view!==currentBuzzView){buzz(8);currentBuzzView=view;} // one gated tick per tab change
  renderReturnChip();
  const navIdx={today:0,train:1,library:2,progress:3}[view];
  // instant, not the default: html{scroll-behavior:smooth} would ANIMATE this reset, so the new
  // pane visibly scrolled up under the curtain and the curtain (absolute in #main) drifted with
  // it - a third motion artifact hiding inside what looked like a plain reset.
  window.scrollTo({top:0,behavior:'instant'});
  document.getElementById('main').focus({preventScroll:true});
}
// Persistent way back to a live session from ANY tab - replaces the confirm() gate. Shows name +
// live clock; paused sessions say so. Hidden on the workout screen itself (nav is hidden there too).
let returnChipTimer=null;
function renderReturnChip(){
  const el=document.getElementById('returnChip');if(!el)return;
  const s=state.activeSession;
  const show=!!s&&currentView!=='workout';
  el.hidden=!show;
  if(returnChipTimer){clearInterval(returnChipTimer);returnChipTimer=null;}
  if(!show)return;
  const paint=()=>{const paused=!!s.pausedAt;
    el.innerHTML=`<span class="rc-dot${paused?' rc-paused':''}" aria-hidden="true"></span><span class="rc-text"><strong>${esc(s.name)}</strong><small>${paused?'Paused':'On the clock'} · ${Core.formatDuration(Core.sessionElapsedMs(s)/1000)}</small></span><b aria-hidden="true">›</b>`;};
  paint();
  returnChipTimer=setInterval(()=>{if(!state.activeSession||currentView==='workout'){renderReturnChip();return;}paint();},1000);
}
function renderView(view){
  if(view==='today')renderToday();
  if(view==='train')renderTrain();
  if(view==='library')renderLibrary();
  if(view==='progress')renderProgress();
  if(view==='workout')renderWorkout();
}

function renderToday(){
  requestAnimationFrame(syncNavYield);   // the collision exists at scrollY=0, before any scroll fires

  const hour=new Date().getHours();
  document.getElementById('todayKicker').textContent=new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date()).toUpperCase();
  const who=activeProfileName();
  const nameBit=who&&who!=='me'?`, ${who}`:'';
  // "Let's finish strong" is generated purely from the clock and is absurd before a session. The
  // informative line was the small grey one underneath, so that becomes the header's job.
  document.getElementById('todayTitle').textContent=who&&who!=='me'?`${who}’s week`:'Your week';
  document.getElementById('todayPrompt').textContent=contextLine();
  const weekly=Core.weeklyStats(state.history);
  // Computed ONCE and shared, so the rest state and the deload card can never both claim the same
  // message (the first draft rendered "back off this week" twice, one above the other).
  const rest=restDayRead(weekly);
  renderDeload(rest);
  renderCoach();
  renderDeskReset();
  renderTodayGoal();
  renderActivityRings(weekly);
  renderWeekDots();
  renderTodayHero(rest);
  renderTodayAdvisory(rest);
  renderTodayDose();
  // A paused session must not read as "in progress" with a live pulse - the card states the real state.
  const live=state.activeSession,livePaused=!!live?.pausedAt;
  document.getElementById('resumeSlot').innerHTML=live?`<div class="resume-card${livePaused?'':' card-live'}"><strong>${livePaused?'':'<span class="live-dot" aria-hidden="true"></span>'}Workout ${livePaused?'paused':'in progress'}</strong><p>${esc(live.name)} · ${Core.formatDuration(Core.sessionElapsedMs(live)/1000)} on the clock</p><button onclick="resumeWorkout()">${livePaused?'Open workout':'Resume workout'}</button></div>`:'';
  const routines=state.routines.slice(0,6),doneThisWeek=Core.routinesDoneThisWeek(state.history);
  document.getElementById('todayRoutines').innerHTML=routines.length?routines.map(r=>routineStripCard(r,doneThisWeek)).join(''):`<div class="empty-card card" style="flex:1"><strong>No routines yet</strong>Start an empty workout or save one from the Train tab.</div>`;
  document.getElementById('recentSession').innerHTML=state.history.length?historyCard(state.history[0]):`<div class="group-row group-row-empty"><span class="row-text"><strong>No sessions logged</strong><small>Your first completed workout lands here.</small></span></div>`;
  // The grouped list must not render as a bare bordered box when both of its slots are empty
  // (no desk plan AND no history), so it collapses instead of leaving an empty inset.
  const group=document.getElementById('todayGroup');
  if(group)group.hidden=!group.querySelector('.group-row');
}
// Deload awareness (2026-07-28). Volume that only ever climbs is how a return to training becomes
// the next injury: the exact failure mode this app exists to prevent, and nothing modelled it.
// Advisory only: it never blocks a session and never changes a prescription.
function renderDeload(rest){
  const slot=document.getElementById('deloadSlot');if(!slot)return;
  // When the rest state is already telling this story at the top of the page, the card would be a
  // second copy of it. The card keeps the exact figures, so it wins and the rest state defers.
  if(rest&&rest.source==='deload'){slot.innerHTML='';return;}
  const check=Core.deloadCheck(state.history);
  slot.innerHTML=check.due
    ?`<section class="deload-card card" aria-label="Easy week suggested"><p class="kicker">EASY WEEK SUGGESTED</p><p>${esc(check.reason)}</p></section>`
    :'';
}
// Desk Reset: the counter-dose to a laptop day. Deliberately startable in ONE tap without installing
// the plan: friction is what kills a five-minute habit, and it needs to work on a rest day too.
const DESK_PLAN=plans.find(p=>p.id==='plan-desk');
// The design reads "5 min · 6 holds · undo the laptop day" - duration, then count, then the
// description. Ours had the count last. The blurb already carries duration and description either
// side of a middot, so the design's order is composed from it rather than hardcoded.
function deskMeta(holds){
  const parts=String(DESK_PLAN.blurb).split(' · ');
  return parts.length>1 ? `${parts[0]} · ${holds} holds · ${parts.slice(1).join(' · ')}`
                        : `${DESK_PLAN.blurb} · ${holds} holds`;
}
function renderDeskReset(){
  const slot=document.getElementById('deskSlot');if(!slot||!DESK_PLAN)return;
  const day=DESK_PLAN.days[0];
  const done=Core.routinesDoneThisWeek(state.history).has('plan-desk');
  // ••• opens it as a PLAN (what it is), Start runs it (what it is for). Mark tapped the old
  // whole-row button, landed straight in a workout, and asked why he could not see it as a plan or
  // template. It was one, but nothing on this row said so (2026-07-28).
  // v2: a row in the Today grouped inset list (#todayGroup), no longer its own card. The
  // `desk-card` class moves to the GROUP, because in v2 the group IS the Desk Reset surface:
  // browser-flow selects `.desk-card` and asserts it clears the card below it (Mark's 2026-07-28
  // report), and that clearance is now the group's own margin. Same guarantee, new referent.
  document.getElementById('todayGroup')?.classList.add('desk-card');
  slot.innerHTML=`<div class="group-row desk-row"><span class="row-glyph row-glyph-teal" aria-hidden="true">↺</span><button type="button" class="desk-text" onclick="openPlan('plan-desk')" aria-label="Desk Reset plan details"><strong>Desk Reset${done?' <span class="done-badge">✓ Done</span>':''}</strong><small>${esc(deskMeta(day.exerciseIds.length))}</small></button><button class="desk-start" onclick="startDeskReset()">${done?'Again':'Start'}</button></div>`;
}
function startDeskReset(){
  const day=DESK_PLAN&&DESK_PLAN.days[0];if(!day)return;
  beginSession({id:'plan-desk',name:'Desk Reset',exerciseIds:day.exerciseIds});
}
// Today led with a 348px ring reporting "30% WEEK CHARGED" - a number blending sessions, sets and
// volume that nobody can act on, eating 27% of the page (measured 2026-08-05, both engines flagged
// it). The ring stays, smaller, and now has to earn its place by being followed by the ONE thing to
// do next. Plain counts sit beside it because "1 of 4 sessions" is actionable and a percentage is not.
// ---- Landing hero: the executable next session --------------------------------------------------
// Council 2026-08-05. Best-in-class opens on work you can start, not on a score. So the hero names
// the actual session AND its first prescribed targets, computed from this lifter's own evidence -
// the same nextTarget the cockpit uses, so the two can never disagree.
function renderTodayHero(rest){
  const host=document.getElementById('todayHero'); if(!host)return;
  if(state.activeSession){host.innerHTML='';return;} // the resume card already owns this job
  if(rest){
    host.innerHTML=`<section class="today-rest"><p class="kicker">${esc(rest.kicker)}</p><strong>${esc(rest.title)}</strong><small>${esc(rest.detail)}</small>`
      +`<div class="today-rest-actions"><button class="secondary-button" onclick="startDeskReset()">Desk Reset · 5 min</button>`
      +`<button class="text-button" onclick="navigate('train')">Train anyway</button></div></section>`;
    return;
  }
  const mine=ownProgrammingDay();
  const routine=mine?state.routines.find(r=>r.name===mine.day.name):null;
  if(!routine){
    host.innerHTML=`<button class="today-hero today-hero-empty" onclick="navigate('train')"><span class="th-copy"><small>GET STARTED</small><strong>Pick a session</strong><em>Install a plan or build a routine and it lands here.</em></span><span class="workout-start" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>`;
    return;
  }
  const step=Number(state.preferences.weightStep)||2.5, pg=Core.painGate(state.history,null);
  // Three lifts is the glance; the rest are counted, not listed.
  const shown=routine.exerciseIds.slice(0,3).map(id=>{
    const item=exerciseById(id);
    const t=Core.nextTarget(state.history,id,{step,block:!!pg.block,stepDown:!!pg.stepDown});
    const dose=t?(t.rule==='blocked'?'train around it':formatTarget(t)):'set your benchmark';
    return `<li><span class="th-lift">${esc(item?.name||id)}</span><span class="th-dose">${esc(dose)}</span></li>`;
  }).join('');
  const more=routine.exerciseIds.length-3;
  const mins=Math.round(routine.exerciseIds.length*7.5);
  host.innerHTML=`<section class="today-hero">`
    +`<div class="th-head"><span class="th-copy"><small>UP NEXT</small><strong>${esc(routine.name)}</strong>`
      +`<em>${routine.exerciseIds.length} lifts · about ${mins} min</em></span></div>`
    +`<ul class="th-list">${shown}</ul>`
    +(more>0?`<p class="th-more">+ ${more} more lift${more===1?'':'s'}</p>`:'')
    +`<div class="th-actions"><button class="primary-button full-button" onclick="startRoutine('${esc(routine.id)}')">Start ${esc(routine.name.split(' · ').slice(-1)[0])}</button>`
    +`<button class="text-button" onclick="openRoutineMenu('${esc(routine.id)}')">See all ${routine.exerciseIds.length}</button></div>`
  +`</section>`;
}
// ---- ONE advisory, priority-resolved -------------------------------------------------------------
// Three cards could previously give three different instructions on the same screen: "today is
// handled" above "take an easy week" above "up next, do Push/Pull". Safety outranks progression,
// progression outranks consistency, and only the winner is ever drawn.
function renderTodayAdvisory(rest){
  const host=document.getElementById('todayAdvisory'); if(!host)return;
  const deload=Core.deloadCheck(state.history);
  // The rest state already carries the deload message when that is why we are resting.
  if(deload.due&&!(rest&&rest.source==='deload')){
    host.innerHTML=`<section class="deload-card card" aria-label="Easy week suggested"><p class="kicker">EASY WEEK SUGGESTED</p><p>${esc(deload.reason)}</p></section>`;
    return;
  }
  host.innerHTML='';
}
// ---- Weekly muscle dose: the signature visual ----------------------------------------------------
// What "41% week charged" concealed is that a week can hit its session and tonnage targets while
// half the body gets nothing. Four rows, ranked by EXCEPTION (worst proportional shortfall first),
// never by volume - ranking by volume would rank the already-dominant muscles top and hide the gap.
// Direct and assisting sets are distinguished by fill PATTERN and by a written count, never by hue.
function renderTodayDose(){
  const host=document.getElementById('todayDose'); if(!host)return;
  const dose=Core.muscleDose(state.history,muscleLookup,MUSCLE_GROUPS,state.preferences.muscleRanges,4);
  const trained=dose.all.some(r=>r.direct||r.assisting);
  if(!trained){
    host.innerHTML=`<p class="dose-empty">Log a set and your weekly muscle coverage starts here.</p>`;
    return;
  }
  const scale=Math.max(1,...dose.all.map(r=>Math.max(r.direct,r.max)));
  host.innerHTML=dose.rows.map(r=>{
    const word=r.state==='under'?'below':r.state==='over'?'above':'in range';
    return `<button class="dose-row dose-${r.state}" onclick="openMuscleDetail('${esc(r.muscle)}')" aria-label="${esc(r.muscle)}: ${r.direct} direct sets of a ${r.min} to ${r.max} target, ${r.assisting} assisting, ${word}">`
      +`<span class="dose-name">${esc(r.muscle)}</span>`
      +`<span class="dose-track"><i class="dose-direct" style="width:${Math.min(100,Math.round(r.direct/scale*100))}%"></i>`
        +`<i class="dose-assist" style="width:${Math.min(100,Math.round(r.assisting/scale*100))}%"></i>`
        +`<b class="dose-min" style="left:${Math.min(100,Math.round(r.min/scale*100))}%"></b></span>`
      +`<span class="dose-nums"><strong>${r.direct}</strong>/${r.min}<small>${esc(word)}</small></span>`
    +`</button>`;
  }).join('')
  +`<button class="dose-all" onclick="navigate('progress')">All ${dose.total} muscle groups · this week</button>`;
}
function renderTodayAction(rest){
  const host=document.getElementById('todayAction'); if(!host)return;
  if(state.activeSession){host.innerHTML='';return;} // the resume card already owns this job
  if(rest){
    // A real rest state, rather than manufacturing urgency to fill the screen. Recovery is a
    // training decision, so the app names it as one and offers the recovery work it already has.
    host.innerHTML=`<div class="today-rest"><p class="kicker">${esc(rest.kicker)}</p><strong>${esc(rest.title)}</strong><small>${esc(rest.detail)}</small>`
      +`<div class="today-rest-actions"><button class="secondary-button" onclick="startDeskReset()">Desk Reset · 5 min</button>`
      +`<button class="text-button" onclick="navigate('train')">Train anyway</button></div></div>`;
    return;
  }
  const mine=ownProgrammingDay();
  const routine=mine?state.routines.find(r=>r.name===mine.day.name):null;
  if(routine){
    host.innerHTML=`<button class="today-cta" onclick="startRoutine('${esc(routine.id)}')"><span class="today-cta-copy"><small>UP NEXT</small><strong>${esc(routine.name)}</strong></span><span class="workout-start" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>`;
    return;
  }
  host.innerHTML=`<button class="today-cta" onclick="navigate('train')"><span class="today-cta-copy"><small>GET STARTED</small><strong>Pick a session</strong></span><span class="workout-start" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>`;
}
// Rest is EARNED, not a gap in the calendar. Two honest triggers, both from data the app already
// computes: every routine done this week, or a deload the app itself is advising. Nothing else
// counts - a lifter who simply has not trained today is not resting, they are behind.
function restDayRead(){
  // PRIORITY, and the order is the whole point (council 2026-08-05): a deload advisory outranks
  // "you trained today", which outranks "your week is done". Getting this backwards is what put
  // "That is today handled" directly above "Take an easy week" on the same screen - two cards, two
  // instructions, no hierarchy. Exactly one may win.
  const deload=Core.deloadCheck(state.history);
  if(deload&&deload.due)return {source:'deload',kicker:'EASY WEEK SUGGESTED',title:'Back off this week.',
    detail:deload.reason};
  const trainedToday=(state.history||[]).some(s=>{
    const d=new Date(Number(s.started)||0),n=new Date();
    return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate();
  });
  if(trainedToday)return {source:'today',kicker:'DONE TODAY',title:'That is today handled.',
    detail:'Eat, sleep, and let it stick. The next session will be here tomorrow.'};
  const routines=(state.routines||[]).filter(r=>r.exerciseIds&&r.exerciseIds.length);
  const done=Core.routinesDoneThisWeek(state.history);
  if(routines.length&&routines.every(r=>done.has(r.id)))return {source:'week',kicker:'WEEK COMPLETE',title:'Every routine is done.',
    detail:'You have trained everything you planned this week. Rest is part of the plan.'};
  return null;
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
  card.classList.toggle('card-live',score>0); // hero tinted card once the week is under way; quiet at zero-state
  const goals2=state.preferences;
  document.getElementById('activityTitle').textContent=`${weekly.workouts} of ${goals2.weeklyWorkoutGoal} sessions`;
  document.getElementById('activityDetail').textContent=`${weekly.completedSets} of ${goals2.weeklySetGoal} working sets`;
  const fmtGoal=ring=>ring.key==='volume'?compact(ring.goal):ring.goal;
  // v2 charge ring (design/HANDOFF.md): ONE ring replaces the three arc gauges.
  //   outer arc  = sessions + volume (the two "did you show up and do work" ratios, averaged)
  //   inner arc  = completed sets
  //   centre     = the average of all three, as one number — the same `score` the old card computed.
  // Geometry mirrors the prototype at r=52/39.5 in a 120 viewBox. Radii are in the SAME user space
  // as the stroke, so the drop-shadow cannot bleed outside the padded viewBox and start a
  // horizontal scroll (the 460px-glow-in-a-390px-scroller trap called out in the brief).
  const by=k=>rings.find(r=>r.key===k);
  const OUT_R=52,IN_R=39.5,OUT_C=2*Math.PI*OUT_R,IN_C=2*Math.PI*IN_R;
  const outRatio=(by('workouts').ratio+by('volume').ratio)/2,setsRatio=by('sets').ratio;
  const outOff=OUT_C*(1-outRatio),inOff=IN_C*(1-setsRatio);
  // Same rAF-in-a-hidden-tab guard as animateNumbers: with no frame loop the arcs would stay parked
  // at their empty start value, drawing a 0% ring over a non-zero week. Draw them filled instead.
  const noArcAnim=REDUCED_MOTION||document.hidden;
  // The ring itself is GONE (council 2026-08-05). It was still being generated into a hidden
  // element, which kept "WEEK CHARGED" in the page's text and made the removal a lie to anything
  // reading the DOM. The heading above now carries the two plain counts that replaced it, and the
  // weekly muscle dose board is the visual. Nothing here draws.
}
function renderWeekDots(){
  const now=new Date(),monday=new Date(now);monday.setHours(0,0,0,0);monday.setDate(now.getDate()-((now.getDay()+6)%7));
  const completed=new Set(state.history.map(s=>{const d=new Date(s.started);d.setHours(0,0,0,0);return d.getTime()}));
  document.getElementById('weekDots').innerHTML=['M','T','W','T','F','S','S'].map((label,index)=>{const date=new Date(monday.getTime()+index*DAY);const done=completed.has(date.getTime());return `<span class="day-dot ${done?'done':''} ${date.toDateString()===now.toDateString()?'today':''}" title="${done?'Trained':'No session'}"><i></i><small>${label}</small></span>`}).join('');
}
// `done` = the Set from Core.routinesDoneThisWeek. A tick AND the words - never a colour alone.
function routineCard(routine,done){
  const names=routine.exerciseIds.map(id=>exerciseById(id)?.name).filter(Boolean);
  const tick=done?.has(routine.id)?'<span class="done-badge">✓ Done this week</span> · ':'';
  // The name itself opens the options sheet, not just the ••• glyph. Editing a routine has been
  // possible since day one and Mark never found it, because the only way in was an unlabelled
  // three-dot button (2026-07-28). Same handler, one much larger target.
  return `<article class="routine-card group-row"><button class="routine-open" onclick="openRoutineMenu('${routine.id}')" aria-label="Options for ${esc(routine.name)}"><strong>${esc(routine.name)}</strong><small>${tick}${names.length} exercise${names.length===1?'':'s'}${names.length?' · '+esc(names.slice(0,2).join(', ')):''}</small></button><div class="routine-actions"><button class="routine-start" onclick="startRoutine('${routine.id}')" aria-label="${done?.has(routine.id)?'Repeat':'Start'} ${esc(routine.name)}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button></div></article>`;
}
// Today's horizontal quick-start strip - same onclick contracts as routineCard (start + options menu).
function routineStripCard(routine,done){
  const names=routine.exerciseIds.map(id=>exerciseById(id)?.name).filter(Boolean);
  const tick=done?.has(routine.id)?'<span class="done-badge">✓ Done</span> · ':'';
  return `<article class="routine-strip-card"><div class="rs-top"><h3>${esc(routine.name)}</h3><button class="routine-menu" onclick="openRoutineMenu('${routine.id}')" aria-label="Routine options">•••</button></div><p>${tick}${names.length} exercise${names.length===1?'':'s'}${names.length?' · '+esc(names.slice(0,2).join(', ')):''}</p><button class="rs-start" onclick="startRoutine('${routine.id}')">${done?.has(routine.id)?'Again':'Start'}</button></article>`;
}
// v2: the last session is a row in the Today grouped list. Keeps the .history-card class and the
// openHistory() contract (browser-flow selects '#recentSession .history-card'); only the shell changed.
function historyCard(session){
  const summary=Core.summarizeSession(session),prs=session.prs?.length??session.prs??0;
  const meta=[`${summary.durationMinutes} min`,`${summary.completedSets} set${summary.completedSets===1?'':'s'}`];
  if(summary.volume>0)meta.push(`${compact(summary.volume)} kg`);
  return `<button class="history-card group-row" onclick="openHistory('${session.id}')"><span class="row-glyph row-glyph-amber" aria-hidden="true">${prs?'PR':'✓'}</span><span class="row-text"><strong>${esc(session.name)}</strong><small>${formatDate(session.started)} · ${esc(meta.join(' · '))}${prs?` · ${prs} PR${prs===1?'':'s'}`:''}</small></span><span class="row-chev" aria-hidden="true">›</span></button>`;
}

// Coach surface (Today): one active source only - remote "Coach's block" when a plan validates,
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
    console.warn('Coach plan unusable - cleared',error);
    if(Sync)try{Sync.clearPlan();}catch{}
    verdict={status:'rejected',reason:'The stored plan could not be read - using safe local programming.'};
  }
  // Local fallback. Same requireConfirmation rule the targets use: outside injury mode the app never
  // asks the flare question, so demanding its answer here left the ramp saying "find an easy working
  // load" forever.
  const confirmedFor=id=>Core.lastConfirmedExposure(state.history,id,{requireConfirmation:injuryMode()});
  // The Return Ramp is joint-friendly RE-ENTRY programming, not a routine anyone chose. Showing it to
  // a lifter already running Ty · PPL or an installed plan is the app proposing a session they never
  // asked for, which is exactly what Mark and Ty were both seeing (2026-08-05). Suggest from THEIR
  // OWN programming whenever they have some; the ramp is only for a lifter who has nothing yet.
  const mine=ownProgrammingDay();
  const days=mine?[mine.day]:(RETURN_RAMP?RETURN_RAMP.days:null);
  const suggestion=days?Coach.localSession(state.history,days,{confirmedFor}):null;
  const superseded=verdict&&verdict.status!=='usable'?verdict.reason:'';
  return {source:'local',label:mine?mine.label:'Local ramp',suggestion,
    provenance:mine?mine.provenance:'Joint-friendly Return Ramp · safe local programming',superseded};
}
// The lifter's own next session: the first day of an installed plan they have not done this week,
// else the first of their own routines. Returns a single day in the shape Coach.localSession takes
// (`{name, exerciseIds}`), so the ONE chosen day is what gets dosed - never a cycle through a plan
// nobody installed. Null when they have no programming of their own at all.
function ownProgrammingDay(){
  const done=Core.routinesDoneThisWeek(state.history);
  const pick=list=>list.find(r=>!done.has(r.id))||list[0];
  const usable=r=>r&&Array.isArray(r.exerciseIds)&&r.exerciseIds.length;
  const found=installedPlan();
  if(found){
    const next=pick(found.routines.filter(usable));
    if(next)return {day:{name:next.name,exerciseIds:next.exerciseIds},label:'Up next',provenance:`${found.plan.name} · your installed plan`};
  }
  const own=state.routines.filter(usable);
  if(own.length){
    const next=pick(own);
    return {day:{name:next.name,exerciseIds:next.exerciseIds},label:'Up next',provenance:'From your own routines'};
  }
  return null;
}
function planProvenance(plan,verdict){
  const total=Number.isFinite(plan.expiresAfterSessions)?plan.expiresAfterSessions:Coach.DEFAULT_EXPIRES;
  const remaining=Math.max(0,total-verdict.postCount);
  // Plain text - renderCoach esc()'s the whole provenance line once.
  return `Based through session ${String(plan.basedThroughSessionId||'-')} · ${remaining} session${remaining===1?'':'s'} remaining`;
}
// Coach-card scoping (council 2026-07-19): a profile only sees the Local Ramp / Coach's Block card
// once it has skin in the game - a plan/routine, some history, or sync configured. A brand-new profile
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
  // numbers through Coach.doseLine (finite-or-nothing) - a hostile field renders inert.
  const names=s.exercises.map(e=>{const item=exerciseById(e.exerciseId);return item?esc(item.name):`${esc(e.exerciseId)} (skipped - not in library)`;});
  // The cue is the plan's REASONING ("repeat exactly and answer the check-in", "stepped down 20%
  // after a flare") and the card was dropping it entirely, leaving numbers with no why. Untrusted
  // remote string → esc()'d like every other plan-derived field.
  // Six rows repeating the identical cue is noise wearing the costume of information: when every
  // exercise carries the same cue, say it ONCE under the list (council 2026-07-28).
  const cues=s.exercises.map(e=>e.cue||'');
  const allSame=cues.length>1&&cues.every(c=>c&&c===cues[0]);
  // v2 UP NEXT card: the bullet list becomes exercise CHIPS. A chip carries the same real
  // prescription the list did (name + Coach.doseLine), and an exercise missing from the library
  // keeps its word-marked "skipped" state - never a colour-only cue.
  // Prototype parity: a chip is the exercise NAME only (the dose lives in the session itself), and
  // the row shows three then a "+N" overflow chip.
  const CHIP_SHOWN=3;
  const chips=s.exercises.slice(0,CHIP_SHOWN).map((e,i)=>{
    const known=!!exerciseById(e.exerciseId);
    return `<span class="next-chip${known?'':' next-chip-skip'}">${names[i]}</span>`;
  }).join('');
  const more=s.exercises.length>CHIP_SHOWN?`<span class="next-chip next-chip-more">+${s.exercises.length-CHIP_SHOWN}</span>`:'';
  // Per-exercise cues keep the `.coach-cue` class (contrast-guard selects it) and simply move
  // below the chip row, since a chip has no room for the plan's reasoning.
  const perChipCues=allSame?'':s.exercises.slice(0,6).map((e,i)=>e.cue?`<small class="coach-cue">${names[i]}: ${esc(e.cue)}</small>`:'').join('');
  // The design has exactly ONE note line under the chips: "Find an easy working load · joint-friendly
  // local programming" - i.e. the cue and the provenance joined by a middot, as a single <p>. We had
  // them as two elements (a <small> cue then a <p>), which cost 19px and was the last of the card's
  // height overshoot. When every exercise shares a cue it now folds into that one line; only the rare
  // differing-cue plan still renders a separate block, because the design does not model that case.
  const cueBlock=allSame?'':perChipCues;
  const noteLine=[allSame&&cues[0]?esc(cues[0]):'',esc(ctx.provenance)].filter(Boolean).join(' · ');
  // A plan's notes are its stop rules and its standing instructions. They shipped in every plan and
  // were never rendered anywhere, so the safety copy the generator writes reached nobody.
  const notes=(ctx.source==='coach'&&Array.isArray(ctx.plan?.notes)?ctx.plan.notes:[]).filter(n=>typeof n==='string'&&n.trim()).slice(0,4);
  const notesBlock=notes.length?`<details class="coach-notes"><summary>Plan rules (${notes.length})</summary><ul>${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></details>`:'';
  // The sync status row that used to close this card is GONE (2026-08-04, Mark's word: "if its not
  // needed and doesnt add something then it can go"). The design has no such row, it was ~69px of the
  // card's 88px overshoot, and it was redundant: Settings already shows connection status, and its
  // "Export session" button only ever rendered while sync was DISCONNECTED - Mark's is connected, so
  // he never saw it. Whole-state export lives on in Settings -> Download backup, a superset.
  slot.innerHTML=`<section class="coach-card up-next card card-live" aria-label="Training coach">
    <div class="up-next-body">
      <div class="coach-top"><p class="kicker">UP NEXT</p><span class="up-next-src">${ctx.source==='coach'?'Coach’s block':'Local ramp'}</span>${s.stepDown?'<span class="coach-flag notched">Step-down</span>':''}</div>
      <h2>${esc(s.title)}</h2>
      ${ctx.superseded?`<p class="coach-superseded">${esc(ctx.superseded)}</p>`:''}
      <div class="next-chips">${chips}${more}</div>
      ${cueBlock}
      ${notesBlock}
      <p class="coach-prov">${noteLine}</p>
    </div>
    <button class="primary-button up-next-cta" onclick="startCoachSession()"><span>Start ${esc(s.title)}</span></button>
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

// The plan hero: the ONE thing to do next. A plan counts as installed once applyPlan() has copied
// its days into state.routines (they carry the "<plan> · " name prefix). Progress is counted from
// real logged sessions via Core.routinesDoneThisWeek - never assumed.
function installedPlan(){
  for(const plan of plans){
    const prefix=`${plan.name} · `;
    const mine=state.routines.filter(r=>typeof r.name==='string'&&r.name.startsWith(prefix));
    // applyPlan() UNSHIFTS each day, so state.routines holds them reversed. Re-order by the plan's
    // own day sequence or the hero offers the last day first (it proposed Day C over Day A).
    if(mine.length){
      const ordered=plan.days.map(d=>mine.find(r=>r.name===prefix+d.name)).filter(Boolean);
      return {plan,routines:ordered.length?ordered:mine};
    }
  }
  return null;
}
function renderPlanHero(){
  const slot=document.getElementById('planHero');if(!slot)return;
  const found=installedPlan();
  if(!found){
    // Nothing installed yet, so the hero stays what Train used to lead with: the empty session.
    slot.innerHTML=`<button class="train-hero plan-hero plan-hero-empty big-button" onclick="startQuickWorkout()"><span class="ph-kicker">NO PLAN INSTALLED</span><strong>Start an empty session</strong><small>Add exercises as you go, or install a plan below.</small></button>`;
    return;
  }
  const {plan,routines}=found;
  const done=Core.routinesDoneThisWeek(state.history);
  const next=routines.find(r=>!done.has(r.id))||routines[0];
  const doneCount=routines.filter(r=>done.has(r.id)).length;
  const pct=routines.length?Math.round(doneCount/routines.length*100):0;
  // The hero used to be ONE button that started the session on any tap, so trying to see what was in
  // it started it (Mark 2026-08-05). Split: the body opens the preview, a 44px play square starts.
  // Same split the routine and workout cards already use, so the whole tab reads one way.
  slot.innerHTML=`<div class="train-hero plan-hero">`
    +`<button class="ph-open" onclick="openRoutineMenu('${next.id}')" aria-label="${esc(next.name)} - see the exercises">`
      +`<span class="ph-kicker">YOUR PLAN · ${esc(plan.name.toUpperCase())}</span>`
      +`<strong>${esc(next.name.split(' · ').slice(1).join(' · ')||next.name)}</strong>`
      +`<span class="ph-progress"><i aria-hidden="true"><b style="width:${pct}%"></b></i><small>${doneCount} of ${routines.length} done this week</small></span>`
    +`</button>`
    +`<button class="workout-start ph-start" onclick="startRoutine('${next.id}')" aria-label="Start ${esc(next.name)} now"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button>`
  +`</div>`;
}
function renderTrain(){
  renderPlanHero();
  document.getElementById('planList').innerHTML=plans.map(p=>`<button class="plan-shelf-card" onclick="openPlan('${p.id}')"><span>${esc(p.tag)}</span><strong>${esc(p.name)}</strong><small>${esc(p.blurb)}</small></button>`).join('');
  workoutGoalFilter='ALL'; // a stale chip must never hide a workout from someone who just opened Train
  workoutsExpanded=false;routinesExpanded=false; // arriving at Train always starts short
  renderRoutineList();
  renderWorkouts();
}
// ---- Curated workouts (council 2026-08-01) ----
// A workout is a STRUCTURE, not a prescription: set counts, rep RANGES and rest. Loads are never
// invented - the weight fields stay blank and fill from the lifter's own history. The three volume
// variants are COMPUTED from the Base data (Core.workoutScheme), never stored.
const WORKOUT_GOALS=['ALL',...new Set(workouts.map(w=>w.goal))]; // data order, ALL first
let workoutGoalFilter='ALL';
function workoutMuscle(id){return exerciseById(id)?.muscle||'';}
// Remembered per profile. The default applies SILENTLY so a one-tap start works with zero setup:
// injured or nothing logged yet starts light, everyone else starts at the written volume.
function workoutVariant(){
  const saved=state.preferences.workoutVolume;
  return saved==='reduced'||saved==='base'||saved==='expanded'?saved:((injuryMode()||state.history.length===0)?'reduced':'base');
}
// Rest reads in seconds until it stops being a number you can count, then in minutes.
function restLabel(seconds){const s=Number(seconds)||0;return s<120?`${s}s`:`${Math.round(s/6)/10} min`;}
function renderWorkouts(){
  const chips=document.getElementById('workoutGoals');
  if(chips)chips.innerHTML=WORKOUT_GOALS.map(g=>`<button class="filter-chip ${workoutGoalFilter===g?'active':''}" onclick="setWorkoutGoal('${esc(g)}')" aria-pressed="${workoutGoalFilter===g}">${esc(g)}</button>`).join('');
  const shown=workouts.filter(w=>workoutGoalFilter==='ALL'||w.goal===workoutGoalFilter);
  // Fifteen cards is 1800px of scroll for a list you read once (Mark 2026-08-05: "too long to
  // scroll"). Show a handful, keep the rest one tap away. The chips above narrow it properly; this
  // just stops the UNFILTERED state being a wall. Expansion is per-visit, not saved: arriving at
  // Train should always start short.
  const cap=workoutsExpanded?shown.length:TRAIN_LIST_CAP;
  const list=shown.slice(0,cap);
  // Compact cards (Mark 2026-08-02: Train was one long scroll): blurb lives in the detail sheet,
  // the card carries only goal + name + meta, and Start is a corner glyph, not a full-width bar.
  const cards=list.map(w=>`<article class="workout-card group-row"><button class="workout-open" onclick="openWorkoutDetail('${esc(w.id)}')" aria-label="${esc(w.name)} - see the exercises"><strong>${esc(w.name)}</strong><small class="workout-meta">${esc(String(w.goal).toLowerCase())} · ${w.mins} min · ${w.exercises.length} lifts</small></button><button class="workout-start" onclick="startWorkout('${esc(w.id)}')" aria-label="Start ${esc(w.name)} now"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button></article>`).join('');
  const more=shown.length>cap?`<button class="list-more" onclick="expandWorkouts()">Show all ${shown.length} sessions</button>`
    :(workoutsExpanded&&shown.length>TRAIN_LIST_CAP?`<button class="list-more" onclick="collapseWorkouts()">Show fewer</button>`:'');
  document.getElementById('workoutList').innerHTML=shown.length?cards+more:`<div class="group-row group-row-empty"><span class="row-text"><strong>No sessions match</strong><small>Clear the filter to see them all.</small></span></div>`;
  const count=document.getElementById('workoutCount');
  // Count what is ON SCREEN. It read "16 of 16" while showing five, which is the kind of small lie
  // that makes every other number on the page suspect.
  if(count)count.textContent=`${list.length} of ${workouts.length}`;
}
const TRAIN_LIST_CAP=5;
let workoutsExpanded=false,routinesExpanded=false;
function expandWorkouts(){workoutsExpanded=true;renderWorkouts();}
function collapseWorkouts(){workoutsExpanded=false;renderWorkouts();}
function expandRoutines(){routinesExpanded=true;renderRoutineList();}
function collapseRoutines(){routinesExpanded=false;renderRoutineList();}
// Routines get the same treatment - a lifter who has saved a dozen should not have to scroll past
// all of them to reach the curated sessions below.
function renderRoutineList(){
  const host=document.getElementById('routineList');if(!host)return;
  const doneThisWeek=Core.routinesDoneThisWeek(state.history);
  if(!state.routines.length){
    host.innerHTML=`<div class="group-row group-row-empty"><span class="row-text"><strong>Your routines live here</strong><small>Build one once, save one from any workout, or install a plan below.</small></span></div>`;
    return;
  }
  const cap=routinesExpanded?state.routines.length:TRAIN_LIST_CAP;
  const more=state.routines.length>cap?`<button class="list-more" onclick="expandRoutines()">Show all ${state.routines.length} routines</button>`
    :(routinesExpanded&&state.routines.length>TRAIN_LIST_CAP?`<button class="list-more" onclick="collapseRoutines()">Show fewer</button>`:'');
  host.innerHTML=state.routines.slice(0,cap).map(r=>routineCard(r,doneThisWeek)).join('')+more;
}
function setWorkoutGoal(goal){workoutGoalFilter=goal;workoutsExpanded=false;renderWorkouts();}
function openWorkoutDetail(id){
  workoutSheetId=id;renderWorkoutSheet();document.getElementById('sheet').showModal();
}
let workoutSheetId=null;
const VOLUME_SEGMENTS=[['reduced','Reduced'],['base','Base'],['expanded','Expanded']];
function setWorkoutVolume(variant){
  state.preferences.workoutVolume=variant;saveState();renderWorkoutSheet();
}
function renderWorkoutSheet(){
  const w=workouts.find(x=>x.id===workoutSheetId);if(!w)return;
  const variant=workoutVariant(),list=Core.workoutScheme(w,variant,workoutMuscle);
  const seg=VOLUME_SEGMENTS.map(([v,label])=>`<button class="filter-chip ${v===variant?'active':''}" onclick="setWorkoutVolume('${v}')" aria-pressed="${v===variant}">${v===variant?'✓ ':''}${label}</button>`).join('');
  const rows=list.map(e=>`<div class="selected-row"><span><strong>${esc(exerciseById(e.id)?.name||e.id)}</strong><small style="display:block;color:var(--taupe)">${e.sets} × ${esc(e.reps)} ${exerciseById(e.id)?.timed?'s':'reps'} · rest ${restLabel(e.rest)}</small></span></div>`).join('');
  // Same planned-volume model as a plan (direct + assisting, never summed) but at this workout's
  // REAL per-exercise set counts, so the board changes when the variant does.
  const pv={};
  for(const e of list) for(const [m,v] of Object.entries(Core.planVolume([{exerciseIds:[e.id]}],muscleLookup,e.sets))){
    const slot=pv[m]=pv[m]||{direct:0,assisting:0};slot.direct+=v.direct;slot.assisting+=v.assisting;
  }
  const pvRows=MUSCLE_GROUPS.map(m=>({m,d:pv[m]?.direct||0,a:pv[m]?.assisting||0})).filter(r=>r.d||r.a).sort((x,y)=>y.d-x.d);
  const scale=Math.max(1,...pvRows.map(x=>Math.max(x.d,x.a)));
  const planned=pvRows.length?`<div class="section-heading"><div><p class="kicker">PLANNED</p><h2>Sets per muscle · this session</h2></div></div><div class="mv-board">${pvRows.map(r=>`<div class="mv-row mv-static"><span class="mv-name">${r.m}</span><span class="mv-tracks">${r.d?`<i class="mv-direct" style="width:${r.d/scale*100}%"></i>`:''}${r.a?`<i class="mv-assist" style="width:${r.a/scale*100}%"></i>`:''}</span><span class="mv-nums"><strong>${r.d}</strong> direct · ${r.a} assist</span></div>`).join('')}</div>`:'';
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">WORKOUT · ${esc(w.goal)}</p><h2>${esc(w.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><p class="workout-mins">${w.mins} min · ${list.length} exercises</p><p style="color:var(--taupe);margin-top:-2px">${esc(w.note)}</p><div class="section-heading"><div><p class="kicker">VOLUME</p><h2>How much today</h2></div></div><div class="filter-row vol-seg" role="group" aria-label="Session volume">${seg}</div><div class="selected-list">${rows}</div>${planned}<p class="workout-disclaimer">General programming, not individualised advice. Loads come from your own history.</p><div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="startWorkout('${esc(w.id)}')">Start workout</button></div>`;
}
function startWorkout(id,variant){
  const w=workouts.find(x=>x.id===id);if(!w)return;
  closeSheet(); // beginSession owns the already-running guard (toast + navigate)
  beginSession({id:w.id,name:w.name,exercises:Core.workoutScheme(w,variant||workoutVariant(),workoutMuscle)});
}
// closeSheet() is a no-op when nothing is open (dismissDialog guards on .open), so the one call
// covers both the Train card and the routine preview sheet without a second entry point.
function startRoutine(id){ const routine=state.routines.find(r=>r.id===id);if(!routine)return;closeSheet();beginSession(routine); }
function startQuickWorkout(){ beginSession({id:null,name:'Quick workout',exerciseIds:[]}); }
function beginSession(routine){
  forcedOpen=new Set(); // reopened-card state never leaks between sessions
  if(state.activeSession){showToast('You already have a workout running');navigate('workout');return;}
  pickerFilterState=newFilterState(); // each workout's add-exercise flow starts clean, then persists across opens
  state.activeSession=Core.createSession(routine);
  state.activeSession.checkin={pre:null,post:null}; // three-touch safety loop (council 2026-07-18)
  seedOpeningLoads(state.activeSession);
  saveState();navigate('workout');
}
// A set ticked off with reps and no weight adds exactly ZERO to the kg total, so two identical
// sessions can differ by thousands purely on whether a number got typed. That is the whole of Ty's
// "my volume is not consistent" (his Legs session logged 5 of 8 lifts at 0 kg). Prevention is to put
// the lifter's OWN last load in the first set of every lift up front - not invented, marked
// `prefilled` so it renders muted + italic until confirmed, exactly like the carry-forward prefill.
// Reps are deliberately NOT seeded: the rep target comes from the scheme and the lifter always types
// them, so a seeded rep would be a claim about work that has not happened yet.
function seedOpeningLoads(session){
  if(!session)return;
  const loads=Core.openingLoads(state.history,session.exercises.map(ex=>ex.exerciseId));
  for(const ex of session.exercises){
    const top=loads[ex.exerciseId],first=ex.sets&&ex.sets[0];
    if(!top||!first||first.done||String(first.weight??'')!=='')continue;
    first.weight=String(top);first.prefilled=true;
  }
}
function resumeWorkout(){ navigate('workout'); }
function openPlan(id){
  const plan=plans.find(p=>p.id===id);if(!plan)return;
  // v2: a plan day collapses to its name + count and EXPANDS to reveal its exercises.
  // A day may also carry a full {id,sets,reps,rest} scheme (Mark's chain). When it does it shows its
  // dose and its own note, and can be STARTED from here - the Start sits in the expanded body rather
  // than in the <summary>, because a button inside a summary toggles the details on every tap.
  const dayList=plan.days.map((d,i)=>{
    const scheme=Array.isArray(d.exercises)?d.exercises:null;
    const rows=(scheme
      ? scheme.map(e=>`<li><span>${esc(exerciseById(e.id)?.name||e.id)}</span><span class="pd-dose">${e.sets} x ${esc(String(e.reps))}${Core.isTimed(e.id)?'s':''}</span></li>`)
      : d.exerciseIds.map(x=>`<li><span>${esc(exerciseById(x)?.name||x)}</span></li>`)).join('');
    const note=d.note?`<p class="pd-note">${esc(d.note)}</p>`:'';
    // Start row mirrors the design's routine/session rows: copy left, 44px amber play right, whole
    // row tappable. The list itself is a grouped inset block only when it carries a real scheme -
    // an older bare list has nothing to group and keeps its plain indented form.
    const mins=scheme?Math.round(scheme.reduce((n,e)=>n+e.sets*((Number(e.rest)||60)+40),0)/60):0;
    const start=scheme?`<button class="pd-start-row" onclick="startPlanDay('${esc(plan.id)}',${i})" aria-label="Start ${esc(d.name)} now"><span class="pd-start-copy"><strong>Start this day</strong><small>${scheme.length} lifts${mins?` · ~${mins} min`:''}</small></span><span class="workout-start" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>`:'';
    return `<details class="plan-day"><summary><span class="pd-name">${i+1}. ${esc(d.name)}</span><span class="pd-count">${d.exerciseIds.length} exercises</span></summary>${note}<ul class="${scheme?'pd-scheme':'pd-list'}">${rows}</ul>${start}</details>`;
  }).join('');
  const pv=Core.planVolume(plan.days,muscleLookup);
  const pvRows=MUSCLE_GROUPS.map(m=>({m,d:pv[m]?.direct||0,a:pv[m]?.assisting||0})).filter(r=>r.d||r.a).sort((x,y)=>y.d-x.d);
  const planned=pvRows.length?`<div class="section-heading"><div><p class="kicker">PLANNED</p><h2>Sets per muscle · one full cycle</h2></div></div><p class="mv-note">At 3 working sets per exercise, counted the same way as your weekly board - direct and assisting, never added.</p><div class="mv-board">${pvRows.map(r=>`<div class="mv-row mv-static"><span class="mv-name">${r.m}</span><span class="mv-tracks"><i class="mv-direct" style="width:${r.d/Math.max(1,...pvRows.map(x=>Math.max(x.d,x.a)))*100}%"></i><i class="mv-assist" style="width:${r.a/Math.max(1,...pvRows.map(x=>Math.max(x.d,x.a)))*100}%"></i></span><span class="mv-nums"><strong>${r.d}</strong> direct · ${r.a} assist</span></div>`).join('')}</div>`:'';
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">TRAINING PLAN · ${esc(plan.tag)}</p><h2>${esc(plan.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><p style="color:var(--muted);margin-top:-6px">${esc(plan.note)}</p><div class="selected-list">${dayList}</div>${planned}<div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="applyPlan('${plan.id}')">Add ${plan.days.length} routine${plan.days.length===1?'':'s'}</button></div>`;
  document.getElementById('sheet').showModal();
}
// Start one day of a scheme-carrying plan directly, with its real sets/reps/rest. Core.createSession
// already branches on `exercises` vs `exerciseIds` (the w20 scheme path), so both shapes are passed and
// the scheme wins where it exists - every older plan keeps its one-blank-set behaviour untouched.
function startPlanDay(planId,dayIndex){
  const plan=plans.find(p=>p.id===planId);const day=plan&&plan.days[dayIndex];if(!day)return;
  closeSheet();
  beginSession({id:`${plan.id}-d${dayIndex}`,name:day.name,exercises:day.exercises,exerciseIds:day.exerciseIds});
}
function applyPlan(id){
  const plan=plans.find(p=>p.id===id);if(!plan)return;
  const stamp=Date.now();
  plan.days.forEach((d,i)=>state.routines.unshift({id:`r${stamp}_${i}`,name:`${plan.name} · ${d.name}`,exerciseIds:[...d.exerciseIds]}));
  state.preferences.weeklyWorkoutGoal=Math.min(14,Math.max(Number(state.preferences.weeklyWorkoutGoal)||0,plan.goal||plan.days.length));
  saveState();closeSheet();renderTrain();renderToday();showToast(`${plan.name} added - ${plan.days.length} routines ready`);
}

// ---- Exercise catalogue (council 2026-07-19): flat, search/filter-first, shared by Library + the add-exercise picker.
// Quick Picks (favourites+recent) sit ABOVE a stable list; muscle chips single-select refine; secondary facets live behind Filters.
const MUSCLE_ORDER=['Chest','Back','Shoulders','Arms','Grip','Legs','Core','Full Body','Cardio','Mobility','Calisthenics','Stretches'];
const FILTERS_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
function newFilterState(){return {query:'',muscle:'All',patterns:[],equip:[],families:[]};}
// The Library was 18,805px of alphabetical catalogue - 22 screens - for 255 exercises, of which a
// real lifter had ever performed THREE (measured 2026-08-05). A catalogue is a reference; what you
// actually need to reach in a gym is your own short list. So the default scope is YOURS: everything
// you have logged, starred, or put in a routine. The full catalogue is one tap away and search
// always spans everything, because searching for something you have never done is the whole point
// of a search box.
let libraryScope='yours';
function yourExerciseIds(){
  const ids=new Set();
  for(const session of state.history||[]) for(const ex of session.exercises||[]) if(ex&&ex.exerciseId)ids.add(ex.exerciseId);
  for(const id of state.favourites||[]) ids.add(id);
  for(const routine of state.routines||[]) for(const id of routine.exerciseIds||[]) ids.add(id);
  return ids;
}
// Most-recently-trained first, then the rest of your list alphabetically. Recency is what makes a
// short list feel like it read your mind; alphabetical inside the tail keeps it findable.
function yourExercisesOrdered(){
  const ids=yourExerciseIds();
  const lastDone=new Map();
  for(const session of state.history||[]) for(const ex of session.exercises||[]){
    const t=Number(session.started)||0;
    if(ex&&ex.exerciseId&&t>(lastDone.get(ex.exerciseId)||0))lastDone.set(ex.exerciseId,t);
  }
  return allExercises().filter(e=>ids.has(e.id)).sort((a,b)=>{
    const ta=lastDone.get(a.id)||0,tb=lastDone.get(b.id)||0;
    if(ta!==tb)return tb-ta;
    return a.name.localeCompare(b.name);
  });
}
function setLibraryScope(scope){libraryScope=scope==='all'?'all':'yours';renderCatalogue('library');}
let libraryFilter=newFilterState();
let pickerFilterState=newFilterState();
const CAT={
  library:{ids:{quick:'libraryQuickPicks',chips:'muscleFilters',filtersBtn:'libraryFiltersBtn',count:'libraryCount',list:'exerciseLibrary',search:'librarySearch'}},
  picker:{ids:{quick:'pk_quick',chips:'pk_chips',filtersBtn:'pk_filtersBtn',count:'pk_count',list:'pk_list',search:'pk_search'}}
};
function catState(ctx){return ctx==='library'?libraryFilter:pickerFilterState;}
function catEl(ctx,key){return document.getElementById(CAT[ctx].ids[key]);}
function catAdd(ctx,id){(ctx==='library'?quickExercise:pickExercise)(id);} // add by EXACT id - logging/progression path unchanged
// Full render (quick + chips + list). The search <input> node is only re-valued, never replaced, so focus/caret survive.
function renderCatalogue(ctx){
  const input=catEl(ctx,'search'); if(input)input.value=catState(ctx).query;
  const list=catEl(ctx,'list'); if(list)list._catKey=null; // force a rebuild on a fresh open
  renderLibraryScope();renderCatalogueQuick(ctx);renderCatalogueChips(ctx);renderCatalogueList(ctx,false);
}
// Yours / All. The counts are on the buttons because the whole point is to show how much of the
// catalogue you are being spared. Hidden entirely for a lifter with nothing of their own yet -
// a switch between "nothing" and "everything" is not a choice worth offering.
function renderLibraryScope(){
  const host=document.getElementById('libraryScope'); if(!host)return;
  const mine=yourExerciseIds().size;
  if(!mine){host.innerHTML='';host.hidden=true;return;}
  host.hidden=false;
  const seg=[['yours',`Yours · ${mine}`],['all',`All · ${allExercises().length}`]];
  host.innerHTML=seg.map(([id,label])=>`<button class="seg-button${libraryScope===id?' on':''}" role="tab" aria-selected="${libraryScope===id}" onclick="setLibraryScope('${id}')">${esc(label)}</button>`).join('');
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
// Reflect the active facet count on the Filters button (badge + accent) and the open dialog's Clear button - in place, no rebuild.
function updateFiltersControl(ctx){
  // Prototype parity: the Library count row reads "N exercises" on the left and the favourite
  // tally on the right. The Filters control is kept in the DOM (its sheet still works and the
  // badge logic below still runs) but the design does not paint it.
  if(ctx==='library'){
    const favs=(state.favourites||[]).length;
    const tally=document.getElementById('libraryFavCount');
    if(tally)tally.textContent=favs?`\u2605 ${favs} favourite${favs===1?'':'s'}`:'\u2606 no favourites yet';
  }
  const fs=catState(ctx),n=fs.patterns.length+fs.equip.length+fs.families.length,btn=catEl(ctx,'filtersBtn');
  if(btn){btn.classList.toggle('has-active',n>0);btn.setAttribute('aria-label',n?`More filters, ${n} active`:'More filters');const badge=btn.querySelector('.filters-badge');if(badge){badge.textContent=n;badge.hidden=n===0;}}
  if(ctx===filterSheetCtx){const clear=document.getElementById('filterClearBtn');if(clear)clear.disabled=n===0;}
}
function renderCatalogueList(ctx,animate){
  const fs=catState(ctx);
  // A search always spans the WHOLE catalogue: looking up something you have never done is exactly
  // what the search box is for, so scope must never hide it.
  const scoped=(ctx==='library'&&libraryScope==='yours'&&!fs.query)?yourExercisesOrdered():allExercises();
  let list=Core.filterExercises(scoped,fs);
  // filterExercises sorts by its own ranking; the YOURS list is deliberately recency-ordered, so
  // restore that order when no query is narrowing it.
  if(ctx==='library'&&libraryScope==='yours'&&!fs.query){
    const rank=new Map(scoped.map((e,i)=>[e.id,i]));
    list=[...list].sort((a,b)=>(rank.get(a.id)??1e9)-(rank.get(b.id)??1e9));
  }
  const count=catEl(ctx,'count');
  if(count)count.textContent=fs.query?`${list.length} found`
    :(ctx==='library'&&libraryScope==='yours'?`${list.length} of yours`:`${list.length} exercise${list.length===1?'':'s'}`);
  const host=catEl(ctx,'list'); if(!host)return;
  // Skip the 239-row rebuild when the filtered id-set + query-state is unchanged (favourite toggles patch stars in place, so the DOM stays correct).
  const key=(fs.query?'q:':'')+(ctx==='library'?libraryScope+':':'')+list.map(e=>e.id).join(',');
  if(host._catKey===key)return;
  host._catKey=key;
  const empty=(ctx==='library'&&libraryScope==='yours'&&!fs.query)
    ? `<div class="empty-card card"><strong>Nothing here yet</strong>Exercises you log, star or put in a routine show up here. <button class="text-button" onclick="setLibraryScope('all')">Browse all ${allExercises().length}</button></div>`
    : `<div class="empty-card card"><strong>No exercises match</strong>Nothing fits this search and filter set. <button class="text-button" onclick="resetCatalogue('${ctx}')">Clear filters</button></div>`;
  host.innerHTML=list.length?list.map(e=>exerciseRow(e,fs.muscle)).join(''):empty;
  if(animate&&!REDUCED_MOTION){host.style.animation='none';void host.offsetWidth;host.style.animation='catFade .18s var(--ease)';}
}
// Row markup carries the exact id in data-id (never interpolated into a handler string); a delegated listener does the work.
// Whole name area taps to add; the ≥44px star toggles favourite (filled vs outline shape, not colour-only).
function exerciseRow(exercise,activeMuscle){
  const fav=(state.favourites||[]).includes(exercise.id);
  const id=esc(exercise.id);
  return `<article class="exercise-row">`
    +`<button class="exercise-pick" data-id="${id}" aria-label="${esc(exercise.name)}">`
      +`<span class="exercise-info"><strong>${esc(exercise.name)}</strong><small>${esc(exercise.equipment||'Custom equipment')}</small></span>`
    +`</button>`
    +`<span class="ex-muscle">${esc(exercise.muscle||'')}</span>`
    +`<button class="exercise-star${fav?' on':''}" data-id="${id}" aria-pressed="${fav}" aria-label="${fav?'Remove':'Add'} ${esc(exercise.name)} ${fav?'from':'to'} favourites">`
      +`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.8l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86z"/></svg>`
    +`</button>`
  +`</article>`;
}

// One delegated click listener per catalogue surface - no per-row handlers, no id interpolation (injection-safe).
function onCatalogueClick(ctx,e){
  const pick=e.target.closest('.exercise-pick');
  if(pick&&pick.dataset.id){
    // Library: the info area opens the exercise detail sheet; the + glyph still adds. Picker: pick always adds.
    if(ctx==='library'&&!e.target.closest('.exercise-plus')){openExerciseDetail(pick.dataset.id);return;}
    catAdd(ctx,pick.dataset.id);return;
  }
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
// Facet toggle (delegated): flip THIS chip + the Filters badge in place - never rebuild the dialog, so keyboard focus survives.
function onFacetClick(e){
  const chip=e.target.closest('.facet-chip'); if(!chip)return;
  const kind=chip.dataset.kind,value=chip.dataset.value,arr=catState(filterSheetCtx)[kind],i=arr.indexOf(value),on=i<0;
  if(on)arr.push(value);else arr.splice(i,1);
  chip.classList.toggle('on',on);chip.setAttribute('aria-pressed',String(on));
  updateFiltersControl(filterSheetCtx);renderCatalogueList(filterSheetCtx,true);
}
function clearFacets(){const fs=catState(filterSheetCtx);fs.patterns=[];fs.equip=[];fs.families=[];renderFiltersSheet();updateFiltersControl(filterSheetCtx);renderCatalogueList(filterSheetCtx,true);}
function closeFiltersSheet(){dismissDialog(document.getElementById('filterSheet'));}
// Keep the renderLibrary name - renderView, boot and saveCustomExercise all call it.
function renderLibrary(){renderCatalogue('library');}
function quickExercise(id){
  if(state.activeSession){addExerciseToWorkout(id);showToast('Added to current workout');return;}
  const exercise=exerciseById(id);beginSession({id:null,name:exercise?.name||'Quick workout',exerciseIds:[id]});
}

function renderProgress(){
  const weekly=Core.weeklyStats(state.history),lifetimeVolume=state.history.reduce((sum,s)=>sum+Core.calculateVolume(s),0);
  // The headline was a static "Getting stronger." even when every recap number was down - a
  // billion-dollar app never asserts what the data contradicts (council 2026-07-28). Derived from
  // the same recap the cards below show, so the page can never disagree with itself.
  // The prototype titles this screen with a plain "Progress" and lets the modules speak, so the
  // derived mood headline is no longer written over it. The recap it was based on is unchanged and
  // still rendered by renderWeeklyRecap() below, where the numbers actually live.
  // A lifter who only trains bodyweight has a real lifetime of work and zero kilos - count their
  // sets rather than showing them a proud "0".
  const lifetimeSets=state.history.reduce((sum,s)=>sum+Core.summarizeSession(s).completedSets,0);
  const third=lifetimeVolume>0?{n:Math.round(lifetimeVolume),fmt:' data-fmt="compact"',label:'LIFETIME KG'}:{n:lifetimeSets,fmt:'',label:'LIFETIME SETS'};
  document.getElementById('progressStats').innerHTML=`<div class="metric"><strong data-count="${weekly.workouts}">0</strong><span>WORKOUTS THIS WEEK</span></div><div class="metric"><strong data-count="${state.history.length}">0</strong><span>TOTAL SESSIONS</span></div><div class="metric"><strong data-count="${third.n}"${third.fmt}>0</strong><span>${third.label}</span></div>`;
  animateNumbers(document.getElementById('progressStats'));
  renderGoals();
  renderWeeklyRecap();
  renderPainTrend();
  renderStrength();
  renderMuscleVolume();
  renderBalance();
  renderBodyweight();
  renderWeekChart();
  renderPrFeed();
  renderCalisthenics();
  renderWeekPane();
  document.getElementById('historyList').innerHTML=state.history.length?state.history.map(historyCard).join(''):`<div class="group-row group-row-empty"><span class="row-text"><strong>Your progress starts at one</strong><small>Finish a workout and it will appear here.</small></span></div>`;
  renderProgressSegments();
}
// ---- Progress > WEEK, ported from the prototype ------------------------------------------------
// Four blocks, in this order: volume hero with a week-on-week delta, an area chart of recent weeks,
// a grouped stat list, then sets per muscle. Every number is real: weeklyRecap for the figures and
// their deltas, weeklyVolumes for the chart, muscleVolume for the bars, summarizeSession for time.
function deltaChip(n,invert){
  if(!n)return '<span class="wk-delta flat">no change</span>';
  const up=n>0, good=invert?!up:up;
  return `<span class="wk-delta ${good?'up':'down'}">${up?'\u25B2':'\u25BC'} ${Math.abs(Math.round(n))}</span>`;
}
function renderWeekPane(){
  const host=document.getElementById('weekPane');if(!host)return;
  const rc=Core.weeklyRecap(state.history,muscleLookup);
  const weeks=Core.weeklyVolumes(state.history,8);
  // Minutes under the bar this week, from the same summaries the receipt uses.
  const start=(()=>{const d=new Date();const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);d.setHours(0,0,0,0);return d.getTime();})();
  const mins=state.history.filter(x=>x.started>=start).reduce((a,x)=>a+Core.summarizeSession(x).durationMinutes,0);
  // A 42px smoothed area over eight discrete weekly totals was the wrong mark: it implied a
  // continuous quantity, had no axis, no labels and no way to read a single week. Weekly volume is
  // categorical-by-time, so it gets BARS - each week readable on its own, this week distinguished by
  // fill AND by its label, never by hue alone (Mark is colour-blind). Built in HTML rather than SVG
  // so the labels stay crisp at any width and inherit the app's own type.
  const vals=weeks.map(w=>w.volume);
  const max=Math.max(1,...vals);
  const withData=vals.filter(v=>v>0);
  const avg=withData.length?withData.reduce((a,b)=>a+b,0)/withData.length:0;
  const label=ts=>{const d=new Date(ts);return `${d.getDate()}/${d.getMonth()+1}`;};
  const bars=weeks.map((w,i)=>{
    const last=i===weeks.length-1;
    // A zero week draws nothing (the CSS min-height leaves a 2px stub); a real but tiny week still
    // gets 3% so it is visible as work done rather than as an empty slot.
    const h=w.volume>0?Math.max(3,Math.round(w.volume/max*100)):0;
    return `<div class="wkb${last?' wkb-now':''}"><i style="height:${h}%"></i>`
      +`<small>${last?'now':esc(label(w.start))}</small></div>`;
  }).join('');
  // The average rule is the reference that makes a single bar mean something. Positioned off the
  // same scale as the bars, so it can never disagree with them.
  const avgRule=avg>0?`<span class="wk-avg" style="--r:${(avg/max).toFixed(3)}"><em>avg ${compact(Math.round(avg))}</em></span>`:'';
  // Competence feedback, not a badge: where this week actually ranks against the ones before it.
  // Self-determination research is consistent that evidence of getting better sustains motivation,
  // while invented rewards (points, confetti) can crowd it out - so this is a rank, or nothing.
  const thisWeek=vals[vals.length-1]||0;
  const better=vals.slice(0,-1).filter(v=>v>thisWeek).length;
  const rank=thisWeek>0&&withData.length>1
    ? `<p class="wk-rank">${better===0?'Your biggest week of the last '+vals.length+'.':`Your ${ordinal(better+1)} biggest week of the last ${vals.length}.`}</p>`:'';
  const chart=vals.some(v=>v>0)
    ? `<div class="wk-bars" role="img" aria-label="Volume by week over the last ${vals.length} weeks: ${weeks.map(w=>`${label(w.start)} ${w.volume} kilograms`).join(', ')}">${avgRule}${bars}</div>${rank}`
    : '<p class="wk-empty">No volume logged yet.</p>';
  const rows=[
    ['Sets',rc.sets,rc.setsDelta,false],
    ['Sessions',rc.workouts,rc.workoutsDelta,false],
    ['Personal records',rc.prs,rc.prsDelta,false],
  ].map(([label,val,d])=>`<div class="wk-row"><span>${label}</span><span class="wk-val">${val}${deltaChip(d)}</span></div>`).join('')
   +`<div class="wk-row"><span>Time under the bar</span><span class="wk-val">${mins}m</span></div>`;
  // Sets per muscle, direct sets only, biggest first.
  const mv=Core.muscleVolume(state.history,muscleLookup);
  const list=Object.entries(mv).map(([m,v])=>({m,d:v.direct||0})).filter(r=>r.d>0).sort((a,b)=>b.d-a.d);
  const mMax=Math.max(1,...list.map(r=>r.d));
  const muscles=list.length?list.map(r=>`<div class="wk-muscle"><span class="wk-mname">${esc(r.m)}</span>`
      +`<span class="wk-mbar"><i style="width:${Math.round(r.d/mMax*100)}%"></i></span>`
      +`<span class="wk-mval">${r.d}</span></div>`).join('')
    :'<p class="wk-empty">Log a set to fill this board.</p>';
  host.innerHTML=`<p class="kicker wk-kicker">VOLUME THIS WEEK</p>`
    +`<div class="wk-hero"><strong>${compact(rc.volume)}</strong><small>kg</small>${deltaChip(rc.volumeDelta)}</div>`
    +chart
    +`<div class="group wk-stats">${rows}</div>`
    +`<p class="kicker wk-kicker wk-kicker-2">SETS PER MUSCLE</p>${muscles}`;
}
// ---- Progress segments (v2) -----------------------------------------------------------------
// The SAME modules, one intent visible at a time instead of a 3000px scroll. Nothing is rebuilt or
// re-ordered: each group is hidden or shown, so DOM order inside a segment is exactly what it was.
const PROGRESS_TABS=[['week','Week'],['trends','Trends'],['records','Records']];
let progressTab='week';
function renderProgressSegments(){
  const host=document.getElementById('progressSegments');if(!host)return;
  host.innerHTML=PROGRESS_TABS.map(([id,label])=>`<button class="seg-button${progressTab===id?' on':''}" role="tab" aria-selected="${progressTab===id}" onclick="setProgressTab('${id}')">${label}</button>`).join('');
  document.querySelectorAll('#view-progress .prog-group').forEach(g=>{g.hidden=g.dataset.seg!==progressTab;});
}
function setProgressTab(id){
  if(!PROGRESS_TABS.some(([t])=>t===id))return;
  progressTab=id;renderProgressSegments();
  const main=document.getElementById('main');if(main)main.scrollTop=0;
}
// ---- Calisthenics ledger (v2 Progress > Trends) ----------------------------------------------
// Scope: everything the catalogue files under Calisthenics, plus the classic bodyweight benchmarks
// that live under their own muscle. Explicit, so nothing is guessed into the ledger.
const CALI_EXTRA_IDS=['ba3','ba12','ch19','ch17','gr3','co1','co2','co10'];
function caliIds(){
  const ids=new Set(allExercises().filter(e=>e.muscle==='Calisthenics').map(e=>e.id));
  for(const id of CALI_EXTRA_IDS)if(exerciseById(id))ids.add(id);
  return [...ids];
}
function renderCalisthenics(){
  const board=document.getElementById('caliBoard');if(!board)return;
  const deltaEl=document.getElementById('caliDelta');
  const r=Core.caliProgress(state.history,caliIds(),{step:Number(state.preferences.weightStep)||2.5});
  if(!r.reps.length&&!r.holds.length){
    if(deltaEl)deltaEl.textContent='';
    board.innerHTML=`<div class="group"><div class="group-row group-row-empty"><span class="row-text"><strong>No bodyweight work logged yet</strong><small>Pull-ups, dips, push-ups and holds land here once you log a set.</small></span></div></div>`;
    return;
  }
  // Reps and seconds are never merged into one figure - they are different units.
  const gainWords=[];
  if(r.gainedReps>0)gainWords.push(`+${r.gainedReps} rep${r.gainedReps===1?'':'s'}`);
  if(r.gainedSeconds>0)gainWords.push(`+${r.gainedSeconds}s`);
  if(deltaEl)deltaEl.textContent=gainWords.length?`${gainWords.join(' · ')} this block`:'no gain this block';
  if(deltaEl)deltaEl.className='section-count cali-gain';
  const nameOf=id=>esc(exerciseById(id)?.name||id);
  // MAX SET · REPS. The previous best is a ghost fill BEHIND the current one plus a tick on the
  // scale, so a gained rep is visible rather than asserted. Scale is the whole board's best.
  const repMax=Math.max(r.repTarget,...r.reps.map(e=>Math.max(e.value,e.previousValue||0)));
  const repRows=r.reps.map(e=>{
    const pct=v=>`${Math.max(0,Math.min(100,(v/repMax)*100))}%`;
    const vest=e.load>0?` · +${e.load} kg vest`:'';
    // Prototype parity: next tier is the next multiple of 5 above the current best.
    const tier=Math.max(5,Math.ceil((e.value+1)/5)*5);
    const chip=e.delta>0?`<span class="cali-chip up">+${e.delta}</span>`:(e.delta<0?`<span class="cali-chip down">${e.delta}</span>`:'');
    const scale=v=>`${Math.max(0,Math.min(100,(v/tier)*100))}%`;
    return `<div class="cali-row"><div class="cali-top"><span class="cali-name">${nameOf(e.exerciseId)}${esc(vest)}</span>`
      +`<span class="cali-val">${e.value}${chip}</span></div>`
      +`<div class="cali-bar" role="img" aria-label="${nameOf(e.exerciseId)}: ${e.value} reps${e.previousValue!=null?`, previous best ${e.previousValue}`:''}, next tier ${tier}">`
        +`<i class="cali-fill" style="width:${scale(e.value)}"></i>`
        +(e.previousValue!=null?`<u class="cali-tick" style="left:${scale(e.previousValue)}"></u>`:'')
      +`</div>`
      +`<div class="cali-foot"><small>${e.previousValue!=null?`| was ${e.previousValue}`:(e.loggedThisBlock?'first logged':'not trained this block')}</small>`
      +`<small>next tier ${tier}</small></div></div>`;
  }).join('');
  // HOLDS · SECONDS on teal time bars, measured against their own next tier.
  const holdRows=r.holds.map(e=>{
    const pct=Math.max(0,Math.min(100,(e.value/Math.max(1,e.nextTier))*100));
    const chip=e.delta>0?`<span class="cali-chip up">+${e.delta}s</span>`:(e.delta<0?`<span class="cali-chip down">${e.delta}s</span>`:'');
    return `<div class="cali-row hold"><div class="cali-top"><span class="cali-name">${nameOf(e.exerciseId)}</span><span class="cali-val">${e.value}<small>s</small>${chip}</span></div>`
      +`<div class="cali-bar" role="img" aria-label="${nameOf(e.exerciseId)}: ${e.value} seconds, next tier ${e.nextTier}"><i class="cali-fill teal" style="width:${pct}%"></i></div>`
      +`<div class="cali-foot"><small>${e.previousValue!=null?`| was ${e.previousValue}s`:'first logged'}</small><small>next tier ${e.nextTier}s</small></div></div>`;
  }).join('');
  // NEXT UNLOCK: the rule that fires next, stated as a rule and never as a promise.
  let unlock='';
  if(r.nextUnlock){
    const u=r.nextUnlock,n=nameOf(u.exerciseId);
    const line=u.kind==='reps'
      ? `${u.repsToGo} more clean ${n.toLowerCase()} rep${u.repsToGo===1?'':'s'} and the load goes to +${u.toLoad} kg.`
      : u.kind==='load'
        ? `${n} is at the top of its rep range - the next step is +${u.toLoad} kg.`
        : `Hold ${n} for ${u.secondsToGo}s longer to reach the next tier.`;
    unlock=`<div class="cali-unlock"><p class="kicker">NEXT UNLOCK</p><p>${line}</p></div>`;
  }
  board.innerHTML=`<div class="cali-card">${repRows?`<p class="cali-head">MAX SET · REPS</p>${repRows}`:''}${holdRows?`<p class="cali-head">HOLDS · SECONDS</p>${holdRows}`:''}${unlock}</div>`;
}
// ---- Declared goals (2026-07-22) ----------------------------------------------------------
// The app measured process (weekly rings) and emergent PRs, but nothing the lifter actually said
// they wanted. A goal is stated once and then answered by their own logged evidence - the same
// rule as everything else here: the app never claims progress the numbers don't show.
function goalCtx(){return {history:state.history,bodyweight:state.bodyweight,now:Date.now()};}
// Bodyweight and hold work moves no barbell, so a calisthenics session used to report "0 kg moved"
// - which reads as "nothing happened" for a session that was anything but. Sets are the honest unit
// for that work; kilos lead only when there are kilos to report (audit 2026-07-22).
function workLine(summary){
  return summary.volume>0?`${compact(summary.volume)} kg moved`:`${summary.completedSets} working set${summary.completedSets===1?'':'s'}`;
}
function goalName(goal){
  if(goal.type==='strength')return exerciseById(goal.exerciseId)?.name||'Exercise';
  if(goal.type==='bodyweight')return 'Bodyweight';
  return 'Train every week';
}
const GOAL_KICKER={strength:'STRENGTH',bodyweight:'BODY',consistency:'CONSISTENCY'};
function goalCardMarkup(goal){
  const p=Core.goalProgress(goal,goalCtx());if(!p)return '';
  const pct=Math.round(p.pct*100);
  const achieved=!!goal.achievedAt;
  // Progress reads three ways - bar, number and sentence - so it never depends on colour alone.
  const value=p.current==null?'-':p.type==='consistency'?`${p.current}`:`${p.current}`;
  const foot=achieved?`Achieved ${formatDate(goal.achievedAt)}`
    :p.noEvidence?`Log a set of ${esc(goalName(goal))} to start tracking`
    :p.type==='consistency'?(p.done?`Done this week${p.streak>1?` · ${p.streak}-week streak`:''}`:`${p.remaining} more session${p.remaining===1?'':'s'} this week${p.streak?` · ${p.streak}-week streak`:''}`)
    :p.done?'Target reached':`${p.remaining} ${p.unit} to go`;
  return `<article class="goal-card card${achieved?' achieved':''}${p.done&&!achieved?' met':''}">
    <header class="goal-head"><p class="kicker">${GOAL_KICKER[p.type]}</p><button class="goal-more" onclick="openGoalMenu('${esc(goal.id)}')" aria-label="Goal options">•••</button></header>
    <h3>${esc(goalName(goal))}</h3>
    <p class="goal-nums"><strong>${esc(value)}</strong><span>/ ${esc(String(p.target))} ${esc(p.unit)}</span>${achieved?'<span class="goal-tick" aria-label="Achieved">✓</span>':''}</p>
    <div class="goal-bar" role="img" aria-label="${pct}% of the way there"><i style="--p:${(p.pct||0).toFixed(3)}"></i></div>
    <p class="goal-foot">${esc(foot)}<span class="goal-pct">${pct}%</span></p>
  </article>`;
}
function renderGoals(){
  const board=document.getElementById('goalBoard');if(!board)return;
  const active=state.goals.filter(g=>!g.achievedAt),done=state.goals.filter(g=>g.achievedAt);
  board.innerHTML=(active.length||done.length)
    ?active.map(goalCardMarkup).join('')+(done.length?`<details class="goal-done"><summary>${done.length} achieved</summary>${done.map(goalCardMarkup).join('')}</details>`:'')
    :`<button class="empty-card card starter-row" onclick="openGoalSheet()"><span><strong>No goals yet</strong><small>Name one thing you're chasing and every workout measures against it</small></span><b aria-hidden="true">›</b></button>`;
  renderTodayGoal();
}
// Today shows the single nearest-to-done active goal: a reminder of why you're here, not a list.
function renderTodayGoal(){
  const slot=document.getElementById('todayGoal');if(!slot)return;
  const ranked=state.goals.filter(g=>!g.achievedAt)
    .map(g=>({g,p:Core.goalProgress(g,goalCtx())})).filter(x=>x.p&&!x.p.noEvidence)
    .sort((a,b)=>b.p.pct-a.p.pct);
  if(!ranked.length){slot.innerHTML='';return;}
  const {g,p}=ranked[0],pct=Math.round(p.pct*100);
  const line=p.type==='consistency'?(p.done?'Done this week':`${p.remaining} more this week`):p.done?'Target reached':`${p.remaining} ${p.unit} to go`;
  slot.innerHTML=`<button class="goal-strip card-live" onclick="navigate('progress')"><span class="goal-strip-top"><span class="kicker">GOAL · ${GOAL_KICKER[p.type]}</span><span class="goal-pct">${pct}%</span></span><strong>${esc(goalName(g))}</strong><span class="goal-bar"><i style="--p:${p.pct.toFixed(3)}"></i></span><small>${esc(line)}</small></button>`;
}
// Stamp + celebrate goals the latest evidence just completed. Called after a session is finished
// and after a bodyweight entry - the only two moments new evidence can arrive.
function checkGoalAchievements(){
  const hit=Core.newlyAchieved(state.goals,goalCtx());
  if(!hit.length)return;
  const now=Date.now();
  hit.forEach(g=>{const target=state.goals.find(x=>x.id===g.id);if(target)target.achievedAt=now;});
  saveState();
  buzz([20,60,20,60,20]);
  showToast(hit.length===1?`★ Goal reached - ${goalName(hit[0])}`:`★ ${hit.length} goals reached`,true);
}
function openGoalSheet(){
  goalDraft={type:'strength',exerciseId:'',target:'',perWeek:String(state.preferences.weeklyWorkoutGoal||3)};
  renderGoalSheet();document.getElementById('sheet').showModal();
}
let goalDraft=null;
function setGoalType(type){goalDraft.type=type;renderGoalSheet();}
function pickGoalExercise(){openExercisePicker('goal');}
function renderGoalSheet(){
  const d=goalDraft;if(!d)return;
  const item=d.exerciseId?exerciseById(d.exerciseId):null;
  const timed=!!item?.timed;
  const types=[['strength','A lift'],['bodyweight','Bodyweight'],['consistency','Consistency']];
  let body;
  if(d.type==='strength'){
    body=`<button class="secondary-button full-button" onclick="pickGoalExercise()">${item?esc(item.name):'Choose an exercise'}</button>
      <div class="field" style="margin-top:12px"><label>TARGET ${timed?'HOLD (SECONDS)':'WEIGHT (KG)'}</label><input id="goalTarget" type="number" inputmode="decimal" min="1" step="${timed?'5':'2.5'}" value="${esc(d.target)}" placeholder="${timed?'e.g. 60':'e.g. 100'}"></div>
      <p class="goal-help">Measured against your best ${timed?'hold':'completed set'} of that exercise. Progress counts from where you are today.</p>`;
  }else if(d.type==='bodyweight'){
    const latest=Core.latestBodyweight(state.bodyweight);
    body=`<div class="field"><label>TARGET BODYWEIGHT (KG)</label><input id="goalTarget" type="number" inputmode="decimal" min="1" step="0.5" value="${esc(d.target)}" placeholder="e.g. 80"></div>
      <p class="goal-help">${latest?`You're at ${latest} kg today - up or down both work.`:'Log your weight on the Progress tab and this starts tracking.'}</p>`;
  }else{
    body=`<div class="field"><label>SESSIONS PER WEEK</label><input id="goalTarget" type="number" inputmode="numeric" min="1" max="14" step="1" value="${esc(d.perWeek)}"></div>
      <p class="goal-help">Counts completed workouts each week and tracks your streak. An unfinished week never breaks it.</p>`;
  }
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">NEW GOAL</p><h2>What are you chasing?</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>
    <div class="goal-types">${types.map(([v,l])=>`<button class="goal-type${d.type===v?' on':''}" onclick="setGoalType('${v}')" aria-pressed="${d.type===v}">${l}</button>`).join('')}</div>
    ${body}
    <div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="saveGoal()">Save goal</button></div>`;
}
function saveGoal(){
  const d=goalDraft;if(!d)return;
  const raw=Number(document.getElementById('goalTarget')?.value);
  if(!Number.isFinite(raw)||raw<=0){showToast('Give the goal a number to aim at');return;}
  if(d.type==='strength'&&!d.exerciseId){showToast('Choose an exercise first');return;}
  const now=Date.now();
  const goal={id:`g${now}`,type:d.type,exerciseId:d.type==='strength'?d.exerciseId:null,target:raw,created:now,achievedAt:null,startValue:null};
  // Freeze today's value as the start line so the bar shows the distance THIS goal covers.
  goal.startValue=d.type==='consistency'?null:Core.goalCurrent(goal,goalCtx());
  state.goals.push(goal);saveState();closeSheet();
  renderGoals();renderToday();
  showToast('Goal set');
  checkGoalAchievements(); // a goal already met by existing evidence resolves immediately
}
function openGoalMenu(id){
  const goal=state.goals.find(g=>g.id===id);if(!goal)return;
  const p=Core.goalProgress(goal,goalCtx());
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${GOAL_KICKER[goal.type]}</p><h2>${esc(goalName(goal))}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>
    <p class="goal-help">Target ${esc(String(goal.target))} ${esc(p?p.unit:'')}${p&&p.current!=null?` · now ${esc(String(p.current))}`:''}${goal.achievedAt?` · achieved ${formatDate(goal.achievedAt)}`:''}</p>
    <div class="sheet-actions"><button class="secondary-button" style="color:var(--danger)" onclick="deleteGoal('${esc(id)}')">Delete goal</button><button class="primary-button" onclick="closeSheet()">Done</button></div>`;
  document.getElementById('sheet').showModal();
}
function deleteGoal(id){state.goals=state.goals.filter(g=>g.id!==id);saveState();closeSheet();renderGoals();renderToday();showToast('Goal removed');}

// ---- Weekly muscle volume: two-ledger model (council 2026-07-20) ----
// Direct = completed sets where the muscle is the primary mover; assisting = completed sets
// where it helps (bench: chest direct, shoulders+arms assisting). Never summed into one number.
const MUSCLE_GROUPS=['Chest','Back','Shoulders','Arms','Legs','Core'];
function muscleLookup(id){
  const e=exerciseById(id);if(!e)return null;
  const all=(e.muscles||[e.muscle]).filter(m=>MUSCLE_GROUPS.includes(m));
  const primary=MUSCLE_GROUPS.includes(e.muscle)?e.muscle:all[0];
  return primary?{primary,all}:null;
}
function renderMuscleVolume(){
  const el=document.getElementById('muscleVolume');if(!el)return;
  const mv=Core.muscleVolume(state.history,muscleLookup);
  const ranges=state.preferences.muscleRanges||{};
  const rows=MUSCLE_GROUPS.map(m=>({m,d:mv[m]?.direct||0,a:mv[m]?.assisting||0})).sort((x,y)=>y.d-x.d||y.a-x.a);
  if(rows.every(r=>!r.d&&!r.a)){el.innerHTML=`<div class="empty-card card starter-row"><span><strong>No sets this week yet</strong><small>Complete a set and the per-muscle count starts here</small></span></div>`;return;}
  const max=Math.max(1,...rows.map(r=>Math.max(r.d,r.a)));
  el.innerHTML=rows.map(r=>{
    const range=ranges[r.m];
    const band=range?(r.d<range[0]?'under':r.d>range[1]?'over':'in'):'';
    return `<button class="mv-row" onclick="openMuscleDetail('${r.m}')" aria-label="${r.m}: ${r.d} direct sets, ${r.a} assisting">
      <span class="mv-name">${r.m}${range?`<small class="mv-range ${band}">${r.d} of ${range[0]}–${range[1]}${band==='under'?' · below':band==='over'?' · above':' · in range'}</small>`:''}</span>
      <span class="mv-tracks">${r.d?`<i class="mv-direct" style="width:${r.d/max*100}%"></i>`:''}${r.a?`<i class="mv-assist" style="width:${r.a/max*100}%"></i>`:''}</span>
      <span class="mv-nums"><strong>${r.d}</strong> direct · ${r.a} assist</span></button>`;
  }).join('');
}
function openMuscleDetail(muscle){
  if(!MUSCLE_GROUPS.includes(muscle))return;
  const slot=Core.muscleVolume(state.history,muscleLookup)[muscle]||{direct:0,assisting:0,by:{}};
  const rows=key=>Object.entries(slot.by||{}).filter(([,v])=>v[key]).sort((a,b)=>b[1][key]-a[1][key]).map(([id,v])=>`<div class="selected-row"><span><strong>${esc(exerciseById(id)?.name||id)}</strong></span><span class="mv-count">${v[key]} set${v[key]===1?'':'s'}</span></div>`).join('')||'<div class="empty-card card">None this week.</div>';
  const range=(state.preferences.muscleRanges||{})[muscle]||['',''];
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">THIS WEEK · ${muscle.toUpperCase()}</p><h2>${slot.direct} direct · ${slot.assisting} assisting</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>
  <p style="color:var(--taupe);margin-top:-6px;font-size:13px">Direct = completed sets where ${muscle.toLowerCase()} is the primary mover. Assisting = sets where it helps (bench press: chest direct; shoulders and arms assisting). The two are counted separately, never added.</p>
  ${(()=>{const ws=new Date();ws.setHours(0,0,0,0);ws.setDate(ws.getDate()-((ws.getDay()+6)%7));const wkStart=ws.getTime();const b=[0,0,0];let tot=0;for(const s of state.history){if(s.started<wkStart)continue;for(const ex of s.exercises||[]){if(muscleLookup(ex.exerciseId)?.primary!==muscle)continue;for(const set of ex.sets||[]){if(!set.done)continue;const r=Number(set.reps)||0;if(!r)continue;tot++;if(r<=5)b[0]++;else if(r<=12)b[1]++;else b[2]++;}}}if(!tot)return '';const p=n=>Math.round(n/tot*100);return `<p class="rep-dist">This week: ${p(b[0])}% sets 1–5 · ${p(b[1])}% 6–12 · ${p(b[2])}% 13+</p>`;})()}
  <div class="section-heading"><div><p class="kicker">DIRECT</p><h2>Working sets</h2></div></div><div class="selected-list">${rows('direct')}</div>
  <div class="section-heading"><div><p class="kicker">ASSISTING</p><h2>Exposure</h2></div></div><div class="selected-list">${rows('assisting')}</div>
  ${(()=>{const dvals=Core.muscleVolumeWeeks(state.history,muscleLookup,8).map(w=>w[muscle]?.direct||0);const dmax=Math.max(1,...dvals);return dvals.some(v=>v)?`<div class="section-heading"><div><p class="kicker">TREND</p><h2>Direct sets · 8 weeks</h2></div></div><div class="chart-card mv-spark">${dvals.map((v,i)=>`<span class="bar-col ${i===7?'active':''}"><b>${v||''}</b><i style="height:${Math.max(3,v/dmax*72)}%"></i><small>${i===7?'Now':'−'+(7-i)}</small></span>`).join('')}</div>`:'';})()}
  <div class="section-heading"><div><p class="kicker">OPTIONAL</p><h2>Weekly range - direct sets only</h2></div></div>
  <div style="display:flex;gap:10px"><div class="field" style="flex:1"><label>MIN</label><input id="mvMin" type="number" min="0" inputmode="numeric" value="${range[0]}"></div><div class="field" style="flex:1"><label>MAX</label><input id="mvMax" type="number" min="0" inputmode="numeric" value="${range[1]}"></div></div>
  <div class="sheet-actions"><button class="secondary-button" onclick="clearMuscleRange('${muscle}')">Clear range</button><button class="primary-button" onclick="saveMuscleRange('${muscle}')">Save</button></div>`;
  document.getElementById('sheet').showModal();
}
// Exercise detail sheet (Wave 2): e1RM trend, this-week volume, rep records, recent sessions, active cue.
// Opened from Library rows and the workout exercise head - one lean screen, no tabs.
function openExerciseDetail(id){
  const item=exerciseById(id);if(!item)return;
  const timed=!!item.timed; // a hold trends on best TIME; an estimated 1RM from a hang is meaningless
  const trend=Core.exerciseTrend(state.history,id);
  const chart=trend.length>=2?chartSvg(trend.map(p=>({t:p.started,v:timed?p.seconds:p.e1rm})),`${timed?'Best hold time':'Estimated one rep max'} trend for ${item.name}`):`<div class="locked-card card"><strong>Trend builds with data</strong>Log this ${timed?'hold':'lift'} across a few sessions and its ${timed?'best-time':'estimated-1RM'} line appears here.</div>`;
  const look=muscleLookup(id),mv=look?Core.muscleVolume(state.history,muscleLookup):{};
  const weekDirect=look&&mv[look.primary]?.by?.[id]?.direct||0;
  const records=Core.repRecords(state.history,id);
  const recordRows=records.length?records.map(r=>`<div class="rr-cell"><strong>${r.weight}</strong><small>${r.reps} rep${r.reps===1?'':'s'}</small></div>`).join(''):'<div class="empty-card card">No completed sets yet.</div>';
  const recent=Core.recentSessionsFor(state.history,id,3);
  const recentRows=recent.length?recent.map(s=>`<div class="selected-row"><span><strong>${formatDate(s.started)}</strong><small style="display:block;color:var(--muted)">${s.sets.map(x=>timed?`${x.weight?`${x.weight} kg × `:''}${x.reps||0} s`:`${x.weight||0} kg × ${x.reps||0}`).join(' · ')}</small></span></div>`).join(''):'<div class="empty-card card">No sessions logged yet.</div>';
  const cue=state.exerciseCues?.[id];
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">EXERCISE</p><h2>${esc(item.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>
  <p class="detail-equip">${esc(item.equipment||'')}${item.muscle?` · ${esc(item.muscle)}`:''}</p>
  ${cue?.text?`<div class="cue-strip">${esc(cue.text)}<small>cue · ${formatDate(cue.updated)}</small></div>`:''}
  <div class="detail-stat"><strong class="hero-num">${weekDirect}</strong><span>DIRECT SET${weekDirect===1?'':'S'} THIS WEEK</span></div>
  <div class="section-heading"><div><p class="kicker">${timed?'BEST HOLD':'EST. 1-REP MAX'}</p><h2>${timed?'Hold-time trend':'Strength trend'}</h2></div></div>${chart}
  ${timed?'':`<div class="section-heading"><div><p class="kicker">REP RECORDS</p><h2>Heaviest at each rep</h2></div></div><div class="rr-grid">${recordRows}</div>`}
  <div class="section-heading"><div><p class="kicker">RECENT</p><h2>Last sessions</h2></div></div><div class="selected-list">${recentRows}</div>`;
  document.getElementById('sheet').showModal();
}
function saveMuscleRange(muscle){
  const min=parseInt(document.getElementById('mvMin').value,10),max=parseInt(document.getElementById('mvMax').value,10);
  if(!Number.isFinite(min)||!Number.isFinite(max)||min<0||max<min){showToast('Range needs 0 ≤ min ≤ max');return;}
  state.preferences.muscleRanges={...(state.preferences.muscleRanges||{}),[muscle]:[min,max]};
  saveState();closeSheet();renderProgress();
}
function clearMuscleRange(muscle){
  const r={...(state.preferences.muscleRanges||{})};delete r[muscle];
  state.preferences.muscleRanges=r;saveState();closeSheet();renderProgress();
}
// Strength trend - evidence-gated (council 2026-07-18): a lift unlocks its chart after 3 logged sessions.
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
  const points=Core.exerciseTrend(state.history,strengthPick),name=exerciseById(strengthPick)?.name||'';
  // Prototype layout: one card carrying the lift name + its gain, the current est. 1RM as a big
  // numeral, and the area chart. The picker chips sit BELOW the card.
  // exerciseTrend points carry `started`, not `t`, and a single point cannot draw a line -
  // chartSvg threw on both. Same two-point guard trendChart has always used.
  if(points.length<2){trendEl.innerHTML=`<div class="locked-card card"><strong>Almost there</strong>One more session of ${esc(name)} draws the line.</div>`;return;}
  const latest=points.at(-1).e1rm,delta=Math.round((latest-points[0].e1rm)*10)/10;
  trendEl.innerHTML=`<div class="st-card">`
    +`<div class="st-top"><span class="st-name">${esc(name)}</span>`
    +`<span class="st-delta${delta<0?' down':''}">${delta>0?'+':''}${delta} kg</span></div>`
    +`<div class="st-hero"><strong class="hero-num" data-count="${latest}">0</strong><small>kg</small></div>`
    +chartSvg(points.map(pt=>({t:pt.started,v:pt.e1rm})),`${name} estimated one rep max over time`)
  +`</div>`;
  animateNumbers(trendEl);
}
function pickStrength(id){strengthPick=id;renderStrength();}
// Shared line-chart SVG (council 2026-07-20 refactor): points=[{t,v}], oldest→newest. Reused by the
// strength trend, the exercise detail sheet's e1RM, and the bodyweight trend - one drawing routine.
function chartSvg(points,ariaLabel){
  const W=340,H=160,PL=36,PR=12,PT=16,PB=26,IW=W-PL-PR,IH=H-PT-PB;
  const xs=points.map(p=>p.t),ys=points.map(p=>p.v);
  const minX=xs[0],maxX=xs.at(-1)||minX+1;
  let lo=Math.min(...ys),hi=Math.max(...ys);
  if(hi-lo<2){lo-=2;hi+=2;} const pad=(hi-lo)*0.12;lo=Math.max(0,lo-pad);hi+=pad;
  const X=t=>PL+(maxX===minX?IW/2:(t-minX)/(maxX-minX)*IW);
  const Y=v=>PT+IH-(v-lo)/(hi-lo)*IH;
  const line=points.map((p,i)=>`${i?'L':'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const area=`${line} L${X(maxX).toFixed(1)} ${(PT+IH).toFixed(1)} L${X(minX).toFixed(1)} ${(PT+IH).toFixed(1)} Z`;
  const ticks=[0,.5,1].map(k=>{const v=lo+(hi-lo)*(1-k),y=PT+IH*k;return `<line class="trend-grid-line" x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}"/><text class="trend-tick" x="${PL-6}" y="${y+3}" text-anchor="end">${Math.round(v)}</text>`;}).join('');
  const dots=points.map(p=>`<circle class="trend-dot" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.4"/>`).join('');
  const shortDate=t=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short'}).format(new Date(t));
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}"><defs><linearGradient id="trendFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(224,110,31,.26)"/><stop offset="1" stop-color="rgba(224,110,31,0)"/></linearGradient></defs>${ticks}<path class="trend-area" d="${area}"/><path class="trend-line" d="${line}"/>${dots}<text class="trend-tick" x="${PL}" y="${H-8}">${shortDate(minX)}</text><text class="trend-tick" x="${W-PR}" y="${H-8}" text-anchor="end">${shortDate(maxX)}</text></svg>`;
}
function trendChart(points,name){
  if(points.length<2)return `<div class="locked-card card"><strong>Almost there</strong>One more session of ${esc(name)} draws the line.</div>`;
  const ys=points.map(p=>p.e1rm),latest=ys.at(-1),delta=Math.round((latest-ys[0])*10)/10;
  const svg=chartSvg(points.map(p=>({t:p.started,v:p.e1rm})),`Estimated one rep max trend for ${name}`);
  return `<div class="trend-card"><div class="trend-head"><strong>${esc(name)}</strong><span>${latest} kg est. 1RM${delta?` · ${delta>0?'+':''}${delta} kg`:''}</span></div>${svg}</div>`;
}
function renderPrFeed(){
  const feed=Core.prFeed(state.history,8);
  document.getElementById('prFeed').innerHTML=feed.length?feed.map(pr=>{
    const item=exerciseById(pr.exerciseId);
    const parts=(pr.seconds?[`${pr.seconds} s hold`,pr.weight?`${pr.weight} kg`:'']:[pr.weight?`${pr.weight} kg top set`:'',pr.estimated1RM?`${pr.estimated1RM} kg est. 1-rep max`:'']).filter(Boolean).join(' · ')||'New best';
    return `<div class="pr-row"><span class="pr-mark notched">PR</span><span><strong>${esc(item?.name||'Exercise')}</strong><small>${parts}</small></span><time>${formatDate(pr.started)}</time></div>`;
  }).join(''):`<div class="empty-card card starter-row"><span><strong>No records yet</strong><small>Beat a previous best and it lands here automatically</small></span></div>`;
}
function renderWeekChart(){
  const now=Date.now(),weeks=[];
  for(let i=7;i>=0;i--){const end=now-i*7*DAY,start=end-7*DAY,count=state.history.filter(s=>s.started>start&&s.started<=end).length;weeks.push({count,label:i?'−'+i:'Now'});}
  const max=Math.max(1,...weeks.map(w=>w.count));
  document.getElementById('weekChart').innerHTML=weeks.map((week,index)=>`<span class="bar-col ${index===7?'active':''}"><b>${week.count||''}</b><i style="height:${Math.max(3,week.count/max*72)}%" title="${week.count} workouts"></i><small>${week.label}</small></span>`).join('');
}

// ---- Weekly recap (Wave 2): gated card, honest accumulation state below the unlock threshold. ----
const RECAP_MIN_SESSIONS=3;
function renderWeeklyRecap(){
  const el=document.getElementById('weeklyRecap');if(!el)return;
  const sessions=state.history.length;
  const spanDays=sessions?(Date.now()-Math.min(...state.history.map(s=>s.started)))/DAY:0;
  if(sessions<RECAP_MIN_SESSIONS&&spanDays<7){
    if(!sessions){el.innerHTML='';return;}
    const need=RECAP_MIN_SESSIONS-sessions;
    el.innerHTML=`<div class="recap-card card recap-locked"><p class="kicker">WEEKLY RECAP</p><strong>${sessions} of ${RECAP_MIN_SESSIONS} sessions logged</strong><p>Recap unlocks with ${need} more session${need===1?'':'s'} - or a week of data.</p><div class="lock-progress">${[0,1,2].map(i=>`<i class="${i<sessions?'full':''}"></i>`).join('')}</div></div>`;
    return;
  }
  const recap=Core.weeklyRecap(state.history,muscleLookup);
  // Top persistent imbalance (with name) for an honest L/R insight sentence.
  const bal=Core.sideBalance(state.history);
  let balEntry=null;
  for(const [id,b] of Object.entries(bal)){
    if(b.gapPct==null||b.left.sets<1||b.right.sets<1)continue;
    if(!balEntry||Math.abs(b.gapPct)>Math.abs(balEntry.gapPct))balEntry={name:exerciseById(id)?.name||'a lift',gapPct:b.gapPct};
  }
  const insights=Core.recapInsights(recap,balEntry);
  const delta=(n,fmt)=>{if(!n)return '<span class="rc-delta flat">no change</span>';const f=fmt||(v=>String(v));return `<span class="rc-delta ${n>0?'up':'down'}">${n>0?'▲':'▼'} ${f(Math.abs(n))}</span>`;};
  const stat=(label,val,d)=>`<div class="rc-stat"><span>${label}</span><strong>${val}</strong>${d}</div>`;
  const painTxt=recap.painDelta==null?'':`<p class="rc-pain">Avg pre-session pain ${recap.painDelta>0?'up':recap.painDelta<0?'down':'level'} ${Math.abs(recap.painDelta)} vs last week.</p>`;
  el.innerHTML=`<div class="recap-card card card-live"><p class="kicker">WEEKLY RECAP · VS LAST WEEK</p><div class="rc-grid">
    ${stat('Sets',recap.sets,delta(recap.setsDelta))}
    ${stat('Volume',compact(recap.volume)+' kg',delta(recap.volumeDelta,compact))}
    ${stat('Workouts',recap.workouts,delta(recap.workoutsDelta))}
    ${stat('PRs',recap.prs,delta(recap.prsDelta))}
  </div>${insights.length?`<div class="rc-insights">${insights.map(s=>`<p>${esc(s)}</p>`).join('')}</div>`:''}${painTxt}</div>`;
}
// ---- Pain trend (Wave 3): bars once >=3 sessions carry a pre-session check-in. ----
function renderPainTrend(){
  const el=document.getElementById('painTrend');if(!el)return;
  const pts=state.history.slice().sort((a,b)=>a.started-b.started).filter(s=>s.checkin&&s.checkin.pre!=null).map(s=>({t:s.started,v:Number(s.checkin.pre)}));
  if(pts.length<3){el.innerHTML='';return;}
  const recent=pts.slice(-10);
  el.innerHTML=`<div class="section-heading"><div><p class="kicker">PAIN CHECK-IN</p><h2>Pre-session · 0–10</h2></div></div><div class="chart-card pain-bars">${recent.map(p=>`<span class="bar-col pain-col"><b>${p.v}</b><i style="height:${Math.max(4,p.v/10*72)}%"></i><small>${new Intl.DateTimeFormat(undefined,{day:'numeric'}).format(new Date(p.t))}</small></span>`).join('')}</div>`;
}
// ---- L/R balance board (Wave 2): mirrored bars from a center axis, shared scale, persistent-gap flag. ----
function renderBalance(){
  const el=document.getElementById('balanceBoard');if(!el)return;
  const bal=Core.sideBalance(state.history);
  const entries=Object.entries(bal);
  if(!entries.length){el.innerHTML=`<div class="empty-card card starter-row"><span><strong>No side-tagged sets yet</strong><small>Tap a set's number mid-workout to tag it Left or Right</small></span></div>`;return;}
  // Mirrored comparison only for exercises with BOTH sides; one-sided data gets a truthful partial
  // row instead of a misleading "no data" empty state (Codex P3).
  const both=entries.filter(([,b])=>b.left.sets>0&&b.right.sets>0);
  const oneSided=entries.filter(([,b])=>!(b.left.sets>0&&b.right.sets>0));
  const max=Math.max(1,...both.map(([,b])=>Math.max(b.left.topWeight,b.right.topWeight)));
  const bothRows=both.map(([id,b])=>{
    const flag=b.gapPct!=null&&Math.abs(b.gapPct)>10&&b.gapSessions>=2;
    const gapTxt=b.gapPct==null?'':`${b.gapPct>0?'L':'R'} +${Math.abs(b.gapPct)}%`;
    return `<div class="bal-row"><div class="bal-name">${esc(exerciseById(id)?.name||id)}${flag?'<span class="bal-flag">⚠ · gap</span>':''}</div>
      <div class="bal-bars"><div class="bal-side bal-left"><i style="width:${b.left.topWeight/max*100}%"></i><b>${b.left.topWeight} kg L</b></div><div class="bal-axis" aria-hidden="true"></div><div class="bal-side bal-right"><i style="width:${b.right.topWeight/max*100}%"></i><b>R ${b.right.topWeight} kg</b></div></div>
      ${gapTxt?`<div class="bal-gap">${gapTxt} top-set gap</div>`:''}</div>`;
  }).join('');
  const partialRows=oneSided.map(([id,b])=>{
    const hasL=b.left.sets>0,side=hasL?'Left':'Right',other=hasL?'right':'left',top=hasL?b.left.topWeight:b.right.topWeight,n=hasL?b.left.sets:b.right.sets;
    return `<div class="bal-row bal-partial"><div class="bal-name">${esc(exerciseById(id)?.name||id)}</div><div class="bal-partial-line">${side} only so far - ${top} kg top, ${n} set${n===1?'':'s'}. Tag some ${other} sets to compare.</div></div>`;
  }).join('');
  el.innerHTML=`<div class="bal-board">${bothRows}${partialRows}</div>`;
}
// ---- Bodyweight (Wave 3): current weight + 90-day trend via the shared chart. ----
function renderBodyweight(){
  const el=document.getElementById('bodyweightCard');if(!el)return;
  const log=Core.bodyweightTrend(state.bodyweight,90);
  if(!log.length){el.innerHTML=`<button class="empty-card card starter-row" onclick="openBodyweightLog()"><span><strong>No weigh-ins yet</strong><small>Log your first weight to start the trend</small></span><b aria-hidden="true">›</b></button>`;return;}
  const latest=log.at(-1),first=log[0],d=Math.round((latest.kg-first.kg)*10)/10;
  const chart=log.length>=2?chartSvg(log.map(p=>({t:p.t,v:p.kg})),'Bodyweight trend, last 90 days'):'';
  el.innerHTML=`<div class="bw-card card"><div class="bw-head"><strong class="hero-num">${latest.kg}</strong><span>kg${d?` · ${d>0?'+':''}${d} kg over ${log.length} weigh-in${log.length===1?'':'s'}`:''}</span></div>${chart}</div>`;
}
function openBodyweightLog(){
  const log=Core.bodyweightTrend(state.bodyweight,90),latest=log.at(-1);
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">BODYWEIGHT</p><h2>Log weight</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>WEIGHT (KG)</label><input id="bwInput" type="number" inputmode="decimal" min="0" step="0.1" value="${latest?esc(latest.kg):''}" placeholder="e.g. 82.5" onkeydown="if(event.key==='Enter')saveBodyweight()"></div><button class="primary-button full-button" onclick="saveBodyweight()">Save</button>`;
  document.getElementById('sheet').showModal();
  setTimeout(()=>document.getElementById('bwInput')?.focus(),60);
}
function saveBodyweight(){
  const kg=Number(document.getElementById('bwInput').value);
  if(!Number.isFinite(kg)||kg<=0)return showToast('Enter a weight in kg');
  if(!Array.isArray(state.bodyweight))state.bodyweight=[];
  const rounded=Math.round(kg*10)/10;
  state.bodyweight.push({t:Date.now(),kg:rounded});
  saveState();closeSheet();renderProgress();showToast('Weight logged');
  checkGoalAchievements(); // new evidence - a bodyweight goal may have just landed
  offerBodyweightBackfill(rounded);
}
// Sessions logged before a lifter's FIRST weigh-in have no measured body mass, so their calisthenics
// cannot honestly be valued in kilograms. Silently borrowing today's weight for them would be the
// retroactive fabrication this whole model exists to avoid (council 2026-08-05, Codex's objection,
// upheld). So it is ASKED - once, one tap, with the count stated - and the answer is stored as a
// preference rather than written into the sessions, so it stays reversible.
function offerBodyweightBackfill(kg){
  const pending=Core.sessionsAwaitingBodyweight(state.history,state.bodyweight,state.preferences.backfillBodyweight);
  if(!pending.length)return;
  document.getElementById('confirmContent').innerHTML=`<h2>Count your earlier calisthenics too?</h2>`
    +`<p>${pending.length} session${pending.length===1?'':'s'} happened before your first weigh-in, so ${pending.length===1?'its':'their'} push-ups, pull-ups and dips are not counted in kilograms yet. Use <strong>${esc(String(kg))} kg</strong> for ${pending.length===1?'it':'them'}? That is an estimate for those older sessions only, and you can undo it in Settings.</p>`
    +`<div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Leave them as reps</button><button class="primary-button" onclick="applyBodyweightBackfill(${Number(kg)})">Use ${esc(String(kg))} kg</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function applyBodyweightBackfill(kg){
  state.preferences.backfillBodyweight=Number(kg)||null;
  saveState();closeConfirm();renderProgress();renderToday();
  showToast(`Earlier sessions counted at ${kg} kg`);
}
function clearBodyweightBackfill(){
  state.preferences.backfillBodyweight=null;
  saveState();renderProgress();renderToday();openSettings();
  showToast('Earlier sessions back to reps only');
}
// Exercises the lifter re-opened by tapping their done row. Session-scoped, deliberately not
// persisted: reopening is a glance, not a state change worth surviving a reload.
let forcedOpen=new Set();
// The ACTIVE exercise = the first one with an unfinished set. Only it may own the NOW row, and only
// it is lit; six cards each claiming "next" is no hierarchy at all.
function activeExerciseIndex(session){
  const i=(session?.exercises||[]).findIndex(ex=>ex.sets.some(s=>!s.done));
  return i;
}
function renderWorkout(){
  const session=state.activeSession;if(!session){navigate('today');return;}
  document.getElementById('workoutTitle').textContent=session.name;
  renderWorkoutMetrics();
  const activeIdx=activeExerciseIndex(session);
  document.getElementById('workoutExercises').innerHTML=checkinMarkup(session)+bookendMarkup(session)+(session.exercises.length?session.exercises.map((ex,i)=>workoutExerciseMarkup(ex,i,activeIdx)).join(''):`<div class="empty-card card"><strong>Empty workout</strong>Add your first exercise and get moving.</div>`);
  const paused=!!session.pausedAt,btn=document.getElementById('pauseButton');
  btn.textContent=paused?'Resume':'Pause';btn.setAttribute('aria-pressed',String(paused));
  document.getElementById('pausedFlag').hidden=!paused; // a word, not a hue - the state must survive colour-blindness
  document.getElementById('view-workout').classList.toggle('paused',paused);
  renderSessionProgress(session);
  startActiveClock();
}
// Sticky-header session progress: how much of the session's INTENDED work is logged, and how many
// sets remain. Counts the same "planned" sets the per-exercise rail counts, so the two never disagree.
function renderSessionProgress(session){
  let done=0,total=0;
  for(const ex of session.exercises||[]){
    const sets=ex.sets||[],last=sets[sets.length-1];
    const t=sets.length-((sets.length>1&&last&&!last.done&&!last.planned&&(last.prefilled||(!last.weight&&!last.reps)))?1:0);
    total+=t;done+=Core.doneSets(ex).length;
  }
  const left=Math.max(0,total-done),pct=total?Math.min(100,Math.round(done/total*100)):0;
  const bar=document.getElementById('sessionBar');if(bar)bar.style.width=pct+'%';
  const label=document.getElementById('setsLeft');
  if(label)label.textContent=total?(left?`${left} set${left===1?'':'s'} left`:'All sets logged'):'No sets yet';
}
// Session bookends (2026-07-28). The catalogue carried 31 mobility/stretch entries that nothing ever
// sequenced, so they only got used by someone who already knew what to look for. The strip proposes
// drills for the patterns THIS session actually trains: warm-up while nothing is logged yet,
// cool-down once real work is done. One control, contextual: skipping costs nothing.
const PREP_MUSCLES=new Set(['Mobility','Stretches']);
function bookendFor(session){
  const ids=(session?.exercises||[]).map(e=>e.exerciseId);
  const phase=(session?.exercises||[]).some(e=>Core.doneSets(e).length)?'cooldown':'warmup';
  // Offering a warm-up before a Desk Reset is nonsense: the session IS mobility work. A session made
  // only of drills needs no bookends (Mark hit this the first time he ran one, 2026-07-28).
  if(ids.length&&ids.every(id=>PREP_MUSCLES.has(exerciseById(id)?.muscle)))return {phase,picks:[]};
  const patterns=Core.sessionPatterns(ids,id=>exerciseById(id)?.patterns);
  const present=new Set(ids);
  return {phase,picks:Core.prepFor(patterns,prepMap[phase],3).filter(id=>!present.has(id)&&exerciseById(id))};
}
function bookendMarkup(session){
  const {phase,picks}=bookendFor(session);
  if(!picks.length)return '';
  return `<div class="bookend-strip"><div><p class="kicker">${phase==='warmup'?'WARM UP':'COOL DOWN'}</p><small>${picks.map(id=>esc(exerciseById(id).name)).join(' · ')}</small></div><button class="secondary-button" onclick="addBookend()">Add ${picks.length}</button></div>`;
}
function addBookend(){
  const session=state.activeSession;if(!session)return;
  const {phase,picks}=bookendFor(session);
  if(!picks.length)return;
  const rows=picks.map(id=>({exerciseId:id,notes:'',sets:[{weight:'',reps:'',done:false}]}));
  // Warm-ups belong BEFORE the work (Mark, 2026-08-01); cool-downs still append.
  if(phase==='warmup'){session.exercises.unshift(...rows);if(restExerciseIndex>=0)restExerciseIndex+=rows.length;}
  else session.exercises.push(...rows);
  saveState();renderWorkout();
  showToast(`${picks.length} ${phase==='warmup'?'warm-up':'cool-down'} drill${picks.length===1?'':'s'} added`);
}
// Three-touch safety loop: pre-session 0–10, next-session flare yes/no. Optional, skippable - friction kills habits.
function checkinMarkup(session){
  // The whole loop is rehab machinery. Someone with no injury has no "problem area" to rate, and
  // being asked on session one reads like a medical form, not a training app (audit 2026-07-22).
  if(!injuryMode())return '';
  if(!session.checkin||session.checkin.dismissed)return '';
  const last=state.history[0],askFlare=Boolean(last?.checkin&&last.checkin.flare==null);
  const askPre=session.checkin.pre==null;
  if(!askPre&&!askFlare)return '';
  const scale=askPre?`<p>Any aches or niggles today?<small>0 = feel great, 10 = don't train today. Optional - skip if all good.</small></p><div class="checkin-scale">${Array.from({length:11},(_,n)=>`<button onclick="setPreCheckin(${n})" aria-label="Rate ${n} out of 10">${n}</button>`).join('')}</div>`:'';
  const flare=askFlare?`<div class="checkin-row" style="margin-top:${askPre?'12px':'0'}"><button onclick="setFlare(false)">No flare since last session</button><button onclick="setFlare(true)">Had a flare</button></div>`:'';
  return `<div class="checkin-card" id="checkinCard">${scale}${flare}<button class="checkin-skip" onclick="dismissCheckin()">Skip</button></div>`;
}
function setPreCheckin(n){if(!state.activeSession?.checkin)return;state.activeSession.checkin.pre=n;saveState();renderWorkout();if(n>=7)showToast('Noted. Keep loads easy today.');}
// The flare answer arrives a SESSION LATE: it rewrites a workout that was already finished, and
// therefore already uploaded. Saving locally is not enough: the coach reads the Drive copy, so
// without this re-upload the one field it requires could never reach it, no matter how diligently
// the question was answered (audit 2026-07-28: the same dead-data shape as routineId).
function resyncSession(session){
  if(session&&Sync)try{Sync.onSessionComplete(session);}catch{} // best-effort, never blocks the flow
}
function setFlare(had){
  const last=state.history[0];if(last?.checkin)last.checkin.flare=had;
  saveState();resyncSession(last);renderWorkout();
  if(had)showToast('Logged. Add a note on any exercise that felt off.');
}
function dismissCheckin(){
  const session=state.activeSession;if(!session?.checkin)return;
  session.checkin.dismissed=true;
  const last=state.history[0];
  if(last?.checkin&&last.checkin.flare==null){last.checkin.flare='skipped';saveState();resyncSession(last);}
  else saveState();
  renderWorkout();
}
// Just the safety branch of contextLine(): are we above the last CONFIRMED tolerated load?
function aboveConfirmedLoadLine(){
  const s=state.activeSession;if(!s)return '';
  for(const ex of s.exercises){
    const conf=Core.lastConfirmedExposure(state.history,ex.exerciseId);
    if(conf&&conf.topWeight){
      const top=Math.max(0,...ex.sets.filter(x=>x.done).map(x=>Number(x.weight)||0));
      if(top>conf.topWeight)return `Above your last confirmed load on ${exerciseById(ex.exerciseId)?.name||'this lift'}.`;
    }
  }
  return '';
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
  // The sticky header now states live session progress, so this line keeps ONLY the safety
  // message. Both used to render a sets-left count, computed differently, 40px apart - the header
  // said "2 sets left" while this said "1 set left." contextLine() itself is untouched; Today
  // still uses it.
  const ctx=document.getElementById('workoutContext');
  if(ctx)ctx.textContent=aboveConfirmedLoadLine();
  // Live volume beside the clock in the sticky header (v2). Same summary, no second computation.
  const vol=document.getElementById('workoutVolumeLine');
  if(vol)vol.textContent=summary.volume>0?`${compact(summary.volume)} kg lifted`:'no load yet';
  if(state.activeSession)renderSessionProgress(state.activeSession);
}
// Wave 1: the session's pain controller and per-exercise progression target - pure Core, surfaced here.
function sessionPainGate(){return Core.painGate(state.history,state.activeSession?.checkin?.pre);}
// Injury mode carries the whole rehab layer: the pain check-in, the flare question, and the
// tolerance gate that only lets a confirmed pain-free session become a progression basis. Someone
// not training around an injury has nothing to confirm tolerance against, so their completed
// sessions are evidence on their own - otherwise they'd never see a target at all (audit 2026-07-22).
function injuryMode(){return state.preferences.injuryMode===true;}
function targetFor(exerciseId,pg){return Core.nextTarget(state.history,exerciseId,{step:Number(state.preferences.weightStep)||2.5,block:!!(pg&&pg.block),stepDown:!!(pg&&pg.stepDown),requireConfirmation:injuryMode()});}
// Human phrasing for a target result (null = no confirmed basis yet). Timed holds read in seconds.
function formatTarget(t){
  if(!t)return '';
  if(t.rule==='blocked')return 'Train around it today';
  if(t.timed)return `${t.weight?`${t.weight} kg × `:''}${t.reps} s`;
  return `${t.weight} kg × ${t.reps}`;
}
const RULE_WORD={'add-rep':'build reps','add-load':'load up','add-time':'add time','hold':'hold','repeat-no-rir':'repeat','step-down':'step-down','blocked':'blocked'};
// The delta chip on the target strip: what today's target changes versus the last confirmed set.
// Derived purely from those two numbers - it never invents a direction the rule did not produce.
function targetDelta(target,basis,timed){
  if(!target||target.rule==='blocked')return '';
  if(!basis)return 'first time';
  const dw=Number(target.weight||0)-Number(basis.weight||0);
  const dr=Number(target.reps||0)-Number(basis.reps||0);
  if(dw>0)return `+${Math.round(dw*100)/100} kg`;
  if(dw<0)return `${Math.round(dw*100)/100} kg`;
  if(dr>0)return timed?`+${dr}s`:`+${dr} rep${dr===1?'':'s'}`;
  if(dr<0)return timed?`${dr}s`:`${dr} reps`;
  return 'hold';
}
function workoutExerciseMarkup(exercise,index,activeIdx){
  const item=exerciseById(exercise.exerciseId),previous=Core.previousPerformance(state.history,exercise.exerciseId);
  const timed=!!item?.timed; // hold-type exercise: the "reps" field stores seconds
  const prevText=previous.length?`Last time: ${previous.slice(0,3).map(s=>timed?`${s.weight?`${s.weight} kg × `:''}${s.reps} s`:`${s.weight||'-'} kg × ${s.reps}`).join(' · ')}`:'First time - set your benchmark';
  // Neutral facts only - the app never prescribes a dose (council 2026-07-18).
  // "Confirmed tolerated" is rehab language about an injury - only meaningful in injury mode.
  const confirmed=injuryMode()?Core.lastConfirmedExposure(state.history,exercise.exerciseId):null;
  const confirmedText=!injuryMode()?'':(confirmed?`Confirmed tolerated ${formatDate(confirmed.started)}: ${confirmed.topWeight||'-'} kg · ${timed?`${confirmed.topReps} s`:`${confirmed.topReps} reps`} · ${confirmed.setCount} set${confirmed.setCount===1?'':'s'}`:(previous.length?'No confirmed-tolerated baseline yet (check-ins pending)':''));
  // Progression target line - a second line under "Last time", with a "why?" that opens the evidence sheet.
  const pg=sessionPainGate(),target=targetFor(exercise.exerciseId,pg);
  const blocked=target&&target.rule==='blocked';
  // A workout scheme's plan, restated as neutral structure (never amber - it is not a target and
  // not a load). Set count is deliberately absent: the rail already counts sets, and +Add Set would
  // make any stamped number a lie.
  const planLine=exercise.targetReps?`<span class="plan-line">Plan: ${esc(exercise.targetReps)} ${timed?'s':'reps'}${exercise.restSeconds?` · rest ${esc(restLabel(exercise.restSeconds))}`:''}</span>`:'';
  const cue=state.exerciseCues?.[exercise.exerciseId];
  // Rail denominator excludes the auto-appended trailing set (empty/prefilled, not done) -
  // otherwise finishing every intended set still reads as incomplete (Codex verify 2026-07-20).
  const sets=exercise.sets,last=sets[sets.length-1];
  const total=sets.length-((sets.length>1&&last&&!last.done&&!last.planned&&(last.prefilled||(!last.weight&&!last.reps)))?1:0);
  // Blank done-ticks are not evidence - completion counts route through the same doneSets rule (Codex P1).
  const doneCount=Core.doneSets(exercise).length,doneFrac=total?Math.min(1,doneCount/total):0;
  // RIR capture - one optional tap once the last NON-DROP set is done. A drop set's RIR must never
  // progress the heavy set, so drops neither trigger nor satisfy the ask (Codex P1).
  // "Planned" mirrors the rail denominator: a not-done set that is prefilled-or-blank isn't intended yet.
  const working=sets.filter(s=>!s.drop),workingPlanned=working.filter(s=>s.done||s.planned||(!s.prefilled&&(s.weight!==''||s.reps!=='')));
  const rirDone=workingPlanned.length>0&&workingPlanned.every(s=>s.done);
  const rirRow=rirRowMarkup(exercise,index,rirDone);
  // v2 collapse rule (prototype parity): a finished exercise folds to a calm done row, but NEVER
  // before its final-set RIR is answered or skipped - collapsing first put the RIR tap out of reach
  // (BUILD-NEXT non-negotiable #3). Tapping the done row re-opens it for the rest of the session.
  // `rirDone` - NOT `sets.every(done)` - is the right predicate: the app auto-appends a blank
  // trailing set after the last one is ticked, so every-set-done is never true and the card would
  // never collapse. rirDone counts only the PLANNED working sets (the same denominator the rail and
  // the RIR row use), so a card collapses exactly once its RIR question has been asked and answered.
  const collapsed=rirDone&&exercise.rir!==undefined&&!forcedOpen.has(index);
  const isActive=index===activeIdx;
  const exVolume=Core.doneSets(exercise).reduce((a,x)=>a+(Number(x.weight)||0)*(Number(x.reps)||0),0);
  const rirWord=exercise.rir===undefined?'':(exercise.rir==='skip'?' · RIR skipped':` · RIR ${exercise.rir==='4'||exercise.rir===4?'4+':exercise.rir}`);
  const doneSummary=`${doneCount} set${doneCount===1?'':'s'}${exVolume?` · ${compact(exVolume)} kg`:''}${rirWord}`;
  const ssLink=exercise.supersetWithNext&&index<state.activeSession.exercises.length-1?'<div class="ss-link" aria-hidden="true"><span>⇅ superset</span></div>':'';
  if(collapsed){
    // The done row is draggable (same gripDown handler) but deliberately does NOT carry
    // .exercise-grip: layout-check does closest('.exercise-head') on every grip it finds, and a
    // collapsed card has no header. data-index, which the drag test selects, is unchanged.
    return `<article class="workout-exercise done-card" data-index="${index}" style="--done:1">`
      +`<button class="done-row" type="button" aria-label="${esc(item?.name||'Exercise')} finished: ${esc(doneSummary)}. Tap to reopen" onclick="reopenExercise(${index})">`
      +`<span class="done-mark" aria-hidden="true">✓</span>`
      +`<span class="row-text"><strong>${esc(item?.name||'Exercise')}</strong><small>${esc(doneSummary)}</small></span>`
      +`<span class="done-edit">Edit</span></button>`
      +`<button class="done-grip" type="button" aria-label="Drag to reorder ${esc(item?.name||'this exercise')}" onpointerdown="gripDown(event,${index})" oncontextmenu="return false"><span class="grip-dots" aria-hidden="true"></span></button>`
      +`</article>${ssLink}`;
  }
  // The design's evidence line carries the DATE of that last exposure, not just the numbers.
  const lastSess=state.history.find(s=>(s.exercises||[]).some(e=>e.exerciseId===exercise.exerciseId&&Core.doneSets(e).length));
  const lastWhen=lastSess?` · ${formatDate(lastSess.started)}`:'';
  const lastLine=previous.length?`Last · ${timed?`${previous[0].reps}s hold`:`${previous[0].weight?`${previous[0].weight} kg × `:'bodyweight × '}${previous[0].reps}`}${lastWhen}`:'Last · no history yet';
  const basis=previous.length?previous[0]:null;
  const delta=targetDelta(target,basis,timed);
  // Graphic target strip: teal evidence line + amber delta chip, then TODAY at 20px with the why?.
  const targetStrip=target?`<div class="target-strip${blocked?' blocked':''}">`
      +`<div class="ts-top"><span class="ts-last">${esc(lastLine)}</span>${delta?`<span class="ts-delta">${esc(delta)}</span>`:''}</div>`
      +`<div class="ts-bottom"><span class="ts-today"><small>TODAY</small><b>${esc(formatTarget(target))}</b></span>`
      +`<button class="why-target" type="button" onclick="openTargetWhy(${index})" aria-label="Why this target">why?</button></div>`
    +`</div>`:`<div class="previous-strip">${esc(prevText)}</div>`;
  const activeSetIdx=isActive?exercise.sets.findIndex(s=>!s.done):-1;
  const bwFactor=Core.bodyweightFactor(exercise.exerciseId);
  const setRows=exercise.sets.map((set,setIndex)=>setMarkup(set,index,setIndex,previous[setIndex]||previous[0],setIndex===activeSetIdx,previous[0],timed,bwFactor)).join('');
  return `<article class="workout-exercise${isActive?' lit':''}" data-index="${index}" style="--done:${doneFrac.toFixed(3)}">`
    +`<header class="exercise-head">`
      +`<button class="exercise-grip" type="button" aria-label="Drag to reorder ${esc(item?.name||'this exercise')}, or tap for move options" onpointerdown="gripDown(event,${index})" onclick="openWorkoutExerciseMenu(${index})" oncontextmenu="return false"><span class="grip-dots" aria-hidden="true"></span><span class="ex-index">${String(index+1).padStart(2,'0')}</span></button>`
      +`<div class="ex-id"><h2 class="exercise-title" onclick="openExerciseDetail('${esc(exercise.exerciseId)}')">${esc(item?.name||'Exercise')}</h2><p>${esc(item?.equipment||'')}</p></div>`
      +`<button class="exercise-more" onclick="openWorkoutExerciseMenu(${index})" aria-label="Exercise options">•••</button>`
    +`</header>`
    +`<div class="ex-rail" aria-hidden="true"><i style="width:${Math.round(doneFrac*100)}%"></i></div>`
    
    +`${cue?.text?`<div class="cue-strip">${esc(cue.text)}<small>cue · ${formatDate(cue.updated)}</small></div>`:''}`
    +`${planLine}${confirmedText?`<span class="confirmed-line">${esc(confirmedText)}</span>`:''}`
    +targetStrip
    +`<div class="set-grid header"><span>Set</span><span>kg</span><span>${timed?'Sec':'Reps'}</span><span>Done</span></div>`
    +setRows+rirRow
    +memoryMarkup(exercise,index,timed)
    +`<div class="set-footer"><button class="add-set" onclick="addSet(${index})">+ Add set</button>${warmupButton(exercise,index,target,timed)}<button class="add-drop" onclick="addDropSet(${index})" title="Add a −20% drop set after your last completed set">+ Drop</button></div>`
  +`</article>${ssLink}`;
}
// Exercise memory, in the cockpit, where the decision is actually made. The app already held all of
// this (recentSessionsFor, the standing cue, per-session notes) but only ever surfaced ONE previous
// set, on a different screen. Collapsed by default so the card stays a logging surface; one tap
// opens the last three exposures, the best set on record, and a note that persists to next time.
function memoryMarkup(exercise,index,timed){
  const id=exercise.exerciseId;
  const recent=Core.recentSessionsFor(state.history,id,3);
  const note=state.exerciseCues?.[id];
  if(!recent.length&&!note?.text)return '';
  const unit=timed?'s':'reps';
  const rows=recent.map(entry=>{
    const top=entry.sets.reduce((best,x)=>(x.weight>best.weight||(x.weight===best.weight&&x.reps>best.reps))?x:best,entry.sets[0]);
    const line=entry.sets.map(x=>timed?`${x.reps} s`:`${x.weight||'-'} kg × ${x.reps}`).join(' · ');
    return `<div class="mem-row"><span class="mem-when">${esc(formatDate(entry.started))}</span><span class="mem-sets">${esc(line)}</span></div>`;
  }).join('');
  // The best set ON RECORD, not just in the last three - that is the number worth chasing.
  let best=null;
  for(const entry of Core.recentSessionsFor(state.history,id,50))
    for(const set of entry.sets)
      if(!best||set.weight>best.weight||(set.weight===best.weight&&set.reps>best.reps))best=set;
  const bestLine=best?`<div class="mem-best"><span>Best on record</span><strong>${timed?`${best.reps} s`:`${best.weight||'-'} kg × ${best.reps} ${unit}`}</strong></div>`:'';
  return `<details class="ex-memory"><summary>Last ${recent.length} time${recent.length===1?'':'s'}${note?.text?' · your note':''}</summary>`
    +`<div class="mem-body">${rows}${bestLine}`
    +`<label class="mem-note"><span>Note for next time</span><textarea rows="2" placeholder="Seat height, grip, how it felt…" onchange="saveExerciseCueText('${esc(id)}',this.value)">${esc(note?.text||'')}</textarea></label>`
    +`</div></details>`;
}
// One writer for the standing cue, so the cockpit field and the options sheet cannot drift apart.
function saveExerciseCueText(id,text){
  if(!state.exerciseCues)state.exerciseCues={};
  const clean=String(text||'').trim();
  if(clean)state.exerciseCues[id]={text:clean,updated:Date.now()};
  else delete state.exerciseCues[id];
  saveState();showToast(clean?'Note saved for next time':'Note cleared');
}
// Warm-up sets are arithmetic every lifter does in their head, every session. Offered only when
// there is a real working weight to ramp TO, and only while the exercise is still unstarted -
// adding warm-ups after your top set would be nonsense.
function warmupButton(exercise,index,target,timed){
  if(timed||Core.doneSets(exercise).length)return '';
  const kg=Number(target?.weight)||Number(exercise.sets?.[0]?.weight)||0;
  const rungs=Core.warmupSets(kg,Number(state.preferences.barWeight)||20,Number(state.preferences.weightStep)||2.5);
  if(!rungs.length)return '';
  return `<button class="add-warmup" onclick="addWarmup(${index})" title="Add ${rungs.length} ramp-up sets below your working weight">+ Warm-up</button>`;
}
function addWarmup(index){
  const ex=state.activeSession?.exercises[index];if(!ex)return;
  const target=Core.nextTarget(state.history,ex.exerciseId,{step:Number(state.preferences.weightStep)||2.5});
  const kg=Number(target?.weight)||Number(ex.sets?.[0]?.weight)||0;
  const rungs=Core.warmupSets(kg,Number(state.preferences.barWeight)||20,Number(state.preferences.weightStep)||2.5);
  if(!rungs.length)return showToast('No warm-up needed for that load');
  // Warm-ups go IN FRONT and are flagged, so nothing downstream counts them as working sets.
  ex.sets.unshift(...rungs.map(r=>({weight:String(r.kg),reps:String(r.reps),done:false,warmup:true})));
  saveState();renderWorkout();buzz(15);
  showToast(`${rungs.length} warm-up sets added`);
}
// RIR (reps-in-reserve) capture on the finished exercise. One tap → stored on the session exercise,
// chips collapse to a small confirmed note. 'skip' is an honest non-answer (keeps progression conservative).
const RIR_CHIPS=[['0','0'],['1','1'],['2','2'],['3','3'],['4','4+'],['skip','skip']];
// Tapping a finished exercise's done row re-opens it for the rest of the session.
function reopenExercise(index){forcedOpen.add(index);renderWorkout();}
function rirRowMarkup(exercise,index,show){
  const has=exercise.rir!==undefined;
  if(has){
    const label=exercise.rir==='skip'?'RIR skipped':`RIR ${exercise.rir==='4'||exercise.rir===4?'4+':exercise.rir} ✓`;
    return `<button class="rir-note" onclick="changeRir(${index})" aria-label="Reps in reserve: ${esc(String(exercise.rir))}. Tap to change">${esc(label)}<small>tap to change</small></button>`;
  }
  if(!show)return '';
  const chips=RIR_CHIPS.map(([v,l])=>`<button class="rir-chip" onclick="setRir(${index},'${v}')" aria-label="${v==='skip'?'Skip':v+' reps'} left in tank">${l}</button>`).join('');
  // Honest label: with drop sets present, the RIR refers to the last WORKING (non-drop) set.
  const label=(exercise.sets||[]).some(s=>s.drop)?'Last working set - reps left in tank:':'Last set - reps left in tank:';
  // "Reps in reserve" is lifting jargon; the app asks a plain question instead of assuming it.
  return `<div class="rir-row" id="rirRow${index}"><span class="rir-label">${label}<small class="rir-help">How many more could you have done? 0 = nothing left, 4+ = easy</small></span><div class="rir-chips">${chips}</div></div>`;
}
function setRir(index,value){
  const ex=state.activeSession?.exercises[index];if(!ex)return;
  ex.rir=value==='skip'?'skip':Number(value);
  saveState();renderWorkout();
}
function changeRir(index){const ex=state.activeSession?.exercises[index];if(!ex)return;delete ex.rir;saveState();renderWorkout();}
// "Why this target" - the evidence and the rule, one honest sentence. Blocked shows the pain copy prominently.
function openTargetWhy(index){
  const ex=state.activeSession?.exercises[index];if(!ex)return;
  const item=exerciseById(ex.exerciseId);
  const timed=!!item?.timed;
  const pg=sessionPainGate(),target=Core.nextTarget(state.history,ex.exerciseId,{step:Number(state.preferences.weightStep)||2.5,block:!!pg.block,stepDown:!!pg.stepDown,requireConfirmation:injuryMode()});
  const basis=Core.confirmedBasis(state.history,ex.exerciseId,{requireConfirmation:injuryMode()});
  let body;
  if(target&&target.rule==='blocked'){
    body=`<div class="why-block" role="alert"><span class="why-block-glyph" aria-hidden="true">✕</span><p>${esc(pg.reason)}</p></div>`;
  }else if(!target){
    body=`<p class="why-sentence">${injuryMode()?'No confirmed-tolerated set yet, so there\'s no target - find an easy working load and log it. A target appears once a session is confirmed pain-free next time.':'No logged set yet, so there\'s no target - find an easy working load and log it. A target appears from your own numbers next time.'}</p>`;
  }else{
    const rirTxt=basis?(basis.rir==null?'no RIR was logged':basis.rir==='skip'?'RIR was skipped':`you left ${basis.rir==='4'||basis.rir===4?'4+':basis.rir} in the tank`):'no basis';
    const basisTxt=basis?(timed?`${basis.weight?`${basis.weight} kg × `:''}${basis.reps} s`:`${basis.weight||'-'} kg × ${basis.reps}`):'';
    const evidence=basis?`Last ${injuryMode()?'confirmed ':''}set: ${esc(basisTxt)}, and ${esc(rirTxt)}.`:'';
    // Design parity: the evidence becomes a grouped list, each row naming the input the rule read.
    // Every value is the real stored one - nothing here is narrated.
    const conf=Core.lastConfirmedExposure(state.history,ex.exerciseId,{requireConfirmation:injuryMode()});
    const rirVal=!basis?'no basis':(basis.rir==null?'not logged':basis.rir==='skip'?'skipped':`${basis.rir==='4'||basis.rir===4?'4+':basis.rir}`);
    const flare=state.history.find(s=>s.checkin&&s.checkin.flare!=null);
    const painVal=!injuryMode()?'not tracked':(flare?(flare.checkin.flare===false?'no flare logged':'flare logged'):'not logged');
    const rows=[
      ['Last confirmed set',basisTxt||'none yet',''],
      ['Confirmed tolerated',conf?formatDate(conf.started):'not yet','teal'],
      ['Final-set RIR',rirVal,''],
      ['Pain state',painVal,'teal'],
      ['Today',formatTarget(target),'amber'],
    ].map(([k,v,tone])=>`<div class="why-row"><span>${k}</span><b class="${tone?'why-'+tone:''}">${esc(String(v))}</b></div>`).join('');
    const evidenceList=`<div class="group why-list">${rows}</div>`;
    const RULE_SENTENCE={
      'add-rep':'Reps are below the top of your range, so hold the load and add a rep.',
      'add-load':'You hit the top of the range with reps to spare, so add one load step and reset reps.',
      'add-time':'You had time left in the tank, so hold the same load and add 5 seconds.',
      'hold':'Reps in reserve were low (0–1), so repeat the same load - no progression today.',
      'repeat-no-rir':'No RIR evidence, so this stays conservative - repeat last, never guess up.',
      'step-down':'Pain has been elevated, so the load steps back about 10% today.'
    };
    body=`<p class="why-evidence">${evidence}</p>${evidenceList}<p class="why-sentence">${esc(RULE_SENTENCE[target.rule]||'')}</p>`;
  }
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">WHY THIS TARGET</p><h2>${esc(item?.name||'Exercise')}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>${body}<p class="why-foot">Targets come from your own logged evidence - never from a plan you didn't earn.</p>`;
  document.getElementById('sheet').showModal();
}
// A cell input opens the numeric pad instead of the keyboard (readonly + role=button); the pad's
// "Keyboard" button removes readonly for arbitrary entry. Prefilled (carry-forward) sets read muted
// AND italic/lighter - a non-colour cue too, since Mark is colour-blind - until the lifter confirms them.
// v2 set row. Values are 52px cells with the unit hung outside the number so the digits stay
// optically centred. The row carries its state as SHAPE + WORD, never hue alone: done = tick +
// amber fill, next-up = amber rail + ring + the word NOW, prefilled = italic + muted, drop = DROP,
// a set that beats last session = PR. Only the active exercise passes isActive, so exactly one NOW
// row exists in the whole session.
function setMarkup(set,exerciseIndex,setIndex,previous,isActive,firstPrev,timed,bwFactor){
  const completion=Core.setCompletionState(set.done,setIndex+1);
  const pf=set.prefilled&&!set.done?' prefilled':'';
  const cellAttrs=k=>`readonly role="button" data-ex="${exerciseIndex}" data-set="${setIndex}" data-key="${k}" onclick="openPad(${exerciseIndex},${setIndex},'${k}')"`;
  const adopt=Core.showAdoptAction(set,setIndex,!!firstPrev)?`<button class="adopt-last" onclick="adoptLast(${exerciseIndex})" aria-label="Use last session's ${firstPrev.weight||'-'} kilograms for ${firstPrev.reps} reps">Use last: ${esc(firstPrev.weight||'-')} kg × ${esc(firstPrev.reps)}</button>`:'';
  // "Beats last time" is a comparison of two logged numbers, never a guess: heavier than the last
  // session's top set, or the same load carried for more reps/seconds.
  const w=Number(set.weight)||0,r=Number(set.reps)||0;
  const pw=Number(firstPrev?.weight)||0,pr=Number(firstPrev?.reps)||0;
  const beats=!!(set.done&&firstPrev&&(w>pw||(w===pw&&r>pr)));
  const tag=set.warmup?'WARM':(set.drop?'DROP':(beats?'PR':(isActive&&!set.done?'NOW':'')));
  const unitB=timed?'s':'reps';
  const cell=(k,val,ph,unit,label)=>`<span class="set-cell"><input class="set-input" type="number" inputmode="${k==='weight'?'decimal':'numeric'}" min="0" step="${k==='weight'?'0.5':'1'}" value="${esc(val)}" placeholder="${ph}" ${cellAttrs(k)} onchange="updateSet(${exerciseIndex},${setIndex},'${k}',this.value)" aria-label="${label}"><small class="set-unit" aria-hidden="true">${unit}</small></span>`;
  // Plates per side for the row you are about to lift. Barbell-loadable movements only, and only on
  // the active row - printing it on every line would be noise, and on a machine it would be a lie.
  const plateLine=(isActive&&!set.done&&bwFactor==null&&!timed)?platesHint(exerciseIndex,set.weight):'';
  return `<div class="set-grid set-row ${completion.className}${isActive&&!set.done?' now':''}${pf}${set.drop?' drop-set':''}${set.warmup?' warmup-set':''}${beats?' beats':''}" data-ex="${exerciseIndex}" data-set="${setIndex}" data-status="${completion.status}">`
    +`<button class="set-number" onclick="cycleSide(${exerciseIndex},${setIndex})" title="Tap to tag left/right side" aria-label="${set.drop?'Drop set':'Set'} ${setIndex+1}${set.side?`, ${set.side==='L'?'left':'right'} side`:''}. Tap to tag side"><b>${set.drop?'↓':setIndex+1}</b>${set.side?`<em>${set.side}</em>`:''}${tag?`<small class="set-tag">${tag}</small>`:''}</button>`
    +(bwFactor!=null
      ? cell('weight',set.weight,'+0','+kg',`Added weight for set ${setIndex+1} (blank means bodyweight only)`)
      : cell('weight',set.weight,previous?.weight||'-','kg',`Weight for set ${setIndex+1}`))
    +cell('reps',set.reps,previous?.reps||'-',unitB,`${timed?'Seconds held':'Repetitions'} for set ${setIndex+1}`)
    +`<button class="set-done ${set.done?'done':''}" onclick="toggleSet(${exerciseIndex},${setIndex})" aria-label="${completion.actionLabel}" title="${completion.status}"><span aria-hidden="true">${set.done?'✓':'○'}</span></button>`
  +`</div>${plateLine}${adopt}`;
}
// Only barbell-family kit loads in plates. Anything else (dumbbell, machine, cable, band) gets
// nothing rather than a made-up breakdown.
const PLATE_KIT=['Barbell','EZ Bar','Trap Bar'];
function platesHint(exerciseIndex,weight){
  const ex=state.activeSession?.exercises[exerciseIndex];if(!ex)return '';
  const item=exerciseById(ex.exerciseId);
  if(!item||!(item.equip||[]).some(k=>PLATE_KIT.includes(k)))return '';
  const kg=Number(weight)||0,bar=Number(state.preferences.barWeight)||20;
  if(!(kg>bar))return '';
  const b=Core.plateBreakdown(kg,bar);
  if(!b.perSide.length)return '';
  const counted=[];
  for(const p of b.perSide){const last=counted[counted.length-1];
    if(last&&last.p===p)last.n++;else counted.push({p,n:1});}
  const text=counted.map(c=>`${c.n}×${c.p}`).join(' + ');
  return `<div class="plate-hint">${bar} kg bar + <strong>${esc(text)}</strong> per side${b.remainder?` · ${b.remainder} kg short`:''}</div>`;
}
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
  const set=state.activeSession?.exercises[exerciseIndex]?.sets[setIndex];if(!set)return;
  set.side=set.side==='L'?'R':set.side==='R'?undefined:'L';
  saveState();renderWorkout();
}
// Guarded: a keyboard-mode cell fires onchange on BLUR, which can land after the workout was
// finished or cancelled and activeSession is already null (audit 2026-07-22).
function updateSet(exerciseIndex,setIndex,key,value){const set=state.activeSession?.exercises[exerciseIndex]?.sets[setIndex];if(!set)return;set[key]=value;delete set.prefilled;saveState();renderWorkoutMetrics();}
// Completing a set writes its real numbers, then pre-fills the NEXT still-empty incomplete set with
// those numbers (Core.carryForward) so an unchanged set becomes a genuine one-tap. Prefill only lands
// in a set the lifter hasn't touched (both fields empty) - never overwrites entered data.
function carryForwardExercise(exercise){
  const sets=exercise.sets||[];const j=sets.findIndex(s=>!s.done);
  if(j<=0)return; // no incomplete set, or set 1 (never prefilled)
  const pf=Core.carryForward(exercise,j);
  if(pf&&sets[j].weight===''&&sets[j].reps===''){sets[j].weight=String(pf.weight);sets[j].reps=String(pf.reps);sets[j].prefilled=true;}
}
function toggleSet(exerciseIndex,setIndex){
  if(!state.activeSession?.exercises[exerciseIndex]?.sets[setIndex])return;
  if(state.activeSession&&prCelebratedSession!==state.activeSession){prCelebratedSession=state.activeSession;prCelebrated.clear();}
  const set=state.activeSession.exercises[exerciseIndex].sets[setIndex];set.done=!set.done;
  // Stamp WHEN the set was completed. Wall time (finished - started) reads as 1618 minutes for a
  // session left open overnight; the span between the first and last stamped set is the real
  // training time. Core.sessionMinutes prefers it whenever the clock is implausible.
  if(set.done)set.at=Date.now();else delete set.at;
  if(set.done){delete set.prefilled;
    // Superset: completing a set of the FIRST exercise in a pair skips rest and hands straight to
    // the partner exercise; rest runs normally after the partner (second) exercise's set.
    const pairFirst=state.activeSession.exercises[exerciseIndex].supersetWithNext&&exerciseIndex<state.activeSession.exercises.length-1;
    if(pairFirst){showToast('Superset - straight to the next exercise');setTimeout(()=>progressToNextSet(exerciseIndex+1),60);}
    else{
      // Second of a pair rests, then progression scans from the pair's FIRST exercise so the
      // superset keeps alternating A1→B1→A2→B2 (Codex verify 2026-07-20).
      const prevPair=exerciseIndex>0&&state.activeSession.exercises[exerciseIndex-1].supersetWithNext;
      // A workout scheme's own rest wins over the global default - the set just finished sets the clock.
      startRest(state.activeSession.exercises[exerciseIndex].restSeconds||state.preferences.restSeconds,prevPair?exerciseIndex-1:exerciseIndex);
    }
    if(setIndex===state.activeSession.exercises[exerciseIndex].sets.length-1)addSet(exerciseIndex,true);carryForwardExercise(state.activeSession.exercises[exerciseIndex]);buzz(15);}
  else{ // un-complete: downstream prefills seeded by this set are stale - reset + re-derive (Codex)
    const ex=state.activeSession.exercises[exerciseIndex];
    ex.sets.forEach((s,i)=>{if(i>setIndex&&s.prefilled&&!s.done){s.weight='';s.reps='';delete s.prefilled;}});
    carryForwardExercise(ex);
  }
  saveState();renderWorkout();
  if(set.done){
    // A completed set that beats this exercise's PRIOR best earns the (once-per-exercise) live PR moment;
    // otherwise the ordinary settle animation. detectPRs is reused read-only against a single-exercise shadow.
    // A first-ever exposure (no prior best to beat) is NOT a live moment - it still counts in the receipt.
    const ex=state.activeSession.exercises[exerciseIndex];let isPr=false;
    try{if(!prCelebrated.has(ex.exerciseId)&&Core.previousPerformance(state.history,ex.exerciseId).length){const recs=Core.detectPRs(state.history,{exercises:[ex]});if(recs&&recs.length){isPr=true;prCelebrated.add(ex.exerciseId);}}}catch{}
    if(isPr)celebratePR(exerciseIndex,setIndex,String(set.weight||''));
    else if(!REDUCED_MOTION){
      const row=document.querySelector(`.set-row[data-ex="${exerciseIndex}"][data-set="${setIndex}"]`);
      if(row){row.classList.add('just-done');setTimeout(()=>row.classList.remove('just-done'),320);}
    }
  }
}
// PR moment (POLISH): completed row compresses, its value rolls up (reuse roll-mask), a thin amber
// light sweeps UP the exercise card's left rail, then the upgraded ▲PR toast. Reduced-motion: toast only.
function celebratePR(exerciseIndex,setIndex,val){
  buzz([15,60,20]); // distinct double pulse for a PR
  showToast('▲ PR - new best',true);
  if(REDUCED_MOTION)return;
  const row=document.querySelector(`.set-row[data-ex="${exerciseIndex}"][data-set="${setIndex}"]`);
  if(!row)return;
  row.classList.add('pr-hit');setTimeout(()=>row.classList.remove('pr-hit'),460);
  // The old centred "NN kg" roll overlay is gone: the row's centre is the gap between the kg and
  // reps cells, so it painted as a stray amber digit sliver behind the inputs (audit 2026-08-02).
  // Compress + rail spark + toast + double buzz already carry the moment.
  const card=row.closest('.workout-exercise');
  if(card){const spark=document.createElement('i');spark.className='pr-spark';card.appendChild(spark);const drop=()=>spark.remove();spark.addEventListener('animationend',drop);setTimeout(drop,700);}
}
function addSet(exerciseIndex,silent=false){
  // Sets are born EMPTY; carry-forward (on completing the prior set) is the sole prefill path, so a
  // prefilled value is always the flagged/muted kind - never a silent copy the lifter didn't choose.
  const ex=state.activeSession?.exercises[exerciseIndex];if(!ex)return;
  ex.sets.push({weight:'',reps:'',done:false});
  if(!silent){carryForwardExercise(ex);saveState();renderWorkout();} // manual add prefills if the prior set is already done
  else saveState();
}
// Drop set: appended after the last completed set, prefilled at −20% (rounded to 0.5) and flagged.
// Counts as a normal hard set everywhere (volume, PRs, muscle ledgers) - the flag is presentation only.
function addDropSet(exerciseIndex){
  const ex=state.activeSession?.exercises[exerciseIndex];if(!ex)return;
  const lastDone=[...ex.sets].reverse().find(s=>s.done);
  if(!lastDone){showToast('Complete a set first - a drop set follows it');return;}
  const w=Number(lastDone.weight);
  // Insert directly AFTER the last completed set - not at the tail, where the auto-added blank
  // successor would sit above it as the active row (Codex verify 2026-07-20).
  const li=ex.sets.lastIndexOf(lastDone);
  ex.sets.splice(li+1,0,{weight:Number.isFinite(w)&&w>0?String(Math.round(w*0.8*2)/2):'',reps:'',done:false,drop:true});
  saveState();renderWorkout();buzz(10);
}
function toggleSuperset(index,on){
  const s=state.activeSession;if(!s||index>=s.exercises.length-1)return;
  s.exercises[index].supersetWithNext=!!on;
  saveState();renderWorkout();
}
function addExerciseToWorkout(id){if(!state.activeSession)return;state.activeSession.exercises.push({exerciseId:id,notes:'',sets:[{weight:'',reps:'',done:false}]});saveState();renderWorkout();}
function startActiveClock(){
  clearInterval(activeTimer);
  const update=()=>{if(!state.activeSession)return;document.getElementById('workoutClock').textContent=Core.formatDuration(Core.sessionElapsedMs(state.activeSession)/1000)};
  update();
  if(!state.activeSession?.pausedAt)activeTimer=setInterval(update,1000); // paused: the value is frozen, so there is nothing to tick
}
// Pause the session clock for a phone call, a chat, a coffee - held time is never training time.
// One accumulator (`pausedMs`) + an open mark (`pausedAt`); every elapsed read goes through
// Core.sessionElapsedMs, so the live clock, the receipt duration and history all agree.
function toggleWorkoutPause(){
  const session=state.activeSession;if(!session)return;
  const now=Date.now();
  if(session.pausedAt){
    const held=now-session.pausedAt;
    session.pausedMs=(session.pausedMs||0)+held;session.pausedAt=null;
    // Rest is deadline-anchored, so it is owed the same held time back before it ticks again.
    if(restDeadline){restDeadline+=held;if(document.getElementById('restPill').classList.contains('show')){clearInterval(restTimer);tickRest();restTimer=setInterval(tickRest,1000);}}
    showToast('Workout resumed');
  }else{
    session.pausedAt=now;clearInterval(restTimer);
    showToast('Workout paused - the clock is stopped');
  }
  saveState();buzz(10);renderWorkout();
}
function settlePause(session,now=Date.now()){ // close any open pause so `finished` lands on real training time
  if(session?.pausedAt){session.pausedMs=(session.pausedMs||0)+(now-session.pausedAt);session.pausedAt=null;}
}

// Deadline-anchored rest (Codex verify 2026-07-20): remaining derives from an absolute deadline,
// and a visibilitychange reconciliation fires the end path immediately when the tab wakes past it -
// an OS-suspended interval can no longer resume stale.
let restDeadline=0;
let restTotalSeconds=90; // denominator for the countdown ring; +30s extends it so the arc never overflows
function startRest(seconds,exerciseIndex=0){
  restTotalSeconds=Number(seconds)||90;
  restDeadline=Date.now()+restTotalSeconds*1000;restExerciseIndex=exerciseIndex;
  clearInterval(restTimer);document.getElementById('restPill').classList.add('show');
  tickRest();restTimer=setInterval(tickRest,1000);
  revealRirRow(exerciseIndex);
}
// Finishing the last set starts the timer AND asks for reps-in-reserve in the same instant, and the
// pill is fixed to the bottom - measured on live 2026-08-05, it covered the chips by 50px. RIR is
// what the entire double-progression engine reads, so the timer was hiding the control that feeds
// it. The row now carries scroll-margin-bottom past the pill and is brought into view when the pill
// appears. Deferred a frame because the pill's own transition changes the geometry being measured.
function revealRirRow(exerciseIndex){
  requestAnimationFrame(()=>setTimeout(()=>{
    const row=document.getElementById('rirRow'+exerciseIndex);
    if(!row||!row.getClientRects().length)return;
    const pill=document.getElementById('restPill');
    if(!pill||!pill.classList.contains('show'))return;
    const r=row.getBoundingClientRect(),p=pill.getBoundingClientRect();
    if(r.bottom>p.top)try{row.scrollIntoView({block:'end',behavior:'smooth'});}catch{}
  },80));
}
// Council 2026-07-23: rest is RECOVERY (teal) until the last 10s, when it becomes an ACTION (amber).
// The label changes with the hue - never hue alone, Mark is colour-blind.
const REST_ENDING_SECONDS=10;
function tickRest(){
  restRemaining=Math.max(0,Math.round((restDeadline-Date.now())/1000));
  updateRest();
  const pill=document.getElementById('restPill'),ending=restRemaining>0&&restRemaining<=REST_ENDING_SECONDS;
  pill.classList.toggle('ending',ending);
  const label=pill.querySelector('.rest-info span');
  if(label)label.textContent=ending?'Get ready':'Rest';
  if(restRemaining<=0){clearInterval(restTimer);pill.classList.remove('show','ending');if(label)label.textContent='Rest';buzz(40);showToast('Rest done - next set');notifyRestDone();progressToNextSet(restExerciseIndex);}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!state.activeSession?.pausedAt&&document.getElementById('restPill').classList.contains('show'))tickRest();});
// Rest-end notification (opt-in). ponytail: fires while the page is alive (incl. a backgrounded tab);
// no Notification-Triggers scheduling - if the OS fully suspends the PWA, the buzz+toast on return cover it.
async function enableRestNotify(on){
  if(!on){state.preferences.restNotify=false;saveState();return;}
  try{const perm=await Notification.requestPermission();state.preferences.restNotify=perm==='granted';if(perm!=='granted')showToast('Notifications are blocked for this app in the browser');}
  catch{state.preferences.restNotify=false;}
  saveState();openSettings();
}
function notifyRestDone(){
  if(state.preferences.restNotify!==true||typeof Notification==='undefined'||Notification.permission!=='granted'||document.visibilityState==='visible')return;
  try{navigator.serviceWorker?.ready.then(r=>r.showNotification('Rest done',{body:'Next set is up.',icon:'icon-180.png',badge:'icon-180.png',tag:'gym-rest'})).catch(()=>{});}catch{}
}
function adjustRest(seconds){restDeadline+=seconds*1000;restTotalSeconds+=seconds;tickRest();}
const REST_RING_C=2*Math.PI*18; // r=18 in the 44x44 viewBox
function updateRest(){
  rollNumber(document.getElementById('restTime'),Core.formatDuration(restRemaining));
  const ring=document.getElementById('restRing');
  if(ring){
    const frac=restTotalSeconds>0?Math.max(0,Math.min(1,restRemaining/restTotalSeconds)):0;
    ring.style.strokeDasharray=REST_RING_C;
    ring.style.strokeDashoffset=REST_RING_C*(1-frac);
  }
}
// Skip clears the running rest and immediately hands off to the next-set progression.
function skipRest(){clearInterval(restTimer);restRemaining=0;document.getElementById('restPill').classList.remove('show');progressToNextSet(restExerciseIndex);}
// Rest-end "what's next": the next incomplete set (same exercise, else the next exercise with one)
// gets a one-time amber emphasis on its already-notched active row and scrolls into view. Purely
// visual - no focus() so the keyboard never pops. Reduced motion: instant scroll, no pulse.
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
// of the keyboard - big −/+ with hold-acceleration, a per-profile weight step, and a Keyboard escape
// hatch for arbitrary entry. Writes go through the same updateSet path as typing. ----
const WEIGHT_STEPS=[1,2.5,5];
function padStep(){return padTarget?.key==='weight'?(Number(state.preferences.weightStep)||2.5):1;}
function openPad(exIdx,setIdx,key){
  padTyped=false; // a fresh open means the next digit replaces the prefilled value
  if(!state.activeSession)return;
  padTarget={exIdx,setIdx,key};
  renderPad();
  document.getElementById('padSheet').showModal();
}
function padValue(){const {exIdx,setIdx,key}=padTarget||{};return Number(state.activeSession?.exercises[exIdx]?.sets[setIdx]?.[key])||0;}
function renderPad(){
  const {key}=padTarget||{};const isW=key==='weight';const step=Number(state.preferences.weightStep)||2.5;
  const timed=!isW&&!!exerciseById(state.activeSession?.exercises[padTarget?.exIdx]?.exerciseId)?.timed;
  const steps=isW?`<div class="pad-steps" role="group" aria-label="Weight step">${WEIGHT_STEPS.map(s=>`<button class="pad-step${s===step?' on':''}" onclick="padSetStep(${s})" aria-pressed="${s===step}">±${s}</button>`).join('')}</div>`:'';
  const liftName=exerciseById(state.activeSession?.exercises[padTarget?.exIdx]?.exerciseId)?.name||'';
  document.getElementById('padContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${isW?'WEIGHT':timed?'SECONDS':'REPS'}</p>${liftName?`<h2>${esc(liftName)}</h2>`:`<h2>${isW?'Weight':timed?'Seconds':'Reps'}</h2>`}</div><button class="close-button" onclick="closePad()" aria-label="Done">×</button></div>`
    +`<div class="pad-value"><strong id="padDisplay" data-val="${esc(String(padValue()))}">${esc(String(padValue()))}</strong><small>${isW?'kg':timed?'sec':'reps'}</small></div>`
    +(isW?`<p class="pad-plates" id="padPlates">${plateLine(padValue())}</p>`:'')
    +steps
    +`<div class="pad-controls"><button class="pad-adjust" aria-label="Decrease" onpointerdown="padHoldStart(-1)" onpointerup="padHoldStop()" onpointerleave="padHoldStop()" onpointercancel="padHoldStop()">−</button><button class="pad-adjust" aria-label="Increase" onpointerdown="padHoldStart(1)" onpointerup="padHoldStop()" onpointerleave="padHoldStop()" onpointercancel="padHoldStop()">+</button></div>`
    +`<div class="pad-keys">${['1','2','3','4','5','6','7','8','9',isW?'.':'','0'].map(k=>k?`<button class="pad-key" onclick="padDigit('${k}')">${k}</button>`:'<span class="pad-key-gap"></span>').join('')}<button class="pad-key pad-back" onclick="padBackspace()" aria-label="Delete last digit">⌫</button></div>`
    +`<div class="sheet-actions"><button class="primary-button full-button" onclick="closePad()">Done</button></div>`;
}
function padSetStep(s){state.preferences.weightStep=s;saveState();renderPad();}
// Plate math under the pad numeral: what to load per side for the current weight.
function plateLine(v){
  const bar=Number(state.preferences.barWeight)||20;
  if(!v)return '';
  if(v<bar)return `Below the ${bar} kg bar - dumbbells or fixed weight`;
  const b=Core.plateBreakdown(v,bar);
  if(!b.perSide.length)return `Empty bar (${bar} kg)`;
  return `Per side: ${b.perSide.join(' · ')}${b.exact?'':` - ${b.remainder} kg won't plate`}`;
}
// Keypad (design parity). The FIRST digit REPLACES the pre-filled target - typing 8 on a prefilled
// 60 means 8, not 608 - and every later key appends. Entry is clamped (500 kg / 100 reps / 999 s)
// so a fat-finger cannot log a number the lifter never did.
let padTyped=false;
function padCommit(next){
  if(!padTarget)return;
  const {exIdx,setIdx,key}=padTarget;
  updateSet(exIdx,setIdx,key,String(next));
  const inp=document.querySelector(`.set-input[data-ex="${exIdx}"][data-set="${setIdx}"][data-key="${key}"]`);
  if(inp)inp.value=String(next);
  const disp=document.getElementById('padDisplay');if(disp)disp.textContent=String(next);
  const pl=document.getElementById('padPlates');if(pl&&key==='weight')pl.textContent=plateLine(Number(next)||0);
}
function padMax(){
  const key=padTarget?.key;
  if(key==='weight')return 500;
  const ex=state.activeSession?.exercises[padTarget?.exIdx];
  return exerciseById(ex?.exerciseId)?.timed?999:100;
}
function padDigit(d){
  if(!padTarget)return;
  const cur=padTyped?String(padValue()):'';
  if(d==='.'&&cur.includes('.'))return;
  let next=(padTyped?cur:'')+d;
  if(next==='.')next='0.';
  if(Number(next)>padMax())return;
  padTyped=true;
  padCommit(next);
}
function padBackspace(){
  if(!padTarget)return;
  const cur=String(padValue());
  const next=padTyped&&cur.length>1?cur.slice(0,-1):'0';
  padTyped=true;
  padCommit(next==='' ? '0' : next);
}
function padAdjust(dir){
  if(!padTarget)return;
  const {exIdx,setIdx,key}=padTarget;
  const next=Core.stepValue(padValue(),padStep(),dir);
  updateSet(exIdx,setIdx,key,String(next));
  const inp=document.querySelector(`.set-input[data-ex="${exIdx}"][data-set="${setIdx}"][data-key="${key}"]`);
  if(inp)inp.value=String(next);
  const disp=document.getElementById('padDisplay');if(disp)rollNumber(disp,String(next));
  const pl=document.getElementById('padPlates');if(pl&&key==='weight')pl.textContent=plateLine(next);
}
function padHoldStart(dir){padAdjust(dir);let delay=380;const tick=()=>{padAdjust(dir);delay=Math.max(60,delay*0.82);padHold=setTimeout(tick,delay);};padHold=setTimeout(tick,380);}
function padHoldStop(){clearTimeout(padHold);padHold=null;}
function padKeyboard(){
  // Focus must happen AFTER the modal dialog has really closed (a modal makes the page inert) and
  // AFTER closePad's renderWorkout has rebuilt the rows - so re-query the CURRENT DOM in the
  // completion callback, never the pre-close node (Codex P1).
  const t=padTarget;
  closePad(()=>{
    if(!t)return;
    const inp=document.querySelector(`.set-input[data-ex="${t.exIdx}"][data-set="${t.setIdx}"][data-key="${t.key}"]`);
    if(!inp)return;
    inp.readOnly=false;inp.removeAttribute('role');inp.focus();inp.select&&inp.select();
    const restore=()=>{inp.readOnly=true;inp.setAttribute('role','button');inp.removeEventListener('blur',restore);};
    inp.addEventListener('blur',restore);
  });
}
// closePad(after): after runs once the dialog is fully closed AND the workout has re-rendered.
function closePad(after){padHoldStop();dismissDialog(document.getElementById('padSheet'),()=>{padTarget=null;if(state.activeSession)renderWorkout();after&&after();});}

function requestFinishWorkout(){
  const session=state.activeSession,summary=Core.summarizeSession({...session,finished:Date.now()});
  document.getElementById('confirmContent').innerHTML=`<h2>Finish workout?</h2><p>${summary.completedSets} completed set${summary.completedSets===1?'':'s'}${summary.volume>0?` · ${compact(summary.volume)} kg moved`:''}.</p><div class="confirm-feel"><p>HOW DID THE BODY FEEL?</p><div class="checkin-row" id="feelRow"><button onclick="setPostCheckin(this,'better')">Better</button><button onclick="setPostCheckin(this,'same')">Same</button><button onclick="setPostCheckin(this,'worse')">Worse</button></div></div><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep training</button><button class="primary-button" onclick="finishWorkout()">Finish</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function setPostCheckin(button,value){
  if(state.activeSession?.checkin)state.activeSession.checkin.post=value;
  document.querySelectorAll('#feelRow button').forEach(b=>b.classList.toggle('picked',b===button));
  saveState();
}
function finishWorkout(){
  const session=state.activeSession;if(!session)return;
  settlePause(session);session.finished=Date.now();session.prs=Core.detectPRs(state.history,session);
  session.verdict=Core.sessionVerdict(state.history,session); // deltas vs last exposure, judged BEFORE this session joins history
  if(session.prs.length)buzz([20,60,20]); // PR: distinct double pulse
  if(session.checkin&&session.checkin.flare===undefined)session.checkin.flare=null; // arms the next-session flare question
  // The tolerance gate is only ASKED in injury mode, so whether it applied is a property of the
  // session, not of today's settings. Stamping it here is what lets the brain-side coach apply the
  // same rule the app applied: without it the coach demanded a flare answer the app never
  // collected and froze on "repeat exactly as last time" forever (audit 2026-07-28).
  session.injuryMode=injuryMode();
  // Pin the body mass this session's calisthenics are valued at. From this moment its numbers are
  // fixed: a weigh-in next month can never retroactively change what today was worth. Only sessions
  // logged BEFORE this build fall back to being derived (council 2026-08-05).
  const bwNow=Core.bodyweightAsOf(state.bodyweight,session.started,state.preferences.backfillBodyweight);
  if(bwNow)session.bodyweightKg=bwNow;
  state.history.unshift(session);state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();
  if(Sync)try{Sync.onSessionComplete(session);}catch{} // enqueue + best-effort upload; never blocks the flow
  checkGoalAchievements(); // the session just finished is new evidence against every declared goal
  openReceipt(session);
}
function openReceipt(session){
  const summary=Core.summarizeSession(session),prs=session.prs||[];
  // Verdict layer (council 2026-07-28): the receipt reported totals but never DELTAS. One computed
  // headline of what changed today, one proof line, honest fallback on first exposure. NEXT SESSION
  // stays fully visible below (Codex wanted it collapsed; the anchor is never hidden).
  const v=session.verdict||Core.sessionVerdict(state.history.filter(x=>x.id!==session.id),session);
  const VERDICT_COPY={advanced:'Moved forward.',held:'Held steady.','backed-off':'Backed off today.',baseline:'Baseline set.'};
  const deltaText=h=>{if(!h)return '';const n=exerciseById(h.exerciseId)?.name||'';
    return h.kind==='load'?`${esc(n)} +${h.delta} kg`:h.kind==='time'?`${esc(n)} +${h.delta} s`:`${esc(n)} +${h.delta} rep${h.delta===1?'':'s'}`;};
  const proof=v.verdict==='baseline'?'Progression starts next time.'
    :v.considered?`${v.advanced} of ${v.considered} lift${v.considered===1?'':'s'} advanced${v.highlight?' · '+deltaText(v.highlight):''}`:'';
  const verdictBlock=v.verdict==='none'?'':`<div class="receipt-verdict receipt-verdict-${v.verdict}"><strong>${VERDICT_COPY[v.verdict]}</strong>${proof?`<small>${proof}</small>`:''}</div>`;
  // "Volume 0 kg" tells a calisthenics session it did nothing - name the work honestly instead.
  const lines=[['Duration',summary.durationCapped?'not recorded':`${summary.durationMinutes} min`],['Sets',summary.completedSets],['Volume',summary.volume>0?`${compact(summary.volume)} kg`:'bodyweight'],['PRs',prs.length]];
  // Catch a forgotten load at the ONE moment it is still cheap to fix - before the session becomes
  // history and the number starts disagreeing with an identical session next week.
  const gaps=Core.loadGaps(state.history.filter(x=>x.id!==session.id),session);
  const workBlock=workBreakdown(Core.sessionWork(session));
  const gapBlock=gaps.length?`<div class="receipt-gap"><strong>${gaps.length} lift${gaps.length===1?'':'s'} logged without a load</strong><small>${gaps.map(g=>`${esc(exerciseById(g.exerciseId)?.name||'A lift')} · last time ${g.lastWeight} kg`).join(' · ')}. Your kg total leaves ${gaps.length===1?'it':'them'} out.</small></div>`:'';
  const prBlocks=prs.map(pr=>{
    const item=exerciseById(pr.exerciseId);
    const parts=(pr.seconds?[`${pr.seconds} s hold`,pr.weight?`${pr.weight} kg`:'']:[pr.weight?`${pr.weight} kg top set`:'',pr.estimated1RM?`${pr.estimated1RM} kg est. 1-rep max`:'']).filter(Boolean).join(' · ')||'New best';
    return `<div class="receipt-pr notched-left"><strong>${esc(item?.name||'Exercise')}</strong><small>${esc(parts)}</small></div>`;
  }).join('');
  // NEXT SESSION prescription - the engagement anchor. Run against the just-finished history state.
  const pg=Core.painGate(state.history,null),step=Number(state.preferences.weightStep)||2.5;
  const nextRows=session.exercises.filter(ex=>ex.sets.some(s=>s.done)).map((ex,i)=>{
    const item=exerciseById(ex.exerciseId),t=Core.nextTarget(state.history,ex.exerciseId,{step,block:!!pg.block,stepDown:!!pg.stepDown});
    const val=t?(t.rule==='blocked'?'train around it':formatTarget(t)):'baseline building';
    const word=t&&t.rule!=='add-rep'&&t.rule!=='add-load'&&t.rule!=='blocked'?RULE_WORD[t.rule]:'';
    return `<div class="receipt-next-row" style="--i:${i}"><span>${esc(item?.name||'Exercise')}</span><strong>${esc(val)}${word?` <em>${esc(word)}</em>`:''}</strong></div>`;
  }).join('');
  const nextBlock=nextRows?`<div class="receipt-next"><p class="kicker">NEXT SESSION</p><div class="receipt-next-rows">${nextRows}</div></div>`:'';
  document.getElementById('receiptCard').innerHTML=`<div class="receipt-sweep" aria-hidden="true"></div><p class="kicker">SESSION COMPLETE</p><h2>${esc(session.name)}</h2><p class="receipt-date">${formatDate(session.started)}</p>${verdictBlock}<div class="receipt-lines">${lines.map(([k,v],i)=>`<div class="receipt-line" style="--i:${i}"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join('')}</div>${workBlock}${gapBlock}${prBlocks?`<div class="receipt-prs">${prBlocks}</div>`:''}${nextBlock}<button class="primary-button full-button" onclick="closeReceipt()">Done</button>`;
  const overlay=document.getElementById('receiptOverlay');overlay.hidden=false;overlay.style.display='grid';
  requestAnimationFrame(()=>overlay.classList.add('show'));
  document.getElementById('receiptCard').querySelector('.primary-button').focus();
  overlay.onclick=e=>{if(e.target===overlay)closeReceipt();};
  overlay.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();closeReceipt();return;}
    if(e.key==='Tab'){e.preventDefault();document.getElementById('receiptCard').querySelector('.primary-button').focus();} // ponytail: one focusable control - trap is a refocus
  };
}
function closeReceipt(){const overlay=document.getElementById('receiptOverlay');overlay.classList.remove('show');overlay.hidden=true;overlay.style.display='none';overlay.onkeydown=null;navigate('progress');}
function cancelWorkout(){
  document.getElementById('confirmContent').innerHTML=`<h2>Discard workout?</h2><p>This workout and all its sets will be permanently removed.</p><div class="confirm-actions"><button class="secondary-button" onclick="closeConfirm()">Keep it</button><button class="primary-button" style="background:var(--danger)" onclick="confirmCancelWorkout()">Discard</button></div>`;document.getElementById('confirmDialog').showModal();
}
function confirmCancelWorkout(){state.activeSession=null;saveState();clearInterval(activeTimer);clearInterval(restTimer);document.getElementById('restPill').classList.remove('show');closeConfirm();navigate('today');}
function closeConfirm(){dismissDialog(document.getElementById('confirmDialog'));}

let swapConfirmed=null; // 'keep' | 'discard' while a swap-with-logged-sets confirmation is open
// Split the performed sets off as their own finished entry, then swap the original to the new lift.
function doSwap(id,mode){
  const idx=swapTargetIndex;const ex=state.activeSession?.exercises[idx];
  if(!ex){closeConfirm();return;}
  if(mode==='keep'){
    const done=ex.sets.filter(s=>s.done);
    state.activeSession.exercises.splice(idx,0,{exerciseId:ex.exerciseId,notes:ex.notes||'',rir:ex.rir,sets:done});
    swapTargetIndex=idx+1;
  }
  swapConfirmed=mode;closeConfirm();pickExercise(id);swapConfirmed=null;
}
let swapTargetIndex=null; // set only for a workout SWAP; a plain add leaves it null
function openExercisePicker(target,swapIndex){
  pickerTarget=target;
  swapTargetIndex=(target==='workout'&&Number.isInteger(swapIndex))?swapIndex:null;
  if(target!=='workout')pickerFilterState=newFilterState(); // routine editing browses fresh; a workout's flow keeps its filters across opens
  const swapEx=swapTargetIndex!=null?state.activeSession?.exercises[swapTargetIndex]:null;
  const swapName=swapEx?(exerciseById(swapEx.exerciseId)?.name||'this exercise'):'';
  const swapSets=swapEx?swapEx.sets.length:0;
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${swapEx?'Swap exercise':'Add exercise'}</h2><button class="close-button" onclick="closeSheet()">×</button></div>`
    +(swapEx?`<p class="swap-note">Replacing <strong>${esc(swapName)}</strong> · keeps ${swapSets} set${swapSets===1?'':'s'}</p>`:'')
    // Search comes FIRST, above the quick picks. It used to sit third, so opening the keyboard left
    // the field itself below the fold behind the keyboard - you could type and not see what you
    // typed (Ty 2026-07-23). Sticky at top:0 only helps once you have scrolled PAST an element;
    // being first is what makes it never leave the screen.
    +`<div class="search-wrap picker-search"><span class="search-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg></span><input id="pk_search" type="search" placeholder="Search name, muscle or equipment" oninput="onCatSearch('picker',this.value)" aria-label="Search exercises"></div>`
    +`<div id="pk_quick" class="quick-picks"></div>`
    +`<div id="pk_chips" class="filter-row" aria-label="Filter by muscle group"></div>`
    +`<div class="count-row"><div id="pk_count" class="result-count"></div><button id="pk_filtersBtn" class="filters-button" onclick="openFiltersSheet('picker')" aria-label="More filters">${FILTERS_ICON}<span>Filters</span><span class="filters-badge" hidden>0</span></button></div>`
    +`<div id="pk_list" class="exercise-list"></div>`;
  renderCatalogue('picker');document.getElementById('sheet').showModal();
}
function pickExercise(id){
  // Swap replaces the lift IN PLACE and keeps the prescribed set count. Logged values are cleared
  // because they belong to the old lift; the "last time -> target" strip then re-derives itself from
  // the NEW lift's own confirmed history, so nothing is carried across exercises.
  if(pickerTarget==='workout'&&swapTargetIndex!=null){
    const ex=state.activeSession?.exercises[swapTargetIndex];
    // Sets already logged belong to the lift that was actually performed. Swapping would discard
    // them silently, so ask first - same rule as Remove. Answering "keep both" splits them off as
    // their own finished exercise so the work is never lost.
    const logged=ex?Core.doneSets(ex).length:0;
    if(ex&&logged&&!swapConfirmed){
      const oldName=exerciseById(ex.exerciseId)?.name||'this lift';
      const newName=exerciseById(id)?.name||'the new lift';
      closeSheet();
      document.getElementById('confirmContent').innerHTML=`<h2>Keep the ${logged} set${logged===1?'':'s'} you already did?</h2><p>You logged ${logged} set${logged===1?'':'s'} of ${esc(oldName)}. Swapping to ${esc(newName)} can keep that work as its own entry, or discard it.</p><div class="sheet-actions"><button class="secondary-button" onclick="closeConfirm()">Cancel</button><button class="secondary-button" onclick="doSwap('${esc(id)}','discard')">Discard them</button></div><div class="sheet-actions"><button class="primary-button full-button" onclick="doSwap('${esc(id)}','keep')">Keep both</button></div>`;
      document.getElementById('confirmDialog').showModal();
      return;
    }
    if(ex){
      const keep=Math.max(1,ex.sets.length);
      ex.exerciseId=id;ex.sets=Array.from({length:keep},()=>({weight:'',reps:'',done:false}));
      delete ex.rir;delete ex.notes;
      forcedOpen.delete(swapTargetIndex);
      saveState();
    }
    swapTargetIndex=null;closeSheet();renderWorkout();showToast('Exercise swapped');return;
  }
  if(pickerTarget==='workout'){addExerciseToWorkout(id);closeSheet();showToast('Exercise added');}
  else if(pickerTarget==='routine'){if(!routineDraft.exerciseIds.includes(id))routineDraft.exerciseIds.push(id);renderRoutineEditor();}
  // Picking for a goal returns to the goal sheet with the choice made - the draft is never lost.
  else if(pickerTarget==='goal'&&goalDraft){goalDraft.exerciseId=id;renderGoalSheet();}
}
function closeSheet(){
  dismissDialog(document.getElementById('sheet'),()=>{
    // While the boot PIN gate is active, any sheet dismissal (incl. the switcher's x) must land
    // back ON the gate, never in the neutral shell (Codex: gate must be truly non-dismissible).
    if(lockGate){const p=Profiles?Profiles.getActive(localStorage):null;if(p&&p.pinHash)gateLockedProfile(p);}
  });
}

function openRoutineEditor(id){
  const existing=id?state.routines.find(r=>r.id===id):null;
  routineDraft=existing?JSON.parse(JSON.stringify(existing)):{id:`r${Date.now()}`,name:'',exerciseIds:[]};
  renderRoutineEditor();document.getElementById('sheet').showModal();
}
function renderRoutineEditor(){
  pickerTarget='routine';
  // Offered only while the draft is EMPTY, so picking a seed can never wipe work already done.
  const seeds=routineDraft.exerciseIds.length?[]:routineSeeds();
  const seedBlock=seeds.length?`<div class="field"><label>START FROM (OPTIONAL)</label><select id="routineSeed" onchange="seedRoutine(this.value)"><option value="">Build from scratch</option>${seeds.map(s=>`<option value="${esc(s.key)}">${esc(s.label)} (${s.ids.length})</option>`).join('')}</select></div>`:'';
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>${state.routines.some(r=>r.id===routineDraft.id)?'Edit':'New'} routine</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>ROUTINE NAME</label><input id="routineName" value="${esc(routineDraft.name)}" placeholder="Example: Monday upper" oninput="routineDraft.name=this.value"></div>${seedBlock}<div class="section-heading"><div><p class="kicker">EXERCISES</p><h2>${routineDraft.exerciseIds.length} selected</h2></div><button class="text-button" onclick="openExercisePicker('routine')">+ Add</button></div><div class="selected-list">${routineDraft.exerciseIds.length?routineDraft.exerciseIds.map((id,index)=>`<div class="selected-row"><span><strong>${index+1}. ${esc(exerciseById(id)?.name||'Missing exercise')}</strong></span><button onclick="removeRoutineExercise(${index})">Remove</button></div>`).join(''):'<div class="empty-card card">Add exercises in the order you want to train.</div>'}</div><div class="sheet-actions"><button class="secondary-button" onclick="closeSheet()">Cancel</button><button class="primary-button" onclick="saveRoutine()">Save routine</button></div>`;
}
function removeRoutineExercise(index){routineDraft.exerciseIds.splice(index,1);renderRoutineEditor();}
// Building a routine from an empty list means naming 6 exercises from memory. Every list worth
// starting from already exists in the app: a plan's days, a curated workout, and the sessions
// already logged. Offered only while the draft is EMPTY, so it never silently overwrites real work.
function routineSeeds(){
  const seeds=[];
  for(const plan of plans) for(const day of plan.days)
    seeds.push({key:`plan:${plan.id}:${day.name}`,label:`${plan.name} · ${day.name}`,ids:day.exerciseIds});
  for(const w of workouts) seeds.push({key:`wk:${w.id}`,label:`Workout · ${w.name}`,ids:w.exercises.map(e=>e.id)});
  for(const s of state.history.slice(0,5))
    seeds.push({key:`hist:${s.id}`,label:`Logged · ${s.name} (${formatDate(s.started)})`,
      ids:[...new Set((s.exercises||[]).map(e=>e.exerciseId))]});
  return seeds.filter(s=>s.ids.some(id=>exerciseById(id)));
}
function seedRoutine(key){
  const seed=routineSeeds().find(s=>s.key===key);if(!seed)return;
  routineDraft.exerciseIds=[...new Set(seed.ids.filter(id=>exerciseById(id)))];
  if(!routineDraft.name.trim())routineDraft.name=seed.label.split(' · ').pop();
  renderRoutineEditor();showToast(`Started from ${seed.label}`);
}
function saveRoutine(){
  routineDraft.name=routineDraft.name.trim();if(!routineDraft.name)return showToast('Name your routine');if(!routineDraft.exerciseIds.length)return showToast('Add at least one exercise');
  const index=state.routines.findIndex(r=>r.id===routineDraft.id);if(index>=0)state.routines[index]=routineDraft;else state.routines.unshift(routineDraft);saveState();closeSheet();renderTrain();showToast('Routine saved');
}
function openRoutineMenu(id){
  const routine=state.routines.find(r=>r.id===id);if(!routine)return;
  // This sheet used to be three admin buttons and nothing else, so the only way to find out what a
  // routine CONTAINED was to start it - which is how Mark ended up deleting workouts he had opened
  // just to look at (2026-08-05). It leads with the exercises now; starting is one deliberate
  // button below them, and the destructive action sits apart from the rest.
  const rows=routine.exerciseIds.map((x,i)=>{
    const item=exerciseById(x);
    return `<div class="selected-row"><span><strong>${i+1}. ${esc(item?.name||'Missing exercise')}</strong><small style="display:block;color:var(--muted)">${esc(item?item.muscle+' · '+item.equipment:'Not in your library')}</small></span></div>`;
  }).join('');
  const done=Core.routinesDoneThisWeek(state.history).has(routine.id);
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">ROUTINE${done?' · DONE THIS WEEK':''}</p><h2>${esc(routine.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>`
    +`<p class="preview-count">${routine.exerciseIds.length} exercise${routine.exerciseIds.length===1?'':'s'}</p>`
    +`<div class="selected-list">${rows||'<div class="empty-card card">This routine has no exercises yet.</div>'}</div>`
    +`<div class="sheet-stack"><button class="primary-button full-button" onclick="startRoutine('${id}')">${done?'Do it again':'Start this routine'}</button></div>`
    +`<div class="sheet-stack"><button class="secondary-button full-button" onclick="closeSheet();openRoutineEditor('${id}')">Edit routine</button><button class="secondary-button full-button" onclick="duplicateRoutine('${id}')">Duplicate routine</button></div>`
    +`<div class="sheet-stack sheet-stack-danger"><button class="secondary-button full-button danger-button" onclick="deleteRoutine('${id}')">Delete routine</button></div>`;
  document.getElementById('sheet').showModal();
}
function duplicateRoutine(id){const routine=state.routines.find(r=>r.id===id);state.routines.unshift({...routine,id:`r${Date.now()}`,name:`${routine.name} copy`,exerciseIds:[...routine.exerciseIds]});saveState();closeSheet();renderTrain();showToast('Routine duplicated');}
function deleteRoutine(id){state.routines=state.routines.filter(r=>r.id!==id);saveState();closeSheet();renderTrain();showToast('Routine deleted');}
function openWorkoutExerciseMenu(index){
  if(!state.activeSession?.exercises[index])return;
  const exercise=state.activeSession.exercises[index],name=exerciseById(exercise.exerciseId)?.name||'Exercise';
  const cue=state.exerciseCues?.[exercise.exerciseId];
  const setsTotal=exercise.sets.length,setsDone=Core.doneSets(exercise).length;
  // Design parity: the sheet leads with "N of M sets logged" + the lift, then two big action rows.
  // The app's own fields (note, standing cue, superset, move) stay BELOW them - the prototype omits
  // them, but deleting working features to match a mockup would be the wrong trade.
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${setsDone} OF ${setsTotal} SET${setsTotal===1?'':'S'} LOGGED</p><h2>${esc(name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>`
    +`<button class="opt-row" onclick="openExercisePicker('workout',${index})"><span class="opt-icon">⇄</span><span class="opt-text"><strong>Swap for another lift</strong><small>Keeps the set count and re-seeds targets</small></span></button>`
    +`<button class="opt-row opt-danger" onclick="confirmRemoveWorkoutExercise(${index})"><span class="opt-icon">×</span><span class="opt-text"><strong>Remove from this session</strong><small>Deletes the sets logged against it</small></span></button>`
    +`<div class="field"><label>WORKOUT NOTE (THIS SESSION)</label><textarea id="exerciseNote" rows="2" placeholder="Seat position, how it felt today…">${esc(exercise.notes||'')}</textarea></div><div class="field"><label>STANDING CUE (SHOWS EVERY WORKOUT)</label><textarea id="exerciseCue" rows="2" placeholder="Example: start stance square - right foot drifts out">${esc(cue?.text||'')}</textarea><small style="color:var(--taupe);font-size:11px">A cue is a hypothesis, not a rule - clear it when it stops earning its place.</small></div><p class="goal-help">Tip: tap a set's number to tag it left or right - that's what fills the Left vs right board.</p>${index<state.activeSession.exercises.length-1?`<label class="beighton-toggle"><span><strong>Superset with next exercise</strong><small>Alternate sets with the exercise below - no rest between the pair, the timer runs after the second one.</small></span><input type="checkbox" ${exercise.supersetWithNext?'checked':''} onchange="toggleSuperset(${index},this.checked)"></label>`:''}<div class="sheet-actions"><button class="secondary-button" onclick="moveWorkoutExercise(${index},-1)" ${index===0?'disabled':''} aria-label="Move exercise up">↑ Move up</button><button class="secondary-button" onclick="moveWorkoutExercise(${index},1)" ${index>=state.activeSession.exercises.length-1?'disabled':''} aria-label="Move exercise down">↓ Move down</button></div><div class="sheet-actions"><button class="primary-button" onclick="saveExerciseNote(${index})">Save</button></div>`;document.getElementById('sheet').showModal();
}
function saveExerciseNote(index){
  const exercise=state.activeSession?.exercises[index];if(!exercise)return;
  exercise.notes=document.getElementById('exerciseNote').value.trim();
  const cueText=document.getElementById('exerciseCue').value.trim();
  if(!state.exerciseCues)state.exerciseCues={};
  if(cueText)state.exerciseCues[exercise.exerciseId]={text:cueText,updated:Date.now()};
  else delete state.exerciseCues[exercise.exerciseId];
  saveState();closeSheet();renderWorkout();showToast('Saved');
}
// Removing an exercise throws away every set logged against it, so it asks first (a bare tap 4px
// from Swap used to delete the lot silently).
function confirmRemoveWorkoutExercise(index){
  const ex=state.activeSession?.exercises[index];if(!ex)return;
  const name=exerciseById(ex.exerciseId)?.name||'this exercise';
  const logged=Core.doneSets(ex).length;
  closeSheet();
  document.getElementById('confirmContent').innerHTML=`<h2>Remove ${esc(name)}?</h2><p>${logged?`${logged} logged set${logged===1?'':'s'} will be discarded.`:'It has no logged sets.'}</p><div class="sheet-actions"><button class="secondary-button" onclick="closeConfirm()">Keep</button><button class="primary-button" onclick="removeWorkoutExercise(${index})">Remove</button></div>`;
  document.getElementById('confirmDialog').showModal();
}
function removeWorkoutExercise(index){
  if(!state.activeSession)return;
  closeConfirm();
  state.activeSession.exercises.splice(index,1);
  // A running rest belongs to an exercise by INDEX - after a splice that index points at a different
  // exercise (or past the end), so rest-end would highlight the wrong row. Re-anchor it.
  if(restExerciseIndex===index)restExerciseIndex=Math.min(index,state.activeSession.exercises.length-1);
  else if(restExerciseIndex>index)restExerciseIndex--;
  saveState();closeSheet();renderWorkout();
}
// Reorder commit. supersetWithNext travels with its exercise, so a moved pair-first simply pairs with
// its new neighbour - visible immediately, one more tap fixes it if unwanted. Core.moveExercise also
// re-anchors the running rest timer, which is held by INDEX and would otherwise point at a new row.
function commitReorder(from,to){
  const session=state.activeSession;if(!session||from===to)return false;
  const moved=Core.moveExercise(session.exercises,from,to,restExerciseIndex);
  session.exercises=moved.list;restExerciseIndex=moved.tracked;
  saveState();renderWorkout();return true;
}
// The ••• menu keeps the adjacent move: it is the keyboard, assistive-tech and no-pointer route.
function moveWorkoutExercise(index,delta){
  const exs=state.activeSession?.exercises;if(!exs)return;
  const j=index+delta;if(j<0||j>=exs.length)return;
  closeSheet();commitReorder(index,j);
}

// ---- Drag to reorder (2026-08-01). The card body keeps its taps and the page keeps its scroll
// because the ONLY drag surface is the grip: touch-action:none lives on that button and nowhere else.
const GRIP_ICON='<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>';
const DRAG_EDGE=72,DRAG_SPEED=14,DRAG_SLOP=4; // autoscroll band px / max px per frame / px before a press counts as a drag
let drag=null;
// hold=true => LONG-PRESS to arm (whole-card surfaces). Without it a stray 8px drag lifted a card,
// which is why finished rows "moved too easy": the entire row is the handle. Movement before the
// hold fires cancels the gesture so the list still scrolls normally under a finger.
const HOLD_MS=360, HOLD_CANCEL_PX=8;
function gripDown(event,index,hold){
  if(drag||event.button>0||!state.activeSession)return;
  const handle=event.currentTarget,card=handle.closest('.workout-exercise');if(!card)return;
  drag={index,to:index,handle,card,id:event.pointerId,sid:state.activeSession.id,startY:event.clientY+scrollY,lastY:event.clientY,lifted:false,frame:0,
    armed:!hold,pending:!!hold,startX:event.clientX,
    // Listeners on document, not the handle: pointer capture retargets to the handle and they still
    // bubble here, so the gesture survives even where setPointerCapture is refused.
    off:[[document,'pointermove',gripMove],[document,'pointerup',gripUp],[document,'pointercancel',gripCancel],[document,'keydown',gripKey],[document,'visibilitychange',gripHide]]};
  try{handle.setPointerCapture(event.pointerId);}catch{}
  drag.off.forEach(([el,type,fn])=>el.addEventListener(type,fn));
  if(hold){
    card.classList.add('drag-pending');
    drag.holdTimer=setTimeout(()=>{
      if(!drag)return;
      drag.armed=true;drag.pending=false;
      drag.startY=drag.lastY+scrollY;      // re-anchor so the lift does not jump
      card.classList.remove('drag-pending');
      buzz(12);                            // the "it is yours now" tick
      liftDrag();
    },HOLD_MS);
  }
}
function gripMove(event){
  if(!drag||event.pointerId!==drag.id)return;
  drag.lastY=event.clientY;
  // Still waiting on the long press: any real movement means the finger is scrolling, not dragging.
  if(drag.pending){
    const moved=Math.max(Math.abs(event.clientY+scrollY-drag.startY),Math.abs(event.clientX-drag.startX));
    if(moved>HOLD_CANCEL_PX)endDrag(false);
    return;
  }
  if(!drag.armed)return;
  if(!drag.lifted&&Math.abs(event.clientY+scrollY-drag.startY)>DRAG_SLOP)liftDrag();
}
// Geometry is measured ONCE, at lift: every frame after that is transform-only, so the drag never
// re-lays-out and never re-renders. ponytail: a re-render mid-drag (nothing triggers one today
// without a tap) would leave the cached rects stale - if one ever does, cancel the drag on render.
// TODO(design): HANDOFF also asks the whole list to collapse to ~68px rows on pick-up, so a 6-lift
// session is reorderable in one short drag. Not done here on purpose: this implementation measures
// each card's REAL span (incl. grid gap + superset link) at lift time, so displacement is already
// correct at any card height, and v2 collapses finished exercises to a done row anyway - a late
// session is already short. Collapsing on pick-up means re-rendering mid-drag and re-measuring,
// which is the exact case HANDOFF warns loses a card-level pointerup. Worth doing only with the
// window-level listeners it describes, and worth a fresh drag test. Behaviour today is unchanged
// and green (browser-flow drag-reorder + reduced-motion).
function liftDrag(){
  const cards=[...document.querySelectorAll('#workoutExercises .workout-exercise')];
  if(cards.length<2||cards[drag.index]!==drag.card)return endDrag(false);
  drag.units=cards.map(card=>{const rect=card.getBoundingClientRect(),next=card.nextElementSibling;
    return {els:next&&next.classList.contains('ss-link')?[card,next]:[card],top:rect.top+scrollY,h:rect.height};});
  const n=drag.units.length,tail=drag.units[n-1].top-(drag.units[n-2].top+drag.units[n-2].h);
  // Span = the room an exercise occupies including its grid gap and superset link, so displaced
  // siblings shift by EXACTLY the hole the lifted card leaves, whatever the card heights are.
  drag.units.forEach((unit,i)=>{unit.span=i<n-1?drag.units[i+1].top-unit.top:unit.h+tail;});
  drag.lifted=true;
  document.body.classList.add('reordering');
  drag.card.classList.add('drag-lift');
  if(!REDUCED_MOTION)drag.units.forEach((unit,i)=>{if(i!==drag.index)unit.els.forEach(el=>el.style.transition='transform .18s var(--ease)');});
  buzz(15);
  drag.frame=requestAnimationFrame(dragTick);
}
function dragTick(){
  if(!drag||!drag.lifted)return;
  const nav=document.querySelector('.bottom-nav'),head=document.querySelector('.workout-header');
  const top=head?Math.max(0,head.getBoundingClientRect().bottom):0;
  const bottom=innerHeight-(nav?nav.getBoundingClientRect().height:0); // hidden nav measures 0, so the band follows what is actually visible
  const y=drag.lastY;
  let speed=0;
  if(y<top+DRAG_EDGE)speed=-DRAG_SPEED*Math.min(1,(top+DRAG_EDGE-y)/DRAG_EDGE);
  else if(y>bottom-DRAG_EDGE)speed=DRAG_SPEED*Math.min(1,(y-(bottom-DRAG_EDGE))/DRAG_EDGE);
  if(speed)scrollBy({top:speed,behavior:'instant'}); // html{scroll-behavior:smooth} would queue an animation per frame and fight the drag
  // Document-space maths: the offset survives autoscroll, so the card stays under the finger.
  const from=drag.index,units=drag.units,delta=y+scrollY-drag.startY;
  const centre=units[from].top+delta+units[from].h/2;
  let to=0;
  units.forEach((unit,j)=>{if(j!==from&&unit.top-(j>from?units[from].span:0)+unit.h/2<centre)to++;});
  if(to!==drag.to){drag.to=to;buzz(8);slotDrag();}
  drag.card.style.transform=`translateY(${delta}px) scale(1.02)`;
  drag.frame=requestAnimationFrame(dragTick);
}
function slotDrag(){
  const from=drag.index,to=drag.to,span=drag.units[from].span;
  drag.units.forEach((unit,j)=>{if(j===from)return;
    const shift=(from<j&&j<=to)?-span:(to<=j&&j<from)?span:0;
    unit.els.forEach(el=>el.style.transform=shift?`translateY(${shift}px)`:'');});
}
function gripUp(event){
  if(!drag||event.pointerId!==drag.id)return;
  if(!drag.lifted)return endDrag(false); // a real tap: let the click through to the move options
  const from=drag.index,to=drag.to,units=drag.units;
  cancelAnimationFrame(drag.frame);drag.frame=0;
  const rest=to>from?units[to].top+units[to].span-units[from].span:units[to].top;
  // The gesture's own ghost click must not fall through onto whatever now sits under the finger.
  document.addEventListener('click',swallowClick,true);setTimeout(()=>document.removeEventListener('click',swallowClick,true),0);
  if(REDUCED_MOTION)return endDrag(true);
  drag.card.classList.add('drag-settle');
  drag.card.style.transform=`translateY(${rest-units[from].top}px) scale(1)`;
  drag.settle=setTimeout(()=>endDrag(true),220);
}
function swallowClick(event){event.stopPropagation();event.preventDefault();document.removeEventListener('click',swallowClick,true);}
function gripCancel(event){if(drag&&event.pointerId===drag.id)endDrag(false);}
function gripKey(event){if(event.key==='Escape')endDrag(false);}
function gripHide(){if(document.hidden)endDrag(false);}
// One exit for every path (drop, pointercancel, Escape, tab hidden): styles are always stripped
// before anything else, so no cancel can leave a zombie transform behind.
function endDrag(commit){
  if(drag){clearTimeout(drag.holdTimer);drag.card&&drag.card.classList.remove('drag-pending');}
  if(!drag)return;
  const d=drag;drag=null;
  if(d.frame)cancelAnimationFrame(d.frame);
  clearTimeout(d.settle);
  d.off.forEach(([el,type,fn])=>el.removeEventListener(type,fn));
  try{d.handle.releasePointerCapture(d.id);}catch{}
  document.body.classList.remove('reordering');
  d.card.classList.remove('drag-lift','drag-settle');
  d.card.style.transform='';d.card.style.transition='';
  (d.units||[]).forEach(unit=>unit.els.forEach(el=>{el.style.transform='';el.style.transition='';}));
  // Session identity check (Codex P1): a storage-event profile/session swap mid-drag must never
  // let stale indexes reorder whatever session is active NOW.
  if(!commit||state.activeSession?.id!==d.sid)return;
  buzz(15);
  commitReorder(d.index,d.to);
}

function openCustomExercise(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Custom exercise</h2><button class="close-button" onclick="closeSheet()">×</button></div><div class="field"><label>EXERCISE NAME</label><input id="customName" placeholder="Example: Landmine press"></div><div class="field"><label>MUSCLE GROUP</label><select id="customMuscle">${['Chest','Back','Shoulders','Arms','Grip','Legs','Core','Full Body','Cardio','Mobility','Calisthenics','Stretches'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label>EQUIPMENT</label><input id="customEquipment" placeholder="Example: Cable machine"></div><button class="primary-button full-button" onclick="saveCustomExercise()">Add exercise</button>`;document.getElementById('sheet').showModal();
}
function saveCustomExercise(){const name=document.getElementById('customName').value.trim();if(!name)return showToast('Name the exercise');state.customExercises.push({id:`c${Date.now()}`,name,muscle:document.getElementById('customMuscle').value,equipment:document.getElementById('customEquipment').value.trim()||'Custom equipment',custom:true});saveState();closeSheet();renderLibrary();showToast('Custom exercise added');}

// Work happens on three axes and they are DIFFERENT quantities, so they are never summed into one
// figure: kilograms lifted, reps of bodyweight work the kilogram axis cannot honestly describe, and
// seconds held. Reporting only the first is exactly how Ty's calisthenics came to read as nothing.
// Every line is suppressed when it has nothing to say, so a pure barbell session looks unchanged.
function workBreakdown(work){
  if(!work)return '';
  const parts=[];
  if(work.bodyweightKg>0)
    parts.push(`<span><strong>${compact(work.bodyweightKg)} kg</strong> of that is bodyweight, counted at your ${work.bodyweightUsed} kg</span>`);
  if(work.seconds>0)
    parts.push(`<span><strong>${work.seconds}s</strong> held</span>`);
  // Lever work (hanging leg raise, nordic curl, dragon flag) has no honest body-mass multiplier, so
  // it is counted in reps rather than handed a fabricated load. Saying so out loud is the point.
  if(work.setsUncounted>0)
    parts.push(`<span><strong>${work.setsUncounted} set${work.setsUncounted===1?'':'s'} · ${work.repsUncounted} reps</strong> of work with no load to measure</span>`);
  const prompt=work.needsBodyweight
    ? `<button class="bw-prompt" onclick="closeSheet();setTimeout(openBodyweightLog,300)">Add your bodyweight so your calisthenics count</button>`:'';
  if(!parts.length&&!prompt)return '';
  return `<div class="work-axes">${parts.join('')}</div>${prompt}`;
}
// The MINUTES tile reads "1618" for a session left open overnight, so an implausible wall time is
// reported as unknown rather than as a number that is certainly wrong (Core.sessionMinutes).
function durationTile(summary){
  if(summary.durationCapped)return `<div class="metric"><strong>—</strong><span>MINUTES</span></div>`;
  return `<div class="metric"><strong>${summary.durationMinutes}</strong><span>MINUTES${summary.durationEstimated?' · EST':''}</span></div>`;
}
function openHistory(id){
  const session=state.history.find(s=>s.id===id);if(!session)return;
  const summary=Core.summarizeSession(session);
  // Volume honesty: kg only measures the lifts that carried a load, so say how many that was, and
  // name the lifts that were logged bare AFTER being loaded before - that gap IS the inconsistency.
  const cover=Core.volumeCoverage(session),gaps=Core.loadGaps(state.history,session);
  const gapIds=new Set(gaps.map(g=>g.exerciseId));
  const work=Core.sessionWork(session);
  // Two different situations wear the same shape, and only one of them is a mistake. A lift whose
  // load was FORGOTTEN reads as an omission; a hanging leg raise simply has no measurable load and
  // must never be described as if the lifter left something out.
  const missing=cover.total-cover.loaded;
  const coverNote=cover.total&&!cover.complete
    ? (gaps.length
      ? `<p class="vol-note">Kilograms count the <strong>${cover.loaded} of ${cover.total}</strong> lifts that carried a load. ${missing} ${missing===1?'was':'were'} logged without one, so ${missing===1?'it adds':'they add'} nothing to the total.</p>`
      : `<p class="vol-note">Kilograms count the <strong>${cover.loaded} of ${cover.total}</strong> lifts that carry a measurable load. The rest is real work on a different axis, not a gap.</p>`)
    :'';
  const gapNote=gaps.length
    ? `<p class="vol-gap"><strong>Missing a load.</strong> ${gaps.map(g=>`${esc(exerciseById(g.exerciseId)?.name||'A lift')} (last time ${g.lastWeight} kg)`).join(', ')}. Add the weight and this session's total will match the work you actually did.</p>`:'';
  const rows=session.exercises.map(ex=>{
    const item=exerciseById(ex.exerciseId),sets=Core.doneSets(ex),timed=!!item?.timed;
    const bwF=Core.bodyweightFactor(ex.exerciseId);
    const cell=s=>timed?`${s.reps||0} s`
      :bwF!=null?`${work.bodyweightUsed?`${Math.round(work.bodyweightUsed*bwF)} kg`:'bodyweight'}${s.weight?` +${s.weight}`:''} × ${s.reps||0}`
      // "no load" is a FLAG, so it is reserved for a lift this lifter has loaded before and did not
      // this time. A movement with nothing to measure just states its reps.
      :s.weight?`${s.weight} kg × ${s.reps||0}`
      :gapIds.has(ex.exerciseId)?`no load × ${s.reps||0}`
      :`${s.reps||0} reps`;
    const line=sets.length?sets.map(cell).join(' · '):'No completed sets';
    return `<div class="selected-row${gapIds.has(ex.exerciseId)?' row-gap':''}"><span><strong>${esc(item?.name||'Exercise')}</strong><small style="display:block;color:var(--muted)">${esc(line)}</small></span></div>`;
  }).join('');
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${formatDate(session.started).toUpperCase()}</p><h2>${esc(session.name)}</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>`
    +`<div class="metric-grid">${durationTile(summary)}<div class="metric"><strong>${summary.completedSets}</strong><span>SETS</span></div><div class="metric"><strong>${compact(summary.volume)}</strong><span>KG</span></div></div>`
    +workBreakdown(work)+coverNote+gapNote
    +`<div class="selected-list">${rows}</div>`
    // Three stacked full-width buttons with no gap read as one cramped block (Mark 2026-08-05).
    // Grouped with real spacing, and the destructive action sits apart from the two safe ones.
    +`<div class="sheet-stack">${historyLinkRow(session)}<button class="secondary-button full-button" onclick="saveHistoryAsRoutine('${id}')">Save as routine</button></div>`
    +`<div class="sheet-stack sheet-stack-danger"><button class="secondary-button full-button danger-button" onclick="deleteHistory('${id}')">Delete workout</button></div>`;
  document.getElementById('sheet').showModal();
}
// A workout logged BEFORE its routine existed has routineId null, so the week never counts it.
// This is the repair: attach it after the fact and the routine ticks over to done.
function historyLinkRow(session){
  const linked=state.routines.find(r=>r.id===session.routineId);
  return `<button class="secondary-button full-button" onclick="openHistoryLink('${session.id}')">${linked?`Counts as · ${esc(linked.name)}`:'Count this as a routine'}</button>`;
}
function openHistoryLink(id){
  const session=state.history.find(s=>s.id===id);if(!session)return;
  if(!state.routines.length)return showToast('No routines to link to yet');
  // Best-overlap first: the routine sharing the most exercises with what was actually trained is
  // nearly always the one meant, so the common case is one tap instead of a hunt.
  const trained=new Set((session.exercises||[]).map(ex=>ex.exerciseId));
  const ranked=state.routines.map(r=>({r,hits:r.exerciseIds.filter(x=>trained.has(x)).length}))
    .sort((a,b)=>b.hits-a.hits||a.r.name.localeCompare(b.r.name));
  const rows=ranked.map(({r,hits})=>`<div class="selected-row"><span><strong>${esc(r.name)}</strong><small style="display:block;color:var(--muted)">${hits} of ${r.exerciseIds.length} exercises match${r.id===session.routineId?' · linked now':''}</small></span><button onclick="linkHistoryToRoutine('${id}','${r.id}')">${r.id===session.routineId?'Keep':'Pick'}</button></div>`).join('');
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">${esc(session.name)}</p><h2>Count this as</h2></div><button class="close-button" onclick="closeSheet()">×</button></div><p style="color:var(--muted);margin-top:-6px">Attaches this logged workout to a routine so your week shows it as done. Nothing about the sets changes.</p><div class="selected-list">${rows}</div>${session.routineId?`<button class="secondary-button full-button" onclick="linkHistoryToRoutine('${id}','')">Unlink</button>`:''}<button class="secondary-button full-button" onclick="openHistory('${id}')">Back</button>`;
  document.getElementById('sheet').showModal();
}
function linkHistoryToRoutine(sessionId,routineId){
  const session=state.history.find(s=>s.id===sessionId);if(!session)return;
  const routine=state.routines.find(r=>r.id===routineId);
  session.routineId=routine?routine.id:null;
  // Only the untouched default name is rewritten - never a title the lifter chose themselves.
  if(routine&&session.name==='Quick workout')session.name=routine.name;
  saveState();
  if(Sync)try{Sync.onSessionComplete(session);}catch{} // the stored copy must carry the new link too
  closeSheet();renderToday();renderTrain();renderProgress();
  showToast(routine?`Counted as ${routine.name}`:'Unlinked');
}
// A routine IS just a named, ordered exercise list - so any logged workout can become one.
// To merge two workouts into a single routine, save one here then ••• → Edit and add the rest.
// A routine is just a named, ordered exercise list, so ANY source of one can become a routine:
// a finished workout, the workout running right now, a plan day, a template. One helper, so the
// dedupe-the-name rule and the "did anything actually save" check can't drift between callers.
function saveIdsAsRoutine(rawIds,baseName){
  const exerciseIds=[...new Set((rawIds||[]).filter(x=>exerciseById(x)))];
  if(!exerciseIds.length){showToast('Nothing here to save');return null;}
  const base=(baseName||'Saved workout').trim()||'Saved workout';
  let name=base,n=2;
  while(state.routines.some(r=>r.name===name))name=`${base} ${n++}`; // two identical names in the list help nobody
  const routine={id:`r${Date.now()}`,name,exerciseIds};
  state.routines.unshift(routine);
  saveState();renderTrain();renderToday();showToast(`Saved as routine · ${name}`);
  return routine;
}
function saveHistoryAsRoutine(id){
  const session=state.history.find(s=>s.id===id);if(!session)return;
  if(saveIdsAsRoutine((session.exercises||[]).map(ex=>ex.exerciseId),session.name))closeSheet();
}
// Save the workout RUNNING RIGHT NOW. Previously a session could only become a routine after it was
// finished and filed in history, which is the wrong moment: the ordering you want to keep is the one
// you just built on the gym floor (Mark, 2026-07-28).
function saveActiveAsRoutine(){
  const session=state.activeSession;if(!session)return;
  const routine=saveIdsAsRoutine(session.exercises.map(ex=>ex.exerciseId),session.name);
  if(!routine)return;
  // Stamping routineId makes this session count toward "Done this week" for the routine it just became.
  if(!session.routineId){session.routineId=routine.id;saveState();}
}
function deleteHistory(id){
  state.history=state.history.filter(s=>s.id!==id);
  if(Sync&&Sync.forget)try{Sync.forget(id);}catch{} // never let a deleted session re-upload later
  saveState();closeSheet();renderProgress();showToast('Workout deleted');
}

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
  // v2 Settings: the SAME fields, restyled. Rest timer and bar weight become segmented controls
  // (a select hid the options behind a tap); the three toggles become 50x30 switches, each inside a
  // full 44px row; the sync block is untouched; the build id stays in the footer.
  const seg=(id,label,values,current,handler)=>`<div class="field"><label id="${id}Label">${label}</label>`
    +`<div class="segmented" id="${id}" role="group" aria-labelledby="${id}Label">`
    +values.map(([v,text])=>`<button type="button" class="seg-button${String(current)===String(v)?' on':''}" aria-pressed="${String(current)===String(v)}" onclick="${handler}('${v}')">${text}</button>`).join('')
    +`</div></div>`;
  const sw=(title,detail,checked,handler,id)=>`<label class="switch-row"><span><strong>${title}</strong><small>${detail}</small></span>`
    +`<input type="checkbox" class="switch"${id?` id="${id}"`:''} ${checked?'checked':''} onchange="${handler}(this.checked)"></label>`;
  // The build id is RELEASE TRUTH - it is how you answer "which version am I actually on?" - but it
  // lived only as an 11px --faint line at the very BOTTOM of this sheet, 614px of scrolling away and
  // flush against the sheet edge. Mark went looking for it: "i cant see the number anywhere in the
  // app". Settings was also the one sheet with an EMPTY kicker slot while every other sheet uses one,
  // so it moves there: same design language, zero scrolling, no new component.
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><div><p class="kicker">BUILD ${esc(typeof BUILD!=='undefined'?BUILD:'dev')}</p><h2>Settings &amp; data</h2></div><button class="close-button" onclick="closeSheet()">×</button></div>`
    +profileSettingsMarkup()
    +seg('restSetting','DEFAULT REST TIMER',[[60,'1 min'],[90,'1.5 min'],[120,'2 min'],[180,'3 min']],Number(state.preferences.restSeconds)||90,'setRestPreference')
    +seg('barSetting','BAR WEIGHT (PLATE MATH)',[[15,'15 kg'],[20,'20 kg']],Number(state.preferences.barWeight)||20,'setBarWeight')
    +sw('Haptics','A short buzz on set complete, rest end and PRs. Android only - iPhone has no web vibration.',state.preferences.haptics!==false,'toggleHaptics','hapticsToggle')
    +sw('Rest-end notification','Pings when the rest timer finishes while the app is in the background (needs notification permission).',state.preferences.restNotify===true,'enableRestNotify')
    +sw('Training around an injury','Adds the pain check-in, the flare question, and load step-downs when pain climbs. Leave off if nothing hurts.',injuryMode(),'toggleInjuryMode')
    +`<div class="stack"><button id="installButton" class="secondary-button full-button" onclick="installApp()">Install Gym</button><button class="secondary-button full-button" onclick="exportBackup()">Download backup</button><button class="secondary-button full-button" onclick="document.getElementById('importInput').click()">Import backup</button><button class="secondary-button full-button" style="color:var(--danger)" onclick="clearAllData()">Clear all data</button></div>`
    +syncSettingsMarkup()
    +`<p class="settings-note">Private by default. Your training data stays in this browser unless you export it.</p>`
    +(state.preferences.backfillBodyweight
      ? `<p class="settings-note">Sessions logged before your first weigh-in are counted at <strong>${esc(String(state.preferences.backfillBodyweight))} kg</strong>. <button class="text-button" onclick="clearBodyweightBackfill()">Undo</button></p>`:'')
    +`<p class="build-footer">Build ${esc(typeof BUILD!=='undefined'?BUILD:'dev')}</p>`;
  document.getElementById('sheet').showModal();
  if(Sync)try{Sync.preload();}catch{} // warm GIS so the first Connect tap opens the popup in-gesture
}
// Google Drive sync + coach settings. drive.file scope only; the OAuth client ID is pasted by the owner.
function syncSettingsMarkup(){
  if(!Sync)return '';
  const st=Sync.status(),cfg=Sync.loadConfig(),beighton=Sync.getBeighton();
  const conn=st.configured?(st.connected?'Connected':'Connected - signing in again on next sync'):'Not connected';
  if(Sync.preload)try{Sync.preload(true);}catch{} // sheet is open; warm GIS so the Connect tap is in-gesture
  return `<div class="section-heading"><div><p class="kicker">SYNC & COACH</p><h2>Google Drive</h2></div></div>
    <p style="color:var(--taupe);font-size:12px;margin:-2px 0 10px">Optional. Backs your workouts up to <strong>your own</strong> Google Drive, in a private <strong>Gym-Sync</strong> folder. This app can only ever see files it created itself - never the rest of your Drive.</p>
    <details class="sync-advanced"><summary>Advanced</summary><div class="field" style="margin-top:10px"><label>OAUTH CLIENT ID</label><input id="syncClientId" value="${esc(cfg.clientId||'')}" placeholder="xxxx.apps.googleusercontent.com" oninput="saveSyncClientId(this.value)"><small style="color:var(--taupe);font-size:11px">Only change this if you run your own Google Cloud project. Clear it to go back to the built-in one.</small></div></details>
    <div class="stack">
      ${st.configured?`<button class="secondary-button full-button" onclick="disconnectSync()">Disconnect</button>`:`<button class="secondary-button full-button" ${st.available?'':'disabled'} onclick="connectSync()">Connect Google Drive</button>`}
    </div>
    <p style="color:var(--taupe);font-size:11px;margin:8px 2px 0">Status: ${esc(conn)}${st.queued?` · ${st.queued} session${st.queued===1?'':'s'} queued`:''}</p>
    ${injuryMode()?`<label class="beighton-toggle"><span><strong>Hypermobility features</strong><small>For lifters with a Beighton hypermobility assessment - unlocking accepts coach plans that use those extra joint-safety capabilities.</small></span><input type="checkbox" ${beighton?'checked':''} onchange="toggleBeighton(this.checked)"></label>`:''}`;
}
function saveSyncClientId(value){if(Sync)Sync.setClientId(value);}
function connectSync(){
  if(!Sync)return;
  Sync.connect().then(()=>{openSettings();renderToday();showToast('Google Drive connected');}).catch(e=>{
    const m=String((e&&e.message)||e);
    showToast(
      m==='gsi-not-ready'?'Still loading Google - tap Connect again':
      m==='popup_failed_to_open'?'Pop-up blocked - allow pop-ups for this site, then tap Connect':
      m==='no-token'||m==='access_denied'?'Sign-in cancelled - tap Connect to retry':
      'Could not connect - try again');
  });
}
function disconnectSync(){if(Sync){Sync.disconnect();openSettings();renderToday();showToast('Disconnected');}}
function toggleBeighton(on){if(Sync){Sync.setBeighton(on);renderToday();showToast(on?'Beighton features unlocked':'Beighton features locked');}}
function setRestPreference(value){state.preferences.restSeconds=Number(value);saveState();openSettings();showToast('Rest timer updated');}
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
  // iOS never fires beforeinstallprompt and only Safari can install - give the real steps.
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
// No beforeunload guard (2026-07-28, same class as the tab-switch confirm): every tap is already
// persisted, so "changes may not be saved" was a lie - closing mid-workout loses nothing and the
// session resumes on next open. The browser dialog it raised also wedged headless test renderers.
// Release truth (Wave 0): register the SW, then watch for a waiting/installed worker and surface the
// user-controlled "Update ready" pill. Tapping posts SKIP_WAITING; controllerchange → one reload.
let waitingWorker=null;
function showUpdatePill(worker){waitingWorker=worker;const pill=document.getElementById('updatePill');if(pill){pill.hidden=false;requestAnimationFrame(()=>pill.classList.add('show'));}}
function applyUpdate(){if(!waitingWorker)return;swSwapExpected=true;waitingWorker.postMessage({type:'SKIP_WAITING'});const pill=document.getElementById('updatePill');if(pill)pill.textContent='Updating…';}
let swSwapExpected=false;
if('serviceWorker' in navigator&&location.protocol.startsWith('http')){
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    if(reg.waiting&&navigator.serviceWorker.controller)showUpdatePill(reg.waiting);
    reg.addEventListener('updatefound',()=>{const w=reg.installing;if(!w)return;w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)showUpdatePill(w);});});
    // An installed PWA resumed from the background never reloads the page, so register()'s update
    // check never re-runs and the app can sit on a stale version for days (hit 2026-07-23).
    // Re-check whenever it comes back to the foreground; the pill still gates the actual swap.
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{});});
  }).catch(()=>{});
  // Reload ONLY on a real update swap (a previous controller existed, or the pill asked for the swap).
  // A fresh first install fires controllerchange via clients.claim() - that must never reload (Codex P2).
  const hadController=!!navigator.serviceWorker.controller;
  let reloadedForUpdate=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloadedForUpdate||!(hadController||swSwapExpected))return;
    reloadedForUpdate=true;location.reload();
  });
}
document.getElementById('sheet').addEventListener('click',event=>{if(event.target===event.currentTarget&&!(pinContext&&pinContext.mandatory)&&!lockGate)closeSheet();});
document.getElementById('filterSheet').addEventListener('click',event=>{if(event.target===event.currentTarget)closeFiltersSheet();});
// Catalogue event delegation - one listener per surface; row/star/quick/muscle actions read data-id/data-muscle (no inline handlers).
document.getElementById('view-library').addEventListener('click',event=>onCatalogueClick('library',event));
document.getElementById('sheetContent').addEventListener('click',event=>onCatalogueClick('picker',event));
document.getElementById('filterSheetContent').addEventListener('click',onFacetClick);
// ================= POLISH pass (council 2026-07-20) - sheet physics =================
// Play a native <dialog>'s exit animation before .close(). Reduced-motion (and a closed dialog)
// skip straight to the callback. A pending close is flushable so a "close→reopen same dialog"
// sequence (e.g. PIN → back to Settings, both on #sheet) can't hit showModal's already-open throw.
function dismissDialog(dlg,after){
  if(!dlg||!dlg.open){after&&after();return;}
  if(REDUCED_MOTION){if(dlg.open)dlg.close();after&&after();return;}
  if(dlg._closeTimer)clearTimeout(dlg._closeTimer);
  dlg._closing=true;dlg.classList.add('closing');
  const finalize=()=>{clearTimeout(dlg._closeTimer);dlg._closeTimer=null;dlg._closing=false;dlg._flushClose=null;dlg.classList.remove('closing');dlg.classList.remove('dragging');dlg.style.removeProperty('--drag');if(dlg.open)dlg.close();};
  dlg._flushClose=finalize;
  dlg._closeTimer=setTimeout(()=>{finalize();after&&after();},190);
}
// Patch showModal ONCE: remember the opener for focus-return, flush any pending close, and never
// re-invoke native showModal on an already-open dialog (that throws). Focus returns on the 'close' event.
(function(){
  const proto=HTMLDialogElement.prototype,nativeShow=proto.showModal;
  proto.showModal=function(){
    if(this._closing&&this._flushClose)this._flushClose();
    if(this.open)return; // same-dialog navigation (e.g. Settings→PIN on #sheet): keep the FIRST opener
    // Record the opener only when it is a real control OUTSIDE this dialog - an innerHTML swap often
    // leaves focus on <body>, which must not clobber a good opener from the original open (Codex P2).
    const ae=document.activeElement;
    if(ae&&ae!==document.body&&!this.contains(ae))this._opener=ae;
    return nativeShow.call(this);
  };
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{
    const o=d._opener;if(o&&o.isConnected&&typeof o.focus==='function'){try{o.focus({preventScroll:true});}catch{try{o.focus();}catch{}}}
  }));
})();
// Keyboard-safe sheet height: while the on-screen keyboard is up (visual viewport shrinks well below the
// layout viewport) clamp the sheet to the visible height so a focused field is never covered. Otherwise
// clear the override so the normal 88vh cap applies. Never sets 0 (a stray 0 would collapse the sheet).
// One keyboard model for the WHOLE app (2026-08-05). Three things have to be true everywhere a
// field can be focused, or you end up typing into something you cannot see:
//   1. the surface holding the field is never taller than the space the keyboard leaves  (--vvh)
//   2. whatever scrolls has enough room below its last row to bring that row up          (--kb)
//   3. the field that just took focus is actually brought into view                      (focusin)
// The viewport meta carries `interactive-widget=resizes-content` so the layout viewport shrinks too;
// this block is the belt to that braces, and covers iOS, where it does not.
const KB_MIN=120; // below this the shrink is browser chrome (URL bar), not a keyboard
let kbOpen=false;
if(window.visualViewport){
  const vv=window.visualViewport,root=document.documentElement;
  const syncVVH=()=>{
    const keyboard=Math.max(0,window.innerHeight-vv.height-vv.offsetTop);
    kbOpen=vv.height>0&&keyboard>KB_MIN;
    if(kbOpen){
      root.style.setProperty('--vvh',Math.round(vv.height-8)+'px');
      // Room to scroll the last row clear of the keyboard. Without it the bottom of any list is
      // simply unreachable while typing - you can see it is there and cannot get to it.
      root.style.setProperty('--kb',Math.round(keyboard)+'px');
      document.body.classList.add('kb-open');
    }else{
      root.style.removeProperty('--vvh');root.style.removeProperty('--kb');
      document.body.classList.remove('kb-open');
    }
    if(kbOpen)revealFocused();
  };
  vv.addEventListener('resize',syncVVH);vv.addEventListener('scroll',syncVVH);syncVVH();
}
// Bring the focused field into view inside whatever is actually scrolling it. `block:'nearest'` is
// deliberate: 'center' yanks a field that was already comfortably visible, which reads as a lurch.
// rAF-then-timeout because the keyboard animates in - measuring on the focus event alone reads the
// pre-keyboard geometry and scrolls to the wrong place.
function revealFocused(){
  const el=document.activeElement;
  if(!el||!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)||el.type==='file')return;
  requestAnimationFrame(()=>{try{el.scrollIntoView({block:'nearest',behavior:'smooth'});}catch{}});
}
document.addEventListener('focusin',e=>{
  const el=e.target;
  if(!el||!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)||el.type==='file')return;
  // Two passes: one now (covers a field already off-screen with no keyboard change) and one after
  // the keyboard has finished animating (covers the field the keyboard just covered).
  revealFocused();setTimeout(revealFocused,260);
});
// Drag-to-dismiss - ONLY from the handle's 44px grab zone (the sheet body scrolls untouched). Rubber-band
// resistance above rest; release past 25% height OR downward velocity >0.5px/ms dismisses, else springs back.
function attachSheetDrag(sheetId,dismissFn){
  const dlg=document.getElementById(sheetId),handle=dlg&&dlg.querySelector('.sheet-handle');if(!handle)return;
  let dragging=false,startY=0,lastY=0,lastT=0,vel=0,h=1;
  const blocked=()=>sheetId==='sheet'&&((pinContext&&pinContext.mandatory)||lockGate); // non-dismissible gate states
  handle.addEventListener('pointerdown',e=>{
    if(!dlg.open)return;
    dragging=true;startY=lastY=e.clientY;lastT=e.timeStamp;vel=0;h=dlg.getBoundingClientRect().height||1;
    dlg.classList.add('dragging');dlg.classList.remove('settle');dlg.style.setProperty('--drag','0px');
    try{handle.setPointerCapture(e.pointerId);}catch{}
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging)return;
    let d=e.clientY-startY;if(d<0)d*=.5; // rubber-band when dragged above the resting position
    dlg.style.setProperty('--drag',d+'px');
    const dt=e.timeStamp-lastT;if(dt>0)vel=(e.clientY-lastY)/dt;
    lastY=e.clientY;lastT=e.timeStamp;
  });
  const end=e=>{
    if(!dragging)return;dragging=false;
    try{handle.releasePointerCapture(e.pointerId);}catch{}
    const d=Math.max(0,lastY-startY);
    if(!blocked()&&(d>h*.25||vel>0.5)){dlg.classList.remove('dragging');dlg.style.removeProperty('--drag');dismissFn();}
    else{dlg.style.setProperty('--drag','0px');dlg.classList.remove('dragging');dlg.classList.add('settle');setTimeout(()=>{dlg.classList.remove('settle');dlg.style.removeProperty('--drag');},300);}
  };
  handle.addEventListener('pointerup',end);
  handle.addEventListener('pointercancel',end);
  handle.addEventListener('lostpointercapture',end);
}
attachSheetDrag('sheet',closeSheet);
attachSheetDrag('padSheet',closePad);
attachSheetDrag('filterSheet',closeFiltersSheet);
// ================= Track B - local profiles UI =================
function renderProfileChip(){
  const chip=document.getElementById('profileChip');if(!chip)return;
  if(!Profiles){chip.hidden=true;return;}
  const p=Profiles.getActive(localStorage);
  document.getElementById('profileChipInitial').textContent=p?Profiles.initial(p.name||'?'):'?';
  chip.setAttribute('aria-label',`Switch profile${p&&p.name?` - currently ${p.name}`:''}`);
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
  if(Sync&&Sync.setUser)Sync.setUser(Profiles.syncKeyFor(id)); // hard auth reset - no cross-profile token bleed
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
  document.body.classList.remove('workout-active');
  renderAllViews();renderProfileChip();
  const main=document.getElementById('main');if(main)main.focus({preventScroll:true});window.scrollTo(0,0);
  if(Sync)try{Sync.flush();Sync.downSync().then(()=>renderCoach()).catch(()=>{});}catch{}
  const name=(Profiles.getActive(localStorage)||{}).name;
  showToast(name?`Training as ${name}`:'Profile switched');
}
function addPerson(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Add person</h2><button class="close-button" onclick="closeSheet()">×</button></div>
    <p class="first-run-sub">A separate space on this phone - their own history, favourites and plans. The only shared thing is the gym’s exercise list.</p>
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
// First-run / post-migration welcome - names the profile bootstrap already created. One screen, no friction.
function openFirstRunSheet(){
  document.getElementById('sheetContent').innerHTML=`<div class="sheet-head"><h2>Who’s training on this phone?</h2></div>
    <p class="first-run-sub"><strong>Log your lifts, see what's actually working, get stronger.</strong> Stored on this device. Optional backup to your own Google Drive, which only you can see. You can add other people later from the profile menu.</p>
    <div class="field"><label>YOUR NAME</label><input id="firstRunName" placeholder="Your name" onkeydown="if(event.key==='Enter')submitFirstRun()"></div>
    <button class="primary-button full-button" onclick="submitFirstRun()">Start training</button>`;
  // "Continue" conceals the outcome; "Start training" says what happens next.
  // And a brand-new user must not be greeted, through the blur, by a wall of zeroes telling them
  // they are already behind ("0 of 4 sessions", "0 of 48 working sets"). The week's numbers have
  // nothing to report until there is a week, so they are suppressed until onboarding finishes.
  document.body.classList.add('first-run-open');
  document.getElementById('sheet').showModal();
  setTimeout(()=>document.getElementById('firstRunName')?.focus(),60);
}
function submitFirstRun(nameArg){
  if(!Profiles)return;
  const name=(typeof nameArg==='string'?nameArg:(document.getElementById('firstRunName')?.value||'')).trim()||'Me';
  Profiles.setName(localStorage,activeProfileId,name);
  bootNeedsName=false;
  document.body.classList.remove('first-run-open');
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
// mandatory=true (boot gate for the ACTIVE locked profile): NON-DISMISSIBLE - no × path back to
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
    else pinFail('Wrong PIN - try again');
    return;
  }
  // set mode: confirm the digits match before committing (target bound at render time - P1-4)
  if(!pinContext.first){pinContext.first=entered;pinBuffer='';renderPinSheet('Confirm PIN','Enter the same 4 digits again.');return;}
  if(pinContext.first!==entered){pinContext.first=null;pinBuffer='';renderPinSheet('Set a PIN','Choose a 4-digit PIN for this profile.');showToast('PINs didn’t match - start again');return;}
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
// Render the active profile's data - UNLESS it's locked and not yet unlocked this page-load, in which
// case its data is never rendered until the PIN clears (council: locked = data hidden).
function renderAllViews(){renderToday();renderTrain();renderLibrary();renderProgress();renderReturnChip();}
function afterUnlockBoot(){
  renderAllViews();
  // Flush any queued sessions and pull the latest coach plan on launch - silent, deferred, never blocking.
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
// The mandatory gate is non-dismissible: Escape fires 'cancel' on the dialog - intercept it.
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
  renderProfileChip(); // rename/PIN change elsewhere - refresh the chip only
});
