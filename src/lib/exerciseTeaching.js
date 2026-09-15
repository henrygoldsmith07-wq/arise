// exerciseTeaching.js — the teaching layer for the core lifts.
//
// One high-quality structured guide per exercise, built for the gym floor:
// what to do, how to breathe and brace, what people get wrong, how to make it
// easier or harder, and what else to reach for with other kit. Content is
// practical coaching language, never medical advice — no diagnosis, no
// treatment, no pain-management claims.
//
// Every exercise gets the full structure: hand-curated overrides for the
// core lifts where breath/safety phrasing matters, plus honest derivation
// from the existing library (instructions, cues, mistakes, substitution
// edges, level, equipment). Nothing here invents exercises: regressions,
// progressions and equipment variations are always real library ids.

import { EXERCISES, EXERCISE_BY_ID, EQUIPMENT } from './data.js';

export const TEACHING_SECTIONS = ['setup', 'execution', 'breathing', 'mistakes', 'safety', 'regressions', 'progressions', 'equipmentVariations'];

const LEVEL_ORDER = ['Beginner', 'Intermediate', 'Advanced'];
const EQUIP_LABEL = Object.fromEntries(EQUIPMENT.map(e=> [e.id, e.label.replace(/ &.*$/, '').replace(/ only$/, '').toLowerCase()]));

// Curated breathing/bracing and safety lines for the movements where the
// phrasing earns its place. Kept short, practical, non-medical.
const OVERRIDES = {
  'push-up': { breath: 'Breathe in on the way down, exhale as you press up. Keep your ribs stacked over your hips the whole time.', safety: 'Stop the set when your form breaks down rather than grinding to failure — a slow, honest rep builds more than a wobbly one.' },
  'bench-press-barbell': { breath: 'Big breath into your belly, brace like you are about to be poked, press, then exhale near the top. Between reps reset your breath on the chest.', safety: 'Use the safeties or a spotter with heavy loads, and unrack to your chest — never reach up to find the hooks with the weight over your face.' },
  'bench-press-dumbbell': { breath: 'Inhale and brace on the way down, exhale as you press up. Finish each rep before you breathe again.', safety: 'Kick the dumbbells up into the start position and lower them under control — dropping heavy dumbbells at the bottom strains shoulders.' },
  'incline-dumbbell-press': { breath: 'Inhale at the bottom, exhale as you press. Keep the bench set firmly at 30–45°, not vertical.', safety: 'Start with lighter dumbbells than flat press — the incline asks more of the front shoulder.' },
  'overhead-press-barbell': { breath: 'Breathe in hard before the press and brace through the whole rep; move your head back slightly as the bar passes your face, then through the "window".', safety: 'Keep your ribs down — if your back arches to get the bar up, the weight is too heavy or your range is too tight.' },
  'overhead-press-dumbbell': { breath: 'Inhale and brace at the bottom, exhale on the press. Finish with the dumbbells over your ears, not in front.', safety: 'Do not lock out hard behind the neck — press the path slightly forward where the shoulder is happiest.' },
  'barbell-squat': { breath: 'Full breath and big brace before you unrack; hold it all the way down and up, then exhale after standing. Reset breath between reps.', safety: 'Brace before you unrack, keep the bar over your mid-foot, and never round your back to chase depth — depth grows with mobility, not with recklessness.' },
  'front-squat': { breath: 'Small sips of air between reps rather than one huge brace — the front rack makes a maximal belly breath uncomfortable.', safety: 'If your elbows drop, the bar rolls forward — keep the wrists high and the chest tall; use straps or a cross-arm rack if your wrists are the limit.' },
  'goblet-squat': { breath: 'Inhale down, exhale up. The front-loaded weight makes it hard to cheat your posture.', safety: 'Stand tall through the whole rep — if the bell pulls you forward, drop to a lighter one.' },
  'bodyweight-squat': { breath: 'Inhale as you sit down, exhale as you stand. Heels stay flat.', safety: 'Sink only as deep as you can while your heels stay down and your back stays flat.' },
  'romanian-deadlift': { breath: 'Inhale and brace at the top, hinge while holding the brace, exhale as you stand back up.', safety: 'Stop the lowering when your back would have to round to go further — the movement ends when the hamstrings say so, not the floor.' },
  'sumo-deadlift': { breath: 'Big breath, brace hard, push the floor away — exhale only after the lockout.', safety: 'Take up the slack in the bar before you pull; nothing moves until the plates rattle.' },
  'deadlift': { breath: 'Inhale, brace like a belt one notch tighter, then drive the floor down. Exhale after lockout.', safety: 'Keep the bar against your legs and your armpits over the bar — if the hips shoot up first, reset and pull another way.' },
  'pull-up': { breath: 'Exhale as you pull up, inhale as you lower under control. Own the bottom position — no dead hangs into a bounce.', safety: 'Come down all the way with control; if the last reps turn into chin-thrusts, that is the set over.' },
  'chin-up': { breath: 'Exhale up, inhale down. Keep the ribs down at the top.', safety: 'Stop before your shoulders start shrugging up to do the work — one clean more than a sloppy last rep.' },
  'lat-pulldown': { breath: 'Exhale as you pull down, inhale as you return slowly.', safety: 'Lean back only slightly; if you swing the torso, the weight is more than the lats can handle.' },
  'dumbbell-row': { breath: 'Exhale as you pull, inhale as you lower. Keep a tall spine on the bench.', safety: 'Do not twist to reach further — the extra range from rotation costs more than it gives.' },
  'cable-row': { breath: 'Exhale into the pull, inhale on the return; let the shoulder blades move but keep the torso still.', safety: 'Stop the weight before it yanks your shoulders forward — control the whole return.' },
  'band-row': { breath: 'Exhale as you pull, inhale as the band stretches back.', safety: 'Anchor the band at chest height and keep your back tall — if you have to lean back hard, shorten the band or use lighter tension.' },
  'dumbbell-fly': { breath: 'Inhale as you open, exhale as you bring them back together.', safety: 'Slight bend in the elbows throughout and stop the stretch where your shoulders feel fine — this is not a deep-stretch exercise.' },
  'cable-fly': { breath: 'Exhale as you bring the handles together, inhale as you open slowly.', safety: 'Set up hinged slightly forward with a soft elbow, and keep the movement slow — cables snap out of range fast.' },
  'machine-fly': { breath: 'Exhale on the squeeze, inhale on the open.', safety: 'Adjust the seat before the set — the handles should meet at mid-chest, not at your face.' },
  'tricep-dip-bench': { breath: 'Inhale down, exhale up. Keep your heels on the floor to control the lever.', safety: 'Only go as deep as your shoulders allow comfortably — shallow and steady builds better than deep and cranky.' },
  'tricep-pushdown': { breath: 'Exhale as you extend, inhale on the way up.', safety: 'Pin the elbows to your ribs — if they swing forward, you are pressing with your shoulders, not your triceps.' },
  'barbell-curl': { breath: 'Exhale on the curl, inhale down. Keep the ribs stacked, not arched.', safety: 'Stop the swing — the last two reps with cheating load build biceps badly and lower backs worse.' },
  'hammer-curl': { breath: 'Exhale up, inhale down, wrists stay neutral.', safety: 'Keep the elbow in front of the body, not drifting back — and keep your wrists from flicking.' },
  'plank': { breath: 'Breathe normally through the brace — a held breath is not a held plank.', safety: 'Hold only as long as your hips keep the straight line; a sagging minute teaches nothing.' },
  'side-plank': { breath: 'Steady breathing while the obliques stay firm.', safety: 'Stop when the top hip starts dropping toward the floor.' },
  'dead-bug': { breath: 'Exhale as the limbs reach away, inhale back in — the ribs stay down the whole time.', safety: 'Move slowly; the exercise only works while your lower back stays quiet.' },
  'bird-dog': { breath: 'Exhale as you extend, inhale as you return, spine stays still.', safety: 'Balance height over range — a hip that rocks is the rep ending.' },
  'lunge': { breath: 'Inhale down, exhale up; keep the torso tall.', safety: 'Take a long-enough stride that the front knee stays friendly — short, stabbing strides are just a knee exercise you did not order.' },
  'split-squat': { breath: 'Inhale as you drop, exhale as you drive up.', safety: 'Back foot only assists balance — the front leg does the work.' },
  'bulgarian-split-squat': { breath: 'Inhale down, exhale up. Hold dumbbells at your sides to load it honestly.', safety: 'Only rest the back foot on the bench if the stretch is comfortable; if the knee hurts, shorten the stance.' },
  'glute-bridge': { breath: 'Exhale as you drive the hips up, inhale down. Pause and squeeze at the top.', safety: 'Push through the heels and keep the ribs down — if the lower back is doing the lifting, reset.' },
  'hip-thrust': { breath: 'Exhale up, pause, inhale down; keep the chin tucked and ribs locked.', safety: 'Use the pad or a towel on the bar — and stop the hip rise when your body folds into a back-arch.' },
  'kettlebell-swing': { breath: 'Short exhale (a sharp "tss") at the snap, inhale on the fall. Hinge, do not squat.', safety: 'The bell rises from the hip snap, not the arms — stop the set when the arms start steering.' },
  'mountain-climber': { breath: 'Rhythm: breathe continuously; no big breaths on a fast drill.', safety: 'Hands under shoulders and hips level; slow it down if the hips bounce.' },
  'burpee': { breath: 'Breathe with each hop, and take a real breath at the top of each rep.', safety: 'Step the feet in rather than jumping if your wrists, knees or back protest — same drill, better long term.' },
  'chest-dip': { breath: 'Inhale down, exhale up. Lean slightly forward for chest, upright for triceps.', safety: 'Only dip to the depth your shoulders control; if the bottom feels loose, stop a little higher.' },
  'incline-push-up': { breath: 'Inhale down, exhale up — same as a push-up, with more to give at the top.', safety: 'A great regression: switch to it the moment the last strict push-up breaks form.' },
  'knee-push-up': { breath: 'Inhale down, exhale up. Keep a straight line from knees to head.', safety: 'Hips stay level; if they pike or sag, set up again.' },
  'wide-push-up': { breath: 'Inhale down, exhale up, touch the chest not the nose.', safety: 'Elbows stay at a comfortable angle — wider does not mean lower to the floor.' },
  'close-grip-push-up': { breath: 'Exhale on the press; the tight base makes the triceps do the talking.', safety: 'Keep the hands under the chest, not the face — wrists stay in line with the forearms.' },
  'archer-push-up': { breath: 'Breathe evenly through both halves of the rep.', safety: 'Only attempt when standard push-ups are strict — the offset load is real strength work, not a showpiece.' },
  'explosive-push-up': { breath: 'Exhale on the push-off, land softly with bent elbows.', safety: 'Land where you launched — never chase height over control.' },
  'hindu-push-up': { breath: 'Inhale dipping forward, exhale pushing back — the breath steers this one.', safety: 'Move within a comfortable shoulder range; skip it if the shoulder shrugs at the bottom.' },
  'seal-jack': { breath: 'A quick exhale per hop; reset your breath between sets.', safety: 'Low-impact by design — land softly and keep the push-up plank honest.' },
  'weighted-push-up': { breath: 'Same as strict: inhale down, exhale up.', safety: 'Only add load when strict reps are easy; a vest beats a plate on the back for stability.' },
  'single-arm-cable-row': { breath: 'Exhale on the pull; resist the twist as the inhale comes back.', safety: 'The anti-rotation is the point — stop the pull the moment the torso turns.' },
  'chest-supported-row': { breath: 'Exhale as you pull; the bench keeps the spine honest for you.', safety: 'Keep the neck neutral — no crane-necking the head up to heave the weight.' },
  'straight-arm-pulldown': { breath: 'Exhale sweeping down, inhale returning slowly.', safety: 'Soft elbows fixed the whole rep; if the elbows bend to finish, the cable takes over from the lats.' },
  'leg-raise': { breath: 'Exhale lifting, inhale lowering with control.', safety: 'Stop before the lower back lifts off the pad — bend the knees if it swings.' },
  'hanging-knee-raise': { breath: 'Exhale as the knees rise, inhale down slowly.', safety: 'No swinging — if momentum is lifting the legs, shorten the range.' },
  'inverted-row': { breath: 'Exhale pulling, inhale lowering under control.', safety: 'Lower the bar until you can keep a straight, still body — angle is the difficulty dial.' },
};

// Generic fallbacks keep every library exercise fully teachable without
// inventing movement-specific claims where none are curated.
const PATTERN_BREATH = {
  'horizontal-push': 'Inhale on the way down, brace, exhale on the press.',
  'vertical-push': 'Inhale and brace before the press, exhale through the hardest part.',
  'horizontal-pull': 'Exhale on the pull, inhale as you return under control.',
  'vertical-pull': 'Exhale on the pull, inhale as you return under control.',
  'squat': 'Inhale and brace down, drive up, exhale near the top.',
  'hinge': 'Breathe in, brace, keep the brace through the hinge; exhale after you stand.',
  'lunge': 'Inhale down, exhale up; keep the torso tall.',
  'carry': 'Breathe steadily through the brace; do not hold your breath while moving.',
  'core': 'Exhale into the work, keep a firm brace while still breathing.',
  'cardio': 'Find a breathing rhythm you can hold for the whole set.',
  'unknown': 'Breathe out during the hard part, breathe in on the recovery.',
};
const PATTERN_SAFETY = {
  'horizontal-push': 'Keep the shoulders packed down and back — stop the set when the press turns into a shrug.',
  'vertical-push': 'Keep the ribs down; overhead work only goes as far as the shoulder controls comfortably.',
  'horizontal-pull': 'Let the shoulder blades move but stop the weight before it yanks the shoulders forward.',
  'vertical-pull': 'Own both ends of the range — control beats range every set.',
  'squat': 'Brace before you descend, keep the weight over the mid-foot, and take only the depth you control.',
  'hinge': 'The hinge comes from the hips — keep the load close and stop when the back would have to round.',
  'lunge': 'Take a stride that keeps the front knee tracking over the toes.',
  'carry': 'Stand tall; turn with your feet rather than twisting the spine.',
  'core': 'Move slowly — the moment other muscles join in to swing it, the set has earned its rest.',
  'cardio': 'Land softly, keep the joints in line, and pace so the last third stays honest.',
  'unknown': 'Progress slowly — the last reps stay as clean as the first.',
};

function genericExecution(ex){
  if(Array.isArray(ex.instructions) && ex.instructions.length > 1) return ex.instructions.slice(1);
  if(Array.isArray(ex.instructions) && ex.instructions.length === 1) return [ex.instructions[0]];
  if(ex.cues?.length) return [ `Work through: ${ex.cues.join('; ')}.` ];
  return [ `Perform the ${ex.name.toLowerCase()} slowly and under control through a range that stays comfortable.` ];
}

function neighborsFor(ex){
  const edges = Array.isArray(ex.substitution) ? ex.substitution : [];
  return edges.map(id => EXERCISE_BY_ID[id]).filter(Boolean);
}

export function teachingFor(exerciseId){
  const ex = EXERCISE_BY_ID[exerciseId];
  if(!ex) return null;
  const override = OVERRIDES[exerciseId] || {};
  const pattern = override.pattern || ex.movementPattern || ex.movement || 'unknown';
  const instructions = Array.isArray(ex.instructions) && ex.instructions.length ? ex.instructions : null;
  const level = ex.level || 'Beginner';
  const neighbors = neighborsFor(ex);
  const regressions = neighbors.filter(n => LEVEL_ORDER.indexOf(n.level || 'Beginner') < LEVEL_ORDER.indexOf(level))
    .map(n => ({ id: n.id, name: n.name, note: 'easier variation from the library' }));
  const progressions = neighbors.filter(n => LEVEL_ORDER.indexOf(n.level || 'Beginner') > LEVEL_ORDER.indexOf(level))
    .map(n => ({ id: n.id, name: n.name, note: 'harder variation from the library' }));
  const variations = neighbors
    .filter(n => (n.level || 'Beginner') === level && n.id !== exerciseId)
    .map(n => ({ id: n.id, name: n.name, equipment: (n.equipment || []).map(e => EQUIP_LABEL[e] || e).join(' + ') }));
  return {
    id: ex.id,
    name: ex.name,
    level,
    muscle: ex.muscle,
    setup: instructions ? instructions[0] : `Set up for the ${ex.name.toLowerCase()} with a comfortable, controlled start position — ${ex.cues?.[0] || 'steady and tall'}.`,
    execution: genericExecution(ex),
    breathing: override.breath || PATTERN_BREATH[pattern] || PATTERN_BREATH.unknown,
    mistakes: Array.isArray(ex.mistakes) && ex.mistakes.length ? ex.mistakes : (ex.cues?.length ? [`Watch the basics: ${ex.cues.join('; ')}.`] : []),
    safety: override.safety || PATTERN_SAFETY[pattern] || PATTERN_SAFETY.unknown,
    regressions,
    progressions,
    equipmentVariations: variations,
  };
}

export function curatedExerciseCount(){
  return Object.keys(OVERRIDES).length;
}

// Curated override ids must all exist in the library — a typo would silently
// drop an exercise back to generic wording. Exported for the test suite.
export function teachingOverrideIds(){
  return Object.keys(OVERRIDES);
}

export function allExerciseIds(){
  return EXERCISES.map(e => e.id);
}
