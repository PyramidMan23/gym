// Mark's home-gym catalogue — every movement maps to equipment he actually owns.
// Equipment strings name his real kit so the library is bespoke.
// Full inventory of record lives in the brain: MarkOS/worlds/gym-biomechanics.md + brain/notes/home-gym-equipment.md
const DUCK_EXERCISES = [
  // ---- Chest ----
  {id:'ch1',name:'Barbell Bench Press',muscle:'Chest',equipment:'Olympic barbell + adjustable bench + G3 rack'},
  {id:'ch2',name:'Incline Barbell Press',muscle:'Chest',equipment:'Olympic barbell + adjustable bench (incline)'},
  {id:'ch3',name:'Dumbbell Bench Press',muscle:'Chest',equipment:'Dumbbells + adjustable bench'},
  {id:'ch4',name:'Incline Dumbbell Press',muscle:'Chest',equipment:'Dumbbells + adjustable bench'},
  {id:'ch5',name:'Smith Machine Bench Press',muscle:'Chest',equipment:'Force USA G3 Smith'},
  {id:'ch6',name:'Cable Fly',muscle:'Chest',equipment:'Upper/lower cables'},
  {id:'ch7',name:'Dumbbell Fly',muscle:'Chest',equipment:'Dumbbells + bench'},
  {id:'ch8',name:'Push-Up',muscle:'Chest',equipment:'Bodyweight'},
  {id:'ch9',name:'BOSU Push-Up',muscle:'Chest',equipment:'BOSU ball'},
  // ---- Back ----
  {id:'ba1',name:'Deadlift',muscle:'Back',equipment:'Olympic barbell + plates'},
  {id:'ba2',name:'Barbell Row',muscle:'Back',equipment:'Olympic barbell'},
  {id:'ba3',name:'Pull-Up',muscle:'Back',equipment:'Pull-up bar'},
  {id:'ba4',name:'Lat Pulldown',muscle:'Back',equipment:'G3 cables (high pulley)'},
  {id:'ba5',name:'Seated Cable Row',muscle:'Back',equipment:'Cables (low pulley)'},
  {id:'ba6',name:'Dumbbell Row',muscle:'Back',equipment:'Dumbbell + bench'},
  {id:'ba7',name:'Chest-Supported DB Row',muscle:'Back',equipment:'Dumbbells + incline bench'},
  {id:'ba8',name:'Smith Machine Row',muscle:'Back',equipment:'Force USA G3 Smith'},
  {id:'ba9',name:'Straight-Arm Pulldown',muscle:'Back',equipment:'Cables'},
  {id:'ba10',name:'Kettlebell Row',muscle:'Back',equipment:'Kettlebell + bench'},
  {id:'ba11',name:'Back Extension',muscle:'Back',equipment:'Back extension bench / Hyper Pro'},
  {id:'ba12',name:'Chin-Up',muscle:'Back',equipment:'Pull-up bar'},
  // ---- Shoulders ----
  {id:'sh1',name:'Overhead Press',muscle:'Shoulders',equipment:'Olympic barbell + G3 rack'},
  {id:'sh2',name:'Seated DB Shoulder Press',muscle:'Shoulders',equipment:'Dumbbells + bench'},
  {id:'sh3',name:'Smith Machine Shoulder Press',muscle:'Shoulders',equipment:'Force USA G3 Smith'},
  {id:'sh4',name:'Dumbbell Lateral Raise',muscle:'Shoulders',equipment:'Dumbbells'},
  {id:'sh5',name:'Cable Lateral Raise',muscle:'Shoulders',equipment:'Cables'},
  {id:'sh6',name:'Rear Delt Fly',muscle:'Shoulders',equipment:'Dumbbells + bench'},
  {id:'sh7',name:'Face Pull',muscle:'Shoulders',equipment:'Cables / resistance band'},
  {id:'sh8',name:'Band Pull-Apart',muscle:'Shoulders',equipment:'Resistance band'},
  {id:'sh9',name:'Kettlebell Overhead Press',muscle:'Shoulders',equipment:'Kettlebell'},
  {id:'sh10',name:'Kettlebell Z-Press',muscle:'Shoulders',equipment:'Kettlebell (seated floor)'},
  // ---- Arms ----
  {id:'ar1',name:'Barbell Curl',muscle:'Arms',equipment:'Olympic / EZ barbell'},
  {id:'ar2',name:'EZ-Bar Curl',muscle:'Arms',equipment:'EZ curl bar'},
  {id:'ar3',name:'Dumbbell Hammer Curl',muscle:'Arms',equipment:'Dumbbells'},
  {id:'ar4',name:'Incline Dumbbell Curl',muscle:'Arms',equipment:'Dumbbells + bench'},
  {id:'ar5',name:'Cable Curl',muscle:'Arms',equipment:'Cables'},
  {id:'ar6',name:'Tricep Pushdown',muscle:'Arms',equipment:'Cables'},
  {id:'ar7',name:'Overhead Cable Tricep Extension',muscle:'Arms',equipment:'Cables'},
  {id:'ar8',name:'EZ-Bar Skull Crusher',muscle:'Arms',equipment:'EZ bar + bench'},
  {id:'ar9',name:'DB Overhead Triceps Extension',muscle:'Arms',equipment:'Dumbbell'},
  {id:'ar10',name:'Close-Grip Bench Press',muscle:'Arms',equipment:'Barbell + bench'},
  {id:'ar11',name:'Dumbbell Kickback',muscle:'Arms',equipment:'Dumbbells'},
  // ---- Grip / Forearms / Climbing ----
  {id:'gr1',name:'Hang Board Max Hangs',muscle:'Grip',equipment:'Rock climbing hang board'},
  {id:'gr2',name:'Hang Board Repeaters',muscle:'Grip',equipment:'Rock climbing hang board'},
  {id:'gr3',name:'Dead Hang',muscle:'Grip',equipment:'Pull-up bar / hang board'},
  {id:'gr4',name:'Wrist Axe Roll-Up',muscle:'Grip',equipment:'Wrist axe'},
  {id:'gr5',name:'Barbell Wrist Curl',muscle:'Grip',equipment:'Barbell + bench'},
  {id:'gr6',name:'Plate Pinch Carry',muscle:'Grip',equipment:'Weight plates'},
  {id:'gr7',name:'Farmer Carry',muscle:'Grip',equipment:'Trap bar / dumbbells / kettlebells'},
  // ---- Legs ----
  {id:'lg1',name:'Back Squat',muscle:'Legs',equipment:'Olympic barbell + G3 rack'},
  {id:'lg2',name:'Front Squat',muscle:'Legs',equipment:'Olympic barbell + G3 rack'},
  {id:'lg3',name:'Smith Machine Squat',muscle:'Legs',equipment:'Force USA G3 Smith'},
  {id:'lg4',name:'Kickstand RDL',muscle:'Legs',equipment:'Olympic barbell (left foot fwd — your pain-free hinge)'},
  {id:'lg5',name:'Romanian Deadlift',muscle:'Legs',equipment:'Olympic barbell'},
  {id:'lg6',name:'Trap Bar Deadlift',muscle:'Legs',equipment:'Trap bar'},
  {id:'lg7',name:'Bulgarian Split Squat',muscle:'Legs',equipment:'Dumbbells + bench'},
  {id:'lg8',name:'ATG Split Squat',muscle:'Legs',equipment:'Bodyweight / dumbbells (KOT style)'},
  {id:'lg9',name:'Goblet Squat',muscle:'Legs',equipment:'Kettlebell / dumbbell'},
  {id:'lg10',name:'Walking Lunge',muscle:'Legs',equipment:'Dumbbells'},
  {id:'lg11',name:'Slant Board Squat',muscle:'Legs',equipment:'Slant board + dumbbell'},
  {id:'lg12',name:'Poliquin Step-Up',muscle:'Legs',equipment:'Adjustable bench / box (KOT knee)'},
  {id:'lg13',name:'Nordic Hamstring Curl',muscle:'Legs',equipment:'Nordic bench / Hyper Pro'},
  {id:'lg14',name:'Lying/Seated Leg Curl',muscle:'Legs',equipment:'Hyper Pro hamstring-curl attachment'},
  {id:'lg15',name:'Barbell Hip Thrust',muscle:'Legs',equipment:'Barbell + bench'},
  {id:'lg16',name:'Kettlebell Swing',muscle:'Legs',equipment:'Kettlebell'},
  {id:'lg17',name:'Standing Calf Raise',muscle:'Legs',equipment:'Slant board / plate'},
  {id:'lg18',name:'Tibialis Raise (Double-Leg)',muscle:'Legs',equipment:'Double-leg tib bar'},
  {id:'lg19',name:'Tibialis Raise (Single-Leg)',muscle:'Legs',equipment:'Single-leg tib bar'},
  {id:'lg20',name:'Reverse Hyper',muscle:'Legs',equipment:'Hyper Pro 11-in-1'},
  {id:'lg21',name:'Single-Leg RDL',muscle:'Legs',equipment:'Dumbbell / kettlebell'},
  {id:'lg22',name:'Belt Squat',muscle:'Legs',equipment:'Hyper Pro belt-squat attachment (spine-sparing)'},
  {id:'lg23',name:'Leg Extension',muscle:'Legs',equipment:'Hyper Pro quad-extension attachment'},
  {id:'lg24',name:'Cable Hip Flexor Raise',muscle:'Legs',equipment:'Cables + ankle strap (right hip flexor)'},
  {id:'lg25',name:'Cable Glute Kickback',muscle:'Legs',equipment:'Cables + ankle strap (right glute)'},
  // ---- Core ----
  {id:'co1',name:'Hanging Leg Raise',muscle:'Core',equipment:'Pull-up bar'},
  {id:'co2',name:'Plank',muscle:'Core',equipment:'Bodyweight'},
  {id:'co3',name:'BOSU Plank',muscle:'Core',equipment:'BOSU ball'},
  {id:'co4',name:'Cable Crunch',muscle:'Core',equipment:'Cables'},
  {id:'co5',name:'Pallof Press',muscle:'Core',equipment:'Cables / resistance band (anti-rotation)'},
  {id:'co6',name:'Cable Woodchop',muscle:'Core',equipment:'Cables'},
  {id:'co7',name:'BOSU Sit-Up',muscle:'Core',equipment:'BOSU ball'},
  {id:'co8',name:'Suitcase Carry',muscle:'Core',equipment:'Kettlebell / dumbbell (anti-lateral)'},
  {id:'co9',name:'Bird Dog',muscle:'Core',equipment:'Bodyweight'},
  // ---- Full Body / Power ----
  {id:'fb1',name:'Kettlebell Clean & Press',muscle:'Full Body',equipment:'Kettlebell'},
  {id:'fb2',name:'Kettlebell Snatch',muscle:'Full Body',equipment:'Kettlebell'},
  {id:'fb3',name:'Turkish Get-Up',muscle:'Full Body',equipment:'Kettlebell'},
  {id:'fb4',name:'Dumbbell Thruster',muscle:'Full Body',equipment:'Dumbbells'},
  {id:'fb5',name:'Kettlebell Thruster',muscle:'Full Body',equipment:'Kettlebell'},
  {id:'fb6',name:'Hang Power Clean',muscle:'Full Body',equipment:'Olympic barbell (light — Oly technique)'},
  // ---- Cardio / Conditioning ----
  {id:'ca1',name:'Skipping Rope',muscle:'Cardio',equipment:'Skipping rope'},
  {id:'ca2',name:'Skipping Rope Intervals',muscle:'Cardio',equipment:'Skipping rope'},
  {id:'ca3',name:'Kettlebell Conditioning Circuit',muscle:'Cardio',equipment:'Kettlebells'},
  {id:'ca4',name:'Burpees',muscle:'Cardio',equipment:'Bodyweight'},
  // ---- Mobility / Prehab ----
  {id:'mo1',name:'Banded Shoulder Dislocates',muscle:'Mobility',equipment:'Resistance band'},
  {id:'mo2',name:'Banded Hip Flexor Stretch',muscle:'Mobility',equipment:'Resistance band (right hip flexor)'},
  {id:'mo3',name:'Banded Monster Walk',muscle:'Mobility',equipment:'Knee band (glute activation)'},
  {id:'mo4',name:'BOSU Balance Hold',muscle:'Mobility',equipment:'BOSU ball'},
  {id:'mo5',name:'Slant Board Ankle Stretch',muscle:'Mobility',equipment:'Slant board'},
  {id:'mo6',name:'Couch Stretch',muscle:'Mobility',equipment:'Bodyweight (hip flexor)'},
  {id:'mo7',name:'90/90 Hip Rotations',muscle:'Mobility',equipment:'Bodyweight (rotation)'}
];

// Single-day quick-starts (Train tab → "Templates"). Every id above.
const GYM_TEMPLATES = [
  { id:'tpl-full',  name:'Full body',    label:'BALANCED',         exerciseIds:['lg9','ch3','ba6','sh2','lg18'] },
  { id:'tpl-upper', name:'Upper body',   label:'CHEST + BACK',     exerciseIds:['ch1','ba3','sh2','ba6','ar2'] },
  { id:'tpl-lower', name:'Leg day',      label:'LOWER BODY',       exerciseIds:['lg7','lg4','lg13','lg18','lg17'] },
  { id:'tpl-push',  name:'Push day',     label:'CHEST + SHOULDERS',exerciseIds:['ch1','sh1','ch6','sh4','ar6'] },
  { id:'tpl-pull',  name:'Pull day',     label:'BACK + BICEPS',    exerciseIds:['ba1','ba4','ba5','sh7','ar2'] },
  { id:'tpl-cond',  name:'Conditioning', label:'CARDIO',           exerciseIds:['ca1','fb1','lg16','gr7'] }
];

// Multi-day plans (Train tab → "Pick a plan"). Applying one installs each day as a ready-to-start routine.
const GYM_PLANS = [
  {
    id:'plan-return', tag:'EASE BACK IN', name:'Return Ramp', goal:3,
    blurb:'Full body ×3 · joint-friendly restart',
    note:'Coming back after a break without flaring up. Unilateral-biased, moderate volume, and it leans on your pain-free kickstand RDL and ATG knee/tibialis work. Build the habit for 2–3 weeks before adding load.',
    days:[
      { name:'Day A · Squat pattern', exerciseIds:['lg22','lg8','lg4','lg18','gr3','mo4'] },
      { name:'Day B · Push / Pull',   exerciseIds:['ch3','ba6','sh2','ba3','sh8','co5'] },
      { name:'Day C · Posterior + carry', exerciseIds:['lg5','lg13','lg7','gr7','lg19','mo2'] }
    ]
  },
  {
    id:'plan-ul', tag:'PREFERRED', name:'Upper / Lower', goal:4,
    blurb:'4 days · upper + lower alternating',
    note:'Your upper/lower split. Alternate the four days across the week (Upper A / Lower A / Upper B / Lower B). Progress load when all sets feel strong.',
    days:[
      { name:'Upper A', exerciseIds:['ch1','ba3','sh2','ba6','ar2','ar6'] },
      { name:'Lower A', exerciseIds:['lg1','lg5','lg7','lg23','lg18','lg17'] },
      { name:'Upper B', exerciseIds:['sh1','ba4','ch4','ba5','sh7','ar3'] },
      { name:'Lower B', exerciseIds:['lg6','lg9','lg13','lg12','co1'] }
    ]
  },
  {
    id:'plan-ppl', tag:'PREFERRED', name:'Push / Pull / Legs', goal:5,
    blurb:'5–6 days · your PPL',
    note:'Your PPL. Run the three days through the week and repeat as time allows (5–6 sessions). Watch pressing volume — back off if the right shoulder starts talking.',
    days:[
      { name:'Push', exerciseIds:['ch1','sh1','ch4','sh4','ch6','ar6','ar9'] },
      { name:'Pull', exerciseIds:['ba1','ba3','ba5','ba9','sh7','ar2','ar3'] },
      { name:'Legs', exerciseIds:['lg1','lg5','lg7','lg13','lg18','lg17','co4'] }
    ]
  },
  {
    id:'plan-atg', tag:'ATG ADD-ON', name:'Knees & Tibialis', goal:2,
    blurb:'2 short sessions · KOT-style',
    note:'Knees-Over-Toes style bulletproofing to pair with any split — two short sessions a week using your tib bars, slant board and hang board. Low load, full range, no ego.',
    days:[
      { name:'Session 1 · Knees',  exerciseIds:['lg8','lg12','lg11','lg24','lg18','lg17','gr3'] },
      { name:'Session 2 · Posterior + tib', exerciseIds:['lg4','lg13','lg25','lg19','ba11','mo5','mo3'] }
    ]
  }
];
