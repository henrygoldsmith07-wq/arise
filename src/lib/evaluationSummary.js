// Pure browser/worker entry point for longitudinal evidence aggregation.
// Storage is deliberately outside this module: workers cannot access
// localStorage, so callers must provide the ledger explicitly.

import { hasConsent } from './longitudinalCore.js';
import { evaluateLongitudinal, calibrateRecommendations, prospectiveFieldComparison } from './evaluation.js';

export function summarizeEvaluationLedger({ ledger = [], preferences = null, config = null } = {}){
  if(!hasConsent(preferences)){
    return { consented:false, evaluation:null, calibration:null, fieldComparison:null };
  }
  return {
    consented:true,
    evaluation:evaluateLongitudinal(ledger, { config }),
    calibration:calibrateRecommendations(ledger, { config }),
    fieldComparison:prospectiveFieldComparison(ledger, { config }),
  };
}
