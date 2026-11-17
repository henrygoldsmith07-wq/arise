// Two copy paths that used to promise data the app did not have: an empty
// exercise-history sheet claimed "last 5 sessions", and a programme with no
// first-week exercises rendered four empty preview week cards. The unit suite
// has no DOM, so pin the rendered strings as source contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name) => readFileSync(join(process.cwd(), 'src', 'components', name), 'utf8');
const readSrc = (name) => readFileSync(join(process.cwd(), 'src', name), 'utf8');

describe('UI honesty — counts and empty states', () => {
  it('the exercise-history heading states the real session count', () => {
    const source = read('ExerciseHistorySheet.jsx');
    assert.match(source, /sessions\.length === 0 \? `\$\{name\}: no sessions yet`/);
    assert.match(source, /sessions\.length === 1 \? `\$\{name\}: last session`/);
    assert.doesNotMatch(source, /last \$\{sessions\.length \|\| 5\} sessions/);
  });

  it('the progression preview shows an empty state instead of empty week cards', () => {
    const source = read('ProgressionPreview.jsx');
    assert.match(source, /preview\.exerciseCount === 0 && \(/);
    assert.match(source, /preview\.exerciseCount > 0 && \(/);
    assert.match(source, /no exercises to preview yet/);
  });
});

describe('UI hardening — narrow viewport', () => {
  it('the More page container is constrained to the viewport width', () => {
    // At 320px the container previously resolved to 366px, clipping the
    // subtitle and settings cards with a page-level horizontal scroll.
    const source = read('MoreView.jsx');
    const line = source.split('\n').find((l) => l.includes('px-4 pt-5 pb-2 space-y-3 max-w-3xl mx-auto'));
    assert.ok(line, 'More page container not found');
    assert.match(line, /w-full min-w-0/);
  });

  it('policy button rows wrap instead of forcing the page wider', () => {
    const source = read('settings/TrainingPolicySettings.jsx');
    assert.equal((source.match(/className="flex flex-wrap gap-1\.5"/g) || []).length, 2);
    assert.doesNotMatch(source, /className="flex gap-1\.5" role="group"/);
  });
});

describe('UI hardening — source contracts', () => {
  it('the time-available row wraps instead of overflowing narrow screens', () => {
    const source = read('TodayView.jsx');
    assert.match(source, /className="flex flex-wrap items-center gap-1" role="group" aria-label="Time available today"/);
    assert.doesNotMatch(source, /className="flex items-center gap-1" role="group" aria-label="Time available today"/);
  });

  it('backup recency is read fresh each render, not memoised on history', () => {
    const source = read('TodayView.jsx');
    assert.match(source, /const backupRecency = computeBackupRecency\(\{ history:store\.history \|\| \[\], lastBackupAt:readBackupState\(\)\.lastBackupAt \}\);/);
    assert.doesNotMatch(source, /const backupRecency = useMemo\(/);
  });

  it('the coarse-stack caution uses a defined caution token, not a no-op', () => {
    const source = read('Onboarding.jsx');
    assert.match(source, /data-testid="coarse-stack-warning" className="text-\[11px\] text-review font-semibold"/);
    assert.doesNotMatch(source, /text-warn/);
  });

  it('experiment lifecycle actions use the shared confirm dialog, not window.confirm', () => {
    const source = read('ProgressView.jsx');
    assert.match(source, /import \{ useDialogs \} from '\.\/Dialog\.jsx';/);
    assert.match(source, /const dialogs = useDialogs\(\);/);
    assert.match(source, /\{dialogs\.node\}/);
    assert.doesNotMatch(source, /if\(!confirm\(/);
    assert.equal((source.match(/await dialogs\.confirm\(\{/g) || []).length, 3);
    assert.equal((source.match(/destructive: true/g) || []).length, 3);
    for(const fn of ['doConclude', 'doCancel', 'doDeleteExperiment']){
      assert.match(source, new RegExp(`const ${fn} = async \\(id\\)=>`));
    }
    // The underlying actions are unchanged.
    for(const action of ['concludeExperimentById', 'cancelExperimentById', 'deleteExperiment']){
      assert.match(source, new RegExp(`${action}\\(store, id\\)`));
    }
  });

  it('the longitudinal comment no longer claims off-main-thread work', () => {
    const source = read('ProgressView.jsx');
    assert.doesNotMatch(source, /runs off the main thread \(analyticsWorker\)/);
    assert.match(source, /runs synchronously, but only after a macrotask/);
    assert.match(source, /the dedicated worker was removed/);
  });

  it('Clear filters also turns off the only-my-kit toggle', () => {
    const source = read('ExerciseBrowser.jsx');
    assert.match(source, /const clearFilters = \(\)=>\{[^\n]*setOnlyAvailable\(false\)[^\n]*\};/);
  });

  it('per-card disclosures are keyed by exercise id', () => {
    const source = read('ExerciseBrowser.jsx');
    assert.match(source, /const \[howToOpenById,setHowToOpenById\]=useState\(\{\}\);/);
    assert.match(source, /const \[subsOpenById,setSubsOpenById\]=useState\(\{\}\);/);
    assert.match(source, /open=\{!!howToOpenById\[ex\.id\]\}/);
    assert.match(source, /open=\{!!subsOpenById\[ex\.id\]\}/);
    assert.match(source, /setHowToOpen\(ex\.id, e\.currentTarget\.open\)/);
    assert.match(source, /setSubsOpen\(ex\.id, e\.currentTarget\.open\)/);
    assert.doesNotMatch(source, /open=\{howToOpen\}/);
    assert.doesNotMatch(source, /open=\{subsOpen\}/);
  });

  it('large-text mode bumps the content-bearing 9px confidence badges too', () => {
    const css = readSrc('index.css');
    assert.match(css, /:root\.large-text \.text-\\\[9px\\\] \{ font-size: 0\.75rem; \}/);
    assert.match(read('TrainingProfileCard.jsx'), /text-\[9px\]/);
    assert.match(read('ProgrammeLifecycle.jsx'), /text-\[9px\]/);
  });
});
