// data.js — single source of truth for Arise.
// Franchise-adjacent terminology has been removed; neutral fitness language only.
// All game attributes derive from logged history (see attributes.js).

export const EQUIPMENT = [
  { id: 'bodyweight', label: 'Bodyweight only', icon: '🤸' },
  { id: 'dumbbells', label: 'Dumbbells', icon: '🏋️' },
  { id: 'barbell', label: 'Barbell & rack', icon: '🏗️' },
  { id: 'bands', label: 'Resistance bands', icon: '〰️' },
  { id: 'kettlebell', label: 'Kettlebell', icon: '🔔' },
  { id: 'pullup-bar', label: 'Pull-up bar', icon: '🧱' },
  { id: 'bench', label: 'Bench', icon: '🪑' },
  { id: 'cable', label: 'Cable machine', icon: '🔗' },
  { id: 'machine', label: 'Machines', icon: '⚙️' },
];

export const LOCATIONS = [
  { id: 'home', label: 'Home', hint: 'No commute, minimal kit' },
  { id: 'gym', label: 'Gym', hint: 'Full equipment access' },
  { id: 'outdoor', label: 'Outdoors', hint: 'Park, track, street' },
  { id: 'limited', label: 'Small space / travel', hint: 'Hotel room, tight flat' },
];

export const MUSCLES = ['Chest','Back','Legs','Glutes','Shoulders','Arms','Core','Full body','Cardio'];
export const LEVELS = ['Beginner','Intermediate','Advanced'];
export const GOALS = [
  { id: 'strength', label: 'Get stronger', hint: 'Progressive overload, heavier lifts' },
  { id: 'muscle', label: 'Build muscle', hint: 'Volume + hypertrophy' },
  { id: 'endurance', label: 'Move longer', hint: 'Conditioning & stamina' },
  { id: 'fat-loss', label: 'Lean out', hint: 'Consistency + conditioning' },
  { id: 'general', label: 'Feel better', hint: 'Balanced, sustainable' },
];

// User-facing tag vocabulary for browsing/filtering. Orthogonal to muscle,
// equipment and level: structure (compound/isolation), direction (push/pull),
// character (explosive/conditioning/core-stability) and joint load (low-impact).
export const EXERCISE_TAGS = [
  { id: 'compound', label: 'Compound' },
  { id: 'isolation', label: 'Isolation' },
  { id: 'unilateral', label: 'Unilateral' },
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'explosive', label: 'Explosive' },
  { id: 'conditioning', label: 'Conditioning' },
  { id: 'core-stability', label: 'Core stability' },
  { id: 'low-impact', label: 'Low impact' },
  { id: 'grip', label: 'Grip' },
];
export const EXERCISE_TAG_IDS = EXERCISE_TAGS.map(t => t.id);

// Hand-curated exercise library. Each entry declares equipment so onboarding can
// gate recommendations honestly, and tags so the browser can slice by intent.
// Substitution edges must stay reciprocal (A lists B ⇒ B lists A) — enforced by validateContent().
export const EXERCISES = [
  // ── Chest
  { id: 'push-up', name: 'Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound','push'], cues: ['Hands under shoulders','Body in a straight line','Chest to floor'], substitution: ['bench-press-dumbbell','chest-press-machine','bench-press-barbell','incline-push-up','overhead-press-dumbbell','tricep-dip-bench','incline-dumbbell-press','decline-push-up','close-grip-push-up','tricep-pushdown'], unilateral: false, supportsWeighted: true, supportsAssisted: false, progression: 'reps', rom: true },
  { id: 'bench-press-barbell', name: 'Barbell Bench Press', muscle: 'Chest', equipment: ['barbell','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Feet planted','Retract shoulder blades','Bar to chest, press to lockout'], substitution: ['push-up','bench-press-dumbbell'], unilateral: false, progression: 'load', rom: true },
  { id: 'bench-press-dumbbell', name: 'Dumbbell Bench Press', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','push'], cues: ['Neutral wrists','Control the descent'], substitution: ['push-up','bench-press-barbell','incline-dumbbell-press','dumbbell-fly'], unilateral: false, progression: 'load', rom: true },
  { id: 'incline-push-up', name: 'Incline Push-up', muscle: 'Chest', equipment: ['bodyweight','bench'], level: 'Beginner', tags: ['compound','push','low-impact'], cues: ['Hands elevated','Easier than floor push-ups'], substitution: ['push-up'], unilateral: false, supportsWeighted: true, progression: 'reps' },
  { id: 'chest-press-machine', name: 'Chest Press (Machine)', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['compound','push'], cues: ['Seat height so handles at chest'], substitution: ['push-up','cable-fly','machine-fly'], progression: 'load' },
  { id: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Bench at 30°','Palms forward','Control stretch at bottom'], substitution: ['bench-press-dumbbell','push-up'], progression: 'load', rom: true },
  { id: 'decline-push-up', name: 'Decline Push-up', muscle: 'Chest', equipment: ['bodyweight','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Feet elevated','Body rigid','Lower chest to floor'], substitution: ['push-up'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'dumbbell-fly', name: 'Dumbbell Fly', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['isolation','push'], cues: ['Soft elbows','Wide arc','Stretch, don\'t strain'], substitution: ['bench-press-dumbbell','cable-fly','machine-fly'], unilateral: false, progression: 'load', rom: true },
  { id: 'cable-fly', name: 'Cable Fly', muscle: 'Chest', equipment: ['cable'], level: 'Beginner', tags: ['isolation','push'], cues: ['Constant tension','Squeeze at midline'], substitution: ['dumbbell-fly','machine-fly','chest-press-machine'], unilateral: false, progression: 'load' },
  { id: 'machine-fly', name: 'Pec Deck (Machine)', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['isolation','push'], cues: ['Handles at chest height','Pause at squeeze'], substitution: ['cable-fly','dumbbell-fly','chest-press-machine'], unilateral: false, progression: 'load' },

  // ── Back
  { id: 'pull-up', name: 'Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['compound','pull','grip'], cues: ['Dead hang start','Chest to bar','No swinging'], substitution: ['band-row','dumbbell-row','lat-pulldown','chin-up','inverted-row'], supportsWeighted: true, supportsAssisted: true, progression: 'reps', rom: true },
  { id: 'band-row', name: 'Banded Row', muscle: 'Back', equipment: ['bands'], level: 'Beginner', tags: ['compound','pull'], cues: ['Hinge slightly','Pull elbows past torso'], substitution: ['dumbbell-row','pull-up','lat-pulldown','face-pull','cable-row','inverted-row'], progression: 'reps' },
  { id: 'dumbbell-row', name: 'Single-Arm Dumbbell Row', muscle: 'Back', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','pull','unilateral','grip'], cues: ['Flat back','Pull to hip'], substitution: ['band-row','pull-up','face-pull','cable-row','barbell-row','chest-supported-row','single-arm-cable-row'], unilateral: true, progression: 'load', rom: true },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull'], cues: ['Lean slightly back','Pull to upper chest'], substitution: ['pull-up','band-row','straight-arm-pulldown','chin-up'], progression: 'load' },
  { id: 'chin-up', name: 'Chin-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['compound','pull','grip'], cues: ['Underhand grip','Drive elbows down','Chin clears bar'], substitution: ['pull-up','inverted-row','lat-pulldown'], supportsWeighted: true, supportsAssisted: true, progression: 'reps', rom: true },
  { id: 'inverted-row', name: 'Inverted Row', muscle: 'Back', equipment: ['pullup-bar'], level: 'Beginner', tags: ['compound','pull','grip','low-impact'], cues: ['Body straight as a plank','Chest to bar','Walk feet out for difficulty'], substitution: ['band-row','pull-up','chin-up'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'barbell-row', name: 'Barbell Row', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], cues: ['Hinge to ~45°','Bar to lower ribs','No torso bounce'], substitution: ['dumbbell-row','cable-row'], unilateral: false, progression: 'load', rom: true },
  { id: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Arms locked long','Lats pull the bar to thighs'], substitution: ['lat-pulldown'], unilateral: false, progression: 'load' },
  { id: 'cable-row', name: 'Seated Cable Row', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull'], cues: ['Chest proud','Elbows to ribs','Squeeze shoulder blades'], substitution: ['band-row','dumbbell-row','barbell-row','single-arm-cable-row','chest-supported-row'], unilateral: false, progression: 'load' },
  { id: 'single-arm-cable-row', name: 'Single-Arm Cable Row', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull','unilateral'], cues: ['Square hips','Row to the hip','Control the stretch'], substitution: ['cable-row','dumbbell-row'], unilateral: true, progression: 'load', rom: true },
  { id: 'chest-supported-row', name: 'Chest-Supported Dumbbell Row', muscle: 'Back', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','pull','low-impact'], cues: ['Chest stays on the bench','Row with the elbows','No momentum'], substitution: ['dumbbell-row','cable-row'], unilateral: true, progression: 'load', rom: true },

  // ── Legs / Glutes
  { id: 'bodyweight-squat', name: 'Bodyweight Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound'], cues: ['Knees track toes','Depth to hip below knee if comfortable'], substitution: ['goblet-squat','barbell-squat','split-squat','burpee','wall-sit'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'goblet-squat', name: 'Goblet Squat', muscle: 'Legs', equipment: ['dumbbells','kettlebell'], level: 'Beginner', tags: ['compound'], cues: ['Elbows inside knees','Chest tall'], substitution: ['bodyweight-squat','barbell-squat','bulgarian-split-squat','step-up','front-squat','leg-press','cable-goblet-squat'], progression: 'load', rom: true },
  { id: 'barbell-squat', name: 'Barbell Back Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Brace hard','Hip hinge then knee bend'], substitution: ['goblet-squat','bodyweight-squat','front-squat','leg-press'], progression: 'load', rom: true },
  { id: 'front-squat', name: 'Barbell Front Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Elbows high','Upright torso','Wrists under the bar'], substitution: ['barbell-squat','goblet-squat'], unilateral: false, progression: 'load', rom: true },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', muscle: 'Glutes', equipment: ['dumbbells','barbell'], level: 'Intermediate', tags: ['compound'], cues: ['Soft knee','Hinge, hamstrings stretch','Neutral spine'], substitution: ['glute-bridge','kettlebell-swing','good-morning','sumo-deadlift','nordic-curl','cable-pull-through'], progression: 'load', rom: true },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', muscle: 'Glutes', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Wide stance','Knees track over toes','Lock hips and knees together'], substitution: ['romanian-deadlift','good-morning'], unilateral: false, progression: 'load', rom: true },
  { id: 'good-morning', name: 'Good Morning', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], cues: ['Bar on upper traps','Hinge back','Stop when hamstrings stop you'], substitution: ['romanian-deadlift','sumo-deadlift'], unilateral: false, progression: 'load', rom: true },
  { id: 'nordic-curl', name: 'Nordic Hamstring Curl', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound'], cues: ['Anchor ankles','Lower as slowly as possible','Push back up from the floor'], substitution: ['romanian-deadlift','glute-bridge','cable-leg-curl','lying-leg-curl','cable-leg-curl','lying-leg-curl'], unilateral: false, progression: 'reps', rom: true },
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Glutes', equipment: ['bench'], level: 'Beginner', tags: ['compound'], cues: ['Shoulders on bench','Squeeze glutes at top'], substitution: ['glute-bridge','hip-abduction-machine','cable-pull-through'], progression: 'load', rom: true },
  { id: 'leg-press', name: 'Leg Press (Machine)', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','low-impact'], cues: ['Feet shoulder-width','Knees track toes','Control the sled down'], substitution: ['barbell-squat','goblet-squat'], unilateral: false, progression: 'load', rom: true },
  { id: 'hip-abduction-machine', name: 'Hip Abduction (Machine)', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['isolation'], cues: ['Sit tall','Drive knees out','Slow return'], substitution: ['hip-thrust'], unilateral: false, progression: 'load' },
  { id: 'glute-bridge', name: 'Glute Bridge', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound','low-impact'], cues: ['Feet flat','Drive hips up'], substitution: ['hip-thrust','romanian-deadlift','nordic-curl'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'lunge', name: 'Forward Lunge', muscle: 'Legs', equipment: ['bodyweight','dumbbells'], level: 'Beginner', tags: ['compound','unilateral'], cues: ['Front knee over ankle','Torso upright'], substitution: ['split-squat','bulgarian-split-squat','step-up'], unilateral: true, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'split-squat', name: 'Split Squat', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], cues: ['Torso upright','Back knee lowers toward floor'], substitution: ['lunge','bodyweight-squat','step-up'], unilateral: true, supportsWeighted: true, progression: 'load', rom: true },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], cues: ['Front shin vertical','Back knee hovers','Torso tall'], substitution: ['lunge','goblet-squat'], unilateral: true, supportsWeighted: true, progression: 'load', rom: true },
  { id: 'step-up', name: 'Step-up', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Beginner', tags: ['compound','unilateral','low-impact'], cues: ['Whole foot on the step','Drive through the heel','Control the way down'], substitution: ['lunge','split-squat','calf-raise','goblet-squat'], unilateral: true, supportsWeighted: true, progression: 'load' },
  { id: 'wall-sit', name: 'Wall Sit', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['low-impact'], cues: ['Thighs parallel to floor','Back flat on the wall','Breathe through the burn'], substitution: ['plank','bodyweight-squat'], unilateral: false, progression: 'time' },
  { id: 'calf-raise', name: 'Calf Raise', muscle: 'Legs', equipment: ['bodyweight','dumbbells'], level: 'Beginner', tags: ['isolation','low-impact'], cues: ['Full stretch at the bottom','Pause at the top'], substitution: ['step-up'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },

  // ── Shoulders / Arms
  { id: 'overhead-press-dumbbell', name: 'Dumbbell Overhead Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['compound','push'], cues: ['Ribs down','Press overhead without arching'], substitution: ['push-up','pike-push-up','overhead-press-barbell','arnold-press','machine-shoulder-press'], progression: 'load', rom: true },
  { id: 'overhead-press-barbell', name: 'Barbell Overhead Press', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], cues: ['Brace glutes and abs','Bar paths over the crown','Head through at the top'], substitution: ['overhead-press-dumbbell','pike-push-up'], unilateral: false, progression: 'load', rom: true },
  { id: 'arnold-press', name: 'Arnold Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','push'], cues: ['Start palms facing you','Rotate as you press','No leg drive'], substitution: ['overhead-press-dumbbell'], unilateral: false, progression: 'load', rom: true },
  { id: 'pike-push-up', name: 'Pike Push-up', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['compound','push'], cues: ['Hips high','Head between arms'], substitution: ['overhead-press-dumbbell','overhead-press-barbell'], supportsWeighted: true, progression: 'reps' },
  { id: 'lateral-raise', name: 'Lateral Raise', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation'], cues: ['Slight lean','Lead with elbows'], substitution: ['band-lateral-raise','rear-delt-fly'], progression: 'load' },
  { id: 'band-lateral-raise', name: 'Banded Lateral Raise', muscle: 'Shoulders', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], cues: ['Slow tempo'], substitution: ['lateral-raise','rear-delt-fly'], progression: 'reps' },
  { id: 'rear-delt-fly', name: 'Rear Delt Fly', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Hinge over','Pinkies lead','Squeeze the back of the shoulders'], substitution: ['face-pull','band-lateral-raise','lateral-raise','reverse-pec-deck','reverse-pec-deck'], unilateral: false, progression: 'load' },
  { id: 'face-pull', name: 'Face Pull', muscle: 'Shoulders', equipment: ['cable','bands'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Elbows high','Pull to forehead','Squeeze rear delts'], substitution: ['band-row','dumbbell-row','rear-delt-fly','dumbbell-shrug','reverse-pec-deck'], progression: 'load' },
  { id: 'dumbbell-shrug', name: 'Dumbbell Shrug', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','grip'], cues: ['Straight arms','Ears away from shoulders','Pause at the top'], substitution: ['face-pull','farmer-carry'], unilateral: false, supportsWeighted: true, progression: 'load' },
  { id: 'bicep-curl', name: 'Dumbbell Bicep Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','unilateral'], cues: ['Elbows pinned','No swinging'], substitution: ['band-curl','hammer-curl','barbell-curl','preacher-curl-machine','barbell-curl','preacher-curl-machine'], unilateral: true, progression: 'load' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','grip'], cues: ['Neutral grip','Elbows still','Control the lowering'], substitution: ['bicep-curl','preacher-curl-machine'], unilateral: true, progression: 'load' },
  { id: 'band-curl', name: 'Banded Bicep Curl', muscle: 'Arms', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], cues: ['Step on band','Control up and down'], substitution: ['bicep-curl'], progression: 'reps' },
  { id: 'tricep-dip-bench', name: 'Bench Dip', muscle: 'Arms', equipment: ['bench'], level: 'Beginner', tags: ['compound','push'], cues: ['Shoulders down','Elbows back'], substitution: ['push-up','tricep-pushdown','close-grip-push-up','machine-dip','close-grip-push-up','machine-dip'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'tricep-pushdown', name: 'Tricep Pushdown (Cable)', muscle: 'Arms', equipment: ['cable'], level: 'Beginner', tags: ['isolation','push'], cues: ['Elbows pinned to ribs','Full lockout','Slow return'], substitution: ['tricep-dip-bench','overhead-tricep-extension','skullcrusher','skullcrusher','machine-dip','push-up'], unilateral: false, progression: 'load' },
  { id: 'overhead-tricep-extension', name: 'Overhead Tricep Extension', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','push'], cues: ['Elbows narrow','Deep stretch','Extend fully'], substitution: ['tricep-pushdown','skullcrusher'], unilateral: false, progression: 'load' },

  // ── Core
  { id: 'plank', name: 'Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability'], cues: ['Forearms & toes','Hips level'], substitution: ['dead-bug','hanging-knee-raise','leg-raise','farmer-carry','side-plank','wall-sit','pallof-press'], progression: 'time' },
  { id: 'side-plank', name: 'Side Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Stack the shoulders','Hips high','Breathe steadily'], substitution: ['plank','bird-dog','barbell-side-bend'], unilateral: true, progression: 'time' },
  { id: 'dead-bug', name: 'Dead Bug', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Lower back pressed to floor','Opposite arm/leg'], substitution: ['plank','hanging-knee-raise','bird-dog','pallof-press'], progression: 'reps' },
  { id: 'bird-dog', name: 'Bird Dog', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Long spine','Reach opposite arm and leg','No hip tilt'], substitution: ['dead-bug','side-plank','superman'], unilateral: true, progression: 'reps' },
  { id: 'pallof-press', name: 'Pallof Press', muscle: 'Core', equipment: ['cable','bands'], level: 'Beginner', tags: ['core-stability'], cues: ['Stand side-on to the anchor','Resist the twist','Press straight out'], substitution: ['dead-bug','plank'], unilateral: true, progression: 'reps' },
  { id: 'hanging-knee-raise', name: 'Hanging Knee Raise', muscle: 'Core', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['core-stability','grip'], cues: ['No swinging','Knees to chest'], substitution: ['plank','dead-bug','leg-raise'], progression: 'reps', rom: true },
  { id: 'leg-raise', name: 'Hanging Leg Raise', muscle: 'Core', equipment: ['pullup-bar'], level: 'Advanced', tags: ['core-stability','grip'], cues: ['Dead hang','Legs straight','Control down'], substitution: ['hanging-knee-raise','plank'], progression: 'reps', rom: true },
  { id: 'mountain-climbers', name: 'Mountain Climbers', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['conditioning','core-stability'], cues: ['Shoulders over wrists','Hips low','Fast knees'], substitution: ['burpee','high-knees','bear-crawl'], unilateral: true, progression: 'time' },

  // ── Conditioning / Full body
  { id: 'run-easy', name: 'Easy Run', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Conversational pace','Nasal breathing'], substitution: ['brisk-walk','cycle','indoor-row'], progression: 'time' },
  { id: 'brisk-walk', name: 'Brisk Walk', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Arms pumping','Uphill if available'], substitution: ['run-easy','jump-rope'], progression: 'time' },
  { id: 'cycle', name: 'Cycle', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Steady cadence'], substitution: ['run-easy','cycle','indoor-row'], progression: 'time' },
  { id: 'indoor-row', name: 'Indoor Row', muscle: 'Cardio', equipment: ['machine'], level: 'Beginner', tags: ['conditioning','compound','low-impact'], cues: ['Legs, then hips, then arms','Reverse on the recovery'], substitution: ['cycle','run-easy'], unilateral: false, progression: 'time' },
  { id: 'high-knees', name: 'High Knees', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning'], cues: ['Knees to hip height','Quick ground contact','Stay tall'], substitution: ['jump-rope','mountain-climbers'], unilateral: true, progression: 'time' },
  { id: 'jump-rope', name: 'Jump Rope', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning'], cues: ['Light on toes','Elbows tucked'], substitution: ['brisk-walk','high-knees'], progression: 'time' },
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', muscle: 'Full body', equipment: ['kettlebell'], level: 'Intermediate', tags: ['compound','explosive'], cues: ['Hip hinge power','Arms guide, hips drive'], substitution: ['romanian-deadlift','farmer-carry','thruster'], progression: 'reps' },
  { id: 'thruster', name: 'Dumbbell Thruster', muscle: 'Full body', equipment: ['dumbbells'], level: 'Advanced', tags: ['compound','explosive','push'], cues: ['Front squat into press','One fluid drive','Catch with locked elbows'], substitution: ['kettlebell-swing','burpee'], unilateral: false, progression: 'load' },
  { id: 'bear-crawl', name: 'Bear Crawl', muscle: 'Full body', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','core-stability'], cues: ['Knees hover','Hips level','Move quietly'], substitution: ['mountain-climbers','farmer-carry'], unilateral: true, progression: 'time' },
  { id: 'burpee', name: 'Burpee', muscle: 'Full body', equipment: ['bodyweight'], level: 'Intermediate', tags: ['conditioning','explosive'], cues: ['Chest to floor','Jump or step up'], substitution: ['bodyweight-squat','mountain-climbers','thruster'], progression: 'reps' },
  { id: 'farmer-carry', name: 'Farmer Carry', muscle: 'Full body', equipment: ['dumbbells'], level: 'Beginner', tags: ['compound','grip'], cues: ['Heavy pair','Shoulders packed','Walk tall'], substitution: ['plank','kettlebell-swing','bear-crawl','dumbbell-shrug','barbell-side-bend'], progression: 'time' },


  // ── Coverage-matrix fills (muscle x equipment) ──
  { id:'superman', name:'Superman Hold', muscle:'Back', equipment:['bodyweight'], level:'Beginner', tags:['core-stability','low-impact'], cues:['Lift chest and thighs','Long neck','Breathe through the hold'], substitution: ['bird-dog'], unilateral:false, progression:'time' },
  { id:'close-grip-push-up', name:'Close-Grip Push-up', muscle:'Arms', equipment:['bodyweight'], level:'Beginner', tags:['compound','push'], cues:['Hands under sternum','Elbows brush ribs','Body rigid'], substitution: ['push-up','tricep-dip-bench'], unilateral:false, supportsWeighted:true, progression:'reps', rom:true },
  { id:'cable-goblet-squat', name:'Cable Goblet Squat', muscle:'Legs', equipment:['cable'], level:'Beginner', tags:['compound'], cues:['Hold attachment at chest','Sit between the knees','Drive the floor away'], substitution: ['goblet-squat'], unilateral:false, progression:'load', rom:true },
  { id:'cable-leg-curl', name:'Standing Cable Leg Curl', muscle:'Glutes', equipment:['cable'], level:'Beginner', tags:['isolation'], cues:['Ankle strap','Curl heel to glute','Slow return'], substitution: ['nordic-curl'], unilateral:true, progression: 'load' },
  { id:'lying-leg-curl', name:'Lying Leg Curl (Machine)', muscle:'Glutes', equipment:['machine'], level:'Beginner', tags:['isolation'], cues:['Hips pinned down','No bouncing','Squeeze at the top'], substitution: ['nordic-curl'], unilateral:false, progression:'load' },
  { id:'cable-pull-through', name:'Cable Pull-Through', muscle:'Glutes', equipment:['cable'], level:'Beginner', tags:['compound'], cues:['Rope between legs','Hinge, don\'t squat','Squeeze glutes at lockout'], substitution: ['hip-thrust','romanian-deadlift'], unilateral:false, progression:'load', rom:true },
  { id:'machine-shoulder-press', name:'Machine Shoulder Press', muscle:'Shoulders', equipment:['machine'], level:'Beginner', tags:['compound','push'], cues:['Handles at ear height','Press without shrugging','Control down'], substitution: ['overhead-press-dumbbell'], unilateral:false, progression:'load' },
  { id:'reverse-pec-deck', name:'Reverse Pec Deck', muscle:'Shoulders', equipment:['machine'], level:'Beginner', tags:['isolation','pull'], cues:['Arms slightly bent','Lead with pinkies','Squeeze rear delts'], substitution: ['rear-delt-fly','face-pull'], unilateral:false, progression:'load' },
  { id:'barbell-curl', name: 'Barbell Curl', muscle:'Arms', equipment:['barbell'], level:'Beginner', tags:['isolation'], cues:['Shoulder-width grip','Elbows pinned','No hip drive'], substitution: ['bicep-curl'], unilateral:false, progression:'load' },
  { id:'preacher-curl-machine', name:'Preacher Curl (Machine)', muscle:'Arms', equipment:['machine'], level:'Beginner', tags:['isolation'], cues:['Armpits over pad','Full stretch','No elbow drift'], substitution: ['bicep-curl','hammer-curl','preacher-curl-machine'], unilateral:true, progression:'load' },
  { id:'skullcrusher', name:'Barbell Skullcrusher', muscle:'Arms', equipment:['barbell'], level:'Intermediate', tags:['isolation','push'], cues:['Upper arms vertical','Lower behind the head','Protect the elbows'], substitution: ['tricep-pushdown','overhead-tricep-extension'], unilateral:false, progression:'load' },
  { id:'machine-dip', name:'Machine Dip', muscle:'Arms', equipment:['machine'], level:'Beginner', tags:['compound','push'], cues:['Slight forward lean','Elbows track back','Full lockout'], substitution: ['tricep-dip-bench','tricep-pushdown'], unilateral:false, progression:'load' },
  { id:'barbell-side-bend', name:'Barbell Side Bend', muscle:'Core', equipment:['barbell'], level:'Beginner', tags:['core-stability'], cues:['Bar on traps or at side','Bend purely sideways','No forward lean'], substitution: ['farmer-carry','side-plank'], unilateral:true, progression:'load' },
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map(e => [e.id, e]));

// Programme templates — reusable blueprints that can be instantiated with different start dates / tweaks.
// level/goal/daysPerWeek drive template recommendation; version drives template versioning.
export const PROGRAM_TEMPLATES = [
  { id: 'tpl-starter', programId: 'starter-3x', name: 'Starter Template', description: '3× full-body, minimal kit — good default for most users.', level: 'Beginner', goal: 'general', daysPerWeek: 3, version: 1 },
  { id: 'tpl-strength', programId: 'strength-4x', name: 'Strength Template', description: 'Upper/lower 4×, heavier compounds first.', level: 'Intermediate', goal: 'strength', daysPerWeek: 4, version: 1 },
  { id: 'tpl-anywhere', programId: 'move-anywhere', name: 'Anywhere Template', description: 'Bodyweight + bands only.', level: 'Beginner', goal: 'endurance', daysPerWeek: 3, version: 1 },
  { id: 'tpl-gym-full', programId: 'gym-full-4x', name: 'Full Gym Split', description: '4× upper/lower on machines, cables and free weights — full-kit gyms.', level: 'Intermediate', goal: 'muscle', daysPerWeek: 4, version: 1 },
  { id: 'tpl-home-db', programId: 'home-dumbbell-3x', name: 'Home Dumbbell Builder', description: '3× full-body around a dumbbell pair and bench.', level: 'Beginner', goal: 'muscle', daysPerWeek: 3, version: 1 },
];

// Template version history (append-only). Program-level versions live in PROGRAM_VERSION_HISTORY.
export const TEMPLATE_VERSION_HISTORY = [
  { templateId: 'tpl-starter', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
  { templateId: 'tpl-strength', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
  { templateId: 'tpl-anywhere', version: 1, date: '2026-08-13', changes: 'Template engine: equipment-aware instantiation with substitution, profile-based recommendation.' },
];

export function templateHistory(templateId){
  return TEMPLATE_VERSION_HISTORY.filter(h=> h.templateId===templateId).sort((a,b)=> a.version - b.version);
}

export function searchExercises({ q = '', muscle = '', equipment = '', level = '', tag = '', availableEquipment = null }) {
  const qq = q.trim().toLowerCase();
  const tagList = Array.isArray(tag) ? tag : (tag ? [tag] : []);
  return EXERCISES.filter(e => {
    if (qq && !(e.name.toLowerCase().includes(qq) || e.muscle.toLowerCase().includes(qq) || e.id.includes(qq))) return false;
    if (muscle && e.muscle !== muscle) return false;
    if (level && e.level !== level) return false;
    // AND semantics: every selected tag must be present (chips narrow the set).
    if (tagList.length && !tagList.every(t => (e.tags || []).includes(t))) return false;
    if (equipment) {
      if (!e.equipment.includes(equipment)) return false;
    }
    if (availableEquipment && availableEquipment.length) {
      const has = new Set(availableEquipment);
      const doable = e.equipment.every(eq => has.has(eq));
      const bodyOnly = e.equipment.length === 1 && e.equipment[0] === 'bodyweight';
      if (!doable && !bodyOnly) return false;
    }
    return true;
  });
}

export function recommendExercises({ goal, availableEquipment, limit = 8 }) {
  let pool = searchExercises({ availableEquipment });
  const bias = {
    strength: ['Legs','Back','Chest','Shoulders'],
    muscle: ['Chest','Back','Legs','Glutes','Shoulders','Arms'],
    endurance: ['Cardio','Full body','Legs','Core'],
    'fat-loss': ['Full body','Cardio','Legs','Core'],
    general: MUSCLES,
  }[goal] || MUSCLES;
  pool.sort((a,b) => bias.indexOf(a.muscle) - bias.indexOf(b.muscle));
  const minimal = !availableEquipment || availableEquipment.length <= 2;
  if (minimal) pool.sort((a,b) => (a.level === 'Beginner' ? -1 : 1));
  return pool.slice(0, limit);
}

// Programmes are scheduled training: each program has weeks → workouts → blocks.
export const PROGRAMS = [
  {
    id: 'starter-3x',
    name: 'Starter 3×Week',
    tagline: 'Full-body, minimal kit. Consistency over intensity.',
    level: 'Beginner',
    daysPerWeek: 3,
    mesocycle: { weeks: 4, deloadWeek: 4, progression: 'linear' },
    version: 2,
    equipment: ['bodyweight','dumbbells','bench','bands'],
    weeks: [
      {
        week: 1,
        workouts: [
          { day: 1, title: 'Push + Legs', blocks: [
            { exerciseId: 'bodyweight-squat', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bodyweight' },
            { exerciseId: 'push-up', sets: 3, reps: '6–12', restSec: 90, loadHint: 'bodyweight' },
            { exerciseId: 'dumbbell-row', sets: 3, reps: '8–12 each', restSec: 90, loadHint: 'light dumbbells' },
            { exerciseId: 'plank', sets: 3, reps: '30–45s', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 2, title: 'Hinge + Pull', blocks: [
            { exerciseId: 'romanian-deadlift', sets: 3, reps: '8–10', restSec: 90, loadHint: 'light pair' },
            { exerciseId: 'band-row', sets: 3, reps: '12–15', restSec: 60, loadHint: 'band' },
            { exerciseId: 'glute-bridge', sets: 3, reps: '10–15', restSec: 60, loadHint: 'bodyweight' },
            { exerciseId: 'dead-bug', sets: 3, reps: '8 each', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 3, title: 'Conditioning + Core', blocks: [
            { exerciseId: 'brisk-walk', sets: 1, reps: '20 min', restSec: 0, loadHint: 'outdoors' },
            { exerciseId: 'lunge', sets: 3, reps: '8 each', restSec: 90, loadHint: 'bodyweight' },
            { exerciseId: 'overhead-press-dumbbell', sets: 3, reps: '8–12', restSec: 90, loadHint: 'light' },
            { exerciseId: 'plank', sets: 3, reps: '30–45s', restSec: 60, loadHint: 'bodyweight' },
          ]},
        ]
      },
      {
        week: 2,
        workouts: [
          { day: 1, title: 'Push + Legs', blocks: [
            { exerciseId: 'goblet-squat', sets: 3, reps: '8–10', restSec: 90, loadHint: 'one dumbbell' },
            { exerciseId: 'push-up', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bodyweight' },
            { exerciseId: 'dumbbell-row', sets: 3, reps: '8–12 each', restSec: 90, loadHint: 'moderate' },
            { exerciseId: 'plank', sets: 3, reps: '35–50s', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 2, title: 'Hinge + Pull', blocks: [
            { exerciseId: 'romanian-deadlift', sets: 3, reps: '8–10', restSec: 90, loadHint: 'moderate pair' },
            { exerciseId: 'band-row', sets: 3, reps: '12–15', restSec: 60, loadHint: 'band' },
            { exerciseId: 'hip-thrust', sets: 3, reps: '10–12', restSec: 75, loadHint: 'bench + dumbbell' },
            { exerciseId: 'dead-bug', sets: 3, reps: '10 each', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 3, title: 'Conditioning + Core', blocks: [
            { exerciseId: 'run-easy', sets: 1, reps: '15–20 min', restSec: 0, loadHint: 'easy pace' },
            { exerciseId: 'split-squat', sets: 3, reps: '6–8 each', restSec: 90, loadHint: 'bodyweight' },
            { exerciseId: 'overhead-press-dumbbell', sets: 3, reps: '8–12', restSec: 90, loadHint: 'light' },
            { exerciseId: 'hanging-knee-raise', sets: 3, reps: '6–10', restSec: 90, loadHint: 'bar, or plank sub' },
          ]},
        ]
      },
    ],
  },
  {
    id: 'strength-4x',
    name: 'Strength 4×Week',
    tagline: 'Upper / lower split. Barbell when available, dumbbell subs included.',
    level: 'Intermediate',
    daysPerWeek: 4,
    mesocycle: { weeks: 4, deloadWeek: 4, progression: 'weekly-load' },
    version: 2,
    equipment: ['barbell','dumbbells','bench','pullup-bar'],
    weeks: [
      {
        week: 1,
        workouts: [
          { day: 1, title: 'Lower A', blocks: [
            { exerciseId: 'barbell-squat', sets: 4, reps: '5', restSec: 150, loadHint: 'barbell — leave 2 in tank' },
            { exerciseId: 'romanian-deadlift', sets: 3, reps: '6–8', restSec: 120, loadHint: 'barbell or dumbbells' },
            { exerciseId: 'lunge', sets: 3, reps: '8 each', restSec: 90, loadHint: 'dumbbells optional' },
            { exerciseId: 'plank', sets: 3, reps: '40s', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 2, title: 'Upper A', blocks: [
            { exerciseId: 'bench-press-barbell', sets: 4, reps: '5', restSec: 150, loadHint: 'barbell' },
            { exerciseId: 'pull-up', sets: 4, reps: '3–6', restSec: 120, loadHint: 'bar, band assist ok' },
            { exerciseId: 'overhead-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'bicep-curl', sets: 3, reps: '10–12', restSec: 60, loadHint: 'dumbbells' },
          ]},
          { day: 3, title: 'Lower B', blocks: [
            { exerciseId: 'goblet-squat', sets: 3, reps: '8–10', restSec: 90, loadHint: 'heavy dumbbell' },
            { exerciseId: 'hip-thrust', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bench' },
            { exerciseId: 'split-squat', sets: 3, reps: '6–8 each', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'dead-bug', sets: 3, reps: '10 each', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 4, title: 'Upper B', blocks: [
            { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'dumbbell-row', sets: 3, reps: '8–10 each', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'lateral-raise', sets: 3, reps: '12–15', restSec: 60, loadHint: 'light' },
            { exerciseId: 'hanging-knee-raise', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bar' },
          ]},
        ]
      },
      {
        week: 2,
        workouts: [
          { day: 1, title: 'Lower A +5%', blocks: [
            { exerciseId: 'barbell-squat', sets: 4, reps: '4–5', restSec: 150, loadHint: 'add a little if form held' },
            { exerciseId: 'romanian-deadlift', sets: 3, reps: '6–8', restSec: 120, loadHint: 'progress load' },
            { exerciseId: 'lunge', sets: 3, reps: '8 each', restSec: 90, loadHint: 'dumbbells optional' },
            { exerciseId: 'plank', sets: 3, reps: '45s', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 2, title: 'Upper A', blocks: [
            { exerciseId: 'bench-press-barbell', sets: 4, reps: '4–5', restSec: 150, loadHint: 'barbell' },
            { exerciseId: 'pull-up', sets: 4, reps: '4–7', restSec: 120, loadHint: 'progression target +1 rep' },
            { exerciseId: 'overhead-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'bicep-curl', sets: 3, reps: '10–12', restSec: 60, loadHint: 'dumbbells' },
          ]},
          { day: 3, title: 'Lower B', blocks: [
            { exerciseId: 'goblet-squat', sets: 3, reps: '8–10', restSec: 90, loadHint: 'heavy dumbbell' },
            { exerciseId: 'hip-thrust', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bench' },
            { exerciseId: 'split-squat', sets: 3, reps: '6–8 each', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'dead-bug', sets: 3, reps: '10 each', restSec: 60, loadHint: 'bodyweight' },
          ]},
          { day: 4, title: 'Upper B', blocks: [
            { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'dumbbell-row', sets: 3, reps: '8–10 each', restSec: 90, loadHint: 'dumbbells' },
            { exerciseId: 'lateral-raise', sets: 3, reps: '12–15', restSec: 60, loadHint: 'light' },
            { exerciseId: 'hanging-knee-raise', sets: 3, reps: '8–12', restSec: 90, loadHint: 'bar' },
          ]},
        ]
      },
    ],
  },
  {
    id: 'move-anywhere',
    name: 'Move Anywhere',
    tagline: 'Bodyweight + bands. For gyms, parks, and tight spaces.',
    level: 'Beginner',
    daysPerWeek: 3,
    mesocycle: { weeks: 3, deloadWeek: null, progression: 'reps' },
    version: 2,
    equipment: ['bodyweight','bands'],
    weeks: [
      {
        week: 1,
        workouts: [
          { day: 1, title: 'Body foundations', blocks: [
            { exerciseId: 'bodyweight-squat', sets: 3, reps: '12–15', restSec: 60, loadHint: 'bodyweight' },
            { exerciseId: 'push-up', sets: 3, reps: '6–12', restSec: 75, loadHint: 'bodyweight, incline if needed' },
            { exerciseId: 'band-row', sets: 3, reps: '12–15', restSec: 60, loadHint: 'band' },
            { exerciseId: 'plank', sets: 3, reps: '30–45s', restSec: 45, loadHint: 'bodyweight' },
          ]},
          { day: 2, title: 'Move & breathe', blocks: [
            { exerciseId: 'brisk-walk', sets: 1, reps: '20–30 min', restSec: 0, loadHint: 'outside' },
            { exerciseId: 'glute-bridge', sets: 3, reps: '12–15', restSec: 45, loadHint: 'bodyweight' },
            { exerciseId: 'band-lateral-raise', sets: 3, reps: '12–15', restSec: 45, loadHint: 'band' },
            { exerciseId: 'dead-bug', sets: 3, reps: '8 each', restSec: 45, loadHint: 'bodyweight' },
          ]},
          { day: 3, title: 'Circuit', blocks: [
            { exerciseId: 'lunge', sets: 3, reps: '8 each', restSec: 60, loadHint: 'bodyweight' },
            { exerciseId: 'incline-push-up', sets: 3, reps: '8–12', restSec: 60, loadHint: 'bodyweight' },
            { exerciseId: 'band-curl', sets: 3, reps: '12–15', restSec: 45, loadHint: 'band' },
            { exerciseId: 'jump-rope', sets: 3, reps: '60s', restSec: 45, loadHint: 'rope or imaginary' },
          ]},
        ]
      },
      { week: 2, workouts: [
        { day: 1, title: 'Body foundations +1', blocks: [
          { exerciseId: 'bodyweight-squat', sets: 3, reps: '15–18', restSec: 60, loadHint: 'add a rep each set' },
          { exerciseId: 'push-up', sets: 3, reps: '8–14', restSec: 75, loadHint: 'bodyweight' },
          { exerciseId: 'band-row', sets: 3, reps: '15–18', restSec: 60, loadHint: 'band' },
          { exerciseId: 'plank', sets: 3, reps: '40–50s', restSec: 45, loadHint: 'bodyweight' },
        ]},
        { day: 2, title: 'Move & breathe', blocks: [
          { exerciseId: 'brisk-walk', sets: 1, reps: '25–35 min', restSec: 0, loadHint: 'outside' },
          { exerciseId: 'glute-bridge', sets: 3, reps: '15–18', restSec: 45, loadHint: 'bodyweight' },
          { exerciseId: 'band-lateral-raise', sets: 3, reps: '12–15', restSec: 45, loadHint: 'band' },
          { exerciseId: 'dead-bug', sets: 3, reps: '10 each', restSec: 45, loadHint: 'bodyweight' },
        ]},
        { day: 3, title: 'Circuit', blocks: [
          { exerciseId: 'lunge', sets: 3, reps: '10 each', restSec: 60, loadHint: 'bodyweight' },
          { exerciseId: 'incline-push-up', sets: 3, reps: '10–14', restSec: 60, loadHint: 'bodyweight' },
          { exerciseId: 'band-curl', sets: 3, reps: '15–18', restSec: 45, loadHint: 'band' },
          { exerciseId: 'jump-rope', sets: 3, reps: '75s', restSec: 45, loadHint: 'rope' },
        ]},
      ]},
    ],
  },
];



// ── Full Gym Split (4×, full kit) ───────────────────────────────────────
PROGRAMS.push({
  id: 'gym-full-4x',
  name: 'Full Gym 4×Week',
  tagline: 'Upper/lower on the good machines. Rotate cables in for volume.',
  level: 'Intermediate',
  daysPerWeek: 4,
  mesocycle: { weeks: 4, deloadWeek: 4, progression: 'weekly-load' },
  version: 1,
  equipment: ['barbell','dumbbells','bench','machine','cable','pullup-bar'],
  weeks: [
    { week: 1, workouts: [
      { day: 1, title: 'Lower A', blocks: [
        { exerciseId: 'barbell-squat', sets: 4, reps: '5', restSec: 150, loadHint: 'leave 2 reps in tank' },
        { exerciseId: 'leg-press', sets: 3, reps: '10–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'nordic-curl', sets: 3, reps: '4–6', restSec: 90, loadHint: 'bodyweight' },
        { exerciseId: 'calf-raise', sets: 3, reps: '12–15', restSec: 45, loadHint: 'dumbbells' },
      ]},
      { day: 2, title: 'Upper A', blocks: [
        { exerciseId: 'bench-press-barbell', sets: 4, reps: '6–8', restSec: 150, loadHint: 'barbell' },
        { exerciseId: 'lat-pulldown', sets: 3, reps: '10–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'overhead-press-barbell', sets: 3, reps: '6–8', restSec: 120, loadHint: 'barbell' },
        { exerciseId: 'face-pull', sets: 3, reps: '15', restSec: 60, loadHint: 'cable or band' },
      ]},
      { day: 3, title: 'Lower B', blocks: [
        { exerciseId: 'sumo-deadlift', sets: 3, reps: '5–6', restSec: 150, loadHint: 'barbell' },
        { exerciseId: 'hip-abduction-machine', sets: 3, reps: '12–15', restSec: 60, loadHint: 'machine' },
        { exerciseId: 'leg-raise', sets: 3, reps: '8–12', restSec: 60, loadHint: 'bar' },
      ]},
      { day: 4, title: 'Upper B', blocks: [
        { exerciseId: 'cable-row', sets: 4, reps: '8–10', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'incline-dumbbell-press', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
        { exerciseId: 'tricep-pushdown', sets: 3, reps: '12–15', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'hammer-curl', sets: 3, reps: '10–12', restSec: 60, loadHint: 'dumbbells' },
      ]},
    ]},
    { week: 2, workouts: [
      { day: 1, title: 'Lower A +reps', blocks: [
        { exerciseId: 'barbell-squat', sets: 4, reps: '6', restSec: 150, loadHint: 'add a rep per set' },
        { exerciseId: 'step-up', sets: 3, reps: '10 each', restSec: 90, loadHint: 'dumbbells' },
        { exerciseId: 'nordic-curl', sets: 3, reps: '5–7', restSec: 90, loadHint: 'bodyweight' },
      ]},
      { day: 2, title: 'Upper A', blocks: [
        { exerciseId: 'bench-press-barbell', sets: 4, reps: '7–8', restSec: 150, loadHint: 'progress load' },
        { exerciseId: 'straight-arm-pulldown', sets: 3, reps: '12–15', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'arnold-press', sets: 3, reps: '8–10', restSec: 90, loadHint: 'dumbbells' },
        { exerciseId: 'rear-delt-fly', sets: 3, reps: '15', restSec: 45, loadHint: 'light pair' },
      ]},
      { day: 3, title: 'Lower B', blocks: [
        { exerciseId: 'front-squat', sets: 3, reps: '6', restSec: 150, loadHint: 'barbell, elbows high' },
        { exerciseId: 'hip-thrust', sets: 3, reps: '10–12', restSec: 90, loadHint: 'bench + barbell' },
        { exerciseId: 'pallof-press', sets: 3, reps: '12 each', restSec: 45, loadHint: 'cable' },
      ]},
      { day: 4, title: 'Upper B', blocks: [
        { exerciseId: 'single-arm-cable-row', sets: 3, reps: '10 each', restSec: 75, loadHint: 'cable' },
        { exerciseId: 'dumbbell-fly', sets: 3, reps: '12–15', restSec: 60, loadHint: 'dumbbells' },
        { exerciseId: 'overhead-tricep-extension', sets: 3, reps: '12', restSec: 60, loadHint: 'one dumbbell' },
        { exerciseId: 'bicep-curl', sets: 3, reps: '12', restSec: 60, loadHint: 'dumbbells' },
      ]},
    ]},
  ],
});
// Fix an accidental stray key from authoring above.
{
  const gf = PROGRAMS[PROGRAMS.length - 1];
  const lowerA = gf.weeks[0].workouts[0].blocks.find(b => b.exerciseId === 'calf-raise');
  if(lowerA && 'id' in lowerA) delete lowerA.id;
}

// ── Home Dumbbell Builder (3×) ─────────────────────────────────────────
PROGRAMS.push({
  id: 'home-dumbbell-3x',
  name: 'Home Dumbbell Builder',
  tagline: 'One dumbbell pair, one bench, steady progress.',
  level: 'Beginner',
  daysPerWeek: 3,
  mesocycle: { weeks: 4, deloadWeek: 4, progression: 'double-progression' },
  version: 1,
  equipment: ['dumbbells','bench','bodyweight'],
  weeks: [
    { week: 1, workouts: [
      { day: 1, title: 'Push + Legs', blocks: [
        { exerciseId: 'goblet-squat', sets: 3, reps: '8–10', restSec: 90, loadHint: 'one dumbbell' },
        { exerciseId: 'bench-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'split-squat', sets: 2, reps: '8 each', restSec: 75, loadHint: 'pair' },
        { exerciseId: 'side-plank', sets: 2, reps: '30s each', restSec: 30, loadHint: 'bodyweight' },
      ]},
      { day: 2, title: 'Pull + Hinge', blocks: [
        { exerciseId: 'dumbbell-row', sets: 3, reps: '10 each', restSec: 75, loadHint: 'pair' },
        { exerciseId: 'romanian-deadlift', sets: 3, reps: '10', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'bird-dog', sets: 2, reps: '8 each', restSec: 30, loadHint: 'bodyweight' },
      ]},
      { day: 3, title: 'Shoulders + Arms', blocks: [
        { exerciseId: 'overhead-press-dumbbell', sets: 3, reps: '8–10', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'lunge', sets: 3, reps: '10 each', restSec: 75, loadHint: 'pair' },
        { exerciseId: 'hammer-curl', sets: 2, reps: '12', restSec: 45, loadHint: 'pair' },
        { exerciseId: 'overhead-tricep-extension', sets: 2, reps: '12', restSec: 45, loadHint: 'one dumbbell' },
      ]},
    ]},
    { week: 2, workouts: [
      { day: 1, title: 'Push + Legs', blocks: [
        { exerciseId: 'step-up', sets: 3, reps: '10 each', restSec: 75, loadHint: 'pair' },
        { exerciseId: 'incline-dumbbell-press', sets: 3, reps: '10', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'glute-bridge', sets: 3, reps: '15', restSec: 45, loadHint: 'bodyweight' },
      ]},
      { day: 2, title: 'Pull + Hinge', blocks: [
        { exerciseId: 'chest-supported-row', sets: 3, reps: '10', restSec: 75, loadHint: 'pair + bench' },
        { exerciseId: 'good-morning', sets: 2, reps: '10', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'bear-crawl', sets: 2, reps: '30s', restSec: 45, loadHint: 'bodyweight' },
      ]},
      { day: 3, title: 'Shoulders + Conditioning', blocks: [
        { exerciseId: 'pike-push-up', sets: 3, reps: '6–10', restSec: 75, loadHint: 'bodyweight' },
        { exerciseId: 'thruster', sets: 3, reps: '8', restSec: 90, loadHint: 'pair' },
        { exerciseId: 'farmer-carry', sets: 3, reps: '40s', restSec: 60, loadHint: 'heavy pair' },
      ]},
    ]},
  ],
});

// Programme version history (append-only)
export const PROGRAM_VERSION_HISTORY = [
  { programId: 'starter-3x', version: 1, date: '2026-01-01', changes: 'Initial release — 2 weeks, full-body.' },
  { programId: 'starter-3x', version: 2, date: '2026-08-10', changes: 'Added mesocycle metadata, progression fields, videoUrl slots.' },
  { programId: 'strength-4x', version: 1, date: '2026-01-01', changes: 'Initial release — upper/lower 2 weeks.' },
  { programId: 'strength-4x', version: 2, date: '2026-08-10', changes: 'Added mesocycle (4-week, weekly-load progression), version bump.' },
  { programId: 'move-anywhere', version: 1, date: '2026-01-01', changes: 'Initial release — bodyweight + bands.' },
  { programId: 'move-anywhere', version: 2, date: '2026-08-10', changes: 'Added mesocycle, version bump.' },
  { programId: 'gym-full-4x', version: 1, date: '2026-08-22', changes: 'Initial release — full-kit upper/lower split using machines, cables and free weights.' },
  { programId: 'home-dumbbell-3x', version: 1, date: '2026-08-22', changes: 'Initial release — dumbbell pair + bench full-body builder.' },
];

export function programHistory(programId){
  return PROGRAM_VERSION_HISTORY.filter(h=> h.programId===programId).sort((a,b)=> a.version - b.version);
}

// Equipment constraints: can this exercise be performed with the user's kit?
export function exerciseAvailable(exerciseId, availableEquipment){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return false;
  if(!availableEquipment || !availableEquipment.length) return true;
  const has = new Set(availableEquipment);
  const doable = ex.equipment.every(eq=> has.has(eq));
  if(doable) return true;
  const bodyOnly = ex.equipment.length===1 && ex.equipment[0]==='bodyweight';
  return bodyOnly;
}

// Filter programs to those actually doable with user's equipment.
export function availablePrograms(availableEquipment) {
  if (!availableEquipment || !availableEquipment.length) return PROGRAMS;
  const has = new Set(availableEquipment);
  return PROGRAMS.filter(p => p.equipment.every(eq => has.has(eq) || eq === 'bodyweight'));
}

// Schedule helpers: turn a program into dated sessions so "programs = scheduled training".
// A caller may pass `program` directly (custom/user templates that live outside
// PROGRAMS); it must follow the same shape (id, weeks, mesocycle, version).
export function scheduleProgram({ programId, startDateISO, program = null }) {
  const prog = program || PROGRAM_BY_ID[programId];
  if (!prog) throw new Error(`Unknown program ${programId}`);
  // Use UTC date arithmetic so a schedule never shifts by a day on devices
  // west of UTC (the ISO date is a calendar date, not a local timestamp).
  const start = new Date(startDateISO + 'T00:00:00Z');
  const sessions = [];
  let cursor = new Date(start);
    for (const wk of prog.weeks) {
    for (const w of wk.workouts) {
      sessions.push({
        id: `${programId}-w${wk.week}-d${w.day}`,
        programId,
        week: wk.week,
        day: w.day,
        title: w.title,
        dateISO: toISO(cursor),
        blocks: w.blocks.map(b=> ({ ...b, version: prog.version || 1 })),
        status: 'planned',
      });
      cursor.setUTCDate(cursor.getUTCDate() + 2);
    }
    const nextWeekStart = new Date(start);
    nextWeekStart.setUTCDate(start.getUTCDate() + wk.week * 7);
    if (cursor < nextWeekStart) cursor = nextWeekStart;
  }
  return { programId, startDateISO, sessions, programVersion: prog.version || 1 };
}

// Planned vs completed comparison
export function plannedVsCompleted(schedule, history){
  const byId = new Map((history||[]).map(h=> [h.id, h]));
  return (schedule?.sessions||[]).map(s=>{
    const actual = byId.get(s.id) || null;
    if(!actual) return { session: s, status: s.status, completed: false, delta: null };
    const plannedSets = s.blocks.reduce((a,b)=> a + (Number(b.sets)||0), 0);
    const actualSets = (actual.blocks||[]).reduce((a,b)=> a + (b.sets||[]).length, 0);
    // Planned volume is only computable when the hint states an explicit load
    // ("20kg"). Parsing any digit out of prose ("leave 2 in tank") produced noise.
    const plannedVol = s.blocks.reduce((a,b)=>{
      const kg = Number(String(b.loadHint||'').match(/(\d+(?:\.\d+)?)\s*kg/i)?.[1]);
      const reps = Number(String(b.reps).match(/\d+/)?.[0]||0)||0;
      return a + (Number.isFinite(kg) ? reps*kg : 0);
    }, 0);
    const hasPlannedLoad = s.blocks.some(b=> /(\d+(?:\.\d+)?)\s*kg/i.test(String(b.loadHint||'')));
    const actualVol = (actual.blocks||[]).reduce((a,b)=> a + b.sets.reduce((x,s)=> x + (Number(s.reps)||0)*(Number(s.weightKg)||0),0),0);
    return { session: s, status: 'done', completed: true, actual, delta: { sets: actualSets - plannedSets, volumeKg: hasPlannedLoad ? Math.round(actualVol - plannedVol) : null } };
  });
}

// Format the local calendar date instead of slicing toISOString(). The latter
// can move a midnight schedule back one day on devices west of UTC.
function toISO(d){
  const pad = value=> String(value).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

// Simple content validation used by scripts/lint-content.mjs
export function validateContent(){
  const errors=[];
  const ids = new Set();
  const names = new Map();
  for(const e of EXERCISES){
    if(ids.has(e.id)) errors.push(`Duplicate exercise id ${e.id}`);
    ids.add(e.id);
    // Display names must be unique: the browser, swap UI and history views all
    // identify exercises by name, and duplicate names fragment PR history.
    if(names.has(e.name)) errors.push(`Duplicate exercise name "${e.name}" (${e.id} and ${names.get(e.name)})`);
    names.set(e.name, e.id);
    if(!MUSCLES.includes(e.muscle)) errors.push(`Exercise ${e.id} has unknown muscle ${e.muscle}`);
    if(!LEVELS.includes(e.level)) errors.push(`Exercise ${e.id} has unknown level ${e.level}`);
    if(!Array.isArray(e.tags) || e.tags.length===0) errors.push(`Exercise ${e.id} declares no tags — every exercise needs at least one browsing tag`);
    else for(const tag of e.tags){
      if(!EXERCISE_TAG_IDS.includes(tag)) errors.push(`Exercise ${e.id} has unknown tag "${tag}"`);
    }
    for(const eq of e.equipment){
      if(!EQUIPMENT.some(x=>x.id===eq)) errors.push(`Exercise ${e.id} has unknown equipment ${eq}`);
    }
    if(e.videoUrl && !/^https:\/\//.test(e.videoUrl)) errors.push(`Exercise ${e.id} has non-https videoUrl`);
    if(!Array.isArray(e.substitution) || e.substitution.length===0) errors.push(`Exercise ${e.id} declares no substitutions — every exercise needs an alternative chain`);
  }
  // Substitution graph integrity: every target must exist, and the relation is
  // reciprocal (A lists B ⇒ B lists A). A dangling or one-way edge silently
  // degrades the swap UI and generated-programme fallbacks.
  for(const e of EXERCISES){
    for(const targetId of e.substitution||[]){
      const target = EXERCISE_BY_ID[targetId];
      if(!target){ errors.push(`Exercise ${e.id} substitutes unknown exercise ${targetId}`); continue; }
      if(!(target.substitution||[]).includes(e.id)) errors.push(`Substitution not reciprocal: ${e.id} → ${targetId}, but ${targetId} does not list ${e.id}`);
    }
  }
  for(const p of PROGRAMS){
    for(const w of p.weeks) for(const wk of w.workouts) for(const b of wk.blocks){
      if(!EXERCISE_BY_ID[b.exerciseId]) errors.push(`Program ${p.id} references unknown exercise ${b.exerciseId}`);
    }
  }
  for(const t of PROGRAM_TEMPLATES){
    if(!PROGRAM_BY_ID[t.programId]) errors.push(`Template ${t.id} references unknown program ${t.programId}`);
    if(!LEVELS.includes(t.level)) errors.push(`Template ${t.id} has unknown level ${t.level}`);
    if(!GOALS.some(g=> g.id===t.goal)) errors.push(`Template ${t.id} has unknown goal ${t.goal}`);
  }
  return errors;
}

export const PROGRAM_BY_ID = Object.fromEntries(PROGRAMS.map(p => [p.id, p]));
