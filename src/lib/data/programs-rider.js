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
  mesocycle: { weeks: 4, deloadWeek: 4, progression: 'double-progression' },
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
