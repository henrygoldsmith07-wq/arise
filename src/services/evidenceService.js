import { loadArchivedEvaluationCount, loadEvaluationLedger } from '../lib/longitudinal.js';
import { deriveProgressionModel } from '../lib/progressionModel.js';
import { collectDeloadDecisions, runComparativeStudy, studyCoverage, validateDeloadDecisions } from '../lib/study.js';
import { fieldStudyStatus } from '../lib/fieldStudy.js';
import { joinStudy, withdrawFromStudy } from '../lib/participation.js';
import { downloadJson } from '../lib/export.js';

export function buildEvidenceSnapshot(store){
  const ledger = loadEvaluationLedger();
  const coverage = studyCoverage(ledger);
  let comparative = null;
  try{ comparative = runComparativeStudy(store?.history || []); }catch{}
  const deloads = validateDeloadDecisions(collectDeloadDecisions([store?.activeSchedule]), store?.history || []);
  const model = deriveProgressionModel({ history:store?.history || [], study:comparative });
  return {
    coverage,
    comparative,
    deloads,
    model,
    ledger,
    archivedCount:loadArchivedEvaluationCount(),
    fieldStudy:fieldStudyStatus({ store, ledger }),
  };
}

export function joinEvidenceStudy(store){ return joinStudy(store); }
export function withdrawEvidenceStudy(store){ return withdrawFromStudy(store); }

export async function exportStudyDataFile(store){
  try{ localStorage.setItem('arise.lastExportAt', new Date().toISOString()); }catch{}
  const { buildStudyExportPayload } = await import('../lib/studyExport.js');
  const envelope = buildStudyExportPayload(store);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `arise-study-${date}.json`;
  downloadJson(filename, envelope);
  return { filename, envelope };
}
