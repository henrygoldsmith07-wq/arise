import fs from 'node:fs';
// Exercise entries live across the split data modules; concatenate them in
// assembly order (primary then coverage, matching data.js) before evaluating.
const src = [
  'src/lib/data/exercises-primary.js',
  'src/lib/data/exercises-coverage.js',
].map(f=> fs.readFileSync(f, 'utf8')).join('\n');
// Extract EXERCISES array sources and evaluate them in isolation.
const EXERCISES = [];
const arrayRe = /export const EXERCISES_(?:PRIMARY|COVERAGE) = (\[[\s\S]*?\n\]);/g;
let arrayMatch;
while((arrayMatch = arrayRe.exec(src))) EXERCISES.push(...eval(arrayMatch[1]));
const COLS = [
  ['BW', ['bodyweight']],
  ['DB', ['dumbbells','kettlebell']],
  ['BB', ['barbell']],
  ['Cable', ['cable','bands']],
  ['Machine', ['machine']],
];
const ROWS = [
  ['Chest', ['chest','push-up','fly','dip'], ['Chest']],
  ['Back', ['row','pull-up','chin','pulldown','shrug','face-pull','extension'], ['Back']],
  ['Quads', ['squat','lunge','step-up','leg-press','wall-sit'], ['Legs']],
  ['Hamstrings', ['nordic','deadlift','good-morning'], ['Glutes']],
  ['Glutes', ['thrust','bridge','abduction','swing','pull-through'], ['Glutes']],
  ['Side delts', ['lateral','arnold','overhead','pike'], ['Shoulders']],
  ['Rear delts', ['rear-delt','face-pull'], ['Shoulders']],
  ['Biceps', ['curl'], ['Arms']],
  ['Triceps', ['tricep','dip'], ['Arms']],
  ['Core', ['plank','dead-bug','bird-dog','pallof','knee-raise','leg-raise','carry','crawl','mountain'], ['Core']],
];
const cellHas = (ex, col) => ex.equipment.some(eq => col.includes(eq));
const grid = {};
for(const [row,, muscles] of ROWS){
  for(const [colName, colEqs] of COLS){
    const key = row + '|' + colName;
    grid[key] = EXERCISES.filter(e => {
      const hay = (e.id + ' ' + e.name).toLowerCase();
      const inRow = muscles.includes(e.muscle) || ROWS.find(r=>r[0]===row)[1].some(k => hay.includes(k));
      return inRow && cellHas(e, colEqs);
    });
  }
}
let holes = 0;
console.log('Row'.padEnd(13) + COLS.map(([c]) => c.padEnd(8)).join(''));
for(const [row] of ROWS){
  let line = row.padEnd(13);
  for(const [colName] of COLS){
    const n = grid[row+'|'+colName].length;
    if(!n){ line += 'HOLE'.padEnd(8); holes++; }
    else line += String(n).padEnd(8);
  }
  console.log(line);
}
console.log('\nTotal exercises:', EXERCISES.length, '| holes:', holes);
