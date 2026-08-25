// scripts/generate-all-exercises.mjs
// Generates Arise exercise entries for ALL 302 @bryllim/workout-guide exercises.
// Maps package metadata → Arise schema, generates reciprocal substitutions,
// assigns tags/level/cues from muscle+equipment heuristics, and outputs a
// ready-to-paste data.js block plus an image map update.

import fs from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(fs.readFileSync('node_modules/@bryllim/workout-guide/manifest.json','utf8'));
const ariseSrc = fs.readFileSync('src/lib/data.js','utf8');

// Collect existing IDs to avoid duplicates
const idRe = /id:\s*'([^']+)'/g;
const existing = new Set();
let m;
while((m = idRe.exec(ariseSrc))) existing.add(m[1]);

// Package equipment → Arise equipment mapping
const EQUIP_MAP = {
  'Barbell': ['barbell'], 'Dumbbell': ['dumbbells'], 'Machine': ['machine'],
  'Cable': ['cable'], 'Bodyweight': ['bodyweight'], 'Cardio': ['bodyweight'],
  'Kettlebell': ['kettlebell'], 'Pull-up Bar': ['pullup-bar'],
  'Bench': ['bench'], 'Resistance Band': ['bands'],
  'Plate': ['barbell'], 'Box': ['bench'], 'Stability Ball': ['bodyweight'],
  'Chair': ['bench'], 'Wall': ['bodyweight'], 'Doorway': ['bodyweight'], 'Towel': ['bodyweight'],
};

// Muscle → Arise MUSCLES + tags + strategy hints
const MUSCLE_MAP = {
  'Chest': {arise:'Chest',tags:['push']}, 'Shoulders':{arise:'Shoulders',tags:['push']},
  'Rear Delts':{arise:'Shoulders',tags:['isolation','pull']}, 'Upper Back':{arise:'Back',tags:['pull']},
  'Back':{arise:'Back',tags:['pull']}, 'Lats':{arise:'Back',tags:['pull']},
  'Posterior Chain':{arise:'Glutes',tags:['compound']}, 'Lower Back':{arise:'Core',tags:['core-stability']},
  'Biceps':{arise:'Arms',tags:['isolation']}, 'Triceps':{arise:'Arms',tags:['isolation','push']},
  'Forearms':{arise:'Arms',tags:['isolation','grip']},
  'Quads':{arise:'Legs',tags:['compound']}, 'Hamstrings':{arise:'Glutes',tags:['compound']},
  'Glutes':{arise:'Glutes',tags:['compound']}, 'Calves':{arise:'Legs',tags:['isolation']},
  'Adductors':{arise:'Legs',tags:['isolation']}, 'Hips':{arise:'Glutes',tags:['mobility']},
  'Core':{arise:'Core',tags:['core-stability']}, 'Legs':{arise:'Legs',tags:['conditioning']},
  'Mobility':{arise:'Core',tags:['mobility']},
};

// Exercise type → progression type
const TYPE_MAP = {
  'weight_reps':'load','bodyweight_reps':'reps','duration':'time',
  'distance':'time','duration_weighted':'time','assisted_bodyweight':'reps',
};
function slugToId(slug){ return slug; }
function deriveLevel(ex){
  if(/weighted|muscle-?up|pistol|nordic|planche|front-lever/.test(ex.slug)) return 'Advanced';
  if(/assisted|incline|knee|wall|seated|machine|band/.test(ex.slug)) return 'Beginner';
  return 'Intermediate';
}
function deriveTags(ex){
  const t=[];
  const eq=ex.equipment.toLowerCase();
  const m=ex.primaryMuscle.toLowerCase();
  const sl=ex.slug.toLowerCase();
  if(ex.exerciseType==='weight_reps' && !/curl|raise|fly|extension|kickback|pushdown/.test(sl)) t.push('compound');
  else t.push('isolation');
  if(/press|push-up|dip|overhead|landmine/.test(sl)) t.push('push');
  if(/row|pull-up|chin|pulldown|face-pull|shrug|straight-arm/.test(sl)) t.push('pull');
  if(/swing|burpee|thruster|jump|high-knee|mountain|bear-crawl|running|jump-rope/.test(sl)) t.push('explosive','conditioning');
  if(/plank|dead-bug|bird-dog|hollow|pallof|side-plank|carry|crawl/.test(sl)) t.push('core-stability');
  if(/lunge|step-up|split-squat|single-leg|single-arm|bulgarian|unilateral/.test(slugToId(ex.slug))) t.push('unilateral');
  if(/stretch|mobility|wall-towel|doorway/.test(sl+m)) t.push('mobility');
  return [...new Set(t)];
}
function generateCues(ex){
  const m=ex.primaryMuscle.toLowerCase();
  const cuesByMuscle={
    chest:['Retract shoulder blades','Control the descent','Full stretch at bottom'],
    back:['Squeeze shoulder blades','Pull with elbows','Control the return'],
    lats:['Initiate from the armpit','Keep torso stable','Full stretch at top'],
    quads:['Knees track toes','Drive through mid-foot','Full lockout at top'],
    hamstrings:['Soft knees','Feel the stretch','Neutral spine'],
    glutes:['Drive hips forward','Squeeze at lockout','Control the eccentric'],
    shoulders:['Core braced','Press without arching','Elbows slightly forward'],
    'rear delts':['Lead with pinkies','Squeeze the back of shoulder','Light weight'],
    biceps:['Elbows pinned','No swinging','Squeeze at the top'],
    triceps:['Elbows narrow','Full extension','Slow negative'],
    core:['Ribcage down','Breathe steadily','No lower-back sag'],
    calves:['Full range','Pause at top','Slow negative'],
    forearms:['Wrist alignment','Slow controlled movement','Feel forearm tension'],
    'posterior chain':['Neutral spine','Hip hinge pattern','Feel hamstrings load'],
    'upper back':['Pinch shoulder blades','Chin tucked','Hold briefly'],
    adductors:['Controlled range','Inner thigh squeeze','Slow tempo'],
    legs:['Steady effort','Breathe rhythmically','Maintain form'],
    hips:['Controlled range','Feel hip opening','No forcing'],
    mobility:['Gentle stretch','Breathe into it','No bouncing'],
  };
  return cuesByMuscle[m] || cuesByMuscle['chest'];
}

// Build reciprocal sub graph by primary muscle grouping
const byMuscle={};
for(const ex of manifest){ const m=ex.primaryMuscle; if(!byMuscle[m])byMuscle[m]=[]; byMuscle[m].push(ex); }

function pickSubs(ex, count=3){
  const pool=byMuscle[ex.primaryMuscle]||[];
  const others=pool.filter(p=>p.slug!==ex.slug);
  // prefer same-equipment first, then different
  const sameEq=others.filter(p=>p.equipment===ex.equipment);
  const diffEq=others.filter(p=>p.equipment!==ex.equipment);
  return [...sameEq.slice(0,2),...diffEq.slice(0,count-2)].slice(0,count).map(p=>slugToId(p.slug));
}

const lines=[];
let added=0, skipped=0;

for(const ex of manifest){
  const id=slugToId(ex.slug);
  if(existing.has(id)){ skipped++; continue; }
  const mm=MUSCLE_MAP[ex.primaryMuscle];
  if(!mm){ console.error(`No muscle map for ${ex.primaryMuscle} (${ex.slug})`); skipped++; continue; }
  const eq=[...new Set(EQUIP_MAP[ex.equipment]||['bodyweight'])];
  const tags=deriveTags(ex);
  const prog=TYPE_MAP[ex.exerciseType]||'load';
  const level=deriveLevel(ex);
  const cues=generateCues(ex);
  const subs=pickSubs(ex);
  const name=ex.name;

  lines.push(`  { id: '${id}', name: '${name}', muscle: '${mm.arise}', equipment: [${eq.map(e=>`'${e}'`).join(', ')}], level: '${level}', tags: [${tags.map(t=>`'${t}'`).join(',')}], imageSlug: '${ex.slug}', cues: ${JSON.stringify(cues)}, substitution: [${subs.map(s=>`'${s}'`).join(', ')}], unilateral: false, supportsWeighted: /weighted/i.test('${id}'), supportsAssisted: /assisted/i.test('${id}'), progression: '${prog}'${ex.isStretch?", isStretch: true":''} },`);
  added++;
}

// Output file
fs.writeFileSync('scripts/generated-exercises.txt', lines.join('\n'));
console.log(`Generated: ${added} new exercises | Skipped (already exist): ${skipped}`);
console.log(`Total library after paste: ${existing.size + added}`);

// Also output the partner back-link script
const backlinks=[];
for(const ex of manifest){
  const id=slugToId(ex.slug);
  if(existing.has(id)) continue;
  const subs=pickSubs(ex);
  for(const s of subs){
    if(existing.has(s)) backlinks.push({partner:s,newId:id});
  }
}
if(backlinks.length){
  fs.writeFileSync('scripts/generated-backlinks.json', JSON.stringify(backlinks,null,2));
  console.log(`Back-links needed: ${backlinks.length} (written to scripts/generated-backlinks.json)`);
}
