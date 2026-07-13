// Revo Langwarrin-tailored exercise catalogue. Machine categories are official; individual models may vary.
const DUCK_EXERCISES = [
  {
    "id": "b0",
    "name": "Bench Press",
    "muscle": "Chest",
    "equipment": "Squat rack / straight barbell",
    "revo": true
  },
  {
    "id": "b1",
    "name": "Incline Dumbbell Press",
    "muscle": "Chest",
    "equipment": "Dumbbells + adjustable bench",
    "revo": true
  },
  {
    "id": "b2",
    "name": "Cable Fly",
    "muscle": "Chest",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b3",
    "name": "Push Up",
    "muscle": "Chest",
    "equipment": "Bodyweight",
    "revo": true
  },
  {
    "id": "b4",
    "name": "Deadlift",
    "muscle": "Back",
    "equipment": "Squat rack / straight barbell",
    "revo": true
  },
  {
    "id": "b5",
    "name": "Lat Pulldown",
    "muscle": "Back",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b6",
    "name": "Barbell Row",
    "muscle": "Back",
    "equipment": "Straight barbell",
    "revo": true
  },
  {
    "id": "b7",
    "name": "Seated Cable Row",
    "muscle": "Back",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b8",
    "name": "Pull Up",
    "muscle": "Back",
    "equipment": "Squat rack / pull-up station",
    "revo": true
  },
  {
    "id": "b9",
    "name": "Back Squat",
    "muscle": "Legs",
    "equipment": "Squat rack / straight barbell",
    "revo": true
  },
  {
    "id": "b10",
    "name": "Leg Press",
    "muscle": "Legs",
    "equipment": "Plate-loaded machine",
    "revo": true
  },
  {
    "id": "b11",
    "name": "Romanian Deadlift",
    "muscle": "Legs",
    "equipment": "Straight barbell",
    "revo": true
  },
  {
    "id": "b12",
    "name": "Leg Extension",
    "muscle": "Legs",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b13",
    "name": "Leg Curl",
    "muscle": "Legs",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b14",
    "name": "Calf Raise",
    "muscle": "Legs",
    "equipment": "Plate or pin-loaded machine",
    "revo": true
  },
  {
    "id": "b15",
    "name": "Overhead Press",
    "muscle": "Shoulders",
    "equipment": "Squat rack / straight barbell",
    "revo": true
  },
  {
    "id": "b16",
    "name": "Lateral Raise",
    "muscle": "Shoulders",
    "equipment": "Dumbbells",
    "revo": true
  },
  {
    "id": "b17",
    "name": "Rear Delt Fly",
    "muscle": "Shoulders",
    "equipment": "Dumbbells / bench",
    "revo": true
  },
  {
    "id": "b18",
    "name": "Barbell Curl",
    "muscle": "Arms",
    "equipment": "Straight barbell",
    "revo": true
  },
  {
    "id": "b19",
    "name": "Hammer Curl",
    "muscle": "Arms",
    "equipment": "Dumbbells",
    "revo": true
  },
  {
    "id": "b20",
    "name": "Tricep Pushdown",
    "muscle": "Arms",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b21",
    "name": "Skull Crusher",
    "muscle": "Arms",
    "equipment": "EZ barbell + bench",
    "revo": true
  },
  {
    "id": "b22",
    "name": "Plank",
    "muscle": "Core",
    "equipment": "Mat / functional area",
    "revo": true
  },
  {
    "id": "b23",
    "name": "Hanging Leg Raise",
    "muscle": "Core",
    "equipment": "Pull-up station",
    "revo": true
  },
  {
    "id": "b24",
    "name": "Cable Crunch",
    "muscle": "Core",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b25",
    "name": "Treadmill",
    "muscle": "Cardio",
    "equipment": "Treadmill",
    "revo": true
  },
  {
    "id": "b26",
    "name": "Exercise Bike",
    "muscle": "Cardio",
    "equipment": "Spin bike",
    "revo": true
  },
  {
    "id": "b27",
    "name": "Rowing Machine",
    "muscle": "Cardio",
    "equipment": "Rower",
    "revo": true
  },
  {
    "id": "b28",
    "name": "StairMaster",
    "muscle": "Cardio",
    "equipment": "StairMaster",
    "revo": true
  },
  {
    "id": "b29",
    "name": "Assault Bike",
    "muscle": "Cardio",
    "equipment": "Assault bike",
    "revo": true
  },
  {
    "id": "b30",
    "name": "Elliptical Trainer",
    "muscle": "Cardio",
    "equipment": "Elliptical",
    "revo": true
  },
  {
    "id": "b31",
    "name": "Spin Bike Intervals",
    "muscle": "Cardio",
    "equipment": "Spin bike",
    "revo": true
  },
  {
    "id": "b32",
    "name": "Kettlebell Swing",
    "muscle": "Full Body",
    "equipment": "Kettlebell",
    "revo": true
  },
  {
    "id": "b33",
    "name": "Kettlebell Goblet Squat",
    "muscle": "Legs",
    "equipment": "Kettlebell",
    "revo": true
  },
  {
    "id": "b34",
    "name": "Dumbbell Bench Press",
    "muscle": "Chest",
    "equipment": "Dumbbells + bench",
    "revo": true
  },
  {
    "id": "b35",
    "name": "Dumbbell Row",
    "muscle": "Back",
    "equipment": "Dumbbells + bench",
    "revo": true
  },
  {
    "id": "b36",
    "name": "Dumbbell Shoulder Press",
    "muscle": "Shoulders",
    "equipment": "Dumbbells + bench",
    "revo": true
  },
  {
    "id": "b37",
    "name": "Dumbbell Walking Lunge",
    "muscle": "Legs",
    "equipment": "Dumbbells",
    "revo": true
  },
  {
    "id": "b38",
    "name": "EZ-Bar Curl",
    "muscle": "Arms",
    "equipment": "EZ barbell",
    "revo": true
  },
  {
    "id": "b39",
    "name": "EZ-Bar Skull Crusher",
    "muscle": "Arms",
    "equipment": "EZ barbell + bench",
    "revo": true
  },
  {
    "id": "b40",
    "name": "Barbell Hip Thrust",
    "muscle": "Legs",
    "equipment": "Straight barbell + bench",
    "revo": true
  },
  {
    "id": "b41",
    "name": "Front Squat",
    "muscle": "Legs",
    "equipment": "Squat rack / straight barbell",
    "revo": true
  },
  {
    "id": "b42",
    "name": "Bulgarian Split Squat",
    "muscle": "Legs",
    "equipment": "Dumbbells + bench",
    "revo": true
  },
  {
    "id": "b43",
    "name": "Box Jump",
    "muscle": "Full Body",
    "equipment": "Plyo box",
    "revo": true
  },
  {
    "id": "b44",
    "name": "Box Step-Up",
    "muscle": "Legs",
    "equipment": "Plyo box / dumbbells",
    "revo": true
  },
  {
    "id": "b45",
    "name": "Resistance Band Face Pull",
    "muscle": "Shoulders",
    "equipment": "Resistance band",
    "revo": true
  },
  {
    "id": "b46",
    "name": "Resistance Band Pull-Apart",
    "muscle": "Shoulders",
    "equipment": "Resistance band",
    "revo": true
  },
  {
    "id": "b47",
    "name": "Slam Ball Slams",
    "muscle": "Full Body",
    "equipment": "Slam ball",
    "revo": true
  },
  {
    "id": "b48",
    "name": "Medicine Ball Slams",
    "muscle": "Full Body",
    "equipment": "Medicine ball",
    "revo": true
  },
  {
    "id": "b49",
    "name": "Medicine Ball Russian Twist",
    "muscle": "Core",
    "equipment": "Medicine ball",
    "revo": true
  },
  {
    "id": "b50",
    "name": "HIITFIT Circuit",
    "muscle": "Full Body",
    "equipment": "HIITFIT 24/7 circuit",
    "revo": true
  },
  {
    "id": "b51",
    "name": "Tempo Mat Pilates",
    "muscle": "Full Body",
    "equipment": "Tempo mat Pilates area",
    "revo": true
  },
  {
    "id": "b52",
    "name": "Reformer Pilates",
    "muscle": "Full Body",
    "equipment": "Reformer Pilates bed",
    "revo": true
  },
  {
    "id": "b53",
    "name": "Foam Rolling / Mobility",
    "muscle": "Recovery",
    "equipment": "BLACKROLL foam rollers",
    "revo": true
  },
  {
    "id": "b54",
    "name": "Massage Gun Recovery",
    "muscle": "Recovery",
    "equipment": "Muscle therapy equipment",
    "revo": true
  },
  {
    "id": "b55",
    "name": "Massage Chair Recovery",
    "muscle": "Recovery",
    "equipment": "Massage chair — Level Two",
    "revo": true
  },
  {
    "id": "b56",
    "name": "Evolt 360 Body Scan",
    "muscle": "Recovery",
    "equipment": "Evolt 360 scanner — Level Two",
    "revo": true
  },
  {
    "id": "b57",
    "name": "Reformer Pilates Flow",
    "muscle": "Full Body",
    "equipment": "Reformer Pilates bed — Level Two",
    "revo": true
  },
  {
    "id": "b58",
    "name": "Resistance Band Mobility",
    "muscle": "Recovery",
    "equipment": "Resistance bands",
    "revo": true
  },
  {
    "id": "b59",
    "name": "Plyo Box Step-Up",
    "muscle": "Legs",
    "equipment": "Plyo box",
    "revo": true
  },
  {
    "id": "b60",
    "name": "Medicine Ball Chest Pass",
    "muscle": "Chest",
    "equipment": "Medicine ball",
    "revo": true
  },
  {
    "id": "b61",
    "name": "Slam Ball Squat Throw",
    "muscle": "Full Body",
    "equipment": "Slam ball",
    "revo": true
  },
  {
    "id": "b62",
    "name": "Farmer Carry",
    "muscle": "Full Body",
    "equipment": "Kettlebells / dumbbells",
    "revo": true
  },
  {
    "id": "b63",
    "name": "Assisted Pull Up",
    "muscle": "Back",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b64",
    "name": "Machine Chest Press",
    "muscle": "Chest",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b65",
    "name": "Plate-loaded Chest Press",
    "muscle": "Chest",
    "equipment": "Plate-loaded machine",
    "revo": true
  },
  {
    "id": "b66",
    "name": "Machine Shoulder Press",
    "muscle": "Shoulders",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b67",
    "name": "Plate-loaded Shoulder Press",
    "muscle": "Shoulders",
    "equipment": "Plate-loaded machine",
    "revo": true
  },
  {
    "id": "b68",
    "name": "Hack Squat",
    "muscle": "Legs",
    "equipment": "Plate-loaded machine",
    "revo": true
  },
  {
    "id": "b69",
    "name": "Lying Leg Curl",
    "muscle": "Legs",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b70",
    "name": "Seated Leg Curl",
    "muscle": "Legs",
    "equipment": "Pin-loaded machine",
    "revo": true
  },
  {
    "id": "b71",
    "name": "Glute Kickback",
    "muscle": "Legs",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b72",
    "name": "Cable Lateral Raise",
    "muscle": "Shoulders",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b73",
    "name": "Cable Bicep Curl",
    "muscle": "Arms",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b74",
    "name": "Overhead Cable Tricep Extension",
    "muscle": "Arms",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b75",
    "name": "Straight-arm Cable Pulldown",
    "muscle": "Back",
    "equipment": "Pin-loaded cable machine",
    "revo": true
  },
  {
    "id": "b76",
    "name": "Battle Rope Intervals",
    "muscle": "Cardio",
    "equipment": "Functional / HIIT area",
    "revo": true
  }
];
