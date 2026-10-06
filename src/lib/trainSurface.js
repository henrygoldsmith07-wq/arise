// trainSurface.js — pure helpers that surface real data on the Train screen
// and in the exercise browser's "my programme / my history" answers.
//
// Everything here is a pure function over store and trainRecommendation
// shapes: no React, no engine calls, no invented claims. Copy derived from
// recommendation output is filtered so the UI can only say what the data
// supports.

// Sentence-case an engine reason without changing its wording.
function asSentence(reason){
  const text = String(reason || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/**
 * "Why Arise chose it" bullets: the deterministic scorer's own reasons,
 * verbatim, plus — only when history exists AND trainRecommendation recorded
 * it as an adaptation input — one line saying history shapes session
 * building, never the ranking.
 */
export function whyChoseBullets(recommendation, historyCount = 0){
  if(!recommendation) return [];
  const bullets = (recommendation.reasons || []).map(asSentence).filter(Boolean);
  const historyAdapts = (recommendation.adaptationInputs || []).some(field => field.id === 'history');
  if(historyCount > 0 && historyAdapts){
    const sessions = `logged session${historyCount === 1 ? '' : 's'}`;
    const verb = historyCount === 1 ? 'shapes' : 'shape';
    bullets.push(`Your ${historyCount} ${sessions} ${verb} the sessions it builds — the choice itself is goal, equipment, level and days`);
  }
  return bullets;
}

function templateWorkouts(template){
  return template?.program?.weeks?.[0]?.workouts || [];
}

function scheduleSessions(activeSchedule){
  return activeSchedule?.sessions || [];
}

function plannedLine(block){
  if(!block) return '';
  return `${block.sets ?? '?'}×${block.reps ?? '?'}`;
}

/** Every exercise id used by the active schedule or a live custom template. */
export function programmeExerciseIds({ activeSchedule = null, customTemplates = [] } = {}){
  const ids = new Set();
  for(const session of scheduleSessions(activeSchedule)){
    for(const block of session.blocks || []){
      if(block?.exerciseId) ids.add(block.exerciseId);
    }
  }
  for(const template of customTemplates || []){
    if(template?.deletedAt) continue;
    for(const workout of templateWorkouts(template)){
      for(const block of workout.blocks || []){
        if(block?.exerciseId) ids.add(block.exerciseId);
      }
    }
  }
  return ids;
}

/**
 * Where one exercise appears in the user's programme: scheduled sessions
 * (with the planned sets) and live custom templates.
 */
export function programmeUsageFor(exerciseId, { activeSchedule = null, customTemplates = [] } = {}){
  const rows = [];
  for(const session of scheduleSessions(activeSchedule)){
    const planned = (session.blocks || [])
      .filter(block => block?.exerciseId === exerciseId)
      .map(plannedLine)
      .filter(Boolean);
    if(planned.length){
      rows.push({ kind: 'schedule', name: session.title || session.dateISO || 'Scheduled session', detail: planned.join(' · ') });
    }
  }
  for(const template of customTemplates || []){
    if(template?.deletedAt) continue;
    const planned = templateWorkouts(template)
      .flatMap(workout => (workout.blocks || []).filter(block => block?.exerciseId === exerciseId))
      .map(plannedLine)
      .filter(Boolean);
    if(planned.length){
      rows.push({ kind: 'template', name: template.name || template.id || 'Template', detail: planned.join(' · ') });
    }
  }
  return rows;
}

/**
 * The most recent logged sessions containing this exercise (history is kept
 * oldest-first), newest first, with just the sets that were actually done.
 */
export function recentExerciseSessions(history, exerciseId, limit = 3){
  const rows = [];
  for(const entry of Array.isArray(history) ? history : []){
    if(!entry || typeof entry !== 'object') continue;
    const block = (Array.isArray(entry.blocks) ? entry.blocks : []).find(b => b?.exerciseId === exerciseId);
    if(!block) continue;
    const sets = (Array.isArray(block.sets) ? block.sets : [])
      .filter(set => set && !set.skipped)
      .map(set => ({ reps: set.reps ?? '', weightKg: set.weightKg ?? '', failed: !!set.failed }));
    if(!sets.length) continue;
    rows.push({ dateISO: entry.dateISO || '', title: entry.title || '', sets });
  }
  const count = Math.max(1, Number(limit) || 3);
  return rows.slice(-count).reverse();
}
