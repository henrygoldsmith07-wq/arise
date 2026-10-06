// programs.js — the built-in Arise programmes (including the two entries the
// source appends via PROGRAMS.push) and the append-only programme version
// history. Moved verbatim from data.js, in original order; data.js re-exports
// the names unchanged.
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
