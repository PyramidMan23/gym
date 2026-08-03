// Mark's home-gym catalogue - every movement maps to equipment he actually owns.
// Equipment strings name his real kit so the library is bespoke.
// Full inventory of record lives in the brain: MarkOS/worlds/gym-biomechanics.md + brain/notes/home-gym-equipment.md
//
// Multi-tag data model (council 2026-07-19-council-gym-catalogue). Each entry carries:
//   muscle      - PRIMARY muscle-group category (backward-compat; the library UI groups on this). ALWAYS === muscles[0].
//   muscles[]   - primary + secondary categories, so a lift shows under every muscle it trains.
//   patterns[]  - movement pattern(s) - a filter facet (Row/Hinge/Squat/Vertical Pull…).
//   family      - movement family for grouping/filtering (a facet, NEVER a navigation layer).
//   equip[]     - normalized equipment tags (a facet).
//   equipment   - the human-readable kit string (kept verbatim on existing entries).
// Fixed vocabularies (tests enforce them):
//   muscles  : Chest, Back, Shoulders, Arms, Grip, Legs, Core, Full Body, Cardio, Mobility, Calisthenics, Stretches
//   patterns : Horizontal Push, Vertical Push, Horizontal Pull, Vertical Pull, Squat, Hinge, Lunge, Carry, Anti-Rotation, Rotation, Isolation, Olympic, Conditioning, Mobility
//   equip    : Barbell, EZ Bar, Trap Bar, Dumbbell, Kettlebell, Cable, Smith, Machine, Pull-Up Bar, Bench, Bodyweight, Band, BOSU, Slant Board, Tib Bar, Hang Board, Wrist Axe, Rope, Plate
const DUCK_EXERCISES = [
  // ---- Chest ----
  {id:'ch1',name:'Barbell Bench Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Barbell','Bench'],equipment:'Olympic barbell + adjustable bench + G3 rack'},
  {id:'ch2',name:'Incline Barbell Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Barbell','Bench'],equipment:'Olympic barbell + adjustable bench (incline)'},
  {id:'ch3',name:'Dumbbell Bench Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells + adjustable bench'},
  {id:'ch4',name:'Incline Dumbbell Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells + adjustable bench'},
  {id:'ch5',name:'Smith Machine Bench Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Smith','Bench'],equipment:'Force USA G3 Smith'},
  {id:'ch6',name:'Cable Fly',muscle:'Chest',muscles:['Chest','Shoulders'],patterns:['Isolation'],family:'Fly',equip:['Cable'],equipment:'Upper/lower cables'},
  {id:'ch7',name:'Dumbbell Fly',muscle:'Chest',muscles:['Chest','Shoulders'],patterns:['Isolation'],family:'Fly',equip:['Dumbbell','Bench'],equipment:'Dumbbells + bench'},
  {id:'ch8',name:'Push-Up',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'ch9',name:'BOSU Push-Up',muscle:'Chest',muscles:['Chest','Shoulders','Arms','Core'],patterns:['Horizontal Push'],family:'Push-Up',equip:['BOSU','Bodyweight'],equipment:'BOSU ball'},
  {id:'ch10',name:'Decline Barbell Bench Press',muscle:'Chest',muscles:['Chest','Arms','Shoulders'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Barbell','Bench'],equipment:'Olympic barbell + adjustable bench (decline)'},
  {id:'ch11',name:'Decline Dumbbell Press',muscle:'Chest',muscles:['Chest','Arms','Shoulders'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells + adjustable bench (decline)'},
  {id:'ch12',name:'Low-to-High Cable Fly',muscle:'Chest',muscles:['Chest','Shoulders'],patterns:['Isolation'],family:'Fly',equip:['Cable'],equipment:'G3 lower cables, upward arc (upper chest)'},
  {id:'ch13',name:'High-to-Low Cable Fly',muscle:'Chest',muscles:['Chest'],patterns:['Isolation'],family:'Fly',equip:['Cable'],equipment:'G3 upper cables, downward arc (lower chest)'},
  {id:'ch14',name:'Standing Cable Chest Press',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Chest Press',equip:['Cable'],equipment:'G3 dual cables, standing press'},
  {id:'ch15',name:'Barbell Floor Press',muscle:'Chest',muscles:['Chest','Arms','Shoulders'],patterns:['Horizontal Push'],family:'Floor Press',equip:['Barbell','Plate'],equipment:'Olympic barbell pressed from the floor (lockout/triceps)'},
  {id:'ch16',name:'Dumbbell Floor Press',muscle:'Chest',muscles:['Chest','Arms','Shoulders'],patterns:['Horizontal Push'],family:'Floor Press',equip:['Dumbbell'],equipment:'Dumbbells pressed from the floor'},
  {id:'ch17',name:'Deficit Push-Up',muscle:'Chest',muscles:['Chest','Shoulders','Arms'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Dumbbell','Bodyweight'],equipment:'Hands on dumbbell handles (deeper stretch)'},
  {id:'ch18',name:'Dumbbell Squeeze Press',muscle:'Chest',muscles:['Chest','Arms'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells pressed together on the bench (inner chest)'},
  {id:'ch19',name:'Bar Dip',muscle:'Chest',muscles:['Chest','Arms','Shoulders'],patterns:['Vertical Push'],family:'Dip',equip:['Bodyweight'],equipment:'G3 rack dip handles (or sturdy parallel supports)'},
  // ---- Back ----
  {id:'ba1',name:'Deadlift',muscle:'Back',muscles:['Back','Legs','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Barbell','Plate'],equipment:'Olympic barbell + plates'},
  {id:'ba2',name:'Barbell Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Barbell'],equipment:'Olympic barbell'},
  {id:'ba3',name:'Pull-Up',muscle:'Back',muscles:['Back','Arms','Grip'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'ba4',name:'Lat Pulldown',muscle:'Back',muscles:['Back','Arms'],patterns:['Vertical Pull'],family:'Pulldown',equip:['Cable'],equipment:'G3 cables (high pulley)'},
  {id:'ba5',name:'Seated Cable Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Cable'],equipment:'Cables (low pulley)'},
  {id:'ba6',name:'Dumbbell Row',muscle:'Back',muscles:['Back','Arms','Grip'],patterns:['Horizontal Pull'],family:'Row',equip:['Dumbbell','Bench'],equipment:'Dumbbell + bench'},
  {id:'ba7',name:'Chest-Supported DB Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Dumbbell','Bench'],equipment:'Dumbbells + incline bench'},
  {id:'ba8',name:'Smith Machine Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Smith'],equipment:'Force USA G3 Smith'},
  {id:'ba9',name:'Straight-Arm Pulldown',muscle:'Back',muscles:['Back'],patterns:['Isolation'],family:'Pulldown',equip:['Cable'],equipment:'Cables'},
  {id:'ba10',name:'Kettlebell Row',muscle:'Back',muscles:['Back','Arms','Grip'],patterns:['Horizontal Pull'],family:'Row',equip:['Kettlebell','Bench'],equipment:'Kettlebell + bench'},
  {id:'ba11',name:'Back Extension',muscle:'Back',muscles:['Back','Legs'],patterns:['Hinge'],family:'Back Extension',equip:['Bench','Machine'],equipment:'Back extension bench / Hyper Pro'},
  {id:'ba12',name:'Chin-Up',muscle:'Back',muscles:['Back','Arms','Grip'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'ba13',name:'Pendlay Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Barbell','Plate'],equipment:'Olympic barbell, dead-stop from the floor each rep'},
  {id:'ba15',name:'Single-Arm Cable Row',muscle:'Back',muscles:['Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Cable'],equipment:'G3 low pulley, one arm (rotational lockout)'},
  {id:'ba16',name:'Wide-Grip Seated Cable Row',muscle:'Back',muscles:['Back','Shoulders','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Cable'],equipment:'G3 low pulley, wide bar (upper back)'},
  {id:'ba19',name:'Wide-Grip Pulldown',muscle:'Back',muscles:['Back','Arms'],patterns:['Vertical Pull'],family:'Pulldown',equip:['Cable'],equipment:'G3 high pulley, wide bar'},
  {id:'ba20',name:'Neutral-Grip Pulldown',muscle:'Back',muscles:['Back','Arms'],patterns:['Vertical Pull'],family:'Pulldown',equip:['Cable'],equipment:'G3 high pulley, V-bar (neutral grip)'},
  {id:'ba21',name:'Underhand Pulldown',muscle:'Back',muscles:['Back','Arms'],patterns:['Vertical Pull'],family:'Pulldown',equip:['Cable'],equipment:'Cables (supinated close grip - lower lat / biceps bias)'},
  {id:'ba22',name:'Single-Arm Lat Pulldown',muscle:'Back',muscles:['Back','Arms'],patterns:['Vertical Pull'],family:'Pulldown',equip:['Cable'],equipment:'G3 high pulley, one arm'},
  {id:'ba23',name:'Rack Pull',muscle:'Back',muscles:['Back','Legs','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Barbell','Plate'],equipment:'Olympic barbell from the rack pins (above the knee)'},
  {id:'ba24',name:'Deficit Deadlift',muscle:'Back',muscles:['Back','Legs','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Barbell','Plate'],equipment:'Olympic barbell, standing on a plate (extra range)'},
  {id:'ba25',name:'Snatch-Grip Deadlift',muscle:'Back',muscles:['Back','Legs','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Barbell','Plate'],equipment:'Olympic barbell, wide snatch grip (upper back / traps)'},
  {id:'ba26',name:'Barbell Shrug',muscle:'Back',muscles:['Back','Grip'],patterns:['Isolation'],family:'Shrug',equip:['Barbell','Plate'],equipment:'Olympic barbell (traps)'},
  {id:'ba27',name:'Dumbbell Shrug',muscle:'Back',muscles:['Back','Grip'],patterns:['Isolation'],family:'Shrug',equip:['Dumbbell'],equipment:'Dumbbells (traps)'},
  {id:'ba28',name:'Trap Bar Shrug',muscle:'Back',muscles:['Back','Grip'],patterns:['Isolation'],family:'Shrug',equip:['Trap Bar','Plate'],equipment:'Trap/hex bar (heavy traps)'},
  {id:'ba29',name:'Barbell High Pull',muscle:'Back',muscles:['Back','Shoulders','Grip','Legs'],patterns:['Vertical Pull','Olympic'],family:'High Pull',equip:['Barbell','Plate'],equipment:'Olympic barbell, explosive pull to the chest (upper back / traps)'},
  {id:'ba30',name:'Gorilla Row (Double KB)',muscle:'Back',muscles:['Back','Arms','Grip'],patterns:['Horizontal Pull'],family:'Row',equip:['Kettlebell'],equipment:'Two kettlebells, alternating from the floor'},
  {id:'ba31',name:'Renegade Row',muscle:'Back',muscles:['Back','Core','Arms'],patterns:['Horizontal Pull','Anti-Rotation'],family:'Row',equip:['Dumbbell','Bodyweight'],equipment:'Dumbbells in a plank, alternating rows (anti-rotation)'},
  // ---- Shoulders ----
  {id:'sh1',name:'Overhead Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Barbell'],equipment:'Olympic barbell + G3 rack'},
  {id:'sh2',name:'Seated DB Shoulder Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells + bench'},
  {id:'sh3',name:'Smith Machine Shoulder Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Smith'],equipment:'Force USA G3 Smith'},
  {id:'sh4',name:'Dumbbell Lateral Raise',muscle:'Shoulders',muscles:['Shoulders'],patterns:['Isolation'],family:'Lateral Raise',equip:['Dumbbell'],equipment:'Dumbbells'},
  {id:'sh5',name:'Cable Lateral Raise',muscle:'Shoulders',muscles:['Shoulders'],patterns:['Isolation'],family:'Lateral Raise',equip:['Cable'],equipment:'Cables'},
  {id:'sh6',name:'Rear Delt Fly',muscle:'Shoulders',muscles:['Shoulders','Back'],patterns:['Isolation'],family:'Rear Delt',equip:['Dumbbell','Bench'],equipment:'Dumbbells + bench'},
  {id:'sh7',name:'Face Pull',muscle:'Shoulders',muscles:['Shoulders','Back'],patterns:['Isolation'],family:'Face Pull',equip:['Cable','Band'],equipment:'Cables / resistance band'},
  {id:'sh8',name:'Band Pull-Apart',muscle:'Shoulders',muscles:['Shoulders','Back'],patterns:['Isolation'],family:'Rear Delt',equip:['Band'],equipment:'Resistance band'},
  {id:'sh9',name:'Kettlebell Overhead Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'sh10',name:'Kettlebell Z-Press',muscle:'Shoulders',muscles:['Shoulders','Arms','Core'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Kettlebell'],equipment:'Kettlebell (seated floor)'},
  {id:'sh11',name:'Arnold Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells, rotating press (full-delt sweep)'},
  {id:'sh12',name:'High-Incline Dumbbell Press',muscle:'Shoulders',muscles:['Shoulders','Chest','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Dumbbell','Bench'],equipment:'Dumbbells on a steep incline (front delt / upper chest)'},
  {id:'sh13',name:'Cable Rear Delt Fly',muscle:'Shoulders',muscles:['Shoulders','Back'],patterns:['Isolation'],family:'Rear Delt',equip:['Cable'],equipment:'G3 cables crossed (rear delt)'},
  {id:'sh14',name:'Barbell Upright Row',muscle:'Shoulders',muscles:['Shoulders','Back','Arms'],patterns:['Vertical Pull'],family:'Upright Row',equip:['Barbell','EZ Bar'],equipment:'Olympic / EZ barbell (delts + traps)'},
  {id:'sh15',name:'Cable Upright Row',muscle:'Shoulders',muscles:['Shoulders','Back'],patterns:['Vertical Pull'],family:'Upright Row',equip:['Cable'],equipment:'G3 low pulley, straight bar'},
  {id:'sh16',name:'Kettlebell Push Press',muscle:'Shoulders',muscles:['Shoulders','Arms','Legs'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Kettlebell'],equipment:'Kettlebell(s), leg-drive press'},
  {id:'sh17',name:'Barbell Push Press',muscle:'Shoulders',muscles:['Shoulders','Arms','Legs'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Barbell'],equipment:'Olympic barbell, leg-drive press (overload)'},
  {id:'sh18',name:'Seated Barbell Overhead Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Barbell','Bench'],equipment:'Olympic barbell, seated in the rack (strict)'},
  {id:'sh19',name:'Dumbbell Front Raise',muscle:'Shoulders',muscles:['Shoulders'],patterns:['Isolation'],family:'Front Raise',equip:['Dumbbell'],equipment:'Dumbbells (front delt)'},
  {id:'sh20',name:'Cable Front Raise',muscle:'Shoulders',muscles:['Shoulders'],patterns:['Isolation'],family:'Front Raise',equip:['Cable'],equipment:'G3 low pulley (front delt)'},
  {id:'sh21',name:'Leaning Cable Lateral Raise',muscle:'Shoulders',muscles:['Shoulders'],patterns:['Isolation'],family:'Lateral Raise',equip:['Cable'],equipment:'G3 low pulley, leaning away (constant tension)'},
  {id:'sh22',name:'Bradford Press',muscle:'Shoulders',muscles:['Shoulders','Arms'],patterns:['Vertical Push'],family:'Overhead Press',equip:['Barbell'],equipment:'Olympic barbell, front-to-back over the head (constant-tension delts)'},
  // ---- Arms ----
  {id:'ar1',name:'Barbell Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Barbell','EZ Bar'],equipment:'Olympic / EZ barbell'},
  {id:'ar2',name:'EZ-Bar Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['EZ Bar'],equipment:'EZ curl bar'},
  {id:'ar3',name:'Dumbbell Hammer Curl',muscle:'Arms',muscles:['Arms','Grip'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell'],equipment:'Dumbbells'},
  {id:'ar4',name:'Incline Dumbbell Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell','Bench'],equipment:'Dumbbells + bench'},
  {id:'ar5',name:'Cable Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Cable'],equipment:'Cables'},
  {id:'ar6',name:'Tricep Pushdown',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['Cable'],equipment:'Cables'},
  {id:'ar7',name:'Overhead Cable Tricep Extension',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['Cable'],equipment:'Cables'},
  {id:'ar8',name:'EZ-Bar Skull Crusher',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['EZ Bar','Bench'],equipment:'EZ bar + bench'},
  {id:'ar9',name:'DB Overhead Triceps Extension',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['Dumbbell'],equipment:'Dumbbell'},
  {id:'ar10',name:'Close-Grip Bench Press',muscle:'Arms',muscles:['Arms','Chest','Shoulders'],patterns:['Horizontal Push'],family:'Bench Press',equip:['Barbell','Bench'],equipment:'Barbell + bench'},
  {id:'ar11',name:'Dumbbell Kickback',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['Dumbbell'],equipment:'Dumbbells'},
  {id:'ar12',name:'Preacher Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['EZ Bar','Bench'],equipment:'EZ bar over the incline bench back-pad (preacher)'},
  {id:'ar13',name:'Spider Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell','Bench'],equipment:'Dumbbells, chest-down on the incline bench'},
  {id:'ar14',name:'Concentration Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell','Bench'],equipment:'Single dumbbell, elbow braced on the thigh'},
  {id:'ar15',name:'Reverse Curl',muscle:'Arms',muscles:['Arms','Grip'],patterns:['Isolation'],family:'Curl',equip:['EZ Bar'],equipment:'EZ bar, overhand grip (brachioradialis / forearm)'},
  {id:'ar16',name:'Cable Rope Hammer Curl',muscle:'Arms',muscles:['Arms','Grip'],patterns:['Isolation'],family:'Curl',equip:['Cable'],equipment:'G3 low pulley, rope (neutral grip)'},
  {id:'ar17',name:'Rope Triceps Pushdown',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Triceps Extension',equip:['Cable'],equipment:'G3 high pulley, rope (spread at the bottom)'},
  {id:'ar18',name:'JM Press',muscle:'Arms',muscles:['Arms','Chest'],patterns:['Horizontal Push'],family:'Triceps Extension',equip:['EZ Bar','Bench'],equipment:'EZ bar, close-grip press / skull-crusher hybrid'},
  {id:'ar19',name:'Zottman Curl',muscle:'Arms',muscles:['Arms','Grip'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell'],equipment:'Dumbbells, curl up / reverse down (biceps + forearm)'},
  {id:'ar20',name:'Diamond Push-Up',muscle:'Arms',muscles:['Arms','Chest'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight, hands together (triceps)'},
  {id:'ar21',name:'Bench Dip',muscle:'Arms',muscles:['Arms','Chest','Shoulders'],patterns:['Vertical Push'],family:'Dip',equip:['Bench','Bodyweight'],equipment:'Hands on one bench, feet on another (triceps)'},
  {id:'ar22',name:'Dumbbell Curl',muscle:'Arms',muscles:['Arms'],patterns:['Isolation'],family:'Curl',equip:['Dumbbell'],equipment:'Dumbbells, supinated (the plain two-arm curl)'},
  // ---- Grip / Forearms / Climbing ----
  {id:'gr1',timed:true,name:'Hang Board Max Hangs',muscle:'Grip',muscles:['Grip'],patterns:['Isolation'],family:'Hang',equip:['Hang Board'],equipment:'Rock climbing hang board'},
  {id:'gr2',timed:true,name:'Hang Board Repeaters',muscle:'Grip',muscles:['Grip'],patterns:['Isolation'],family:'Hang',equip:['Hang Board'],equipment:'Rock climbing hang board'},
  {id:'gr3',timed:true,name:'Dead Hang',muscle:'Grip',muscles:['Grip','Back'],patterns:['Isolation'],family:'Hang',equip:['Pull-Up Bar','Hang Board'],equipment:'Pull-up bar / hang board'},
  {id:'gr4',name:'Wrist Axe Roll-Up',muscle:'Grip',muscles:['Grip'],patterns:['Isolation'],family:'Wrist',equip:['Wrist Axe'],equipment:'Wrist axe'},
  {id:'gr5',name:'Barbell Wrist Curl',muscle:'Grip',muscles:['Grip'],patterns:['Isolation'],family:'Wrist',equip:['Barbell','Bench'],equipment:'Barbell + bench'},
  {id:'gr6',timed:true,name:'Plate Pinch Carry',muscle:'Grip',muscles:['Grip'],patterns:['Carry'],family:'Carry',equip:['Plate'],equipment:'Weight plates'},
  {id:'gr7',timed:true,name:'Farmer Carry',muscle:'Grip',muscles:['Grip','Core','Legs'],patterns:['Carry'],family:'Carry',equip:['Trap Bar','Dumbbell','Kettlebell'],equipment:'Trap bar / dumbbells / kettlebells'},
  {id:'gr8',name:'Reverse Wrist Curl',muscle:'Grip',muscles:['Grip'],patterns:['Isolation'],family:'Wrist',equip:['Barbell','Bench'],equipment:'Olympic / EZ bar, overhand (wrist extensors)'},
  {id:'gr9',name:'Hang Board Pull-Up',muscle:'Grip',muscles:['Grip','Back','Arms'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Hang Board'],equipment:'Pull-ups on the climbing hang board edges (finger strength)'},
  {id:'gr10',timed:true,name:'Kettlebell Bottoms-Up Carry',muscle:'Grip',muscles:['Grip','Core','Shoulders'],patterns:['Carry'],family:'Carry',equip:['Kettlebell'],equipment:'Kettlebell held upside-down (grip + shoulder stability)'},
  // Carries are the cheapest anti-rotation work there is and the kit is already owned: 4 entries
  // was thin for a pattern this useful to a right-sided chain (2026-07-28).
  {id:'gr11',timed:true,name:'Offset Carry',muscle:'Grip',muscles:['Grip','Core','Shoulders'],patterns:['Carry','Anti-Rotation'],family:'Carry',equip:['Kettlebell','Dumbbell'],equipment:'One bell overhead, one at the side: swap sides each set (tag L/R)'},
  {id:'gr12',timed:true,name:'Overhead Carry',muscle:'Grip',muscles:['Grip','Shoulders','Core'],patterns:['Carry'],family:'Carry',equip:['Kettlebell','Dumbbell'],equipment:'Locked out overhead, ribs down (tag L/R for single-arm)'},
  {id:'gr13',timed:true,name:'Front Rack Carry',muscle:'Grip',muscles:['Grip','Core','Shoulders'],patterns:['Carry'],family:'Carry',equip:['Kettlebell','Dumbbell'],equipment:'Bells in the front rack, elbows up (anti-flexion)'},
  {id:'gr14',timed:true,name:'Trap Bar Carry',muscle:'Grip',muscles:['Grip','Back','Legs'],patterns:['Carry'],family:'Carry',equip:['Trap Bar','Plate'],equipment:'Loaded trap bar, walk it: the heaviest carry the home gym allows'},
  // ---- Legs ----
  {id:'lg1',name:'Back Squat',muscle:'Legs',muscles:['Legs','Core'],patterns:['Squat'],family:'Squat',equip:['Barbell'],equipment:'Olympic barbell + G3 rack'},
  {id:'lg2',name:'Front Squat',muscle:'Legs',muscles:['Legs','Core'],patterns:['Squat'],family:'Squat',equip:['Barbell'],equipment:'Olympic barbell + G3 rack'},
  {id:'lg3',name:'Smith Machine Squat',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Smith'],equipment:'Force USA G3 Smith'},
  {id:'lg4',name:'Kickstand RDL',muscle:'Legs',muscles:['Legs','Back'],patterns:['Hinge'],family:'RDL',equip:['Barbell'],equipment:'Olympic barbell (left foot fwd - your pain-free hinge)'},
  {id:'lg5',name:'Romanian Deadlift',muscle:'Legs',muscles:['Legs','Back'],patterns:['Hinge'],family:'RDL',equip:['Barbell'],equipment:'Olympic barbell'},
  {id:'lg6',name:'Trap Bar Deadlift',muscle:'Legs',muscles:['Legs','Back','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Trap Bar','Plate'],equipment:'Trap bar'},
  {id:'lg7',name:'Bulgarian Split Squat',muscle:'Legs',muscles:['Legs','Core'],patterns:['Lunge'],family:'Split Squat',equip:['Dumbbell','Bench'],equipment:'Dumbbells + bench'},
  {id:'lg8',name:'ATG Split Squat',muscle:'Legs',muscles:['Legs'],patterns:['Lunge'],family:'Split Squat',equip:['Bodyweight','Dumbbell'],equipment:'Bodyweight / dumbbells (KOT style)'},
  {id:'lg9',name:'Goblet Squat',muscle:'Legs',muscles:['Legs','Core'],patterns:['Squat'],family:'Squat',equip:['Kettlebell','Dumbbell'],equipment:'Kettlebell / dumbbell'},
  {id:'lg10',name:'Walking Lunge',muscle:'Legs',muscles:['Legs','Core'],patterns:['Lunge'],family:'Lunge',equip:['Dumbbell'],equipment:'Dumbbells'},
  {id:'lg11',name:'Slant Board Squat',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Slant Board','Dumbbell'],equipment:'Slant board + dumbbell'},
  {id:'lg12',name:'Poliquin Step-Up',muscle:'Legs',muscles:['Legs'],patterns:['Lunge'],family:'Step-Up',equip:['Bench'],equipment:'Adjustable bench / box (KOT knee)'},
  {id:'lg13',name:'Nordic Hamstring Curl',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Leg Curl',equip:['Bench','Machine'],equipment:'Nordic bench / Hyper Pro'},
  {id:'lg14',name:'Lying/Seated Leg Curl',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Leg Curl',equip:['Machine'],equipment:'Hyper Pro hamstring-curl attachment'},
  {id:'lg15',name:'Barbell Hip Thrust',muscle:'Legs',muscles:['Legs'],patterns:['Hinge'],family:'Hip Thrust',equip:['Barbell','Bench'],equipment:'Barbell + bench'},
  {id:'lg16',name:'Kettlebell Swing',muscle:'Legs',muscles:['Legs','Back'],patterns:['Hinge'],family:'Swing',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'lg17',name:'Standing Calf Raise',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Calf',equip:['Slant Board','Plate'],equipment:'Slant board / plate'},
  {id:'lg18',name:'Tibialis Raise (DL)',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Tibialis',equip:['Tib Bar'],equipment:'Double-leg tib bar'},
  {id:'lg19',name:'Tibialis Raise (SL)',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Tibialis',equip:['Tib Bar'],equipment:'Single-leg tib bar'},
  {id:'lg20',name:'Reverse Hyper',muscle:'Legs',muscles:['Legs','Back'],patterns:['Hinge'],family:'Reverse Hyper',equip:['Machine'],equipment:'Hyper Pro 11-in-1'},
  {id:'lg21',name:'Single-Leg RDL',muscle:'Legs',muscles:['Legs','Core','Back'],patterns:['Hinge'],family:'RDL',equip:['Dumbbell','Kettlebell'],equipment:'Dumbbell / kettlebell'},
  {id:'lg22',name:'Belt Squat',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Machine'],equipment:'Hyper Pro belt-squat attachment (spine-sparing)'},
  {id:'lg23',name:'Leg Extension',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Leg Extension',equip:['Machine'],equipment:'Hyper Pro quad-extension attachment'},
  {id:'lg24',name:'Cable Hip Flexor Raise',muscle:'Legs',muscles:['Legs','Core'],patterns:['Isolation'],family:'Hip Flexor',equip:['Cable'],equipment:'Cables + ankle strap (right hip flexor)'},
  {id:'lg25',name:'Cable Glute Kickback',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Glute Kickback',equip:['Cable'],equipment:'Cables + ankle strap (right glute)'},
  {id:'lg26',name:'Sumo Deadlift',muscle:'Legs',muscles:['Legs','Back','Grip'],patterns:['Hinge'],family:'Deadlift',equip:['Barbell','Plate'],equipment:'Olympic barbell, wide sumo stance (adductor / glute)'},
  {id:'lg27',name:'Sumo Squat',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Dumbbell','Kettlebell'],equipment:'Wide stance, single dumbbell held low (adductor / glute)'},
  {id:'lg28',name:'Smith Machine Hack Squat',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Smith'],equipment:'Force USA G3 Smith, feet forward, back on the bar (hack-style quad)'},
  {id:'lg29',name:'Reverse Lunge',muscle:'Legs',muscles:['Legs','Core'],patterns:['Lunge'],family:'Lunge',equip:['Dumbbell'],equipment:'Dumbbells, stepping back (knee-friendly)'},
  {id:'lg30',name:'Curtsy Lunge',muscle:'Legs',muscles:['Legs'],patterns:['Lunge'],family:'Lunge',equip:['Dumbbell'],equipment:'Dumbbells, crossing behind (glute med)'},
  {id:'lg31',name:'Cossack Squat',muscle:'Legs',muscles:['Legs','Mobility'],patterns:['Squat'],family:'Squat',equip:['Bodyweight','Kettlebell'],equipment:'Side-to-side deep squat (adductor / mobility)'},
  {id:'lg32',name:'Belt-Squat Single-Leg',muscle:'Legs',muscles:['Legs'],patterns:['Squat'],family:'Squat',equip:['Machine'],equipment:'Hyper Pro belt squat, one leg (spine-sparing single-leg)'},
  {id:'lg34',name:'Cable Pull-Through',muscle:'Legs',muscles:['Legs','Back'],patterns:['Hinge'],family:'Pull-Through',equip:['Cable'],equipment:'G3 low pulley between the legs (glute / hinge)'},
  {id:'lg35',name:'Single-Leg Hip Thrust',muscle:'Legs',muscles:['Legs','Core'],patterns:['Hinge'],family:'Hip Thrust',equip:['Bench','Bodyweight'],equipment:'One leg, shoulders on the bench'},
  {id:'lg36',name:'Dumbbell Step-Up',muscle:'Legs',muscles:['Legs','Core'],patterns:['Lunge'],family:'Step-Up',equip:['Dumbbell','Bench'],equipment:'Dumbbells onto the bench (unilateral)'},
  {id:'lg37',name:'Zercher Squat',muscle:'Legs',muscles:['Legs','Core','Arms'],patterns:['Squat'],family:'Squat',equip:['Barbell'],equipment:'Olympic barbell in the elbows (upper-back / core carryover)'},
  {id:'lg38',name:'Cable Hip Adduction',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Adduction',equip:['Cable','Band'],equipment:'G3 low pulley, ankle strap (inner thigh)'},
  {id:'lg39',name:'Cable Hip Abduction',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Abduction',equip:['Cable','Band'],equipment:'G3 low pulley / band, ankle strap (glute med)'},
  {id:'lg40',name:'Seated Calf Raise',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Calf',equip:['Dumbbell','Slant Board','Bench'],equipment:'Seated, dumbbell on the knees (soleus)'},
  {id:'lg41',name:'Reverse Nordic Curl',muscle:'Legs',muscles:['Legs'],patterns:['Isolation'],family:'Leg Extension',equip:['Machine','Bodyweight'],equipment:'Hyper Pro Nordic bench (quad eccentric - KOT knee)'},
  {id:'lg42',name:'Trap Bar RDL',muscle:'Legs',muscles:['Legs','Back','Grip'],patterns:['Hinge'],family:'RDL',equip:['Trap Bar','Plate'],equipment:'Trap bar, high handles (hips back, spine neutral)'},
  {id:'lg43',name:'Banded Glute Bridge',muscle:'Legs',muscles:['Legs','Core'],patterns:['Hinge'],family:'Hip Thrust',equip:['Barbell','Band','Plate'],equipment:'Olympic bar across the hips + heavy band around the knees (shoulders on the floor)'},
  // ---- Core ----
  {id:'co1',name:'Hanging Leg Raise',muscle:'Core',muscles:['Core','Grip','Legs'],patterns:['Isolation'],family:'Leg Raise',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'co2',timed:true,name:'Plank',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Plank',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'co3',timed:true,name:'BOSU Plank',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Plank',equip:['BOSU','Bodyweight'],equipment:'BOSU ball'},
  {id:'co4',name:'Cable Crunch',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Crunch',equip:['Cable'],equipment:'Cables'},
  {id:'co5',name:'Pallof Press',muscle:'Core',muscles:['Core'],patterns:['Anti-Rotation'],family:'Anti-Rotation',equip:['Cable','Band'],equipment:'Cables / resistance band (anti-rotation)'},
  {id:'co6',name:'Cable Woodchop',muscle:'Core',muscles:['Core'],patterns:['Rotation'],family:'Woodchop',equip:['Cable'],equipment:'Cables'},
  {id:'co7',name:'BOSU Sit-Up',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Crunch',equip:['BOSU','Bodyweight'],equipment:'BOSU ball'},
  {id:'co8',timed:true,name:'Suitcase Carry',muscle:'Core',muscles:['Core','Grip','Legs'],patterns:['Carry'],family:'Carry',equip:['Kettlebell','Dumbbell'],equipment:'Kettlebell / dumbbell (anti-lateral)'},
  {id:'co9',name:'Bird Dog',muscle:'Core',muscles:['Core'],patterns:['Anti-Rotation'],family:'Bird Dog',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'co21',name:'Garhammer Raise',muscle:'Core',muscles:['Core','Legs'],patterns:['Isolation'],family:'Leg Raise',equip:['Pull-Up Bar','Band','Bodyweight'],equipment:'Elbows supported in ab straps or a band cradle, knees driven up in a short arc (lower abs)'},
  {id:'co10',name:'Hanging Knee Raise',muscle:'Core',muscles:['Core','Grip','Legs'],patterns:['Isolation'],family:'Leg Raise',equip:['Pull-Up Bar'],equipment:'Pull-up bar, knees to chest (leg-raise regression)'},
  {id:'co11',name:'Dragon Flag (Tuck)',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Dragon Flag',equip:['Bench','Bodyweight'],equipment:'Lying on the bench, gripping behind the head (tuck progression)'},
  {id:'co12',name:'Full Dragon Flag',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Dragon Flag',equip:['Bench','Bodyweight'],equipment:'Straight-body lower on the bench (advanced)'},
  {id:'co13',name:'Russian Twist',muscle:'Core',muscles:['Core'],patterns:['Rotation'],family:'Russian Twist',equip:['Plate','Kettlebell','Bodyweight'],equipment:'Seated, plate or kettlebell (rotation)'},
  {id:'co14',name:'Weighted Decline Sit-Up',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Crunch',equip:['Bench','Plate'],equipment:'Adjustable bench declined, plate on the chest'},
  {id:'co15',timed:true,name:'Copenhagen Plank',muscle:'Core',muscles:['Core','Legs'],patterns:['Isolation'],family:'Plank',equip:['Bench','Bodyweight'],equipment:'Side plank, top leg on the bench (adductor + oblique)'},
  {id:'co16',name:'Barbell Rollout',muscle:'Core',muscles:['Core'],patterns:['Isolation'],family:'Rollout',equip:['Barbell','Plate'],equipment:'Loaded barbell rolled out from the knees (anti-extension)'},
  // Rotation held just 2 of 243 exercises, in an app built around a right-sided ROTATIONAL chain -
  // the library could barely express the thing it exists to work on (2026-07-28).
  {id:'co17',name:'Half-Kneeling Cable Chop',muscle:'Core',muscles:['Core','Shoulders'],patterns:['Rotation'],family:'Woodchop',equip:['Cable'],equipment:'G3 upper cable, half-kneeling, high-to-low (tag L/R per set)'},
  {id:'co18',name:'Half-Kneeling Cable Lift',muscle:'Core',muscles:['Core','Shoulders'],patterns:['Rotation'],family:'Woodchop',equip:['Cable'],equipment:'G3 lower cable, half-kneeling, low-to-high (tag L/R per set)'},
  {id:'co19',name:'Banded Standing Rotation',muscle:'Core',muscles:['Core'],patterns:['Rotation'],family:'Woodchop',equip:['Band'],equipment:'Band anchored at chest height, feet planted, rotate through the trunk'},
  {id:'co20',name:'Half-Kneeling Pallof Press',muscle:'Core',muscles:['Core'],patterns:['Anti-Rotation'],family:'Anti-Rotation',equip:['Cable','Band'],equipment:'Cable or band, half-kneeling: the hips can’t cheat the way they do standing'},
  // ---- Full Body / Power ----
  {id:'fb1',name:'Kettlebell Clean & Press',muscle:'Full Body',muscles:['Full Body','Shoulders','Legs'],patterns:['Olympic'],family:'Clean',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'fb2',name:'Kettlebell Snatch',muscle:'Full Body',muscles:['Full Body','Shoulders','Legs'],patterns:['Olympic'],family:'Snatch',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'fb3',name:'Turkish Get-Up',muscle:'Full Body',muscles:['Full Body','Core','Shoulders'],patterns:['Anti-Rotation'],family:'Get-Up',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'fb4',name:'Dumbbell Thruster',muscle:'Full Body',muscles:['Full Body','Legs','Shoulders'],patterns:['Squat','Vertical Push'],family:'Thruster',equip:['Dumbbell'],equipment:'Dumbbells'},
  {id:'fb5',name:'Kettlebell Thruster',muscle:'Full Body',muscles:['Full Body','Legs','Shoulders'],patterns:['Squat','Vertical Push'],family:'Thruster',equip:['Kettlebell'],equipment:'Kettlebell'},
  {id:'fb6',name:'Hang Power Clean',muscle:'Full Body',muscles:['Full Body','Legs','Back'],patterns:['Olympic'],family:'Clean',equip:['Barbell'],equipment:'Olympic barbell (light - Oly technique)'},
  {id:'fb7',name:'Barbell Clean & Press',muscle:'Full Body',muscles:['Full Body','Legs','Shoulders'],patterns:['Olympic'],family:'Clean',equip:['Barbell','Plate'],equipment:'Olympic barbell, floor to overhead'},
  {id:'fb8',name:'Kettlebell Clean',muscle:'Full Body',muscles:['Full Body','Legs','Back'],patterns:['Olympic'],family:'Clean',equip:['Kettlebell'],equipment:'Kettlebell, floor to rack (single)'},
  {id:'fb9',name:'Dumbbell Snatch',muscle:'Full Body',muscles:['Full Body','Legs','Shoulders'],patterns:['Olympic'],family:'Snatch',equip:['Dumbbell'],equipment:'Single dumbbell, floor to overhead'},
  {id:'fb10',name:'Man Maker',muscle:'Full Body',muscles:['Full Body','Cardio'],patterns:['Conditioning'],family:'Thruster',equip:['Dumbbell','Bodyweight'],equipment:'Dumbbell renegade row → clean → thruster (complex)'},
  {id:'fb11',name:'Devil’s Press',muscle:'Full Body',muscles:['Full Body','Cardio'],patterns:['Conditioning'],family:'Snatch',equip:['Dumbbell','Bodyweight'],equipment:'Dumbbell burpee into overhead (conditioning)'},
  // ---- Cardio / Conditioning ----
  {id:'ca1',name:'Skipping Rope',muscle:'Cardio',muscles:['Cardio'],patterns:['Conditioning'],family:'Conditioning',equip:['Rope'],equipment:'Skipping rope'},
  {id:'ca2',name:'Skipping Rope Intervals',muscle:'Cardio',muscles:['Cardio'],patterns:['Conditioning'],family:'Conditioning',equip:['Rope'],equipment:'Skipping rope'},
  {id:'ca3',name:'Kettlebell Conditioning Circuit',muscle:'Cardio',muscles:['Cardio','Full Body'],patterns:['Conditioning'],family:'Conditioning',equip:['Kettlebell'],equipment:'Kettlebells'},
  {id:'ca4',name:'Burpees',muscle:'Cardio',muscles:['Cardio','Full Body'],patterns:['Conditioning'],family:'Conditioning',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'ca5',name:'Double-Under Skipping',muscle:'Cardio',muscles:['Cardio'],patterns:['Conditioning'],family:'Conditioning',equip:['Rope'],equipment:'Skipping rope passing twice per jump (advanced)'},
  {id:'ca6',name:'Mountain Climbers',muscle:'Cardio',muscles:['Cardio','Core'],patterns:['Conditioning'],family:'Conditioning',equip:['Bodyweight'],equipment:'Floor, driving the knees (conditioning + core)'},
  {id:'ca7',name:'Jumping Jacks',muscle:'Cardio',muscles:['Cardio'],patterns:['Conditioning'],family:'Conditioning',equip:['Bodyweight'],equipment:'Bodyweight (warm-up conditioning)'},
  // ---- Mobility / Prehab ----
  {id:'mo1',name:'Banded Shoulder Dislocates',muscle:'Mobility',muscles:['Mobility','Shoulders'],patterns:['Mobility'],family:'Mobility',equip:['Band'],equipment:'Resistance band'},
  {id:'mo2',timed:true,name:'Banded Hip Flexor Stretch',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Band'],equipment:'Resistance band (right hip flexor)'},
  {id:'mo3',name:'Banded Monster Walk',muscle:'Mobility',muscles:['Mobility','Legs'],patterns:['Mobility'],family:'Mobility',equip:['Band'],equipment:'Knee band (glute activation)'},
  {id:'mo4',timed:true,name:'BOSU Balance Hold',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Balance',equip:['BOSU'],equipment:'BOSU ball'},
  {id:'mo5',timed:true,name:'Slant Board Ankle Stretch',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Slant Board'],equipment:'Slant board'},
  {id:'mo6',timed:true,name:'Couch Stretch',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Bodyweight (hip flexor)'},
  {id:'mo7',name:'90/90 Hip Rotations',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Mobility',equip:['Bodyweight'],equipment:'Bodyweight (rotation)'},
  {id:'mo8',name:'World’s Greatest Stretch',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Mobility',equip:['Bodyweight'],equipment:'Lunge + rotation flow (full-body warm-up)'},
  {id:'mo9',name:'Wall Slides',muscle:'Mobility',muscles:['Mobility','Shoulders'],patterns:['Mobility'],family:'Mobility',equip:['Bodyweight'],equipment:'Back to the wall, arms sliding overhead (shoulder mobility)'},
  {id:'mo10',name:'Thoracic Extension over Bench',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Mobility',equip:['Bench'],equipment:'Upper back over the bench edge (t-spine extension)'},
  {id:'mo11',timed:true,name:'Banded Ankle Distraction',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Mobility',equip:['Band'],equipment:'Band around the ankle, knee drives forward (dorsiflexion)'},
  {id:'mo12',name:'Jefferson Curl',muscle:'Mobility',muscles:['Mobility','Legs','Back'],patterns:['Mobility'],family:'Stretch',equip:['Dumbbell','Bench'],equipment:'Light dumbbell, slow spinal roll-down (loaded hamstring / spine mobility)'},
  // Desk-posture drills (2026-07-28): the load a 10-hour laptop day actually accumulates.
  {id:'mo13',name:'Prone Y-T-W Raise',muscle:'Mobility',muscles:['Mobility','Back','Shoulders'],patterns:['Mobility'],family:'Scapular',equip:['Bench','Bodyweight'],equipment:'Face-down on the incline bench, no weight: Y then T then W'},
  {id:'mo14',timed:true,name:'Chin Tuck Hold',muscle:'Mobility',muscles:['Mobility'],patterns:['Mobility'],family:'Scapular',equip:['Bodyweight'],equipment:'Back to a wall, chin drawn straight back (deep neck flexors: the forward-head antidote)'},
  {id:'mo15',name:'Open Book Rotation',muscle:'Mobility',muscles:['Mobility','Back'],patterns:['Mobility','Rotation'],family:'Stretch',equip:['Bodyweight'],equipment:'Side-lying, knees stacked, top arm opens across (t-spine rotation)'},
  // ---- Calisthenics (bodyweight families incl. regressions; advanced moves labelled) ----
  {id:'cs1',name:'Scapular Pull-Up',muscle:'Calisthenics',muscles:['Calisthenics','Back'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'cs2',name:'Band-Assisted Pull-Up',muscle:'Calisthenics',muscles:['Calisthenics','Back','Arms'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar','Band'],equipment:'Pull-up bar + resistance band'},
  {id:'cs3',name:'Negative Pull-Up',muscle:'Calisthenics',muscles:['Calisthenics','Back','Arms'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'cs4',timed:true,name:'Chin-Over-Bar Hold',muscle:'Calisthenics',muscles:['Calisthenics','Back','Grip'],patterns:['Vertical Pull'],family:'Pull-Up',equip:['Pull-Up Bar'],equipment:'Pull-up bar'},
  {id:'cs5',name:'Inverted Row (Rack Bar)',muscle:'Calisthenics',muscles:['Calisthenics','Back','Arms'],patterns:['Horizontal Pull'],family:'Row',equip:['Barbell','Bodyweight'],equipment:'Barbell in G3 rack'},
  {id:'cs6',name:'Incline Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Arms'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bench','Bodyweight'],equipment:'Bench (hands elevated)'},
  {id:'cs7',name:'Knee Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Arms'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'cs8',name:'Scapular Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Shoulders'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'cs9',name:'Pike Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Shoulders','Arms'],patterns:['Vertical Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight (advanced)'},
  {id:'cs10',name:'Archer Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Arms'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Bodyweight (advanced)'},
  {id:'cs11',timed:true,name:'Wall Handstand Hold',muscle:'Calisthenics',muscles:['Calisthenics','Shoulders'],patterns:['Vertical Push'],family:'Handstand',equip:['Bodyweight'],equipment:'Wall (advanced)'},
  {id:'cs12',name:'Bodyweight ATG Split Squat',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Lunge'],family:'Split Squat',equip:['Bodyweight'],equipment:'Bodyweight (KOT style)'},
  {id:'cs13',name:'Supported Split Squat',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Lunge'],family:'Split Squat',equip:['Band','Bodyweight'],equipment:'Rack upright / band for support'},
  {id:'cs14',name:'Step-Up',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Lunge'],family:'Step-Up',equip:['Bench','Bodyweight'],equipment:'Bench / box'},
  {id:'cs15',name:'Glute Bridge',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Hinge'],family:'Bridge',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs16',name:'Single-Leg Glute Bridge',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Hinge'],family:'Bridge',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs17',name:'Hamstring Walkout',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Hinge'],family:'Bridge',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs18',timed:true,name:'Wall Sit',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Squat'],family:'Wall Sit',equip:['Bodyweight'],equipment:'Wall'},
  {id:'cs19',timed:true,name:'Hollow Hold',muscle:'Calisthenics',muscles:['Calisthenics','Core'],patterns:['Isolation'],family:'Hollow',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs20',name:'Dead Bug',muscle:'Calisthenics',muscles:['Calisthenics','Core'],patterns:['Anti-Rotation'],family:'Dead Bug',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs21',timed:true,name:'Side Plank',muscle:'Calisthenics',muscles:['Calisthenics','Core'],patterns:['Isolation'],family:'Plank',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs22',name:'Bear Crawl',muscle:'Calisthenics',muscles:['Calisthenics','Core','Cardio'],patterns:['Conditioning'],family:'Crawl',equip:['Bodyweight'],equipment:'Floor'},
  {id:'cs23',timed:true,name:'Hanging Tuck L-Sit',muscle:'Calisthenics',muscles:['Calisthenics','Core','Grip'],patterns:['Isolation'],family:'L-Sit',equip:['Pull-Up Bar'],equipment:'Pull-up bar (advanced)'},
  {id:'cs24',name:'Broad Jump',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Squat'],family:'Jump',equip:['Bodyweight'],equipment:'Bodyweight (advanced - knee load)'},
  {id:'cs25',name:'Single-Leg Calf Raise',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Isolation'],family:'Calf',equip:['Bodyweight','Slant Board'],equipment:'Step / slant board'},
  {id:'cs26',name:'Decline Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Shoulders'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bench','Bodyweight'],equipment:'Feet on the bench (upper-chest / shoulder emphasis)'},
  {id:'cs27',name:'Pseudo-Planche Push-Up',muscle:'Calisthenics',muscles:['Calisthenics','Chest','Shoulders'],patterns:['Horizontal Push'],family:'Push-Up',equip:['Bodyweight'],equipment:'Hands low, leaning forward (advanced)'},
  {id:'cs28',name:'Assisted Pistol Squat',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Squat'],family:'Squat',equip:['Band','Bodyweight'],equipment:'Single-leg squat, band or rack for support'},
  {id:'cs29',timed:true,name:'Superman Hold',muscle:'Calisthenics',muscles:['Calisthenics','Back'],patterns:['Hinge'],family:'Back Extension',equip:['Bodyweight'],equipment:'Prone, lifting chest and legs (spinal erectors)'},
  {id:'cs30',name:'Prone Y-T-W Raise',muscle:'Calisthenics',muscles:['Calisthenics','Shoulders','Back'],patterns:['Isolation'],family:'Rear Delt',equip:['Bodyweight'],equipment:'Prone Y-T-W raises (lower-trap / rear delt)'},
  {id:'cs31',name:'Jump Squat',muscle:'Calisthenics',muscles:['Calisthenics','Legs'],patterns:['Squat'],family:'Jump',equip:['Bodyweight'],equipment:'Bodyweight squat with a jump (power)'},
  {id:'cs33',name:'Crow Pose',muscle:'Calisthenics',muscles:['Calisthenics','Core','Shoulders'],patterns:['Mobility'],family:'Balance',equip:['Bodyweight'],equipment:'Balancing on the hands, knees on the elbows'},
  {id:'cs34',name:'Wall Walk',muscle:'Calisthenics',muscles:['Calisthenics','Shoulders','Core'],patterns:['Vertical Push'],family:'Handstand',equip:['Bodyweight'],equipment:'Feet up the wall, walking to a handstand'},
  // Parallettes aren't in the fixed equip vocab, so the kit lives in the human-readable string -
  // search covers it (same shape as ch19 Bar Dip). timed: an L-sit is a hold, logged in seconds.
  {id:'cs35',timed:true,name:'Parallette L-Sit',muscle:'Calisthenics',muscles:['Calisthenics','Core','Arms','Legs'],patterns:['Isolation'],family:'L-Sit',equip:['Bodyweight'],equipment:'Parallettes / dip bars / floor - support hold, legs straight out (advanced)'},
  // ---- Stretches (neutral - no corrective claims; see council 2026-07-18) ----
  {id:'st1',timed:true,name:'Standing Hamstring Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'st2',timed:true,name:'Pigeon Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Floor'},
  {id:'st3',timed:true,name:'Deep Squat Hold',muscle:'Stretches',muscles:['Stretches','Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Bodyweight (hold rack for support)'},
  {id:'st4',timed:true,name:'Doorway Pec Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Rack upright'},
  {id:'st5',timed:true,name:'Lat Stretch on Bar',muscle:'Stretches',muscles:['Stretches','Back'],patterns:['Mobility'],family:'Stretch',equip:['Pull-Up Bar'],equipment:'Pull-up bar / rack'},
  {id:'st6',name:'Cat-Cow',muscle:'Stretches',muscles:['Stretches','Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Floor'},
  {id:'st7',timed:true,name:'Thread the Needle',muscle:'Stretches',muscles:['Stretches','Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Floor (thoracic rotation)'},
  {id:'st8',timed:true,name:'Standing Quad Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Bodyweight'},
  {id:'st9',timed:true,name:'Calf Stretch on Slant Board',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Slant Board'],equipment:'Slant board'},
  {id:'st10',timed:true,name:'Child’s Pose',muscle:'Stretches',muscles:['Stretches','Mobility'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Floor'},
  {id:'st11',timed:true,name:'Seated Forward Fold',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Seated, reaching for the toes (hamstrings / back)'},
  {id:'st12',timed:true,name:'Butterfly Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Seated, soles together (adductors / hips)'},
  {id:'st13',timed:true,name:'Cobra Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Prone press-up (spine / abs)'},
  {id:'st14',timed:true,name:'Kneeling Wrist Stretch',muscle:'Stretches',muscles:['Stretches','Grip'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Palms down, leaning back (forearm / wrist)'},
  {id:'st15',timed:true,name:'Lateral Neck Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Ear-to-shoulder, gentle hold (neck)'},
  {id:'st16',timed:true,name:'Figure-4 Glute Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Supine, ankle over the knee (glute / piriformis)'},
  // ---- Trial drills (from Mark's body map - log the response, keep only what earns it) ----
  {id:'tr1',timed:true,name:'QL / Side Bend Stretch',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Trial: log response'},
  {id:'tr2',name:'Kneeling Psoas March',muscle:'Legs',muscles:['Legs','Core'],patterns:['Mobility'],family:'Activation',equip:['Bodyweight'],equipment:'Trial - log response'},
  {id:'tr3',name:'Jaw / Neck Release Sequence',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Trial - log response'},
  {id:'tr4',name:'Big-Toe Isolation Drill',muscle:'Stretches',muscles:['Stretches'],patterns:['Mobility'],family:'Stretch',equip:['Bodyweight'],equipment:'Trial - log response (right foot)'}
];

// Session bookends (2026-07-28): movement pattern → the drills worth doing before / after it.
// A curated table, NOT a scoring function: every mobility entry carries pattern 'Mobility', so any
// computed "relevance" would be fake precision. Core.prepFor unions these in order, dedupes and caps.
// Empty pattern → no suggestion, which is the honest answer for Isolation and Conditioning work.
const GYM_PREP = {
  warmup: {
    'Squat':          ['mo7','st3','mo11'],
    'Hinge':          ['mo7','mo3','st16'],
    'Lunge':          ['mo6','mo7','mo11'],
    'Horizontal Push':['mo9','mo1','st4'],
    'Vertical Push':  ['mo9','mo1','mo10'],
    'Horizontal Pull':['mo9','mo13','mo10'],
    'Vertical Pull':  ['mo1','mo13','st5'],
    'Olympic':        ['mo7','mo1','st3'],
    'Carry':          ['mo13','mo14','mo1'],
    'Rotation':       ['mo15','mo7','mo10'],
    'Anti-Rotation':  ['mo15','mo3','mo9']
  },
  cooldown: {
    'Squat':          ['st8','st2','st9'],
    'Hinge':          ['st1','st16','st11'],
    'Lunge':          ['mo6','st8','st2'],
    'Horizontal Push':['st4','st13','st7'],
    'Vertical Push':  ['st4','st5','st15'],
    'Horizontal Pull':['st5','st7','st10'],
    'Vertical Pull':  ['st5','st7','st10'],
    'Olympic':        ['st3','st4','st8'],
    'Carry':          ['st15','st14','st5'],
    'Rotation':       ['st7','st13','st10'],
    'Anti-Rotation':  ['st7','st16','st10']
  }
};

// GYM_WORKOUTS - curated single workouts (council 2026-08-01, replaces GYM_TEMPLATES).
// Each is a STRUCTURE, not a prescription: set counts + rep RANGES + rest guidance.
// Loads always come from the lifter's own history (or stay blank). Variants are computed
// from this Base scheme, never stored: Reduced drops a set from everything 3+, Expanded
// adds one set to the first two non-mobility movements. General programming, not
// individualised advice.
// Programming anchors (2026 consensus): strength = 3-6 heavy sets of 2-6, rest 2-3min,
// compounds first. Hypertrophy = 6-20 reps taken close to failure, ~10-20 hard sets per
// muscle per week, rest 90-180s, lengthened-position work favoured. Athletic = power
// moves fresh and first, full recovery between efforts. Posture = 2:1 pull:push bias,
// rear delts + thoracic + deep neck flexors. Mobility-lower = ATG-style full-range
// loading, not passive stretching alone.
const GYM_WORKOUTS = [
  // STRENGTH
  { id:'wk-str-lower', goal:'STRENGTH', name:'Lower Strength', mins:55,
    blurb:'Squat + hinge, heavy and fresh',
    note:'Two big lifts done fresh, then unilateral and core support. Warm up to your top sets; the rep range is the working range, not a target to grind. Rest fully: strength is a skill and fatigue steals it.',
    exercises:[
      {id:'lg1',  sets:4, reps:'3-5',  rest:180},
      {id:'lg6',  sets:3, reps:'3-5',  rest:180},
      {id:'lg7',  sets:3, reps:'6-8',  rest:120},
      {id:'lg15', sets:3, reps:'6-8',  rest:120},
      {id:'co16', sets:3, reps:'8-10', rest:90}
    ]},
  { id:'wk-str-upper', goal:'STRENGTH', name:'Upper Strength', mins:55,
    blurb:'Press + pull, low reps, long rests',
    note:'Bench and overhead press paired with heavy pulling to keep the shoulders honest. If pull-ups are easy at 6, add load with a dumbbell between the feet. Stop any pressing set the moment the shoulder complains.',
    exercises:[
      {id:'ch1',  sets:4, reps:'3-5',  rest:180},
      {id:'ba3',  sets:4, reps:'4-6',  rest:150},
      {id:'sh1',  sets:3, reps:'4-6',  rest:180},
      {id:'ba13', sets:3, reps:'5-6',  rest:150},
      {id:'gr7',  sets:3, reps:'20-30',rest:120}
    ]},
  { id:'wk-str-full', goal:'STRENGTH', name:'Full-Body Strength', mins:50,
    blurb:'One session, every big pattern',
    note:'Hinge, push, pull, then an overhead finisher and a loaded carry. The classic minimum-dose strength day when you can only train a couple of times a week.',
    exercises:[
      {id:'lg6',  sets:4, reps:'3-5',  rest:180},
      {id:'ch1',  sets:3, reps:'4-6',  rest:150},
      {id:'ba3',  sets:3, reps:'4-6',  rest:150},
      {id:'sh17', sets:3, reps:'3-5',  rest:150},
      {id:'co8',  sets:3, reps:'20-30',rest:90}
    ]},
  // AESTHETICS (hypertrophy)
  { id:'wk-aes-upper', goal:'AESTHETICS', name:'Aesthetic Upper', mins:60,
    blurb:'Chest, back, delts, arms: the mirror day',
    note:'Compounds first, isolation after, every set within 1-3 reps of failure. The last rep of a set should be slow but clean. Lateral raises respond to higher reps: chase the burn, not the load.',
    exercises:[
      {id:'ch4',  sets:4, reps:'8-12',  rest:120},
      {id:'ba4',  sets:4, reps:'10-12', rest:120},
      {id:'ch6',  sets:3, reps:'12-15', rest:90},
      {id:'sh4',  sets:4, reps:'12-20', rest:75},
      {id:'ar2',  sets:3, reps:'10-15', rest:75},
      {id:'ar17', sets:3, reps:'10-15', rest:75}
    ]},
  { id:'wk-aes-lower', goal:'AESTHETICS', name:'Aesthetic Lower', mins:60,
    blurb:'Quads, hamstrings, glutes, calves',
    note:'Squat pattern then hinge pattern, then machines to take each muscle to honest fatigue without loading the spine. Calves grow on full range and a pause at the stretch.',
    exercises:[
      {id:'lg28', sets:4, reps:'8-10',  rest:150},
      {id:'lg5',  sets:4, reps:'8-12',  rest:150},
      {id:'lg23', sets:3, reps:'12-15', rest:90},
      {id:'lg14', sets:3, reps:'10-15', rest:90},
      {id:'lg25', sets:3, reps:'12-15', rest:75},
      {id:'lg17', sets:4, reps:'10-15', rest:75}
    ]},
  { id:'wk-aes-arms', goal:'AESTHETICS', name:'Arms & Delts', mins:45,
    blurb:'Direct arm and shoulder volume',
    note:'A specialisation day: everything here is isolation, so rests are short and the quality bar is strict range. Alternate a biceps and a triceps movement to keep moving without strength loss.',
    exercises:[
      {id:'sh2',  sets:4, reps:'8-12',  rest:120},
      {id:'sh4',  sets:4, reps:'12-20', rest:75},
      {id:'ar12', sets:3, reps:'10-12', rest:75},
      {id:'ar8',  sets:3, reps:'10-12', rest:75},
      {id:'ar3',  sets:3, reps:'10-15', rest:60},
      {id:'ar7',  sets:3, reps:'12-15', rest:60}
    ]},
  // SPLIT DAYS
  { id:'wk-push', goal:'SPLIT DAY', name:'Push Day', mins:55,
    blurb:'Chest, shoulders, triceps',
    note:'Heavy horizontal press, then vertical, then volume. If the right shoulder starts talking, cut the set, not the range of motion.',
    exercises:[
      {id:'ch1',  sets:4, reps:'5-8',   rest:150},
      {id:'sh1',  sets:3, reps:'6-8',   rest:150},
      {id:'ch4',  sets:3, reps:'8-12',  rest:120},
      {id:'sh4',  sets:4, reps:'12-20', rest:75},
      {id:'ch6',  sets:3, reps:'12-15', rest:90},
      {id:'ar17', sets:3, reps:'10-15', rest:75}
    ]},
  { id:'wk-pull', goal:'SPLIT DAY', name:'Pull Day', mins:55,
    blurb:'Back, rear delts, biceps',
    note:'One heavy hinge, then vertical and horizontal pulling, then the small stuff. Face pulls are the cheapest shoulder insurance in the gym: do them every pull day.',
    exercises:[
      {id:'ba1',  sets:3, reps:'4-6',   rest:180},
      {id:'ba3',  sets:4, reps:'6-10',  rest:120},
      {id:'ba5',  sets:3, reps:'10-12', rest:105},
      {id:'ba9',  sets:3, reps:'12-15', rest:75},
      {id:'sh7',  sets:3, reps:'12-15', rest:75},
      {id:'ar3',  sets:3, reps:'10-12', rest:60}
    ]},
  // ATHLETIC
  { id:'wk-ath-power', goal:'ATHLETIC', name:'Athletic Power', mins:50,
    blurb:'Jump, throw, sprint-adjacent strength',
    note:'Power work only while fresh: jumps and cleans come first and every rep is fast and crisp. The moment reps slow down, the set is over. Finish with anti-rotation and an offset carry.',
    exercises:[
      {id:'cs24', sets:4, reps:'3-4',   rest:120},
      {id:'fb6',  sets:4, reps:'3-4',   rest:180},
      {id:'lg16', sets:4, reps:'8-10',  rest:90},
      {id:'lg36', sets:3, reps:'6-8',   rest:105},
      {id:'co5',  sets:3, reps:'10-12', rest:75},
      {id:'gr11', sets:3, reps:'20-30', rest:90}
    ]},
  { id:'wk-ath-engine', goal:'ATHLETIC', name:'Athletic Engine', mins:35,
    blurb:'Conditioning without a treadmill',
    note:'Kettlebells and a rope: intervals, not a grind. Work hard, breathe, repeat. Scale by shortening the work, never by getting sloppy.',
    exercises:[
      {id:'ca2',  sets:4, reps:'45-60', rest:60},
      {id:'fb1',  sets:4, reps:'6-8',   rest:90},
      {id:'lg16', sets:5, reps:'10-12', rest:60},
      {id:'ca4',  sets:3, reps:'10-15', rest:75},
      {id:'cs22', sets:3, reps:'20-30', rest:60}
    ]},
  // POSTURE
  { id:'wk-posture', goal:'POSTURE', name:'Posture Reset', mins:40,
    blurb:'Undo the desk: pull bias + thoracic',
    note:'Built on a 2:1 pull-to-push bias: rear delts, mid-back and deep neck flexors get the volume your desk stole. Nothing here should be heavy; position beats load on every movement.',
    exercises:[
      {id:'sh7',  sets:4, reps:'12-15', rest:75},
      {id:'ba7',  sets:3, reps:'10-12', rest:105},
      {id:'sh6',  sets:3, reps:'12-15', rest:75},
      {id:'mo10', sets:2, reps:'8-10',  rest:45},
      {id:'mo9',  sets:2, reps:'8-10',  rest:45},
      {id:'mo14', sets:2, reps:'20-30', rest:30},
      {id:'st4',  sets:2, reps:'30-45', rest:30}
    ]},
  // Symmetry-recorded upper re-entry (council 2026-08-02). Deliberately NOT called corrective:
  // it does not claim to fix an asymmetry, it refuses to let the strong side hide one. Every
  // one-sided movement runs weaker side FIRST and caps the other at the same clean reps, so the
  // rep gap is recorded evidence rather than an inference. Overhead pressing is omitted on
  // purpose (the most upper-trap and impingement-provocative pattern), not forgotten.
  { id:'wk-upper-symmetry', goal:'POSTURE', name:'Upper Symmetry', mins:45,
    blurb:'Pull bias, one side at a time, neck last',
    note:'Pull-biased upper session that refuses to let your strong side carry the weak one. Run every one-sided movement on the WEAKER side first, then cap the stronger side at the same clean reps, and tap the set number to tag L or R so the balance board gets real numbers. Overhead pressing is left out on purpose: it is the pattern that loads the upper traps hardest. Nothing here progresses today, loads repeat what you already tolerated. STOP the exercise, not just the set, on any new tingling, numbness, weakness, radiating pain, a shoulder giving way, or a pop that changes what you can do afterwards. Position beats load on every movement here.',
    exercises:[
      {id:'ba7',  sets:3, reps:'8-10',   rest:105},
      {id:'sh7',  sets:3, reps:'12-15',  rest:75},
      {id:'ch3',  sets:3, reps:'6-8',    rest:120},
      {id:'ba22', sets:2, reps:'10-12',  rest:90},
      {id:'mo13', sets:2, reps:'8-10',   rest:45},
      {id:'co8',  sets:2, reps:'30-40',  rest:60},
      {id:'mo14', sets:2, reps:'20-30',  rest:30},
      {id:'st15', sets:2, reps:'30-40',  rest:30}
    ]},
  // MOBILITY
  { id:'wk-mob-lower', goal:'MOBILITY', name:'Mobility Lower', mins:40,
    blurb:'ATG-style full-range leg work',
    note:'Loaded mobility, knees-over-toes style: strength at end range beats passive stretching. Slow eccentrics, full depth, light load. The tibialis and Nordic work protect knees and hamstrings.',
    exercises:[
      {id:'lg11', sets:3, reps:'10-15', rest:90},
      {id:'lg8',  sets:3, reps:'8-10',  rest:90},
      {id:'lg13', sets:3, reps:'3-6',   rest:105},
      {id:'lg18', sets:3, reps:'15-20', rest:60},
      {id:'mo7',  sets:2, reps:'5-6',   rest:45},
      {id:'mo5',  sets:2, reps:'30-45', rest:30},
      {id:'st3',  sets:2, reps:'40-60', rest:30}
    ]},
  { id:'wk-mob-flow', goal:'MOBILITY', name:'Full-Body Flow', mins:25,
    blurb:'Move everything, load nothing',
    note:'A rest-day or morning flow: hips, thoracic, shoulders and ankles through full ranges with just bodyweight and a band. Breathe slowly through every hold.',
    exercises:[
      {id:'mo8',  sets:2, reps:'5-6',   rest:30},
      {id:'cs12', sets:2, reps:'8-10',  rest:45},
      {id:'cs15', sets:2, reps:'10-12', rest:45},
      {id:'mo1',  sets:2, reps:'10-12', rest:30},
      {id:'st7',  sets:2, reps:'30-40', rest:30},
      {id:'st6',  sets:2, reps:'8-10',  rest:30},
      {id:'st2',  sets:2, reps:'40-60', rest:30}
    ]},
  // FULL BODY + BODYWEIGHT
  { id:'wk-full-45', goal:'FULL BODY', name:'Full Body 45', mins:45,
    blurb:'Everything, once, in 45 minutes',
    note:'The no-excuses session: six movements covering every pattern at moderate load. Perfect when life is busy; run it 2-3 times a week and it quietly builds everything.',
    exercises:[
      {id:'lg9',  sets:3, reps:'8-12',  rest:105},
      {id:'ch3',  sets:3, reps:'8-12',  rest:105},
      {id:'ba6',  sets:3, reps:'10-12', rest:105},
      {id:'sh2',  sets:3, reps:'8-12',  rest:105},
      {id:'lg5',  sets:3, reps:'8-12',  rest:120},
      {id:'co2',  sets:3, reps:'30-45', rest:60}
    ]},
  { id:'wk-cali', goal:'BODYWEIGHT', name:'Calisthenics', mins:40,
    blurb:'No plates, just gravity',
    note:'Bodyweight strength with the rack and a bar: scapular control first, then pushing and pulling to honest fatigue. Too easy? Slow every rep down to a 3-second lower.',
    exercises:[
      {id:'cs1',  sets:3, reps:'6-8',   rest:75},
      {id:'ch8',  sets:4, reps:'8-15',  rest:90},
      {id:'cs5',  sets:4, reps:'8-12',  rest:90},
      {id:'cs9',  sets:3, reps:'6-10',  rest:105},
      {id:'cs19', sets:3, reps:'20-30', rest:60},
      {id:'cs16', sets:3, reps:'10-12', rest:60}
    ]}
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
    note:'Your PPL. Run the three days through the week and repeat as time allows (5–6 sessions). Watch pressing volume - back off if the right shoulder starts talking.',
    days:[
      { name:'Push', exerciseIds:['ch1','sh1','ch4','sh4','ch6','ar6','ar9'] },
      { name:'Pull', exerciseIds:['ba1','ba3','ba5','ba9','sh7','ar2','ar3'] },
      { name:'Legs', exerciseIds:['lg1','lg5','lg7','lg13','lg18','lg17','co4'] }
    ]
  },
  {
    id:'plan-ty-ppl', tag:'TY', name:'Ty · PPL', goal:3,
    blurb:'3 days · Ty’s push / pull / legs',
    note:'Ty’s rotation, exactly as written in his doc. Vest work (deficit push-ups, dips, optional pull-ups) is logged as 8 kg - take it off for the bench and lateral raises. On legs, put the leg extension and leg curl back to back and flip the superset switch on the extension.',
    days:[
      { name:'Push', exerciseIds:['ch17','ch5','ch19','sh4','ar9'] },
      { name:'Pull', exerciseIds:['ba3','ba8','ba6','ar22','cs35'] },
      { name:'Legs', exerciseIds:['lg3','lg42','lg43','lg23','lg14','lg13','lg18'] }
    ]
  },
  {
    id:'plan-desk', tag:'DESK RESET', name:'Desk Reset', goal:5,
    blurb:'5 min · undo the laptop day',
    note:'Not a workout: the counter-dose to sitting. Five minutes, no kit beyond a wall and the bench, run it on training days or rest days. Three of these are holds and log in SECONDS (Couch Stretch, Doorway Pec, Chin Tuck); the other three are slow rep drills. Order matters: open the front of the hips and chest first, then ask the upper back to rotate and the neck to stack.',
    days:[
      { name:'Desk Reset', exerciseIds:['mo6','st4','mo10','mo15','mo13','mo14'] }
    ]
  },
  {
    id:'plan-atg', tag:'ATG ADD-ON', name:'Knees & Tibialis', goal:2,
    blurb:'2 short sessions · KOT-style',
    note:'Knees-Over-Toes style bulletproofing to pair with any split - two short sessions a week using your tib bars, slant board and hang board. Low load, full range, no ego.',
    days:[
      { name:'Session 1 · Knees',  exerciseIds:['lg8','lg12','lg11','lg24','lg18','lg17','gr3'] },
      { name:'Session 2 · Posterior + tib', exerciseIds:['lg4','lg13','lg25','lg19','ba11','mo5','mo3'] }
    ]
  }
];
