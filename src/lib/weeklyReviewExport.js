// weeklyReviewExport.js — portable Markdown for one completed weekly review.
// Pure formatter: no store reads, DOM access, or timestamps.

const metric = (value, suffix = '') => value == null ? '—' : `${value}${suffix}`;

export function renderWeeklyReviewMarkdown({
  weekKey,
  weekNumber = null,
  completion = null,
  strength = null,
  volume = null,
  readiness = null,
  prs = 0,
  narrative = [],
  changes = [],
  deload = false,
} = {}){
  const lines = [
    '# Arise weekly review',
    '',
    `Week of ${weekKey || 'unknown'}${weekNumber != null ? ` · programme week ${weekNumber}` : ''}`,
    '',
    '## Summary',
    `- Completion: ${completion ? `${completion.done}/${completion.total}` : '—'}`,
    `- Strength change: ${strength == null ? '—' : `${strength > 0 ? '+' : ''}${strength}%`}`,
    `- Volume change: ${volume == null ? '—' : `${volume > 0 ? '+' : ''}${volume}%`}`,
    `- Readiness: ${metric(readiness)}`,
    `- New PRs: ${prs || 0}`,
  ];
  if(deload) lines.push('- Next week: deload');
  if(narrative.length){
    lines.push('', '## Review notes', ...narrative.map((line)=> `- ${line}`));
  }
  if(changes.length){
    lines.push('', '## Next week changes');
    for(const change of changes){
      lines.push(`- ${change.summary}`);
      if(change.reason) lines.push(`  - Why: ${change.reason}`);
    }
  } else {
    lines.push('', '## Next week changes', '- No structural changes queued.');
  }
  lines.push('', '---', 'Exported from Arise.');
  return lines.join('\n');
}
