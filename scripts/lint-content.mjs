import { readFileSync } from 'node:fs';
import { validateContent, EXERCISE_BY_ID } from '../src/lib/data.js';
import { validateExerciseText } from '../src/lib/exerciseText.js';

const text = JSON.parse(readFileSync(new URL('../src/lib/data/exercise-text.json', import.meta.url), 'utf8'));
const errors = [...validateContent(), ...validateExerciseText(text, new Set(Object.keys(EXERCISE_BY_ID)))];
if (errors.length) {
  console.error('Content lint failed:');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('Content lint OK — exercises, programs and exercise text valid.');
