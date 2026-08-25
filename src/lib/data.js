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
  { id: 'mobility', label: 'Mobility' },
];
export const EXERCISE_TAG_IDS = EXERCISE_TAGS.map(t => t.id);

// Hand-curated exercise library. Each entry declares equipment so onboarding can
// gate recommendations honestly, and tags so the browser can slice by intent.
// Substitution edges must stay reciprocal (A lists B ⇒ B lists A) — enforced by validateContent().
export const EXERCISES = [
  // ── Chest
  { id: 'push-up', name: 'Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound','push'], cues: ['Hands under shoulders','Body in a straight line','Chest to floor'], substitution: ['bench-press-dumbbell', 'chest-press-machine', 'bench-press-barbell', 'incline-push-up', 'overhead-press-dumbbell', 'tricep-dip-bench', 'incline-dumbbell-press', 'decline-push-up', 'close-grip-push-up', 'tricep-pushdown','weighted-push-up','chest-dip','knee-push-up','wide-push-up','archer-push-up','typewriter-push-up','explosive-push-up','hindu-push-up','seal-jack'], unilateral: false, supportsWeighted: true, supportsAssisted: false, progression: 'reps', rom: true },
  { id: 'bench-press-barbell', name: 'Barbell Bench Press', muscle: 'Chest', equipment: ['barbell','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Feet planted','Retract shoulder blades','Bar to chest, press to lockout'], substitution: ['push-up', 'bench-press-dumbbell'], unilateral: false, progression: 'load', rom: true },
  { id: 'bench-press-dumbbell', name: 'Dumbbell Bench Press', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','push'], cues: ['Neutral wrists','Control the descent'], substitution: ['push-up', 'bench-press-barbell', 'incline-dumbbell-press', 'dumbbell-fly','decline-dumbbell-press'], unilateral: false, progression: 'load', rom: true },
  { id: 'incline-push-up', name: 'Incline Push-up', muscle: 'Chest', equipment: ['bodyweight','bench'], level: 'Beginner', tags: ['compound','push','low-impact'], cues: ['Hands elevated','Easier than floor push-ups'], substitution: ['push-up'], unilateral: false, supportsWeighted: true, progression: 'reps' },
  { id: 'chest-press-machine', name: 'Chest Press (Machine)', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['compound','push'], cues: ['Seat height so handles at chest'], substitution: ['push-up', 'cable-fly', 'machine-fly'], progression: 'load' },
  { id: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Bench at 30°','Palms forward','Control stretch at bottom'], substitution: ['bench-press-dumbbell', 'push-up','bench-press','incline-bench-press','decline-bench-press','decline-dumbbell-press'], progression: 'load', rom: true },
  { id: 'decline-push-up', name: 'Decline Push-up', muscle: 'Chest', equipment: ['bodyweight','bench'], level: 'Intermediate', tags: ['compound','push'], cues: ['Feet elevated','Body rigid','Lower chest to floor'], substitution: ['push-up'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'dumbbell-fly', name: 'Dumbbell Fly', muscle: 'Chest', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['isolation','push'], cues: ['Soft elbows','Wide arc','Stretch, don\'t strain'], substitution: ['bench-press-dumbbell', 'cable-fly', 'machine-fly'], unilateral: false, progression: 'load', rom: true },
  { id: 'cable-fly', name: 'Cable Fly', muscle: 'Chest', equipment: ['cable'], level: 'Beginner', tags: ['isolation','push'], cues: ['Constant tension','Squeeze at midline'], substitution: ['dumbbell-fly', 'machine-fly', 'chest-press-machine','incline-cable-fly'], unilateral: false, progression: 'load' },
  { id: 'machine-fly', name: 'Pec Deck (Machine)', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['isolation','push'], cues: ['Handles at chest height','Pause at squeeze'], substitution: ['cable-fly', 'dumbbell-fly', 'chest-press-machine'], unilateral: false, progression: 'load' },

  // ── Back
  { id: 'pull-up', name: 'Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['compound','pull','grip'], cues: ['Dead hang start','Chest to bar','No swinging'], substitution: ['band-row', 'dumbbell-row', 'lat-pulldown', 'chin-up', 'inverted-row','close-grip-lat-pulldown','weighted-pull-up','wide-grip-lat-pulldown','neutral-grip-pull-up'], supportsWeighted: true, supportsAssisted: true, progression: 'reps', rom: true },
  { id: 'band-row', name: 'Banded Row', muscle: 'Back', equipment: ['bands'], level: 'Beginner', tags: ['compound','pull'], cues: ['Hinge slightly','Pull elbows past torso'], substitution: ['dumbbell-row', 'pull-up', 'lat-pulldown', 'face-pull', 'cable-row', 'inverted-row'], progression: 'reps' },
  { id: 'dumbbell-row', name: 'Single-Arm Dumbbell Row', muscle: 'Back', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','pull','unilateral','grip'], cues: ['Flat back','Pull to hip'], substitution: ['band-row', 'pull-up', 'face-pull', 'cable-row', 'barbell-row', 'chest-supported-row', 'single-arm-cable-row'], unilateral: true, progression: 'load', rom: true },
  { id: 'lat-pulldown', name: 'Lat Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull'], cues: ['Lean slightly back','Pull to upper chest'], substitution: ['pull-up', 'band-row', 'straight-arm-pulldown', 'chin-up','close-grip-lat-pulldown','assisted-pull-up','weighted-pull-up','wide-grip-lat-pulldown','neutral-grip-pull-up','active-hang','scapular-pull-up','negative-pull-up','commando-pull-up','l-sit-pull-up','towel-pull-up','banded-lat-pulldown'], progression: 'load' },
  { id: 'chin-up', name: 'Chin-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['compound','pull','grip'], cues: ['Underhand grip','Drive elbows down','Chin clears bar'], substitution: ['pull-up', 'inverted-row', 'lat-pulldown','preacher-curl','cable-curl','assisted-chin-up','weighted-chin-up','incline-dumbbell-curl','concentration-curl','ez-bar-curl','spider-curl','rope-hammer-curl','drag-curl'], supportsWeighted: true, supportsAssisted: true, progression: 'reps', rom: true },
  { id: 'inverted-row', name: 'Inverted Row', muscle: 'Back', equipment: ['pullup-bar'], level: 'Beginner', tags: ['compound','pull','grip','low-impact'], cues: ['Body straight as a plank','Chest to bar','Walk feet out for difficulty'], substitution: ['band-row', 'pull-up', 'chin-up','childs-pose'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'barbell-row', name: 'Barbell Row', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], cues: ['Hinge to ~45°','Bar to lower ribs','No torso bounce'], substitution: ['dumbbell-row', 'cable-row','t-bar-row','dumbbell-bent-over-row','one-arm-dumbbell-row','machine-row','rowing','pendlay-row','meadows-row','rack-pull','swimming','skierg','doorway-row','towel-row','childs-pose'], unilateral: false, progression: 'load', rom: true },
  { id: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Arms locked long','Lats pull the bar to thighs'], substitution: ['lat-pulldown','close-grip-lat-pulldown'], unilateral: false, progression: 'load' },
  { id: 'cable-row', name: 'Seated Cable Row', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull'], cues: ['Chest proud','Elbows to ribs','Squeeze shoulder blades'], substitution: ['band-row', 'dumbbell-row', 'barbell-row', 'single-arm-cable-row', 'chest-supported-row'], unilateral: false, progression: 'load' },
  { id: 'single-arm-cable-row', name: 'Single-Arm Cable Row', muscle: 'Back', equipment: ['cable'], level: 'Beginner', tags: ['compound','pull','unilateral'], cues: ['Square hips','Row to the hip','Control the stretch'], substitution: ['cable-row', 'dumbbell-row'], unilateral: true, progression: 'load', rom: true },
  { id: 'chest-supported-row', name: 'Chest-Supported Dumbbell Row', muscle: 'Back', equipment: ['dumbbells','bench'], level: 'Beginner', tags: ['compound','pull','low-impact'], cues: ['Chest stays on the bench','Row with the elbows','No momentum'], substitution: ['dumbbell-row', 'cable-row','t-bar-row','machine-row'], unilateral: true, progression: 'load', rom: true },

  // ── Legs / Glutes
  { id: 'bodyweight-squat', name: 'Bodyweight Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound'], cues: ['Knees track toes','Depth to hip below knee if comfortable'], substitution: ['goblet-squat', 'barbell-squat', 'split-squat', 'burpee', 'wall-sit','jump-squat'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'goblet-squat', name: 'Goblet Squat', muscle: 'Legs', equipment: ['dumbbells','kettlebell'], level: 'Beginner', tags: ['compound'], cues: ['Elbows inside knees','Chest tall'], substitution: ['bodyweight-squat', 'barbell-squat', 'bulgarian-split-squat', 'step-up', 'front-squat', 'leg-press', 'cable-goblet-squat'], progression: 'load', rom: true },
  { id: 'barbell-squat', name: 'Barbell Back Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Brace hard','Hip hinge then knee bend'], substitution: ['goblet-squat', 'bodyweight-squat', 'front-squat', 'leg-press'], progression: 'load', rom: true },
  { id: 'front-squat', name: 'Barbell Front Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Elbows high','Upright torso','Wrists under the bar'], substitution: ['barbell-squat', 'goblet-squat','squat','landmine-squat'], unilateral: false, progression: 'load', rom: true },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', muscle: 'Glutes', equipment: ['dumbbells','barbell'], level: 'Intermediate', tags: ['compound'], cues: ['Soft knee','Hinge, hamstrings stretch','Neutral spine'], substitution: ['glute-bridge', 'kettlebell-swing', 'good-morning', 'sumo-deadlift', 'nordic-curl', 'cable-pull-through','leg-curl','seated-leg-curl','single-leg-romanian-deadlift','smith-machine-romanian-deadlift','dumbbell-romanian-deadlift','kettlebell-romanian-deadlift','landmine-romanian-deadlift','lying-hamstring-walkout','towel-hamstring-curl','stability-ball-hamstring-curl','hamstring-stretch','seated-forward-fold-stretch'], progression: 'load', rom: true },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', muscle: 'Glutes', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], cues: ['Wide stance','Knees track over toes','Lock hips and knees together'], substitution: ['romanian-deadlift', 'good-morning','deadlift','trap-bar-deadlift'], unilateral: false, progression: 'load', rom: true },
  { id: 'good-morning', name: 'Good Morning', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], cues: ['Bar on upper traps','Hinge back','Stop when hamstrings stop you'], substitution: ['romanian-deadlift', 'sumo-deadlift','landmine-romanian-deadlift'], unilateral: false, progression: 'load', rom: true },
  { id: 'nordic-curl', name: 'Nordic Hamstring Curl', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound'], cues: ['Anchor ankles','Lower as slowly as possible','Push back up from the floor'], substitution: ['romanian-deadlift', 'glute-bridge', 'cable-leg-curl', 'lying-leg-curl', 'lying-hamstring-walkout', 'hamstring-stretch', 'seated-forward-fold-stretch'], unilateral: false, progression: 'reps', rom: true },
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Glutes', equipment: ['bench'], level: 'Beginner', tags: ['compound'], cues: ['Shoulders on bench','Squeeze glutes at top'], substitution: ['glute-bridge', 'hip-abduction-machine', 'cable-pull-through','cable-kickback','single-leg-glute-bridge','barbell-glute-bridge','dumbbell-glute-bridge','dumbbell-hip-thrust','smith-machine-hip-thrust','machine-glute-kickback','cable-standing-hip-abduction','dumbbell-sumo-squat','deficit-reverse-lunge','dumbbell-curtsy-lunge','glute-focused-back-extension','reverse-hyperextension','curtsy-lunge','glute-bridge-march','frog-pump','donkey-kick','fire-hydrant','clamshell','hip-airplane','side-lying-hip-abduction','side-lying-leg-raise','banded-glute-bridge','banded-hip-thrust','banded-frog-pump','banded-clamshell','banded-lateral-walk','banded-monster-walk','banded-donkey-kick','banded-fire-hydrant','banded-kickback','banded-standing-hip-abduction','banded-seated-hip-abduction'], progression: 'load', rom: true },
  { id: 'leg-press', name: 'Leg Press (Machine)', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','low-impact'], cues: ['Feet shoulder-width','Knees track toes','Control the sled down'], substitution: ['barbell-squat', 'goblet-squat','hack-squat','leg-extension','smith-machine-squat','belt-squat','smith-machine-bulgarian-split-squat','smith-machine-reverse-lunge','smith-machine-split-squat'], unilateral: false, progression: 'load', rom: true },
  { id: 'hip-abduction-machine', name: 'Hip Abduction (Machine)', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['isolation'], cues: ['Sit tall','Drive knees out','Slow return'], substitution: ['hip-thrust','smith-machine-hip-thrust','machine-glute-kickback','reverse-hyperextension'], unilateral: false, progression: 'load' },
  { id: 'glute-bridge', name: 'Glute Bridge', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Beginner', tags: ['compound','low-impact'], cues: ['Feet flat','Drive hips up'], substitution: ['hip-thrust', 'romanian-deadlift', 'nordic-curl','single-leg-glute-bridge','barbell-glute-bridge','glute-focused-back-extension','curtsy-lunge','glute-bridge-march','frog-pump','donkey-kick','fire-hydrant','clamshell','hip-airplane','side-lying-hip-abduction','side-lying-leg-raise'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'lunge', name: 'Forward Lunge', muscle: 'Legs', equipment: ['bodyweight','dumbbells'], level: 'Beginner', tags: ['compound','unilateral'], cues: ['Front knee over ankle','Torso upright'], substitution: ['split-squat', 'bulgarian-split-squat', 'step-up'], unilateral: true, supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'split-squat', name: 'Split Squat', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], cues: ['Torso upright','Back knee lowers toward floor'], substitution: ['lunge', 'bodyweight-squat', 'step-up'], unilateral: true, supportsWeighted: true, progression: 'load', rom: true },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], cues: ['Front shin vertical','Back knee hovers','Torso tall'], substitution: ['lunge', 'goblet-squat','walking-lunge','reverse-lunge','heel-elevated-goblet-squat','front-foot-elevated-split-squat','dumbbell-lateral-lunge'], unilateral: true, supportsWeighted: true, progression: 'load', rom: true },
  { id: 'step-up', name: 'Step-up', muscle: 'Legs', equipment: ['bench','dumbbells'], level: 'Beginner', tags: ['compound','unilateral','low-impact'], cues: ['Whole foot on the step','Drive through the heel','Control the way down'], substitution: ['lunge', 'split-squat', 'calf-raise', 'goblet-squat','walking-lunge'], unilateral: true, supportsWeighted: true, progression: 'load' },
  { id: 'wall-sit', name: 'Wall Sit', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['low-impact'], cues: ['Thighs parallel to floor','Back flat on the wall','Breathe through the burn'], substitution: ['plank', 'bodyweight-squat','jump-squat','pistol-squat','assisted-pistol-squat','shrimp-squat','cossack-squat','sissy-squat','lateral-lunge','skater-squat','standing-quad-stretch'], unilateral: false, progression: 'time' },
  { id: 'calf-raise', name: 'Calf Raise', muscle: 'Legs', equipment: ['bodyweight','dumbbells'], level: 'Beginner', tags: ['isolation','low-impact'], cues: ['Full stretch at the bottom','Pause at the top'], substitution: ['step-up','single-leg-calf-raise','fast-feet','wall-calf-stretch'], unilateral: false, supportsWeighted: true, progression: 'reps', rom: true },

  // ── Shoulders / Arms
  { id: 'overhead-press-dumbbell', name: 'Dumbbell Overhead Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['compound','push'], cues: ['Ribs down','Press overhead without arching'], substitution: ['push-up', 'pike-push-up', 'overhead-press-barbell', 'arnold-press', 'machine-shoulder-press'], progression: 'load', rom: true },
  { id: 'overhead-press-barbell', name: 'Barbell Overhead Press', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], cues: ['Brace glutes and abs','Bar paths over the crown','Head through at the top'], substitution: ['overhead-press-dumbbell', 'pike-push-up'], unilateral: false, progression: 'load', rom: true },
  { id: 'arnold-press', name: 'Arnold Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','push'], cues: ['Start palms facing you','Rotate as you press','No leg drive'], substitution: ['overhead-press-dumbbell','seated-dumbbell-press','front-raise','standing-dumbbell-press'], unilateral: false, progression: 'load', rom: true },
  { id: 'pike-push-up', name: 'Pike Push-up', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['compound','push'], cues: ['Hips high','Head between arms'], substitution: ['overhead-press-dumbbell', 'overhead-press-barbell','feet-elevated-pike-push-up','handstand-push-up','arm-circles','cross-body-shoulder-stretch'], supportsWeighted: true, progression: 'reps' },
  { id: 'lateral-raise', name: 'Lateral Raise', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation'], cues: ['Slight lean','Lead with elbows'], substitution: ['band-lateral-raise', 'rear-delt-fly','seated-dumbbell-press'], progression: 'load' },
  { id: 'band-lateral-raise', name: 'Banded Lateral Raise', muscle: 'Shoulders', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], cues: ['Slow tempo'], substitution: ['lateral-raise', 'rear-delt-fly'], progression: 'reps' },
  { id: 'rear-delt-fly', name: 'Rear Delt Fly', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Hinge over','Pinkies lead','Squeeze the back of the shoulders'], substitution: ['face-pull', 'band-lateral-raise', 'lateral-raise', 'reverse-pec-deck', 'bent-over-rear-delt-raise', 'cable-rear-delt-fly'], unilateral: false, progression: 'load' },
  { id: 'face-pull', name: 'Face Pull', muscle: 'Shoulders', equipment: ['cable','bands'], level: 'Beginner', tags: ['isolation','pull'], cues: ['Elbows high','Pull to forehead','Squeeze rear delts'], substitution: ['band-row', 'dumbbell-row', 'rear-delt-fly', 'dumbbell-shrug', 'reverse-pec-deck','shrug','scapular-push-up','prone-y-raise','prone-t-raise','reverse-snow-angel','band-pull-apart','banded-face-pull'], progression: 'load' },
  { id: 'dumbbell-shrug', name: 'Dumbbell Shrug', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','grip'], cues: ['Straight arms','Ears away from shoulders','Pause at the top'], substitution: ['face-pull', 'farmer-carry'], unilateral: false, supportsWeighted: true, progression: 'load' },
  { id: 'bicep-curl', name: 'Dumbbell Bicep Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','unilateral'], cues: ['Elbows pinned','No swinging'], substitution: ['band-curl', 'hammer-curl', 'barbell-curl', 'preacher-curl-machine', 'weighted-chin-up', 'incline-dumbbell-curl', 'concentration-curl', 'spider-curl'], unilateral: true, progression: 'load' },
  { id: 'hammer-curl', name: 'Hammer Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','grip'], cues: ['Neutral grip','Elbows still','Control the lowering'], substitution: ['bicep-curl', 'preacher-curl-machine','incline-dumbbell-curl','concentration-curl','spider-curl'], unilateral: true, progression: 'load' },
  { id: 'band-curl', name: 'Banded Bicep Curl', muscle: 'Arms', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], cues: ['Step on band','Control up and down'], substitution: ['bicep-curl'], progression: 'reps' },
  { id: 'tricep-dip-bench', name: 'Bench Dip', muscle: 'Arms', equipment: ['bench'], level: 'Beginner', tags: ['compound','push'], cues: ['Shoulders down','Elbows back'], substitution: ['push-up', 'tricep-pushdown', 'close-grip-push-up', 'machine-dip', 'dip', 'weighted-dip'], supportsWeighted: true, progression: 'reps', rom: true },
  { id: 'tricep-pushdown', name: 'Tricep Pushdown (Cable)', muscle: 'Arms', equipment: ['cable'], level: 'Beginner', tags: ['isolation','push'], cues: ['Elbows pinned to ribs','Full lockout','Slow return'], substitution: ['tricep-dip-bench', 'overhead-tricep-extension', 'skullcrusher', 'machine-dip', 'push-up', 'skull-crusher', 'close-grip-bench-press', 'dip', 'assisted-dip', 'weighted-dip', 'rope-tricep-pushdown', 'dumbbell-skull-crusher', 'single-dumbbell-skullcrusher', 'dumbbell-overhead-tricep-extension', 'single-arm-dumbbell-tricep-extension', 'tricep-kickback', 'diamond-push-up', 'chair-dip', 'crab-walk'], unilateral: false, progression: 'load' },
  { id: 'overhead-tricep-extension', name: 'Overhead Tricep Extension', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation','push'], cues: ['Elbows narrow','Deep stretch','Extend fully'], substitution: ['tricep-pushdown', 'skullcrusher','rope-tricep-pushdown'], unilateral: false, progression: 'load' },

  // ── Core
  { id: 'plank', name: 'Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability'], cues: ['Forearms & toes','Hips level'], substitution: ['dead-bug', 'hanging-knee-raise', 'leg-raise', 'farmer-carry', 'side-plank', 'wall-sit', 'pallof-press','cable-crunch','ab-wheel','crunch','reverse-crunch','russian-twist','bicycle-crunch','mountain-climber','cable-woodchop','half-kneeling-pallof-press','cable-pallof-hold','captains-chair-knee-raise','decline-sit-up','weighted-crunch','weighted-russian-twist','dumbbell-side-bend','push-up-shoulder-tap','banded-pallof-press','banded-woodchop','banded-dead-bug','hollow-body-hold','hollow-rock','v-up','flutter-kick','lying-leg-raise','toe-touch','heel-tap','plank-shoulder-tap','plank-jack','bear-plank','inchworm','l-sit-hold','seated-knee-tuck','side-plank-hip-dip','copenhagen-plank','dragon-flag','half-burpee','squat-thrust'], progression: 'time' },
  { id: 'side-plank', name: 'Side Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Stack the shoulders','Hips high','Breathe steadily'], substitution: ['plank', 'bird-dog', 'barbell-side-bend','ab-wheel','crunch','reverse-crunch','russian-twist','bicycle-crunch','mountain-climber','push-up-shoulder-tap','hollow-body-hold','hollow-rock','v-up','flutter-kick','lying-leg-raise','toe-touch','heel-tap','plank-shoulder-tap','plank-jack','bear-plank','inchworm','l-sit-hold','seated-knee-tuck','side-plank-hip-dip','copenhagen-plank','dragon-flag','half-burpee','squat-thrust'], unilateral: true, progression: 'time' },
  { id: 'dead-bug', name: 'Dead Bug', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Lower back pressed to floor','Opposite arm/leg'], substitution: ['plank', 'hanging-knee-raise', 'bird-dog', 'pallof-press'], progression: 'reps' },
  { id: 'bird-dog', name: 'Bird Dog', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['core-stability','low-impact'], cues: ['Long spine','Reach opposite arm and leg','No hip tilt'], substitution: ['dead-bug', 'side-plank', 'superman'], unilateral: true, progression: 'reps' },
  { id: 'pallof-press', name: 'Pallof Press', muscle: 'Core', equipment: ['cable','bands'], level: 'Beginner', tags: ['core-stability'], cues: ['Stand side-on to the anchor','Resist the twist','Press straight out'], substitution: ['dead-bug', 'plank','cable-crunch','cable-woodchop','half-kneeling-pallof-press','cable-pallof-hold'], unilateral: true, progression: 'reps' },
  { id: 'hanging-knee-raise', name: 'Hanging Knee Raise', muscle: 'Core', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['core-stability','grip'], cues: ['No swinging','Knees to chest'], substitution: ['plank', 'dead-bug', 'leg-raise'], progression: 'reps', rom: true },
  { id: 'leg-raise', name: 'Hanging Leg Raise', muscle: 'Core', equipment: ['pullup-bar'], level: 'Advanced', tags: ['core-stability','grip'], cues: ['Dead hang','Legs straight','Control down'], substitution: ['hanging-knee-raise', 'plank'], progression: 'reps', rom: true },
  { id: 'mountain-climbers', name: 'Mountain Climbers', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['conditioning','core-stability'], cues: ['Shoulders over wrists','Hips low','Fast knees'], substitution: ['burpee', 'high-knees', 'bear-crawl'], unilateral: true, progression: 'time' },

  // ── Conditioning / Full body
  { id: 'run-easy', name: 'Easy Run', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Conversational pace','Nasal breathing'], substitution: ['brisk-walk', 'cycle', 'indoor-row'], progression: 'time' },
  { id: 'brisk-walk', name: 'Brisk Walk', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Arms pumping','Uphill if available'], substitution: ['run-easy', 'jump-rope'], progression: 'time' },
  { id: 'cycle', name: 'Cycle', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','low-impact'], cues: ['Steady cadence'], substitution: ['run-easy', 'cycle', 'indoor-row'], progression: 'time' },
  { id: 'indoor-row', name: 'Indoor Row', muscle: 'Cardio', equipment: ['machine'], level: 'Beginner', tags: ['conditioning','compound','low-impact'], cues: ['Legs, then hips, then arms','Reverse on the recovery'], substitution: ['cycle', 'run-easy'], unilateral: false, progression: 'time' },
  { id: 'high-knees', name: 'High Knees', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning'], cues: ['Knees to hip height','Quick ground contact','Stay tall'], substitution: ['jump-rope', 'mountain-climbers','jumping-jack','skater-hop','lateral-shuffle','sprawl'], unilateral: true, progression: 'time' },
  { id: 'jump-rope', name: 'Jump Rope', muscle: 'Cardio', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning'], cues: ['Light on toes','Elbows tucked'], substitution: ['brisk-walk', 'high-knees','standing-calf-raise','seated-calf-raise','donkey-calf-raise','leg-press-calf-raise'], progression: 'time' },
  { id: 'kettlebell-swing', name: 'Kettlebell Swing', muscle: 'Full body', equipment: ['kettlebell'], level: 'Intermediate', tags: ['compound','explosive'], cues: ['Hip hinge power','Arms guide, hips drive'], substitution: ['romanian-deadlift', 'farmer-carry', 'thruster'], progression: 'reps' },
  { id: 'thruster', name: 'Dumbbell Thruster', muscle: 'Full body', equipment: ['dumbbells'], level: 'Advanced', tags: ['compound','explosive','push'], cues: ['Front squat into press','One fluid drive','Catch with locked elbows'], substitution: ['kettlebell-swing', 'burpee'], unilateral: false, progression: 'load' },
  { id: 'bear-crawl', name: 'Bear Crawl', muscle: 'Full body', equipment: ['bodyweight'], level: 'Beginner', tags: ['conditioning','core-stability'], cues: ['Knees hover','Hips level','Move quietly'], substitution: ['mountain-climbers', 'farmer-carry'], unilateral: true, progression: 'time' },
  { id: 'burpee', name: 'Burpee', muscle: 'Full body', equipment: ['bodyweight'], level: 'Intermediate', tags: ['conditioning','explosive'], cues: ['Chest to floor','Jump or step up'], substitution: ['bodyweight-squat', 'mountain-climbers', 'thruster','running','walking','cycling','stair-climber','elliptical','assault-bike','hiking','treadmill-incline-walk','jumping-jack','skater-hop','lateral-shuffle','sprawl'], progression: 'reps' },
  { id: 'farmer-carry', name: 'Farmer Carry', muscle: 'Full body', equipment: ['dumbbells'], level: 'Beginner', tags: ['compound','grip'], cues: ['Heavy pair','Shoulders packed','Walk tall'], substitution: ['plank', 'kettlebell-swing', 'bear-crawl', 'dumbbell-shrug', 'barbell-side-bend','wrist-extension'], progression: 'time' },


  // ── Coverage-matrix fills (muscle x equipment) ──
  { id:'superman', name:'Superman Hold', muscle:'Back', equipment:['bodyweight'], level:'Beginner', tags:['core-stability','low-impact'], cues:['Lift chest and thighs','Long neck','Breathe through the hold'], substitution: ['bird-dog','back-extension'], unilateral:false, progression:'time' },
  { id:'close-grip-push-up', name:'Close-Grip Push-up', muscle:'Arms', equipment:['bodyweight'], level:'Beginner', tags:['compound','push'], cues:['Hands under sternum','Elbows brush ribs','Body rigid'], substitution: ['push-up', 'tricep-dip-bench'], unilateral:false, supportsWeighted:true, progression:'reps', rom:true },
  { id:'cable-goblet-squat', name:'Cable Goblet Squat', muscle:'Legs', equipment:['cable'], level:'Beginner', tags:['compound'], cues:['Hold attachment at chest','Sit between the knees','Drive the floor away'], substitution: ['goblet-squat'], unilateral:false, progression:'load', rom:true },
  { id:'cable-leg-curl', name:'Standing Cable Leg Curl', muscle:'Glutes', equipment:['cable'], level:'Beginner', tags:['isolation'], cues:['Ankle strap','Curl heel to glute','Slow return'], substitution: ['nordic-curl'], unilateral:true, progression: 'load' },
  { id:'lying-leg-curl', name:'Lying Leg Curl (Machine)', muscle:'Glutes', equipment:['machine'], level:'Beginner', tags:['isolation'], cues:['Hips pinned down','No bouncing','Squeeze at the top'], substitution: ['nordic-curl','leg-curl','seated-leg-curl'], unilateral:false, progression:'load' },
  { id:'cable-pull-through', name:'Cable Pull-Through', muscle:'Glutes', equipment:['cable'], level:'Beginner', tags:['compound'], cues:['Rope between legs','Hinge, don\'t squat','Squeeze glutes at lockout'], substitution: ['hip-thrust', 'romanian-deadlift','cable-kickback','cable-standing-hip-abduction'], unilateral:false, progression:'load', rom:true },
  { id:'machine-shoulder-press', name:'Machine Shoulder Press', muscle:'Shoulders', equipment:['machine'], level:'Beginner', tags:['compound','push'], cues:['Handles at ear height','Press without shrugging','Control down'], substitution: ['overhead-press-dumbbell','machine-lateral-raise'], unilateral:false, progression:'load' },
  { id:'reverse-pec-deck', name:'Reverse Pec Deck', muscle:'Shoulders', equipment:['machine'], level:'Beginner', tags:['isolation','pull'], cues:['Arms slightly bent','Lead with pinkies','Squeeze rear delts'], substitution: ['rear-delt-fly', 'face-pull','bent-over-rear-delt-raise'], unilateral:false, progression:'load' },
  { id:'barbell-curl', name: 'Barbell Curl', muscle:'Arms', equipment:['barbell'], level:'Beginner', tags:['isolation'], cues:['Shoulder-width grip','Elbows pinned','No hip drive'], substitution: ['bicep-curl'], unilateral:false, progression:'load' },
  { id:'preacher-curl-machine', name:'Preacher Curl (Machine)', muscle:'Arms', equipment:['machine'], level:'Beginner', tags:['isolation'], cues:['Armpits over pad','Full stretch','No elbow drift'], substitution: ['bicep-curl', 'hammer-curl', 'preacher-curl-machine'], unilateral:true, progression:'load' },
  { id:'skullcrusher', name:'Barbell Skullcrusher', muscle:'Arms', equipment:['barbell'], level:'Intermediate', tags:['isolation','push'], cues:['Upper arms vertical','Lower behind the head','Protect the elbows'], substitution: ['tricep-pushdown', 'overhead-tricep-extension'], unilateral:false, progression:'load' },
  { id:'machine-dip', name:'Machine Dip', muscle:'Arms', equipment:['machine'], level:'Beginner', tags:['compound','push'], cues:['Slight forward lean','Elbows track back','Full lockout'], substitution: ['tricep-dip-bench', 'tricep-pushdown'], unilateral:false, progression:'load' },
  { id:'barbell-side-bend', name:'Barbell Side Bend', muscle:'Core', equipment:['barbell'], level:'Beginner', tags:['core-stability'], cues:['Bar on traps or at side','Bend purely sideways','No forward lean'], substitution: ['farmer-carry', 'side-plank'], unilateral:true, progression:'load' },
  { id: 'bench-press', name: 'Bench Press', muscle: 'Chest', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'bench-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['incline-bench-press', 'decline-bench-press', 'incline-dumbbell-press', 'machine-chest-press', 'pec-deck', 'weighted-push-up', 'incline-cable-fly', 'decline-dumbbell-press', 'smith-machine-bench-press', 'chest-dip', 'knee-push-up', 'wide-push-up', 'archer-push-up', 'typewriter-push-up', 'explosive-push-up', 'hindu-push-up', 'wall-push-up', 'seal-jack', 'doorway-chest-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('bench-press'), supportsAssisted: /assisted/i.test('bench-press'), progression: 'load' },
  { id: 'incline-bench-press', name: 'Incline Bench Press', muscle: 'Chest', equipment: ['barbell'], level: 'Beginner', tags: ['compound','push'], imageSlug: 'incline-bench-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['bench-press', 'decline-bench-press', 'incline-dumbbell-press'], unilateral: false, supportsWeighted: /weighted/i.test('incline-bench-press'), supportsAssisted: /assisted/i.test('incline-bench-press'), progression: 'load' },
  { id: 'decline-bench-press', name: 'Decline Bench Press', muscle: 'Chest', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'decline-bench-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['bench-press', 'incline-bench-press', 'incline-dumbbell-press'], unilateral: false, supportsWeighted: /weighted/i.test('decline-bench-press'), supportsAssisted: /assisted/i.test('decline-bench-press'), progression: 'load' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['compound','push','pull'], imageSlug: 'machine-chest-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['pec-deck', 'smith-machine-bench-press', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('machine-chest-press'), supportsAssisted: /assisted/i.test('machine-chest-press'), progression: 'load' },
  { id: 'pec-deck', name: 'Pec Deck', muscle: 'Chest', equipment: ['machine'], level: 'Intermediate', tags: ['compound'], imageSlug: 'pec-deck', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['machine-chest-press', 'smith-machine-bench-press', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('pec-deck'), supportsAssisted: /assisted/i.test('pec-deck'), progression: 'load' },
  { id: 'weighted-push-up', name: 'Weighted Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound','push'], imageSlug: 'weighted-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'chest-dip', 'bench-press', 'knee-push-up', 'wide-push-up', 'archer-push-up', 'typewriter-push-up', 'explosive-push-up', 'hindu-push-up', 'seal-jack'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-push-up'), supportsAssisted: /assisted/i.test('weighted-push-up'), progression: 'load' },
  { id: 'overhead-press', name: 'Overhead Press', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'overhead-press', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['upright-row', 'landmine-press', 'seated-dumbbell-press', 'cable-lateral-raise', 'front-raise', 'standing-dumbbell-press', 'push-press', 'machine-lateral-raise', 'cable-front-raise', 'plate-front-raise', 'battle-ropes', 'feet-elevated-pike-push-up', 'wall-walk', 'wall-handstand-push-up', 'handstand-push-up', 'arm-circles', 'cross-body-shoulder-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('overhead-press'), supportsAssisted: /assisted/i.test('overhead-press'), progression: 'load' },
  { id: 'seated-dumbbell-press', name: 'Dumbbell Seated Shoulder Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Beginner', tags: ['compound','push'], imageSlug: 'seated-dumbbell-press', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['arnold-press', 'lateral-raise', 'overhead-press', 'front-raise', 'upright-row', 'landmine-press', 'standing-dumbbell-press', 'push-press'], unilateral: false, supportsWeighted: /weighted/i.test('seated-dumbbell-press'), supportsAssisted: /assisted/i.test('seated-dumbbell-press'), progression: 'load' },
  { id: 'cable-lateral-raise', name: 'Cable Lateral Raise', muscle: 'Shoulders', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cable-lateral-raise', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['cable-front-raise', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('cable-lateral-raise'), supportsAssisted: /assisted/i.test('cable-lateral-raise'), progression: 'load' },
  { id: 'front-raise', name: 'Front Raise', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'front-raise', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['seated-dumbbell-press', 'arnold-press', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('front-raise'), supportsAssisted: /assisted/i.test('front-raise'), progression: 'load' },
  { id: 'upright-row', name: 'Upright Row', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'upright-row', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['overhead-press', 'landmine-press', 'seated-dumbbell-press', 'push-press'], unilateral: false, supportsWeighted: /weighted/i.test('upright-row'), supportsAssisted: /assisted/i.test('upright-row'), progression: 'load' },
  { id: 'deadlift', name: 'Deadlift', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'deadlift', cues: ["Neutral spine","Hip hinge pattern","Feel hamstrings load"], substitution: ['sumo-deadlift', 'trap-bar-deadlift', 'dumbbell-sumo-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('deadlift'), supportsAssisted: /assisted/i.test('deadlift'), progression: 'load' },
  { id: 't-bar-row', name: 'T-Bar Row', muscle: 'Back', equipment: ['machine'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 't-bar-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['chest-supported-row', 'machine-row', 'barbell-row', 'pendlay-row', 'meadows-row', 'rack-pull'], unilateral: false, supportsWeighted: /weighted/i.test('t-bar-row'), supportsAssisted: /assisted/i.test('t-bar-row'), progression: 'load' },
  { id: 'dumbbell-bent-over-row', name: 'Dumbbell Bent Over Row', muscle: 'Back', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'dumbbell-bent-over-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['one-arm-dumbbell-row', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-bent-over-row'), supportsAssisted: /assisted/i.test('dumbbell-bent-over-row'), progression: 'load' },
  { id: 'one-arm-dumbbell-row', name: 'One-Arm Dumbbell Row', muscle: 'Back', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'one-arm-dumbbell-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['dumbbell-bent-over-row', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('one-arm-dumbbell-row'), supportsAssisted: /assisted/i.test('one-arm-dumbbell-row'), progression: 'load' },
  { id: 'machine-row', name: 'Machine Row', muscle: 'Back', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull'], imageSlug: 'machine-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['t-bar-row', 'chest-supported-row', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('machine-row'), supportsAssisted: /assisted/i.test('machine-row'), progression: 'load' },
  { id: 'close-grip-lat-pulldown', name: 'Close-Grip Lat Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'close-grip-lat-pulldown', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['lat-pulldown', 'straight-arm-pulldown', 'pull-up','wide-grip-lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('close-grip-lat-pulldown'), supportsAssisted: /assisted/i.test('close-grip-lat-pulldown'), progression: 'load' },
  { id: 'assisted-pull-up', name: 'Assisted Pull-up', muscle: 'Back', equipment: ['machine'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'assisted-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('assisted-pull-up'), supportsAssisted: /assisted/i.test('assisted-pull-up'), progression: 'reps' },
  { id: 'weighted-pull-up', name: 'Weighted Pull-up', muscle: 'Back', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound','pull'], imageSlug: 'weighted-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['pull-up', 'neutral-grip-pull-up', 'lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-pull-up'), supportsAssisted: /assisted/i.test('weighted-pull-up'), progression: 'load' },
  { id: 'shrug', name: 'Barbell Shrug', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'shrug', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['face-pull'], unilateral: false, supportsWeighted: /weighted/i.test('shrug'), supportsAssisted: /assisted/i.test('shrug'), progression: 'load' },
  { id: 'squat', name: 'Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['front-squat', 'landmine-squat', 'hack-squat', 'walking-lunge', 'leg-extension', 'smith-machine-squat', 'belt-squat', 'reverse-lunge', 'smith-machine-bulgarian-split-squat', 'smith-machine-reverse-lunge', 'smith-machine-split-squat', 'heel-elevated-goblet-squat', 'front-foot-elevated-split-squat', 'dumbbell-lateral-lunge', 'jump-squat', 'pistol-squat', 'assisted-pistol-squat', 'shrimp-squat', 'cossack-squat', 'sissy-squat', 'lateral-lunge', 'skater-squat', 'single-leg-box-squat', 'step-down', 'banded-squat', 'standing-quad-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('squat'), supportsAssisted: /assisted/i.test('squat'), progression: 'load' },
  { id: 'hack-squat', name: 'Hack Squat', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['compound'], imageSlug: 'hack-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['leg-press', 'leg-extension', 'squat', 'smith-machine-squat', 'belt-squat', 'smith-machine-bulgarian-split-squat', 'smith-machine-reverse-lunge', 'smith-machine-split-squat', 'landmine-squat'], unilateral: false, supportsWeighted: /weighted/i.test('hack-squat'), supportsAssisted: /assisted/i.test('hack-squat'), progression: 'load' },
  { id: 'walking-lunge', name: 'Walking Lunge', muscle: 'Legs', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'walking-lunge', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['bulgarian-split-squat', 'step-up', 'squat','reverse-lunge','heel-elevated-goblet-squat','front-foot-elevated-split-squat','dumbbell-lateral-lunge'], unilateral: false, supportsWeighted: /weighted/i.test('walking-lunge'), supportsAssisted: /assisted/i.test('walking-lunge'), progression: 'load' },
  { id: 'leg-extension', name: 'Leg Extension', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'leg-extension', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('leg-extension'), supportsAssisted: /assisted/i.test('leg-extension'), progression: 'load' },
  { id: 'leg-curl', name: 'Leg Curl', muscle: 'Glutes', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'leg-curl', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['seated-leg-curl', 'lying-leg-curl', 'romanian-deadlift', 'smith-machine-romanian-deadlift', 'landmine-romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('leg-curl'), supportsAssisted: /assisted/i.test('leg-curl'), progression: 'load' },
  { id: 'seated-leg-curl', name: 'Seated Leg Curl', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['isolation'], imageSlug: 'seated-leg-curl', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['leg-curl', 'lying-leg-curl', 'romanian-deadlift', 'smith-machine-romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('seated-leg-curl'), supportsAssisted: /assisted/i.test('seated-leg-curl'), progression: 'load' },
  { id: 'standing-calf-raise', name: 'Standing Calf Raise', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'standing-calf-raise', cues: ["Full range","Pause at top","Slow negative"], substitution: ['seated-calf-raise', 'donkey-calf-raise', 'jump-rope', 'leg-press-calf-raise', 'single-leg-calf-raise', 'fast-feet', 'wall-calf-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('standing-calf-raise'), supportsAssisted: /assisted/i.test('standing-calf-raise'), progression: 'load' },
  { id: 'seated-calf-raise', name: 'Seated Calf Raise', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['isolation'], imageSlug: 'seated-calf-raise', cues: ["Full range","Pause at top","Slow negative"], substitution: ['standing-calf-raise', 'donkey-calf-raise', 'jump-rope', 'leg-press-calf-raise'], unilateral: false, supportsWeighted: /weighted/i.test('seated-calf-raise'), supportsAssisted: /assisted/i.test('seated-calf-raise'), progression: 'load' },
  { id: 'preacher-curl', name: 'Preacher Curl', muscle: 'Arms', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'preacher-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['assisted-chin-up', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('preacher-curl'), supportsAssisted: /assisted/i.test('preacher-curl'), progression: 'load' },
  { id: 'cable-curl', name: 'Cable Curl', muscle: 'Arms', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cable-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['rope-hammer-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('cable-curl'), supportsAssisted: /assisted/i.test('cable-curl'), progression: 'load' },
  { id: 'reverse-curl', name: 'Reverse Curl', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'reverse-curl', cues: ["Wrist alignment","Slow controlled movement","Feel forearm tension"], substitution: ['wrist-curl', 'wrist-extension', 'dead-hang'], unilateral: false, supportsWeighted: /weighted/i.test('reverse-curl'), supportsAssisted: /assisted/i.test('reverse-curl'), progression: 'load' },
  { id: 'wrist-curl', name: 'Wrist Curl', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'wrist-curl', cues: ["Wrist alignment","Slow controlled movement","Feel forearm tension"], substitution: ['reverse-curl', 'wrist-extension'], unilateral: false, supportsWeighted: /weighted/i.test('wrist-curl'), supportsAssisted: /assisted/i.test('wrist-curl'), progression: 'load' },
  { id: 'skull-crusher', name: 'Skull Crusher', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'skull-crusher', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['close-grip-bench-press', 'tricep-pushdown', 'rope-tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('skull-crusher'), supportsAssisted: /assisted/i.test('skull-crusher'), progression: 'load' },
  { id: 'close-grip-bench-press', name: 'Close-Grip Bench Press', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'close-grip-bench-press', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['skull-crusher', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('close-grip-bench-press'), supportsAssisted: /assisted/i.test('close-grip-bench-press'), progression: 'load' },
  { id: 'dip', name: 'Dip', muscle: 'Arms', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'dip', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['weighted-dip', 'tricep-dip-bench', 'tricep-pushdown', 'diamond-push-up', 'crab-walk'], unilateral: false, supportsWeighted: /weighted/i.test('dip'), supportsAssisted: /assisted/i.test('dip'), progression: 'reps' },
  { id: 'assisted-dip', name: 'Assisted Dip', muscle: 'Arms', equipment: ['machine'], level: 'Beginner', tags: ['isolation','push'], imageSlug: 'assisted-dip', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('assisted-dip'), supportsAssisted: /assisted/i.test('assisted-dip'), progression: 'reps' },
  { id: 'cable-crunch', name: 'Cable Crunch', muscle: 'Core', equipment: ['cable'], level: 'Intermediate', tags: ['compound'], imageSlug: 'cable-crunch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['pallof-press', 'cable-woodchop', 'plank', 'ab-wheel', 'crunch', 'reverse-crunch', 'russian-twist', 'bicycle-crunch', 'mountain-climber', 'half-kneeling-pallof-press', 'cable-pallof-hold', 'push-up-shoulder-tap', 'hollow-body-hold', 'hollow-rock', 'v-up', 'flutter-kick', 'lying-leg-raise', 'toe-touch', 'heel-tap', 'plank-shoulder-tap', 'plank-jack', 'bear-plank', 'inchworm', 'l-sit-hold', 'seated-knee-tuck', 'side-plank-hip-dip', 'copenhagen-plank', 'dragon-flag', 'half-burpee', 'squat-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('cable-crunch'), supportsAssisted: /assisted/i.test('cable-crunch'), progression: 'load' },
  { id: 'ab-wheel', name: 'Ab Wheel Rollout', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'ab-wheel', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('ab-wheel'), supportsAssisted: /assisted/i.test('ab-wheel'), progression: 'reps' },
  { id: 'running', name: 'Running', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning'], imageSlug: 'running', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['walking', 'cycling', 'burpee', 'stair-climber', 'elliptical', 'assault-bike', 'hiking', 'treadmill-incline-walk', 'jumping-jack', 'skater-hop', 'lateral-shuffle', 'sprawl'], unilateral: false, supportsWeighted: /weighted/i.test('running'), supportsAssisted: /assisted/i.test('running'), progression: 'load' },
  { id: 'walking', name: 'Walking', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'walking', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'cycling', 'burpee', 'stair-climber', 'elliptical', 'assault-bike', 'hiking', 'treadmill-incline-walk'], unilateral: false, supportsWeighted: /weighted/i.test('walking'), supportsAssisted: /assisted/i.test('walking'), progression: 'load' },
  { id: 'cycling', name: 'Cycling', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cycling', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('cycling'), supportsAssisted: /assisted/i.test('cycling'), progression: 'load' },
  { id: 'rowing', name: 'Rowing', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'rowing', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['swimming', 'skierg', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('rowing'), supportsAssisted: /assisted/i.test('rowing'), progression: 'load' },
  { id: 'stair-climber', name: 'Stair Climber', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'stair-climber', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('stair-climber'), supportsAssisted: /assisted/i.test('stair-climber'), progression: 'time' },
  { id: 'incline-cable-fly', name: 'Incline Cable Fly', muscle: 'Chest', equipment: ['cable'], level: 'Beginner', tags: ['isolation'], imageSlug: 'incline-cable-fly', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['cable-fly', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('incline-cable-fly'), supportsAssisted: /assisted/i.test('incline-cable-fly'), progression: 'load' },
  { id: 'decline-dumbbell-press', name: 'Decline Dumbbell Press', muscle: 'Chest', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'decline-dumbbell-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['incline-dumbbell-press', 'bench-press-dumbbell', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('decline-dumbbell-press'), supportsAssisted: /assisted/i.test('decline-dumbbell-press'), progression: 'load' },
  { id: 'smith-machine-bench-press', name: 'Smith Machine Bench Press', muscle: 'Chest', equipment: ['machine'], level: 'Beginner', tags: ['compound','push','pull'], imageSlug: 'smith-machine-bench-press', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['machine-chest-press', 'pec-deck', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-bench-press'), supportsAssisted: /assisted/i.test('smith-machine-bench-press'), progression: 'load' },
  { id: 'landmine-press', name: 'Landmine Press', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'landmine-press', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['overhead-press', 'upright-row', 'seated-dumbbell-press'], unilateral: false, supportsWeighted: /weighted/i.test('landmine-press'), supportsAssisted: /assisted/i.test('landmine-press'), progression: 'load' },
  { id: 'chest-dip', name: 'Chest Dip', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'chest-dip', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('chest-dip'), supportsAssisted: /assisted/i.test('chest-dip'), progression: 'reps' },
  { id: 'weighted-dip', name: 'Weighted Dip', muscle: 'Arms', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound','push'], imageSlug: 'weighted-dip', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dip', 'tricep-dip-bench', 'tricep-pushdown', 'diamond-push-up', 'crab-walk'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-dip'), supportsAssisted: /assisted/i.test('weighted-dip'), progression: 'load' },
  { id: 'standing-dumbbell-press', name: 'Standing Dumbbell Press', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'standing-dumbbell-press', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['seated-dumbbell-press', 'arnold-press', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('standing-dumbbell-press'), supportsAssisted: /assisted/i.test('standing-dumbbell-press'), progression: 'load' },
  { id: 'push-press', name: 'Push Press', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'push-press', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['overhead-press', 'upright-row', 'seated-dumbbell-press'], unilateral: false, supportsWeighted: /weighted/i.test('push-press'), supportsAssisted: /assisted/i.test('push-press'), progression: 'load' },
  { id: 'machine-lateral-raise', name: 'Machine Lateral Raise', muscle: 'Shoulders', equipment: ['machine'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'machine-lateral-raise', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['machine-shoulder-press', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('machine-lateral-raise'), supportsAssisted: /assisted/i.test('machine-lateral-raise'), progression: 'load' },
  { id: 'cable-front-raise', name: 'Cable Front Raise', muscle: 'Shoulders', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cable-front-raise', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['cable-lateral-raise', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('cable-front-raise'), supportsAssisted: /assisted/i.test('cable-front-raise'), progression: 'load' },
  { id: 'plate-front-raise', name: 'Plate Front Raise', muscle: 'Shoulders', equipment: ['barbell'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'plate-front-raise', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('plate-front-raise'), supportsAssisted: /assisted/i.test('plate-front-raise'), progression: 'load' },
  { id: 'bent-over-rear-delt-raise', name: 'Bent-Over Rear Delt Raise', muscle: 'Shoulders', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'bent-over-rear-delt-raise', cues: ["Lead with pinkies","Squeeze the back of shoulder","Light weight"], substitution: ['rear-delt-fly', 'reverse-pec-deck'], unilateral: false, supportsWeighted: /weighted/i.test('bent-over-rear-delt-raise'), supportsAssisted: /assisted/i.test('bent-over-rear-delt-raise'), progression: 'load' },
  { id: 'cable-rear-delt-fly', name: 'Cable Rear Delt Fly', muscle: 'Shoulders', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cable-rear-delt-fly', cues: ["Lead with pinkies","Squeeze the back of shoulder","Light weight"], substitution: ['rear-delt-fly'], unilateral: false, supportsWeighted: /weighted/i.test('cable-rear-delt-fly'), supportsAssisted: /assisted/i.test('cable-rear-delt-fly'), progression: 'load' },
  { id: 'pendlay-row', name: 'Pendlay Row', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'pendlay-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['barbell-row', 'meadows-row', 't-bar-row', 'rack-pull'], unilateral: false, supportsWeighted: /weighted/i.test('pendlay-row'), supportsAssisted: /assisted/i.test('pendlay-row'), progression: 'load' },
  { id: 'meadows-row', name: 'Meadows Row', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'meadows-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['barbell-row', 'pendlay-row', 't-bar-row'], unilateral: false, supportsWeighted: /weighted/i.test('meadows-row'), supportsAssisted: /assisted/i.test('meadows-row'), progression: 'load' },
  { id: 'wide-grip-lat-pulldown', name: 'Wide-Grip Lat Pulldown', muscle: 'Back', equipment: ['cable'], level: 'Intermediate', tags: ['compound','pull'], imageSlug: 'wide-grip-lat-pulldown', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['lat-pulldown', 'close-grip-lat-pulldown', 'pull-up'], unilateral: false, supportsWeighted: /weighted/i.test('wide-grip-lat-pulldown'), supportsAssisted: /assisted/i.test('wide-grip-lat-pulldown'), progression: 'load' },
  { id: 'neutral-grip-pull-up', name: 'Neutral-Grip Pull-up', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'neutral-grip-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['pull-up', 'weighted-pull-up', 'lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('neutral-grip-pull-up'), supportsAssisted: /assisted/i.test('neutral-grip-pull-up'), progression: 'reps' },
  { id: 'assisted-chin-up', name: 'Assisted Chin-up', muscle: 'Arms', equipment: ['machine'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'assisted-chin-up', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['preacher-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('assisted-chin-up'), supportsAssisted: /assisted/i.test('assisted-chin-up'), progression: 'reps' },
  { id: 'weighted-chin-up', name: 'Weighted Chin-up', muscle: 'Arms', equipment: ['bodyweight'], level: 'Advanced', tags: ['compound','pull'], imageSlug: 'weighted-chin-up', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['chin-up', 'bicep-curl'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-chin-up'), supportsAssisted: /assisted/i.test('weighted-chin-up'), progression: 'load' },
  { id: 'rack-pull', name: 'Rack Pull', muscle: 'Back', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'rack-pull', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['barbell-row', 'pendlay-row', 't-bar-row'], unilateral: false, supportsWeighted: /weighted/i.test('rack-pull'), supportsAssisted: /assisted/i.test('rack-pull'), progression: 'load' },
  { id: 'back-extension', name: 'Back Extension', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'back-extension', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['superman'], unilateral: false, supportsWeighted: /weighted/i.test('back-extension'), supportsAssisted: /assisted/i.test('back-extension'), progression: 'reps' },
  { id: 'smith-machine-squat', name: 'Smith Machine Squat', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull'], imageSlug: 'smith-machine-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-squat'), supportsAssisted: /assisted/i.test('smith-machine-squat'), progression: 'load' },
  { id: 'belt-squat', name: 'Belt Squat', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['compound'], imageSlug: 'belt-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('belt-squat'), supportsAssisted: /assisted/i.test('belt-squat'), progression: 'load' },
  { id: 'trap-bar-deadlift', name: 'Trap Bar Deadlift', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'trap-bar-deadlift', cues: ["Neutral spine","Hip hinge pattern","Feel hamstrings load"], substitution: ['deadlift', 'sumo-deadlift', 'dumbbell-sumo-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('trap-bar-deadlift'), supportsAssisted: /assisted/i.test('trap-bar-deadlift'), progression: 'load' },
  { id: 'single-leg-romanian-deadlift', name: 'Single-Leg Romanian Deadlift', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'single-leg-romanian-deadlift', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['dumbbell-romanian-deadlift', 'romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('single-leg-romanian-deadlift'), supportsAssisted: /assisted/i.test('single-leg-romanian-deadlift'), progression: 'load' },
  { id: 'reverse-lunge', name: 'Reverse Lunge', muscle: 'Legs', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'reverse-lunge', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['bulgarian-split-squat', 'walking-lunge', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('reverse-lunge'), supportsAssisted: /assisted/i.test('reverse-lunge'), progression: 'load' },
  { id: 'cable-kickback', name: 'Cable Kickback', muscle: 'Glutes', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cable-kickback', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['cable-pull-through', 'cable-standing-hip-abduction', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('cable-kickback'), supportsAssisted: /assisted/i.test('cable-kickback'), progression: 'load' },
  { id: 'single-leg-glute-bridge', name: 'Single-Leg Glute Bridge', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'single-leg-glute-bridge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'glute-focused-back-extension', 'hip-thrust', 'curtsy-lunge', 'glute-bridge-march', 'frog-pump', 'donkey-kick', 'fire-hydrant', 'clamshell', 'hip-airplane', 'side-lying-hip-abduction', 'side-lying-leg-raise'], unilateral: false, supportsWeighted: /weighted/i.test('single-leg-glute-bridge'), supportsAssisted: /assisted/i.test('single-leg-glute-bridge'), progression: 'reps' },
  { id: 'barbell-glute-bridge', name: 'Barbell Glute Bridge', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'barbell-glute-bridge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['hip-thrust', 'glute-bridge'], unilateral: false, supportsWeighted: /weighted/i.test('barbell-glute-bridge'), supportsAssisted: /assisted/i.test('barbell-glute-bridge'), progression: 'load' },
  { id: 'dumbbell-glute-bridge', name: 'Dumbbell Glute Bridge', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-glute-bridge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['dumbbell-hip-thrust', 'dumbbell-sumo-squat', 'hip-thrust', 'deficit-reverse-lunge', 'dumbbell-curtsy-lunge'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-glute-bridge'), supportsAssisted: /assisted/i.test('dumbbell-glute-bridge'), progression: 'load' },
  { id: 'dumbbell-hip-thrust', name: 'Dumbbell Hip Thrust', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-hip-thrust', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['dumbbell-glute-bridge', 'dumbbell-sumo-squat', 'hip-thrust', 'deficit-reverse-lunge', 'dumbbell-curtsy-lunge'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-hip-thrust'), supportsAssisted: /assisted/i.test('dumbbell-hip-thrust'), progression: 'load' },
  { id: 'smith-machine-hip-thrust', name: 'Smith Machine Hip Thrust', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull'], imageSlug: 'smith-machine-hip-thrust', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['hip-abduction-machine', 'machine-glute-kickback', 'hip-thrust', 'reverse-hyperextension'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-hip-thrust'), supportsAssisted: /assisted/i.test('smith-machine-hip-thrust'), progression: 'load' },
  { id: 'smith-machine-romanian-deadlift', name: 'Smith Machine Romanian Deadlift', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull'], imageSlug: 'smith-machine-romanian-deadlift', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['leg-curl', 'seated-leg-curl', 'romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-romanian-deadlift'), supportsAssisted: /assisted/i.test('smith-machine-romanian-deadlift'), progression: 'load' },
  { id: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian Deadlift', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-romanian-deadlift', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['single-leg-romanian-deadlift', 'romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-romanian-deadlift'), supportsAssisted: /assisted/i.test('dumbbell-romanian-deadlift'), progression: 'load' },
  { id: 'kettlebell-romanian-deadlift', name: 'Kettlebell Romanian Deadlift', muscle: 'Glutes', equipment: ['kettlebell'], level: 'Intermediate', tags: ['compound'], imageSlug: 'kettlebell-romanian-deadlift', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('kettlebell-romanian-deadlift'), supportsAssisted: /assisted/i.test('kettlebell-romanian-deadlift'), progression: 'load' },
  { id: 'machine-glute-kickback', name: 'Machine Glute Kickback', muscle: 'Glutes', equipment: ['machine'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'machine-glute-kickback', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['hip-abduction-machine', 'smith-machine-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('machine-glute-kickback'), supportsAssisted: /assisted/i.test('machine-glute-kickback'), progression: 'load' },
  { id: 'cable-standing-hip-abduction', name: 'Cable Standing Hip Abduction', muscle: 'Glutes', equipment: ['cable'], level: 'Intermediate', tags: ['compound'], imageSlug: 'cable-standing-hip-abduction', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['cable-kickback', 'cable-pull-through', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('cable-standing-hip-abduction'), supportsAssisted: /assisted/i.test('cable-standing-hip-abduction'), progression: 'load' },
  { id: 'cable-standing-hip-adduction', name: 'Cable Standing Hip Adduction', muscle: 'Legs', equipment: ['cable'], level: 'Intermediate', tags: ['compound'], imageSlug: 'cable-standing-hip-adduction', cues: ["Controlled range","Inner thigh squeeze","Slow tempo"], substitution: ['hip-adduction-machine'], unilateral: false, supportsWeighted: /weighted/i.test('cable-standing-hip-adduction'), supportsAssisted: /assisted/i.test('cable-standing-hip-adduction'), progression: 'load' },
  { id: 'hip-adduction-machine', name: 'Hip Adduction Machine', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull'], imageSlug: 'hip-adduction-machine', cues: ["Controlled range","Inner thigh squeeze","Slow tempo"], substitution: ['cable-standing-hip-adduction'], unilateral: false, supportsWeighted: /weighted/i.test('hip-adduction-machine'), supportsAssisted: /assisted/i.test('hip-adduction-machine'), progression: 'load' },
  { id: 'smith-machine-bulgarian-split-squat', name: 'Smith Machine Bulgarian Split Squat', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull','unilateral'], imageSlug: 'smith-machine-bulgarian-split-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-bulgarian-split-squat'), supportsAssisted: /assisted/i.test('smith-machine-bulgarian-split-squat'), progression: 'load' },
  { id: 'smith-machine-reverse-lunge', name: 'Smith Machine Reverse Lunge', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull','unilateral'], imageSlug: 'smith-machine-reverse-lunge', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-reverse-lunge'), supportsAssisted: /assisted/i.test('smith-machine-reverse-lunge'), progression: 'load' },
  { id: 'smith-machine-split-squat', name: 'Smith Machine Split Squat', muscle: 'Legs', equipment: ['machine'], level: 'Beginner', tags: ['compound','pull','unilateral'], imageSlug: 'smith-machine-split-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['hack-squat', 'leg-press', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('smith-machine-split-squat'), supportsAssisted: /assisted/i.test('smith-machine-split-squat'), progression: 'load' },
  { id: 'heel-elevated-goblet-squat', name: 'Heel-Elevated Goblet Squat', muscle: 'Legs', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'heel-elevated-goblet-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['bulgarian-split-squat', 'walking-lunge', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('heel-elevated-goblet-squat'), supportsAssisted: /assisted/i.test('heel-elevated-goblet-squat'), progression: 'load' },
  { id: 'dumbbell-sumo-squat', name: 'Dumbbell Sumo Squat', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-sumo-squat', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['dumbbell-glute-bridge', 'dumbbell-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-sumo-squat'), supportsAssisted: /assisted/i.test('dumbbell-sumo-squat'), progression: 'load' },
  { id: 'dumbbell-sumo-deadlift', name: 'Dumbbell Sumo Deadlift', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-sumo-deadlift', cues: ["Neutral spine","Hip hinge pattern","Feel hamstrings load"], substitution: ['deadlift', 'trap-bar-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-sumo-deadlift'), supportsAssisted: /assisted/i.test('dumbbell-sumo-deadlift'), progression: 'load' },
  { id: 'front-foot-elevated-split-squat', name: 'Front-Foot Elevated Split Squat', muscle: 'Legs', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'front-foot-elevated-split-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['bulgarian-split-squat', 'walking-lunge', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('front-foot-elevated-split-squat'), supportsAssisted: /assisted/i.test('front-foot-elevated-split-squat'), progression: 'load' },
  { id: 'deficit-reverse-lunge', name: 'Deficit Reverse Lunge', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'deficit-reverse-lunge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['dumbbell-glute-bridge', 'dumbbell-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('deficit-reverse-lunge'), supportsAssisted: /assisted/i.test('deficit-reverse-lunge'), progression: 'load' },
  { id: 'dumbbell-lateral-lunge', name: 'Dumbbell Lateral Lunge', muscle: 'Legs', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'dumbbell-lateral-lunge', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['bulgarian-split-squat', 'walking-lunge', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-lateral-lunge'), supportsAssisted: /assisted/i.test('dumbbell-lateral-lunge'), progression: 'load' },
  { id: 'dumbbell-curtsy-lunge', name: 'Dumbbell Curtsy Lunge', muscle: 'Glutes', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound','unilateral'], imageSlug: 'dumbbell-curtsy-lunge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['dumbbell-glute-bridge', 'dumbbell-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-curtsy-lunge'), supportsAssisted: /assisted/i.test('dumbbell-curtsy-lunge'), progression: 'load' },
  { id: 'landmine-squat', name: 'Landmine Squat', muscle: 'Legs', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'landmine-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['squat', 'front-squat', 'hack-squat'], unilateral: false, supportsWeighted: /weighted/i.test('landmine-squat'), supportsAssisted: /assisted/i.test('landmine-squat'), progression: 'load' },
  { id: 'landmine-romanian-deadlift', name: 'Landmine Romanian Deadlift', muscle: 'Glutes', equipment: ['barbell'], level: 'Intermediate', tags: ['compound','push'], imageSlug: 'landmine-romanian-deadlift', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['romanian-deadlift', 'good-morning', 'leg-curl'], unilateral: false, supportsWeighted: /weighted/i.test('landmine-romanian-deadlift'), supportsAssisted: /assisted/i.test('landmine-romanian-deadlift'), progression: 'load' },
  { id: 'glute-focused-back-extension', name: 'Glute-Focused Back Extension', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'glute-focused-back-extension', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('glute-focused-back-extension'), supportsAssisted: /assisted/i.test('glute-focused-back-extension'), progression: 'reps' },
  { id: 'reverse-hyperextension', name: 'Reverse Hyperextension', muscle: 'Glutes', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'reverse-hyperextension', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['hip-abduction-machine', 'smith-machine-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('reverse-hyperextension'), supportsAssisted: /assisted/i.test('reverse-hyperextension'), progression: 'reps' },
  { id: 'donkey-calf-raise', name: 'Donkey Calf Raise', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'donkey-calf-raise', cues: ["Full range","Pause at top","Slow negative"], substitution: ['standing-calf-raise', 'seated-calf-raise', 'jump-rope'], unilateral: false, supportsWeighted: /weighted/i.test('donkey-calf-raise'), supportsAssisted: /assisted/i.test('donkey-calf-raise'), progression: 'load' },
  { id: 'leg-press-calf-raise', name: 'Leg Press Calf Raise', muscle: 'Legs', equipment: ['machine'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'leg-press-calf-raise', cues: ["Full range","Pause at top","Slow negative"], substitution: ['standing-calf-raise', 'seated-calf-raise', 'jump-rope'], unilateral: false, supportsWeighted: /weighted/i.test('leg-press-calf-raise'), supportsAssisted: /assisted/i.test('leg-press-calf-raise'), progression: 'load' },
  { id: 'jump-squat', name: 'Jump Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning'], imageSlug: 'jump-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'bodyweight-squat', 'squat','pistol-squat','assisted-pistol-squat','shrimp-squat','cossack-squat','sissy-squat','lateral-lunge','skater-squat','standing-quad-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('jump-squat'), supportsAssisted: /assisted/i.test('jump-squat'), progression: 'reps' },
  { id: 'incline-dumbbell-curl', name: 'Incline Dumbbell Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Beginner', tags: ['isolation'], imageSlug: 'incline-dumbbell-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['bicep-curl', 'hammer-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('incline-dumbbell-curl'), supportsAssisted: /assisted/i.test('incline-dumbbell-curl'), progression: 'load' },
  { id: 'concentration-curl', name: 'Concentration Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'concentration-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['bicep-curl', 'hammer-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('concentration-curl'), supportsAssisted: /assisted/i.test('concentration-curl'), progression: 'load' },
  { id: 'ez-bar-curl', name: 'EZ-Bar Curl', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'ez-bar-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['drag-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('ez-bar-curl'), supportsAssisted: /assisted/i.test('ez-bar-curl'), progression: 'load' },
  { id: 'spider-curl', name: 'Spider Curl', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'spider-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['bicep-curl', 'hammer-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('spider-curl'), supportsAssisted: /assisted/i.test('spider-curl'), progression: 'load' },
  { id: 'rope-hammer-curl', name: 'Rope Hammer Curl', muscle: 'Arms', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'rope-hammer-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['cable-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('rope-hammer-curl'), supportsAssisted: /assisted/i.test('rope-hammer-curl'), progression: 'load' },
  { id: 'drag-curl', name: 'Drag Curl', muscle: 'Arms', equipment: ['barbell'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'drag-curl', cues: ["Elbows pinned","No swinging","Squeeze at the top"], substitution: ['ez-bar-curl', 'chin-up'], unilateral: false, supportsWeighted: /weighted/i.test('drag-curl'), supportsAssisted: /assisted/i.test('drag-curl'), progression: 'load' },
  { id: 'rope-tricep-pushdown', name: 'Rope Tricep Pushdown', muscle: 'Arms', equipment: ['cable'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'rope-tricep-pushdown', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['tricep-pushdown', 'overhead-tricep-extension', 'skull-crusher'], unilateral: false, supportsWeighted: /weighted/i.test('rope-tricep-pushdown'), supportsAssisted: /assisted/i.test('rope-tricep-pushdown'), progression: 'load' },
  { id: 'dumbbell-skull-crusher', name: 'Two Dumbbell Skullcrusher', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-skull-crusher', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['single-dumbbell-skullcrusher', 'dumbbell-overhead-tricep-extension', 'tricep-pushdown', 'single-arm-dumbbell-tricep-extension', 'tricep-kickback'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-skull-crusher'), supportsAssisted: /assisted/i.test('dumbbell-skull-crusher'), progression: 'load' },
  { id: 'single-dumbbell-skullcrusher', name: 'Single Dumbbell Skullcrusher', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'single-dumbbell-skullcrusher', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dumbbell-skull-crusher', 'dumbbell-overhead-tricep-extension', 'tricep-pushdown', 'single-arm-dumbbell-tricep-extension', 'tricep-kickback'], unilateral: false, supportsWeighted: /weighted/i.test('single-dumbbell-skullcrusher'), supportsAssisted: /assisted/i.test('single-dumbbell-skullcrusher'), progression: 'load' },
  { id: 'dumbbell-overhead-tricep-extension', name: 'Dumbbell Overhead Tricep Extension', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'dumbbell-overhead-tricep-extension', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dumbbell-skull-crusher', 'single-dumbbell-skullcrusher', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-overhead-tricep-extension'), supportsAssisted: /assisted/i.test('dumbbell-overhead-tricep-extension'), progression: 'load' },
  { id: 'single-arm-dumbbell-tricep-extension', name: 'Single Arm Dumbbell Tricep Extension', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'single-arm-dumbbell-tricep-extension', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dumbbell-skull-crusher', 'single-dumbbell-skullcrusher', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('single-arm-dumbbell-tricep-extension'), supportsAssisted: /assisted/i.test('single-arm-dumbbell-tricep-extension'), progression: 'load' },
  { id: 'tricep-kickback', name: 'Tricep Kickback', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'tricep-kickback', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dumbbell-skull-crusher', 'single-dumbbell-skullcrusher', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('tricep-kickback'), supportsAssisted: /assisted/i.test('tricep-kickback'), progression: 'load' },
  { id: 'wrist-extension', name: 'Wrist Extension', muscle: 'Arms', equipment: ['dumbbells'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'wrist-extension', cues: ["Wrist alignment","Slow controlled movement","Feel forearm tension"], substitution: ['farmer-carry', 'reverse-curl', 'wrist-curl'], unilateral: false, supportsWeighted: /weighted/i.test('wrist-extension'), supportsAssisted: /assisted/i.test('wrist-extension'), progression: 'load' },
  { id: 'crunch', name: 'Crunch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'crunch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('crunch'), supportsAssisted: /assisted/i.test('crunch'), progression: 'reps' },
  { id: 'reverse-crunch', name: 'Reverse Crunch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'reverse-crunch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('reverse-crunch'), supportsAssisted: /assisted/i.test('reverse-crunch'), progression: 'reps' },
  { id: 'russian-twist', name: 'Russian Twist', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'russian-twist', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('russian-twist'), supportsAssisted: /assisted/i.test('russian-twist'), progression: 'reps' },
  { id: 'bicycle-crunch', name: 'Bicycle Crunch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'bicycle-crunch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('bicycle-crunch'), supportsAssisted: /assisted/i.test('bicycle-crunch'), progression: 'reps' },
  { id: 'mountain-climber', name: 'Mountain Climber', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning'], imageSlug: 'mountain-climber', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('mountain-climber'), supportsAssisted: /assisted/i.test('mountain-climber'), progression: 'time' },
  { id: 'cable-woodchop', name: 'Cable Woodchop', muscle: 'Core', equipment: ['cable'], level: 'Intermediate', tags: ['compound'], imageSlug: 'cable-woodchop', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['cable-crunch', 'pallof-press', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('cable-woodchop'), supportsAssisted: /assisted/i.test('cable-woodchop'), progression: 'load' },
  { id: 'half-kneeling-pallof-press', name: 'Half-Kneeling Pallof Press', muscle: 'Core', equipment: ['cable'], level: 'Beginner', tags: ['compound','push','core-stability'], imageSlug: 'half-kneeling-pallof-press', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['cable-crunch', 'pallof-press', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('half-kneeling-pallof-press'), supportsAssisted: /assisted/i.test('half-kneeling-pallof-press'), progression: 'load' },
  { id: 'cable-pallof-hold', name: 'Cable Pallof Hold', muscle: 'Core', equipment: ['cable'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'cable-pallof-hold', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['cable-crunch', 'pallof-press', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('cable-pallof-hold'), supportsAssisted: /assisted/i.test('cable-pallof-hold'), progression: 'time' },
  { id: 'captains-chair-knee-raise', name: 'Captain\'s Chair Knee Raise', muscle: 'Core', equipment: ['machine'], level: 'Beginner', tags: ['isolation'], imageSlug: 'captains-chair-knee-raise', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank'], unilateral: false, supportsWeighted: /weighted/i.test('captains-chair-knee-raise'), supportsAssisted: /assisted/i.test('captains-chair-knee-raise'), progression: 'reps' },
  { id: 'decline-sit-up', name: 'Decline Sit-Up', muscle: 'Core', equipment: ['bench'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'decline-sit-up', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank'], unilateral: false, supportsWeighted: /weighted/i.test('decline-sit-up'), supportsAssisted: /assisted/i.test('decline-sit-up'), progression: 'reps' },
  { id: 'weighted-crunch', name: 'Weighted Crunch', muscle: 'Core', equipment: ['barbell'], level: 'Advanced', tags: ['compound'], imageSlug: 'weighted-crunch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-crunch'), supportsAssisted: /assisted/i.test('weighted-crunch'), progression: 'load' },
  { id: 'weighted-russian-twist', name: 'Weighted Russian Twist', muscle: 'Core', equipment: ['dumbbells'], level: 'Advanced', tags: ['compound'], imageSlug: 'weighted-russian-twist', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['dumbbell-side-bend', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('weighted-russian-twist'), supportsAssisted: /assisted/i.test('weighted-russian-twist'), progression: 'load' },
  { id: 'dumbbell-side-bend', name: 'Dumbbell Side Bend', muscle: 'Core', equipment: ['dumbbells'], level: 'Intermediate', tags: ['compound'], imageSlug: 'dumbbell-side-bend', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['weighted-russian-twist', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('dumbbell-side-bend'), supportsAssisted: /assisted/i.test('dumbbell-side-bend'), progression: 'load' },
  { id: 'elliptical', name: 'Elliptical', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'elliptical', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('elliptical'), supportsAssisted: /assisted/i.test('elliptical'), progression: 'time' },
  { id: 'swimming', name: 'Swimming', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'swimming', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['rowing', 'skierg', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('swimming'), supportsAssisted: /assisted/i.test('swimming'), progression: 'load' },
  { id: 'assault-bike', name: 'Assault Bike', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'assault-bike', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('assault-bike'), supportsAssisted: /assisted/i.test('assault-bike'), progression: 'load' },
  { id: 'skierg', name: 'SkiErg', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'skierg', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['rowing', 'swimming', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('skierg'), supportsAssisted: /assisted/i.test('skierg'), progression: 'load' },
  { id: 'hiking', name: 'Hiking', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'hiking', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('hiking'), supportsAssisted: /assisted/i.test('hiking'), progression: 'load' },
  { id: 'treadmill-incline-walk', name: 'Treadmill Incline Walk', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation'], imageSlug: 'treadmill-incline-walk', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['running', 'walking', 'burpee'], unilateral: false, supportsWeighted: /weighted/i.test('treadmill-incline-walk'), supportsAssisted: /assisted/i.test('treadmill-incline-walk'), progression: 'load' },
  { id: 'battle-ropes', name: 'Battle Ropes', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'battle-ropes', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('battle-ropes'), supportsAssisted: /assisted/i.test('battle-ropes'), progression: 'time' },
  { id: 'knee-push-up', name: 'Knee Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','push'], imageSlug: 'knee-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('knee-push-up'), supportsAssisted: /assisted/i.test('knee-push-up'), progression: 'reps' },
  { id: 'wide-push-up', name: 'Wide Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'wide-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('wide-push-up'), supportsAssisted: /assisted/i.test('wide-push-up'), progression: 'reps' },
  { id: 'diamond-push-up', name: 'Diamond Push-up', muscle: 'Arms', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'diamond-push-up', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dip', 'weighted-dip', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('diamond-push-up'), supportsAssisted: /assisted/i.test('diamond-push-up'), progression: 'reps' },
  { id: 'feet-elevated-pike-push-up', name: 'Feet-Elevated Pike Push-up', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'feet-elevated-pike-push-up', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['pike-push-up', 'handstand-push-up', 'overhead-press', 'arm-circles', 'cross-body-shoulder-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('feet-elevated-pike-push-up'), supportsAssisted: /assisted/i.test('feet-elevated-pike-push-up'), progression: 'reps' },
  { id: 'archer-push-up', name: 'Archer Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'archer-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('archer-push-up'), supportsAssisted: /assisted/i.test('archer-push-up'), progression: 'reps' },
  { id: 'typewriter-push-up', name: 'Typewriter Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'typewriter-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('typewriter-push-up'), supportsAssisted: /assisted/i.test('typewriter-push-up'), progression: 'reps' },
  { id: 'explosive-push-up', name: 'Explosive Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'explosive-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('explosive-push-up'), supportsAssisted: /assisted/i.test('explosive-push-up'), progression: 'reps' },
  { id: 'hindu-push-up', name: 'Hindu Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'hindu-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('hindu-push-up'), supportsAssisted: /assisted/i.test('hindu-push-up'), progression: 'reps' },
  { id: 'scapular-push-up', name: 'Scapular Push-up', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'scapular-push-up', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['prone-y-raise', 'prone-t-raise', 'face-pull', 'reverse-snow-angel'], unilateral: false, supportsWeighted: /weighted/i.test('scapular-push-up'), supportsAssisted: /assisted/i.test('scapular-push-up'), progression: 'reps' },
  { id: 'push-up-shoulder-tap', name: 'Push-up Shoulder Tap', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'push-up-shoulder-tap', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('push-up-shoulder-tap'), supportsAssisted: /assisted/i.test('push-up-shoulder-tap'), progression: 'reps' },
  { id: 'wall-push-up', name: 'Wall Push-up', muscle: 'Chest', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','push'], imageSlug: 'wall-push-up', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('wall-push-up'), supportsAssisted: /assisted/i.test('wall-push-up'), progression: 'reps' },
  { id: 'wall-walk', name: 'Wall Walk', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation'], imageSlug: 'wall-walk', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['wall-handstand-push-up', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('wall-walk'), supportsAssisted: /assisted/i.test('wall-walk'), progression: 'reps' },
  { id: 'wall-handstand-push-up', name: 'Wall Handstand Push-up', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','push'], imageSlug: 'wall-handstand-push-up', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['wall-walk', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('wall-handstand-push-up'), supportsAssisted: /assisted/i.test('wall-handstand-push-up'), progression: 'reps' },
  { id: 'handstand-push-up', name: 'Handstand Push-up', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'handstand-push-up', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['pike-push-up', 'feet-elevated-pike-push-up', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('handstand-push-up'), supportsAssisted: /assisted/i.test('handstand-push-up'), progression: 'reps' },
  { id: 'chair-dip', name: 'Chair Dip', muscle: 'Arms', equipment: ['bench'], level: 'Intermediate', tags: ['isolation','push'], imageSlug: 'chair-dip', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('chair-dip'), supportsAssisted: /assisted/i.test('chair-dip'), progression: 'reps' },
  { id: 'doorway-row', name: 'Doorway Row', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','pull','mobility'], imageSlug: 'doorway-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('doorway-row'), supportsAssisted: /assisted/i.test('doorway-row'), progression: 'reps' },
  { id: 'towel-row', name: 'Towel Row', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'towel-row', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('towel-row'), supportsAssisted: /assisted/i.test('towel-row'), progression: 'reps' },
  { id: 'prone-y-raise', name: 'Prone Y Raise', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'prone-y-raise', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['scapular-push-up', 'prone-t-raise', 'face-pull', 'reverse-snow-angel'], unilateral: false, supportsWeighted: /weighted/i.test('prone-y-raise'), supportsAssisted: /assisted/i.test('prone-y-raise'), progression: 'reps' },
  { id: 'prone-t-raise', name: 'Prone T Raise', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'prone-t-raise', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['scapular-push-up', 'prone-y-raise', 'face-pull'], unilateral: false, supportsWeighted: /weighted/i.test('prone-t-raise'), supportsAssisted: /assisted/i.test('prone-t-raise'), progression: 'reps' },
  { id: 'reverse-snow-angel', name: 'Reverse Snow Angel', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'reverse-snow-angel', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['scapular-push-up', 'prone-y-raise', 'face-pull'], unilateral: false, supportsWeighted: /weighted/i.test('reverse-snow-angel'), supportsAssisted: /assisted/i.test('reverse-snow-angel'), progression: 'reps' },
  { id: 'dead-hang', name: 'Dead Hang', muscle: 'Arms', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'dead-hang', cues: ["Wrist alignment","Slow controlled movement","Feel forearm tension"], substitution: ['reverse-curl'], unilateral: false, supportsWeighted: /weighted/i.test('dead-hang'), supportsAssisted: /assisted/i.test('dead-hang'), progression: 'time' },
  { id: 'active-hang', name: 'Active Hang', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'active-hang', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['scapular-pull-up', 'negative-pull-up', 'lat-pulldown', 'commando-pull-up', 'l-sit-pull-up'], unilateral: false, supportsWeighted: /weighted/i.test('active-hang'), supportsAssisted: /assisted/i.test('active-hang'), progression: 'time' },
  { id: 'scapular-pull-up', name: 'Scapular Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'scapular-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['active-hang', 'negative-pull-up', 'lat-pulldown', 'commando-pull-up', 'l-sit-pull-up'], unilateral: false, supportsWeighted: /weighted/i.test('scapular-pull-up'), supportsAssisted: /assisted/i.test('scapular-pull-up'), progression: 'reps' },
  { id: 'negative-pull-up', name: 'Negative Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'negative-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['active-hang', 'scapular-pull-up', 'lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('negative-pull-up'), supportsAssisted: /assisted/i.test('negative-pull-up'), progression: 'reps' },
  { id: 'commando-pull-up', name: 'Commando Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'commando-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['active-hang', 'scapular-pull-up', 'lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('commando-pull-up'), supportsAssisted: /assisted/i.test('commando-pull-up'), progression: 'reps' },
  { id: 'l-sit-pull-up', name: 'L-Sit Pull-up', muscle: 'Back', equipment: ['pullup-bar'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'l-sit-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['active-hang', 'scapular-pull-up', 'lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('l-sit-pull-up'), supportsAssisted: /assisted/i.test('l-sit-pull-up'), progression: 'reps' },
  { id: 'towel-pull-up', name: 'Towel Pull-up', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','pull'], imageSlug: 'towel-pull-up', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('towel-pull-up'), supportsAssisted: /assisted/i.test('towel-pull-up'), progression: 'reps' },
  { id: 'pistol-squat', name: 'Pistol Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Advanced', tags: ['isolation'], imageSlug: 'pistol-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('pistol-squat'), supportsAssisted: /assisted/i.test('pistol-squat'), progression: 'reps' },
  { id: 'assisted-pistol-squat', name: 'Assisted Pistol Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Advanced', tags: ['isolation'], imageSlug: 'assisted-pistol-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('assisted-pistol-squat'), supportsAssisted: /assisted/i.test('assisted-pistol-squat'), progression: 'reps' },
  { id: 'shrimp-squat', name: 'Shrimp Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'shrimp-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('shrimp-squat'), supportsAssisted: /assisted/i.test('shrimp-squat'), progression: 'reps' },
  { id: 'cossack-squat', name: 'Cossack Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'cossack-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('cossack-squat'), supportsAssisted: /assisted/i.test('cossack-squat'), progression: 'reps' },
  { id: 'sissy-squat', name: 'Sissy Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'sissy-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('sissy-squat'), supportsAssisted: /assisted/i.test('sissy-squat'), progression: 'reps' },
  { id: 'lateral-lunge', name: 'Lateral Lunge', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'lateral-lunge', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('lateral-lunge'), supportsAssisted: /assisted/i.test('lateral-lunge'), progression: 'reps' },
  { id: 'curtsy-lunge', name: 'Curtsy Lunge', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'curtsy-lunge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('curtsy-lunge'), supportsAssisted: /assisted/i.test('curtsy-lunge'), progression: 'reps' },
  { id: 'skater-squat', name: 'Skater Squat', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'skater-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('skater-squat'), supportsAssisted: /assisted/i.test('skater-squat'), progression: 'reps' },
  { id: 'single-leg-box-squat', name: 'Single-Leg Box Squat', muscle: 'Legs', equipment: ['bench'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'single-leg-box-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['step-down', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('single-leg-box-squat'), supportsAssisted: /assisted/i.test('single-leg-box-squat'), progression: 'reps' },
  { id: 'step-down', name: 'Step-Down', muscle: 'Legs', equipment: ['bench'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'step-down', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['single-leg-box-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('step-down'), supportsAssisted: /assisted/i.test('step-down'), progression: 'reps' },
  { id: 'single-leg-calf-raise', name: 'Single-Leg Calf Raise', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','unilateral'], imageSlug: 'single-leg-calf-raise', cues: ["Full range","Pause at top","Slow negative"], substitution: ['calf-raise', 'fast-feet', 'standing-calf-raise', 'wall-calf-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('single-leg-calf-raise'), supportsAssisted: /assisted/i.test('single-leg-calf-raise'), progression: 'reps' },
  { id: 'glute-bridge-march', name: 'Glute Bridge March', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'glute-bridge-march', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('glute-bridge-march'), supportsAssisted: /assisted/i.test('glute-bridge-march'), progression: 'reps' },
  { id: 'frog-pump', name: 'Frog Pump', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'frog-pump', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('frog-pump'), supportsAssisted: /assisted/i.test('frog-pump'), progression: 'reps' },
  { id: 'donkey-kick', name: 'Donkey Kick', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'donkey-kick', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('donkey-kick'), supportsAssisted: /assisted/i.test('donkey-kick'), progression: 'reps' },
  { id: 'fire-hydrant', name: 'Fire Hydrant', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'fire-hydrant', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('fire-hydrant'), supportsAssisted: /assisted/i.test('fire-hydrant'), progression: 'reps' },
  { id: 'clamshell', name: 'Clamshell', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'clamshell', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('clamshell'), supportsAssisted: /assisted/i.test('clamshell'), progression: 'reps' },
  { id: 'hip-airplane', name: 'Hip Airplane', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'hip-airplane', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('hip-airplane'), supportsAssisted: /assisted/i.test('hip-airplane'), progression: 'reps' },
  { id: 'side-lying-hip-abduction', name: 'Side-Lying Hip Abduction', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'side-lying-hip-abduction', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('side-lying-hip-abduction'), supportsAssisted: /assisted/i.test('side-lying-hip-abduction'), progression: 'reps' },
  { id: 'side-lying-leg-raise', name: 'Side-Lying Leg Raise', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'side-lying-leg-raise', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['glute-bridge', 'single-leg-glute-bridge', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('side-lying-leg-raise'), supportsAssisted: /assisted/i.test('side-lying-leg-raise'), progression: 'reps' },
  { id: 'lying-hamstring-walkout', name: 'Lying Hamstring Walkout', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'lying-hamstring-walkout', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['nordic-curl', 'hamstring-stretch', 'romanian-deadlift', 'seated-forward-fold-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('lying-hamstring-walkout'), supportsAssisted: /assisted/i.test('lying-hamstring-walkout'), progression: 'reps' },
  { id: 'towel-hamstring-curl', name: 'Towel Hamstring Curl', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'towel-hamstring-curl', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('towel-hamstring-curl'), supportsAssisted: /assisted/i.test('towel-hamstring-curl'), progression: 'reps' },
  { id: 'stability-ball-hamstring-curl', name: 'Stability Ball Hamstring Curl', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'stability-ball-hamstring-curl', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('stability-ball-hamstring-curl'), supportsAssisted: /assisted/i.test('stability-ball-hamstring-curl'), progression: 'reps' },
  { id: 'banded-glute-bridge', name: 'Banded Glute Bridge', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-glute-bridge', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-hip-thrust', 'banded-frog-pump', 'hip-thrust', 'banded-clamshell', 'banded-lateral-walk', 'banded-monster-walk', 'banded-donkey-kick', 'banded-fire-hydrant', 'banded-kickback', 'banded-standing-hip-abduction', 'banded-seated-hip-abduction'], unilateral: false, supportsWeighted: /weighted/i.test('banded-glute-bridge'), supportsAssisted: /assisted/i.test('banded-glute-bridge'), progression: 'reps' },
  { id: 'banded-hip-thrust', name: 'Banded Hip Thrust', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-hip-thrust', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-frog-pump', 'hip-thrust', 'banded-clamshell', 'banded-lateral-walk', 'banded-monster-walk', 'banded-donkey-kick', 'banded-fire-hydrant', 'banded-kickback', 'banded-standing-hip-abduction', 'banded-seated-hip-abduction'], unilateral: false, supportsWeighted: /weighted/i.test('banded-hip-thrust'), supportsAssisted: /assisted/i.test('banded-hip-thrust'), progression: 'reps' },
  { id: 'banded-frog-pump', name: 'Banded Frog Pump', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-frog-pump', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-frog-pump'), supportsAssisted: /assisted/i.test('banded-frog-pump'), progression: 'reps' },
  { id: 'banded-clamshell', name: 'Banded Clamshell', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-clamshell', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-clamshell'), supportsAssisted: /assisted/i.test('banded-clamshell'), progression: 'reps' },
  { id: 'banded-lateral-walk', name: 'Banded Lateral Walk', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-lateral-walk', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-lateral-walk'), supportsAssisted: /assisted/i.test('banded-lateral-walk'), progression: 'reps' },
  { id: 'banded-monster-walk', name: 'Banded Monster Walk', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-monster-walk', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-monster-walk'), supportsAssisted: /assisted/i.test('banded-monster-walk'), progression: 'reps' },
  { id: 'banded-squat', name: 'Banded Squat', muscle: 'Legs', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-squat', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['squat'], unilateral: false, supportsWeighted: /weighted/i.test('banded-squat'), supportsAssisted: /assisted/i.test('banded-squat'), progression: 'reps' },
  { id: 'banded-donkey-kick', name: 'Banded Donkey Kick', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-donkey-kick', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-donkey-kick'), supportsAssisted: /assisted/i.test('banded-donkey-kick'), progression: 'reps' },
  { id: 'banded-fire-hydrant', name: 'Banded Fire Hydrant', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-fire-hydrant', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-fire-hydrant'), supportsAssisted: /assisted/i.test('banded-fire-hydrant'), progression: 'reps' },
  { id: 'banded-kickback', name: 'Banded Kickback', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-kickback', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-kickback'), supportsAssisted: /assisted/i.test('banded-kickback'), progression: 'reps' },
  { id: 'banded-standing-hip-abduction', name: 'Banded Standing Hip Abduction', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-standing-hip-abduction', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-standing-hip-abduction'), supportsAssisted: /assisted/i.test('banded-standing-hip-abduction'), progression: 'reps' },
  { id: 'banded-seated-hip-abduction', name: 'Banded Seated Hip Abduction', muscle: 'Glutes', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-seated-hip-abduction', cues: ["Drive hips forward","Squeeze at lockout","Control the eccentric"], substitution: ['banded-glute-bridge', 'banded-hip-thrust', 'hip-thrust'], unilateral: false, supportsWeighted: /weighted/i.test('banded-seated-hip-abduction'), supportsAssisted: /assisted/i.test('banded-seated-hip-abduction'), progression: 'reps' },
  { id: 'band-pull-apart', name: 'Band Pull-Apart', muscle: 'Back', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'band-pull-apart', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['banded-face-pull', 'face-pull'], unilateral: false, supportsWeighted: /weighted/i.test('band-pull-apart'), supportsAssisted: /assisted/i.test('band-pull-apart'), progression: 'reps' },
  { id: 'banded-face-pull', name: 'Banded Face Pull', muscle: 'Back', equipment: ['bands'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'banded-face-pull', cues: ["Pinch shoulder blades","Chin tucked","Hold briefly"], substitution: ['band-pull-apart', 'face-pull'], unilateral: false, supportsWeighted: /weighted/i.test('banded-face-pull'), supportsAssisted: /assisted/i.test('banded-face-pull'), progression: 'reps' },
  { id: 'banded-lat-pulldown', name: 'Banded Lat Pulldown', muscle: 'Back', equipment: ['bands'], level: 'Beginner', tags: ['isolation','pull'], imageSlug: 'banded-lat-pulldown', cues: ["Initiate from the armpit","Keep torso stable","Full stretch at top"], substitution: ['lat-pulldown'], unilateral: false, supportsWeighted: /weighted/i.test('banded-lat-pulldown'), supportsAssisted: /assisted/i.test('banded-lat-pulldown'), progression: 'reps' },
  { id: 'banded-pallof-press', name: 'Banded Pallof Press', muscle: 'Core', equipment: ['bands'], level: 'Beginner', tags: ['isolation','push','core-stability'], imageSlug: 'banded-pallof-press', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['banded-woodchop', 'banded-dead-bug', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('banded-pallof-press'), supportsAssisted: /assisted/i.test('banded-pallof-press'), progression: 'reps' },
  { id: 'banded-woodchop', name: 'Banded Woodchop', muscle: 'Core', equipment: ['bands'], level: 'Beginner', tags: ['isolation'], imageSlug: 'banded-woodchop', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['banded-pallof-press', 'banded-dead-bug', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('banded-woodchop'), supportsAssisted: /assisted/i.test('banded-woodchop'), progression: 'reps' },
  { id: 'banded-dead-bug', name: 'Banded Dead Bug', muscle: 'Core', equipment: ['bands'], level: 'Beginner', tags: ['isolation','core-stability'], imageSlug: 'banded-dead-bug', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['banded-pallof-press', 'banded-woodchop', 'plank'], unilateral: false, supportsWeighted: /weighted/i.test('banded-dead-bug'), supportsAssisted: /assisted/i.test('banded-dead-bug'), progression: 'reps' },
  { id: 'hollow-body-hold', name: 'Hollow Body Hold', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'hollow-body-hold', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('hollow-body-hold'), supportsAssisted: /assisted/i.test('hollow-body-hold'), progression: 'time' },
  { id: 'hollow-rock', name: 'Hollow Rock', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'hollow-rock', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('hollow-rock'), supportsAssisted: /assisted/i.test('hollow-rock'), progression: 'reps' },
  { id: 'v-up', name: 'V-Up', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'v-up', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('v-up'), supportsAssisted: /assisted/i.test('v-up'), progression: 'reps' },
  { id: 'flutter-kick', name: 'Flutter Kick', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'flutter-kick', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('flutter-kick'), supportsAssisted: /assisted/i.test('flutter-kick'), progression: 'time' },
  { id: 'lying-leg-raise', name: 'Lying Leg Raise', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'lying-leg-raise', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('lying-leg-raise'), supportsAssisted: /assisted/i.test('lying-leg-raise'), progression: 'reps' },
  { id: 'toe-touch', name: 'Toe Touch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'toe-touch', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('toe-touch'), supportsAssisted: /assisted/i.test('toe-touch'), progression: 'reps' },
  { id: 'heel-tap', name: 'Heel Tap', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'heel-tap', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('heel-tap'), supportsAssisted: /assisted/i.test('heel-tap'), progression: 'reps' },
  { id: 'plank-shoulder-tap', name: 'Plank Shoulder Tap', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'plank-shoulder-tap', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('plank-shoulder-tap'), supportsAssisted: /assisted/i.test('plank-shoulder-tap'), progression: 'reps' },
  { id: 'plank-jack', name: 'Plank Jack', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'plank-jack', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('plank-jack'), supportsAssisted: /assisted/i.test('plank-jack'), progression: 'time' },
  { id: 'bear-plank', name: 'Bear Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'bear-plank', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('bear-plank'), supportsAssisted: /assisted/i.test('bear-plank'), progression: 'time' },
  { id: 'crab-walk', name: 'Crab Walk', muscle: 'Arms', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'crab-walk', cues: ["Elbows narrow","Full extension","Slow negative"], substitution: ['dip', 'weighted-dip', 'tricep-pushdown'], unilateral: false, supportsWeighted: /weighted/i.test('crab-walk'), supportsAssisted: /assisted/i.test('crab-walk'), progression: 'time' },
  { id: 'inchworm', name: 'Inchworm', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'inchworm', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('inchworm'), supportsAssisted: /assisted/i.test('inchworm'), progression: 'reps' },
  { id: 'l-sit-hold', name: 'L-Sit Hold', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'l-sit-hold', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('l-sit-hold'), supportsAssisted: /assisted/i.test('l-sit-hold'), progression: 'time' },
  { id: 'seated-knee-tuck', name: 'Seated Knee Tuck', muscle: 'Core', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation'], imageSlug: 'seated-knee-tuck', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('seated-knee-tuck'), supportsAssisted: /assisted/i.test('seated-knee-tuck'), progression: 'reps' },
  { id: 'side-plank-hip-dip', name: 'Side Plank Hip Dip', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','push','core-stability'], imageSlug: 'side-plank-hip-dip', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('side-plank-hip-dip'), supportsAssisted: /assisted/i.test('side-plank-hip-dip'), progression: 'reps' },
  { id: 'copenhagen-plank', name: 'Copenhagen Plank', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','core-stability'], imageSlug: 'copenhagen-plank', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('copenhagen-plank'), supportsAssisted: /assisted/i.test('copenhagen-plank'), progression: 'time' },
  { id: 'dragon-flag', name: 'Dragon Flag', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'dragon-flag', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('dragon-flag'), supportsAssisted: /assisted/i.test('dragon-flag'), progression: 'reps' },
  { id: 'half-burpee', name: 'Half Burpee', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning'], imageSlug: 'half-burpee', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('half-burpee'), supportsAssisted: /assisted/i.test('half-burpee'), progression: 'reps' },
  { id: 'squat-thrust', name: 'Squat Thrust', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'squat-thrust', cues: ["Ribcage down","Breathe steadily","No lower-back sag"], substitution: ['plank', 'side-plank', 'cable-crunch'], unilateral: false, supportsWeighted: /weighted/i.test('squat-thrust'), supportsAssisted: /assisted/i.test('squat-thrust'), progression: 'reps' },
  { id: 'jumping-jack', name: 'Jumping Jack', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning'], imageSlug: 'jumping-jack', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['burpee', 'high-knees', 'running'], unilateral: false, supportsWeighted: /weighted/i.test('jumping-jack'), supportsAssisted: /assisted/i.test('jumping-jack'), progression: 'time' },
  { id: 'skater-hop', name: 'Skater Hop', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'skater-hop', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['burpee', 'high-knees', 'running'], unilateral: false, supportsWeighted: /weighted/i.test('skater-hop'), supportsAssisted: /assisted/i.test('skater-hop'), progression: 'reps' },
  { id: 'lateral-shuffle', name: 'Lateral Shuffle', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'lateral-shuffle', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['burpee', 'high-knees', 'running'], unilateral: false, supportsWeighted: /weighted/i.test('lateral-shuffle'), supportsAssisted: /assisted/i.test('lateral-shuffle'), progression: 'time' },
  { id: 'fast-feet', name: 'Fast Feet', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'fast-feet', cues: ["Full range","Pause at top","Slow negative"], substitution: ['calf-raise', 'single-leg-calf-raise', 'standing-calf-raise'], unilateral: false, supportsWeighted: /weighted/i.test('fast-feet'), supportsAssisted: /assisted/i.test('fast-feet'), progression: 'time' },
  { id: 'sprawl', name: 'Sprawl', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'sprawl', cues: ["Steady effort","Breathe rhythmically","Maintain form"], substitution: ['burpee', 'high-knees', 'running'], unilateral: false, supportsWeighted: /weighted/i.test('sprawl'), supportsAssisted: /assisted/i.test('sprawl'), progression: 'reps' },
  { id: 'seal-jack', name: 'Seal Jack', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'seal-jack', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['push-up', 'weighted-push-up', 'bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('seal-jack'), supportsAssisted: /assisted/i.test('seal-jack'), progression: 'time' },
  { id: 'cat-cow-stretch', name: 'Cat-Cow Stretch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'cat-cow-stretch', cues: ["Gentle stretch","Breathe into it","No bouncing"], substitution: ['worlds-greatest-stretch', 'leg-swings-stretch', 'torso-twist-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('cat-cow-stretch'), supportsAssisted: /assisted/i.test('cat-cow-stretch'), progression: 'time', isStretch: true },
  { id: 'arm-circles', name: 'Arm Circles', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'arm-circles', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['pike-push-up', 'feet-elevated-pike-push-up', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('arm-circles'), supportsAssisted: /assisted/i.test('arm-circles'), progression: 'time', isStretch: true },
  { id: 'worlds-greatest-stretch', name: 'World\'s Greatest Stretch', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'worlds-greatest-stretch', cues: ["Gentle stretch","Breathe into it","No bouncing"], substitution: ['cat-cow-stretch', 'leg-swings-stretch', 'torso-twist-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('worlds-greatest-stretch'), supportsAssisted: /assisted/i.test('worlds-greatest-stretch'), progression: 'time', isStretch: true },
  { id: 'leg-swings-stretch', name: 'Leg Swings', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','explosive','conditioning','mobility'], imageSlug: 'leg-swings-stretch', cues: ["Gentle stretch","Breathe into it","No bouncing"], substitution: ['cat-cow-stretch', 'worlds-greatest-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('leg-swings-stretch'), supportsAssisted: /assisted/i.test('leg-swings-stretch'), progression: 'time', isStretch: true },
  { id: 'torso-twist-stretch', name: 'Torso Twists', muscle: 'Core', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'torso-twist-stretch', cues: ["Gentle stretch","Breathe into it","No bouncing"], substitution: ['cat-cow-stretch', 'worlds-greatest-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('torso-twist-stretch'), supportsAssisted: /assisted/i.test('torso-twist-stretch'), progression: 'time', isStretch: true },
  { id: 'doorway-chest-stretch', name: 'Doorway Chest Stretch', muscle: 'Chest', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'doorway-chest-stretch', cues: ["Retract shoulder blades","Control the descent","Full stretch at bottom"], substitution: ['bench-press'], unilateral: false, supportsWeighted: /weighted/i.test('doorway-chest-stretch'), supportsAssisted: /assisted/i.test('doorway-chest-stretch'), progression: 'time', isStretch: true },
  { id: 'childs-pose', name: 'Child\'s Pose', muscle: 'Back', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation'], imageSlug: 'childs-pose', cues: ["Squeeze shoulder blades","Pull with elbows","Control the return"], substitution: ['inverted-row', 'barbell-row'], unilateral: false, supportsWeighted: /weighted/i.test('childs-pose'), supportsAssisted: /assisted/i.test('childs-pose'), progression: 'time', isStretch: true },
  { id: 'kneeling-hip-flexor-stretch', name: 'Kneeling Hip Flexor Stretch', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','mobility'], imageSlug: 'kneeling-hip-flexor-stretch', cues: ["Controlled range","Feel hip opening","No forcing"], substitution: ['butterfly-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('kneeling-hip-flexor-stretch'), supportsAssisted: /assisted/i.test('kneeling-hip-flexor-stretch'), progression: 'time', isStretch: true },
  { id: 'hamstring-stretch', name: 'Hamstring Stretch', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'hamstring-stretch', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['nordic-curl', 'lying-hamstring-walkout', 'romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('hamstring-stretch'), supportsAssisted: /assisted/i.test('hamstring-stretch'), progression: 'time', isStretch: true },
  { id: 'standing-quad-stretch', name: 'Standing Quad Stretch', muscle: 'Legs', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'standing-quad-stretch', cues: ["Knees track toes","Drive through mid-foot","Full lockout at top"], substitution: ['wall-sit', 'jump-squat', 'squat'], unilateral: false, supportsWeighted: /weighted/i.test('standing-quad-stretch'), supportsAssisted: /assisted/i.test('standing-quad-stretch'), progression: 'time', isStretch: true },
  { id: 'seated-forward-fold-stretch', name: 'Seated Forward Fold', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','mobility'], imageSlug: 'seated-forward-fold-stretch', cues: ["Soft knees","Feel the stretch","Neutral spine"], substitution: ['nordic-curl', 'lying-hamstring-walkout', 'romanian-deadlift'], unilateral: false, supportsWeighted: /weighted/i.test('seated-forward-fold-stretch'), supportsAssisted: /assisted/i.test('seated-forward-fold-stretch'), progression: 'time', isStretch: true },
  { id: 'cross-body-shoulder-stretch', name: 'Cross-Body Shoulder Stretch', muscle: 'Shoulders', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'cross-body-shoulder-stretch', cues: ["Core braced","Press without arching","Elbows slightly forward"], substitution: ['pike-push-up', 'feet-elevated-pike-push-up', 'overhead-press'], unilateral: false, supportsWeighted: /weighted/i.test('cross-body-shoulder-stretch'), supportsAssisted: /assisted/i.test('cross-body-shoulder-stretch'), progression: 'time', isStretch: true },
  { id: 'wall-calf-stretch', name: 'Wall Calf Stretch', muscle: 'Legs', equipment: ['bodyweight'], level: 'Beginner', tags: ['isolation','mobility'], imageSlug: 'wall-calf-stretch', cues: ["Full range","Pause at top","Slow negative"], substitution: ['calf-raise', 'single-leg-calf-raise', 'standing-calf-raise'], unilateral: false, supportsWeighted: /weighted/i.test('wall-calf-stretch'), supportsAssisted: /assisted/i.test('wall-calf-stretch'), progression: 'time', isStretch: true },
  { id: 'butterfly-stretch', name: 'Butterfly Stretch', muscle: 'Glutes', equipment: ['bodyweight'], level: 'Intermediate', tags: ['isolation','mobility'], imageSlug: 'butterfly-stretch', cues: ["Controlled range","Feel hip opening","No forcing"], substitution: ['kneeling-hip-flexor-stretch'], unilateral: false, supportsWeighted: /weighted/i.test('butterfly-stretch'), supportsAssisted: /assisted/i.test('butterfly-stretch'), progression: 'time', isStretch: true },

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
