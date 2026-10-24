// programs-rider.js — "Rider Upper 3×Week": an upper-body-first gym plan for
// people whose legs are already trained by cycling, running or triathlon.
//
// Design (stated as sensible defaults, not optima):
//   - 3 sessions a week on machines and cables (the kit a typical commercial
//     gym has free), so every working weight is a pin or a stack setting.
//   - Upper body carries the volume. Each session keeps leg/hip work to ONE
//     short block of at most 2 sets, prescribed well short of failure, so the
//     gym is less likely to leave the legs heavy for the next ride. Leg
//     strength work is not dropped entirely: it is kept small, not removed.
//   - No barbell squats or deadlifts; no claims about cycling performance.
// tests/rider-programme.test.js pins these properties (leg-set cap, kit,
// upper-body share) so later edits cannot quietly turn it into a leg day.
export const RIDER_LEG_SETS_CAP = 2;

export const RIDER_UPPER_3X = {
  id: 'rider-upper-3x',
  name: 'Rider Upper 3×Week',
  tagline: 'Upper body on machines and cables for cyclists and triathletes. Legs get one short, easy block so rides stay fresh.',
  level: 'Beginner',
  daysPerWeek: 3,
  mesocycle: { weeks: 2, deloadWeek: null, progression: 'double-progression' },
  version: 1,
  equipment: ['machine', 'cable', 'bodyweight'],
  weeks: [
    { week: 1, workouts: [
      { day: 1, title: 'Push + Pull', blocks: [
        { exerciseId: 'chest-press-machine', sets: 3, reps: '8–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'lat-pulldown', sets: 3, reps: '8–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'machine-shoulder-press', sets: 3, reps: '8–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'leg-press', sets: 2, reps: '8', restSec: 120, loadHint: 'stop 3+ reps short — legs stay fresh for riding' },
        { exerciseId: 'pallof-press', sets: 2, reps: '10 each', restSec: 45, loadHint: 'cable' },
      ]},
      { day: 2, title: 'Back + Arms', blocks: [
        { exerciseId: 'cable-row', sets: 3, reps: '8–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'straight-arm-pulldown', sets: 3, reps: '12–15', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'face-pull', sets: 3, reps: '12–15', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'cable-curl', sets: 3, reps: '10–12', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'tricep-pushdown', sets: 3, reps: '10–12', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'dead-bug', sets: 2, reps: '8 each', restSec: 45, loadHint: 'bodyweight' },
      ]},
      { day: 3, title: 'Chest + Shoulders', blocks: [
        { exerciseId: 'pec-deck', sets: 3, reps: '10–15', restSec: 75, loadHint: 'stack' },
        { exerciseId: 'machine-row', sets: 3, reps: '8–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'cable-lateral-raise', sets: 3, reps: '12–15', restSec: 45, loadHint: 'cable' },
        { exerciseId: 'glute-bridge', sets: 2, reps: '12', restSec: 60, loadHint: 'bodyweight, easy' },
        { exerciseId: 'cable-crunch', sets: 2, reps: '10–12', restSec: 45, loadHint: 'cable' },
      ]},
    ]},
    { week: 2, workouts: [
      { day: 1, title: 'Push + Pull', blocks: [
        { exerciseId: 'chest-press-machine', sets: 3, reps: '9–12', restSec: 90, loadHint: 'beat last week by a rep' },
        { exerciseId: 'assisted-pull-up', sets: 3, reps: '6–10', restSec: 90, loadHint: 'machine assist' },
        { exerciseId: 'machine-shoulder-press', sets: 3, reps: '9–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'leg-press', sets: 2, reps: '8', restSec: 120, loadHint: 'same load as last week, stop 3+ reps short' },
        { exerciseId: 'pallof-press', sets: 2, reps: '12 each', restSec: 45, loadHint: 'cable' },
      ]},
      { day: 2, title: 'Back + Arms', blocks: [
        { exerciseId: 'single-arm-cable-row', sets: 3, reps: '10 each', restSec: 75, loadHint: 'cable' },
        { exerciseId: 'lat-pulldown', sets: 3, reps: '9–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'reverse-pec-deck', sets: 3, reps: '12–15', restSec: 60, loadHint: 'stack' },
        { exerciseId: 'rope-hammer-curl', sets: 3, reps: '10–12', restSec: 60, loadHint: 'cable rope' },
        { exerciseId: 'tricep-pushdown', sets: 3, reps: '11–13', restSec: 60, loadHint: 'cable' },
        { exerciseId: 'dead-bug', sets: 2, reps: '10 each', restSec: 45, loadHint: 'bodyweight' },
      ]},
      { day: 3, title: 'Chest + Shoulders', blocks: [
        { exerciseId: 'incline-cable-fly', sets: 3, reps: '10–15', restSec: 75, loadHint: 'cable' },
        { exerciseId: 'machine-row', sets: 3, reps: '9–12', restSec: 90, loadHint: 'stack' },
        { exerciseId: 'cable-lateral-raise', sets: 3, reps: '12–15', restSec: 45, loadHint: 'cable' },
        { exerciseId: 'cable-leg-curl', sets: 2, reps: '10–12', restSec: 60, loadHint: 'light, stop 3+ reps short' },
        { exerciseId: 'cable-crunch', sets: 2, reps: '12', restSec: 45, loadHint: 'cable' },
      ]},
    ]},
  ],
};

export const RIDER_UPPER_3X_HISTORY = [
  { programId: 'rider-upper-3x', version: 1, date: '2026-10-22', changes: 'Initial release — upper-body-first machine/cable plan for cyclists and triathletes; leg work capped at one short block per session.' },
];

// Why the legs are capped, in plain words (shown on the shelf card and the
// programme card). Stated as a default, not a cycling-performance claim.
export const RIDER_WHY_LEGS_CAPPED =
  'Heavy leg sessions can leave your legs sore for 1–2 days, which makes key rides harder. So each session has one short, easy leg block (2 sets max, stop 3+ reps short). Upper body still gets full volume.';

// 2-day heavy-week variant for riders with 4+ ride days or only 2 gym days:
// the same upper-body pairs as the 3-day plan folded into two sessions, leg
// work still capped at one block of RIDER_LEG_SETS_CAP sets.
const wk = (n, [d1, d2])=> ({ week:n, workouts:[{ day:1, ...d1 }, { day:2, ...d2 }] });
export const RIDER_UPPER_2X = {
  id: 'rider-upper-2x',
  name: 'Rider Upper 2×Week',
  tagline: 'Two upper-body sessions for heavy ride weeks (4+ ride days). Legs get one short, easy block.',
  level: 'Beginner',
  daysPerWeek: 2,
  mesocycle: { weeks: 2, deloadWeek: null, progression: 'double-progression' },
  version: 1,
  equipment: ['machine', 'cable', 'bodyweight'],
  weeks: [
    wk(1, [
      { title:'Push + Pull', blocks:[
        { exerciseId:'chest-press-machine', sets:3, reps:'8–12', restSec:90, loadHint:'stack' },
        { exerciseId:'lat-pulldown', sets:3, reps:'8–12', restSec:90, loadHint:'stack' },
        { exerciseId:'machine-shoulder-press', sets:3, reps:'8–12', restSec:90, loadHint:'stack' },
        { exerciseId:'cable-row', sets:3, reps:'8–12', restSec:90, loadHint:'stack' },
        { exerciseId:'leg-press', sets:2, reps:'8', restSec:120, loadHint:'stop 3+ reps short — legs stay fresh for riding' },
        { exerciseId:'pallof-press', sets:2, reps:'10 each', restSec:45, loadHint:'cable' },
      ]},
      { title:'Back + Arms + Shoulders', blocks:[
        { exerciseId:'pec-deck', sets:3, reps:'10–15', restSec:75, loadHint:'stack' },
        { exerciseId:'machine-row', sets:3, reps:'8–12', restSec:90, loadHint:'stack' },
        { exerciseId:'face-pull', sets:3, reps:'12–15', restSec:60, loadHint:'cable' },
        { exerciseId:'cable-lateral-raise', sets:3, reps:'12–15', restSec:45, loadHint:'cable' },
        { exerciseId:'cable-curl', sets:3, reps:'10–12', restSec:60, loadHint:'cable' },
        { exerciseId:'tricep-pushdown', sets:3, reps:'10–12', restSec:60, loadHint:'cable' },
        { exerciseId:'glute-bridge', sets:2, reps:'12', restSec:60, loadHint:'bodyweight, easy' },
      ]},
    ]),
    wk(2, [
      { title:'Push + Pull', blocks:[
        { exerciseId:'chest-press-machine', sets:3, reps:'9–12', restSec:90, loadHint:'beat last week by a rep' },
        { exerciseId:'assisted-pull-up', sets:3, reps:'6–10', restSec:90, loadHint:'machine assist' },
        { exerciseId:'machine-shoulder-press', sets:3, reps:'9–12', restSec:90, loadHint:'stack' },
        { exerciseId:'single-arm-cable-row', sets:3, reps:'10 each', restSec:75, loadHint:'cable' },
        { exerciseId:'leg-press', sets:2, reps:'8', restSec:120, loadHint:'same load as last week, stop 3+ reps short' },
        { exerciseId:'pallof-press', sets:2, reps:'12 each', restSec:45, loadHint:'cable' },
      ]},
      { title:'Back + Arms + Shoulders', blocks:[
        { exerciseId:'incline-cable-fly', sets:3, reps:'10–15', restSec:75, loadHint:'cable' },
        { exerciseId:'lat-pulldown', sets:3, reps:'9–12', restSec:90, loadHint:'stack' },
        { exerciseId:'reverse-pec-deck', sets:3, reps:'12–15', restSec:60, loadHint:'stack' },
        { exerciseId:'cable-lateral-raise', sets:3, reps:'12–15', restSec:45, loadHint:'cable' },
        { exerciseId:'rope-hammer-curl', sets:3, reps:'10–12', restSec:60, loadHint:'cable rope' },
        { exerciseId:'tricep-pushdown', sets:3, reps:'11–13', restSec:60, loadHint:'cable' },
        { exerciseId:'cable-leg-curl', sets:2, reps:'10–12', restSec:60, loadHint:'light, stop 3+ reps short' },
      ]},
    ]),
  ],
};
export const RIDER_UPPER_2X_HISTORY = [
  { programId:'rider-upper-2x', version:1, date:'2026-10-24', changes:'Initial release — 2-day heavy-ride-week variant of the rider plan; leg work capped at one short block per session.' },
];

// Which rider plan fits: 2 gym days a week, or 4+ ride days, gets the 2-day one.
export function riderPlanIdFor({ daysPerWeek = null, rideDays = [] } = {}){
  const rides = new Set(Array.isArray(rideDays) ? rideDays : []).size;
  return (daysPerWeek === 2 || rides >= 4) ? RIDER_UPPER_2X.id : RIDER_UPPER_3X.id;
}
