import { validateContent } from '../src/lib/data.js';

const errors = validateContent();
if (errors.length) {
  console.error('Content lint failed:');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('Content lint OK — exercises and programs valid.');
